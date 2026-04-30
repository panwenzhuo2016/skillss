# 生成变更日志

根据 Git 提交记录生成结构化的变更日志。

## 参数

$ARGUMENTS — 版本号或日期范围（可选，默认为上次 tag 到 HEAD）

## 执行步骤

1. 获取最近的 tag：`git describe --tags --abbrev=0 2>/dev/null`
2. 获取提交记录：`git log <last-tag>..HEAD --pretty=format:"%h %s" --no-merges`
3. 如果没有 tag，获取最近 50 条提交
4. 按类型分类整理
5. 生成格式化的 CHANGELOG

## 输出格式

```markdown
## [版本号] - 日期

### 新功能
- 功能描述 (commit hash)

### 修复
- 修复描述 (commit hash)

### 优化
- 优化描述 (commit hash)

### 重构
- 重构描述 (commit hash)

### 其他
- 其他变更 (commit hash)
```

## 规则

- 从 commit message 中提取有意义的描述，不是简单复制
- 合并相关的提交（如同一功能的多次提交合为一条）
- 过滤掉无意义的提交（如 "fix typo"、"wip" 等）
- 生成后展示给用户确认，再决定是否写入文件