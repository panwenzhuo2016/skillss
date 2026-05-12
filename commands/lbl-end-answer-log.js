#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { gatherContext } = require('./lbl-end-shared');

const HTML_PATH = path.join(__dirname, 'claude-answer-all.html');

const HTML_HEAD = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>Claude 回答记录</title>
<style>
  :root {
    --bg: #f7f8fa;
    --card: #ffffff;
    --text: #1f2328;
    --text-soft: #57606a;
    --text-muted: #8c959f;
    --border: #d8dee4;
    --accent: #0969da;
    --green: #1a7f37;
    --red: #cf222e;
    --code-bg: #f6f8fa;
    --shadow: 0 1px 0 rgba(27,31,36,.04), 0 4px 12px rgba(27,31,36,.04);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117;
      --card: #161b22;
      --text: #e6edf3;
      --text-soft: #9198a1;
      --text-muted: #6e7681;
      --border: #30363d;
      --accent: #58a6ff;
      --green: #3fb950;
      --red: #f85149;
      --code-bg: #1c2128;
      --shadow: 0 1px 0 rgba(0,0,0,.2), 0 4px 12px rgba(0,0,0,.3);
    }
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", sans-serif;
    max-width: 980px;
    margin: 0 auto;
    padding: 24px 16px 80px;
    background: var(--bg);
    color: var(--text);
    line-height: 1.55;
    font-size: 14px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 20px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
  header h1 { font-size: 18px; margin: 0; font-weight: 600; }
  header .hint { color: var(--text-muted); font-size: 12px; }
  .entry {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    margin-bottom: 14px;
    overflow: hidden;
    transition: transform .12s, box-shadow .12s;
  }
  .entry:hover { box-shadow: var(--shadow); }
  .entry-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    padding: 10px 14px;
    background: var(--code-bg);
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 12px;
    background: var(--card);
    border: 1px solid var(--border);
    color: var(--text-soft);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .chip.session { color: var(--accent); border-color: var(--accent); font-weight: 500; }
  .chip.cost { color: var(--green); border-color: var(--green); }
  .chip.time { color: var(--text-muted); }
  .spacer { flex: 1; }
  .turn {
    display: flex;
    gap: 12px;
    padding: 12px 16px;
  }
  .turn + .turn { border-top: 1px dashed var(--border); }
  .turn-icon {
    flex-shrink: 0;
    width: 28px; height: 28px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px;
    font-weight: 600;
  }
  .turn.user .turn-icon { background: rgba(9, 105, 218, .12); color: var(--accent); }
  .turn.bot  .turn-icon { background: rgba(26, 127, 55, .12); color: var(--green); }
  .turn.empty .turn-icon { background: rgba(207, 34, 46, .12); color: var(--red); }
  .turn-body {
    flex: 1;
    min-width: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .turn-label {
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: .5px;
  }
  .turn.empty .turn-body { color: var(--red); font-style: italic; }
  code {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace;
    background: var(--code-bg);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 13px;
    border: 1px solid var(--border);
  }
</style>
</head>
<body>
<header>
  <h1>Claude 回答记录</h1>
  <span class="hint">由 lbl-end-answer-log 自动追加</span>
</header>
`;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtTime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtTokens(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function fmtCost(usd) {
  if (usd < 0.01) return '$' + usd.toFixed(4);
  return '$' + usd.toFixed(3);
}

function buildEntry(ctx) {
  const time = fmtTime(new Date());
  const s = ctx.stats || {};
  const userInput = ctx.userInput || '(未捕获到用户输入)';
  const turnBot = ctx.hasText
    ? `<div class="turn bot">
    <div class="turn-icon">C</div>
    <div class="turn-body">
      <div class="turn-label">总结</div>
      ${escapeHtml(ctx.summary || '(总结为空)')}
    </div>
  </div>`
    : `<div class="turn empty">
    <div class="turn-icon">·</div>
    <div class="turn-body">
      <div class="turn-label">总结</div>
      （无文本回复 / 仅工具调用）
    </div>
  </div>`;
  return `<article class="entry">
  <div class="entry-head">
    <span class="chip session">📝 ${escapeHtml(ctx.sessionName)}</span>
    <span class="spacer"></span>
    <span class="chip" title="非缓存输入 token">⬇ ${escapeHtml(fmtTokens(s.input || 0))}</span>
    <span class="chip" title="输出 token">⬆ ${escapeHtml(fmtTokens(s.output || 0))}</span>
    <span class="chip" title="缓存读 token">💾 ${escapeHtml(fmtTokens(s.cache_read || 0))}</span>
    <span class="chip cost" title="本次回答花费 USD">💰 ${escapeHtml(fmtCost(ctx.cost || 0))}</span>
    <span class="chip time">${escapeHtml(time)}</span>
  </div>
  <div class="turn user">
    <div class="turn-icon">我</div>
    <div class="turn-body">
      <div class="turn-label">输入</div>
      ${escapeHtml(userInput)}
    </div>
  </div>
  ${turnBot}
</article>
`;
}

(async () => {
  const ctx = await gatherContext();
  if (!fs.existsSync(HTML_PATH)) {
    fs.writeFileSync(HTML_PATH, HTML_HEAD, 'utf8');
  }
  fs.appendFileSync(HTML_PATH, buildEntry(ctx), 'utf8');
  console.log('[lbl-end-answer-log] 已追加到', HTML_PATH);
})();
