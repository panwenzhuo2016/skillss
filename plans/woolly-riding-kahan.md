# AI 日报对话增强 — 5 场景实现计划

## Context

当前 AI 日报对话系统（`AiChatPanel.vue` + `DailyReportAiController.php`）只支持：
- 按分组/花名 + 时间范围拉取**日报原文**给 AI 分析
- 意图识别只有 `analyze`（分析已有数据）和 `new_query`（查新数据）两种 intent

需要增强为 PRD 定义的 5 个场景：
1. **项目进度查询** — 通过 Room/Tunnel 索引定位项目参与人，取原文；索引未命中则降级全文检索摘要
2. **人员工作查询** — 现有流程 + AI 输出增加"按项目维度罗列"
3. **全局聚合分析** — 使用周摘要（非原文），≤20万字直接喂，>20万字按项目分批
4. **多轮对话** — 现有续查模式已支持，增强指代消解
5. **模糊意图** — 无法提取人名/项目名时，默认走全局聚合

**约束**：不改 oa-core。

---

## Phase 1：增强 extractSlots — 新增 query_type + project_names

### 改动文件
- `oa-server/app/Http/Controllers/Oa/DailyReportAiController.php` — `SLOT_EXTRACTION_PROMPT` + `extractSlots()`
- `oa-server/config/sfuser_apis/daily_report_ai.php` — extract-slots 路由增加 `available_projects` 参数
- `oa-frontend/src/apis/StaffPage/dailyReportAiApis.ts` — `ExtractSlotsResult` 增加字段 + 传参
- `oa-frontend/src/app/.../AiChatPanel.vue` — `sendExtractSlots()` 传 available_projects

### 具体改动

#### 1.1 SLOT_EXTRACTION_PROMPT 改造

在现有 prompt 基础上增加：
- **query_type** 字段：`project` | `person` | `global` | `unknown`
- **project_names** 字段：string[]，从用户输入中提取的项目名
- 判断规则：
  - 提到具体项目名 → `query_type: "project"`，提取 project_names
  - 提到具体人名/分组 → `query_type: "person"`
  - "分析日报数据"/"团队最近" → `query_type: "global"`
  - 无法判断 → `query_type: "unknown"`
- 项目名匹配：传入 `available_projects`（Room 表所有 project_name + aliases），AI 优先匹配已有项目
- **续查模式增强**：上次 query_type 为 project 时，"张三在这个项目上做了什么" → query_type=person + 继承 project_names

#### 1.2 后端 extractSlots() 方法

- 新增 `$availableProjects = $request->input('available_projects', [])` 参数
- 查询所有活跃 Room 的 project_name + aliases，格式化到 prompt 中
- **注意**：available_projects 由后端直接查 DB（不依赖前端传入），前端只传 `include_projects: true` 标志

实际方案：**后端自查**。extractSlots 中直接查 `DailyReportAiRoom` 表，格式化项目列表到 prompt，前端不用传项目列表。

#### 1.3 路由 & 前端

- `ExtractSlotsResult` 增加 `query_type` 和 `project_names` 字段
- `parseSlotJson` 解析新字段
- `sendExtractSlots` 中根据 `query_type` 分发到不同处理流程

---

## Phase 2：新增后端接口 — 项目成员查询 + 批量获取摘要

### 改动文件
- `oa-server/app/Http/Controllers/Oa/DailyReportAiController.php` — 新增 2 个方法
- `oa-server/config/sfuser_apis/daily_report_ai.php` — 新增 2 个路由
- `oa-server/app/Service/WeeklySummaryService.php` — 新增查询方法
- `oa-frontend/src/apis/StaffPage/dailyReportAiApis.ts` — 新增 API 函数

### 2.1 `resolveProjectMembers` 接口

```
URL: daily-report/ai/resolve-project-members
参数: project_names[]
返回: { projects: [{ project_name, room_id, sfuser_ids: int[], nicknames: string[] }] }
```

流程：
1. 在 Room 表中匹配 project_name（精确 + aliases JSON_CONTAINS）
2. 通过 Tunnel 获取关联的 sfuser_ids
3. 通过 sfuser 表查花名（`nickname`）
4. 返回每个项目对应的成员列表

复用 `WeeklySummaryService::findOrCreateRoom` 的匹配逻辑（但只查不创建）。在 `WeeklySummaryService` 中新增 `findRoomByName(string $name): ?int` 方法。

### 2.2 `batchGetSummaries` 接口

```
URL: daily-report/ai/batch-get-summaries
参数: sfuser_ids[], week_starts[]
返回: { summaries: [{ sfuser_id, week_start, content }], decrypt_config }
```

流程：
1. 批量查 `daily_report_weekly_summary` 表
2. 返回加密的 content + decrypt_config（让 core 解密）
3. 权限校验：当前用户必须在每条摘要的 reporter_ids/cc_ids 中，或是 owner

**关键**：这个接口走 core 的解密链路（前端传 `decrypt_config`），core 会自动解密 content 字段。

### 2.3 `searchSummaries` 接口（降级用）

```
URL: daily-report/ai/search-summaries
参数: keyword, week_starts[] (optional), sfuser_ids[] (optional)
返回: { summaries: [{ sfuser_id, week_start, content }], decrypt_config }
```

用于场景 1 降级：Room 索引未命中时，在周摘要中全文检索项目名。但由于 content 是加密的，**无法在 server 端做全文检索**。

**替代方案**：降级时取全员最近 N 周的摘要（解密后由 AI 做关键词匹配）。这样数据量可控（人数 × 周数 × ~500字）。

---

## Phase 3：前端路由分发 — sendExtractSlots 改造

### 改动文件
- `oa-frontend/src/app/.../AiChatPanel.vue` — `sendExtractSlots` 方法重构

### 分发逻辑

```
sendExtractSlots(text)
  → extractSlots() 返回 { query_type, project_names, members, period_start, period_end, ... }

  switch (query_type):
    case 'project':
      → handleProjectQuery(project_names, period_start, period_end, text)
    case 'person':
      → handlePersonQuery(members, member_type, period_start, period_end, text, project_names)
    case 'global':
      → handleGlobalQuery(period_start, period_end, text)
    case 'unknown':
      → 如果有 members/period → 走 person
      → 否则走 global（默认全员 + 最近一个月）
```

### 3.1 handleProjectQuery（场景 1）

```
1. 调 resolveProjectMembers(project_names) → 获取 sfuser_ids + nicknames
2. 如果命中（有 sfuser_ids）：
   a. 用 nicknames 调 fetchReportContext(nicknames, period_start, period_end)
   b. 把 context 设为 reportContext
   c. 调 sendAskMessage("关于项目{project_names}的进度分析")
3. 如果未命中（0 个 sfuser_ids）：
   a. 降级：调 handleGlobalQuery 但带上项目关键词
   b. AI 问答中附加提示："基于全文检索，非项目索引匹配"
```

### 3.2 handlePersonQuery（场景 2，增强）

现有流程基本不变（resolveMembers → fetchReportContext → sendAskMessage），但：
- 如果 `project_names` 不为空，在 AI 消息中附加 "请重点关注项目：{project_names}"
- AI 输出要求"按项目维度罗列"→ 通过 system prompt 或 message 前缀实现

### 3.3 handleGlobalQuery（场景 3）

```
1. 确定人员范围：所有 groupOptions 中的花名 → 需要 sfuser_ids
2. 确定时间范围：period_start ~ period_end → 计算涉及的 week_starts
3. 调 batchGetSummaries(sfuser_ids, week_starts) → 获取解密后的周摘要
4. 计算总字数
5. 如果 ≤ 20万字：
   a. 拼接所有摘要为 context
   b. 调 sendAskMessage(text)
6. 如果 > 20万字：
   a. 分批处理（按项目分组，通过 Tunnel）
   b. 每批调 blocking AI 生成小结
   c. 汇总小结后再调 streaming AI 生成最终分析
```

**问题**：全局查询需要 sfuser_ids，但 groupOptions 只有花名。
**方案**：新增 `resolveNicknames` 接口，批量花名 → sfuser_id 映射。

### 3.4 resolveNicknames 接口

```
URL: daily-report/ai/resolve-nicknames
参数: nicknames[]
返回: { mapping: { nickname: sfuser_id } }
```

后端查 sfuser 表（`nickname` 字段）。

---

## Phase 4：场景 4 & 5 — 多轮对话 + 模糊意图

### 多轮对话（场景 4）

现有续查模式已有基础：
- `previousContext` 传给 extractSlots
- extractSlots prompt 有续查模式规则

增强：
- `previousContext` 增加 `query_type` 和 `project_names` 字段
- prompt 续查规则增加："如果上次是项目查询，'他/她在这个项目做了什么' → query_type=person + 继承 project_names"

### 模糊意图（场景 5）

- extractSlots 返回 `query_type: "global"` 时，自动使用默认槽位（全员 + 最近一个月）
- 在 sendExtractSlots 的 unknown 分支处理

---

## Phase 5：nickname → sfuser_id 映射

### 背景

`siteSubordinates` 从后端 `getMySubordinates` 获取——该方法先拿 sfuser_id 数组（`getSubordinates`），然后用 `Sfuser::whereIn('id', $ids)->pluck('nickname', 'id')` 转成花名。前端拿到的是纯花名字符串，没有 sfuser_id。

### 方案

新增后端接口 `resolveNicknames`，前端把花名列表传给后端查 sfuser 表。

```
URL: daily-report/ai/resolve-nicknames
参数: nicknames[] (max:200)
返回: { mapping: [{ nickname: string, sfuser_id: int }] }
```

后端：`Sfuser::whereIn('nickname', $nicknames)->select('id', 'nickname')->get()`

该接口被 `handleProjectQuery`（项目查询需要取原文时用花名拉日报，不需要此接口）和 `handleGlobalQuery`（需要 sfuser_ids 查周摘要）使用。

实际上 `handleProjectQuery` 通过 `resolveProjectMembers` 返回的 nicknames 直接调 `fetchReportContext`（用花名拉日报），不需要此接口。`handleGlobalQuery` 需要。

---

## 实现顺序

1. **Phase 1**：改 extractSlots prompt + 新增 query_type/project_names 字段
2. **Phase 2**：新增后端接口 resolveProjectMembers + batchGetSummaries + resolveNicknames
3. **Phase 3**：前端路由分发 + 三种 handler 实现
4. **Phase 4**：续查模式增强

## 验证方式

1. 意图识别测试："警察电台进展如何" → query_type=project
2. 项目查询测试：确认 Room/Tunnel 索引命中 → 取原文 → AI 分析
3. 人员查询测试："张三最近一周做了什么" → 按项目维度输出
4. 全局查询测试："分析最近一个月日报" → 使用周摘要
5. 多轮对话测试：先问项目 → 再问"张三在这个项目做了什么"
6. 降级测试：查询不存在的项目名 → 降级走全文检索

## 关键文件清单

| 文件 | 改动类型 |
|---|---|
| `oa-server/app/Http/Controllers/Oa/DailyReportAiController.php` | 修改 prompt + 新增 3 方法 |
| `oa-server/config/sfuser_apis/daily_report_ai.php` | 新增 3 路由 |
| `oa-server/app/Service/WeeklySummaryService.php` | 新增 findRoomsByNames + 查摘要方法 |
| `oa-frontend/src/apis/StaffPage/dailyReportAiApis.ts` | 新增 3 API + 类型更新 |
| `oa-frontend/src/app/.../AiChatPanel.vue` | 路由分发 + 3 handler（最大改动） |
