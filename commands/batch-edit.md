# 批量编辑

在多个文件中执行统一的修改。

## 参数

$ARGUMENTS — 修改描述（如「所有 Controller 的 @RequestMapping 改为 @GetMapping」「将 moment 替换为 dayjs」）

## 执行步骤

1. 理解修改需求
2. 搜索所有需要修改的文件和位置
3. 展示修改计划（文件列表和修改内容预览）
4. 用户确认后逐文件执行修改
5. 输出修改摘要

## 常见场景

- **重命名**：包名、类名、方法名的批量重命名
- **替换**：替换旧 API 为新 API、替换依赖
- **统一风格**：统一注解风格、统一错误处理模式
- **迁移**：框架升级后的 API 迁移
- **添加**：批量添加注解、批量添加日志
- **删除**：批量删除废弃代码、批量删除无用 import

## 输出

修改前展示：
```
📋 修改计划（共 X 个文件）

1. src/controller/UserController.java (3 处)
   - 行 15: @RequestMapping → @GetMapping
   - 行 28: @RequestMapping → @PostMapping
   - 行 45: @RequestMapping → @DeleteMapping

2. src/controller/SpaceController.java (2 处)
   ...
```

## 规则

- 先展示完整的修改计划，用户确认后再执行
- 每个文件的修改都要考虑上下文，不能简单的文本替换
- 如果某个文件的修改需要特殊处理，单独标注
- 修改后检查编译/语法是否正确