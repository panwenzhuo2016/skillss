# Claude Code 工作流：从提问到回答的 10 步

> 基于 cli.js (v2.1.78, 12MB 打包文件) 逆向分析

## 1. 输入捕获 & Hooks 触发
你在终端敲完回车，CLI 捕获输入文本。如果配置了 `PreUserPrompt` hook 会先执行。

## 2. 组装 System Prompt
CLI 动态拼装 system prompt，包括：
- 内置的基础指令（工具使用规则、安全规范等）
- 读取 `CLAUDE.md`（全局 + 项目级）、`AGENTS.md`
- 读取 `settings.json` 的权限配置
- 读取 `.mcp.json`，连接 MCP Server，拿到可用工具列表
- 注入当前日期、平台信息、模型信息
- 注入已安装插件提供的 skill 列表

## 3. 构建 Messages 数组
把对话历史 + 新消息组装成 `messages` 数组。如果历史太长（接近 context window），触发**压缩/截断**，把老消息摘要化。

## 4. 调用 Anthropic API（Streaming）
发起 `messages.create` 请求，走配置的 API 代理，开启 streaming。依次接收：
- `message_start` → 开始
- `content_block` → 文本块 or 工具调用块
- `input_json_delta` → 工具参数增量流式传入
- `message_delta` → stop_reason 等元信息
- `message_stop` → 结束

## 5. 流式渲染文本
收到文本类型的 `content_block`，实时渲染到终端（打字机效果）。

## 6. 解析工具调用 & 权限检查
收到 `tool_use` 类型的 content_block 时：
- 解析工具名和参数（如 `Edit`、`Bash`、`Read`）
- 触发 **PreToolUse hook**（如 git commit/push 拦截）
- 检查 `settings.json` 的 `permissions.allow / deny` 列表
- 如果不在 allow 列表 → 弹出权限确认让用户选择

## 7. 执行工具
权限通过后，执行对应工具：
- `Read` → 读文件内容
- `Edit` → 字符串替换修改文件
- `Write` → 写入新文件
- `Bash` → 起子进程执行命令
- `mcp__*` → 通过 MCP 协议调外部服务
- `Agent` → 起子 agent（新的 mainLoop）

## 8. 收集工具结果 & 注入 System Reminder
工具执行完，把 `tool_result` 塞回 messages。同时可能注入 `<system-reminder>` 标签（如 TodoWrite 提醒、skill 列表、当前日期等）。

## 9. 回到 mainLoop 循环
带着工具结果再次调用 API（回到第 4 步）。模型决定：
- **继续调工具** → 重复 6-7-8-9
- **输出最终文本** → 进入第 10 步

这就是 **agentic loop**（mainLoop）—— 一个问题可能循环多轮，直到模型认为任务完成。

## 10. 结束 & 收尾
最后一轮 API 返回纯文本（stop_reason = `end_turn`），渲染到终端。触发 `PostToolUse` hook（如果有），记录历史，等待下一个输入。

## 流程图

```
你输入 → Hook → 拼 System Prompt → 压缩历史 → API Streaming
                                                    ↓
                     ←←←←←← 文本 → 直接渲染 ←←←←←←←
                     ↓
                  工具调用 → 权限检查 → 执行 → 结果回填
                     ↓                           ↓
                     ←←←←←← 再次调 API ←←←←←←←←←←
                     ↓
                  纯文本输出 → 渲染 → 结束，等待下一轮
```

## 代码证据（关键词频率统计）

| 关键词 | 出现次数 | 说明 |
|--------|----------|------|
| permission | 839 | 权限系统相关 |
| MCP | 485 | MCP 协议集成 |
| tool_result | 252 | 工具结果处理 |
| truncat | 239 | 上下文截断 |
| compress | 211 | 上下文压缩 |
| max_tokens | 148 | token 限制 |
| tool_use | 144 | 工具调用 |
| systemPrompt | 128 | System Prompt 构建 |
| streaming | 128 | 流式传输 |
| mainLoop | 123 | 主循环 |
| CLAUDE.md | 92 | 配置文件读取 |
| content_block | 77 | 内容块处理 |
| messages.create | 74 | API 调用 |
| checkPermission | 48 | 权限检查 |
| canUseTool | 42 | 工具可用性判断 |
| system-reminder | 28 | 系统提醒注入 |
| PreToolUse | 23 | 工具调用前 Hook |
| PostToolUse | 28 | 工具调用后 Hook |
