# 创建 Hotfix 分支

从主分支拉取 hotfix 分支，用于紧急 bug 修复。

## 参数

$ARGUMENTS — bug 名称或简要描述

## 执行步骤

1. **确认主分支名**（不要假设是 `master`）：
   ```bash
   git branch -a | grep "remotes/origin/HEAD"
   ```
   如果没有输出，用 `git remote show origin | grep 'HEAD branch'` 确认。

2. **切换到主分支并更新**：
   ```bash
   git checkout <主分支> && git pull origin <主分支>
   ```

3. **生成分支名**：
   - 格式：`YYMMDD-hotfix-<bug英文简称>`
   - bug 英文简称从参数中提取，如果参数是中文，翻译为简短英文（2-3 个单词，用连字符连接）
   - 示例：`260428-hotfix-user-list-npe`、`260428-hotfix-login-timeout`

4. **创建并切换到 hotfix 分支**：
   ```bash
   git checkout -b <分支名>
   ```

5. **输出确认**：
   ```
   ✅ Hotfix 分支已创建
   - 基于: <主分支名> (最新)
   - 分支: <分支名>
   - 用途: <bug 描述>
   ```

## 规则

- **必须先更新主分支**，不要基于本地过期的主分支创建
- **不假设主分支名**，必须通过 `remotes/origin/HEAD` 确认
- 如果当前有未提交的改动，**先提醒用户处理**（stash 或 commit），不要直接切分支
