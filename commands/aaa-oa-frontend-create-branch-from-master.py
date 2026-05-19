# -*- coding: utf-8 -*-
"""
【AI逻辑总结】
从 master 创建 oa-frontend feature 分支的自动化脚本：
1. 切到 oa-frontend 目录，切换 master 并拉取最新
2. 等待用户输入分支名（数字-英文格式，如 001-login-page）
3. 自动生成完整分支名：feature/日期-输入名
4. 创建本地分支并推送到远程仓库
"""

import os
import re
import sys
import subprocess
from datetime import datetime

OA_FRONTEND_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "oa-frontend"))


def run_git(args, cwd=OA_FRONTEND_DIR):
    """执行 git 命令，失败时打印错误并退出"""
    result = subprocess.run(["git"] + args, cwd=cwd, capture_output=True, text=True, encoding="utf-8")
    if result.returncode != 0:
        print(f"错误：git {' '.join(args)} 失败")
        if result.stderr:
            print(result.stderr.strip())
        sys.exit(1)
    return result.stdout.strip()


def main():
    print("=" * 40)
    print("从 master 创建 feature 分支 (oa-frontend)")
    print("=" * 40)

    # [1/5] 切换到 master
    print("\n[1/5] 切换到 master 分支...")
    run_git(["checkout", "master"])

    # [2/5] 更新 master
    print("\n[2/5] 更新 master 分支...")
    run_git(["pull", "origin", "master"])

    print("\n" + "=" * 40)
    print("master 已更新到最新")
    print("=" * 40)

    # [3/5] 等待用户输入分支名
    print("\n请输入分支名（数字-英文格式，如: 001-login-page）：")
    while True:
        branch_input = input("> ").strip()
        if not branch_input:
            print("分支名不能为空，请重新输入：")
            continue
        if not re.match(r'^[0-9]+[-a-zA-Z0-9_]+$', branch_input):
            print("格式不对，需要 数字-英文 格式（如 001-login-page），请重新输入：")
            continue
        break

    # 生成完整分支名: feature/YYMMDD-输入名
    date_prefix = datetime.now().strftime("%y%m%d")
    full_branch = f"feature/{date_prefix}-{branch_input}"
    print(f"\n将创建分支: {full_branch}")

    # [4/5] 创建本地分支
    print(f"\n[4/5] 创建本地分支 {full_branch}...")
    run_git(["checkout", "-b", full_branch])

    # [5/5] 推送到远程
    print(f"\n[5/5] 推送 {full_branch} 到远程仓库...")
    run_git(["push", "-u", "origin", full_branch])

    print("\n" + "=" * 40)
    print(f"分支 {full_branch} 已创建并推送到远程")
    print("当前已切换到该分支，可以开始开发了")
    print("=" * 40)

    input("\n按回车键退出...")


if __name__ == "__main__":
    main()
