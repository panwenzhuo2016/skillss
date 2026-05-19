# -*- coding: utf-8 -*-
"""
【AI逻辑总结】
把 oa-frontend 当前分支合并到 staging 的自动化脚本：
1. 切到 oa-frontend 目录，获取当前分支名
2. 校验不能在 staging 分支上执行
3. 切换 staging → 拉取最新 → 合并当前分支 → 推送 → 切回原分支
4. 每步都有错误检测，失败即停
"""

import os
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
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    print("=" * 40)
    print(f"当前时间: {stamp}")
    print("合并当前分支到 staging")
    print("=" * 40)

    # 获取当前分支名
    source_branch = run_git(["rev-parse", "--abbrev-ref", "HEAD"])
    print(f"\n当前分支: {source_branch}")

    if source_branch == "staging":
        print("错误：当前已在 staging 分支，无需合并")
        sys.exit(1)

    # [1/6] 切换到 staging
    print("\n[1/6] 切换到 staging 分支...")
    run_git(["checkout", "staging"])

    # [2/6] 更新 staging
    print("\n[2/6] 更新 staging 分支...")
    run_git(["pull", "origin", "staging"])

    # [3/6] 合并
    print(f"\n[3/6] 合并 {source_branch} 到 staging...")
    merge_result = subprocess.run(
        ["git", "merge", source_branch, "--no-edit"],
        cwd=OA_FRONTEND_DIR, capture_output=True, text=True, encoding="utf-8",
    )
    if merge_result.returncode != 0:
        print()
        print("=" * 40)
        print("错误：合并存在冲突，已中止操作")
        print("请手动解决冲突后再提交")
        print("=" * 40)
        sys.exit(1)
    if merge_result.stdout:
        print(merge_result.stdout.strip())

    # [4/6] 推送
    print("\n[4/6] 推送 staging 分支到远程...")
    run_git(["push", "origin", "staging"])

    # [5/6] 切回原分支
    print(f"\n[5/6] 切换回 {source_branch} 分支...")
    run_git(["checkout", source_branch])

    # [6/6] 完成
    print("\n[6/6] 操作完成！")
    print()
    print("=" * 40)
    print(f"已将 {source_branch} 合并到 staging")
    print("已推送 staging 到远程仓库")
    print(f"已切换回 {source_branch} 分支")
    print("=" * 40)

    sys.exit(0)


if __name__ == "__main__":
    main()
