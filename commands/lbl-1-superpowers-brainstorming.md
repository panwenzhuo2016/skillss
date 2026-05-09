# 需求头脑风暴

使用 superpowers:brainstorming 这个 skill 执行头脑风暴流程。

## 参数

$ARGUMENTS — 功能名称、需求描述、或功能目录路径

## 输出文件规则（覆盖 brainstorming / writing-plans skill 的默认路径）

以下规则 **优先级高于** brainstorming skill 和 writing-plans skill 的默认文件命名。必须严格遵守：

- **输出目录**：`myfeature/功能目录/output/`
  - **不要**放在 `docs/superpowers/specs/` 或 `docs/superpowers/plans/`
  - 功能目录 = `$ARGUMENTS` 指向的目录，或根据需求名称自动匹配 `myfeature/` 下已有的目录
- **文件名**：以 `01-<需求编号>-` 前缀开头（对应本 skill 编号 lbl-01）
  - 设计文档：`01-<需求编号>-design.html`
  - 实现计划：`01-<需求编号>-plan.html`
  - **需求编号提取规则**：从功能目录名中匹配 `YYMMDD-NNNN-功能名` 格式，取 `NNNN` 部分。例如目录名 `260429-2424-订阅文档更新通知` → 需求编号为 `2424`，文件名为 `01-2424-design.md`
- **不要**使用 `YYYY-MM-DD-<topic>-design.md` 等 superpowers 默认格式
- **输出格式**：增强 HTML（纯 HTML+CSS，不依赖外部库），使用侧边栏导航、可折叠区块、表格样式、代码高亮等
- 后续收尾流程（`/lbl-07-z-02-all-before-release`）会生成 `02-` ~ `08-` 编号的文档，与本步骤的 `01-` 文件衔接

## 禁止 git 操作（覆盖 brainstorming / writing-plans 子 skill 的默认行为）

以下规则 **优先级高于** brainstorming skill 的 "Commit the design document to git" 和 writing-plans skill 的 "Commit" step。必须严格遵守：

- **禁止执行任何 git 操作**（包括 `git add`、`git commit`、`git push`）
- brainstorming checklist 第 6 步 "Write design doc — save and **commit**" → 只 save，**不 commit**
- writing-plans 模板中的 "Step N: Commit" → **跳过**，不要在 plan 中生成 commit 步骤
- 用户审核提示改为："Spec written to `<path>`. Please review it."（去掉 "committed" 措辞）
- 文件写到磁盘即可，由用户自行决定何时提交
