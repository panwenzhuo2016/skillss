# Sentry API Reference

Base URL: `https://sentry.yottastudios.com`
Auth header: `Authorization: Bearer $SENTRY_AUTH_TOKEN`

Required token scopes: `org:read`, `project:read`, `event:read`

---

## Organizations

### List organizations
```
GET /api/0/organizations/
```
Response fields: `slug`, `name`, `id`, `dateCreated`

### Organization stats (v2)
```
GET /api/0/organizations/{org}/stats_v2/
```
| Parameter | Description | Example |
|-----------|-------------|---------|
| `field` | Metric to aggregate | `sum(quantity)` |
| `groupBy` | Dimension | `outcome`, `project`, `reason` |
| `statsPeriod` | Relative time window | `24h`, `7d`, `30d` |
| `start` / `end` | Absolute range (ISO 8601) | `2024-01-01T00:00:00` |
| `interval` | Bucket size | `1h`, `1d` |
| `category` | Data category | `error`, `transaction`, `attachment` |
| `outcome` | Filter by outcome | `accepted`, `rate_limited`, `filtered` |

**Example — hourly error counts for last 24h:**
```bash
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.yottastudios.com/api/0/organizations/{org}/stats_v2/?field=sum(quantity)&groupBy=outcome&statsPeriod=24h&interval=1h&category=error"
```

---

## Teams

### List projects for a team
```
GET /api/0/teams/{org}/{team}/projects/
```
Response fields per project: `id`, `slug`, `name`, `platform`, `firstEvent`, `lastEvent`, `hasAccess`, `isMember`

This is the primary way to scope all queries to the `px` team. Extract `slug` and `id` from the response and pass them as repeated `project=<slug>` query params to issue, event, and stats endpoints.

**Example — px team projects:**
```bash
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.yottastudios.com/api/0/teams/yottastudios/px/projects/"
```

---

## Projects

### List projects (org-wide)
```
GET /api/0/organizations/{org}/projects/
```
Response fields per project: `id`, `slug`, `name`, `platform`, `stats` (last 24h event counts), `firstEvent`, `lastEvent`, `hasAccess`, `isMember`

Useful query params:
- `all_projects=1` — include projects you're not a member of (requires org:read)

---

## Issues

### List issues
```
GET /api/0/organizations/{org}/issues/
```

| Parameter | Description | Example |
|-----------|-------------|---------|
| `query` | Sentry search query | `is:unresolved`, `is:unresolved level:error` |
| `project` | Filter by project ID or slug | `my-project` |
| `sort` | Sort order | `date` (last seen), `new`, `freq`, `priority` |
| `limit` | Max results (1–100) | `25` |
| `cursor` | Pagination cursor | from `Link` response header |
| `statsPeriod` | Issues active in window | `24h`, `7d` |
| `environment` | Filter by environment | `production` |

**Useful query strings:**
- `is:unresolved` — all open issues
- `is:unresolved level:error` — only errors
- `is:unresolved level:fatal` — fatal only
- `is:unresolved !has:assignee` — unassigned issues
- `is:unresolved times_seen:>100` — high-frequency issues

Response fields per issue: `id`, `title`, `culprit`, `permalink`, `firstSeen`, `lastSeen`, `count` (event count), `userCount`, `level`, `status`, `project` (object with `slug`/`name`), `assignedTo`, `isBookmarked`, `metadata`

**Example — top 25 unresolved issues sorted by recency:**
```bash
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.yottastudios.com/api/0/organizations/{org}/issues/?query=is:unresolved&limit=25&sort=date"
```

### Get single issue
```
GET /api/0/issues/{issue_id}/
```

### List issue events
```
GET /api/0/issues/{issue_id}/events/
```

---

## Events

### List organization events
```
GET /api/0/organizations/{org}/events/
```

| Parameter | Description | Example |
|-----------|-------------|---------|
| `field` | Fields to include | `title`, `project`, `timestamp`, `level`, `error.type` |
| `query` | Filter query | `level:error`, `project:my-app` |
| `statsPeriod` | Time window | `24h`, `7d` |
| `start` / `end` | Absolute range | ISO 8601 |
| `limit` | Max results | `20` |
| `sort` | Sort field | `-timestamp` (newest first) |
| `environment` | Filter by environment | `production` |

**Example — recent error events last 24h:**
```bash
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.yottastudios.com/api/0/organizations/{org}/events/?field=title&field=project&field=timestamp&field=level&statsPeriod=24h&limit=20&sort=-timestamp"
```

---

## Performance / Transactions

### Transaction summary
```
GET /api/0/organizations/{org}/events/
```
Add `query=event.type:transaction` and fields like `transaction`, `p50()`, `p95()`, `failure_rate()`, `count()`.

**Example — slowest transactions:**
```bash
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.yottastudios.com/api/0/organizations/{org}/events/?field=transaction&field=count()&field=p95()&field=failure_rate()&query=event.type:transaction&sort=-p95&statsPeriod=24h&limit=10"
```

---

## Pagination

Sentry uses cursor-based pagination. Check the `Link` response header:

```
Link: <url>; rel="previous"; results="false"; cursor="0:0:1",
      <url>; rel="next"; results="true"; cursor="0:100:0"
```

Pass `cursor=<value>` to fetch the next page.

---

## Error Level Values

| Level | 中文 | Severity |
|-------|------|----------|
| `fatal` | 严重 | Highest |
| `error` | 错误 | High |
| `warning` | 警告 | Medium |
| `info` | 信息 | Low |
| `debug` | 调试 | Lowest |

---

## Common curl Pattern

```bash
# Set these before running
export SENTRY_AUTH_TOKEN="your-token-here"
ORG="your-org-slug"
BASE="https://sentry.yottastudios.com"

# List projects
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" "$BASE/api/0/organizations/$ORG/projects/" | python3 -m json.tool

# Top issues
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "$BASE/api/0/organizations/$ORG/issues/?query=is:unresolved&sort=date&limit=25" | python3 -m json.tool
```
