# -*- coding: utf-8 -*-
"""
【AI逻辑总结】
在 myfeatrue 目录下创建 issue 文件夹和需求描述文件：
1. 让用户输入 issue 标题和描述
2. 在 myfeatrue/ 下创建文件夹，命名：YYMMDD-issue标题
3. 在文件夹内创建 原始需求.txt，写入用户输入的描述内容
"""

import os
import re
import sys
from datetime import datetime

MYFEATRUE_DIR = os.path.dirname(os.path.abspath(__file__))


def sanitize_folder_name(name):
    """去掉文件名中不允许的特殊字符，保留中文、英文、数字、横杠、下划线"""
    name = re.sub(r'[\\/:*?"<>|]', '', name)
    return name.strip()


def main():
    print("=" * 40)
    print("创建 Issue 需求文件夹")
    print("=" * 40)

    # 输入标题
    print("\n请输入 issue 标题：")
    while True:
        title = input("> ").strip()
        if title:
            break
        print("标题不能为空，请重新输入：")

    # 输入描述（支持多行，空行结束）
    print("\n请输入 issue 描述（输入完成后连按两次回车结束）：")
    lines = []
    empty_count = 0
    while True:
        line = input()
        if line == "":
            empty_count += 1
            if empty_count >= 2:
                break
            lines.append("")
        else:
            empty_count = 0
            lines.append(line)

    # 去掉末尾多余空行
    while lines and lines[-1] == "":
        lines.pop()
    description = "\n".join(lines)

    # 生成文件夹名: YYMMDD-标题
    date_prefix = datetime.now().strftime("%y%m%d")
    folder_name = sanitize_folder_name(f"{date_prefix}-{title}")
    folder_path = os.path.join(MYFEATRUE_DIR, folder_name)

    if os.path.exists(folder_path):
        print(f"\n警告：文件夹 {folder_name} 已存在")
        confirm = input("是否继续并覆盖描述文件？(y/N) > ").strip().lower()
        if confirm != "y":
            print("已取消操作")
            sys.exit(0)

    os.makedirs(folder_path, exist_ok=True)

    # 写入需求文件
    file_path = os.path.join(folder_path, "原始需求.txt")
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(f"标题：{title}\n")
        f.write(f"创建时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}\n")
        f.write("=" * 40 + "\n\n")
        f.write(description)
        f.write("\n")

    print("\n" + "=" * 40)
    print(f"已创建文件夹: {folder_name}")
    print(f"已创建文件: 原始需求.txt")
    print(f"路径: {folder_path}")
    print("=" * 40)

    input("\n按回车键退出...")


if __name__ == "__main__":
    main()
