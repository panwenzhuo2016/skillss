# SurveyKing K8s 网络与部署梳理

## 整体架构

```
用户浏览器
    ↓
外部 Nginx（不在 K8s 集群内，由运维管理）
    ↓ 反向代理到服务器 IP:端口
K8s 节点（10.57.0.45 / xtool-staging-1）
    ↓ kube-proxy iptables 转发
K8s Pod（容器内的应用）
```

## 关键概念

### 1. K8s Service 类型

| 类型 | 说明 | 集群外可访问？ |
|------|------|----------------|
| **ClusterIP**（默认） | 只分配集群内部 IP，仅集群内 Pod 间互访 | 否 |
| **NodePort** | 在每个节点上开放一个端口（30000-32767），映射到 Service | 是，通过 `节点IP:NodePort` |
| **LoadBalancer** | 云厂商自动创建负载均衡器 | 是 |

### 2. 当前 SurveyKing 网络配置

- **Service**: `surveyking-svc`，类型 `NodePort`
- **内部端口**: 1991（容器端口）
- **外部端口**: 1793（NodePort，K8s 自动分配）
- **访问方式**: `http://10.57.0.45:1793`

### 3. 域名访问（如 xcollabspace-test.xtool-staging.yottastudios.com）

当前测试环境的域名访问链路：

1. DNS 解析：`*.xtool-staging.yottastudios.com` → `10.57.0.45`
2. 外部 Nginx（不在这台服务器上，运维管理）接收请求
3. Nginx 根据 `server_name` 反向代理到对应的 K8s Service（ClusterIP 或 NodePort）
4. kube-proxy 通过 iptables 将流量转发到对应的 Pod

**要让 `xsurveyking-test.xtool-staging.yottastudios.com` 生效，需要运维在外部 Nginx 加配置：**

```nginx
server {
    listen 80;
    server_name xsurveyking-test.xtool-staging.yottastudios.com;
    location / {
        proxy_pass http://10.57.0.45:1793;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### 4. Pod 间通信

同集群内的 Pod 可以通过 `<service-name>.<namespace>` 互访：

- SurveyKing 访问 MySQL：`mysql.default:3306`（MySQL 在 default namespace）
- 其他服务访问 SurveyKing：`surveyking-svc.surveyking:1991`

### 5. ConfigMap 与环境变量

- `.env` 文件通过 CI 创建为 ConfigMap（`surveyking-configmap`）
- Deployment 通过 `envFrom.configMapRef` 将 ConfigMap 的所有 key 注入为环境变量
- 修改 `.env` 后需要重新创建 ConfigMap 并重启 Deployment 才能生效

### 6. 持久化存储（PV/PVC）

- `hostPath` 类型，数据存在节点本地磁盘 `/mnt/data/surveyking`
- 需要 `type: DirectoryOrCreate` 让 K8s 自动创建目录
- PV 一旦创建，`spec` 不可修改，需要删除重建
- 删除 PV/PVC 的正确顺序：先清除 finalizers → 删 PVC → 删 PV → 重新 apply

## 部署流程

### 首次部署

1. **kubernetes 仓库推 master** → CI 自动执行：
   - `apply-env` stage：创建 namespace → 从 `.env` 创建 ConfigMap
   - `deploy` stage：apply 所有 yaml（namespace、PV/PVC、Deployment、Service）→ rollout restart
2. **手动初始化数据库**：将 `init-mysql.sql` 导入 MySQL（应用不会自动建表）
3. **surveyking 主仓库推 testserver** → CI 自动执行：
   - 构建 Docker 镜像 → 推送到内网仓库 → rollout restart
4. **找运维配域名**：在外部 Nginx 添加反向代理

### 日常更新

- **改代码**：推 testserver 分支 → 自动构建镜像 + 部署
- **改环境变量**：改 kubernetes 仓库 `surveyking/.env` 推 master → 自动更新 ConfigMap + 重启
- **改 K8s 配置**：改 kubernetes 仓库 `surveyking/*.yaml` 推 master → 自动 apply + 重启

## 常用排查命令

```bash
# 看 pod 状态
kubectl get pods -n surveyking

# 看 pod 详情（排查启动失败原因）
kubectl describe pod <pod-name> -n surveyking

# 看应用日志
kubectl logs deployment/surveyking-deploy -n surveyking --tail=100

# 看实时日志
kubectl logs -f deployment/surveyking-deploy -n surveyking

# 看上一个挂掉的容器日志
kubectl logs deployment/surveyking-deploy -n surveyking --previous

# 看 service 和端口
kubectl get svc -n surveyking

# 看 configmap 内容
kubectl get configmap surveyking-configmap -n surveyking -o yaml

# 进入容器排查
kubectl exec -it deployment/surveyking-deploy -n surveyking -- /bin/bash

# 重启 deployment
kubectl rollout restart deployment surveyking-deploy -n surveyking
```

## 踩过的坑

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `openjdk:8-jre-alpine` not found | Docker Hub 下架了旧镜像 | 换 `eclipse-temurin:8-jre-focal` |
| Alpine 下字体加载失败 | musl libc 对 Java AWT 支持差 | 换非 Alpine 基础镜像（focal） |
| `CreateContainerConfigError` | ConfigMap 不存在 | kubernetes 仓库推 master 触发 CI 创建 |
| PV `spec is immutable` | PV 创建后不能改 spec | 删除 PV/PVC 重建 |
| `hostPath` 目录不存在 | 默认不自动创建 | 加 `type: DirectoryOrCreate` |
| CI `apply-env` 找到 `.gitlab-ci.yml` 自身 | find 匹配了 `.yml` 文件 | 排除 `.gitlab-ci.yml` |
| `.env` 没触发 CI | 被 `.gitignore` 忽略 | `git add -f` 强制添加 |
