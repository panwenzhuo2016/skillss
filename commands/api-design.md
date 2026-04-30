# API 接口设计

设计 RESTful API 接口。

## 参数

$ARGUMENTS — 功能需求描述

## 执行步骤

1. 分析功能需求
2. 查看项目现有 API 风格和规范
3. 设计接口方案
4. 用户确认后生成代码骨架

## 设计规范

### URL 设计
- 使用名词复数：`/api/v1/users`
- 层级关系：`/api/v1/spaces/{spaceId}/nodes`
- 操作用 HTTP 方法表达：GET/POST/PUT/DELETE
- 查询参数用 camelCase

### 请求设计
- POST/PUT 请求体使用 JSON
- 分页参数统一：`page`、`pageSize`
- 排序参数：`sort=field,asc/desc`
- 筛选参数放 query string

### 响应设计
```json
{
  "code": 200,
  "message": "success",
  "data": {}
}
```

### 错误响应
```json
{
  "code": 400,
  "message": "参数错误",
  "details": [{"field": "name", "message": "不能为空"}]
}
```

## 输出

- 接口文档（路径、方法、参数、响应）
- Controller 代码骨架
- RO（请求对象）和 VO（响应对象）定义
- 必要的参数校验注解