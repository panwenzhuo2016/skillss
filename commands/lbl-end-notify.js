#!/usr/bin/env node
const { execFile } = require('child_process');
const { gatherContext } = require('./lbl-end-shared');

function sendToast(title, line2, line3) {
  const escape = (s) => String(s).replace(/'/g, "''");
  // ToastText04: 标题 + 两行内容
  const ps = `
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime];
$tpl = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText04);
$texts = $tpl.GetElementsByTagName('text');
[void]$texts.Item(0).AppendChild($tpl.CreateTextNode('${escape(title)}'));
[void]$texts.Item(1).AppendChild($tpl.CreateTextNode('${escape(line2)}'));
[void]$texts.Item(2).AppendChild($tpl.CreateTextNode('${escape(line3)}'));
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

function truncateChars(s, n) {
  const chars = Array.from(String(s || ''));
  return chars.length > n ? chars.slice(0, n).join('') + '…' : chars.join('');
}

(async () => {
  const ctx = await gatherContext();
  const summary = ctx.hasText ? `「${truncateChars(ctx.summary, 100)}」` : '（无文本回复 / 仅工具调用）';
  const inputLine = `「${truncateChars(ctx.userInput, 25)}」`;
  await sendToast(`爹，干完了：${ctx.sessionName}`, `${inputLine} → ${summary}`, ctx.statsLine);
})();