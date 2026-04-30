# 试卷详情页（只读）

## Context
管理员在试卷列表页点击试卷名称，需要跳转到一个只读的详情页，展示试卷基本信息和题目列表。当前没有这个页面。

## 影响范围
- **新增文件**: `exam-web/src/routes/_layout/admin/exams/$id.detail.tsx`
- **修改文件**:
  - `exam-web/src/routes/_layout/admin/exams/index.tsx` — 试卷名称加点击跳转链接
  - `exam-web/src/i18n/zh.json` — 新增翻译 key
  - `exam-web/src/i18n/en.json` — 新增翻译 key

## 实现方案

### 1. 新建详情页 `$id.detail.tsx`
- 路由: `/_layout/admin/exams/$id/detail`
- 复用已有 Hook:
  - `useAdminExamDetail(examId)` — 来自 `@/hooks/use-admin-exams`
  - `useQuestionList(examId)` — 来自 `@/hooks/use-admin-questions`
- 页面结构:
  - 顶部: 返回按钮 + 标题（试卷名称）
  - 试卷信息卡片: 状态、题目数量、限时、最大尝试次数、是否显示答案/解析、访问模式
  - 题目列表: 复用 `$id.questions.tsx` 的展开/折叠显示模式（去掉编辑/删除操作）

### 2. 列表页试卷名称加链接
- 在 `index.tsx` 中，将试卷名称单元格的文本改为可点击链接
- 点击跳转到 `/admin/exams/${exam.id}/detail`
- 样式: `cursor-pointer text-blue-600 hover:underline`

### 3. 翻译 key
- `admin.examDetail` — "试卷详情" / "Exam Detail"
- `admin.timeLimitMin` — "考试时长" / "Time Limit" (如不存在)
- `admin.maxAttempts` — "最大尝试次数" / "Max Attempts" (如不存在)
- `admin.showAnswer` — "显示答案" / "Show Answer" (如不存在)
- `admin.showAnalysis` — "显示解析" / "Show Analysis" (如不存在)
- `admin.accessMode` — "访问模式" / "Access Mode" (如不存在)
- `common.yes` / `common.no` — 是/否 (如不存在)

## 验证
- 列表页点击试卷名称能跳转到详情页
- 详情页显示试卷基本信息
- 详情页展示题目列表，点击可展开选项和解析
- 页面纯只读，无编辑/删除操作
