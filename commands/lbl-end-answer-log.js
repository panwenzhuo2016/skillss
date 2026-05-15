#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { gatherContext } = require('./lbl-end-shared');

const now = new Date();

const year = now.getFullYear();
const month = String(now.getMonth() + 1).padStart(2, '0');
const day = String(now.getDate()).padStart(2, '0');

const HTML_PATH = path.join(
    __dirname,
    `claude-answer-all-${year}${month}${day}.html`
);

const HTML_HEAD = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>Claude 回答记录</title>
<link rel="stylesheet" href="claude-answer-all.css">
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
    <span class="turn-tag">Claude code</span>
    <div class="turn-body">${escapeHtml(ctx.summary || '(总结为空)')}</div>
  </div>`
    : `<div class="turn empty">
    <span class="turn-tag">Claude code</span>
    <div class="turn-body">（无文本回复 / 仅工具调用）</div>
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
    <span class="turn-tag">我</span>
    <div class="turn-body">${escapeHtml(userInput)}</div>
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
