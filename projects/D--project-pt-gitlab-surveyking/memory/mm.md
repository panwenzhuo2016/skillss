# K8s 常用命令速查

## Pod 状态管理

```bash
# 查看指定命名空间下所有 pod 的状态（READY/STATUS/RESTARTS/AGE）
kubectl get pods -n surveyking

# 实时监听 pod 状态变化，新建/重启/销毁都会实时刷新，Ctrl+C 退出
kubectl get pods -n surveyking -w

# 查看 pod 详细信息：事件日志、容器状态、挂载卷、环境变量引用等
# 启动失败时第一个要跑的命令，底部 Events 会显示具体失败原因
kubectl describe pod <pod-name> -n surveyking
```

## 应用日志

```bash
# 查看最近 100 行日志，排查启动报错、业务异常
kubectl logs deployment/surveyking-deploy -n surveyking --tail=100

# 实时跟踪日志输出，类似 tail -f，适合观察请求处理过程，Ctrl+C 退出
kubectl logs -f deployment/surveyking-deploy -n surveyking

# 查看上一个已终止容器的日志，pod 反复重启时用这个看崩溃前的日志
kubectl logs deployment/surveyking-deploy -n surveyking --previous
```

## Service 网络

```bash
# 查看 service 列表：类型（ClusterIP/NodePort）、集群IP、端口映射
kubectl get svc -n surveyking

# 将 service 从 ClusterIP 改为 NodePort，改完后会分配一个 30000+ 端口
# 通过 节点IP:NodePort 就能从集群外访问
kubectl patch svc surveyking-svc -n surveyking -p '{"spec":{"type":"NodePort"}}'
```

## ConfigMap 环境变量

```bash
# 查看命名空间下所有 configmap
kubectl get configmap -n surveyking

# 查看 configmap 的具体内容（所有 key-value）
kubectl get configmap surveyking-configmap -n surveyking -o yaml

# 从 .env 文件创建/更新 configmap
# --dry-run=client -o yaml 先生成 yaml 不实际执行，再通过管道 apply
# 这样无论 configmap 存不存在都能用（创建或更新）
kubectl create configmap surveyking-configmap \
  --from-env-file=./surveyking/.env \
  --dry-run=client -o yaml | kubectl apply -f - -n surveyking
```

## PV/PVC 持久化存储

```bash
# 清除 PV 的 finalizer，让 K8s 立即释放而不等待
# PV 卡在 Terminating 状态时用这个强制解除
kubectl patch pv surveyking-pv -p '{"metadata":{"finalizers":null}}'

# 同上，清除 PVC 的 finalizer
kubectl patch pvc surveyking-pvc -n surveyking -p '{"metadata":{"finalizers":null}}'

# 强制删除 PV，不等待绑定的 PVC 释放
kubectl delete pv surveyking-pv --force

# 删除 PVC，会触发关联 PV 的回收流程
kubectl delete pvc surveyking-pvc -n surveyking
```

## 部署操作

```bash
# 滚动重启 deployment，K8s 会新建 pod 再销毁旧 pod，不停服
# 更新镜像、更新 configmap 后都需要执行
kubectl rollout restart deployment surveyking-deploy -n surveyking

# 应用 yaml 配置文件，创建或更新 K8s 资源
# 可以是 namespace、deployment、service、pv 等任何资源
kubectl apply -f xxx.yaml
```

## 资源监控

```bash
# 查看节点整体资源使用：CPU 核数和占比、内存大小和占比
kubectl top nodes

# 查看指定命名空间下所有 pod 的实际 CPU 和内存占用
kubectl top pod -n surveyking

# 查看 K8s 系统组件的资源占用（apiserver、etcd、coredns 等）
kubectl top pods -n kube-system
```

## 网络排查

```bash
# 查看所有命名空间的 ingress 规则（域名 → service 的映射）
kubectl get ingress -A

# 查看 service 详情，包含 selector（关联哪些 pod）
kubectl get svc -n <namespace> -o wide

# DNS 解析，查看域名指向哪个 IP
nslookup <domain>

# 请求 URL 只看响应头，确认服务是否可达、用的什么 web 服务器
curl -I <url>

# 查看服务器上 80/443 端口被哪个进程监听
sudo netstat -tlnp | grep -E "80|443"

# 查看 iptables NAT 规则，确认 kube-proxy 的端口转发目标
sudo iptables -t nat -L -n | grep <port>
```
