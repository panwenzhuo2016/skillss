# SQL 审查与优化

审查 SQL 语句的正确性和性能。

## 参数

$ARGUMENTS — SQL 语句、Mapper XML 文件路径、或问题描述

## 执行步骤

1. 获取要审查的 SQL（从参数、文件或 git diff 中提取）
2. 分析 SQL 的正确性和性能
3. 输出审查报告和优化建议

## 审查维度

### 正确性
- JOIN 条件是否完整
- WHERE 条件是否正确
- GROUP BY 与 SELECT 字段是否匹配
- NULL 值处理（IS NULL vs = NULL）
- 子查询是否有性能问题

### 性能
- 是否能命中索引（根据 WHERE、ORDER BY、GROUP BY 分析）
- 是否有全表扫描风险
- 是否有不必要的子查询（可用 JOIN 替代）
- 是否有 SELECT *（应指定具体字段）
- LIKE '%xxx' 导致索引失效
- OR 条件导致索引失效
- 隐式类型转换导致索引失效

### 安全
- 是否有 SQL 注入风险（拼接 vs 参数化）
- 是否有未授权的数据访问
- DELETE/UPDATE 是否有 WHERE 条件

### MyBatis 特定
- `${}` vs `#{}` 使用是否正确
- 动态 SQL（if/choose/foreach）是否正确
- resultMap 映射是否完整

## 输出

- 问题列表（严重程度 + 位置 + 说明）
- 优化后的 SQL
- 建议添加的索引