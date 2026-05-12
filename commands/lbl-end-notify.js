#!/usr/bin/env node
const { execFile } = require('child_process');
const { gatherContext } = require('./_lbl-end-shared');

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
  const { sessionName, summary } = await gatherContext();
  await sendToast(`爹，干完了：${sessionName}`, summary);
})();