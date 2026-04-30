# 规范化 Git 提交

根据当前改动生成规范的 Git commit。

## 执行步骤

1. 执行 `git status` 查看文件变更状态
2. 执行 `git diff HEAD` 查看具体改动内容
3. 执行 `git log --oneline -10` 查看最近提交风格
4. 分析改动内容，按 Conventional Commits 规范生成提交信息

## Commit 格式

```
<type>(<scope>): <简短描述>

<详细说明（可选）>
```

### Type 类型
- `feat` — 新功能
- `fix` — 修复 bug
- `refactor` — 重构（不改变功能）
- `perf` — 性能优化
- `style` — 代码格式调整
- `docs` — 文档变更
- `test` — 测试相关
- `chore` — 构建/工具/依赖变更
- `ci` — CI/CD 配置变更

### Scope
从改动文件的模块/目录推断，如 `auth`、`user`、`order` 等。

## 规则

- 描述使用中文，简洁明了，不超过 50 个字符
- 如果有多个不相关的改动，建议分多次提交
- 不要提交敏感文件（.env、credentials 等）
- 将生成的 commit message 展示给用户确认后再执行
- 使用 `git add` 只添加相关文件，不要用 `git add -A`