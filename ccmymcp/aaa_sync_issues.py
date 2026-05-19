#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
【AI逻辑总结】
① 扫描 oa/hr/collabspace/jira 四个项目的 myfeature 目录，收集数字开头的 issue 文件夹
② 同时扫描"已上线"和"上线中"子目录，已上线标记 released=True，上线中仍算进行中
③ 从文件夹名解析日期（支持 YYMMDD 和 MMDD 格式）作为 createdAt
④ 从 allIssue.html 提取已有 SEED_DATA 做增量合并：新文件夹加入、released 状态同步、保留 done 状态
⑤ 合并结果按 createdAt 降序排列，写回 allIssue.html 的 SEED_DATA 区域
"""

import os
import json
import re
import hashlib
from datetime import datetime

PROJECTS = {
    'oa': r'D:\project\info-gitlab\oa\myfeatrue',
    'hr': r'D:\project\info-gitlab\hr\myfeature',
    'collabspace': r'D:\project\pt-gitlab\collabspace\myfeature',
    'jira': r'D:\project\pt-gitlab\jira\myfeature',
}

SKIP_DIRS = {'已上线', '上线中', '发版', '.git', 'claude工作流', '纯后端'}

HTML_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'allIssue.html')

SEED_START = '/* SEED_DATA_START */'
SEED_END = '/* SEED_DATA_END */'


def gen_id(project, name):
    h = hashlib.md5(f'{project}_{name}'.encode('utf-8')).hexdigest()[:10]
    return f'scan_{h}'


def parse_date(name):
    m = re.match(r'^(\d{2})(\d{2})(\d{2})-', name)
    if m:
        yy, mm, dd = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mm <= 12 and 1 <= dd <= 31:
            return f'20{yy:02d}-{mm:02d}-{dd:02d}T00:00:00'
    m = re.match(r'^(\d{2})(\d{2})-', name)
    if m:
        mm, dd = int(m.group(1)), int(m.group(2))
        if 1 <= mm <= 12 and 1 <= dd <= 31:
            return f'{datetime.now().year}-{mm:02d}-{dd:02d}T00:00:00'
    return None


def scan_dir(base_dir, released):
    if not os.path.isdir(base_dir):
        return []
    items = []
    for name in os.listdir(base_dir):
        if name in SKIP_DIRS:
            continue
        full = os.path.join(base_dir, name)
        if not os.path.isdir(full):
            continue
        if not re.match(r'^\d+[-]', name):
            continue
        items.append((name, released))
    return items


def scan_all():
    result = {}
    for project, base_dir in PROJECTS.items():
        folders = []
        folders += scan_dir(base_dir, released=False)
        folders += scan_dir(os.path.join(base_dir, '已上线'), released=True)
        folders += scan_dir(os.path.join(base_dir, '上线中'), released=False)

        items = []
        for name, rel in folders:
            date_str = parse_date(name) or datetime.now().isoformat()
            items.append({
                'id': gen_id(project, name),
                'text': name,
                'createdAt': date_str,
                'done': rel,
                'released': rel,
            })
        items.sort(key=lambda x: x['createdAt'], reverse=True)
        result[project] = items
    return result


def read_existing_seed():
    if not os.path.exists(HTML_FILE):
        return {}
    with open(HTML_FILE, 'r', encoding='utf-8') as f:
        content = f.read()
    start = content.find(SEED_START)
    end = content.find(SEED_END)
    if start < 0 or end < 0:
        return {}
    fragment = content[start + len(SEED_START):end]
    m = re.search(r'=\s*(\{[\s\S]*\})\s*;', fragment)
    if not m:
        return {}
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return {}


def merge(existing, scanned):
    result = {}
    for project in PROJECTS:
        scanned_items = scanned.get(project, [])
        existing_items = existing.get(project, [])
        done_map = {it['text']: it.get('done', False) for it in existing_items}

        merged = []
        for item in scanned_items:
            if item['text'] in done_map and not item['released']:
                item['done'] = done_map[item['text']]
            merged.append(item)
        result[project] = merged
    return result


def write_to_html(data):
    with open(HTML_FILE, 'r', encoding='utf-8') as f:
        content = f.read()

    json_str = json.dumps(data, ensure_ascii=False, indent=8)
    new_block = f"""{SEED_START}
        const SEED_DATA = {json_str};
        {SEED_END}"""

    start = content.find(SEED_START)
    end = content.find(SEED_END)
    if start >= 0 and end >= 0:
        content = content[:start] + new_block + content[end + len(SEED_END):]
    else:
        content = content.replace(
            '<script>\n    /*\n',
            f'<script>\n    {new_block}\n\n    /*\n',
        )

    with open(HTML_FILE, 'w', encoding='utf-8') as f:
        f.write(content)


def main():
    scanned = scan_all()
    existing = read_existing_seed()
    merged = merge(existing, scanned)
    write_to_html(merged)

    print(f'已更新: {HTML_FILE}')
    total = 0
    for p in PROJECTS:
        items = merged.get(p, [])
        rel = sum(1 for i in items if i.get('released'))
        cur = len(items) - rel
        print(f'  {p}: {len(items)} 条 ({cur} 进行中, {rel} 已上线)')
        total += len(items)
    print(f'  合计: {total} 条')


if __name__ == '__main__':
    main()
