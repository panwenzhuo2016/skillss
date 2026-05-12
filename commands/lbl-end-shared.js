const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_HOME = path.join(os.homedir(), '.claude');
const MAX_SUMMARY_CHARS = 100;

// Anthropic Claude Opus 4 公开价 (USD per 1M tokens)。如改用其他模型/内部价，改这里。
const PRICE_PER_M = {
  input: 15.0,
  output: 75.0,
  cache_read: 1.5,
  cache_write: 18.75,
};

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (raw += c));
    process.stdin.on('end', () => resolve(raw));
    setTimeout(() => resolve(raw), 800);
  });
}

function findSessionName(sessionId) {
  const sessionsDir = path.join(CLAUDE_HOME, 'sessions');
  if (!fs.existsSync(sessionsDir)) return null;
  for (const file of fs.readdirSync(sessionsDir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const obj = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'));
      if (obj.sessionId === sessionId && obj.name) return obj.name;
    } catch {}
  }
  return null;
}

function findTranscript(sessionId, transcriptHint) {
  if (transcriptHint && fs.existsSync(transcriptHint)) return transcriptHint;
  const projectsDir = path.join(CLAUDE_HOME, 'projects');
  if (!fs.existsSync(projectsDir)) return null;
  for (const sub of fs.readdirSync(projectsDir)) {
    const candidate = path.join(projectsDir, sub, sessionId + '.jsonl');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function pickSummaryFromText(text) {
  // 兼容多种写法：**本次回答总结**：xxx / 本次回答总结：xxx / 本次总结：xxx / **总结**：xxx
  const re = /\*{0,2}本次(?:回答)?总结\*{0,2}\s*[:：]\s*([\s\S]+?)(?:\n\n|$)/;
  const m = text.match(re);
  if (m && m[1]) return m[1].trim();
  return text.trim();
}

// 判断 transcript 一行是不是"用户真实输入"（不是 tool_result 回填）
function isRealUserMessage(obj) {
  if (obj.type !== 'user') return false;
  const content = obj.message && obj.message.content;
  if (typeof content === 'string') return true;
  if (Array.isArray(content)) {
    return content.every((c) => c && c.type !== 'tool_result');
  }
  return false;
}

function extractUserText(obj) {
  const content = obj.message && obj.message.content;
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    text = content.filter((c) => c && c.type === 'text' && c.text).map((c) => c.text).join('\n');
  }
  // 剥 system-reminder / command-* 这类标签噪音
  text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');
  text = text.replace(/<command-[a-z]+>[\s\S]*?<\/command-[a-z]+>/g, '');
  text = text.replace(/<local-command-[a-z]+>[\s\S]*?<\/local-command-[a-z]+>/g, '');
  return text.trim();
}

// 倒推 transcript，从最后一条真实 user message 之后累加所有 assistant 的 usage
function gatherTurnStats(lines) {
  const stats = { input: 0, output: 0, cache_read: 0, cache_write: 0, hasText: false, summary: '', userInput: '' };
  // 第一步：找出"本回合"起点（最后一条真实 user message 之后），同时取该 user message 的文本
  let turnStartIdx = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    let obj;
    try { obj = JSON.parse(lines[i]); } catch { continue; }
    if (isRealUserMessage(obj)) {
      turnStartIdx = i + 1;
      stats.userInput = extractUserText(obj);
      break;
    }
  }

  // 第二步：累加 usage + 收集最后一条带文本的 assistant message
  // 注意：CC 多次 tool 调用会复用同一个 message id（usage 相同），需要去重
  const seenMsgIds = new Set();
  let lastTextBlock = null;
  for (let i = turnStartIdx; i < lines.length; i++) {
    let obj;
    try { obj = JSON.parse(lines[i]); } catch { continue; }
    if (obj.type !== 'assistant' || !obj.message) continue;
    const msg = obj.message;
    const usage = msg.usage;
    const msgId = msg.id;
    if (usage && msgId && !seenMsgIds.has(msgId)) {
      seenMsgIds.add(msgId);
      stats.input += usage.input_tokens || 0;
      stats.output += usage.output_tokens || 0;
      stats.cache_read += usage.cache_read_input_tokens || 0;
      stats.cache_write += usage.cache_creation_input_tokens || 0;
    }
    if (Array.isArray(msg.content)) {
      const tb = msg.content.find((c) => c && c.type === 'text' && c.text && c.text.trim());
      if (tb) lastTextBlock = tb;
    }
  }

  if (lastTextBlock) {
    stats.hasText = true;
    const picked = pickSummaryFromText(lastTextBlock.text);
    stats.summary = picked.replace(/[\r\n\s]+/g, ' ').trim();
  }
  return stats;
}

function calcCost(stats) {
  return (
    (stats.input * PRICE_PER_M.input) / 1_000_000 +
    (stats.output * PRICE_PER_M.output) / 1_000_000 +
    (stats.cache_read * PRICE_PER_M.cache_read) / 1_000_000 +
    (stats.cache_write * PRICE_PER_M.cache_write) / 1_000_000
  );
}

function formatTokens(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function formatCost(usd) {
  if (usd < 0.01) return '$' + usd.toFixed(4);
  return '$' + usd.toFixed(3);
}

function truncate(s, n) {
  const chars = Array.from(s);
  return chars.length > n ? chars.slice(0, n).join('') + '…' : s;
}

function debugLog(raw, payload, resolved) {
  try {
    const lam = payload && payload.last_assistant_message;
    const lamPeek = lam ? {
      has_content: !!lam.content,
      content_type: Array.isArray(lam.content) ? 'array' : typeof lam.content,
      content_block_types: Array.isArray(lam.content) ? lam.content.map((c) => c && c.type) : null,
      first_text_head: Array.isArray(lam.content)
        ? (lam.content.find((c) => c && c.type === 'text') || {}).text?.slice(0, 120)
        : (typeof lam.content === 'string' ? lam.content.slice(0, 120) : null),
      has_usage: !!lam.usage,
      usage: lam.usage || null,
    } : null;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      raw_len: raw.length,
      payload_keys: Object.keys(payload || {}),
      lam_peek: lamPeek,
      resolved,
    }) + '\n';
    fs.appendFileSync(path.join(CLAUDE_HOME, 'lbl-end-debug.log'), line);
  } catch {}
}

// 优先从 hook payload 的 last_assistant_message 拿 text + usage（CC 官方注入，最准）
function statsFromLastAssistantMessage(msg) {
  const stats = { input: 0, output: 0, cache_read: 0, cache_write: 0, hasText: false, summary: '', userInput: '' };
  if (!msg) return stats;
  // msg.content 是 content blocks 数组
  if (Array.isArray(msg.content)) {
    const tb = msg.content.find((c) => c && c.type === 'text' && c.text && c.text.trim());
    if (tb) {
      stats.hasText = true;
      const picked = pickSummaryFromText(tb.text);
      stats.summary = picked.replace(/[\r\n\s]+/g, ' ').trim();
    }
  } else if (typeof msg.content === 'string' && msg.content.trim()) {
    stats.hasText = true;
    const picked = pickSummaryFromText(msg.content);
    stats.summary = picked.replace(/[\r\n\s]+/g, ' ').trim();
  }
  if (msg.usage) {
    stats.input = msg.usage.input_tokens || 0;
    stats.output = msg.usage.output_tokens || 0;
    stats.cache_read = msg.usage.cache_read_input_tokens || 0;
    stats.cache_write = msg.usage.cache_creation_input_tokens || 0;
  }
  return stats;
}

async function gatherContext() {
  const raw = await readStdin();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch {}

  const sessionId = payload.session_id || payload.sessionId || '';
  const cwd = payload.cwd || payload.workingDirectory || process.cwd();
  const transcriptHint = payload.transcript_path || payload.transcriptPath;

  const sessionName =
    findSessionName(sessionId) ||
    `${path.basename(cwd) || 'unknown'}:${sessionId.slice(0, 8) || '???'}`;

  const transcriptPath = findTranscript(sessionId, transcriptHint);

  // 1) 优先用 hook payload 自带的 last_assistant_message（CC 直接给的最准数据）
  let stats = statsFromLastAssistantMessage(payload.last_assistant_message);

  // 2) 不管 1) 拿没拿到，都尝试从 transcript 取 userInput + 累加整 turn 的 usage
  if (transcriptPath) {
    try {
      const lines = fs.readFileSync(transcriptPath, 'utf8').trim().split(/\r?\n/);
      const turnStats = gatherTurnStats(lines);
      // userInput 必须从 transcript 拿
      stats.userInput = turnStats.userInput || stats.userInput;
      // 如果 1) 没拿到 hasText/summary（payload 里没 last_assistant_message），回退用 transcript 的
      if (!stats.hasText && turnStats.hasText) {
        stats.hasText = true;
        stats.summary = turnStats.summary;
      }
      // usage 用整 turn 累加值（更准），但 1) 拿到了就以 1) 为准（避免重复累加）
      if (!stats.input && !stats.output) {
        stats.input = turnStats.input;
        stats.output = turnStats.output;
        stats.cache_read = turnStats.cache_read;
        stats.cache_write = turnStats.cache_write;
      }
    } catch {}
  }

  const summary = truncate(stats.summary, MAX_SUMMARY_CHARS);
  const cost = calcCost(stats);
  const statsLine =
    `📊 输入 ${formatTokens(stats.input)} / 输出 ${formatTokens(stats.output)}` +
    ` / 缓存读 ${formatTokens(stats.cache_read)} / 花费 ${formatCost(cost)}`;

  const result = {
    sessionId, cwd, sessionName, summary, transcriptPath,
    hasText: stats.hasText, stats, cost, statsLine,
    userInput: stats.userInput || '',
  };
  debugLog(raw, payload, { ...result, transcriptPath: !!transcriptPath });
  return result;
}

module.exports = { gatherContext, MAX_SUMMARY_CHARS, PRICE_PER_M };