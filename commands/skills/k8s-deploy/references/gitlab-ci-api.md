# GitLab CI Pipeline API 参考

## 认证

所有请求需要 `PRIVATE-TOKEN` header：

```
PRIVATE-TOKEN: $GITLAB_TOKEN
```

## 获取项目 ID

通过项目路径查找项目 ID（用于后续 API 调用）：

```bash
curl -s -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://pt-gitlab.yottastudios.com/api/v4/projects?search={project_name}&simple=true" \
  | python3 -c "import sys,json; projects=json.load(sys.stdin); print([p for p in projects if p['path_with_namespace']=='{gitlab_path}'][0]['id'])"
```

也可以用 URL-encoded 路径直接获取：

```bash
# 将 px/somegroup/my-project 编码为 px%2Fsomegroup%2Fmy-project
curl -s -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://pt-gitlab.yottastudios.com/api/v4/projects/{url_encoded_path}"
```

## 获取最新 Pipeline

```bash
curl -s -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://pt-gitlab.yottastudios.com/api/v4/projects/{project_id}/pipelines?ref={branch}&per_page=1" \
  > /tmp/pipeline-status.json
```

返回数组，第一个元素是最新 pipeline：
```json
[{"id": 12345, "status": "running", "ref": "master", "sha": "abc123"}]
```

Pipeline status 可能的值：`created`, `waiting_for_resource`, `preparing`, `pending`, `running`, `success`, `failed`, `canceled`, `skipped`, `manual`, `scheduled`

## 轮询 Pipeline 状态

```bash
curl -s -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://pt-gitlab.yottastudios.com/api/v4/projects/{project_id}/pipelines/{pipeline_id}"
```

返回单个 pipeline 对象：
```json
{"id": 12345, "status": "success", "ref": "master"}
```

轮询策略：每 15 秒查询一次，最多等待 10 分钟。

## 获取 Pipeline 的 Jobs

```bash
curl -s -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://pt-gitlab.yottastudios.com/api/v4/projects/{project_id}/pipelines/{pipeline_id}/jobs"
```

返回 job 数组，每个 job 有 `id`, `name`, `status`, `stage`。

## 读取 Job 日志

```bash
curl -s -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://pt-gitlab.yottastudios.com/api/v4/projects/{project_id}/jobs/{job_id}/trace" \
  > /tmp/ci-job-{job_id}.log
```

返回纯文本日志。**务必保存到文件再读取**，不要直接 pipe。

## 常见用法

### 等待 CI 完成并检查结果

```bash
# 1. 获取最新 pipeline ID
PIPELINE_ID=$(curl -s -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://pt-gitlab.yottastudios.com/api/v4/projects/{project_id}/pipelines?ref=master&per_page=1" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

# 2. 轮询状态
while true; do
  STATUS=$(curl -s -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
    "https://pt-gitlab.yottastudios.com/api/v4/projects/{project_id}/pipelines/$PIPELINE_ID" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
  echo "Pipeline $PIPELINE_ID: $STATUS"
  if [ "$STATUS" = "success" ] || [ "$STATUS" = "failed" ]; then break; fi
  sleep 15
done

# 3. 如果失败，读取失败 job 的日志
if [ "$STATUS" = "failed" ]; then
  FAILED_JOBS=$(curl -s -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
    "https://pt-gitlab.yottastudios.com/api/v4/projects/{project_id}/pipelines/$PIPELINE_ID/jobs" \
    | python3 -c "import sys,json; [print(j['id'],j['name']) for j in json.load(sys.stdin) if j['status']=='failed']")
  # 读取每个失败 job 的日志
fi
```
