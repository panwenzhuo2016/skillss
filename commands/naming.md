# 命名优化

优化代码中的变量名、方法名、类名等命名。

## 参数

$ARGUMENTS — 文件路径，或具体的命名（如「这个变量该叫什么」）

## 执行步骤

1. 如果指定文件，读取文件内容；否则读取 `git diff HEAD` 改动
2. 识别命名不佳的变量、方法、类
3. 给出优化建议
4. 用户确认后批量重命名

## 命名规范

### 通用原则
- 名字要表达**意图**，而非实现细节
- 避免缩写（除非是公认的：`id`、`url`、`http`）
- 避免单字母变量（循环索引 `i/j/k` 除外）
- 布尔值用 `is/has/can/should` 前缀
- 集合用复数：`users`、`orderList`

### Java 规范
- 类名：PascalCase（`UserService`）
- 方法/变量：camelCase（`getUserById`）
- 常量：UPPER_SNAKE（`MAX_RETRY_COUNT`）
- 包名：全小写（`com.example.user`）

### TypeScript 规范
- 组件：PascalCase（`UserProfile`）
- 函数/变量：camelCase（`fetchUserData`）
- 常量：UPPER_SNAKE 或 camelCase
- 类型/接口：PascalCase（`UserResponse`）
- 文件名：kebab-case 或 PascalCase（跟随项目约定）

### 常见命名模式
- 查询：`getXxx`、`findXxx`、`queryXxx`、`fetchXxx`
- 创建：`createXxx`、`addXxx`、`insertXxx`
- 更新：`updateXxx`、`modifyXxx`、`setXxx`
- 删除：`deleteXxx`、`removeXxx`
- 校验：`validateXxx`、`checkXxx`、`isXxx`
- 转换：`toXxx`、`convertXxx`、`parseXxx`

## 规则

- 重命名时使用 IDE 安全重构的思路，确保所有引用同步更新
- 不要仅为了个人偏好重命名，只改确实不好的命名