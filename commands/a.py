# 【AI逻辑总结】
# 读取当天 claude-answer-all-YYYYMMDD.html 文件，
# 提取所有包含「本次回答花费」的行中的美元金额，
# 累加并打印每条匹配行与总计花费。

import os
from datetime import date
from pathlib import Path

file_path = Path.home() / ".claude" / "commands" / f"claude-answer-all-{date.today().strftime('%Y%m%d')}.html"

content = file_path.read_text(encoding="utf-8")

total = 0.0
for line in content.splitlines():
    if "本次回答花费" in line:
        start = line.find(" $")
        end = line.find("</span>")
        if start != -1 and end != -1 and end > start:
            try:
                total += float(line[start + 2:end])
            except ValueError:
                pass
        print(line)

print(total)
