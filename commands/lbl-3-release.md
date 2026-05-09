# 发版流程

汇总 SQL，创建到主分支的合并请求。代码合并由用户自行完成。

> **注意**：主分支不一定是 `master`，可能是 `release` 或其他名称。必须通过 `remotes/origin/HEAD` 确认，不要假设。

## 参数

$ARGUMENTS — 发版.md 路径（如 `myfeature/发版/发版.md`），或需求编号列表（如 `2087 2101 2122`）

## Workflow

在动手之前，先列出完整操作清单，**等用户确认后再执行**。

```text
发版进度：
- [ ] Step 0: 确认项目仓库
- [ ] Step 1: 确认需求范围和 SQL 文件
- [ ] Step 2: 汇总 SQL 文件
- [ ] Step 3: 创建到主分支的合并请求
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

### Step 1: 确认需求范围和 SQL 文件

1. 如果用户提供了 `发版.md`，读取该文件获取需求列表。
2. 检查每个需求是否有 SQL 文件：
   - 搜索 `myfeature/<需求目录>/` 下的 `*.sql` 文件
3. **输出确认清单**，包括：
   - 每个需求的 SQL 文件（如有）
   - release 分支命名：`lbl-YYMMDD-release`（如 `lbl-260416-release`）
   - **每个项目的主分支名**（明确标出）
4. **等待用户确认后再继续**。

### Step 2: 汇总 SQL 文件

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

### Step 3: 创建到主分支的合并请求

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

- **先确认再动手**：Step 0 确认项目，Step 1 列出所有 SQL 后，必须等用户确认。
- **不假设项目**：不要写死仓库路径，用户说哪个就是哪个，不确定就问。
- **不假设主分支**：必须通过 `remotes/origin/HEAD` 确认主分支名，不要硬编码 `master`。
- **SQL 去重**：同一需求多个 SQL 文件内容相同的只保留一份。
- **已发版需求**：如果某个需求的分支已经合并到主分支（用户说"已经发了"），从列表中移除。
- **MR 文件位置**：写到公共 `myfeatrue/<需求目录>/` 下，不是各项目 git 仓库内。

## Output Format

每步完成后简要报告状态。全部完成后输出总结：

```markdown
## 发版完成

| 步骤 | 状态 |
|------|------|
| 项目 | <项目名> ✓ |
| SQL 汇总 | lbl-YYMMDD-release.sql ✓ |
| MR | <MR 地址> ✓ |
```
