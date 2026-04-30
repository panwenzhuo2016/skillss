# Grafana / Loki API 参考

## 访问方式

Loki 通过 Grafana 的 datasource proxy 访问：

```
https://xgrafana.xtool-staging.yottastudios.com/api/datasources/proxy/2/loki/api/v1/
```

## 认证

HTTP Basic Auth，凭据从 `deploy-config.json` 的 `grafana` 字段读取：

```bash
-u "pxtool:pxtool123"
```

## 查询日志：query_range

```
GET /query_range
```

### 参数

| 参数 | 说明 |
|------|------|
| `query` | LogQL 查询（需 URL 编码） |
| `start` | 开始时间（纳秒级 epoch） |
| `end` | 结束时间（纳秒级 epoch） |
| `limit` | 最大返回行数（建议 `100`） |
| `direction` | `backward`（最新优先）或 `forward`（最旧优先） |

### 响应

```json
{
  "status": "success",
  "data": {
    "resultType": "streams",
    "result": [
      {
        "stream": { "app": "echo-server", "namespace": "echo" },
        "values": [
          ["1712345678000000000", "Server started on port 8081"],
          ["1712345679000000000", "Connected to database"]
        ]
      }
    ]
  }
}
```

**务必保存到文件再读取**：

```bash
curl -s -u "pxtool:pxtool123" \
  "https://xgrafana.xtool-staging.yottastudios.com/api/datasources/proxy/2/loki/api/v1/query_range?query={url_encoded_query}&start={start_ns}&end={end_ns}&limit=100" \
  > /tmp/loki-deploy-{n}.log
```

## 时间转换

```bash
# 当前时间的纳秒 epoch
END_NS=$(date +%s)000000000
# 5 分钟前
START_NS=$(($(date +%s) - 300))000000000
```

## 部署验证用的 LogQL 查询

### 查看服务全部日志

```logql
{app="{project_name}"}
```

### 查看启动成功信号

```logql
{app="{project_name}"} |~ "(?i)started|listening|ready|running"
```

### 查看错误日志

```logql
{app="{project_name}"} |~ "(?i)error|exception|fatal" !~ "healthcheck|ping"
```

### 列出可用的 app 标签

```bash
curl -s -u "pxtool:pxtool123" \
  "https://xgrafana.xtool-staging.yottastudios.com/api/datasources/proxy/2/loki/api/v1/label/app/values" \
  > /tmp/loki-labels.json
```

用这个确认新部署的服务是否已经出现在 Loki 的标签中。如果 `{project_name}` 不在列表里，说明 Pod 还没启动或日志还没被采集。
