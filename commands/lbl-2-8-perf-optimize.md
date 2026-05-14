# 代码性能优化（不改业务逻辑）

扫描本次改动涉及的代码，找出性能热点（重复完整遍历、循环内昂贵操作、未利用批量 API、缓存缺失等），按 **"不改业务逻辑"** 原则进行优化。优化前后输出必须 100% 一致。

## 参数

$ARGUMENTS — 功能分支名 / 功能目录路径 / 具体文件路径

## 核心原则

- **不改业务逻辑**：优化前后接口返回值、副作用必须完全一致
- **不引入新依赖**：用项目现有工具/缓存/批量 API
- **优先收益大的**：万级循环节省 50% > 百级循环节省 90%
- **必须可验证**：能通过 git diff 看出"改的只是性能"，业务行为没动

## 检查清单

### 🔴 高收益（必查）

| 模式 | 症状 | 优化方式 |
|------|------|----------|
| **循环内多次完整遍历同一集合** | 一个 `histories` 在循环里被 `extractFieldChanges` 调 N 次，每次完整 traverse | 改单次遍历按 key 分桶（`extractFieldChangesBatch` 模式） |
| **昂贵操作在过滤前** | `getChangeHistories(issue)` / API 调用 / DB 查询放在 `continue` 前 | 重排：先做便宜过滤（字段读、内存比对），过滤通过再做昂贵操作 |
| **重复 lookup 同一对象** | 每次循环都 `getCustomFieldByName(...)` 查同一字段 | volatile 缓存首次结果，类级别共享 |
| **N+1 查询** | 循环内逐条 SQL/RPC | 循环外 `whereIn` / `batch` 一次查回，循环内查内存 Map |
| **能在 SQL/JQL 层过滤却拉回内存过滤** | `SELECT * → for { if (xxx) continue }` | 把过滤条件下推到 SQL/JQL，让数据库做 |
| **重复算同一个值** | 同一个 issue 的 versionCount 在 overview/list/detail 各算一次 | 算一次缓存到上下文 / 提到上层一次性算好 |

### 🟡 中收益（应查）

| 模式 | 症状 | 优化方式 |
|------|------|----------|
| **大集合全量排序取前 N** | 10000 条 sort → subList(0, 20) | 数据量超大时用 `PriorityQueue` 维护 top-N |
| **集合容器选错** | `ArrayList.contains` 在大集合里频繁查 | 改 `HashSet`（O(1)） |
| **String 拼接在循环里** | for 里 `s = s + ...` | `StringBuilder` |
| **不必要的对象创建** | 循环里 `new SimpleDateFormat()`、`new GregorianCalendar()` | 提到循环外，注意线程安全 |
| **冗余日志/序列化** | DEBUG 日志参数提前序列化（`log.info("..." + bigObj.toString())`） | 用占位符 `"... {}"`，让日志框架按需序列化 |

### 🟢 低收益（评估后再做）

- 多线程并行（Jira/Mybatis 等有内部锁的场景常常无效，且复杂度激增）
- JVM 级微优化（局部变量缓存、final 关键字）—— 现代 JIT 通常能搞定
- 缓存数据（一旦数据可变，缓存失效逻辑容易引入新 bug，必须慎重）

## 执行方法

### 1. 定位改动

```bash
git diff <merge-base>..<branch> --name-only
```

聚焦于：
- Service / Manager / Controller 层
- 数据访问层（Repository / Mapper / JqlBuilder / Helper）
- 工具类中的循环聚合方法

### 2. 找循环热点

对每个含循环的方法，逐项问自己：

1. **循环规模**：跑多少次？10 / 100 / 10000+？
2. **循环体最贵操作**：按成本排序
   - 远程 API 调用（最贵） > DB 查询 > 反射/字段读 > 字符串处理
3. **能否挪/省/批/缓**：
   - **挪**：能不能挪到循环外？
   - **省**：能不能用 cheap 过滤先 skip？
   - **批**：能不能 batch 一次做完？
   - **缓**：能不能 cache 第一次的结果？
4. **过滤位置**：过滤条件能不能下推到数据层？

### 3. 应用优化

每个优化点：
- 改之前**口头/注释里说清**前后语义一致（"X 操作不改输出，只省调用次数"）
- 改完编译通过
- **加 elapsed 日志**：关键路径前后加 `long t = System.currentTimeMillis()` + `log.info("... elapsed={}ms")`，方便后续实测验证

### 4. 输出报告

输出位置：`myfeature/<功能目录>/output/10-<需求编号>-性能优化.md`

格式：

```markdown
# 10-<需求编号>-性能优化

> 分支：`分支名`
> 日期：YYYY-MM-DD
> 原则：不改业务逻辑，优化前后输出一致

## 检查的热点方法

| 文件:方法 | 循环规模（估算） | 主要成本 |
|---|---|---|
| VersionTransferService#getIssueList | 10000 issue | getChangeHistories × N |
| VersionTransferService#collectEvents | 10000 issue × 6 字段提取 | extractFieldChanges 完整遍历 |

## 优化清单

| # | 位置 | 问题 | 优化方式 | 预期收益 |
|---|------|------|----------|----------|
| 1 | VersionTransferService.java:660 | 循环内 6 次完整遍历 histories 提取不同字段 | 单次遍历按字段名分桶（`extractFieldChangesBatch`） | 该段 ~6x 提速 |
| 2 | VersionTransferService.java:491 | `getChangeHistories` 在 crossVersion 过滤前 | 重排：先用 cheap 当前 Sprint 字段判定，过不了直接 continue | `crossVersionOnly=true` 时省 ~90% history 调用 |
| 3 | VersionTransferHelper.java:359 | 每个 issue 都 `getCustomFieldObjectsByName(FIELD_SPRINT)` | volatile 缓存 CustomField 引用 | N 次查找 → 1 次 |

## 验证

- ✅ 编译通过：`mvn package -DskipTests`
- ✅ git diff 仅涉及性能相关改动，无业务逻辑变化
- ✅ 关键路径已有 `elapsed={}ms` 日志，部署后可对比
- ✅ 已运行的测试用例通过率不变

## 未做（评估后放弃）

- 多线程并行 issue 处理：Jira `getChangeHistories` 内部有数据库锁，并行收益有限且复杂度高
- 跨请求缓存 issue 维度结果：issue 数据可变，失效逻辑难，且本次数据量级 cache 命中率低
```

## 注意事项

- **永远不要为了"代码更优雅"而改性能**——只看实测/估算收益
- **不为优化而引入并发**——除非 100% 确定无锁竞争且数据隔离
- **不为优化而改公共接口签名**——只在内部改实现，外部不感知
- **缓存必须配套失效策略**——简单 volatile 适合不变量；可变数据用 TTL/事件失效
- **性能日志保留**：`elapsed={}ms` 不要为了"日志整洁"删掉，部署后实测要靠它
- **能不优化就不优化**——如果当前性能用户没抱怨且监控没异常，优先稳定性
