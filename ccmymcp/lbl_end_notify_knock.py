# 【AI逻辑总结】
# Claude Code Stop hook：会话结束时通过 Knock 群机器人发送富文本消息。
# ① 调用 lbl_end_shared.gather_context() 获取本次回答的总结、token 统计
# ② 用 MD5 签名构造请求体，POST 到 oa-chn.xinyoudi.com 的 Knock API
# ③ 消息内容包含用户输入摘要、Claude 回答总结、token 花费统计

import sys
import os
import json
import hashlib
import urllib.request
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lbl_end_shared import gather_context

KNOCK_URL = "http://oa-chn.xinyoudi.com/third-api/request"
CLIENT_ID = "apitable"
CLIENT_SECRET = "0977ad6723022fbebd8d5566140f5c14"
MSG_TYPE = "knock_send_grt_msg"
GROUP_TOKEN = "GRT:97aEBC04OFz8"
NICKNAME = "罗贝林"


def sign(payload_str: str) -> str:
    params = {
        "api_secret": CLIENT_SECRET,
        "client_id": CLIENT_ID,
        "key": MSG_TYPE,
        "payload": payload_str,
    }
    s = "&".join(f"{k}={params[k]}" for k in sorted(params.keys()))
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def post_knock(req_body: str) -> str:
    data = req_body.encode("utf-8")
    req = urllib.request.Request(
        KNOCK_URL,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"[knock] HTTP {e.code} {body}", file=sys.stderr)
        raise
    except Exception as e:
        print(f"[knock] err: {e}", file=sys.stderr)
        raise


def send_group_rich(title: str, content: str) -> str:
    rich_content = json.dumps({"title": title, "content": content}, ensure_ascii=False)
    payload_obj = {
        "nicknames": [NICKNAME],
        "content": rich_content,
        "msg_type": "MSG_TYPE_RICH_CARD",
        "group_robot_token": GROUP_TOKEN,
    }
    payload_str = json.dumps(payload_obj, ensure_ascii=False)
    req_body = json.dumps({
        "client_id": CLIENT_ID,
        "key": MSG_TYPE,
        "payload": payload_str,
        "sign": sign(payload_str),
    }, ensure_ascii=False)
    return post_knock(req_body)


def truncate_chars(s: str, n: int) -> str:
    chars = list(str(s or ""))
    return "".join(chars[:n]) + "…" if len(chars) > n else "".join(chars)


def main():
    ctx = gather_context()
    summary_line = f"「{truncate_chars(ctx['summary'], 100)}」" if ctx["hasText"] else "（无文本回复 / 仅工具调用）"
    input_line = f"> 我说：{truncate_chars(ctx['userInput'], 25)}"
    try:
        content = input_line + "\n\n" + summary_line + "\n\n" + ctx["statsLine"]
        resp = send_group_rich(f"爹，干完了：{ctx['sessionName']}", content)
        print(f"[knock] ok: {resp}")
    except Exception as e:
        print(f"[knock] 发送失败: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
