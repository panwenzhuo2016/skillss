#!/usr/bin/env node
const { execFile } = require('child_process');

const [, , ...args] = process.argv;
const title = args[0] || '通知';
const message = args.slice(1).join(' ') || '内容为空';

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

execFile(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
  (err, stdout, stderr) => {
    if (err) {
      console.error('[notify] 失败:', stderr || err.message);
      process.exit(1);
    }
    console.log(`[notify] 已发送: ${title} - ${message}`);
  }
);