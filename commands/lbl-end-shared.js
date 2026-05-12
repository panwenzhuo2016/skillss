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

// 倒推 transcript，从最后一条真实 user message 之后累加所有 assistant 的 usage
function gatherTurnStats(lines) {
  const stats = { input: 0, output: 0, cache_read: 0, cache_write: 0, hasText: false, summary: '' };
  // 第一步：找出"本回合"起点（最后一条真实 user message 之后）
  let turnStartIdx = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    let obj;
    try { obj = JSON.parse(lines[i]); } catch { continue; }
    if (isRealUserMessage(obj)) { turnStartIdx = i + 1; break; }
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
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      raw_len: raw.length,
      raw_head: raw.slice(0, 300),
      payload_keys: Object.keys(payload || {}),
      resolved,
    }) + '\n';
    fs.appendFileSync(path.join(CLAUDE_HOME, 'lbl-end-debug.log'), line);
  } catch {}
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

  let stats = { input: 0, output: 0, cache_read: 0, cache_write: 0, hasText: false, summary: '' };
  if (transcriptPath) {
    try {
      const lines = fs.readFileSync(transcriptPath, 'utf8').trim().split(/\r?\n/);
      stats = gatherTurnStats(lines);
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
  };
  debugLog(raw, payload, { ...result, transcriptPath: !!transcriptPath });
  return result;
}

module.exports = { gatherContext, MAX_SUMMARY_CHARS, PRICE_PER_M };