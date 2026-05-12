#!/usr/bin/env node
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_HOME = path.join(os.homedir(), '.claude');
const MAX_SUMMARY_CHARS = 25;

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

function extractSummary(transcriptPath) {
  if (!transcriptPath) return '无文本回复';
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, 'utf8').trim().split(/\r?\n/);
  } catch {
    return '读取 transcript 失败';
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    let obj;
    try { obj = JSON.parse(lines[i]); } catch { continue; }
    if (obj.type !== 'assistant' || !obj.message || !Array.isArray(obj.message.content)) continue;
    const textBlock = obj.message.content.find((c) => c && c.type === 'text' && c.text);
    if (textBlock) {
      const cleaned = textBlock.text.replace(/[\r\n\s]+/g, ' ').trim();
      if (cleaned) return cleaned;
    }
  }
  return '无文本回复';
}

function truncate(s, n) {
  const chars = Array.from(s);
  return chars.length > n ? chars.slice(0, n).join('') + '…' : s;
}

function sendToast(title, message) {
  const escape = (s) => String(s).replace(/'/g, "''");
  const ps = `
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime];
$tpl = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);
$texts = $tpl.GetElementsByTagName('text');
[void]$texts.Item(0).AppendChild($tpl.CreateTextNode('${escape(title)}'));
[void]$texts.Item(1).AppendChild($tpl.CreateTextNode('${escape(message)}'));
$toast = [Windows.UI.Notifications.ToastNotification]::new($tpl);
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Claude').Show($toast);
Start-Sleep -Seconds 1;
`.replace(/\s*\r?\n\s*/g, ' ');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], (err) => {
      if (err) console.error('[lbl-end-notify] toast 失败:', err.message);
      resolve();
    });
  });
}

(async () => {
  const raw = await readStdin();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch {}

  const sessionId = payload.session_id || payload.sessionId || '';
  const cwd = payload.cwd || process.cwd();
  const transcriptHint = payload.transcript_path;

  const sessionName =
    findSessionName(sessionId) ||
    `${path.basename(cwd) || 'unknown'}:${sessionId.slice(0, 8) || '???'}`;

  const transcriptPath = findTranscript(sessionId, transcriptHint);
  const summary = truncate(extractSummary(transcriptPath), MAX_SUMMARY_CHARS);

  await sendToast(`爹，干完了：${sessionName}`, summary);
})();