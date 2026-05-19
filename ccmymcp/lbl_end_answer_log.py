# 【AI逻辑总结】
# Claude Code Stop hook：会话结束时将本次问答记录追加到当日 HTML 日志文件。
# ① 调用 lbl_end_shared.gather_context() 获取总结、token 统计
# ② 如果当日 HTML 文件不存在则创建（含 head 引用 claude-answer-all.css）
# ③ 将一条 <article> 追加到 HTML 文件，包含 session 名称、token 数、花费、用户输入、Claude 回答

import sys
import os
import html
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lbl_end_shared import gather_context

SCRIPT_DIR = Path(__file__).parent
now = datetime.now()

HTML_PATH = SCRIPT_DIR / f"claude-answer-all-{now.strftime('%Y%m%d')}.html"

HTML_HEAD = """<!doctype html>
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
"""


def fmt_time(d: datetime) -> str:
    return d.strftime("%Y-%m-%d %H:%M:%S")


def fmt_tokens(n: int) -> str:
    if n >= 1000:
        return f"{n / 1000:.1f}k"
    return str(n)


def fmt_cost(usd: float) -> str:
    if usd < 0.01:
        return f"${usd:.4f}"
    return f"${usd:.3f}"


def build_entry(ctx: dict) -> str:
    time_str = fmt_time(datetime.now())
    s = ctx.get("stats") or {}
    user_input = html.escape(ctx.get("userInput") or "(未捕获到用户输入)")

    if ctx.get("hasText"):
        turn_bot = (
            '<div class="turn bot">\n'
            '    <span class="turn-tag">Claude code</span>\n'
            f'    <div class="turn-body">{html.escape(ctx.get("summary") or "(总结为空)")}</div>\n'
            '  </div>'
        )
    else:
        turn_bot = (
            '<div class="turn empty">\n'
            '    <span class="turn-tag">Claude code</span>\n'
            '    <div class="turn-body">（无文本回复 / 仅工具调用）</div>\n'
            '  </div>'
        )

    return (
        '<article class="entry">\n'
        '  <div class="entry-head">\n'
        f'    <span class="chip session">\U0001f4dd {html.escape(ctx.get("sessionName", ""))}</span>\n'
        '    <span class="spacer"></span>\n'
        f'    <span class="chip" title="非缓存输入 token">⬇ {html.escape(fmt_tokens(s.get("input", 0)))}</span>\n'
        f'    <span class="chip" title="输出 token">⬆ {html.escape(fmt_tokens(s.get("output", 0)))}</span>\n'
        f'    <span class="chip" title="缓存读 token">\U0001f4be {html.escape(fmt_tokens(s.get("cache_read", 0)))}</span>\n'
        f'    <span class="chip cost" title="本次回答花费 USD">\U0001f4b0 {html.escape(fmt_cost(ctx.get("cost", 0)))}</span>\n'
        f'    <span class="chip time">{html.escape(time_str)}</span>\n'
        '  </div>\n'
        '  <div class="turn user">\n'
        '    <span class="turn-tag">我</span>\n'
        f'    <div class="turn-body">{user_input}</div>\n'
        '  </div>\n'
        f'  {turn_bot}\n'
        '</article>\n'
    )


def main():
    ctx = gather_context()
    if not HTML_PATH.exists():
        HTML_PATH.write_text(HTML_HEAD, encoding="utf-8")
    with open(HTML_PATH, "a", encoding="utf-8") as f:
        f.write(build_entry(ctx))
    print(f"[lbl-end-answer-log] 已追加到 {HTML_PATH}")


if __name__ == "__main__":
    main()
