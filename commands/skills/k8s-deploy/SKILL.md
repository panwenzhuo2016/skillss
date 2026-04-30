---
name: k8s-deploy
description: This skill should be used when the user wants to "deploy a project to K8s", "部署项目到K8s", "配置K8s部署", "写CI配置", "新项目上线", "deploy to kubernetes", or provides a GitLab project URL (or group URL / multiple URLs) and wants full deployment setup. Supports single project and multi-repo namespace aggregation (e.g., chark-api + chark-app → unified chark namespace). Use this skill for setting up CI/CD pipelines, Kubernetes manifests, and nginx gateway configs for both test and production environments.
version: 0.3.0
---

# K8s Deploy

给定一个或多个 GitLab 项目 URL（或 Group URL），自动完成全套 K8s 部署配置：支持多仓库自动检测并聚合到同一 namespace（如 chark-api + chark-app → chark namespace）；分析源码、生成 Dockerfile 和 CI、自动检测并初始化数据库/Redis/中间件、配置测试服/正式服的 kubernetes 和 gateway（支持单域名多路径转发），测试服直接部署并通过 GitLab CI + Grafana/Loki 自验证，正式服推 feat 分支等人工合并并自动生成严格按团队标准格式的部署文档。

默认使用中文输出。

## Configuration

| Parameter | Source | Value |
|-----------|--------|-------|
| GitLab Base URL | Hardcoded | `https://pt-gitlab.yottastudios.com` |
| GitLab Auth | Env var | `GITLAB_TOKEN` |
| Deploy Config | File | `references/deploy-config.json` |
| GitLab CI API | File | `references/gitlab-ci-api.md` |
| Loki API | File | `references/loki-api.md` |
| K8s 集群访问 | File | `references/k8s-access.md` |
| Base Path | Config | `/home/username/Deployments/` |

### K8s 集群直接访问

本机可通过 Docker 镜像直接操作测试服 K8s 集群，无需安装 kubectl：

```bash
# kubectl 命令模板
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest kubectl <命令>

# 宿主机 /mnt 操作（通过 host-ops Pod）
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -n host-ops deployment/host-ops -- <命令>
```

详见 `references/k8s-access.md`。

### Preflight Check

验证环境变量和集群连接：

```bash
echo "GITLAB_TOKEN=${GITLAB_TOKEN:+SET}"
```

```bash
# 验证 K8s 集群可达
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest kubectl get nodes
```

如果 `GITLAB_TOKEN` 为空，提示用户配置：

- **GITLAB_TOKEN** — 在 `https://pt-gitlab.yottastudios.com/-/user_settings/personal_access_tokens` 创建（scope: `api`）

```bash
echo 'export GITLAB_TOKEN="<token>"' >> ~/.bashrc
export GITLAB_TOKEN="<token>"
```

## Workflow

### Step 1: Parse Input

支持三种输入方式：

**方式 A：单个 GitLab 项目 URL**
```
https://pt-gitlab.yottastudios.com/px/somegroup/my-project
```
Extract:
- `gitlab_path`: `px/somegroup/my-project`
- `project_name`: `my-project` (last segment)
- `parent_group`: `px/somegroup`

**方式 B：GitLab Group/Subgroup URL**
```
https://pt-gitlab.yottastudios.com/px/chark
```
通过 GitLab Groups API 列出 group 下所有项目：
```bash
GROUP_PATH="px%2Fchark"
curl -s -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://pt-gitlab.yottastudios.com/api/v4/groups/$GROUP_PATH/projects?simple=true&per_page=100"
```
提取所有项目的 `path_with_namespace` 和 `name`。

**方式 C：多个项目 URL**
用户一次性提供多个 GitLab 项目 URL，按照方式 A 分别解析。

所有方式最终产出一个项目列表：`projects = [{gitlab_path, project_name}, ...]`

### Step 1.5: Multi-Repo Detection & Namespace Decision

当项目列表包含多个项目，或单个项目需要自动检测关联项目时执行此步骤。

**单项目自动检测**（方式 A 输入时）：

1. 查同 group 下的相关项目：
```bash
GROUP_PATH=$(echo "{gitlab_path}" | sed 's|/[^/]*$||' | sed 's|/|%2F|g')
curl -s -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://pt-gitlab.yottastudios.com/api/v4/groups/$GROUP_PATH/projects?simple=true&per_page=100"
```

2. 用 kubectl 检查集群中是否已有同名/同前缀的 namespace 和 deployment：
```bash
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest kubectl get namespaces -o name
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest kubectl get deployments -A -o custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name --no-headers
```

**名称关联检测逻辑（所有多项目场景）：**

1. 提取所有项目名称，找公共前缀（如 `chark-api`, `chark-app`, `chark-uspto-scraper` → 公共前缀 `chark`）
2. 检查集群中是否已有匹配的 namespace（精确匹配公共前缀）
3. 如果已有同名 namespace，查看其中的 deployment 列表

**决策规则：**
- 多个项目有公共前缀 → 建议合并到以前缀命名的 namespace
- 项目名匹配已有 namespace 中的 deployment → 建议合并到该 namespace
- 无关联 → 各自独立 namespace，按单项目流程处理

**输出结果让用户确认：**

```
检测到以下项目属于同一服务组：
  - chark-api (API 服务)
  - chark-app (前端应用)
  - chark-uspto-scraper (后台任务)
  - chark-ai-worker (AI Worker)

建议 namespace: chark
统一 k8s 配置目录: chark/
统一域名: xchark.{domain}

是否按此方案聚合？(确认/修改)
```

如果用户确认聚合，后续步骤以 `namespace` 为主键，`sub_projects` 为子项目列表执行。
如果用户拒绝或无关联项目，按单项目流程（每个项目独立 namespace）。

### Step 2: Pull Repositories

Read `references/deploy-config.json` for repo configuration.

**New project(s):**

单项目模式：
```bash
git clone https://oauth2:$GITLAB_TOKEN@pt-gitlab.yottastudios.com/{gitlab_path}.git \
  /home/username/Deployments/{project_name}
```

多仓库聚合模式（Step 1.5 确认聚合后）：为每个子项目分别 clone：
```bash
# 对每个 sub_project 执行
git clone https://oauth2:$GITLAB_TOKEN@pt-gitlab.yottastudios.com/{sub_project.gitlab_path}.git \
  /home/username/Deployments/{sub_project.project_name}
```

Then checkout `testserver` branch:
```bash
git -C /home/username/Deployments/{project_name} checkout testserver 2>/dev/null || \
git -C /home/username/Deployments/{project_name} checkout -b testserver
```

**Reference repos** (from `deploy-config.json`): If directory exists, `git pull`. If not, `git clone`. For prod repos, use `-b {branch}` from config.

```bash
# Example: test kubernetes
if [ -d /home/username/Deployments/test/kubernetes ]; then
  git -C /home/username/Deployments/test/kubernetes pull
else
  git clone https://oauth2:$GITLAB_TOKEN@pt-gitlab.yottastudios.com/px/collabspace/kubernetes.git \
    /home/username/Deployments/test/kubernetes
fi
```

### Step 3: Analyze Source Code

Detect project parameters by reading source files:

**Project type detection:**
- `pom.xml` or `build.gradle` → Java
- `package.json` → Node.js (check for SSR vs SPA)
- `requirements.txt` or `pyproject.toml` → Python

**Port detection:**
- Java: Read `src/main/resources/application.yml` or `application.properties` for `server.port`
- Node: Read `package.json` scripts, look for port in start command
- Python: Check for Flask/FastAPI/Django default ports

**Health check detection:**
- Java Spring Boot (has `spring-boot-starter-actuator` in pom.xml) → `/actuator/health`
- Otherwise → TCP probe on detected port

**PV detection:**
- If project has logging config, file upload, or data storage → needs PV
- Simple stateless services → no PV needed

**Present detected parameters to user for confirmation:**

单项目模式：
```
项目名称: my-project
项目类型: Java (Spring Boot)
端口: 8081
健康检查: /actuator/health
需要 PV: 是 (16Gi)
测试服镜像: 192.168.0.63:5000/px-my-project-test:latest
正式服镜像: us.gcr.io/mocan-cloud/px-my-project
测试服域名: xmy-project.xtool-staging.yottastudios.com
正式服域名: xmy-project.yottastudios.com
```

多仓库聚合模式：对每个子项目分别检测，汇总展示：
```
项目组: chark (namespace: chark)
┌──────────────────────┬───────┬──────┬─────────────────────────────────┐
│ 子项目               │ 类型   │ 端口 │ 镜像                            │
├──────────────────────┼───────┼──────┼─────────────────────────────────┤
│ chark-api            │ Python │ 8000 │ px-chark-api-test:latest        │
│ chark-app            │ SPA    │ 80   │ px-chark-app-test:latest        │
│ chark-uspto-scraper  │ Python │ -    │ px-chark-uspto-scraper-test     │
│ chark-ai-worker      │ Python │ -    │ px-chark-ai-worker-test         │
└──────────────────────┴───────┴──────┴─────────────────────────────────┘
测试服域名: xchark.xtool-staging.yottastudios.com
正式服域名: xchark.yottastudios.com
```

Wait for user confirmation or corrections before proceeding.

### Step 3.5: 检测服务依赖

从源码自动检测项目需要哪些后端服务。读取 `references/deploy-config.json` 的 `shared_services` 获取所有可能的服务类型。

**检测信号表：**

| 服务 | 检测文件 | 检测信号 |
|------|---------|---------|
| MySQL | `pyproject.toml`, `package.json`, `pom.xml`, `.env.example`, `application.yml` | `mysql-connector`, `pymysql`, `jdbc:mysql`, `spring.datasource.url` 含 `mysql`, `MYSQL_HOST`, `MYSQL_DATABASE` |
| PostgreSQL | `pyproject.toml`, `package.json`, `pom.xml`, `.env.example`, `application.yml` | `asyncpg`, `psycopg2`, `pg`, `jdbc:postgresql`, `DATABASE_URL` 含 `postgres` |
| Redis | `pyproject.toml`, `package.json`, `pom.xml`, `.env.example`, `application.yml` | `redis`, `ioredis`, `spring.redis`, `REDIS_HOST`, `REDIS_URL` |
| RabbitMQ | `pyproject.toml`, `package.json`, `pom.xml`, `.env.example`, `application.yml` | `pika`, `amqplib`, `spring.rabbitmq`, `RABBITMQ_HOST`, `AMQP_URL` |
| Minio/S3 | `pyproject.toml`, `package.json`, `pom.xml`, `.env.example` | `minio`, `boto3`, `aws-sdk`, `@aws-sdk/client-s3`, `MINIO_ENDPOINT`, `S3_ENDPOINT` |
| MongoDB | `pyproject.toml`, `package.json`, `pom.xml`, `.env.example` | `pymongo`, `mongoose`, `mongodb`, `motor`, `MONGO_URI`, `MONGODB_URL` |
| Elasticsearch | `pyproject.toml`, `package.json`, `pom.xml`, `.env.example` | `elasticsearch`, `@elastic/elasticsearch`, `ES_HOST`, `ELASTICSEARCH_URL` |

**检测方法：**

1. 用 Grep 工具扫描项目中的依赖文件和配置文件
2. 对每个服务，在上述检测文件中搜索对应的关键词
3. 命中任一信号即判定项目需要该服务

**输出检测结果：**

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

检测结果无需用户确认，直接用于后续 Step 6.5 的初始化。

### Step 4: Generate Dockerfile

Write `Dockerfile` to the new project's root directory based on project type.

**Java (Spring Boot with Maven):**
```dockerfile
FROM maven:3-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline -B
COPY src ./src
RUN mvn package -DskipTests -B

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
EXPOSE {port}
ENTRYPOINT ["java", "-jar", "app.jar"]
```

**Java (Spring Boot with Gradle):**
```dockerfile
FROM gradle:8-jdk21 AS build
WORKDIR /app
COPY build.gradle settings.gradle ./
COPY gradle ./gradle
RUN gradle dependencies --no-daemon || true
COPY src ./src
RUN gradle bootJar --no-daemon

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/build/libs/*.jar app.jar
EXPOSE {port}
ENTRYPOINT ["java", "-jar", "app.jar"]
```

**Node.js (SSR):**
```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app ./
EXPOSE {port}
CMD ["npm", "start"]
```

**Node.js (SPA):**
```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.25-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

**Python:**
```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE {port}
CMD ["python", "main.py"]
```

These are templates — adapt based on actual project structure (e.g., different build commands, entry points, etc.).

### Step 5: Generate Project CI

Write `.gitlab-ci.yml` to the new project's root directory.

Reference `collabspace-server/.gitlab-ci.yml` and `collabspace-web/.gitlab-ci.yml` for the exact pattern:

```yaml
stages:
  - check
  - docker
  - deploy

check-testserver:
  tags:
    - "docker"
  stage: check
  image: 192.168.0.63:5000/px-infra-kubectl:latest
  only:
    - testserver
  script:
    - kubectl config view

docker-testserver:
  tags:
    - "docker"
  stage: docker
  image: docker:19.03
  only:
    - testserver
  script:
    - docker build . -t 192.168.0.63:5000/px-{project_name}-test:latest
    - docker push 192.168.0.63:5000/px-{project_name}-test:latest
    - echo "镜像构建及推送完成"

docker-master:
  tags:
    - docker
  stage: docker
  image: 192.168.0.63:5000/google/cloud-sdk:latest
  only:
    - master
  script:
    - gcloud auth activate-service-account --key-file ${GOOGLE_ONLINE_CONTAINER_REGISTRY}
    - gcloud auth configure-docker --quiet
    - docker build . -t us.gcr.io/mocan-cloud/px-{project_name}:${CI_COMMIT_SHORT_SHA}
    - docker push us.gcr.io/mocan-cloud/px-{project_name}:${CI_COMMIT_SHORT_SHA}
    - docker tag us.gcr.io/mocan-cloud/px-{project_name}:${CI_COMMIT_SHORT_SHA} us.gcr.io/mocan-cloud/px-{project_name}:latest
    - docker push us.gcr.io/mocan-cloud/px-{project_name}:latest
    - echo "px-{project_name}:${CI_COMMIT_SHORT_SHA} push successfully"

deploy-testserver:
  tags:
    - "docker"
  stage: deploy
  image: 192.168.0.63:5000/px-infra-kubectl:latest
  only:
    refs:
      - testserver
  script:
    - kubectl rollout restart deployment {project_name}-deploy -n {namespace}

deploy-master:
  tags:
    - xshell
  only:
    refs:
      - master
  stage: deploy
  variables:
    CACHE_DIR: "shell-runner-cache/{project_name}-deployment"
    DIST_REPO: "https://oauth2:$GITLAB_TOKEN@pt-gitlab.yottastudios.com/px/collabspace/deployment.git"
  script:
    - export CACHE_DIR=${HOME}/${CACHE_DIR}
    - if ! [ -e $CACHE_DIR ]; then git clone -q $DIST_REPO $CACHE_DIR; fi
    - cd $CACHE_DIR
    - git fetch -q --prune --tags "origin"
    - git checkout -B master remotes/origin/master
    - git config user.email "$GITLAB_USER_EMAIL"
    - git config user.name "$GITLAB_USER_NAME"
    - 'git commit --allow-empty -m "{project_name}: $CI_COMMIT_MESSAGE (SHA: $CI_COMMIT_SHORT_SHA)"'
    - git push -q "origin" master:master
    - echo "部署留痕提交完成"
  dependencies:
    - docker-master
```

多仓库聚合模式下，每个子项目的 `deploy-testserver` 的 namespace 必须统一为聚合后的 namespace：
```yaml
deploy-testserver:
  script:
    - kubectl rollout restart deployment {sub_project_name}-deploy -n {namespace}  # namespace 为聚合后的
```

Commit Dockerfile + .gitlab-ci.yml to each project's `testserver` branch and push:

```bash
# 单项目或多仓库中的每个子项目都执行
cd /home/username/Deployments/{project_name}
git add Dockerfile .gitlab-ci.yml
git commit -m "feat: add Dockerfile and CI pipeline for K8s deployment"
git push -u origin testserver
```

### Step 6: Generate Test Kubernetes Config

Create directory `test/kubernetes/{namespace}/` and generate files.

#### 单项目模式

目录名为 `{project_name}`（与 namespace 相同）：

**01-namespace.yaml:**
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: {namespace}
```

**02-{project_name}-pv.yaml** (if PV needed):
```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: {project_name}-pv
spec:
  capacity:
    storage: 16Gi
  accessModes:
    - ReadWriteOnce
  hostPath:
    path: "/mnt/data/{project_name}"
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {project_name}-pvc
  namespace: {namespace}
spec:
  volumeName: {project_name}-pv
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 16Gi
```

**03-{project_name}-deployment.yaml:**

Reference `collabspace-server-deployment.yaml` or `collabspace-web-deployment.yaml` based on project type. Key differences:
- Image: `192.168.0.63:5000/px-{project_name}-test:latest`
- Namespace: `{namespace}`
- Port: detected port
- Health check: detected health check path or TCP probe
- Volume mounts: if PV needed

Include Service in the same file (separated by `---`).

**.gitlab-ci.yml** (sub-directory CI) — 单项目版:

```yaml
{project_name}:deploy:
  tags:
    - "docker"
  stage: deploy
  image: 192.168.0.63:5000/px-infra-kubectl:latest
  only:
    refs:
      - master
    changes:
      - {project_name}/**/*
  script:
    - cd ./{project_name}
    - find ./ -maxdepth 1 -name "*.yaml" | sort | xargs -I {} kubectl apply -f {}
    - kubectl -n {namespace} rollout restart deployment {project_name}-deploy
```

If the project uses configmap (.env file):

```yaml
{project_name}:apply-env:
  tags:
    - "docker"
  stage: apply-env
  image: 192.168.0.63:5000/px-infra-kubectl:latest
  only:
    refs:
      - master
    changes:
      - {project_name}/.env
  script:
    - cd ./{project_name}
    - kubectl create configmap {project_name}-configmap --from-env-file=./.env --dry-run=client -o yaml | kubectl apply -f - -n {namespace}
```

#### 多仓库聚合模式

目录名为 `{namespace}`（公共前缀），在 `test/kubernetes/{namespace}/` 下生成：

**01-namespace.yaml** — 同单项目

**02-{sub_project}-pv.yaml** — 只为需要 PV 的子项目生成，每个子项目独立 PV/PVC

**03-{sub1}-deployment.yaml, 04-{sub2}-deployment.yaml, ...** — 每个子项目一个 deployment+service yaml，编号递增

**.env / .env.{sub}** — 主项目（通常是 API/Server）使用 `.env`，其他子项目使用 `.env.{suffix}`：
- 例如 chark-api → `.env`，chark-uspto-scraper → `.env.uspto-scraper`，chark-ai-worker → `.env.ai-worker`
- suffix 取子项目名去掉公共前缀后的部分

**.gitlab-ci.yml** — 聚合版 CI，包含所有子项目的 configmap 和 rollout restart：

```yaml
{namespace}:apply-env:
  tags:
    - "docker"
  stage: apply-env
  image: 192.168.0.63:5000/px-infra-kubectl:latest
  only:
    refs:
      - master
    changes:
      - {namespace}/.env
      - {namespace}/.env.*
  script:
    - cd ./{namespace}
    # 为每个子项目的 .env 创建对应 configmap
    - kubectl create configmap {sub1}-configmap --from-env-file=./.env --dry-run=client -o yaml | kubectl apply -f - -n {namespace}
    - kubectl create configmap {sub2}-configmap --from-env-file=./.env.{sub2_suffix} --dry-run=client -o yaml | kubectl apply -f - -n {namespace}
    # ... 每个子项目一行

{namespace}:deploy:
  tags:
    - "docker"
  stage: deploy
  image: 192.168.0.63:5000/px-infra-kubectl:latest
  only:
    refs:
      - master
    changes:
      - {namespace}/**/*
  script:
    - cd ./{namespace}
    - find ./ -maxdepth 1 -name "*.yaml" | sort | xargs -I {} kubectl apply -f {}
    # 重启所有子项目
    - kubectl -n {namespace} rollout restart deployment {sub1}-deploy
    - kubectl -n {namespace} rollout restart deployment {sub2}-deploy
    # ... 每个子项目一行
```

**Push 前：创建 PV 所需的宿主机目录**

如果项目需要 PV（hostPath），在 push 之前通过 host-ops Pod 创建目录：

```bash
# 创建项目数据目录
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -n host-ops deployment/host-ops -- \
  sh -c "mkdir -p /host-mnt/data/{project_name} && chmod -R 755 /host-mnt/data/{project_name}"
```

如果需要 Redis PV（见 Step 6.5），一并创建：

```bash
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -n host-ops deployment/host-ops -- \
  sh -c "mkdir -p /host-mnt/data/{project_name}-redis && chmod -R 755 /host-mnt/data/{project_name}-redis"
```

**创建 namespace**（如果是新 namespace）：

```bash
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl create namespace {namespace} --dry-run=client -o yaml | \
docker run --rm -i 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl apply -f -
```

Commit to master and push:

```bash
cd /home/username/Deployments/test/kubernetes
git add {project_name}/
git commit -m "feat: add {project_name} K8s deployment config"
git push origin master
```

### Step 6.5: 初始化服务依赖

基于 Step 3.5 的检测结果，自动初始化各服务。通过 kubectl 直接连接集群中的数据库 Pod 执行操作，无需本机安装数据库客户端。

连接信息从 `references/deploy-config.json` 的 `shared_services` 读取。kubectl 访问方式见 `references/k8s-access.md`。

#### MySQL 建库

通过 kubectl exec 进入集群中可用的 MySQL 客户端 Pod（或直接用数据库 Pod）执行：

```bash
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -n default deployment/mysql -- \
  mysql -u root -p123456 -e "CREATE DATABASE IF NOT EXISTS \`{db_name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

如果没有 MySQL deployment 可 exec，回退到通过 host-ops Pod 安装 mysql-client：

```bash
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -n host-ops deployment/host-ops -- \
  sh -c "apk add --no-cache mysql-client && mysql -h 10.57.0.45 -P 30306 -u root -p123456 -e \"CREATE DATABASE IF NOT EXISTS \\\`{db_name}\\\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\""
```

`{db_name}` 默认为 `{project_name}` 中的横杠替换为下划线（如 `common-agent` → `common_agent`）。

如果项目中存在以下文件，按优先级执行初始化 SQL：
1. `init.sql` 或 `schema.sql`（项目根目录）
2. `sql/init.sql` 或 `sql/schema.sql`
3. `migrations/` 目录下按文件名排序执行所有 `.sql` 文件
4. `src/main/resources/db/migration/` (Java Flyway)

执行 SQL 文件时，先将文件内容读取到本地，再通过 kubectl exec 的 stdin 传入：

```bash
cat {sql_file} | docker run --rm -i 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -i -n default deployment/mysql -- \
  mysql -u root -p123456 {db_name}
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

执行初始化 SQL：

```bash
cat {sql_file} | docker run --rm -i 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -i -n default deployment/postgres -- \
  psql -U postgres -d {db_name}
```

#### Redis 独立部署

如果检测到 Redis 依赖，在 `test/kubernetes/{project_name}/` 中生成 Redis 部署文件。

**在 `02-{project_name}-pv.yaml` 中追加 Redis PV/PVC：**

```yaml
---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: {project_name}-redis-pv
spec:
  capacity:
    storage: 4Gi
  accessModes:
    - ReadWriteOnce
  hostPath:
    path: "/mnt/data/{project_name}-redis"
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {project_name}-redis-pvc
  namespace: {namespace}
spec:
  volumeName: {project_name}-redis-pv
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 4Gi
```

**生成 `04-redis-deployment.yaml`：**

参考 `/home/username/Deployments/test/kubernetes/echo/03-redis-deployment.yaml`：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
  namespace: {namespace}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      initContainers:
        - name: init-dirs
          image: busybox
          command: ['sh', '-c', 'mkdir -p /data/redis && chown -R 999:999 /data/redis']
          volumeMounts:
            - name: redis-storage
              mountPath: /data
      containers:
        - name: redis
          image: redis:7
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 6379
          command:
            - "redis-server"
          args:
            - "--appendonly"
            - "yes"
            - "--dir"
            - "/data"
          volumeMounts:
            - name: redis-storage
              mountPath: /data
              subPath: redis
          readinessProbe:
            exec:
              command: ["redis-cli", "--raw", "incr", "ping"]
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 5
          livenessProbe:
            exec:
              command: ["redis-cli", "--raw", "incr", "ping"]
            initialDelaySeconds: 20
            periodSeconds: 20
            timeoutSeconds: 5
            failureThreshold: 3
          lifecycle:
            preStop:
              exec:
                command: ["sh", "-c", "redis-cli SAVE && sleep 2"]
      volumes:
        - name: redis-storage
          persistentVolumeClaim:
            claimName: {project_name}-redis-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: redis
  namespace: {namespace}
spec:
  type: ClusterIP
  selector:
    app: redis
  ports:
    - port: 6379
      targetPort: 6379
      protocol: TCP
      name: redis
```

注意：Service type 用 `ClusterIP`（namespace 内部访问即可），不像 echo 用 NodePort。

#### Minio Bucket 创建

```bash
# 检查 mc 是否可用，不可用则通过 API 创建
if command -v mc &> /dev/null; then
  mc alias set test-minio http://10.57.0.45:30900 minioadmin minioadmin
  mc mb test-minio/{bucket_name} --ignore-existing
else
  curl -X PUT "http://10.57.0.45:30900/{bucket_name}" \
    -u minioadmin:minioadmin
fi
```

`{bucket_name}` 默认为 `{project_name}`。

#### RabbitMQ Vhost 创建

```bash
curl -s -u root:123456 -X PUT "http://10.57.0.45:31567/api/vhosts/{vhost_name}"
curl -s -u root:123456 -X PUT "http://10.57.0.45:31567/api/permissions/{vhost_name}/root" \
  -H "content-type: application/json" \
  -d '{"configure":".*","write":".*","read":".*"}'
```

`{vhost_name}` 默认为 `{project_name}`。

#### 自动生成 .env 连接串

根据检测到的服务，生成或更新 `test/kubernetes/{project_name}/.env`。

**连接串 key 名称的确定**：
1. 如果项目中有 `.env.example` 或 `.env.template`，从中提取 key 名称
2. 如果没有，使用项目代码中引用的环境变量名称
3. 最终 fallback 使用标准名称（如 `DATABASE_URL`, `REDIS_HOST` 等）

**各服务的标准连接串模板：**

PostgreSQL:
```env
DATABASE_URL=postgresql+asyncpg://postgres:123456@10.57.0.45:30432/{db_name}
```

MySQL:
```env
MYSQL_HOST=10.57.0.45
MYSQL_PORT=30306
MYSQL_USER=root
MYSQL_PASSWORD=123456
MYSQL_DATABASE={db_name}
```

Redis（namespace 内部访问）:
```env
REDIS_HOST=redis
REDIS_PORT=6379
```

Minio:
```env
MINIO_ENDPOINT=http://10.57.0.45:30900
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET={bucket_name}
```

RabbitMQ:
```env
RABBITMQ_HOST=10.57.0.45
RABBITMQ_PORT=30567
RABBITMQ_USER=root
RABBITMQ_PASSWORD=123456
RABBITMQ_VHOST={vhost_name}
```

MongoDB:
```env
MONGO_URI=mongodb://admin:admin@10.57.0.45:30017/{db_name}?authSource=admin
```

Elasticsearch:
```env
ES_HOST=http://10.57.0.45:30200
```

如果 `.env` 文件已存在（Step 6 可能已创建），合并新的连接串到现有内容中。

初始化完成后，如果新增了 Redis yaml 或修改了 .env，重新 commit 并 push：

```bash
cd /home/username/Deployments/test/kubernetes
git add {namespace}/
git commit -m "feat({namespace}): 初始化服务依赖 (Redis/DB/.env)"
git push origin master
```

### Step 7: Generate Test Gateway Config

In `test/gateway/`:

#### 单项目模式

1. **Add upstream** to `nginx/conf.d/00-upstreams.conf`:
```nginx
upstream x{project_name} {
    server {project_name}-svc.{namespace}:{port};
}
```

2. **Create** `nginx/conf.d/x{project_name}.conf`:
```nginx
server {
    listen 80;
    server_name x{project_name}.xtool-staging.yottastudios.com;
    client_max_body_size 1000m;
    charset utf-8;
    error_page 404 502 503 /404;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Real-PORT $remote_port;
    proxy_set_header X-Original-URI $request_uri;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    location / {
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Access-Control-Allow-Origin '*';
        proxy_set_header 'Access-Control-Allow-Credentials' 'true';
        proxy_connect_timeout 300;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        chunked_transfer_encoding off;
        proxy_pass http://x{project_name};
    }
}

server {
    listen 443 ssl;
    server_name x{project_name}.xtool-staging.yottastudios.com;
    http2 on;
    ssl_certificate /etc/ssl/yottastudios.com/cert.pem;
    ssl_certificate_key /etc/ssl/yottastudios.com/key.pem;

    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS, PUT, DELETE" always;
    add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;

    location / {
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Access-Control-Allow-Origin '*';
        proxy_set_header 'Access-Control-Allow-Credentials' 'true';
        proxy_connect_timeout 300;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        chunked_transfer_encoding off;
        proxy_pass http://x{project_name};
    }
}
```

#### 多仓库聚合模式

不是所有子项目都需要 gateway 入口（worker、scraper 等后台服务通常不需要）。先展示列表让用户勾选哪些子项目需要对外暴露。

然后询问用户选择 gateway 模式：

**模式 A：单域名 + 多路径转发**（推荐，如 chark、echo 的模式）

一个域名 `x{namespace}.xtool-staging.yottastudios.com`，通过 location 路径转发到不同 upstream。

1. **Add multiple upstreams** to `nginx/conf.d/00-upstreams.conf`（每个对外暴露的子项目一个 upstream）：
```nginx
upstream x{namespace}-api {
    server {sub_api}-svc.{namespace}:{api_port};
}

upstream x{namespace}-app {
    server {sub_app}-svc.{namespace}:{app_port};
}
```

2. **Create** `nginx/conf.d/x{namespace}.conf`（单域名，多 location）：

询问用户指定每个子项目对应的 location 路径映射，例如：
- `/api/` → API 服务
- `/` → 前端应用
- `/node-api` → Node 服务（如 echo）
- `/documentation` → 文档服务（如 echo）

```nginx
server {
    listen 80;
    server_name x{namespace}.xtool-staging.yottastudios.com;
    client_max_body_size 1000m;
    charset utf-8;
    error_page 404 502 503 /404;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Real-PORT $remote_port;
    proxy_set_header X-Original-URI $request_uri;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    location /api/ {
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 300;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        chunked_transfer_encoding off;
        proxy_pass http://x{namespace}-api;
    }

    location / {
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_pass http://x{namespace}-app;
    }
}

server {
    listen 443 ssl;
    server_name x{namespace}.xtool-staging.yottastudios.com;
    http2 on;
    ssl_certificate /etc/ssl/yottastudios.com/cert.pem;
    ssl_certificate_key /etc/ssl/yottastudios.com/key.pem;

    # 与 80 端口相同的 location 块
    ...
}
```

**模式 B：多域名**

每个对外暴露的子项目独立域名和 upstream，按单项目模式分别生成。

#### Commit & push

```bash
cd /home/username/Deployments/test/gateway
git add nginx/conf.d/00-upstreams.conf nginx/conf.d/x{namespace}.conf
git commit -m "feat: add {namespace} gateway config"
git push origin master
```

### Step 8: Generate Prod Kubernetes Config

In `prod/kubernetes/`:

```bash
git checkout aio-service
git pull origin aio-service
git checkout -b feat/{namespace}
```

Create same structure as test but with prod image:
- 单项目：Image: `us.gcr.io/mocan-cloud/px-{project_name}:latest`
- 多仓库：每个子项目的 Image: `us.gcr.io/mocan-cloud/px-{sub_project_name}:latest`

目录结构与测试服一致（单项目模式或多仓库聚合模式），只是镜像地址改为 GCR。

```bash
git add {namespace}/
git commit -m "feat: add {namespace} K8s deployment config"
git push -u origin feat/{namespace}
```

### Step 9: Generate Prod Gateway Config

In `prod/gateway/`:

```bash
git checkout aio-service
git pull origin aio-service
git checkout -b feat/{namespace}
```

与测试服保持相同的 gateway 模式（单项目/单域名多路径/多域名）：
- Add upstream(s) to `00-upstreams.conf`
- Create `x{namespace}.conf` with domain `x{namespace}.yottastudios.com`

多仓库聚合模式下使用与测试服相同的路径映射规则。

```bash
git add nginx/conf.d/00-upstreams.conf nginx/conf.d/x{namespace}.conf
git commit -m "feat: add {namespace} gateway config"
git push -u origin feat/{namespace}
```

### Step 10: Summary Output

After all steps complete, output a summary:

单项目模式：
```
## 部署完成总结

### 已完成操作
- ✓ 项目 {project_name} 已 clone 到 /home/username/Deployments/{project_name}/
- ✓ Dockerfile + .gitlab-ci.yml 已生成并推送到 testserver 分支
- ✓ 测试服 K8s 配置已推送（CI 将自动 apply）
- ✓ 测试服 Gateway 配置已推送（CI 将自动重建 nginx）
- ✓ 正式服 K8s 配置已推送到 feat/{namespace} 分支
- ✓ 正式服 Gateway 配置已推送到 feat/{namespace} 分支
- ✓ 正式服部署文档已生成: deploy-prod.md

### 测试服访问地址
- https://x{namespace}.xtool-staging.yottastudios.com

### 待人工操作
- 合并正式服 K8s feat 分支: {link}
- 合并正式服 Gateway feat 分支: {link}
```

多仓库聚合模式：
```
## 部署完成总结

### 已完成操作
- ✓ 项目组 {namespace} 已 clone（{N} 个子项目）
- ✓ 每个子项目的 Dockerfile + .gitlab-ci.yml 已推送到 testserver 分支
- ✓ 测试服 K8s 聚合配置已推送到 test/kubernetes/{namespace}/
- ✓ 测试服 Gateway 配置已推送（{单域名多路径/多域名}模式）
- ✓ 正式服 K8s 聚合配置已推送到 feat/{namespace} 分支
- ✓ 正式服 Gateway 配置已推送到 feat/{namespace} 分支
- ✓ 正式服部署文档已生成: deploy-prod.md

### 子项目列表
| 子项目 | 类型 | 端口 | 状态 |
|--------|------|------|------|
| {sub1} | ... | ... | ✓ |
| {sub2} | ... | ... | ✓ |

### 测试服访问地址
- https://x{namespace}.xtool-staging.yottastudios.com

### 待人工操作
- 合并正式服 K8s feat 分支: {link}
- 合并正式服 Gateway feat 分支: {link}
```

### Step 10.5: 部署后自验证

测试服所有配置推送后，自动验证部署是否成功。

kubectl 访问方式见 `references/k8s-access.md`。GitLab CI API 见 `references/gitlab-ci-api.md`。Grafana/Loki 见 `references/loki-api.md`。

#### 阶段 1：监控 GitLab CI Pipeline

对每个推送了代码的仓库（项目本身、test kubernetes、test gateway），获取并跟踪最新 pipeline：

1. 通过 GitLab API 获取项目 ID（用 URL-encoded path）
2. 获取 `ref=master`（或 `testserver`）的最新 pipeline
3. 每 15 秒轮询一次 pipeline 状态，最多等 10 分钟
4. 报告每个 pipeline 的最终状态

```bash
# 获取项目 ID
PROJECT_ID=$(curl -s -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://pt-gitlab.yottastudios.com/api/v4/projects/{url_encoded_path}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# 获取最新 pipeline
PIPELINE_ID=$(curl -s -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://pt-gitlab.yottastudios.com/api/v4/projects/$PROJECT_ID/pipelines?ref=master&per_page=1" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

# 轮询状态
STATUS="running"
while [ "$STATUS" != "success" ] && [ "$STATUS" != "failed" ]; do
  sleep 15
  STATUS=$(curl -s -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
    "https://pt-gitlab.yottastudios.com/api/v4/projects/$PROJECT_ID/pipelines/$PIPELINE_ID" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
  echo "Pipeline $PIPELINE_ID 状态: $STATUS"
done
```

如果任何 CI 失败：
1. 获取失败 job 列表
2. 读取失败 job 的日志
3. 分析失败原因
4. 尝试自动修复（常见原因：Dockerfile 语法错误、依赖安装失败、kubectl 权限）
5. 修复后重新 push 并再次轮询

#### 阶段 2：通过 kubectl 检查 Pod 状态和日志（优先）

所有 CI 成功后，等待 30 秒让 Pod 完成启动，然后直接通过 kubectl 检查：

```bash
# 1. 检查 Pod 状态
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl get pods -n {namespace} -l app={project_name}

# 2. 查看 Pod 日志（最近 100 行）
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl logs deployment/{project_name}-deploy -n {namespace} --tail=100 \
  > /tmp/k8s-deploy-logs.txt

# 3. 检查 Pod 事件（排查调度/拉取镜像问题）
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl describe pod -n {namespace} -l app={project_name} \
  > /tmp/k8s-pod-describe.txt
```

#### 阶段 2.5：通过 Grafana/Loki 补充查询（备选）

如果 kubectl 日志不足以判断问题（例如 Pod 不断重启、日志被截断），通过 Loki 查询更完整的历史日志：

```bash
END_NS=$(date +%s)000000000
START_NS=$(($(date +%s) - 300))000000000

# 查看全部日志
QUERY='{app="{project_name}"}'
curl -s -u "pxtool:pxtool123" \
  "https://xgrafana.xtool-staging.yottastudios.com/api/datasources/proxy/2/loki/api/v1/query_range?query=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$QUERY'))")&start=$START_NS&end=$END_NS&limit=100" \
  > /tmp/loki-deploy-1.log

# 查看错误日志
QUERY='{app="{project_name}"} |~ "(?i)error|exception|fatal" !~ "healthcheck|ping"'
curl -s -u "pxtool:pxtool123" \
  "https://xgrafana.xtool-staging.yottastudios.com/api/datasources/proxy/2/loki/api/v1/query_range?query=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$QUERY'))")&start=$START_NS&end=$END_NS&limit=100" \
  > /tmp/loki-deploy-errors.log
```

#### 阶段 3：判断结果

| 情况 | 行动 |
|------|------|
| Pod Running + 日志中有启动成功信号 | 报告"部署成功 ✓"，输出访问地址 |
| Pod Running + 日志中有错误 | 分析错误原因，常见修复：修正 .env 连接串、修改端口配置。修复后重新 push 并从阶段 1 重新验证 |
| Pod CrashLoopBackOff | 读取日志和 describe 输出，分析崩溃原因（缺少环境变量、端口冲突、依赖服务未就绪等） |
| Pod Pending | 检查 describe 中的事件，可能是 PV 未创建、资源不足、镜像拉取失败 |
| Pod ImagePullBackOff | CI 可能未成功推送镜像，检查 CI 日志 |

**自动修复最多尝试 3 次**，超过后将问题报告给用户，附上 Pod 状态、日志和分析结果。

### Step 11: 生成正式服部署文档

根据 Step 3.5 检测到的服务依赖，在 `prod/kubernetes/{namespace}/deploy-prod.md` 生成正式服部署文档。此文件包含在 feat 分支中，随 K8s 配置一起提交。

**重要：生成前必须先读取已有的 deploy-prod.md 作为格式参考。**

1. 用 Glob 查找 `test/kubernetes/*/deploy-prod.md`
2. 读取至少 2 个已有的 deploy-prod.md（优先选择 mfa、audiotool、chark 等简洁的）
3. 严格按照读取到的文档格式生成，以下为 fallback 标准格式

**标准格式**（从 mfa, audiotool, chark 等已有文档提炼，只生成项目实际用到的章节，章节编号连续递增）：

```markdown

# 1.加解析到指定服务器

## 1.1 aio-service
- https://x{namespace}.yottastudios.com

备注： 外网需要确保aio-service服务器能访问到x{namespace}.yottastudios.com，aio-service服务器本身也要加此域名的hosts/k8s的dns解析。


# 2.minio

## 2.1 通用minio上的配置

### 2.1.1 新建bucket
在外网xminio.yottastudios.com上

新建bucket： {bucket_names}

{bucket_name}的Access Policy 设置为custom， 并配置：
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "AWS": [
                    "*"
                ]
            },
            "Action": [
                "s3:GetBucketLocation",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::{bucket_name}"
            ]
        },
        {
            "Effect": "Allow",
            "Principal": {
                "AWS": [
                    "*"
                ]
            },
            "Action": [
                "s3:GetObject"
            ],
            "Resource": [
                "arn:aws:s3:::{bucket_name}/*"
            ]
        }
    ]
}
```

### 2.1.2 新建用户
在外网xminio上

新建{namespace}对应用户，授权编辑权限， 用于后续环境变量配置


# {N}.mysql

## {N}.1 外网建库配用户
在aio-data服务器的mysql上新建{db_name}库，并创建用户密码，记录好库名、账号和密码，后面写入`.env`。


# {N}.rabbitmq新建用户 外网aio-data都操作一下

执行前替换用户名testuser, 密码testpassword
```
rabbitmqctl add_user testuser testpassword
rabbitmqctl set_permissions -p / testuser ".*" ".*" ".*"
rabbitmqctl set_topic_permissions -p / testuser ".*" ".*" ".*"
```


# {N}.k8s相关操作, 执行部署 外网aio-service操作一下

## {N}.1新建pv用到的hostPath
```bash
sudo mkdir -p /mnt/data/{pv_dir}
sudo chmod -R 755 /mnt/data/{pv_dir}
```

## {N}.2更新k8s.yml

外网
```bash
cd kubernetes
git pull origin aio-service
```

## {N}.3新建{namespace}的namespace, 并配置镜像拉取认证

首先要生成/tmp/gcp-key.json, 参考

https://pt-gitlab.yottastudios.com/px/collabspace/kubernetes/-/blob/master/deploy.md 的 6.GCR认证配置

创建namespace, 并绑定认证:
```bash
cd kubernetes
kubectl apply -f {namespace}/01-namespace.yaml

kubectl create secret docker-registry gcr-secret \
  --docker-server=us.gcr.io \
  --docker-username=_json_key \
  --docker-password="$(cat /tmp/gcp-key.json)" \
  --docker-email=containerregistry@mocan-cloud.iam.gserviceaccount.com \
  -n {namespace}
```

## {N}.4环境变量
1. 将 {namespace} 的 `.env`{及其他 .env 文件} 复制到 `/home/game/kubernetes_env/{namespace}/`
```bash
cd kubernetes
mkdir -p /home/game/kubernetes_env/{namespace}
cp {namespace}/.env /home/game/kubernetes_env/{namespace}/.env
```
（多仓库聚合模式下，每个额外的 .env 文件各一行 cp 命令）

2. 根据实际环境修改 `.env` 中带有 *CHANGE_ME* 字样的变量：
   - 逐个列出需要修改的变量名和说明
3. 创建configmap
```bash
cd kubernetes
kubectl create configmap {configmap_name}-configmap --from-env-file=/home/game/kubernetes_env/{namespace}/.env --dry-run=client -o yaml | kubectl apply -f - -n {namespace}
```
（多仓库聚合模式下，每个 .env 文件对应一条 configmap 命令）

## {N}.5部署{namespace}并重启网关
1.部署
```bash
cd kubernetes
kubectl apply -f {namespace}/
```
2.检查是否部署成功
```bash
kubectl get po -n {namespace}
```
3.重启网关
```bash
kubectl rollout restart deployment/infra-geteway-deploy
```
```

**格式规则：**
- 章节编号连续，跳过项目不需要的服务（如无 minio 则从 1.DNS 直接到 2.mysql）
- 不使用 `## 1. DNS 配置` 等自创格式，严格使用 `# 1.加解析到指定服务器`
- 不使用环境变量表格，而是列出 cp 命令 + CHANGE_ME 变量列表
- 不单独设 "部署验证" 章节，验证步骤嵌入 k8s 部署章节的 "检查是否部署成功"
- 必须有 namespace + GCR 认证子节
- 环境变量必须有 cp 到 `/home/game/kubernetes_env/` 的步骤

此文档在 Step 8（生成正式服 K8s 配置）时一并写入 `prod/kubernetes/{namespace}/deploy-prod.md`，随 feat 分支提交。

## Error Handling

- **GITLAB_TOKEN missing** → Stop, prompt user, provide token creation URL
- **GitLab 401** → Token invalid or no permission
- **git clone fails** → Check gitlab_path is correct
- **testserver branch doesn't exist** → Create it from master
- **Project type unrecognized** → Ask user for project type and port
- **Port not detected** → Ask user to specify port
- **feat branch already exists** → Ask user whether to overwrite or skip
- **GitLab Group API 返回空** → Group path 可能不正确，或 group 下无项目
- **多仓库无法检测公共前缀** → 所有项目名称无公共前缀，询问用户是否手动指定 namespace 或按独立项目处理
- **已有 namespace 中存在同名 deployment** → 提示用户可能需要合并到已有 namespace，确认后继续
- **数据库连接失败** → 检查 deploy-config.json 中的地址和端口是否正确，网络是否可达
- **SQL 执行失败** → 输出错误信息，可能是 SQL 语法问题或权限不足
- **Redis PV 创建失败** → 检查 hostPath 目录是否已被其他 PV 占用
- **CI pipeline 超时** → 10 分钟后仍未完成，报告给用户
- **Loki 无日志** → Pod 可能未启动，检查 `kubectl get pods`，可能是镜像拉取失败或资源不足
- **部署后自动修复超过 3 次** → 停止重试，将所有错误日志和分析结果报告给用户

## Additional Resources

- **`references/deploy-config.json`** — 基础设施配置（仓库地址、镜像仓库、域名、共享服务、kubectl、Grafana）
- **`references/k8s-access.md`** — K8s 集群远程访问参考（kubectl 命令、host-ops 操作、数据库 Pod 访问）
- **`references/gitlab-ci-api.md`** — GitLab CI Pipeline API 参考（轮询 CI 状态、读取 job 日志）
- **`references/loki-api.md`** — Grafana/Loki 日志查询 API 参考（部署后日志补充查询）
