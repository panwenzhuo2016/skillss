# Extended Thinking（思考链）：模型内部思考的 10 步

> 对应服务端推理流程第 5 步的深度拆解

## 1. 触发 Thinking 模式
Prefill 完成后，模型检查是否启用 thinking：
- 请求参数 `thinking: { type: "enabled", budget_tokens: N }`
- 模型生成一个特殊的 `<thinking>` 开始标记
- 进入 thinking 模式：后续生成的 token 属于"内部思考"，不直接展示给用户
- thinking 的 token **也走标准的 Decode 流程**（逐 token 自回归）

## 2. 问题分解（模型自发行为）
模型在 thinking 中的第一步通常是理解和分解问题：
- "用户问的是什么？"
- "这个任务需要哪几步？"
- "有什么约束条件？"
- 这不是硬编码的逻辑，是模型通过训练学会的行为模式
- [推断] RLHF / Constitutional AI 训练中强化了"先想后说"的模式

```
<thinking>
用户要我修改 UserService 中的登录逻辑。
让我先理解当前代码结构...
需要考虑：1) 密码校验 2) token 生成 3) 并发安全
</thinking>
```

## 3. 知识检索（Attention 机制的本质）
模型在 thinking 中"回忆"相关知识：
- 并不是真的去搜索数据库，而是通过 Attention 在 KV Cache 中检索
- thinking 的每个 token 都 attend 到所有历史 token（system prompt、用户代码、对话历史）
- Attention Weight 高的位置 = 模型正在"关注"的上下文
- 参数中存储的知识（FFN 层）也在此时被激活

## 4. 方案探索 & 对比
模型尝试多种可能的方案：
```
<thinking>
方案 A: 直接在 Service 层加校验
  - 优点：改动小
  - 缺点：可能遗漏其他入口

方案 B: 在拦截器层统一处理
  - 优点：全局生效
  - 缺点：粒度太粗

选择方案 A，因为用户只要求改这一个接口
</thinking>
```
- 这个过程消耗 thinking tokens
- 模型"思考"越久，探索越充分，但也越慢越贵

## 5. 自我纠错（Critical Thinking）
模型在 thinking 中检查自己的推理：
```
<thinking>
等等，我刚才说用 synchronized，但这是 Spring Bean 默认单例...
不对，应该用分布式锁，因为可能有多个实例...
让我重新考虑...
</thinking>
```
- 这是 thinking 相比直接输出的核心优势：有机会纠正错误
- 没有 thinking 时，错误直接输出给用户
- [推断] 训练过程中，模型被奖励"在 thinking 中纠错"的行为

## 6. Budget 消耗监控
thinking 的 token 数受 `budget_tokens` 限制：
- 每生成一个 thinking token，预算减 1
- 预算用完 → 强制结束 thinking，切换到正式输出
- Claude Code 中 budget 可能动态调整：
  - 简单问题（"改个变量名"）→ 分配少量 budget
  - 复杂问题（"重构整个模块"）→ 分配大量 budget
- [推断] 模型也会自己判断"想够了"，提前结束 thinking

```
budget_tokens: 10000
已消耗:        3500
剩余:          6500
→ 模型自行决定：够了，可以开始输出了
→ 或继续思考直到 budget 耗尽
```

## 7. 结论锁定
thinking 的最后阶段，模型确定最终方案：
```
<thinking>
最终决定：
1. 在 UserService.login() 方法中加入参数校验
2. 使用 @Valid 注解 + 自定义校验器
3. 需要修改 LoginDTO 加上 @NotBlank
4. 需要修改 GlobalExceptionHandler 处理校验异常
</thinking>
```
- 这个"结论"直接影响后续正式输出的质量
- 思考越清晰，正式输出越准确、越有条理

## 8. 生成 Thinking 结束标记
模型生成特殊 token 标记 thinking 结束：
- `</thinking>` 或内部的特殊结束 token
- 推理引擎检测到这个标记 → 切换状态
- thinking 的 KV Cache 保留在显存中（正式输出的 Attention 可以"看到"思考过程）
- thinking tokens 计入 output_tokens 费用

## 9. Thinking 内容处理
thinking 生成完毕后的处理：
- **Streaming 模式下**：thinking 内容通过 `thinking` 类型的 content_block 推送
  ```
  content_block_start: { type: "thinking" }
  content_block_delta: { type: "thinking_delta", thinking: "用户要我..." }
  content_block_stop
  ```
- Claude Code CLI 收到 thinking 后：[推断] 可能不展示或简略展示
- thinking 的 token 在后续对话中可能被截断/压缩（节省 context）

## 10. 切换到正式输出
thinking 结束，模型开始生成用户可见的正式回复：
- 模型的 Attention 可以同时看到：
  - 所有 input（system + messages）
  - 整个 thinking 过程
  - → 基于充分思考产出高质量输出
- 开始生成 `text` 或 `tool_use` 类型的 content block
- 从这里开始就是标准 Decode 流程

```
[Input tokens] → [Thinking tokens] → [Output tokens]
                  ↑ 模型可以看到     ↑ 用户看到的
                  ↑ 全部思考过程     ↑ 最终回复

Attention 视角：Output token 可以 attend 到 Input + Thinking 的所有 KV
```

## 流程图

```
Prefill 完成
  ↓
[1] 检查 thinking 是否启用 → 生成 <thinking> 标记
  ↓
[2] 问题分解（理解任务、拆分步骤）
  ↓
[3] 知识检索（通过 Attention 在上下文中查找相关信息）
  ↓
[4] 方案探索（列举多种可能，对比优劣）
  ↓
[5] 自我纠错（发现错误 → 修正推理）
  ↓
[6] Budget 监控（还剩多少 thinking tokens？）
  ├─ 用完 → 强制结束
  └─ 还有 → 继续或自行决定结束
  ↓
[7] 结论锁定（确定最终方案和输出计划）
  ↓
[8] 生成 </thinking> 结束标记
  ↓
[9] Thinking 内容推送（streaming event）
  ↓
[10] 切换到正式输出（text / tool_use）→ 标准 Decode
```

## Thinking 的价值 & 代价

| 维度 | 有 Thinking | 无 Thinking |
|------|------------|-------------|
| 输出质量 | 更高（经过推理和纠错） | 较低（直觉式输出） |
| 复杂推理 | 能处理多步逻辑 | 容易出错 |
| 速度 | 更慢（额外生成 thinking tokens） | 更快 |
| 费用 | 更贵（thinking tokens 计费） | 更便宜 |
| TTFT | 更长（thinking 完才出正式内容） | 更短 |

**本质**：用更多 token（时间和钱）换更高的输出质量。对于简单任务是浪费，对于复杂任务是必要的。
