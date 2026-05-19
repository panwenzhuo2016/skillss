# 【AI逻辑总结】
# Claude Code Stop hook：会话结束时弹 Windows toast 通知。
# ① 调用 lbl_end_shared.gather_context() 获取本次回答的总结、token 统计
# ② 拼装 PowerShell ToastText04 脚本，通过 subprocess 调用 powershell.exe 弹通知
# ③ 通知标题含 session 名称，正文含用户输入摘要 → Claude 回答总结 + token 花费

import subprocess
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lbl_end_shared import gather_context


def truncate_chars(s: str, n: int) -> str:
    chars = list(str(s or ""))
    return "".join(chars[:n]) + "…" if len(chars) > n else "".join(chars)


def escape_ps(s: str) -> str:
    return str(s).replace("'", "''")


def send_toast(title: str, line2: str, line3: str):
    ps = (
        "[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]; "
        "$tpl = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText04); "
        "$texts = $tpl.GetElementsByTagName('text'); "
        f"[void]$texts.Item(0).AppendChild($tpl.CreateTextNode('{escape_ps(title)}')); "
        f"[void]$texts.Item(1).AppendChild($tpl.CreateTextNode('{escape_ps(line2)}')); "
        f"[void]$texts.Item(2).AppendChild($tpl.CreateTextNode('{escape_ps(line3)}')); "
        "$toast = [Windows.UI.Notifications.ToastNotification]::new($tpl); "
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Claude').Show($toast); "
        "Start-Sleep -Seconds 1;"
    )
    try:
        subprocess.run(
            ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
            timeout=10,
            capture_output=True,
        )
    except Exception as e:
        print(f"[lbl-end-notify] toast 失败: {e}", file=sys.stderr)


def main():
    ctx = gather_context()
    summary = f"「{truncate_chars(ctx['summary'], 100)}」" if ctx["hasText"] else "（无文本回复 / 仅工具调用）"
    input_line = f"「{truncate_chars(ctx['userInput'], 25)}」"
    send_toast(f"爹，干完了：{ctx['sessionName']}", f"{input_line} → {summary}", ctx["statsLine"])


if __name__ == "__main__":
    main()
