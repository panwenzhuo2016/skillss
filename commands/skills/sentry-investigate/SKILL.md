---
name: sentry-investigate
description: This skill should be used when the user wants to "investigate a Sentry issue", "analyze an error", "find root cause", "调查Sentry问题", "分析报错原因", "查看错误详情", "根因分析", or provides a Sentry issue URL or shortId (like COLLABSPACE-SERVER-20) and wants deep analysis. Use this skill when the user selects a specific issue from sentry-summary results and wants to understand why it's happening. Always use this skill for root cause analysis of production errors from sentry.yottastudios.com.
version: 0.1.0
---

# Sentry Issue Investigation

Given a Sentry issue (URL or shortId), investigate the root cause by analyzing stacktraces, pulling source code, querying runtime logs, and optionally tracing across related services. Produce a written investigation report with root cause analysis, severity assessment, and fix recommendations.

Support both Chinese (中文) and English — detect the user's language and respond in the same language.

## Configuration

| Parameter | Source | Value |
|-----------|--------|-------|
| Sentry Base URL | Hardcoded | `https://sentry.yottastudios.com` |
| Sentry Auth | Env var | `SENTRY_AUTH_TOKEN` |
| GitLab Base URL | Hardcoded | `https://pt-gitlab.yottastudios.com` |
| GitLab Auth | Env var | `GITLAB_TOKEN` |
| Grafana Base URL | Hardcoded | `https://xgrafana.yottastudios.com` |
| Grafana Auth | Env vars | `GRAFANA_USER`, `GRAFANA_PASSWORD` |
| Project Mapping | File | `references/project-mapping.json` |
| Local Code Path | Config | `/home/username/Sentry/projects/` |
| Report Output | Config | `/home/username/Sentry/reports/` |

### Preflight Check

Verify environment variables are set before starting. The required variables depend on the mode:

**Interactive mode** (user invokes directly): Check all 4 variables.

```bash
echo "SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN:+SET}" \
     "GITLAB_TOKEN=${GITLAB_TOKEN:+SET}" \
     "GRAFANA_USER=${GRAFANA_USER:+SET}" \
     "GRAFANA_PASSWORD=${GRAFANA_PASSWORD:+SET}"
```

**Batch mode** (dispatched by `batch_investigate.py`): Only check Grafana variables (Sentry/GitLab operations are handled by the orchestrator).

```bash
echo "GRAFANA_USER=${GRAFANA_USER:+SET}" \
     "GRAFANA_PASSWORD=${GRAFANA_PASSWORD:+SET}"
```

If any required variable shows empty instead of `SET`, stop and provide setup instructions:

- **SENTRY_AUTH_TOKEN** — Create at `https://sentry.yottastudios.com/settings/account/api/auth-tokens/` (scopes: `org:read`, `project:read`, `event:read`)
- **GITLAB_TOKEN** — Create at `https://pt-gitlab.yottastudios.com/-/user_settings/personal_access_tokens` (scope: `api`)
- **GRAFANA_USER / GRAFANA_PASSWORD** — Ask the user for their Grafana username and password

Persist each variable to `~/.bashrc` and export for the current session:

```bash
echo 'export SENTRY_AUTH_TOKEN="<token>"' >> ~/.bashrc
export SENTRY_AUTH_TOKEN="<token>"
```

Repeat for each missing variable. Confirm to the user once all are set.

## Workflow

### Step 1: Parse Issue Input

**Batch Mode Input (from `batch_investigate.py`):**

When dispatched by the batch orchestrator, the prompt provides file paths instead of a URL/shortId:
- `issue.json` — contains issue details (id, shortId, title, level, count, firstSeen, lastSeen, project.slug, permalink)
- `event.json` — contains latest event data with full stacktrace

Read both files, extract the issue details and stacktrace, then skip to Step 2. No Sentry API calls needed.

Detect batch mode by checking if the prompt mentions `issue.json` and `event.json` file paths.

Accept three input types:

**Type A — Sentry URL**

Extract the issue ID from the URL path.

Example: `https://sentry.yottastudios.com/organizations/yotta/issues/29771/` → issue ID `29771`

Fetch the issue:
```
GET https://sentry.yottastudios.com/api/0/issues/29771/
Authorization: Bearer <SENTRY_AUTH_TOKEN>
```

**Type B — shortId**

Example: `COLLABSPACE-SERVER-20`

Search for the issue. Try the shortId directly first:
```
GET https://sentry.yottastudios.com/api/0/organizations/yotta/issues/?query=COLLABSPACE-SERVER-20
Authorization: Bearer <SENTRY_AUTH_TOKEN>
```

Take the first result's `id` field.

**Fallback:** If the shortId search returns empty results, extract the project slug from the shortId (e.g. `COLLABSPACE-SERVER-20` → project contains `collabspace-server`), then search by the issue title or error message instead. You can also try searching with just the issue number or browsing recent issues for that project.

**Type C — Conversation Context**

From `/sentry-summary` results, extract the issue ID or shortId from the conversation context.

### After resolving the issue ID

Fetch these two pieces of data:

1. **Issue details** — title, shortId, level, count, firstSeen, lastSeen, project.slug, id, permalink:
   ```
   GET https://sentry.yottastudios.com/api/0/issues/{issue_id}/
   Authorization: Bearer <SENTRY_AUTH_TOKEN>
   ```

2. **Latest event with stacktrace** — use the `/events/latest/` endpoint (the list endpoint omits stacktrace details):
   ```bash
   curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
     "https://sentry.yottastudios.com/api/0/issues/{issue_id}/events/latest/" \
     > /tmp/sentry-event-{shortId}.json
   ```

   Extract stacktrace from `entries`:
   - Look for entries where `type` is `"exception"` — this is the most common for uncaught exceptions. Each exception has `data.values[].stacktrace.frames[]` with fields: `filename`, `lineNo`, `function`, `context`.
   - Also check entries where `type` is `"threads"` — Java apps using Sentry's log appender (not uncaught exceptions) put stacktraces here instead. Structure: `data.values[].stacktrace.frames[]` with the same fields.

Reference `references/sentry-api.md` for full schema.

### Step 2: Pull Code and Locate Error

1. Read `references/project-mapping.json` for the project matching `project.slug`.

2. Determine the local path: `/home/username/Sentry/projects/{repo_name}` where `repo_name` is the last segment of `gitlab_path`.
   - Example: `px/collabspace/collabspace-server` → `/home/username/Sentry/projects/collabspace-server`
   - Monorepo: `px/apitable/apitable` → `/home/username/Sentry/projects/apitable`

3. **Interactive mode only:** If the directory does not exist, clone it:
   ```bash
   git clone https://oauth2:$GITLAB_TOKEN@pt-gitlab.yottastudios.com/{gitlab_path}.git \
     /home/username/Sentry/projects/{repo_name}
   ```
   If it exists, pull to update:
   ```bash
   git -C /home/username/Sentry/projects/{repo_name} pull
   ```
   For infra repos, use the `aio-service` branch:
   ```bash
   git clone -b aio-service https://oauth2:$GITLAB_TOKEN@pt-gitlab.yottastudios.com/{gitlab_path}.git \
     /home/username/Sentry/projects/{repo_name}
   ```

   **Batch mode:** Code is already pre-pulled by the orchestrator. Skip git operations. If a needed repo directory doesn't exist (e.g., cross-service tracing target not pre-pulled), note this in the report.

4. Read source files matching stacktrace frames using the Read tool.

5. Analyze code context: function logic, call chain, error handling patterns.

### Step 3: Deep Investigation (Agent Decision)

The agent decides whether more investigation is needed. **If the root cause is clear from code alone, skip to Step 4.**

Two optional methods:

**Method A: Query Loki Logs**

Use when runtime context is needed (e.g., request parameters, timing, upstream responses).

1. Get `loki_app` from `references/project-mapping.json`. If null, skip this method.
2. Extract keywords from the stacktrace or error title.
3. Query incrementally — start with a core keyword and a 5-minute window around `lastSeen`, limit 100.
4. ALWAYS save to a temp file then read:
   ```bash
   curl -s -u "$GRAFANA_USER:$GRAFANA_PASSWORD" \
     "https://xgrafana.yottastudios.com/api/datasources/proxy/2/loki/api/v1/query_range?query=%7Bapp%3D%22{loki_app}%22%7D%20%7C~%20%22{keyword}%22&start={start_ns}&end={end_ns}&limit=100" \
     > /tmp/loki-{shortId}-1.log
   ```
5. Analyze the results. Extract leads (traceId, requestId), refine queries, and repeat if needed.

Reference `references/loki-api.md` for query syntax.

**Method B: Cross-Service Tracing**

Use when code or logs point to another service as the source of the problem.

1. Find the related service in `references/project-mapping.json`.
2. Repeat Step 2 (pull code) and optionally Method A (Loki logs) for that service.
3. Can also clone gateway or k8s infra repos for routing and deployment context.
4. No fixed limit on tracing depth — follow the chain as far as needed.

**Decision Principle:** Don't investigate more than necessary. If the root cause is already clear, stop and write the report.

### Step 4: Generate Report

报告路径按目录结构组织，便于按日期、应用、优先级浏览：

```
/home/username/Sentry/reports/{YYYY-MM-DD}/{project_slug}/{priority}/{shortId}-{brief_description}.md
```

示例：`/home/username/Sentry/reports/2026-04-02/collabspace-server/P3/COLLABSPACE-SERVER-52-上传时间格式误报.md`

其中 `brief_description` 是对问题的简短中文/英文概述（10字以内，用连字符连接），由 agent 根据调查结果生成。

创建目录并写入报告：
```bash
mkdir -p "/home/username/Sentry/reports/YYYY-MM-DD/{project_slug}/{priority}"
```

报告必须以 YAML frontmatter 开头，所有字段必填：

```markdown
---
shortId: COLLABSPACE-SERVER-52
project: collabspace-server
priority: P3
event_count: 335
sentry_issue_id: 34450
last_seen: "2026-04-02T09:46:00Z"
created_at: "2026-04-02"
---

# Issue 调查报告：{shortId}

## 概述

（1-2 句话简述问题本质和根因，让读者不看完整报告也能快速了解。）

## 基本信息
- **Issue:** {title}
- **项目:** {project}
- **级别:** {level}
- **事件数:** {count}
- **首次出现:** {firstSeen}
- **最后出现:** {lastSeen}
- **Sentry 链接:** {permalink}

## 错误现象
（Stacktrace 摘要 + 关键日志片段）

## 调查过程
（每步操作和发现）

## 根因分析
（为什么出错，具体到代码逻辑）

## 紧急程度：P0/P1/P2/P3
评判依据：
- 错误频率与趋势
- 是否 fatal 级别
- 影响范围
- 是否持续恶化

| 级别 | 条件 |
|------|------|
| **P0 - 紧急** | fatal；核心功能不可用；错误数急剧上升 |
| **P1 - 高** | error 且影响用户操作；持续恶化 |
| **P2 - 中** | error 但影响有限；有 workaround |
| **P3 - 低** | warning/info；极低频率；边缘场景 |

## 影响范围
（受影响的服务和用户场景）

## 建议修复方案
（具体修复建议，指出文件和代码位置）
```

Frontmatter 字段说明：
- `shortId`、`project`、`event_count`、`sentry_issue_id`、`last_seen` — 从 issue 数据中提取
- `priority` — 由 agent 调查后确定（P0/P1/P2/P3）
- `created_at` — 报告创建日期（当天）

Use the user's language for section headers (Chinese headers shown above; switch to English equivalents if user writes in English).

After writing the report, inform the user of the file path.

## Error Handling

- **Environment variable missing** → Stop, prompt the user, and provide the setup URLs listed in the Preflight Check section.
- **Sentry 401** → Token is invalid or revoked. Link to regenerate: `https://sentry.yottastudios.com/settings/account/api/auth-tokens/`
- **GitLab 401** → Token is invalid or the user lacks permission for the repository.
- **Grafana 401** → Wrong username or password. Ask the user to verify credentials.
- **git clone fails** → Check `references/project-mapping.json` for correct `gitlab_path`.
- **Loki returns no logs** → Note this limitation in the report and continue investigation with other methods.
- **Issue not found** → Ask the user to verify the issue URL or shortId.
- **No file paths in stacktrace (minified code)** → Note the limitation in the report. Focus on the error message and logs instead.

## Language Guidelines

- Detect the user's language and respond accordingly.
- Stacktraces, logs, and code snippets stay in their original language (usually English) regardless of the response language.
- Report section headers follow the user's language.
- Timestamps: Chinese users get `YYYY年MM月DD日 HH:mm`, English users get ISO 8601.

## 安全约束

**通用约束（交互模式 + 批量模式）：**

- 禁止修改 `/home/username/Sentry/projects/` 下的任何项目代码
- 禁止安装依赖、运行构建、执行项目代码
- 只允许 Write 到 `/home/username/Sentry/reports/` 和 `/tmp/` 目录
- Bash 只允许用于 curl 查询 Loki 日志和保存临时文件

**批量模式额外约束（由 `--allowedTools` 强制执行）：**

- 禁止执行 git 操作（clone、pull、push、commit 等）——由编排脚本处理

## Additional Resources

- **`references/project-mapping.json`** — Project mapping config (project slug → GitLab path, Loki app name)
- **`references/sentry-api.md`** — Sentry API reference (endpoints, query parameters, response schemas)
- **`references/loki-api.md`** — Grafana/Loki query reference (LogQL syntax, time formats)
- **`references/gitlab-api.md`** — GitLab API and git clone patterns
