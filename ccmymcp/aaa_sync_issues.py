#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
【AI逻辑总结】
① 扫描 oa/hr/collabspace/jira 四个项目的 myfeature 目录，收集数字开头的 issue 文件夹
② 同时扫描"已上线"和"上线中"子目录，已上线标记 released=True，上线中仍算进行中
③ 用文件夹最后修改时间作为 createdAt；已有项保留原 createdAt 不变，保证重复运行幂等
④ 增量合并后输出新增/修改/不变的条数，写回 allIssue.html 的 SEED_DATA 和 SYNC_META 区域
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
META_START = '/* SYNC_META_START */'
META_END = '/* SYNC_META_END */'


def gen_id(project, name):
    h = hashlib.md5(f'{project}_{name}'.encode('utf-8')).hexdigest()[:10]
    return f'scan_{h}'


def folder_mtime_iso(path):
    ts = os.path.getmtime(path)
    return datetime.fromtimestamp(ts).strftime('%Y-%m-%dT%H:%M:%S')


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
        items.append((name, released, full))
    return items


def scan_all():
    result = {}
    for project, base_dir in PROJECTS.items():
        folders = []
        folders += scan_dir(base_dir, released=False)
        folders += scan_dir(os.path.join(base_dir, '已上线'), released=True)
        folders += scan_dir(os.path.join(base_dir, '上线中'), released=False)

        items = []
        for name, rel, full_path in folders:
            items.append({
                'id': gen_id(project, name),
                'text': name,
                'createdAt': folder_mtime_iso(full_path),
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
    stats = {'added': 0, 'modified': 0, 'unchanged': 0}
    result = {}
    for project in PROJECTS:
        scanned_items = scanned.get(project, [])
        existing_items = existing.get(project, [])
        existing_map = {it['text']: it for it in existing_items}

        merged = []
        for item in scanned_items:
            ex = existing_map.get(item['text'])
            if ex:
                changed = ex.get('released') != item['released']
                if changed:
                    stats['modified'] += 1
                else:
                    stats['unchanged'] += 1
                item['createdAt'] = ex['createdAt']
                if not item['released']:
                    item['done'] = ex.get('done', False)
            else:
                stats['added'] += 1
            merged.append(item)
        result[project] = merged
    return result, stats


def write_to_html(data, stats):
    with open(HTML_FILE, 'r', encoding='utf-8') as f:
        content = f.read()

    json_str = json.dumps(data, ensure_ascii=False, indent=8)
    new_seed = f"""{SEED_START}
        const SEED_DATA = {json_str};
        {SEED_END}"""

    now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    total = stats['added'] + stats['modified'] + stats['unchanged']
    meta_obj = {
        'lastSync': now_str,
        'added': stats['added'],
        'modified': stats['modified'],
        'total': total,
    }
    meta_json = json.dumps(meta_obj, ensure_ascii=False)
    new_meta = f"""{META_START}
        const SYNC_META = {meta_json};
        {META_END}"""

    # SEED_DATA
    start = content.find(SEED_START)
    end = content.find(SEED_END)
    if start >= 0 and end >= 0:
        content = content[:start] + new_seed + content[end + len(SEED_END):]
    else:
        content = content.replace(
            '<script>\n    /*\n',
            f'<script>\n    {new_seed}\n\n    /*\n',
        )

    # SYNC_META
    ms = content.find(META_START)
    me = content.find(META_END)
    if ms >= 0 and me >= 0:
        content = content[:ms] + new_meta + content[me + len(META_END):]
    else:
        seed_end_pos = content.find(SEED_END)
        if seed_end_pos >= 0:
            insert_at = seed_end_pos + len(SEED_END)
            content = content[:insert_at] + '\n\n    ' + new_meta + content[insert_at:]

    with open(HTML_FILE, 'w', encoding='utf-8') as f:
        f.write(content)


def main():
    scanned = scan_all()
    existing = read_existing_seed()
    merged, stats = merge(existing, scanned)
    write_to_html(merged, stats)

    print(f'已更新: {HTML_FILE}')
    print(f'  新增: {stats["added"]} 条，更新: {stats["modified"]} 条，不变: {stats["unchanged"]} 条')
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
