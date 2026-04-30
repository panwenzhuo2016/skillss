# Sentry API Reference

## Base URL

```
https://sentry.yottastudios.com
```

## Authentication

All requests require a Bearer token:

```
Authorization: Bearer $SENTRY_AUTH_TOKEN
```

---

## Endpoints

### Get Issue Details

```
GET /api/0/issues/{issue_id}/
```

Returns full details for a single issue.

**Response fields:**

| Field | Type | Description |
|---|---|---|
| `id` | string | Numeric issue ID |
| `shortId` | string | Human-readable ID (e.g. `PROJECT-123`) |
| `title` | string | Issue title |
| `culprit` | string | Function or module where error occurred |
| `level` | string | Severity: `error`, `warning`, `info`, etc. |
| `count` | string | Total event count |
| `firstSeen` | string | ISO 8601 timestamp |
| `lastSeen` | string | ISO 8601 timestamp |
| `project` | object | `{ slug, name }` |
| `permalink` | string | URL to issue in Sentry UI |
| `status` | string | `unresolved`, `resolved`, `ignored` |
| `assignedTo` | object/null | Assigned user or team |
| `metadata` | object | Additional metadata (type, value, filename) |

**curl example:**

```bash
curl -s \
  -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.yottastudios.com/api/0/issues/{issue_id}/"
```

---

### Get Issue Events (with stacktrace)

```
GET /api/0/issues/{issue_id}/events/?limit=3
```

Returns recent events for the issue, each with full stacktrace data.

**Response:** Array of event objects. Each event has an `entries` array.

**Parsing stacktrace:**

1. Find entries where `type == "exception"`
2. The exception entry has `data.values[]` — each element has:
   - `type` — exception class name
   - `value` — exception message
   - `stacktrace.frames[]` — list of stack frames (innermost last)

**Stack frame fields:**

| Field | Type | Description |
|---|---|---|
| `filename` | string | Relative file path |
| `absPath` | string | Absolute file path |
| `module` | string | Module name |
| `function` | string | Function/method name |
| `lineNo` | int | Line number |
| `colNo` | int | Column number |
| `context` | array | `[[line_number, code_line], ...]` surrounding code |
| `inApp` | boolean | `true` if application code (not library) |

Focus on frames where `inApp == true` for application-level debugging.

**curl example:**

```bash
curl -s \
  -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.yottastudios.com/api/0/issues/{issue_id}/events/?limit=3"
```

---

### Search Issues by shortId

```
GET /api/0/organizations/{org}/issues/?query={shortId}
```

Search for an issue using its shortId (e.g. `PROJECT-123`).

**Returns:** Array of matching issues. Take the first result.

**curl example:**

```bash
curl -s \
  -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.yottastudios.com/api/0/organizations/{org}/issues/?query=PROJECT-123"
```

---

### Get Latest Event

```
GET /api/0/issues/{issue_id}/events/latest/
```

Returns the most recent event for the issue with full detail including stacktrace and breadcrumbs.

**curl example:**

```bash
curl -s \
  -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.yottastudios.com/api/0/issues/{issue_id}/events/latest/"
```

---

## Pagination

Sentry uses **cursor-based pagination**. Check the `Link` response header for `next` and `prev` cursors.

Example `Link` header:

```
Link: <https://sentry.yottastudios.com/api/0/issues/?cursor=0:25:0>; rel="next"; results="true"; cursor="0:25:0"
```

Pass the cursor value as a `cursor` query parameter to fetch the next page:

```bash
curl -s \
  -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.yottastudios.com/api/0/issues/?cursor=0:25:0"
```
