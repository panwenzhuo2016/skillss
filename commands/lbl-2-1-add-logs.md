# 给改动代码添加关键日志

查看当前项目的 `git diff HEAD`，针对本次改动的代码添加关键日志。

## 日志原则

1. **只在增删改操作处加日志**：CREATE / UPDATE / DELETE 相关的业务操作必须加日志
2. **查询操作一般不加日志**：除非是关键业务查询（如权限校验、登录验证），普通查询不加
3. **不要频繁打印**：循环内部、高频调用的方法内部不加日志
4. **不要为了日志增加额外的数据库查询或 API 调用**
5. **错误和异常必须加日志**：catch 块中必须有 error 级别日志
6. **关键业务节点加日志**：如状态变更、审批流转、权限变更等
7. **对外的接口，调用或被调用，日志打印详细点**：必须有：地址、请求头、入参、返回等
8. **同类职责的日志放在归属的类里**：日志跟着代码走，配置获取的日志放在 ConfigCache/ConfigService 里，第三方调用的日志放在 XxxClient 里，不要在 Service 调用处额外加一层日志。同一个操作只在最终执行的那个类里打日志，调用方不重复打。

## 统一前缀和格式

根据项目的 CLAUDE.md 或 package.json / build.gradle 等识别项目名称作为前缀。格式统一为：

```
[lbl][分支上的数字(没有就不写)-本次功能名简写][模块名][操作] 描述, 关键参数
```

### 后端（Java / Spring Boot）

使用 Slf4j，日志级别规范：
- `log.info` — 增删改成功、关键业务节点
- `log.warn` — 业务异常（如参数校验失败、权限不足）
- `log.error` — 系统异常、catch 块异常

示例：
```java
// 创建操作
log.info("[lbl][分支上的数字(没有就不写)-本次功能名简写][Space][CREATE] 创建空间, spaceId={}, userId={}", spaceId, userId);

// 更新操作
log.info("[lbl][分支上的数字(没有就不写)-本次功能名简写][Node][UPDATE] 更新节点名称, nodeId={}, oldName={}, newName={}", nodeId, oldName, newName);

// 删除操作
log.info("[lbl][分支上的数字(没有就不写)-本次功能名简写][Node][DELETE] 删除节点, nodeId={}, operatorId={}", nodeId, operatorId);

// 关键业务
log.info("[lbl][分支上的数字(没有就不写)-本次功能名简写][Permission][GRANT] 授权, targetUserId={}, role={}", targetUserId, role);

// 业务警告
log.warn("[lbl][分支上的数字(没有就不写)-本次功能名简写][Asset][UPLOAD] 文件大小超出建议值, assetId={}, size={}MB", assetId, sizeMB);

// 异常捕获
log.error("[lbl][分支上的数字(没有就不写)-本次功能名简写][Node][UPDATE] 更新节点失败, nodeId={}, error={}", nodeId, e.getMessage(), e);
```

注意事项：
- 使用占位符 `{}` 而非字符串拼接
- error 日志最后一个参数传异常对象 `e`（打印堆栈）
- 不要打印敏感信息（密码、token 等）
- 不要在入参出参都打日志，只在操作执行后打

### 前端（TypeScript / React）

使用 `console` 方法，日志级别规范：
- `console.info` — 增删改请求发起和成功回调
- `console.warn` — 业务异常（接口返回错误码）
- `console.error` — 请求失败、catch 异常

示例：
```typescript
// API 调用 - 变更操作
console.info('[lbl][分支上的数字(没有就不写)-本次功能名简写][Space][CREATE] 创建空间请求', { spaceName, templateId });

// 成功回调
console.info('[lbl][分支上的数字(没有就不写)-本次功能名简写][Node][DELETE] 删除节点成功', { nodeId });

// 业务警告
console.warn('[lbl][分支上的数字(没有就不写)-本次功能名简写][Permission][DENIED] 权限不足', { spaceId, action });

// 异常
console.error('[lbl][分支上的数字(没有就不写)-本次功能名简写][Node][UPDATE] 更新失败', { nodeId, error });
```

注意事项：
- 不要在渲染函数、useEffect 的频繁触发场景中加日志
- API 请求只在发起变更操作时打日志，GET 请求不打
- 不要打印大对象（如整个列表数据），只打关键 ID 和状态

### 其他语言

对于 Python、Go 等项目，遵循同样的前缀格式和原则，使用对应语言的标准日志库。

## 执行步骤

1. 读取项目配置（CLAUDE.md / package.json / build.gradle 等）确定项目名称作为日志前缀
2. 执行 `git diff HEAD` 查看本次改动的文件和内容
3. 分析每个改动文件的业务逻辑，识别增删改操作点
4. 按照上述规范在合适位置添加日志
5. 确保不破坏原有逻辑，日志代码独立于业务代码
6. 最后总结，加了多少条日志。