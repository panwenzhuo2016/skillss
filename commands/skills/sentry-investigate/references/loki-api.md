# Grafana / Loki API Reference

## Access

Loki is accessed via the Grafana datasource proxy:

```
https://xgrafana.yottastudios.com/api/datasources/proxy/2/loki/api/v1/
```

## Authentication

HTTP Basic Auth:

```bash
-u "$GRAFANA_USER:$GRAFANA_PASSWORD"
```

---

## Key Endpoint: query_range

```
GET /query_range
```

Query logs over a time range.

### Parameters

| Parameter | Description |
|---|---|
| `query` | LogQL query string (URL-encoded) |
| `start` | Start time — nanosecond epoch or RFC3339Nano |
| `end` | End time — nanosecond epoch or RFC3339Nano |
| `limit` | Max log lines to return (use `100`) |
| `direction` | `backward` (newest first) or `forward` (oldest first) |

### Response Structure

```json
{
  "status": "success",
  "data": {
    "resultType": "streams",
    "result": [
      {
        "stream": { "<label_name>": "<label_value>", "..." : "..." },
        "values": [
          ["<timestamp_nanoseconds>", "<log_line>"],
          ["...", "..."]
        ]
      }
    ]
  }
}
```

Each element in `values` is a `[timestamp_ns, log_line]` pair. Timestamps are nanosecond epoch strings.

### IMPORTANT: Always Save Output to File First

Do not pipe curl output directly. Save to a file, then read it with the Read tool:

```bash
curl -s -u "$GRAFANA_USER:$GRAFANA_PASSWORD" \
  "https://xgrafana.yottastudios.com/api/datasources/proxy/2/loki/api/v1/query_range?query={url_encoded_query}&start={start_ns}&end={end_ns}&limit=100" \
  > /tmp/loki-{shortId}-{n}.log
```

Use an incrementing `{n}` (1, 2, 3...) for multiple queries on the same issue to avoid overwriting files.

---

## LogQL Patterns

### Filter by app label

```logql
{app="collabspace-server"}
```

### Keyword match (case sensitive)

```logql
{app="collabspace-server"} |~ "StatusRuntimeException"
```

### Case insensitive match

```logql
{app="collabspace-server"} |~ "(?i)error"
```

### Multiple keywords (OR)

```logql
{app="collabspace-server"} |~ "keyword1|keyword2"
```

### Exclude noise

```logql
{app="collabspace-server"} !~ "healthcheck|ping"
```

### JSON parsing and field filtering

```logql
{app="collabspace-server"} | json | level="error"
```

Parse JSON log lines with `| json`, then filter on extracted fields.

### Combined example

```logql
{app="collabspace-server"} |~ "(?i)exception" !~ "healthcheck|ping" | json
```

---

## Time Conversion

### ISO timestamp to nanoseconds

```bash
# Get seconds since epoch
date -d "2026-04-02T08:00:00Z" +%s
# → 1743580800

# Append 9 zeros to convert to nanoseconds
# → 1743580800000000000
```

### Relative time offsets

| Duration | Nanoseconds |
|---|---|
| 1 minute | `60000000000` |
| 5 minutes | `300000000000` |
| 15 minutes | `900000000000` |
| 1 hour | `3600000000000` |

To query the 15 minutes around a Sentry event timestamp:

```bash
EVENT_TIME_NS=1743580800000000000
START=$((EVENT_TIME_NS - 900000000000))
END=$((EVENT_TIME_NS + 900000000000))
```

---

## Other Useful Endpoints

### List label names

```
GET /labels
```

```bash
curl -s -u "$GRAFANA_USER:$GRAFANA_PASSWORD" \
  "https://xgrafana.yottastudios.com/api/datasources/proxy/2/loki/api/v1/labels"
```

### List values for a label

```
GET /label/{name}/values
```

```bash
curl -s -u "$GRAFANA_USER:$GRAFANA_PASSWORD" \
  "https://xgrafana.yottastudios.com/api/datasources/proxy/2/loki/api/v1/label/app/values"
```

Use these to discover available `app` label values when the app name is unknown.
