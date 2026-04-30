# 数据库迁移

生成数据库迁移脚本。

## 参数

$ARGUMENTS — 迁移需求描述（如「用户表增加手机号字段」）

## 执行步骤

1. 读取项目的数据库迁移工具配置（Liquibase / Flyway / 原生 SQL）
2. 查看已有的迁移文件，了解命名规范和格式
3. 查看相关的实体类和表结构
4. 生成迁移脚本
5. 同步更新实体类（如果需要）

## Liquibase 格式（本项目默认）

```yaml
databaseChangeLog:
  - changeSet:
      id: YYYYMMDD-序号-描述
      author: 作者
      changes:
        - addColumn:
            tableName: 表名
            columns:
              - column:
                  name: 字段名
                  type: 类型
                  remarks: 备注
```

## 规则

- 迁移脚本必须**可回滚**（提供 rollback）
- 字段命名使用 snake_case
- 必须添加 `remarks`（字段注释）
- 大表操作要注意锁表风险，必要时分步执行
- 不要在迁移脚本中写业务数据变更（用单独的 data migration）
- 新增字段默认允许 NULL，或提供 defaultValue
- 索引命名规范：`idx_表名_字段名`
- 唯一索引命名：`uk_表名_字段名`

## 输出

- 迁移脚本文件
- 更新后的实体类（如果需要）
- Mapper XML 更新（如果需要）