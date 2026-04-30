---
name: sentry-summary
description: This skill should be used when the user wants to "get a Sentry summary", "show Sentry errors", "check Sentry issues", "查看Sentry错误", "获取Sentry摘要", "查看项目问题", "显示最近错误", "Sentry报告", "错误追踪摘要", or wants to know about recent errors, unresolved issues, project issue counts, or performance metrics from the self-hosted Sentry server at sentry.yottastudios.com. Always use this skill when the user mentions Sentry monitoring, error tracking, or wants an overview of application health.
version: 0.2.0
---

# Sentry Summary Skill

Fetch and present a summary from the self-hosted Sentry server at `https://sentry.yottastudios.com`, scoped exclusively to the **`px` team**. Support both Chinese (中文) and English input and output — detect the user's language and respond in the same language.

## Configuration

| Parameter | Source | Value |
|-----------|--------|-------|
| Base URL | Hardcoded | `https://sentry.yottastudios.com` |
| Auth Token | Environment variable | `SENTRY_AUTH_TOKEN` |
| Organization slug | User input or auto-discovered | e.g. `yottastudios` |
| Team slug | Hardcoded | `px` |

### Token Setup (first-time flow)

Check whether `SENTRY_AUTH_TOKEN` is set before making any API call:

```bash
echo "$SENTRY_AUTH_TOKEN"
```

If the output is empty, run this first-time setup flow:

1. **Ask the user** for their Sentry auth token. Tell them tokens can be created at:
   `https://sentry.yottastudios.com/settings/account/api/auth-tokens/`
   Required scopes: `org:read`, `project:read`, `event:read`

2. **Persist the token** to the user's shell profile so future sessions have it automatically. Detect the platform and write to the appropriate file:

   **Windows (PowerShell profile or setx):**
   ```powershell
   # Persist for all future sessions
   [System.Environment]::SetEnvironmentVariable("SENTRY_AUTH_TOKEN", "<token>", "User")
   ```

   **macOS / Linux — detect the shell and append to its profile:**
   ```bash
   # Detect active shell profile
   PROFILE=""
   if [ -n "$ZSH_VERSION" ] || [ "$(basename "$SHELL")" = "zsh" ]; then
     PROFILE="$HOME/.zshrc"
   elif [ -n "$BASH_VERSION" ] || [ "$(basename "$SHELL")" = "bash" ]; then
     PROFILE="$HOME/.bashrc"
     [ "$(uname)" = "Darwin" ] && PROFILE="$HOME/.bash_profile"
   fi

   if [ -n "$PROFILE" ]; then
     echo 'export SENTRY_AUTH_TOKEN="<token>"' >> "$PROFILE"
   fi
   ```

3. **Export for the current session** so the skill can use the token immediately without requiring a shell restart:

   ```bash
   export SENTRY_AUTH_TOKEN="<token>"
   ```

   On Windows, also set it in the current process:
   ```powershell
   $env:SENTRY_AUTH_TOKEN = "<token>"
   ```

4. **Confirm** to the user: "Token saved — it will be available in all future terminal sessions, and it's active right now."

5. Continue with the rest of the workflow using the newly set token.

## Workflow

### Step 1: Resolve organization slug

If the user hasn't specified an organization, fetch the list:

```
GET https://sentry.yottastudios.com/api/0/organizations/
Authorization: Bearer <SENTRY_AUTH_TOKEN>
```

If only one organization exists, use it automatically. If multiple exist, list them and ask the user to choose.

### Step 2: Fetch px team projects

Fetch the projects that belong to the `px` team. This is always required — all subsequent queries are scoped to these projects.

```
GET https://sentry.yottastudios.com/api/0/teams/{org}/px/projects/
Authorization: Bearer <SENTRY_AUTH_TOKEN>
```

Extract the `slug` and `id` of every project in the response. If the response is empty or the team is not found, stop and report: "No projects found for the `px` team in organization `{org}`."

Build a query string fragment by repeating `project=<slug>` for each project:
```
project=proj-a&project=proj-b&project=proj-c
```
This fragment (call it `{px_projects}`) is appended to every subsequent request.

### Step 3: Fetch summary data in parallel

Run all of the following requests concurrently using the Bash tool with background processes or multiple tool calls. All requests are scoped to the px team's projects via `{px_projects}`.

**a) Recent unresolved issues (top 25)**
```
GET https://sentry.yottastudios.com/api/0/organizations/{org}/issues/?query=is:unresolved&limit=25&sort=date&{px_projects}
```

**b) Recent events (last 24 hours)**
```
GET https://sentry.yottastudios.com/api/0/organizations/{org}/events/?field=title&field=project&field=timestamp&field=level&statsPeriod=24h&limit=20&{px_projects}
```

**c) Error stats (error rate over time)**
```
GET https://sentry.yottastudios.com/api/0/organizations/{org}/stats_v2/?field=sum(quantity)&groupBy=outcome&statsPeriod=24h&interval=1h&category=error&{px_projects}
```

Use `curl` with the auth header:
```bash
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" "<url>"
```

See `references/api.md` for full endpoint details and query parameters.

### Step 4: Filter by project (optional)

If the user specified a project name, additionally narrow the results by keeping only that project's data from the already-fetched px team results. Do not expand scope beyond the px team.

### Step 5: Present the summary

Always match the user's language — respond in Chinese if the request was in Chinese, English otherwise.

Use this report structure:

---

## Sentry 摘要 / Sentry Summary

**服务器 / Server:** https://sentry.yottastudios.com
**组织 / Organization:** `{org}`
**团队 / Team:** `px`
**时间范围 / Period:** 过去24小时 / Last 24 hours
**生成时间 / Generated:** {timestamp}

---

### 📊 项目概览 / Project Overview

| 项目 / Project | 未解决问题 / Open Issues | 最后事件 / Last Event |
|----------------|--------------------------|----------------------|
| project-a      | 42                       | 2 分钟前 / 2 min ago  |

---

### 🔥 最新未解决问题 / Top Unresolved Issues

List top 10 issues sorted by last seen, including:
- Issue title (truncate at 80 chars)
- Project name
- Error level (error/warning/info/fatal)
- Count of events
- First seen / Last seen
- Direct link: `https://sentry.yottastudios.com/organizations/{org}/issues/{id}/`

---

### ⚡ 最近事件 / Recent Events (24h)

List up to 10 recent events with timestamp, level, title, and project.

---

### 📈 错误趋势 / Error Trend (24h)

Show hourly error counts as a simple text sparkline or table. Highlight any spikes.

---

## Language Guidelines

- If the user writes in Chinese (简体或繁体), respond entirely in Chinese. Use 中文 section headers, Chinese date formats, and Chinese error level names (错误/警告/信息/严重).
- If the user writes in English, respond in English.
- Issue titles and stack traces from Sentry should be kept in their original language (usually English) regardless of the response language.
- Timestamps: use the user's apparent locale. Chinese users get `YYYY年MM月DD日 HH:mm`, English users get ISO 8601.

## Error Handling

- **401 Unauthorized**: The token is invalid or has been revoked. Re-run the first-time setup flow to replace it — remove the old export line from the shell profile first, then repeat the setup steps.
- **403 Forbidden**: The token lacks required scopes. Required scopes: `org:read`, `project:read`, `event:read`.
- **404 Not Found**: Organization slug is wrong. Re-fetch the org list and prompt the user.
- **Connection refused / timeout**: The server `https://sentry.yottastudios.com` may be unreachable from this machine. Report the error clearly.

## Additional Resources

- **`references/api.md`** — Full Sentry API endpoint reference, query parameters, and response schemas for this server
