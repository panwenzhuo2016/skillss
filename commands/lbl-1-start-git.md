# 创建需求分支（前后端可选）

从主分支拉取需求开发分支。支持单任务（路径）和多任务（jira 列表）两种入参形态，按项目组适配仓库、命名风格、前后端范围。

## 参数 ($ARGUMENTS)

支持两种形态，自行识别：

### 形态 A — 单任务，传 myfeatrue 子目录路径（兼容老流程）

```
D:\project\info-gitlab\oa\myfeatrue\260512-分组名单不能确定顺序吗
```

- 仅适用 `oa` / `hr` / `official` 项目组（路径在 `info-gitlab/<group>/myfeatrue/...`）
- **默认前后端都建**（与老行为一致），用户额外说明可改

### 形态 B — 多任务，传项目组 + jira 任务清单（含截图/列表）

例：
```
项目: collabspace
任务:
  - PXTL-2517 空间站小组添加公开邀请链接的功能
  - PXTL-2519 文档分享时支持一并分享历史版本
  - PXTL-2518 批量添加成员接口优化
范围: backend  # backend / frontend / both，可省略由用户选
```

或自由文本/图片均可，Claude 自行抽取这三项关键信息：项目组、jira 任务清单（编号 + 中文标题）、前后端范围。

## 项目组配置表

| 项目组 | 项目根 | 后端仓库 | 前端仓库 | 命名风格 |
|--------|--------|----------|----------|----------|
| `oa` | `D:\project\info-gitlab\oa` | `oa-server` | `oa-frontend` | 风格 A |
| `hr` | `D:\project\info-gitlab\hr` | `hr-server` | `hr-frontend` | 风格 A |
| `official` | `D:\project\info-gitlab\official` | `official-chn-server` | `official-chn-frontend` | 风格 A |
| `collabspace` | `D:\project\pt-gitlab\collabspace` | `collabspace-server` | `collabspace-web` | 风格 B |

识别不出项目组 → **报错中止**：「未知项目组 <group>，仅支持 oa / hr / official / collabspace」。

## 命名风格

### 风格 A（oa / hr / official）— 用 myfeatrue 子目录名当分支名
- **分支名** = 入参路径最后一段（如 `260512-分组名单不能确定顺序吗`，含中文 OK）
- **不主动建 myfeatrue 子目录**（入参就是子目录路径，已存在）

### 风格 B（collabspace）— 英文分支 + 中文目录
- **分支名**：`feature/<YYMMDD>-<jira数字编号>-<英文短描述>`
  - 日期：今天的日期，6 位（如 260515）
  - jira 数字编号：去掉前缀只留数字（PXTL-2517 → 2517）
  - 英文短描述：从中文标题机翻成 kebab-case，**必须先列出建议名让用户确认**，不准擅自起名
  - 示例：`feature/260515-2517-space-team-public-invite-link`
- **myfeature 子目录**：`<YYMMDD>-<完整jira编号>-<中文短描述>`
  - 在 `<项目根>/myfeature/` 下创建（注意：collabspace 实际目录是 `myfeature`，不是 `myfeatrue`）
  - 示例：`260515-PXTL-2517-空间站小组公开邀请链接`

## 执行步骤

### Step 0：解析入参 + 形态识别

1. 入参含 `myfeatrue` 路径片段 → **形态 A**
2. 入参含项目组 + jira 列表 → **形态 B**
3. 都识别不出 → **报错中止**：「无法识别入参，需 myfeatrue 路径或 jira 任务清单」

按形态提取：
- **形态 A**：路径最后一段 = 分支名；从 `info-gitlab/<group>/...` 提取项目组；项目根 = `D:\project\info-gitlab\<group>`
- **形态 B**：明确取出 `项目组`、`任务列表（jira+标题）`、`范围（backend/frontend/both）`

### Step 1：确定仓库列表（按项目组 + 范围过滤）

- 形态 A：默认 `范围=both`（除非用户额外说明）
- 形态 B：若用户没指定 `范围`，**必须问用户**（用 AskUserQuestion 给 backend/frontend/both 三选一），不准擅自决定

按表查项目组 → 按 `范围` 过滤仓库列表（顺序：先 frontend 后 server，便于排错；只建一端就只那一个）。

### Step 2：命名（区分风格）

#### 风格 A
- 分支名直接来自入参路径最后一段，无需用户确认。

#### 风格 B
- 对每个 jira 任务，按规则草拟：
  - 分支名候选：`feature/<YYMMDD>-<数字编号>-<英文短描述>`
  - myfeature 子目录候选：`<YYMMDD>-<完整jira编号>-<中文短描述>`
- **一次性把所有任务的候选名列表给用户确认**（用表格展示，用 AskUserQuestion 让用户确认或要求修改）
- 用户改名后用最终名继续。

### Step 3：每个仓库依次执行（任一失败立刻中止，不动剩下的）

对每个目标仓库的绝对路径 `<repo_path>` 顺序执行（多任务时，每个任务都要走一遍这套）：

1. **检查未提交改动**：
   ```bash
   git -C "<repo_path>" status --porcelain
   ```
   - **忽略**未追踪文件（`??` 开头）中文件名以 `merge-to-` 开头的（如 `merge-to-staging.bat`），属于本地脚本
   - 过滤掉忽略项后仍有输出 → **报错中止**：「<repo> 有未提交改动，请先处理后再跑」
   - 不要自作主张 stash 或丢弃

2. **识别该仓库主分支名**（不同仓库可能不同）：
   ```bash
   git -C "<repo_path>" remote show origin | grep 'HEAD branch' | awk '{print $NF}'
   ```
   拿不到 → **报错中止**：「<repo> 无法识别远程默认分支」

3. **检查目标分支是否已存在**（本地或远程任意一个存在都算）：
   ```bash
   git -C "<repo_path>" branch -a | grep -E "(^|/)<分支名>$"
   ```
   - 有匹配，且该本地分支是「无提交、无远程跟踪、跟主分支同 commit」的占位空分支 → **询问用户**是否删除重建（不要自作主张），用户同意才 `git branch -D` 后继续
   - 其他匹配情况 → **报错中止**：「<repo> 分支 <分支名> 已存在，请先删除或换名」

4. **切到主分支并拉最新**（多任务时只需做一次，建第一个分支前 pull 一次即可）：
   ```bash
   git -C "<repo_path>" checkout <主分支>
   git -C "<repo_path>" pull origin <主分支>
   ```
   pull 失败（冲突 / 网络问题）→ **报错中止**

5. **创建新分支**（多任务时，每建一个就切回主分支再建下一个）：
   ```bash
   git -C "<repo_path>" checkout -b <分支名>
   git -C "<repo_path>" checkout <主分支>   # 多任务才需要切回，单任务停在新分支
   ```

### Step 4（仅风格 B）：建 myfeature 子目录 + 占位 tt.txt

```bash
mkdir -p "<项目根>/myfeature/<中文子目录>"
touch "<项目根>/myfeature/<中文子目录>/tt.txt"
```

每个任务一个子目录，子目录下必须放一个空文件 `tt.txt`（用于让 git/编辑器把空目录纳入视野，避免目录"消失"）。全部建完。

### Step 5：输出确认

```
✅ 需求分支已创建（未推送，需要自己 push）
- 项目组: <group>
- 范围: <backend/frontend/both>
- 仓库 + 分支:
  - <repo1> 基于 <主分支1>（最新）
    - <分支1>
    - <分支2>
    - ...
- myfeature 子目录（仅风格 B）:
  - <子目录1>
  - <子目录2>
- 当前停留在: <分支名 / 主分支>
```

## 规则

- **绝对不推送**远程（不执行 `git push`），由用户自己 push
- **任一步骤失败立刻中止**：已处理的仓库/分支不回滚，让用户自己看着处理
- **不假设主分支名**：每个仓库都用 `git remote show origin` 取真实的 HEAD branch
- **不自作主张** stash / 丢弃 / checkout 已有分支 / 起英文短描述
- **风格 B 起英文短描述必须用户确认**（一次性列表确认所有任务，避免反复打断）
- **顺序处理**：先处理 frontend 再处理 server（多端时）；多任务时按入参顺序逐个建
- **路径用引号**包裹（分支名/路径含中文，避免 shell 解析问题）
- **collabspace 实际目录是 `myfeature`**，oa/hr/official 实际目录是 `myfeatrue`，别搞混
- **形态 B 范围参数缺失必须问**，不准默认 both 也不准默认 backend

## 反例（不要这么做）

- ❌ 跑 `git stash` 把用户改动藏起来再切分支
- ❌ 见到分支已存在就 `git checkout` 切过去（占位空分支也要先问用户）
- ❌ 主分支固定写死成 `master` / `staging`
- ❌ 一个仓库失败了还继续处理下一个
- ❌ 末尾加 `git push -u origin <分支名>`
- ❌ 风格 B 自己拍脑袋起英文短描述不让用户确认
- ❌ 形态 B 范围没说清就默认前后端都建
- ❌ 把 collabspace 的 `myfeature` 误写成 `myfeatrue`
