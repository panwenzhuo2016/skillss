# 数据库变更 SQL 生成

需求做完后，根据 Entity 代码和 git diff，生成数据库变更 SQL 文件 + Liquibase 迁移文件。

## 参数

$ARGUMENTS — 功能分支名、Entity 路径、或功能名称

## 文档用途

- DBA 审核：标准化的 SQL 便于审核和执行
- 部署上线：Liquibase 自动迁移，不需要手动执行 SQL
- 回滚方案：每条变更都有对应的回滚 SQL
- 环境一致性：测试环境和生产环境通过同一份迁移文件保持一致

## 执行步骤

### 第一步：收集信息

1. **查 git diff**，找出本次新增/修改的 Entity 文件：
   ```
   git diff --stat <基准分支>...HEAD
   ```
   筛选 `entity/*.java` 文件
2. **读每个 Entity 文件**，提取：
   - 表名（`@TableName` 注解）
   - 所有字段（名称、类型、注解）
   - 是否继承 `BaseEntity`（自带 `id`, `is_deleted`, `created_by`, `updated_by`, `created_at`, `updated_at`）
   - `@TableLogic` 逻辑删除字段
   - `@TableField` 的 fill 策略
   - `@TableId` 主键策略
3. **查数据库**，确认表是否已存在：
   ```sql
   SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'xxx';
   ```
   - 已存在 → 生成 ALTER TABLE
   - 不存在 → 生成 CREATE TABLE
4. **对已存在的表，查现有字段和索引**：
   ```sql
   SHOW COLUMNS FROM xxx;
   SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_NAME = 'xxx';
   ```
   只生成差异部分（新增字段、新增索引、修改字段），不要重复已有的
5. **读 CLAUDE.md**，确认：
   - 数据库类型（MySQL / PostgreSQL）
   - 字符集和排序规则（`utf8mb4_unicode_ci` / `utf8mb4_general_ci`）
   - Liquibase changelog 路径和编号规则
   - BaseEntity 公共字段列表
6. **读现有 Liquibase master 文件**，确认下一个编号：
   ```
   db/changelog/db.changelog-master.xml
   ```

### 第二步：生成原始 SQL 文件

放在 `myfeature/功能目录/output/` 下，文件名格式：`04-<需求编号>-功能名-建表SQL.sql`（需求编号从功能目录名中匹配 `YYMMDD-NNNN-功能名` 格式取 `NNNN`，功能名用中文，如 `04-2424-模板排序-建表SQL.sql`）

#### SQL 文件模板

```sql
-- ============================================================
-- 功能名称 - 数据库变更 SQL
-- 执行环境：数据库名
-- 分支: branch-name
-- ============================================================

-- ==================== 新建表 ====================

-- 1. 表名 - 表注释
CREATE TABLE `table_name` (
    `id`          BIGINT          NOT NULL                    COMMENT '主键',
    -- 业务字段（按逻辑分组，组间空一行）
    `field_name`  VARCHAR(100)    NOT NULL                    COMMENT '字段说明',
    `status`      TINYINT         NOT NULL    DEFAULT 0       COMMENT '状态：0=xxx，1=yyy',
    `amount`      DECIMAL(10,2)   NOT NULL    DEFAULT 0.00    COMMENT '金额',
    `content`     TEXT            NULL                        COMMENT '内容',
    `config`      JSON            NULL                        COMMENT '配置JSON',
    -- 公共字段（BaseEntity）
    `is_deleted`  TINYINT UNSIGNED NOT NULL   DEFAULT 0       COMMENT '逻辑删除',
    `created_by`  BIGINT          NULL                        COMMENT '创建人',
    `updated_by`  BIGINT          NULL                        COMMENT '更新人',
    `created_at`  TIMESTAMP       NOT NULL    DEFAULT CURRENT_TIMESTAMP    COMMENT '创建时间',
    `updated_at`  TIMESTAMP       NULL        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    INDEX `idx_字段名` (`字段名`),
    UNIQUE INDEX `uk_字段组合` (`字段1`, `字段2`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='表中文注释';

-- ==================== 修改表 ====================

-- 2. 表名 新增字段
ALTER TABLE `table_name`
    ADD COLUMN `new_field` VARCHAR(50) NULL DEFAULT NULL COMMENT '字段说明' AFTER `existing_field`;

-- 新增索引
CREATE INDEX `idx_new_field` ON `table_name` (`new_field`);

-- ==================== 数据迁移（如有） ====================

-- 3. 历史数据刷新（幂等，可重复执行）
UPDATE `table_name` SET `new_field` = 'default_value' WHERE `new_field` IS NULL;

-- ==================== 回滚 SQL（注释保留，不执行） ====================
-- ROLLBACK:
-- DROP TABLE IF EXISTS `table_name`;
-- ALTER TABLE `table_name` DROP COLUMN `new_field`;
-- DROP INDEX `idx_new_field` ON `table_name`;

-- ==================== 清空表数据（测试环境用，保留表结构） ====================
-- TRUNCATE:
-- TRUNCATE TABLE `table_name`;
-- DELETE FROM `table_name` WHERE 条件;  -- 如需条件清理用 DELETE
```

### 第三步：生成 Liquibase 迁移文件

放在 `src/main/resources/db/changelog/` 下，编号递增。

#### Liquibase 文件模板

```xml
<?xml version="1.0" encoding="UTF-8"?>
<databaseChangeLog
        xmlns="http://www.liquibase.org/xml/ns/dbchangelog"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog
        http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-latest.xsd">

    <!-- 每个独立变更一个 changeSet，便于单独回滚 -->
    <changeSet id="编号-1" author="collabspace">
        <comment>变更说明</comment>
        <sql>
            -- SQL 语句（与原始 SQL 文件一致）
        </sql>
    </changeSet>

    <changeSet id="编号-2" author="collabspace">
        <comment>变更说明</comment>
        <sql>
            -- 另一组 SQL
        </sql>
    </changeSet>

</databaseChangeLog>
```

#### 更新 master 文件

在 `db.changelog-master.xml` 末尾追加 `<include>`：

```xml
<include file="classpath:db/changelog/NNN_xxx.xml" relativeToChangelogFile="false" />
```

### 第四步：检查清单

逐项检查，每项不通过则修复：

#### SQL 正确性
1. **字段类型匹配 Java 类型**：
   - `Long` → `BIGINT`
   - `Integer` / 枚举 code → `TINYINT` 或 `INT`
   - `String` → `VARCHAR(n)`（确认长度，别默认 255）
   - `Boolean` → `TINYINT(1)` 或 `BIT`
   - `LocalDateTime` → `DATETIME` 或 `TIMESTAMP`
   - `BigDecimal` → `DECIMAL(p,s)`
   - `List<>` / `Map<>` → `JSON` 或 `TEXT`
2. **NOT NULL / DEFAULT 与代码一致**：
   - Entity 有 `@TableField(fill = FieldFill.INSERT)` → 可以 NOT NULL（框架自动填）
   - 代码中 `if (xxx == null) xxx = default` → 对应字段应有 DEFAULT 值
   - 枚举字段必须有 DEFAULT（通常 DEFAULT 0）
3. **字段顺序**：`AFTER` 关键字指定位置，业务字段在前，公共字段在后
4. **字符集统一**：检查项目现有表用的是 `utf8mb4_unicode_ci` 还是 `utf8mb4_general_ci`，新表保持一致

#### 索引设计
5. **WHERE 条件字段有索引**：检查 Service 中 `LambdaQueryWrapper` 的 `.eq()` / `.in()` 条件字段
6. **组合索引字段顺序**：区分度高的在前，范围查询（`>` `<` `BETWEEN`）的在后
7. **唯一索引防重复**：业务上不允许重复的字段组合加 UNIQUE INDEX
8. **不要过度索引**：单表索引不超过 5-6 个，写多读少的表更要克制

#### 安全性
9. **大表（>100w 行）加字段不锁表**：确认 MySQL 版本是否支持 instant DDL，否则需要 pt-osc
10. **DELETE 必须有 WHERE**：数据迁移 SQL 禁止无条件 DELETE/UPDATE
11. **幂等性**：SQL 可以重复执行不报错（`IF NOT EXISTS`、`IF EXISTS`、`ON DUPLICATE KEY`）
12. **回滚 SQL 准备好**：每条变更都有对应的回滚语句（注释保留）

#### Liquibase 规范
13. **changeSet 粒度**：每个独立操作（建表、加字段、加索引）一个 changeSet，不要把所有 SQL 塞一个里面
14. **changeSet id 唯一**：格式 `编号-序号`，如 `006-1`, `006-2`
15. **master 文件已更新**：新文件已 include 到 `db.changelog-master.xml`

### 注意事项

- 原始 SQL 文件放 `myfeature/功能目录/output/` 目录，用于人工审核和手动执行
- Liquibase XML 放 `src/main/resources/db/changelog/`，用于自动迁移
- 两份文件的 SQL 内容必须**完全一致**，只是载体不同
- `BaseEntity` 公共字段（id, is_deleted, created_by, updated_by, created_at, updated_at）不要遗漏
- 新建表时先查项目中最近的 CREATE TABLE 语句，保持风格一致（列对齐、COMMENT 格式等）
- ALTER TABLE 的 ADD COLUMN 必须指定 `AFTER` 位置，不要追加到末尾的公共字段后面
- 索引命名规范：普通索引 `idx_` 前缀，唯一索引 `uk_` 前缀
- 枚举字段的 COMMENT 必须写全所有枚举值：`COMMENT '状态：0=待发布，1=已发布，2=已取消'`
- 如果涉及数据迁移（UPDATE 历史数据），单独一个 changeSet，便于出问题时回滚
- 生成完后，提醒用户是否需要在测试环境先执行验证
