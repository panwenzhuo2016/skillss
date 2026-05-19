# -*- coding: utf-8 -*-
"""
【AI逻辑总结】
collabspace-server 创建 MR 到 master 的自动化脚本：
1. 获取当前分支名，校验不能是 master/testserver
2. 通过 GitLab API 查询是否已存在 source→master 的开放 MR
3. 已存在则直接打印 MR 链接，不存在则让用户输入标题后创建
4. Token 优先从环境变量 GITLAB_PRIVATE_TOKEN 读取，没有则提示输入
"""

import os
import sys
import ssl
import subprocess
import json
import urllib.request
import urllib.parse
import urllib.error

GITLAB_URL = "https://pt-gitlab.yottastudios.com"
server = "collabspace-server"
PROJECT_PATH = "px/collabspace/%s" % server
TARGET_BRANCH = "master"
ov = 'V2urWC47LY_z3scMv-ov'
PROJECT_PATH_ENCODED = urllib.parse.quote(PROJECT_PATH, safe="")

SERVER_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", server))

# 跳过 SSL 验证（内部 GitLab 自签名证书）
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE


def run_git(args, cwd=SERVER_DIR):
    """执行 git 命令，失败时打印错误并退出"""
    result = subprocess.run(["git"] + args, cwd=cwd, capture_output=True, text=True, encoding="utf-8")
    if result.returncode != 0:
        print(f"错误：git {' '.join(args)} 失败")
        if result.stderr:
            print(result.stderr.strip())
        sys.exit(1)
    return result.stdout.strip()


def gitlab_api(method, endpoint, token, data=None):
    """调用 GitLab API，返回 JSON 响应"""
    url = f"{GITLAB_URL}/api/v4{endpoint}"
    headers = {"PRIVATE-TOKEN": token}

    body = None
    if data:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, context=SSL_CTX) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        print(f"GitLab API 错误 ({e.code}): {error_body}")
        sys.exit(1)


def get_token():
    """从环境变量读取 token，没有则提示输入"""
    return ov


def main():
    print("=" * 50)
    print("创建 MR: %s → %s" % (server, TARGET_BRANCH))
    print("=" * 50)

    token = get_token()

    # 获取当前分支
    source_branch = run_git(["rev-parse", "--abbrev-ref", "HEAD"])
    print(f"\n当前分支: {source_branch}")

    if source_branch in (("%s" % TARGET_BRANCH), "testserver"):
        print(f"错误：当前在 {source_branch} 分支上，不能创建 MR")
        sys.exit(1)

    # [1/2] 检查是否已存在 MR（所有状态）
    print("\n[1/2] 检查是否已存在 MR...")
    endpoint = f"/projects/{PROJECT_PATH_ENCODED}/merge_requests"
    params = urllib.parse.urlencode({
        "source_branch": source_branch,
        "target_branch": TARGET_BRANCH,
    })
    existing = gitlab_api("GET", f"{endpoint}?{params}", token)

    if existing:
        mr = existing[0]
        state = mr["state"]
        print("\n" + "=" * 50)
        if state == "merged":
            print(f"该分支的 MR 已合并，无需重复创建：")
        elif state == "opened":
            print(f"已存在未合并的 MR，无需创建：")
        elif state == "closed":
            print(f"该分支的 MR 已关闭（可手动重新打开）：")
        else:
            print(f"已存在 MR（状态: {state}）：")
        print(f"  标题: {mr['title']}")
        print(f"  状态: {state}")
        print(f"  链接: {mr['web_url']}")
        print("=" * 50)
        sys.exit(0)

    # [2/2] 创建 MR
    print("未找到已存在的 MR，准备创建...")

    default_title = source_branch.replace("feature/", "")
    print(f"\n请输入 MR 标题（回车使用默认: {default_title}）：")
    title_input = input("> ").strip()
    title = title_input if title_input else default_title

    print(f"\n[2/2] 创建 MR: {source_branch} → {TARGET_BRANCH}...")
    mr = gitlab_api("POST", endpoint, token, {
        "source_branch": source_branch,
        "target_branch": TARGET_BRANCH,
        "title": title,
    })

    print("\n" + "=" * 50)
    print("MR 创建成功！")
    print(f"  标题: {mr['title']}")
    print(f"  链接: {mr['web_url']}")
    print("=" * 50)

    sys.exit(0)


if __name__ == "__main__":
    main()
