# 创建 Pull Request

自动创建规范的 Pull Request。

## 执行步骤

1. 执行 `git status` 检查是否有未提交的改动
2. 如果有未提交改动，先执行 `/commit` 流程
3. 执行 `git log main..HEAD` 或 `git log master..HEAD` 查看本分支所有提交
4. 执行 `git diff main...HEAD` 或 `git diff master...HEAD` 查看完整改动
5. 生成 PR 标题和描述
6. 推送分支并创建 PR

## PR 格式

### 标题
- 简短明了，不超过 70 个字符
- 格式：`<type>(<scope>): <描述>`

### 描述模板
```markdown
## 概要
- 改动要点 1
- 改动要点 2

## 改动详情
详细说明修改了什么、为什么这样改。

## 测试计划
- [ ] 测试项 1
- [ ] 测试项 2

## 影响范围
说明本次改动可能影响的功能模块。
```

## 规则

- 创建 PR 前确认目标分支（默认为 main 或 master）
- PR 描述要让审查者快速理解改动目的和范围
- 如果改动较大，在描述中说明关键设计决策