# 场景 3：全局聚合分析 — 分批处理 + 未提交人员

## Context

当前 `handleGlobalQueryWithKeywords` 把所有周摘要一股脑塞进一次 LLM 调用。PRD 场景 3 要求：
1. **数据量估算**：可见人数 × 周数 × 500字 → 判断走直接路径还是分批路径
2. **≤ 20 万字**：直接路径 — 全员周摘要 + SQL 查未提交人员 → 一次 LLM
3. **> 20 万字**：分批路径 — 按项目分组（Tunnel）→ 每个项目 LLM 小结 → 汇总 + 未提交人员 → 最终 LLM
4. **未提交人员**：SQL 补充未提交日报的人员名单（摘要只覆盖提交了的人）

## 改动范围

### 1. 后端新增接口：查询未提交日报人员

**文件**: `oa-server/app/Http/Controllers/Oa/DailyReportAiController.php`

新增 `getUnreportedUsers` 方法：
- 入参：`period_start`, `period_end`
- 逻辑：取当前用户可见下属 sfuser_ids → 查 `daily_reports` 表中该时间段内有提交记录的 sfuser_ids → 差集 = 未提交人员
- 通过 Sfuser 查花名返回 `[{sfuser_id, nickname}]`

**文件**: `oa-server/config/sfuser_apis/daily_report_ai.php`
- 注册路由 `daily-report/ai/unreported-users`

### 2. 后端新增接口：按项目分组获取摘要

**文件**: `oa-server/app/Http/Controllers/Oa/DailyReportAiController.php`

新增 `getSummariesGroupedByProject` 方法：
- 入参：`week_starts`
- 逻辑：
  1. 取当前用户可见下属 sfuser_ids
  2. 查 Tunnel 表获取 sfuser_id → room_id 映射（限定 week_start in week_starts）
  3. 查 Room 表获取 room_id → project_name
  4. 按 project 分组查周摘要
  5. 未关联任何 Room 的人员归入 "其他" 组
- 返回：`{ projects: [{ project_name, summaries: [...] }] }`

**文件**: `oa-server/config/sfuser_apis/daily_report_ai.php`
- 注册路由 `daily-report/ai/summaries-by-project`

### 3. 前端新增 API 函数

**文件**: `oa-frontend/src/apis/StaffPage/dailyReportAiApis.ts`

```typescript
// 查询未提交日报人员
async function getUnreportedUsers(periodStart: string, periodEnd: string): Promise<{sfuser_id: number, nickname: string}[]>

// 按项目分组获取周摘要
async function getSummariesByProject(weekStarts: string[]): Promise<{project_name: string, summaries: SummaryItem[]}[]>
```

### 4. 前端改造 handleGlobalQueryWithKeywords

**文件**: `oa-frontend/src/app/PC/StaffPage/OaDailyReport/OthersReports/AiChatPanel.vue`

改造 `handleGlobalQueryWithKeywords` 方法：

```
估算数据量 = visibleMemberCount × weekStarts.length × 500

if (估算 ≤ 200000) {
    // 直接路径（现有逻辑 + 补充未提交人员）
    const [summaries, unreported] = await Promise.all([
        batchGetSummaries(weekStarts),
        getUnreportedUsers(period_start, period_end)
    ])
    拼接 context = summaries + 未提交人员名单
    一次 sendAskMessage
} else {
    // 分批路径
    const [projectGroups, unreported] = await Promise.all([
        getSummariesByProject(weekStarts),
        getUnreportedUsers(period_start, period_end)
    ])

    // 逐项目 LLM 生成小结（串行，每个项目单独调 AI）
    const projectSummaryResults = []
    for (const group of projectGroups) {
        context = group.summaries 拼接
        小结 = await sendAskMessageBlocking(context, "请对该项目的周摘要进行概括小结")
        projectSummaryResults.push({ project_name, summary: 小结 })
    }

    // 最终汇总
    finalContext = projectSummaryResults 拼接 + 未提交人员名单
    await sendAskMessage(finalContext, "请基于以上各项目小结进行全局聚合分析")
}
```

### 5. 前端新增 sendAskMessageBlocking（非流式/blocking 调用）

分批路径需要逐项目 LLM 生成小结 → 需要一个 **blocking** 模式的 AI 调用（不流式展示，等返回结果）。

**方案选择**：复用现有 `askAi` SSE 接口，前端消费完整个流后拼接结果返回，不推送到 messages 数组。

新增 `private async askAiBlocking(context: string, prompt: string, sceneType?: string): Promise<string>` 方法：
- 调用 `dailyReportAiApis.askAi`，读完流后返回完整文本
- 不写入 `this.messages`，不触发 UI 更新
- 用于分批路径的中间 LLM 小结

### 6. 可见人数获取

`groupOptions` prop 包含所有分组，每组 `value` 是花名数组。可见人数 = `groupOptions.flatMap(g => g.value)` 去重后的 count。

## 关键文件

| 文件 | 改动类型 |
|------|---------|
| `oa-server/app/Http/Controllers/Oa/DailyReportAiController.php` | 新增 2 个方法 |
| `oa-server/config/sfuser_apis/daily_report_ai.php` | 新增 2 条路由 |
| `oa-frontend/src/apis/StaffPage/dailyReportAiApis.ts` | 新增 2 个 API 函数 |
| `oa-frontend/src/app/PC/StaffPage/OaDailyReport/OthersReports/AiChatPanel.vue` | 改造 handleGlobalQueryWithKeywords + 新增 askAiBlocking |

## 复用的现有实现

- `DailyReportService::getSubordinates($sfuserId)` — 获取可见下属 sfuser_ids
- `DailyReportService::inAiWhitelist($sfuserId)` — 权限检查
- `DailyReportAiTunnel` model — 查 room_id ↔ sfuser_id
- `DailyReportAiRoom` model — 查 project_name
- `DailyReport::STATUS_COMMITTED` = 1 — 已提交状态
- `dailyReportAiApis.askAi()` — 复用 SSE 接口做 blocking 调用
- `compressDailyContext()` / `compressContext()` — 上下文压缩

## 验证方案

1. **直接路径**：选一个成员数少的用户（如 < 50 人），查询最近一个月 → 应走直接路径，回答中应包含"未提交日报人员"信息
2. **分批路径**：选一个成员数多的用户或查询 3 个月以上 → 应走分批路径，UI 显示"正在按项目分组分析... (1/N)"进度
3. **未提交人员**：对比 SQL 查询结果和 AI 回答中提到的未提交人员是否一致
4. **降级场景**：项目查询降级到全文检索时，仍然走全局查询逻辑（keywords 非空）
