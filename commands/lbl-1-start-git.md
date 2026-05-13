# 创建需求分支（前后端同步）

从主分支拉取需求开发分支，前后端两个仓库同步操作。分支名取自 `myfeatrue` 子目录名。

## 参数

$ARGUMENTS — `myfeatrue` 子目录路径，例如：

```
D:\project\info-gitlab\oa\myfeatrue\260512-分组名单不能确定顺序吗
```

## 执行步骤

### Step 0：解析参数

1. **校验路径包含 `myfeatrue`**：
   - 不包含 → 报错中止：「参数不是 myfeatrue 子目录路径」
2. **提取分支名**：路径最后一段（含中文 OK），如 `260512-分组名单不能确定顺序吗`
   - 提取后为空 → 报错中止：「分支名为空」
3. **推断项目组与项目根**：
   - 路径中 `info-gitlab/<group>/myfeatrue/...` 的 `<group>` 就是项目组
   - 项目根 = `D:\project\info-gitlab\<group>`

### Step 1：根据项目组确定仓库列表

| 项目组 | 仓库目录（相对项目根） |
|--------|----------------------|
| `oa` | `oa-frontend`、`oa-server` |
| `hr` | `hr-frontend`、`hr-server` |
| `official` | `official-chn-frontend`、`official-chn-server` |

识别不出来 → **报错中止**：「未知项目组 <group>，仅支持 oa / hr / official」。

### Step 2：每个仓库依次执行（任一失败立刻中止，不动剩下的）

对每个目标仓库的绝对路径 `<repo_path>` 顺序执行：

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
   有匹配 → **报错中止**：「<repo> 分支 <分支名> 已存在，请先删除或换名」

4. **切到主分支并拉最新**：
   ```bash
   git -C "<repo_path>" checkout <主分支>
   git -C "<repo_path>" pull origin <主分支>
   ```
   pull 失败（冲突 / 网络问题）→ **报错中止**

5. **创建并切到新分支**：
   ```bash
   git -C "<repo_path>" checkout -b <分支名>
   ```

### Step 3：输出确认

```
✅ 需求分支已创建（未推送，需要自己 push）
- 分支名: <分支名>
- 项目组: <group>
- 仓库:
  - <repo1>: 基于 <主分支1>（最新）
  - <repo2>: 基于 <主分支2>（最新）
```

## 规则

- **绝对不推送**远程（不执行 `git push`），由用户自己 push
- **任一步骤失败立刻中止**：已处理的仓库不回滚，让用户自己看着处理
- **不假设主分支名**：每个仓库都用 `git remote show origin` 取真实的 HEAD branch
- **不自作主张** stash / 丢弃 / checkout 已有分支
- **顺序处理**：先处理 frontend 再处理 server（保持稳定的执行顺序便于排错）
- **路径用引号**包裹（分支名/路径含中文，避免 shell 解析问题）

## 反例（不要这么做）

- ❌ 跑 `git stash` 把用户改动藏起来再切分支
- ❌ 见到分支已存在就 `git checkout` 切过去
- ❌ 主分支固定写死成 `master` / `staging`
- ❌ 一个仓库失败了还继续处理下一个
- ❌ 末尾加 `git push -u origin <分支名>`