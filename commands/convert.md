# 代码转换

在不同语言、框架或风格之间转换代码。

## 参数

$ARGUMENTS — 转换描述（如「JS 转 TS」「class 组件转函数组件」「MyBatis XML 转注解」）

## 执行步骤

1. 理解转换需求
2. 读取源代码
3. 执行转换
4. 确保转换后的代码可以正常工作

## 常见转换场景

### 前端
- JavaScript → TypeScript（添加类型注解）
- Class 组件 → 函数组件 + Hooks
- CSS → TailwindCSS
- Options API → Composition API（Vue）
- CommonJS → ES Modules（require → import）
- Promise .then → async/await
- var → const/let

### 后端
- MyBatis XML → MyBatis 注解（或反向）
- 普通 JDBC → MyBatis-Plus
- 同步代码 → 异步代码
- Java 8 匿名类 → Lambda 表达式
- for 循环 → Stream API

### 通用
- JSON → YAML（或反向）
- REST API → GraphQL Schema
- SQL → ORM 代码
- 正则表达式 → 可读的描述（或反向）

## 规则

- 转换后保持原有业务逻辑不变
- 遵循目标语言/框架的最佳实践
- 保留有意义的注释
- 如果转换可能丢失功能，提前告知