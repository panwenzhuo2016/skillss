# K8s 自动化部署系统 — 设计与技术文档

**版本:** 0.2.0
**日期:** 2026-04-08
**状态:** 已实现

---

## 1. 系统概述

### 1.1 背景与目标

PX 团队管理着十余个微服务（collabspace、apitable、echo、affine、map、rag-doc、common-agent 等），运行在内网 K8s 集群上，通过 GitLab CI/CD 构建部署。新项目上线时面临以下痛点：

1. **重复性配置** — 每个新项目都需要：写 Dockerfile → 配 CI → 生成 K8s YAML → 配 nginx gateway → 初始化数据库/Redis/中间件 → 配 .env → 正式服再来一遍，一个项目 2-4 小时。
2. **知识碎片化** — 镜像仓库命名、域名规则、CI 模板、共享服务地址等散落在不同仓库和文档中，新成员难以上手。
3. **部署验证滞后** — push 后需要手动等 CI、检查 Pod 状态、看日志，问题发现晚。

本系统利用 Claude Code 的 Skill 机制，实现 **AI 驱动的全自动 K8s 部署配置生成**，给定一个 GitLab 项目 URL，自动完成从源码分析到测试服部署验证的全流程，正式服生成 feat 分支和部署文档等人工合并。

### 1.2 核心能力

| 能力 | 说明 |
|------|------|
| 源码分析 | 自动检测项目类型（Java/Node/Python）、端口、健康检查、PV 需求 |
| 服务依赖检测 | 扫描依赖文件和配置，识别 MySQL/PG/Redis/RabbitMQ/Minio/MongoDB/ES |
| Dockerfile 生成 | 根据项目类型生成多阶段构建 Dockerfile |
| CI 配置 | 生成 `.gitlab-ci.yml`，支持测试服和正式服双流水线 |
| K8s 配置 | 生成 Namespace、PV/PVC、Deployment、Service、ConfigMap 等 YAML |
| Gateway 配置 | 生成 nginx upstream 和 server 配置（HTTP + HTTPS） |
| 服务初始化 | 通过 kubectl 直接建库、执行 SQL、部署 Redis、创建 Minio Bucket/RabbitMQ Vhost |
| PV 目录创建 | 通过 host-ops Pod 在宿主机创建 hostPath 目录 |
| 部署后自验证 | 监控 CI → kubectl 检查 Pod → Loki 补充查询 → 自动修复（最多 3 次） |
| 部署文档生成 | 为正式服自动生成部署文档，列出需要人工操作的步骤 |

---

## 2. 系统架构

### 2.1 整体架构

```
                         ┌──────────────────────────┐
                         │    用户输入 GitLab URL     │
                         └────────────┬─────────────┘
                                      │
                                      ▼
                         ┌──────────────────────────┐
                         │  Claude Code /k8s-deploy  │
                         │       SKILL.md 流程       │
                         └────────────┬─────────────┘
                                      │
            ┌─────────────────────────┼───────────────────────────┐
            │                         │                           │
            ▼                         ▼                           ▼
    ┌───────────────┐       ┌─────────────────┐        ┌──────────────────┐
    │ 分析 & 生成阶段 │       │   部署 & 初始化    │        │  验证 & 文档阶段   │
    │               │       │                 │        │                  │
    │ • 源码分析     │       │ • Git push      │        │ • CI Pipeline    │
    │ • 依赖检测     │       │ • DB 建库       │        │ • kubectl 检查    │
    │ • Dockerfile  │       │ • Redis 部署     │        │ • Loki 查日志     │
    │ • CI 配置     │       │ • Minio/MQ 初始化│        │ • 自动修复        │
    │ • K8s YAML    │       │ • PV 目录创建    │        │ • 部署文档生成     │
    │ • Gateway 配置 │       │ • .env 配置     │        │                  │
    └───────┬───────┘       └────────┬────────┘        └────────┬─────────┘
            │                        │                          │
            ▼                        ▼                          ▼
    ┌────────────────────────────────────────────────────────────────────┐
    │                       外部系统 & 基础设施                           │
    ├──────────┬──────────┬──────────┬──────────┬──────────┬────────────┤
    │ GitLab   │ K8s 集群  │ 镜像仓库  │ 共享服务  │ Grafana  │ 宿主机     │
    │ API/Git  │ (kubectl) │          │ (DB等)   │ /Loki   │ (host-ops) │
    └──────────┴──────────┴──────────┴──────────┴──────────┴────────────┘
```

### 2.2 文件结构

```
k8s-deploy/
├── SKILL.md                        # 主部署流程定义（14 个 Step）
└── references/
    ├── deploy-config.json          # 基础设施配置（仓库、镜像仓库、域名、共享服务、kubectl、Grafana）
    ├── k8s-access.md               # K8s 集群远程访问参考
    ├── gitlab-ci-api.md            # GitLab CI Pipeline API 参考
    └── loki-api.md                 # Grafana/Loki 日志查询 API 参考
```

### 2.3 部署产物

一次完整的 `/k8s-deploy` 执行会在以下位置产生文件：

```
/home/username/Deployments/
├── {project_name}/                      # 新项目源码
│   ├── Dockerfile                       # 生成
│   └── .gitlab-ci.yml                   # 生成
├── test/
│   ├── kubernetes/{project_name}/       # 测试服 K8s 配置
│   │   ├── 01-namespace.yaml
│   │   ├── 02-{name}-pv.yaml           # 如需 PV
│   │   ├── 03-{name}-deployment.yaml
│   │   ├── 04-redis-deployment.yaml     # 如检测到 Redis
│   │   ├── .env                         # ConfigMap 源
│   │   └── .gitlab-ci.yml              # 子目录 CI
│   └── gateway/nginx/conf.d/
│       ├── 00-upstreams.conf            # 追加 upstream
│       └── x{name}.conf                # 新建 server
├── prod/
│   ├── kubernetes/{project_name}/       # 正式服 K8s 配置 (feat 分支)
│   │   ├── (同测试服结构，镜像改为 GCR)
│   │   └── deploy-prod.md              # 部署文档
│   └── gateway/nginx/conf.d/           # 正式服 Gateway (feat 分支)
│       ├── 00-upstreams.conf
│       └── x{name}.conf
```

---

## 3. 数据源与认证

### 3.1 外部系统

| 系统 | 地址 | 认证方式 | 用途 |
|------|------|---------|------|
| GitLab | `https://pt-gitlab.yottastudios.com` | OAuth2 Token (`GITLAB_TOKEN`) | 源码仓库克隆/推送、CI API |
| K8s 集群 | `10.57.0.45:6443` | kubectl Docker 镜像内置凭证 | Pod 管理、数据库操作、宿主机操作 |
| Grafana/Loki | `https://xgrafana.xtool-staging.yottastudios.com` | HTTP Basic Auth | 部署后日志查询 |
| 测试服镜像仓库 | `192.168.0.63:5000` | 无认证 | Docker 镜像存储 |
| 正式服镜像仓库 | `us.gcr.io/mocan-cloud` | GCloud 服务账号 | Docker 镜像存储 |

### 3.2 环境变量

| 变量 | 必需 | 创建地址 |
|------|------|---------|
| `GITLAB_TOKEN` | 是 | `https://pt-gitlab.yottastudios.com/-/user_settings/personal_access_tokens` (scope: `api`) |
| `GRAFANA_USER` | 否（默认 `pxtool`） | 硬编码在 `deploy-config.json` |
| `GRAFANA_PASSWORD` | 否（默认 `pxtool123`） | 硬编码在 `deploy-config.json` |

### 3.3 K8s 集群直接访问

通过 Docker 镜像操作集群，无需本机安装 kubectl 或配置 kubeconfig：

```bash
# 基本命令模板
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest kubectl <命令>

# 通过 stdin 传入内容（SQL 文件等）
cat file.sql | docker run --rm -i 192.168.0.63:5000/px-infra-kubectl:latest kubectl <命令>

# 挂载本地文件（YAML 目录等）
docker run --rm -v /local/path:/manifests 192.168.0.63:5000/px-infra-kubectl:latest kubectl <命令>
```

镜像说明：
- 基于 `bitnami/kubectl:1.31`
- 内置 `kubernetes-admin` kubeconfig，连接 `10.57.0.45:6443`
- 拥有集群最高权限，注意操作安全

### 3.4 宿主机操作（host-ops Pod）

通过集群中的 `host-ops` Pod 操作宿主机 `/mnt` 目录（挂载为 `/host-mnt`）：

```bash
# 创建 PV 数据目录
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -n host-ops deployment/host-ops -- \
  sh -c "mkdir -p /host-mnt/data/{dir-name} && chmod -R 755 /host-mnt/data/{dir-name}"
```

host-ops 是一个 Alpine Pod，部署在 `host-ops` namespace 中，专门用于宿主机文件操作。

### 3.5 本地路径

| 路径 | 用途 |
|------|------|
| `/home/username/Deployments/` | 所有部署仓库的根目录 |
| `/home/username/Deployments/{project_name}/` | 新项目源码 |
| `/home/username/Deployments/test/kubernetes/` | 测试服 K8s 配置仓库 |
| `/home/username/Deployments/test/gateway/` | 测试服 Gateway 配置仓库 |
| `/home/username/Deployments/prod/kubernetes/` | 正式服 K8s 配置仓库 |
| `/home/username/Deployments/prod/gateway/` | 正式服 Gateway 配置仓库 |
| `/home/username/Deployments/collabspace-server/` | 后端 CI 模板参考 |
| `/home/username/Deployments/collabspace-web/` | 前端 CI 模板参考 |

---

## 4. 基础设施配置

### 4.1 仓库映射

所有仓库信息存储在 `deploy-config.json` 的 `repos` 字段：

| 用途 | GitLab 路径 | 本地路径 | 分支 |
|------|-------------|----------|------|
| 测试服 K8s | `px/collabspace/kubernetes` | `test/kubernetes/` | master |
| 测试服 Gateway | `px/infra/gateway` | `test/gateway/` | master |
| 正式服 K8s | `px/collabspace-prod/kubernetes` | `prod/kubernetes/` | aio-service |
| 正式服 Gateway | `px/collabspace-prod/gateway` | `prod/gateway/` | aio-service |
| 前端 CI 参考 | `px/collabspace/collabspace-web` | `collabspace-web/` | master |
| 后端 CI 参考 | `px/collabspace/collabspace-server` | `collabspace-server/` | master |
| 发版仓库参考 | `px/collabspace/deployment` | `deployment/` | master |

### 4.2 镜像仓库

| 环境 | 仓库 | 命名规则 | 示例 |
|------|------|---------|------|
| 测试服 | `192.168.0.63:5000` | `px-{name}-test:latest` | `192.168.0.63:5000/px-common-agent-test:latest` |
| 正式服 | `us.gcr.io/mocan-cloud` | `px-{name}:{SHA}` + `:latest` | `us.gcr.io/mocan-cloud/px-common-agent:abc1234` |

### 4.3 域名规则

| 环境 | 格式 | 示例 |
|------|------|------|
| 测试服 | `x{name}.xtool-staging.yottastudios.com` | `xcommon-agent.xtool-staging.yottastudios.com` |
| 正式服 | `x{name}.yottastudios.com` | `xcommon-agent.yottastudios.com` |

### 4.4 共享服务（测试服）

所有共享服务部署在 `10.57.0.45`，通过 NodePort 暴露。连接信息存储在 `deploy-config.json` 的 `shared_services` 字段：

| 服务 | 地址 | 用户 | 密码 | 管理端 |
|------|------|------|------|--------|
| MySQL | `10.57.0.45:30306` | `root` | `123456` | — |
| MySQL (private) | `10.57.0.45:30306` | `root` | `123456` | — |
| PostgreSQL | `10.57.0.45:30432` | `postgres` | `123456` | — |
| Minio | `10.57.0.45:30900` | `minioadmin` | `minioadmin` | `http://10.57.0.45:31901` |
| Minio (private) | `10.57.0.45:30901` | `minioadmin` | `minioadmin` | `http://10.57.0.45:31902` |
| MongoDB | `10.57.0.45:30017` | `admin` | `admin` | — |
| RabbitMQ | `10.57.0.45:30567` | `root` | `123456` | `http://10.57.0.45:31567` |
| RabbitMQ (private) | `10.57.0.45:30568` | `root` | `123456` | `http://10.57.0.45:31568` |
| Elasticsearch | `10.57.0.45:30200` | — | — | — |

### 4.5 Redis 策略

Redis 不使用共享服务，而是在每个 namespace 内独立部署 standalone Redis：

- 独立 Deployment（`redis:7`，appendonly 模式）
- PV/PVC 持久化（hostPath）
- ClusterIP Service（namespace 内部通过 `redis:6379` 访问）
- 参考模板：`/home/username/Deployments/test/kubernetes/echo/03-redis-deployment.yaml`

### 4.6 Grafana/Loki

| 参数 | 值 |
|------|------|
| 地址 | `https://xgrafana.xtool-staging.yottastudios.com` |
| 用户 | `pxtool` |
| 密码 | `pxtool123` |
| Loki Datasource ID | `2` |

---

## 5. 部署流程详解

### 5.1 Step 1: 环境检查 & 解析输入

**输入：** GitLab 项目 URL，如 `https://pt-gitlab.yottastudios.com/px/somegroup/my-project`

提取：
- `gitlab_path`: `px/somegroup/my-project`
- `project_name`: `my-project`（最后一段）

检查 `GITLAB_TOKEN` 环境变量，验证 K8s 集群可达：

```bash
echo "GITLAB_TOKEN=${GITLAB_TOKEN:+SET}"
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest kubectl get nodes
```

### 5.2 Step 2: 拉取仓库

新项目 clone 到 `/home/username/Deployments/{project_name}/`，checkout `testserver` 分支：

```bash
git clone https://oauth2:$GITLAB_TOKEN@pt-gitlab.yottastudios.com/{gitlab_path}.git \
  /home/username/Deployments/{project_name}
git -C /home/username/Deployments/{project_name} checkout testserver 2>/dev/null || \
git -C /home/username/Deployments/{project_name} checkout -b testserver
```

参考仓库：已存在则 `git pull`，不存在则 `git clone`。prod 仓库用 `-b {branch}` 指定分支。

### 5.3 Step 3: 分析源码

自动检测项目参数：

| 检测项 | 检测方法 |
|--------|---------|
| 项目类型 | `pom.xml`/`build.gradle` → Java；`package.json` → Node（SSR/SPA）；`pyproject.toml`/`requirements.txt` → Python |
| 端口 | Java: `application.yml` `server.port`；Node: `package.json` start 脚本；Python: Flask/FastAPI 默认端口 |
| 健康检查 | Spring Boot + actuator → `/actuator/health`；其他 → TCP probe |
| PV 需求 | 日志文件、文件上传、数据存储 → 需要 PV；纯无状态 → 不需要 |

**推断参数展示给用户确认：**

```
项目名称: my-project
项目类型: Python (FastAPI)
端口: 8088
健康检查: TCP probe
需要 PV: 是 (16Gi)
测试服镜像: 192.168.0.63:5000/px-my-project-test:latest
正式服镜像: us.gcr.io/mocan-cloud/px-my-project
测试服域名: xmy-project.xtool-staging.yottastudios.com
正式服域名: xmy-project.yottastudios.com
```

等待用户确认或修正后继续。

### 5.4 Step 3.5: 检测服务依赖

从源码自动检测项目需要的后端服务：

| 服务 | 检测文件 | 检测信号 |
|------|---------|---------|
| MySQL | `pyproject.toml`, `package.json`, `pom.xml`, `.env.example`, `application.yml` | `mysql-connector`, `pymysql`, `jdbc:mysql`, `spring.datasource.url` 含 `mysql`, `MYSQL_HOST` |
| PostgreSQL | 同上 | `asyncpg`, `psycopg2`, `pg`, `jdbc:postgresql`, `DATABASE_URL` 含 `postgres` |
| Redis | 同上 | `redis`, `ioredis`, `spring.redis`, `REDIS_HOST`, `REDIS_URL` |
| RabbitMQ | 同上 | `pika`, `amqplib`, `spring.rabbitmq`, `RABBITMQ_HOST`, `AMQP_URL` |
| Minio/S3 | 同上 | `minio`, `boto3`, `aws-sdk`, `@aws-sdk/client-s3`, `MINIO_ENDPOINT` |
| MongoDB | 同上 | `pymongo`, `mongoose`, `mongodb`, `motor`, `MONGO_URI` |
| Elasticsearch | 同上 | `elasticsearch`, `@elastic/elasticsearch`, `ES_HOST` |

输出示例：

```
检测到以下服务依赖：
  ✓ PostgreSQL — asyncpg in pyproject.toml
  ✓ Redis — REDIS_HOST in .env.example
  ✗ MySQL — 未检测到
  ✗ RabbitMQ — 未检测到
  ✗ Minio — 未检测到
  ✗ MongoDB — 未检测到
  ✗ Elasticsearch — 未检测到
```

### 5.5 Step 4: 生成 Dockerfile

根据项目类型生成多阶段构建 Dockerfile，写入新项目根目录。

**支持的项目类型：**
- Java (Maven) — `maven:3-eclipse-temurin-21` → `eclipse-temurin:21-jre`
- Java (Gradle) — `gradle:8-jdk21` → `eclipse-temurin:21-jre`
- Node.js (SSR) — `node:20-alpine` build → `node:20-alpine` 运行
- Node.js (SPA) — `node:20-alpine` build → `nginx:1.25-alpine` 托管
- Python — `python:3.12-slim` 直接运行

模板根据实际项目结构调整（构建命令、入口点等）。

### 5.6 Step 5: 生成项目 CI

生成 `.gitlab-ci.yml`，包含测试服和正式服双流水线：

```yaml
stages: [check, docker, deploy]

# testserver 分支
check-testserver:     # kubectl config view 验证
docker-testserver:    # docker build + push 到 192.168.0.63:5000
deploy-testserver:    # kubectl rollout restart

# master 分支
docker-master:        # gcloud auth + docker build + push 到 GCR
deploy-master:        # push 空 commit 到 deployment 仓库留痕
```

Dockerfile + .gitlab-ci.yml 一起 commit 到 testserver 分支并 push。

### 5.7 Step 6: 生成测试服 K8s 配置

在 `test/kubernetes/{project_name}/` 下生成：

| 文件 | 内容 |
|------|------|
| `01-namespace.yaml` | Namespace 声明（幂等） |
| `02-{name}-pv.yaml` | PV + PVC（如需要） |
| `03-{name}-deployment.yaml` | Deployment + Service |
| `.env` | ConfigMap 源文件 |
| `.gitlab-ci.yml` | 子目录 CI（apply-env + deploy 两个 job） |

**Push 前的准备操作：**

1. 通过 host-ops Pod 创建 PV 的 hostPath 目录：
```bash
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -n host-ops deployment/host-ops -- \
  sh -c "mkdir -p /host-mnt/data/{project_name} && chmod -R 755 /host-mnt/data/{project_name}"
```

2. 创建 namespace（如果是新的）：
```bash
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl create namespace {namespace} --dry-run=client -o yaml | \
docker run --rm -i 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl apply -f -
```

然后 commit 到 master 并 push。

### 5.8 Step 6.5: 初始化服务依赖

基于 Step 3.5 的检测结果，通过 kubectl 直接连接集群中的数据库 Pod 执行初始化操作。

#### MySQL 建库

```bash
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -n default deployment/mysql -- \
  mysql -u root -p123456 -e "CREATE DATABASE IF NOT EXISTS \`{db_name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

#### PostgreSQL 建库

```bash
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -n default deployment/postgres -- \
  psql -U postgres -c "SELECT 1 FROM pg_database WHERE datname='{db_name}'" | grep -q 1 || \
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -n default deployment/postgres -- \
  psql -U postgres -c "CREATE DATABASE {db_name};"
```

#### 初始化 SQL 执行

如果项目中存在初始化 SQL 文件，通过 stdin 传入：

```bash
cat {sql_file} | docker run --rm -i 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -i -n default deployment/postgres -- \
  psql -U postgres -d {db_name}
```

SQL 文件搜索优先级：`init.sql` / `schema.sql` → `sql/` 目录 → `migrations/` → `src/main/resources/db/migration/` (Flyway)

#### Redis 独立部署

生成 `04-redis-deployment.yaml`（Deployment + ClusterIP Service），追加 Redis PV/PVC 到 `02-*-pv.yaml`。同时创建宿主机目录：

```bash
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -n host-ops deployment/host-ops -- \
  sh -c "mkdir -p /host-mnt/data/{project_name}-redis && chmod -R 755 /host-mnt/data/{project_name}-redis"
```

#### Minio Bucket 创建

```bash
curl -X PUT "http://10.57.0.45:30900/{bucket_name}" -u minioadmin:minioadmin
```

#### RabbitMQ Vhost 创建

```bash
curl -s -u root:123456 -X PUT "http://10.57.0.45:31567/api/vhosts/{vhost_name}"
curl -s -u root:123456 -X PUT "http://10.57.0.45:31567/api/permissions/{vhost_name}/root" \
  -H "content-type: application/json" \
  -d '{"configure":".*","write":".*","read":".*"}'
```

#### .env 连接串生成

根据检测到的服务，生成 `test/kubernetes/{project_name}/.env`：

| 服务 | 连接串模板 |
|------|----------|
| PostgreSQL | `DATABASE_URL=postgresql+asyncpg://postgres:123456@postgres.default:5432/{db_name}` |
| MySQL | `MYSQL_HOST=10.57.0.45`, `MYSQL_PORT=30306`, `MYSQL_USER=root`, `MYSQL_PASSWORD=123456` |
| Redis | `REDIS_HOST=redis`, `REDIS_PORT=6379`（namespace 内部访问） |
| Minio | `MINIO_ENDPOINT=http://10.57.0.45:30900`, `MINIO_ACCESS_KEY=minioadmin` |
| RabbitMQ | `RABBITMQ_HOST=10.57.0.45`, `RABBITMQ_PORT=30567` |
| MongoDB | `MONGO_URI=mongodb://admin:admin@10.57.0.45:30017/{db_name}?authSource=admin` |
| Elasticsearch | `ES_HOST=http://10.57.0.45:30200` |

连接串的 key 名称优先从项目 `.env.example` / `.env.template` 中提取，保持一致。

注意：集群内服务（如 PostgreSQL）使用 K8s Service DNS（`postgres.default`）而非 NodePort 地址。

### 5.9 Step 7: 生成测试服 Gateway 配置

在 `test/gateway/` 中：
1. `nginx/conf.d/00-upstreams.conf` — 追加 upstream 条目
2. `nginx/conf.d/x{name}.conf` — 新建 nginx server 配置

server 配置包含：
- HTTP (port 80) + HTTPS (port 443) 双监听
- SSL 证书：`/etc/ssl/yottastudios.com/cert.pem` + `key.pem`
- WebSocket 支持（`Upgrade` + `Connection` headers）
- CORS headers
- `proxy_connect_timeout 300`

Commit 到 master 并 push。

### 5.10 Step 8 & 9: 生成正式服配置

**K8s 配置** — 在 `prod/kubernetes/` 基于 `aio-service` 创建 `feat/{project_name}` 分支：
- 同测试服结构，但镜像改为 `us.gcr.io/mocan-cloud/px-{name}:latest`

**Gateway 配置** — 在 `prod/gateway/` 基于 `aio-service` 创建 `feat/{project_name}` 分支：
- 域名改为 `x{name}.yottastudios.com`

两者都 push feat 分支等人工审核合并，**不直接推 master/aio-service**。

### 5.11 Step 10: 输出总结

```
## 部署完成总结

### 已完成操作
- ✓ 项目 {name} 已 clone 到 /home/username/Deployments/{name}/
- ✓ Dockerfile + .gitlab-ci.yml 已生成并推送到 testserver 分支
- ✓ 测试服 K8s 配置已推送（CI 将自动 apply）
- ✓ 测试服 Gateway 配置已推送（CI 将自动重建 nginx）
- ✓ 正式服 K8s 配置已推送到 feat/{name} 分支
- ✓ 正式服 Gateway 配置已推送到 feat/{name} 分支

### 测试服访问地址
- https://x{name}.xtool-staging.yottastudios.com

### 待人工操作
- 合并正式服 K8s feat 分支: {link}
- 合并正式服 Gateway feat 分支: {link}
```

### 5.12 Step 10.5: 部署后自验证

测试服所有配置推送后，自动验证部署是否成功。

#### 阶段 1：监控 GitLab CI Pipeline

对每个推送了代码的仓库，通过 GitLab API 轮询 pipeline 状态：

```bash
# 获取项目 ID
curl -s -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://pt-gitlab.yottastudios.com/api/v4/projects/{url_encoded_path}"

# 获取最新 pipeline
curl -s -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://pt-gitlab.yottastudios.com/api/v4/projects/{id}/pipelines?ref=master&per_page=1"

# 每 15 秒轮询，最多等 10 分钟
```

CI 失败时：获取失败 job 列表 → 读取 job 日志 → 分析原因 → 尝试自动修复 → 重新 push。

#### 阶段 2：通过 kubectl 检查 Pod 状态和日志（优先）

所有 CI 成功后等待 30 秒，然后直接通过 kubectl 检查：

```bash
# 1. 检查 Pod 状态
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl get pods -n {namespace} -l app={project_name}

# 2. 查看 Pod 日志
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl logs deployment/{project_name}-deploy -n {namespace} --tail=100

# 3. 检查 Pod 事件
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl describe pod -n {namespace} -l app={project_name}
```

#### 阶段 2.5：Grafana/Loki 补充查询（备选）

如果 kubectl 日志不足以判断问题，通过 Loki 查询更完整的历史日志：

```bash
# 查看全部日志
curl -s -u "pxtool:pxtool123" \
  "https://xgrafana.xtool-staging.yottastudios.com/api/datasources/proxy/2/loki/api/v1/query_range?query={app=\"{project_name}\"}&start={start_ns}&end={end_ns}&limit=100"

# 查看错误日志
curl -s -u "pxtool:pxtool123" \
  "...?query={app=\"{project_name}\"}|~\"(?i)error|exception|fatal\"!~\"healthcheck|ping\"..."
```

#### 阶段 3：判断结果

| 情况 | 行动 |
|------|------|
| Pod Running + 启动成功日志 | 报告"部署成功 ✓"，输出访问地址 |
| Pod Running + 错误日志 | 分析错误，修正 .env/配置后重新 push |
| Pod CrashLoopBackOff | 读取日志，分析崩溃原因（缺少环境变量、端口冲突等） |
| Pod Pending | 检查 describe 事件（PV 未创建、资源不足、镜像拉取失败） |
| Pod ImagePullBackOff | CI 可能未成功推送镜像 |

**自动修复最多 3 次**，超过后报告给用户。

### 5.13 Step 11: 生成正式服部署文档

在 `prod/kubernetes/{project_name}/deploy-prod.md` 生成部署文档，只包含项目实际用到的章节：

```markdown
# {name} 正式服部署文档

## 1. DNS 配置
## 2. Minio（如需要）
## 3. 数据库（MySQL/PostgreSQL，如需要）
## 4. RabbitMQ（如需要）
## 5. Redis（自动部署，无需操作）
## 6. K8s 部署步骤
## 7. 环境变量对照表（测试服值 → 正式服需替换）
## 8. 部署验证
```

环境变量表从 `.env` 内容填充，正式服值标注"需替换"。文档随 feat 分支一起提交。

---

## 6. 实际验证案例

### 6.1 common-agent PostgreSQL 配置（2026-04-08）

以 `common-agent` 项目为例，实际验证了 k8s-deploy skill 的多个核心能力：

**场景：** common-agent 从 SQLite 迁移到 PostgreSQL，需要配置数据库连接和初始化。

**执行过程：**

1. **建库** — 通过 kubectl exec 进入 PG Pod 创建数据库：
```bash
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -n default deployment/postgres -- \
  psql -U postgres -c "CREATE DATABASE common_agent;"
```

2. **.env 配置** — 在 `test/kubernetes/common-agent/.env` 中添加：
```env
DATABASE_URL=postgresql+asyncpg://postgres:123456@postgres.default:5432/common_agent
```
注意使用集群内 Service DNS `postgres.default` 而非 NodePort 地址。

3. **推送 & CI** — push 到 kubernetes master 分支，CI pipeline #269186 成功。

4. **PV 目录问题** — Pod 报 `CreateContainerConfigError: stat /mnt/data/common-agent: no such file or directory`。通过 host-ops Pod 修复：
```bash
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -n host-ops deployment/host-ops -- \
  sh -c "mkdir -p /host-mnt/data/common-agent && chmod -R 755 /host-mnt/data/common-agent"
```

5. **验证成功** — Pod Running，Alembic 自动执行数据库迁移，创建 10 张表。

**验证的 Skill 能力：**
- ✓ kubectl 直接建库（Step 6.5）
- ✓ PV 目录创建（Step 6 push 前操作）
- ✓ CI 监控（Step 10.5 阶段 1）
- ✓ kubectl Pod 状态和日志检查（Step 10.5 阶段 2）

---

## 7. 安全约束

| 约束 | 说明 |
|------|------|
| 参数确认 | 用户确认检测参数后才执行 git push |
| 正式服隔离 | 正式服配置只推 feat 分支，永远不直接推 master/aio-service |
| 不删除文件 | 不删除任何已有文件，只追加或修改 |
| Git 认证 | 所有 git 操作使用 `GITLAB_TOKEN` OAuth2 认证 |
| K8s 权限 | kubectl 镜像拥有 kubernetes-admin 权限，需注意操作安全 |
| 生产数据库 | 不连接正式服数据库，只在测试服自动初始化 |

---

## 8. 错误处理

| 场景 | 处理方式 |
|------|---------|
| `GITLAB_TOKEN` 缺失 | 停止，提示用户配置，提供 token 创建链接 |
| GitLab 401 | Token 失效或无权限 |
| K8s 集群不可达 | 检查网络连接和 VPN |
| git clone 失败 | 检查 gitlab_path 是否正确 |
| testserver 分支不存在 | 从 master 创建 |
| 项目类型无法识别 | 询问用户项目类型和端口 |
| 端口未检测到 | 询问用户指定端口 |
| feat 分支已存在 | 询问用户是否覆盖或跳过 |
| 数据库连接失败 | 检查 deploy-config.json 中的地址端口，网络是否可达 |
| SQL 执行失败 | 输出错误信息（语法问题/权限不足） |
| Redis PV 创建失败 | 检查 hostPath 是否已被其他 PV 占用 |
| CI pipeline 超时 | 10 分钟后仍未完成，报告给用户 |
| Loki 无日志 | Pod 可能未启动，检查 kubectl get pods |
| 自动修复超过 3 次 | 停止重试，输出所有错误日志和分析 |

---

## 9. API 参考摘要

### 9.1 GitLab CI API

| 端点 | 用途 |
|------|------|
| `GET /api/v4/projects/{id_or_path}` | 获取项目信息 |
| `GET /api/v4/projects/{id}/pipelines?ref={branch}&per_page=1` | 获取最新 pipeline |
| `GET /api/v4/projects/{id}/pipelines/{pipeline_id}` | 查询 pipeline 状态 |
| `GET /api/v4/projects/{id}/pipelines/{pipeline_id}/jobs` | 获取 pipeline 的 job 列表 |
| `GET /api/v4/projects/{id}/jobs/{job_id}/trace` | 读取 job 日志（纯文本） |

认证：`PRIVATE-TOKEN: $GITLAB_TOKEN` header。

### 9.2 Grafana/Loki API

| 端点 | 用途 |
|------|------|
| `GET /api/datasources/proxy/2/loki/api/v1/query_range` | 查询时间范围内的日志 |
| `GET /api/datasources/proxy/2/loki/api/v1/label/app/values` | 列出可用 app 标签 |

认证：HTTP Basic Auth（`pxtool:pxtool123`）。时间参数使用纳秒级 epoch。

常用 LogQL：
- 全部日志：`{app="{name}"}`
- 启动信号：`{app="{name}"} |~ "(?i)started|listening|ready"`
- 错误日志：`{app="{name}"} |~ "(?i)error|exception|fatal" !~ "healthcheck|ping"`

### 9.3 K8s kubectl

| 操作 | 命令 |
|------|------|
| 查看 Pod | `kubectl get pods -n {namespace}` |
| Pod 日志 | `kubectl logs deployment/{name}-deploy -n {namespace} --tail=100` |
| Pod 事件 | `kubectl describe pod -n {namespace} -l app={name}` |
| 创建 namespace | `kubectl create namespace {ns} --dry-run=client -o yaml \| kubectl apply -f -` |
| 进入数据库 Pod | `kubectl exec -n default deployment/{db} -- {client_cmd}` |
| 宿主机操作 | `kubectl exec -n host-ops deployment/host-ops -- {cmd}` |
| 重启 Deployment | `kubectl rollout restart deployment/{name}-deploy -n {namespace}` |
| Apply YAML | `kubectl apply -f /manifests/`（需 -v 挂载） |

所有 kubectl 命令通过 Docker 镜像执行：`docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest kubectl ...`

---

## 10. 安装与使用

### 10.1 安装 Skill

```bash
# 1. 克隆仓库
git clone <repo-url> ~/px-ai-skills

# 2. 创建 symlink
mkdir -p ~/.claude/commands
ln -s ~/px-ai-skills/k8s-deploy/SKILL.md ~/.claude/commands/k8s-deploy.md
```

### 10.2 配置环境变量

```bash
export GITLAB_TOKEN="your-token"
# Grafana 凭据已硬编码在 deploy-config.json 中，通常不需要额外配置
```

### 10.3 使用

```
/k8s-deploy https://pt-gitlab.yottastudios.com/px/somegroup/my-project
```

Skill 会自动完成全套部署流程，中间在 Step 3 暂停让用户确认检测到的参数。

---

## 11. 与 Sentry 自动化系统的关系

| 维度 | sentry-investigate | k8s-deploy |
|------|-------------------|------------|
| 目标 | 已有服务的错误排查 | 新服务的部署上线 |
| 输入 | Sentry Issue URL / shortId | GitLab 项目 URL |
| 共享基础设施 | Grafana/Loki、GitLab、K8s 集群 | 同 |
| 共享凭据 | `GITLAB_TOKEN`、`GRAFANA_USER/PASSWORD` | 同 |
| 配置来源 | `project-mapping.json` | `deploy-config.json` |
| K8s 访问 | 不直接访问 | kubectl via Docker 镜像 |
| 输出 | Markdown 调查报告 | 部署配置文件 + 部署文档 |

两个 Skill 共享 Grafana/Loki 和 GitLab 基础设施，`k8s-deploy` 部署的新项目在后续可以被 `sentry-investigate` 自动排查（需要在 `project-mapping.json` 中添加映射）。

---

## 12. 语言支持

- 默认使用中文输出
- Skill 内部注释和用户交互全部使用中文
- 生成的代码注释、YAML 配置保持英文
- 部署文档（deploy-prod.md）使用中文
