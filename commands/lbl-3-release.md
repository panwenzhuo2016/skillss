# 发版流程

从主分支拉 release 分支，合并 feature 分支，合并 SQL，合并到 testserver 部署测试，创建到主分支的合并请求。

> **注意**：主分支不一定是 `master`，可能是 `release` 或其他名称。必须通过 `remotes/origin/HEAD` 确认，不要假设。

## 参数

$ARGUMENTS — 发版.md 路径（如 `myfeature/发版/发版.md`），或需求编号列表（如 `2087 2101 2122`）

## Workflow

在动手之前，先列出完整操作清单，**等用户确认后再执行**。

```text
发版进度：
- [ ] Step 0: 确认项目仓库
- [ ] Step 1: 确认需求范围和分支
- [ ] Step 2: 创建 release 分支并合并 feature 分支
- [ ] Step 3: 汇总 SQL 文件
- [ ] Step 4: 合并到 testserver 并推送
- [ ] Step 5: 创建到主分支的合并请求
```

### Step 0: 确认项目仓库

1. **不要假设项目**，根据当前工作目录判断：
   - 如果当前目录在某个 git 仓库内，确认是否就是要发版的仓库
   - 如果不确定，**问用户**："哪个项目？"
2. **确认主分支名**（不要假设是 `master`）：
   ```bash
   git branch -a | grep "remotes/origin/HEAD"
   ```
   - 如果输出 `remotes/origin/HEAD -> origin/master`，主分支是 `master`
   - 如果输出 `remotes/origin/HEAD -> origin/release`，主分支是 `release`
   - 如果没有输出，用 `git remote show origin | grep 'HEAD branch'` 确认
3. 确认后记录：
   - 仓库路径（如 `D:/project/pt-gitlab/collabspace/collabspace-server`）
   - 远程地址
   - 主分支名（可能是 `master`、`release` 等，**必须确认**）
   - 测试分支名（通常 `testserver`）

### Step 1: 确认需求范围和分支

1. 如果用户提供了 `发版.md`，读取该文件获取需求列表。
2. 在仓库中查找对应的 feature 分支：
   ```bash
   git branch -a | grep -i "<需求关键词>"
   ```
3. 检查每个 feature 分支中是否有 SQL 文件：
   - 搜索 `myfeature/<需求目录>/` 下的 `*.sql` 文件
4. **输出确认清单**，包括：
   - 每个需求对应的分支名
   - 每个需求的 SQL 文件（如有）
   - release 分支命名：`lbl-YYMMDD-release`（如 `lbl-260416-release`）
   - **每个项目的主分支名**（明确标出）
5. **等待用户确认后再继续**。

### Step 2: 创建 release 分支并合并 feature 分支

1. 切换到主分支并更新（用 Step 0 确认的主分支名，不要硬编码 `master`）：
   ```bash
   git checkout <主分支> && git pull origin <主分支>
   ```
2. 从主分支创建 release 分支：
   ```bash
   git checkout -b lbl-YYMMDD-release
   ```
3. 依次合并每个 feature 分支：
   ```bash
   git merge origin/feature/xxx --no-edit
   ```
   - 如有冲突，分析冲突内容并解决
   - 每次合并后提交，commit message 格式：`merge: feature/xxx into lbl-YYMMDD-release`
4. 推送 release 分支到远程：
   ```bash
   git push origin lbl-YYMMDD-release
   ```

### Step 3: 汇总 SQL 文件

1. 从 Step 1 确认的 SQL 文件中，按需求顺序合并内容。
2. 生成文件：`myfeature/发版/lbl-YYMMDD-release.sql`
3. 文件格式：
   ```sql
   -- ============================================================
   -- lbl-YYMMDD-release 发版 SQL
   -- 包含需求：XXXX, XXXX, XXXX
   -- ============================================================

   -- ============================================================
   -- XXXX-需求名称
   -- ============================================================
   <SQL 内容>
   ```
4. 如果同一需求有多个 SQL 文件且内容重复，只保留一份。
5. 如果没有 SQL 文件，跳过此步。

### Step 4: 合并到 testserver 并推送

1. 切换到测试分支并更新：
   ```bash
   git checkout testserver && git pull origin testserver
   ```
2. 合并 release 分支：
   ```bash
   git merge lbl-YYMMDD-release --no-edit
   ```
3. 如有冲突，解决后提交。
4. 推送：
   ```bash
   git push origin testserver
   ```
5. CI 会自动部署到测试环境。

### Step 5: 创建到主分支的合并请求

通过 git push options 创建 MR（target 用 Step 0 确认的主分支名）：
```bash
git push origin lbl-YYMMDD-release \
  -o merge_request.create \
  -o merge_request.target=<主分支> \
  -o "merge_request.title=lbl-YYMMDD-release: 需求编号列表"
```

如果分支已是最新（push 返回 "Everything up-to-date"），则先创建一个空提交再推送：
```bash
git checkout lbl-YYMMDD-release
git commit --allow-empty -m "chore: trigger MR creation"
git push origin lbl-YYMMDD-release -o merge_request.create -o merge_request.target=<主分支> -o "merge_request.title=lbl-YYMMDD-release: 需求编号列表"
```

最后输出 MR 地址给用户，并将 MR 地址写入工作目录下的 `myfeatrue/<需求目录>/lbl-YYMMDD-mr.md`（markdown 格式，方便在 IDE 中点击）。

> **注意**：MR 文件不是写到各 git 仓库内的 `myfeature/` 目录，而是写到工作目录上层的公共 `myfeatrue/<需求目录>/` 下（如 `D:/project/info-gitlab/oa/myfeatrue/0416-AI日报配置/lbl-260416-mr.md`）。如果不确定需求目录名，**问用户**。

## Quality Rules

- **先确认再动手**：Step 0 确认项目，Step 1 列出所有分支和 SQL 后，必须等用户确认。
- **不假设项目**：不要写死仓库路径，用户说哪个就是哪个，不确定就问。
- **不假设主分支**：必须通过 `remotes/origin/HEAD` 确认主分支名，不要硬编码 `master`。
- **冲突处理**：合并冲突时，分析双方改动意图，优先保留两边功能，不要丢代码。
- **SQL 去重**：同一需求多个 SQL 文件内容相同的只保留一份。
- **已发版需求**：如果某个需求的分支已经合并到主分支（用户说"已经发了"），从列表中移除。
- **.gitignore**：注意不要把本地脚本（如 `merge-to-testserver.bat`）提交到仓库。
- **MR 文件位置**：写到公共 `myfeatrue/<需求目录>/` 下，不是各项目 git 仓库内。

## Output Format

每步完成后简要报告状态。全部完成后输出总结：

```markdown
## 发版完成

| 步骤 | 状态 |
|------|------|
| 项目 | <项目名> ✓ |
| release 分支 | lbl-YYMMDD-release ✓ |
| 合并 feature | X 个分支已合并 ✓ |
| SQL 汇总 | lbl-YYMMDD-release.sql ✓ |
| testserver | 已推送，CI 部署中 ✓ |
| MR | <MR 地址> ✓ |
```
