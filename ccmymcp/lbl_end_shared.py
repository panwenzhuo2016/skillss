# 【AI逻辑总结】
# Claude Code Stop hook 共享模块，供 notify / knock / answer-log 三个脚本导入：
# ① 从 stdin 读取 hook payload（JSON），提取 session_id、cwd、transcript 路径
# ② 解析 transcript JSONL，倒推最后一轮对话的 usage（token 数）和 assistant 总结文本
# ③ 按 Opus 4 公开价计算本次花费（USD）
# ④ gatherContext() 返回统一的上下文 dict，包含 sessionName/summary/statsLine/cost 等

import sys
import os
import re
import json
from pathlib import Path
from typing import Optional

CLAUDE_HOME = Path.home() / ".claude"
MAX_SUMMARY_CHARS = 1000

PRICE_PER_M = {
    "input": 15.0,
    "output": 75.0,
    "cache_read": 1.5,
    "cache_write": 18.75,
}


def read_stdin() -> str:
    if sys.stdin.isatty():
        return ""
    try:
        return sys.stdin.read()
    except Exception:
        return ""


def find_session_name(session_id: str) -> Optional[str]:
    sessions_dir = CLAUDE_HOME / "sessions"
    if not sessions_dir.exists():
        return None
    for f in sessions_dir.iterdir():
        if not f.suffix == ".json":
            continue
        try:
            obj = json.loads(f.read_text("utf-8"))
            if obj.get("sessionId") == session_id and obj.get("name"):
                return obj["name"]
        except Exception:
            pass
    return None


def find_transcript(session_id: str, transcript_hint: Optional[str] = None) -> Optional[str]:
    if transcript_hint and Path(transcript_hint).exists():
        return transcript_hint
    projects_dir = CLAUDE_HOME / "projects"
    if not projects_dir.exists():
        return None
    for sub in projects_dir.iterdir():
        candidate = sub / (session_id + ".jsonl")
        if candidate.exists():
            return str(candidate)
    return None


def pick_summary_from_text(text: str) -> str:
    m = re.search(r"\*{0,2}本次(?:回答)?总结\*{0,2}\s*[:：]\s*([\s\S]+?)(?:\n\n|$)", text)
    if m and m.group(1):
        return m.group(1).strip()
    return text.strip()


def normalize_summary(text: str) -> str:
    text = re.sub(r"[\r\n]+", "\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\s*([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮])\s*", r"\n\1 ", text)
    text = text.lstrip("\n").strip()
    return text


def is_real_user_message(obj: dict) -> bool:
    if obj.get("type") != "user":
        return False
    content = (obj.get("message") or {}).get("content")
    if isinstance(content, str):
        return True
    if isinstance(content, list):
        return all(not (c and c.get("type") == "tool_result") for c in content)
    return False


def extract_user_text(obj: dict) -> str:
    content = (obj.get("message") or {}).get("content")
    text = ""
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        text = "\n".join(c.get("text", "") for c in content if c and c.get("type") == "text" and c.get("text"))
    text = re.sub(r"<system-reminder>[\s\S]*?</system-reminder>", "", text)
    text = re.sub(r"<command-[a-z]+>[\s\S]*?</command-[a-z]+>", "", text)
    text = re.sub(r"<local-command-[a-z]+>[\s\S]*?</local-command-[a-z]+>", "", text)
    return text.strip()


def gather_turn_stats(lines: list) -> dict:
    stats = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0,
             "hasText": False, "summary": "", "userInput": ""}
    turn_start_idx = 0
    for i in range(len(lines) - 1, -1, -1):
        try:
            obj = json.loads(lines[i])
        except Exception:
            continue
        if is_real_user_message(obj):
            turn_start_idx = i + 1
            stats["userInput"] = extract_user_text(obj)
            break

    seen_msg_ids = set()
    last_text_block = None
    for i in range(turn_start_idx, len(lines)):
        try:
            obj = json.loads(lines[i])
        except Exception:
            continue
        if obj.get("type") != "assistant" or not obj.get("message"):
            continue
        msg = obj["message"]
        usage = msg.get("usage")
        msg_id = msg.get("id")
        if usage and msg_id and msg_id not in seen_msg_ids:
            seen_msg_ids.add(msg_id)
            stats["input"] += usage.get("input_tokens", 0)
            stats["output"] += usage.get("output_tokens", 0)
            stats["cache_read"] += usage.get("cache_read_input_tokens", 0)
            stats["cache_write"] += usage.get("cache_creation_input_tokens", 0)
        content = msg.get("content")
        if isinstance(content, list):
            for c in content:
                if c and c.get("type") == "text" and c.get("text", "").strip():
                    last_text_block = c

    if last_text_block:
        stats["hasText"] = True
        picked = pick_summary_from_text(last_text_block["text"])
        stats["summary"] = normalize_summary(picked)
    return stats


def calc_cost(stats: dict) -> float:
    return (
        stats.get("input", 0) * PRICE_PER_M["input"] / 1_000_000
        + stats.get("output", 0) * PRICE_PER_M["output"] / 1_000_000
        + stats.get("cache_read", 0) * PRICE_PER_M["cache_read"] / 1_000_000
        + stats.get("cache_write", 0) * PRICE_PER_M["cache_write"] / 1_000_000
    )


def format_tokens(n: int) -> str:
    if n >= 1000:
        return f"{n / 1000:.1f}k"
    return str(n)


def format_cost(usd: float) -> str:
    if usd < 0.01:
        return f"${usd:.4f}"
    return f"${usd:.3f}"


def truncate(s: str, n: int) -> str:
    chars = list(s)
    if len(chars) > n:
        return "".join(chars[:n]) + "…"
    return s


def debug_log(raw: str, payload: dict, resolved: dict):
    try:
        lam = payload.get("last_assistant_message")
        if lam is not None:
            try:
                (CLAUDE_HOME / "lbl-end-lam-dump.json").write_text(
                    json.dumps(lam, ensure_ascii=False, indent=2), encoding="utf-8"
                )
            except Exception:
                pass
        lam_meta = {
            "type": type(lam).__name__,
            "isArray": isinstance(lam, list),
            "keys": list(lam.keys()) if isinstance(lam, dict) else None,
            "stringPreview": lam[:200] if isinstance(lam, str) else None,
        }
        line = json.dumps({
            "ts": __import__("datetime").datetime.now().isoformat(),
            "raw_len": len(raw),
            "payload_keys": list(payload.keys()),
            "lam_meta": lam_meta,
            "resolved": resolved,
        }, ensure_ascii=False) + "\n"
        with open(CLAUDE_HOME / "lbl-end-debug.log", "a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass


def stats_from_last_assistant_message(msg) -> dict:
    stats = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0,
             "hasText": False, "summary": "", "userInput": ""}
    if not msg:
        return stats
    text = ""
    if isinstance(msg, str):
        text = msg
    elif isinstance(msg, dict):
        content = msg.get("content")
        if isinstance(content, list):
            for c in content:
                if c and c.get("type") == "text" and c.get("text"):
                    text = c["text"]
                    break
        elif isinstance(content, str):
            text = content
    if text and text.strip():
        stats["hasText"] = True
        picked = pick_summary_from_text(text)
        stats["summary"] = normalize_summary(picked)
    if isinstance(msg, dict) and msg.get("usage"):
        usage = msg["usage"]
        stats["input"] = usage.get("input_tokens", 0)
        stats["output"] = usage.get("output_tokens", 0)
        stats["cache_read"] = usage.get("cache_read_input_tokens", 0)
        stats["cache_write"] = usage.get("cache_creation_input_tokens", 0)
    return stats


def gather_context() -> dict:
    raw = read_stdin()
    try:
        payload = json.loads(raw) if raw else {}
    except Exception:
        payload = {}

    session_id = payload.get("session_id") or payload.get("sessionId") or ""
    cwd = payload.get("cwd") or payload.get("workingDirectory") or os.getcwd()
    transcript_hint = payload.get("transcript_path") or payload.get("transcriptPath")

    session_name = find_session_name(session_id) or f"{os.path.basename(cwd) or 'unknown'}:{session_id[:8] or '???'}"

    transcript_path = find_transcript(session_id, transcript_hint)

    stats = stats_from_last_assistant_message(payload.get("last_assistant_message"))

    if transcript_path:
        try:
            lines = Path(transcript_path).read_text("utf-8").strip().splitlines()
            turn_stats = gather_turn_stats(lines)
            stats["userInput"] = turn_stats["userInput"] or stats["userInput"]
            if not stats["hasText"] and turn_stats["hasText"]:
                stats["hasText"] = True
                stats["summary"] = turn_stats["summary"]
            if not stats["input"] and not stats["output"]:
                stats["input"] = turn_stats["input"]
                stats["output"] = turn_stats["output"]
                stats["cache_read"] = turn_stats["cache_read"]
                stats["cache_write"] = turn_stats["cache_write"]
        except Exception:
            pass

    summary = truncate(stats["summary"], MAX_SUMMARY_CHARS)
    cost = calc_cost(stats)
    stats_line = (
        f"\U0001f4ca 输入 {format_tokens(stats['input'])} / 输出 {format_tokens(stats['output'])}"
        f" / 缓存读 {format_tokens(stats['cache_read'])} / 花费 {format_cost(cost)}"
    )

    result = {
        "sessionId": session_id,
        "cwd": cwd,
        "sessionName": session_name,
        "summary": summary,
        "transcriptPath": transcript_path,
        "hasText": stats["hasText"],
        "stats": stats,
        "cost": cost,
        "statsLine": stats_line,
        "userInput": stats.get("userInput", ""),
    }
    debug_log(raw, payload, {**result, "transcriptPath": bool(transcript_path)})
    return result
