# 重构：移除 oa-core ai/chat 接口，复用 TransferRequestService AI 能力

## Context
oa-core 作为中转层，前端请求都先到 oa-core，没有配 route 的接口自动 `TransferRequestService::transfer()` 转发到 oa-server。TransferRequestService **已经支持** `ai_analysis_config` 参数（blocking 和 streaming 两种模式），可以：
- 先拿 oa-server 返回的数据
- 解密后做 AI 分析（blocking 塞到响应 / streaming SSE 输出）

但目前 AI 日报功能额外加了一个 `master-api/ai/chat` 接口，oa-server 通过 `AiStreamService` 反向调 oa-core。这违反了 oa-core 作为中转层的架构：应该是参数控制，不是加新接口。

## 当前 3 个调用点

| 调用点 | 模式 | 当前流程 | 后处理 |
|--------|------|----------|--------|
| `ask()` | streaming | oa-server → ai/chat SSE | 存 AI 回复到 DB |
| `extractSlots()` | blocking | oa-server → ai/chat JSON | 解析 slot JSON |
| `taskTest()` | streaming | oa-server → ai/chat SSE (带解密+压缩) | 无 |

## 重构方案

### 核心思路
oa-server 各端点不再调 ai/chat，而是返回准备好的数据。前端请求带 `ai_analysis_config` + `response_format`，由 oa-core 的 TransferRequestService 完成 AI 调用。

### 1. ask — 流式 AI 对话

**oa-server `DailyReportAiController::ask()`** 改为：
- 保存 user message 到 DB（不变）
- 构建 query 字符串（`[日报数据]\n{context}\n---\n{message}`）
- 返回 JSON：`{ query, session_id }`
- **不再调 AiStreamService**，不再自己 `response()->stream()`

**前端 `askAi()`** 改为：
- 请求参数加 `response_format: 'stream'` + `ai_analysis_config: { system_prompt, target_field: 'query' }`
- `system_prompt` 前端已有（从 role 数据获取）
- history 放入 `ai_analysis_config.history`
- 接收 TransferRequestService 的 SSE 格式

**前端对话完成后**：
- 用现有 `saveMessages` API 存 assistant 回复到 DB

**文件**：
- `oa-server/app/Http/Controllers/Oa/DailyReportAiController.php` — ask() 简化
- `oa-frontend/src/apis/StaffPage/dailyReportAiApis.ts` — askAi() 加参数
- `oa-frontend` 对话组件 — 处理新 SSE 格式，完成后调 saveMessages

### 2. extractSlots — blocking 意图识别

**oa-server `DailyReportAiController::extractSlots()`** 改为：
- 构建 system_prompt（不变）
- 返回 JSON：`{ prepared_message: $message, ai_analysis_config: { system_prompt, target_field: 'prepared_message', output_field: 'ai_result' } }`
- **不再调 CoreApiLib ai/chat**，不再解析 slot JSON

**oa-core TransferRequestService** 扩展（blocking 模式）：
- 增加从 oa-server 响应中读取 `ai_analysis_config` 的支持（跟 `decrypt_config` 合并逻辑一样）
- 当响应 data 包含 `ai_analysis_config` 时，合并请求参数的 `ai_analysis_config`，执行 AI 分析

**前端 `extractSlots()`**：
- 从响应的 `data.ai_result` 拿到 AI 原始文本
- `parseSlotJson()` 解析逻辑从 oa-server 移到前端

**文件**：
- `oa-server/app/Http/Controllers/Oa/DailyReportAiController.php` — extractSlots() 简化
- `oa-core/app/Services/TransferRequestService.php` — 支持响应中的 ai_analysis_config
- `oa-frontend/src/apis/StaffPage/dailyReportAiApis.ts` — extractSlots() 加解析逻辑

### 3. taskTest — 流式 Prompt 预览

**oa-server `DailyReportAiEmailController::taskTest()`** 改为：
- 拉取日报数据、分组、拼内容（不变，加密标记不变）
- 返回 JSON：`{ content: $encryptedContent, summary: "按部门 · 近3天 · 5份日报", decrypt_config: { ... } }`
- **不再调 AiStreamService**，不再自己 `response()->stream()`

**前端 `testEmailTask()`**：
- 请求参数加 `response_format: 'stream'` + `ai_analysis_config: { system_prompt, target_field: 'content', compress: true }`
- `decrypt_config` 加入请求（从 oa-server 返回的 config，或前端自行构建）
- TransferRequestService 处理：解密 → 压缩 → AI streaming

**PromptTestDialog.vue** SSE 格式调整：
- TransferRequestService 用 `is_finished: true` 表示结束，不用 `type: 'done'`
- `meta` 信息从 oa-server 的 JSON 响应里的 `summary` 字段获取

**问题**：decrypt_config 需要 token。当前 token 存在 oa-server 的 MailConfig 表里。taskTest 返回数据时需要把 decrypt_config 包含在响应中（跟 TransferRequestService 现有的 decrypt_config 合并逻辑匹配）。

**文件**：
- `oa-server/app/Http/Controllers/Oa/DailyReportAiEmailController.php` — taskTest() 简化
- `oa-frontend/src/app/PC/StaffPage/OaDailyReport/OthersReports/PromptTestDialog.vue` — SSE 格式
- `oa-frontend/src/apis/StaffPage/dailyReportAiApis.ts` — testEmailTask() 加参数

### 4. TransferRequestService 扩展

**`oa-core/app/Services/TransferRequestService.php`**：
- blocking AI 模式（line 186-200）：增加从 `$respData['ai_analysis_config']` 合并的支持
- streaming AI 模式（line 98-151）：增加压缩支持（`compress: true` 时 strip_tags + 合并空白）
  - 当前 streaming AI 模式没做压缩，需要加上（跟 AiController::chat 的压缩逻辑一致）

### 5. 删除

- `oa-core/app/Http/Controllers/AiController.php` — 整个删除
- `oa-core/config/my_master_api.php` — 删除 `ai/chat` 路由配置
- `oa-server/app/Service/AiStreamService.php` — 整个删除（不再需要反向调 oa-core）
- `oa-server/config/my_master_api.php` — 删除 `ai/chat` 客户端声明

### 6. parseSlotJson 迁移到前端

从 `DailyReportAiController::parseSlotJson()` 提取逻辑，在前端实现：
- 去除 markdown 代码块包裹（````json ... ```）
- JSON.parse
- 填充默认值

## 执行顺序

1. TransferRequestService 扩展（响应 ai_analysis_config 合并 + streaming 压缩）
2. oa-server 3 个端点改为返回数据
3. 前端 3 个调用点适配新格式
4. 删除 AiController、AiStreamService、路由配置
5. 测试全流程

## 验证

- extractSlots：前端对话输入"看下扶苏今天的日报"，确认意图识别正常
- ask：AI 对话流式输出正常，完成后消息存库
- taskTest：测试 Prompt 效果弹窗流式显示，AI 失败时显示错误提示
- 确认 `master-api/ai/chat` 404（已删除）
