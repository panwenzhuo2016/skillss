# Sentry 自动化排查系统 — 设计与技术文档

**版本:** 1.0.0
**日期:** 2026-04-02
**状态:** 已实现

---

## 1. 系统概述

### 1.1 背景与目标

PX 团队管理着十余个微服务（collabspace、apitable、echo、affine、map 等），运行在 Kubernetes 集群上，错误通过自建 Sentry 采集。日常值班面临两个核心痛点：

1. **逐个排查耗时** — 每个 Sentry issue 都需要人工：看堆栈 → 拉代码 → 查日志 → 跨服务追查，一个 issue 20-60 分钟。
2. **批量积压** — 未解决 issue 堆积，无法及时评估优先级和影响范围。

本系统利用 Claude Code 的 Skill 机制，实现 **AI 驱动的全自动 Sentry issue 根因分析**，支持单个交互式排查和批量并行排查两种模式。

### 1.2 核心能力

| 能力 | 说明 |
|------|------|
| 自动拉堆栈 | 调 Sentry API 获取 issue 详情和完整 stacktrace |
| 自动拉代码 | 通过 GitLab token 克隆/更新对应仓库，定位报错源码 |
| 自动查日志 | 通过 Grafana/Loki API 查询运行时日志，获取请求上下文 |
| 跨服务追查 | 识别关联服务并追踪错误传播链路 |
| 智能决策 | Agent 自主判断调查深度，不做多余操作 |
| 结构化报告 | 输出含 YAML frontmatter 的标准化 Markdown 报告 |
| 批量编排 | Python 脚本并行派发多个 Claude CLI 实例 |
| 智能去重 | 基于已有报告和事件数增长倍率跳过重复调查 |

---

## 2. 系统架构

### 2.1 整体架构

```
                    ┌──────────────────────────────────────────────┐
                    │              用户 / 定时任务                    │
                    └───────┬──────────────────┬───────────────────┘
                            │                  │
                   交互模式  │                  │ 批量模式
                            ▼                  ▼
                ┌───────────────┐    ┌──────────────────────┐
                │  Claude Code  │    │ batch_investigate.py │
                │  /sentry-     │    │  Python 编排脚本       │
                │  investigate  │    └──────┬───────────────┘
                └───────┬───────┘           │
                        │            ┌──────┴──────┐
                        │            │ 预处理阶段    │
                        │            │ 1. 拉issue列表│
                        │            │ 2. 预拉事件   │
                        │            │ 3. 去重       │
                        │            │ 4. git clone  │
                        │            └──────┬──────┘
                        │                   │
                        │            ┌──────┴──────┐
                        │            │ 并行派发      │
                        │            │ N个Claude CLI │
                        │            └──────┬──────┘
                        │                   │
                        ▼                   ▼
              ┌─────────────────────────────────────┐
              │         SKILL.md 调查流程             │
              │  Step 1: 解析输入                     │
              │  Step 2: 拉代码 + 定位报错点           │
              │  Step 3: 深入调查（Loki/跨服务）       │
              │  Step 4: 生成报告                     │
              └─────────┬───────────────────────────┘
                        │
            ┌───────────┼───────────┬────────────┐
            ▼           ▼           ▼            ▼
      ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
      │ Sentry   │ │ GitLab   │ │ Loki     │ │ 本地代码  │
      │ API      │ │ API/Git  │ │ API      │ │          │
      └──────────┘ └──────────┘ └──────────┘ └──────────┘
```

### 2.2 文件结构

```
sentry-investigate/
├── SKILL.md                        # 主调查流程定义（交互+批量双模式）
├── batch_investigate.py            # 批量编排脚本（Python）
└── references/
    ├── project-mapping.json        # 项目映射配置（Sentry→GitLab→Loki）
    ├── sentry-api.md               # Sentry API 参考
    ├── loki-api.md                 # Grafana/Loki 查询参考
    └── gitlab-api.md               # GitLab API 参考
```

### 2.3 数据流

```
Sentry Issue ──→ Issue详情 + Stacktrace ──→ 源码定位 ──→ [可选]Loki日志
                                                         ──→ [可选]跨服务追查
                                                              ──→ 结构化报告(.md)
```

---

## 3. 数据源与认证

### 3.1 外部服务

| 数据源 | 地址 | 认证方式 | 用途 |
|--------|------|---------|------|
| Sentry | `https://sentry.yottastudios.com` | Bearer Token (`SENTRY_AUTH_TOKEN`) | Issue 详情、堆栈、事件数据 |
| GitLab | `https://pt-gitlab.yottastudios.com` | OAuth2 Token (`GITLAB_TOKEN`) | 源码仓库克隆和更新 |
| Grafana/Loki | `https://xgrafana.yottastudios.com` (Loki datasource ID: 2) | HTTP Basic Auth (`GRAFANA_USER` / `GRAFANA_PASSWORD`) | 运行时日志查询 |

### 3.2 环境变量

| 变量 | 必需场景 | 创建地址 |
|------|---------|---------|
| `SENTRY_AUTH_TOKEN` | 交互模式 + 编排脚本 | `https://sentry.yottastudios.com/settings/account/api/auth-tokens/` (scopes: `org:read`, `project:read`, `event:read`) |
| `GITLAB_TOKEN` | 交互模式 + 编排脚本 | `https://pt-gitlab.yottastudios.com/-/user_settings/personal_access_tokens` (scope: `api`) |
| `GRAFANA_USER` | 两种模式（子 agent 查日志） | 向管理员获取 |
| `GRAFANA_PASSWORD` | 两种模式（子 agent 查日志） | 向管理员获取 |

### 3.3 本地路径

| 路径 | 用途 |
|------|------|
| `/home/username/Sentry/projects/` | git clone 后的代码仓库 |
| `/home/username/Sentry/reports/` | 调查报告输出目录 |
| `/tmp/sentry-batch/` | 批量模式临时文件（issue.json, event.json） |
| `/tmp/loki-{shortId}-{n}.log` | Loki 日志查询临时文件 |

---

## 4. 项目映射

### 4.1 应用服务映射

`project-mapping.json` 定义了 Sentry 项目与 GitLab 仓库、Loki 日志标签的对应关系：

| Sentry 项目 | GitLab 路径 | Loki app label | 说明 |
|-------------|-------------|----------------|------|
| collabspace-server | `px/collabspace/collabspace-server` | `collabspace-server` | 协作空间后端 |
| collabspace-web | `px/collabspace/collabspace-web` | `collabspace-web` | 协作空间前端 |
| apitable-backend-server | `px/apitable/apitable` | `backend-server` | APITable 后端（monorepo） |
| apitable-web-server | `px/apitable/apitable` | `web-server` | APITable Web 服务（monorepo） |
| apitable-room-server | `px/apitable/apitable` | `room-server` | APITable Room 服务（monorepo） |
| echo-server | `px/echo/echo-server` | `echo-server` | Echo 后端 |
| echo-web | `px/echo/echo-web` | `echo-node` | Echo 前端 |
| affine-backend | `px/affine/affine` | `affine` | Affine 后端（monorepo） |
| affine-frontend | `px/affine/affine` | `affine-frontend-prod` | Affine 前端（monorepo） |
| map-server | `px/xmap/map-server` | `map-server` | 地图后端 |
| map-web | `px/xmap/map-web` | （无） | 地图前端 |
| jas | `px/apitable/jas` | `jas` | JAS 服务 |
| nextspace | `px/nextspace/nextspace` | （无） | NextSpace |

### 4.2 基础设施仓库

| 名称 | GitLab 路径 | 分支 | 用途 |
|------|-------------|------|------|
| Nginx Gateway | `px/collabspace-prod/gateway` | `aio-service` | 服务路由和反向代理规则 |
| K8s 部署 | `px/collabspace-prod/kubernetes` | `aio-service` | 服务部署拓扑和配置 |

### 4.3 Monorepo 说明

以下 Sentry 项目共享同一个 GitLab 仓库，clone 时按仓库去重：

- `apitable-backend-server` / `apitable-web-server` / `apitable-room-server` → `px/apitable/apitable`
- `affine-backend` / `affine-frontend` → `px/affine/affine`

---

## 5. 调查流程详解

### 5.1 Step 1：解析 Issue 输入

支持三种输入方式：

| 输入类型 | 示例 | 处理方式 |
|---------|------|---------|
| Sentry URL | `https://sentry.yottastudios.com/.../issues/29771/` | 从 URL 提取 issue ID，调 `GET /api/0/issues/{id}/` |
| shortId | `COLLABSPACE-SERVER-20` | 调 `GET /api/0/organizations/yotta/issues/?query={shortId}` |
| 批量模式 | 编排脚本提供 `issue.json` + `event.json` | 直接读文件，跳过 API 调用 |
| 会话上下文 | 从 `/sentry-summary` 结果选择 | 提取上下文中的 issue 信息 |

解析后获取：
1. Issue 详情 — `title`, `shortId`, `level`, `count`, `firstSeen`, `lastSeen`, `project.slug`, `permalink`
2. 最新事件的完整 stacktrace — 通过 `GET /api/0/issues/{id}/events/latest/`

**Stacktrace 解析要点：**
- 标准异常：`entries[type="exception"] → data.values[].stacktrace.frames[]`
- Java 日志追加器：`entries[type="threads"] → data.values[].stacktrace.frames[]`
- 关注 `inApp == true` 的帧（应用代码）
- 关键字段：`filename`, `lineNo`, `function`, `context`

### 5.2 Step 2：拉代码 + 定位报错点

1. 从 `project-mapping.json` 查找 Sentry 项目对应的 `gitlab_path`
2. 确定本地路径 `/home/username/Sentry/projects/{repo_name}`（取 gitlab_path 最后一段）
3. 代码获取：
   - **交互模式** — 不存在则 `git clone`，存在则 `git pull`
   - **批量模式** — 代码已由编排脚本预拉，跳过 git 操作
4. 根据 stacktrace 中的文件路径和行号，用 Read 工具读取对应源码
5. 分析代码上下文：函数逻辑、调用链、异常处理

```bash
# Clone（交互模式）
git clone https://oauth2:$GITLAB_TOKEN@pt-gitlab.yottastudios.com/{gitlab_path}.git \
  /home/username/Sentry/projects/{repo_name}

# 基础设施仓库需指定分支
git clone -b aio-service https://oauth2:$GITLAB_TOKEN@pt-gitlab.yottastudios.com/{gitlab_path}.git \
  /home/username/Sentry/projects/{repo_name}
```

### 5.3 Step 3：深入调查（Agent 自主决策）

Agent 根据 Step 2 的分析结果，自主判断是否需要深入调查。**如果仅从堆栈 + 源码就能明确根因，直接跳到 Step 4。**

#### 手段 A：查 Loki 日志

适用场景：需要运行时上下文（请求参数、调用链路、时序信息）。

```bash
# 查询模式：核心关键词 + 短时间窗口（lastSeen 前后 5 分钟），limit 100
curl -s -u "$GRAFANA_USER:$GRAFANA_PASSWORD" \
  "https://xgrafana.yottastudios.com/api/datasources/proxy/2/loki/api/v1/query_range\
?query=%7Bapp%3D%22{loki_app}%22%7D%20%7C~%20%22{keyword}%22\
&start={start_ns}&end={end_ns}&limit=100" \
  > /tmp/loki-{shortId}-1.log
```

LogQL 常用模式：
- 按 app 过滤：`{app="collabspace-server"}`
- 关键词匹配：`|~ "StatusRuntimeException"`
- 不区分大小写：`|~ "(?i)error"`
- 多关键词 OR：`|~ "keyword1|keyword2"`
- 排除噪声：`!~ "healthcheck|ping"`
- JSON 解析：`| json | level="error"`

查询策略：**逐步收窄** — 先用核心关键词宽查，从结果中提取 traceId / requestId，再精确查。

#### 手段 B：跨服务追查

适用场景：日志或代码指向其他服务为根因（HTTP 调用返回异常、gRPC 错误、消息队列消费失败等）。

1. 在 `project-mapping.json` 中找到关联服务
2. 对关联服务执行 Step 2（拉代码分析）和/或手段 A（查日志）
3. 可查看基础设施仓库（gateway、kubernetes）理解路由和部署拓扑
4. 追查深度无固定限制，按需追踪

### 5.4 Step 4：生成报告

#### 报告目录结构

```
/home/username/Sentry/reports/
└── {YYYY-MM-DD}/
    └── {project_slug}/
        └── {priority}/
            └── {shortId}-{brief_description}.md
```

示例：`reports/2026-04-02/collabspace-server/P3/COLLABSPACE-SERVER-52-上传时间格式误报.md`

#### 报告模板（含 YAML Frontmatter）

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
（1-2 句话简述根因）

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
评判依据：错误频率、是否 fatal、影响范围、是否恶化

## 影响范围
（受影响的服务和用户场景）

## 建议修复方案
（具体修复建议，指出文件和代码位置）
```

#### 紧急程度评判标准

| 级别 | 条件 |
|------|------|
| **P0 - 紧急** | fatal 级别；或核心功能不可用；或错误数急剧上升 |
| **P1 - 高** | error 级别且影响用户操作；或持续恶化趋势 |
| **P2 - 中** | error 级别但影响有限；或有 workaround |
| **P3 - 低** | warning/info 级别；或极低频率；或仅影响边缘场景 |

---

## 6. 批量编排系统

### 6.1 概述

`batch_investigate.py` 是一个 Python 编排脚本，负责：拉 Sentry issue 列表 → 预拉事件详情 → 去重 → git clone/pull → 并行派发 Claude CLI 子进程 → 输出汇总。

### 6.2 使用方式

```bash
# 最近 10 个未解决 issue，3 个并行
python batch_investigate.py --top 10 --parallel 3

# 过去 24 小时有新事件的 issue，限定项目
python batch_investigate.py --last 24h --project collabspace-server --parallel 5

# 多个项目
python batch_investigate.py --top 20 --project collabspace-server --project echo-web --parallel 3
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--top N` | 取最近 N 个未解决 issue（按 lastSeen 排序） | 10 |
| `--last PERIOD` | 取指定时间内有新事件的 issue（如 `24h`、`7d`） | — |
| `--project NAME` | 限定项目，可多次指定 | 全部 px 项目 |
| `--parallel N` | 并行 Claude CLI 进程数 | 3 |

`--top` 和 `--last` 互斥。

### 6.3 编排流程

```
Step 1: 解析参数
    │
Step 2: 读取 project-mapping.json
    │
Step 3: 调 Sentry API 拉 issue 列表
    │   GET /api/0/organizations/yotta/issues/?query=is:unresolved&sort=date&limit=N
    │
Step 4: 预拉每个 issue 的最新事件
    │   GET /api/0/issues/{id}/events/latest/
    │   写入 /tmp/sentry-batch/{shortId}/issue.json + event.json
    │
Step 5: 去重 — 扫描 reports/ 下已有报告的 YAML frontmatter
    │   决定跳过或重新调查
    │
Step 6: git clone/pull — 按仓库去重（monorepo 只拉一次）
    │   同时拉基础设施仓库
    │
Step 7: 并行派发 Claude CLI（ProcessPoolExecutor）
    │   每个子进程：claude -p "<prompt>" --allowedTools "..." --max-turns 50
    │   超时 15 分钟
    │
Step 8: 输出汇总
    调查成功 / 已跳过 / 调查失败
```

### 6.4 去重规则

| 场景 | 行为 |
|------|------|
| reports/ 中无该 shortId 的报告 | 调查 |
| 有报告，事件数增长不到 2 倍 | 跳过 |
| 有报告，事件数增长 >= 2 倍 | 重新调查（问题可能恶化） |
| 有报告，上次标记为 P0 或 P1 | 无论事件数都重新调查 |

去重基于报告 YAML frontmatter 中的 `shortId`、`event_count`、`priority` 字段。旧报告不删除，新报告在当天日期目录下生成。

### 6.5 子 Agent 调用方式

```python
claude -p "<prompt>"
  --allowedTools "Read,Glob,Grep,Bash,Write"
  --max-turns 50
```

Prompt 模板：
```
阅读 {SKILL.md 路径} 的调查流程。

Issue 详情：/tmp/sentry-batch/{shortId}/issue.json
最新事件（含 stacktrace）：/tmp/sentry-batch/{shortId}/event.json

代码已在 /home/username/Sentry/projects/ 下，不需要 git 操作。
直接从 Step 2（读代码定位）开始。

用中文输出报告，写到 /home/username/Sentry/reports/ 下，
按 SKILL.md 要求的目录结构和 frontmatter 格式。
```

### 6.6 汇总输出格式

```
=== 批量调查完成 ===
调查成功: 8
  ✓ COLLABSPACE-SERVER-20 → reports/2026-04-02/collabspace-server/P1/...
  ✓ ECHO-WEB-12 → reports/2026-04-02/echo-web/P3/...
已跳过(已有报告): 5
  - COLLABSPACE-SERVER-52 (event count 335 → 340, ratio 1.0x < 2x)
调查失败: 1
  ✗ AFFINE-FRONTEND-9N (timed out)
```

---

## 7. 安全约束

### 7.1 通用约束（交互 + 批量模式）

- 禁止修改 `/home/username/Sentry/projects/` 下的任何项目代码
- 禁止安装依赖、运行构建、执行项目代码
- 只允许 Write 到 `/home/username/Sentry/reports/` 和 `/tmp/` 目录
- Bash 只允许用于 curl 查询 Loki 日志和保存临时文件

### 7.2 批量模式额外约束

- 禁止执行 git 操作（clone、pull、push、commit 等）— 由编排脚本处理
- 通过 `--allowedTools` 参数在子进程级别强制执行

---

## 8. 两种使用模式对比

| 维度 | 交互模式 | 批量模式 |
|------|---------|---------|
| 触发方式 | 用户在 Claude Code 中输入 `/sentry-investigate` | 命令行 `python batch_investigate.py` |
| 输入 | Sentry URL、shortId、或会话上下文 | 脚本自动拉 issue 列表 |
| Sentry API | Agent 自己调用 | 编排脚本预调 |
| Git 操作 | Agent 自己 clone/pull | 编排脚本预拉 |
| Loki 查询 | Agent 直接查 | Agent 直接查（相同） |
| 并行度 | 单个 | 可配置（默认 3） |
| 环境变量 | 全部 4 个 | 编排脚本需 2 个，子 agent 需 2 个 |
| 去重 | 无 | 基于已有报告 frontmatter |
| 超时 | 无限制 | 15 分钟 |

---

## 9. 关联 Skill：sentry-summary

`sentry-summary` 是前置 skill，提供 Sentry 错误概览：

- 命令：`/sentry-summary`
- 功能：拉取 px 团队所有项目的未解决 issue、最近事件、错误趋势
- 输出：结构化摘要表格（项目概览、Top 未解决问题、近 24 小时事件、趋势图）
- 与 `sentry-investigate` 的衔接：用户可从 summary 结果中选择某个 issue 触发深入调查

---

## 10. API 参考摘要

### 10.1 Sentry API

| 端点 | 用途 |
|------|------|
| `GET /api/0/issues/{id}/` | 获取单个 issue 详情 |
| `GET /api/0/issues/{id}/events/latest/` | 获取最新事件（含 stacktrace） |
| `GET /api/0/issues/{id}/events/?limit=3` | 获取最近事件列表 |
| `GET /api/0/organizations/{org}/issues/?query={shortId}` | 按 shortId 搜索 |
| `GET /api/0/organizations/{org}/issues/?query=is:unresolved&sort=date` | 拉未解决 issue 列表 |
| `GET /api/0/organizations/{org}/projects/` | 获取项目 ID（批量模式按项目过滤） |

### 10.2 Grafana/Loki API

| 端点 | 用途 |
|------|------|
| `GET /api/datasources/proxy/2/loki/api/v1/query_range` | 查询时间范围内的日志 |
| `GET /api/datasources/proxy/2/loki/api/v1/labels` | 列出可用标签 |
| `GET /api/datasources/proxy/2/loki/api/v1/label/{name}/values` | 列出标签值 |

时间参数使用纳秒级 epoch 或 RFC3339Nano 格式。

### 10.3 GitLab API / Git

| 操作 | 说明 |
|------|------|
| `git clone https://oauth2:$GITLAB_TOKEN@host/path.git` | 克隆仓库 |
| `git -C path pull` | 更新已有仓库 |
| `GET /api/v4/projects/{id}/repository/files/{path}?ref={branch}` | 读取单文件（备选） |

---

## 11. 错误处理

| 场景 | 处理方式 |
|------|---------|
| 环境变量缺失 | 提示用户配置，提供创建链接 |
| Sentry API 401 | Token 失效，提示重新生成 |
| GitLab API 401 | Token 失效或无权限 |
| Grafana 401 | 用户名密码错误 |
| git clone 失败 | 报告仓库路径可能有误，检查 mapping |
| Loki 无日志 | 服务未接入日志采集或 app label 不匹配，报告中说明 |
| Issue 找不到 | shortId 或链接无效，提示用户确认 |
| 无 stacktrace 文件路径 | 前端代码压缩/无 source map，转为依赖日志分析 |
| 子进程超时（>15min） | 批量模式中杀掉进程，标记为失败 |
| 子进程异常退出 | 标记为失败，记录 stderr |
| 全部去重 | 正常退出，输出"无新 issue 需要调查" |

---

## 12. 技术依赖

| 组件 | 版本要求 | 说明 |
|------|---------|------|
| Claude Code CLI | 最新版 | `claude` 命令在 PATH 中 |
| Python | 3.8+ | 批量编排脚本 |
| pyyaml | 可选 | 解析报告 frontmatter（有内置 fallback） |
| git | — | 代码仓库操作 |
| curl | — | API 调用 |

---

## 13. 安装与使用

### 13.1 安装 Skill

```bash
# 1. 克隆仓库
git clone <repo-url> ~/px-ai-skills

# 2. 创建 symlink
mkdir -p ~/.claude/commands
ln -s ~/px-ai-skills/sentry-investigate/SKILL.md ~/.claude/commands/sentry-investigate.md
ln -s ~/px-ai-skills/sentry-summary/SKILL.md ~/.claude/commands/sentry-summary.md
```

### 13.2 配置环境变量

```bash
export SENTRY_AUTH_TOKEN="your-token"
export GITLAB_TOKEN="your-token"
export GRAFANA_USER="your-username"
export GRAFANA_PASSWORD="your-password"
```

### 13.3 交互模式使用

在 Claude Code 中：
```
/sentry-investigate COLLABSPACE-SERVER-20
```
或
```
/sentry-investigate https://sentry.yottastudios.com/organizations/yotta/issues/29771/
```

### 13.4 批量模式使用

```bash
cd ~/px-ai-skills/sentry-investigate
python3 batch_investigate.py --top 10 --parallel 3
```

---

## 14. 语言支持

- 检测用户输入语言，中文输入则中文输出，英文输入则英文输出
- Stacktrace、日志片段、代码保持原文（通常为英文）
- 报告章节标题跟随用户语言
- 时间戳格式：中文用户 `YYYY年MM月DD日 HH:mm`，英文用户 ISO 8601
