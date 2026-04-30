# Vue + Spring Boot 应用：一个请求的 10 步全链路

> 以用户点击按钮发起一次 API 请求为例，完整走完前后端

## 1. 用户交互 → 事件触发
用户在浏览器里点击按钮/提交表单/路由跳转，触发 Vue 组件的事件处理函数（`@click`、`@submit`、路由守卫等）。

```vue
<button @click="handleSubmit">提交</button>
```

## 2. 前端：组装请求 & 拦截器
调用封装好的 API 方法（通常是 axios 实例），经过**请求拦截器**：
- 从 localStorage/Vuex/Pinia 取 token，塞进 `Authorization: Bearer xxx`
- 添加公共参数（租户ID、语言、时间戳等）
- 请求体序列化（JSON / FormData）

```js
// request interceptor
service.interceptors.request.use(config => {
  config.headers['Authorization'] = `Bearer ${getToken()}`
  return config
})
```

## 3. 网络层：浏览器 → Nginx → 后端
请求发出后经过：
- **浏览器** → DNS 解析 → TCP 连接（HTTPS 握手）
- **Nginx/网关** → 反向代理，`/api/**` 转发到 Spring Boot 服务（负载均衡）
- 如果是 K8s 部署：Ingress → Service → Pod

```nginx
location /api/ {
    proxy_pass http://backend-service:8080/;
}
```

## 4. 后端：Filter 链（安全、跨域、日志）
请求进入 Spring Boot 后，先过 **Filter 链**（Servlet Filter）：
- `CorsFilter` → 处理跨域
- `SecurityFilter`（Spring Security）→ 解析 JWT、验证 token、加载用户信息到 SecurityContext
- `RequestLogFilter` → 记录请求日志、生成 traceId
- `XssFilter` → 输入过滤

任何一个 Filter 拒绝，请求直接返回 401/403，不进入 Controller。

## 5. 后端：DispatcherServlet → HandlerMapping → Interceptor
Spring MVC 核心流程：
- `DispatcherServlet` 接收请求
- `HandlerMapping` 根据 URL + Method 找到对应的 Controller 方法
- 执行 **HandlerInterceptor**（`preHandle`）：
  - 权限校验（数据权限、菜单权限）
  - 限流检查（令牌桶/滑动窗口）
  - 参数解密/签名验证

## 6. 后端：Controller → 参数绑定 & 校验
进入 Controller 方法：
- `@RequestBody` → Jackson 反序列化 JSON 为 Java 对象
- `@Valid` / `@Validated` → 触发 JSR-303 参数校验（`@NotNull`、`@Size` 等）
- 校验不通过 → `MethodArgumentNotValidException` → 全局异常处理器返回 400

```java
@PostMapping("/order")
public Result<?> createOrder(@Valid @RequestBody OrderDTO dto) {
    return Result.ok(orderService.create(dto));
}
```

## 7. 后端：Service → 业务逻辑 & 事务
核心业务逻辑层：
- `@Transactional` 开启事务
- 业务校验（状态机检查、库存判断、幂等性校验）
- 调用其他 Service / 远程服务（Feign/RestTemplate）
- 操作缓存（Redis 读写）
- 发送消息（RabbitMQ/Kafka）
- 事务提交或回滚

```java
@Transactional(rollbackFor = Exception.class)
public OrderVO create(OrderDTO dto) {
    // 1. 校验
    // 2. 写库
    // 3. 扣库存（远程调用/本地）
    // 4. 发消息
    return orderVO;
}
```

## 8. 后端：DAO → 数据库操作
Service 调用 Mapper/Repository：
- MyBatis：SQL 映射 → PreparedStatement（参数化查询防注入）
- JPA/Hibernate：对象映射 → 自动生成 SQL
- 连接池（HikariCP）获取连接 → 执行 SQL → 归还连接
- 涉及：索引命中、事务隔离级别、锁竞争

```java
// MyBatis
orderMapper.insert(order);
orderItemMapper.batchInsert(items);
```

## 9. 后端：响应返回 → 全局处理
方法执行完毕，响应逐层返回：
- Controller 返回 `Result<T>` → Jackson 序列化为 JSON
- **全局异常处理器**（`@RestControllerAdvice`）捕获未处理异常 → 统一错误格式
- `HandlerInterceptor.afterCompletion` → 记录响应日志、耗时
- Filter 链反向执行 → 响应头处理
- Nginx 透传响应 → 浏览器

```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(BusinessException.class)
    public Result<?> handle(BusinessException e) {
        return Result.fail(e.getCode(), e.getMessage());
    }
}
```

## 10. 前端：响应处理 → UI 更新
axios **响应拦截器**处理返回：
- HTTP 状态码判断（200/401/403/500）
- 业务 code 判断（成功/失败/token 过期）
- 401 → 清除 token → 跳转登录页
- 成功 → 更新 Pinia/Vuex 状态 → Vue 响应式驱动 DOM 更新
- 失败 → `ElMessage.error()` 提示用户

```js
// response interceptor
service.interceptors.response.use(
  response => {
    const { code, data, msg } = response.data
    if (code !== 200) {
      ElMessage.error(msg)
      return Promise.reject(msg)
    }
    return data
  },
  error => {
    if (error.response?.status === 401) {
      store.dispatch('user/logout')
      router.push('/login')
    }
  }
)
```

## 流程图

```
用户点击
  ↓
Vue 事件处理 → axios 请求拦截器(加token/公共参数)
  ↓
浏览器 → Nginx反向代理 → Spring Boot
  ↓
Filter链(CORS → Security/JWT → 日志 → XSS)
  ↓
DispatcherServlet → HandlerMapping → Interceptor(权限/限流)
  ↓
Controller(参数绑定 → @Valid校验)
  ↓
Service(@Transactional → 业务逻辑 → Redis/MQ)
  ↓
DAO/Mapper → 数据库(HikariCP → SQL执行)
  ↓
响应返回: Result<T> → JSON序列化 → 异常处理 → 日志 → Nginx
  ↓
axios 响应拦截器(状态判断 → 错误处理)
  ↓
Pinia/Vuex 状态更新 → Vue响应式 → DOM更新 → 用户看到结果
```

## 每一步可能出问题的地方

| 步骤 | 常见问题 |
|------|---------|
| 1. 事件触发 | 重复点击、防抖未加 |
| 2. 请求拦截 | Token 过期未刷新、Content-Type 错误 |
| 3. 网络层 | CORS 跨域、Nginx 超时（504）、DNS 解析失败 |
| 4. Filter | JWT 过期/篡改、IP 黑名单 |
| 5. Interceptor | 无权限、限流触发 |
| 6. Controller | 参数校验失败、反序列化异常 |
| 7. Service | 业务校验不通过、事务死锁、远程调用超时 |
| 8. DAO | 慢 SQL、连接池耗尽、死锁、N+1 查询 |
| 9. 响应返回 | 序列化循环引用、异常未捕获导致 500 |
| 10. 前端处理 | 未处理 null 值、状态未更新、错误提示缺失 |
