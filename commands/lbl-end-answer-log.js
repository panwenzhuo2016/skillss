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
  body { font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 1100px; margin: 0 auto; padding: 16px; background: #fafafa; color: #222; }
  h1 { font-size: 18px; margin: 8px 0 16px; }
  .entry { background: #fff; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .entry-head { font-size: 12px; color: #666; margin-bottom: 8px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; border-bottom: 1px solid #eee; padding-bottom: 6px; }
  .entry-head .session { font-weight: 600; color: #333; }
  .entry-section { margin: 6px 0; }
  .entry-label { font-weight: 600; color: #555; font-size: 12px; margin-bottom: 2px; }
  .entry-content { white-space: pre-wrap; word-wrap: break-word; line-height: 1.55; font-size: 14px; }
  .entry-summary { color: #058a5a; }
  .entry-no-reply { color: #c00; font-style: italic; }
  .entry-stats { color: #999; font-size: 12px; }
</style>
</head>
<body>
<h1>Claude 回答记录</h1>
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

function buildEntry(ctx) {
  const time = fmtTime(new Date());
  const userInput = ctx.userInput || '(未捕获到用户输入)';
  const summaryHtml = ctx.hasText
    ? `<div class="entry-content entry-summary">${escapeHtml(ctx.summary || '(总结为空)')}</div>`
    : `<div class="entry-content entry-no-reply">（无文本回复，未发通知）</div>`;
  return `<div class="entry">
  <div class="entry-head">
    <span><span class="session">${escapeHtml(ctx.sessionName)}</span> · ${escapeHtml(time)}</span>
    <span class="entry-stats">${escapeHtml(ctx.statsLine)}</span>
  </div>
  <div class="entry-section">
    <div class="entry-label">我的输入</div>
    <div class="entry-content">${escapeHtml(userInput)}</div>
  </div>
  <div class="entry-section">
    <div class="entry-label">总结</div>
    ${summaryHtml}
  </div>
</div>
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