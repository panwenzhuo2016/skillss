#!/usr/bin/env python3
"""Batch Sentry issue investigation orchestrator.

Fetches unresolved issues from Sentry, deduplicates against existing reports,
pulls source code, and dispatches parallel Claude CLI processes to investigate.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
try:
    import yaml
except ImportError:
    yaml = None


SCRIPT_DIR = Path(__file__).resolve().parent
MAPPING_PATH = SCRIPT_DIR / "references" / "project-mapping.json"
BATCH_TMP_DIR = Path("/tmp/sentry-batch")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Batch investigate Sentry issues with parallel Claude CLI instances"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--top", type=int, help="Fetch top N unresolved issues (sorted by lastSeen)")
    group.add_argument("--last", type=str, help="Fetch issues with events in the last period (e.g. 24h, 7d)")
    parser.add_argument("--project", action="append", dest="projects", help="Limit to specific project(s), can be repeated")
    parser.add_argument("--parallel", type=int, default=3, help="Number of parallel Claude CLI processes (default: 3)")
    return parser.parse_args()


def check_env():
    """Check required environment variables. Exit if missing."""
    missing = []
    for var in ("SENTRY_AUTH_TOKEN", "GITLAB_TOKEN"):
        if not os.environ.get(var):
            missing.append(var)
    if missing:
        print(f"Error: Missing environment variables: {', '.join(missing)}", file=sys.stderr)
        print("Set them in ~/.bashrc or export before running.", file=sys.stderr)
        sys.exit(1)


def load_mapping():
    """Load project-mapping.json."""
    with open(MAPPING_PATH) as f:
        return json.load(f)


def fetch_issues(mapping, args):
    """Fetch issue list from Sentry API."""
    sentry_url = mapping["sentry"]["base_url"]
    org = mapping["sentry"]["org"]
    token = os.environ["SENTRY_AUTH_TOKEN"]

    params = ["query=is%3Aunresolved", "sort=date"]

    if args.top is not None:
        params.append(f"limit={args.top}")
    elif args.last is not None:
        params.append(f"statsPeriod={args.last}")

    if args.projects:
        project_ids = get_project_ids(sentry_url, org, token, args.projects)
        for pid in project_ids:
            params.append(f"project={pid}")

    url = f"{sentry_url}/api/0/organizations/{org}/issues/?{'&'.join(params)}"
    result = subprocess.run(
        ["curl", "-s", "-f", "-H", f"Authorization: Bearer {token}", url],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"Error: Sentry API request failed (curl exit {result.returncode}): {result.stderr[:200]}", file=sys.stderr)
        sys.exit(1)

    try:
        issues = json.loads(result.stdout)
    except json.JSONDecodeError:
        print(f"Error: Sentry API returned invalid JSON: {result.stdout[:200]}", file=sys.stderr)
        sys.exit(1)

    if not isinstance(issues, list):
        print(f"Error: Sentry API returned unexpected response: {result.stdout[:200]}", file=sys.stderr)
        sys.exit(1)

    extracted = []
    for issue in issues:
        extracted.append({
            "id": issue["id"],
            "shortId": issue["shortId"],
            "title": issue["title"],
            "level": issue.get("level", "error"),
            "count": int(issue.get("count", 0)),
            "firstSeen": issue.get("firstSeen", ""),
            "lastSeen": issue.get("lastSeen", ""),
            "project_slug": issue.get("project", {}).get("slug", ""),
            "permalink": issue.get("permalink", ""),
        })
    return extracted


def get_project_ids(sentry_url, org, token, project_names):
    """Get Sentry project IDs from project slugs."""
    url = f"{sentry_url}/api/0/organizations/{org}/projects/?per_page=100"
    result = subprocess.run(
        ["curl", "-s", "-f", "-H", f"Authorization: Bearer {token}", url],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"Warning: Failed to fetch project list: {result.stderr[:200]}", file=sys.stderr)
        return []
    try:
        all_projects = json.loads(result.stdout)
    except json.JSONDecodeError:
        print(f"Warning: Invalid JSON from projects endpoint", file=sys.stderr)
        return []
    ids = []
    for proj in all_projects:
        if proj.get("slug") in project_names:
            ids.append(proj["id"])
    if not ids:
        print(f"Warning: No matching project IDs found for {project_names}", file=sys.stderr)
    return ids


def fetch_event_detail(sentry_url, token, issue_id, short_id):
    """Fetch latest event with stacktrace for an issue."""
    url = f"{sentry_url}/api/0/issues/{issue_id}/events/latest/"
    result = subprocess.run(
        ["curl", "-s", "-f", "-H", f"Authorization: Bearer {token}", url],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"  Warning: Failed to fetch event for {short_id}: {result.stderr[:100]}", file=sys.stderr)
        return None

    # Validate response contains event data
    try:
        event_data = json.loads(result.stdout)
        if not isinstance(event_data, dict) or "id" not in event_data:
            print(f"  Warning: Invalid event data for {short_id}", file=sys.stderr)
            return None
    except json.JSONDecodeError:
        print(f"  Warning: Invalid JSON in event response for {short_id}", file=sys.stderr)
        return None

    issue_dir = BATCH_TMP_DIR / short_id
    issue_dir.mkdir(parents=True, exist_ok=True)
    event_path = issue_dir / "event.json"
    event_path.write_text(result.stdout)
    return str(event_path)


def parse_frontmatter(filepath):
    """Parse YAML frontmatter from a markdown file.

    Returns dict of frontmatter fields, or None if no frontmatter found.
    """
    text = Path(filepath).read_text(encoding="utf-8")
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
    if not match:
        return None

    if yaml:
        return yaml.safe_load(match.group(1))

    # Fallback: simple key-value parsing without pyyaml
    result = {}
    for line in match.group(1).strip().split("\n"):
        if ":" in line:
            key, _, value = line.partition(":")
            value = value.strip().strip('"').strip("'")
            result[key.strip()] = value
    return result


def should_investigate(short_id, current_event_count, reports_dir):
    """Check if an issue needs (re-)investigation based on existing reports.

    Returns (bool, reason_string).
    """
    reports_path = Path(reports_dir)
    if not reports_path.exists():
        return True, "no reports directory"

    best_report = None
    best_date = ""
    for md_file in reports_path.rglob("*.md"):
        fm = parse_frontmatter(md_file)
        if fm and fm.get("shortId") == short_id:
            created = str(fm.get("created_at", ""))
            if created > best_date:
                best_date = created
                best_report = fm

    if best_report is None:
        return True, "no existing report"

    # P0/P1 always re-investigate
    priority = str(best_report.get("priority", "")).upper()
    if priority in ("P0", "P1"):
        return True, f"previous priority {priority}, always re-investigate"

    # Check event count doubling
    try:
        existing_count = int(best_report.get("event_count", 0))
    except (ValueError, TypeError):
        existing_count = 0

    if existing_count == 0:
        return True, "existing report has no event count"

    ratio = current_event_count / existing_count
    if ratio >= 2:
        return True, f"event count grew {ratio:.1f}x ({existing_count} → {current_event_count})"

    return False, f"event count {existing_count} → {current_event_count}, ratio {ratio:.1f}x < 2x"


def pull_repos(issues, mapping):
    """Clone or pull all repos needed for the issues to investigate."""
    gitlab_token = os.environ["GITLAB_TOKEN"]
    gitlab_base = mapping["gitlab"]["base_url"]
    local_base = mapping["local_base_path"]

    repos_needed = {}

    for issue in issues:
        slug = issue["project_slug"]
        project_cfg = mapping["projects"].get(slug)
        if not project_cfg:
            print(f"  Warning: No mapping for project '{slug}', skipping repo pull", file=sys.stderr)
            continue
        gitlab_path = project_cfg["gitlab_path"]
        repo_name = gitlab_path.split("/")[-1]
        if repo_name not in repos_needed:
            repos_needed[repo_name] = (gitlab_path, None)

    for name, info in mapping.get("infra_repos", {}).items():
        if name not in repos_needed:
            repos_needed[name] = (info["gitlab_path"], info.get("branch"))

    for repo_name, (gitlab_path, branch) in repos_needed.items():
        local_path = os.path.join(local_base, repo_name)
        if os.path.exists(local_path):
            print(f"  Pulling {repo_name}...")
            result = subprocess.run(
                ["git", "-C", local_path, "pull"],
                capture_output=True, text=True
            )
            if result.returncode != 0:
                print(f"  Warning: git pull failed for {repo_name}: {result.stderr.strip()}", file=sys.stderr)
        else:
            print(f"  Cloning {repo_name}...")
            cmd = ["git", "clone"]
            if branch:
                cmd += ["-b", branch]
            clone_url = f"https://oauth2:{gitlab_token}@{gitlab_base.replace('https://', '')}/{gitlab_path}.git"
            cmd += [clone_url, local_path]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                print(f"  Warning: git clone failed for {repo_name}: {result.stderr.strip()}", file=sys.stderr)

    return repos_needed


def run_investigation(issue_info):
    """Dispatch a Claude CLI process to investigate a single issue.

    Returns (shortId, return_code, stderr_snippet).
    """
    short_id = issue_info["shortId"]
    issue_dir = BATCH_TMP_DIR / short_id

    prompt = f"""阅读 {SCRIPT_DIR / 'SKILL.md'} 的调查流程。

Issue 详情：{issue_dir / 'issue.json'}
最新事件（含 stacktrace）：{issue_dir / 'event.json'}

代码已在 /home/username/Sentry/projects/ 下，不需要 git 操作。
直接从 Step 2（读代码定位）开始。

用中文输出报告，写到 /home/username/Sentry/reports/ 下，按 SKILL.md 要求的目录结构和 frontmatter 格式。"""

    try:
        result = subprocess.run(
            [
                "claude", "-p", prompt,
                "--allowedTools",
                "Read,Glob,Grep,Bash,Write",
                "--max-turns", "50",
            ],
            capture_output=True,
            text=True,
            timeout=900,
        )
        return short_id, result.returncode, result.stderr[:500] if result.stderr else ""
    except subprocess.TimeoutExpired:
        return short_id, -1, "Process timed out (>15min)"


def find_report_for(short_id, reports_dir, today):
    """Find the report file generated today for a given shortId."""
    today_dir = Path(reports_dir) / today
    if not today_dir.exists():
        return None
    for md_file in today_dir.rglob("*.md"):
        if md_file.name.startswith(short_id + "-") or md_file.name == short_id + ".md":
            return str(md_file)
    return None


def main():
    args = parse_args()
    check_env()
    mapping = load_mapping()
    today = datetime.now().strftime("%Y-%m-%d")
    reports_dir = mapping["report_path"]

    # Step 1: Fetch issues
    print(f"=== Fetching Sentry issues ===")
    issues = fetch_issues(mapping, args)
    print(f"Found {len(issues)} issues")

    if not issues:
        print("No issues found. Exiting.")
        return

    # Step 2: Pre-fetch event details and save issue.json
    sentry_url = mapping["sentry"]["base_url"]
    token = os.environ["SENTRY_AUTH_TOKEN"]
    print(f"\n=== Pre-fetching issue details ===")
    fetch_failed = []
    for issue in issues:
        short_id = issue["shortId"]
        issue_dir = BATCH_TMP_DIR / short_id
        issue_dir.mkdir(parents=True, exist_ok=True)
        issue_path = issue_dir / "issue.json"
        issue_path.write_text(json.dumps(issue, ensure_ascii=False, indent=2))
        print(f"  Fetching event for {short_id}...")
        event_path = fetch_event_detail(sentry_url, token, issue["id"], short_id)
        if event_path is None:
            fetch_failed.append(short_id)

    # Remove issues with failed event fetch
    if fetch_failed:
        issues = [i for i in issues if i["shortId"] not in fetch_failed]
        print(f"  Skipped {len(fetch_failed)} issues due to event fetch failure: {', '.join(fetch_failed)}")

    # Step 3: Dedup
    print(f"\n=== Deduplication ===")
    to_investigate = []
    skipped = []
    for issue in issues:
        should, reason = should_investigate(issue["shortId"], issue["count"], reports_dir)
        if should:
            to_investigate.append(issue)
            print(f"  ✓ {issue['shortId']} — {reason}")
        else:
            skipped.append((issue, reason))
            print(f"  ✗ {issue['shortId']} — skipped: {reason}")

    if not to_investigate:
        print("\nNo new issues to investigate. All filtered by dedup.")
        return

    # Step 4: Pull repos
    print(f"\n=== Pulling source code ===")
    pull_repos(to_investigate, mapping)

    # Step 5: Dispatch parallel Claude CLI
    print(f"\n=== Dispatching {len(to_investigate)} investigations (parallel={args.parallel}) ===")
    results = {"success": [], "failed": []}

    with ProcessPoolExecutor(max_workers=args.parallel) as executor:
        futures = {
            executor.submit(run_investigation, issue): issue
            for issue in to_investigate
        }
        for future in as_completed(futures):
            issue = futures[future]
            short_id, code, stderr = future.result()
            if code == 0:
                report_path = find_report_for(short_id, reports_dir, today)
                results["success"].append((short_id, report_path or "report path not found"))
                print(f"  ✓ {short_id} completed")
            else:
                reason = "timed out" if code == -1 else f"exit code {code}"
                if stderr:
                    reason += f": {stderr[:100]}"
                results["failed"].append((short_id, reason))
                print(f"  ✗ {short_id} failed: {reason}")

    # Step 6: Summary
    print(f"\n{'=' * 40}")
    print(f"=== Batch investigation complete ===")
    print(f"{'=' * 40}")

    print(f"\nInvestigated: {len(results['success'])}")
    for short_id, path in results["success"]:
        print(f"  ✓ {short_id} → {path}")

    if skipped:
        print(f"\nSkipped (existing report): {len(skipped)}")
        for issue, reason in skipped:
            print(f"  - {issue['shortId']} ({reason})")

    if results["failed"]:
        print(f"\nFailed: {len(results['failed'])}")
        for short_id, reason in results["failed"]:
            print(f"  ✗ {short_id} ({reason})")


if __name__ == "__main__":
    main()
