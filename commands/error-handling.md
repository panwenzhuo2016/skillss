# 添加错误处理

为改动代码添加完善的错误处理。

## 参数

$ARGUMENTS — 文件路径（可选，默认为 git diff 改动文件）

## 执行步骤

1. 确定目标文件
2. 识别缺少错误处理的代码位置
3. 按规范添加错误处理

## 需要错误处理的场景

### 后端（Java）
- **外部调用**：HTTP 请求、RPC 调用、第三方 SDK
- **数据库操作**：增删改查（尤其是写操作）
- **文件 IO**：文件读写、上传下载
- **数据转换**：JSON 解析、类型转换、日期格式化
- **业务校验**：参数校验失败、权限不足、资源不存在

```java
// 标准异常处理模板
try {
    // 业务逻辑
} catch (BusinessException e) {
    log.warn("[模块][操作] 业务异常, param={}, msg={}", param, e.getMessage());
    throw e;
} catch (Exception e) {
    log.error("[模块][操作] 系统异常, param={}", param, e);
    throw new ServiceException("操作失败，请稍后重试");
}
```

### 前端（TypeScript）
- **API 请求**：网络错误、超时、非 200 响应
- **数据解析**：可能为 null/undefined 的数据
- **用户操作**：表单提交、文件上传

```typescript
try {
  const result = await api.doSomething(params);
  // 成功处理
} catch (error) {
  console.error('[模块][操作] 失败', { params, error });
  message.error('操作失败，请稍后重试');
}
```

## 规则

- 不要吞掉异常（空 catch）
- 区分业务异常和系统异常，给用户友好的提示
- 不要在循环中 try-catch（除非有特殊需要）
- 资源获取后确保释放（try-with-resources / finally）