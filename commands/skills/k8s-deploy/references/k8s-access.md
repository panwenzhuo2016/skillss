# K8s 集群远程访问参考

## 访问方式

通过 Docker 镜像直接操作测试服 K8s 集群，无需安装 kubectl 或配置 kubeconfig：

```bash
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest kubectl <命令>
```

镜像内置 `kubernetes-admin` 凭证，连接 `10.57.0.45:6443`。

## 前提条件

1. 主机已安装 Docker
2. 主机能访问镜像仓库 `192.168.0.63:5000`
3. 主机能访问集群 API Server `10.57.0.45:6443`

## 常用命令

### 查看资源

```bash
# 查看 Pod
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl get pods -n {namespace}

# 查看 Pod 详情（排查调度/事件问题）
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl describe pod -n {namespace} -l app={project_name}

# 查看日志
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl logs deployment/{name}-deploy -n {namespace} --tail=100
```

### Namespace 操作

```bash
# 创建（幂等）
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl create namespace {namespace} --dry-run=client -o yaml | \
docker run --rm -i 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl apply -f -
```

### 进入 Pod 执行命令

```bash
# 执行单条命令
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -n {namespace} deployment/{name} -- {command}

# 通过 stdin 传入内容（如 SQL 文件）
cat file.sql | docker run --rm -i 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -i -n {namespace} deployment/{name} -- {command}
```

### 应用本地 YAML 文件

```bash
docker run --rm -v /path/to/yamls:/manifests \
  192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl apply -f /manifests/
```

### 重启 Deployment

```bash
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl rollout restart deployment/{name}-deploy -n {namespace}
```

## 宿主机 /mnt 目录操作

通过集群中的 `host-ops` Pod 操作宿主机 `/mnt` 目录（挂载为 `/host-mnt`）：

```bash
# 创建 PV 数据目录
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -n host-ops deployment/host-ops -- \
  sh -c "mkdir -p /host-mnt/data/{dir-name} && chmod -R 755 /host-mnt/data/{dir-name}"

# 查看目录
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -n host-ops deployment/host-ops -- \
  ls -la /host-mnt/data/
```

## 数据库操作

### 进入 MySQL Pod

```bash
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -n default deployment/mysql -- \
  mysql -u root -p123456 -e "{sql_command}"
```

### 进入 PostgreSQL Pod

```bash
docker run --rm 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -n default deployment/postgres -- \
  psql -U postgres -c "{sql_command}"
```

### 通过 stdin 执行 SQL 文件

```bash
cat schema.sql | docker run --rm -i 192.168.0.63:5000/px-infra-kubectl:latest \
  kubectl exec -i -n default deployment/mysql -- \
  mysql -u root -p123456 {db_name}
```

## 注意事项

- 镜像拥有集群最高权限（`kubernetes-admin`），注意操作安全
- 需要交互的命令（`exec -it`、`logs -f`）需加 `-it`：`docker run --rm -it`
- 应用本地文件需通过 `-v` 挂载
- 集群地址为内网 `10.57.0.45:6443`，外网需 VPN
