# Constrained Decoding（结构化输出控制）：强制合法 JSON 的 10 步

> 对应服务端推理流程第 8 步的深度拆解

## 1. 判断输出类型
模型在生成过程中决定是输出文本还是工具调用：
- 生成 `text` 类型 → 自由生成，不受结构约束
- 生成 `tool_use` 类型 → 进入 Constrained Decoding 模式
- 这个决定本身是模型自己做的（基于 system prompt 和上下文）
- `tool_choice: "any"` → 强制模型必须调工具
- `tool_choice: { type: "tool", name: "Edit" }` → 强制调指定工具

## 2. 加载 Tool Schema
确定调哪个工具后，加载该工具的 JSON Schema：
```json
// Edit 工具的 Schema
{
  "type": "object",
  "required": ["file_path", "old_string", "new_string"],
  "properties": {
    "file_path": { "type": "string" },
    "old_string": { "type": "string" },
    "new_string": { "type": "string" },
    "replace_all": { "type": "boolean", "default": false }
  }
}
```
这个 Schema 就是约束规则的来源。

## 3. 构建状态机（Grammar）
把 JSON Schema 转成一个**有限状态机（FSM）**：
- 每个状态表示 JSON 生成到了哪个位置
- 每个转移表示哪些 token 是合法的下一步

```
状态转移图（简化）：
  START → '{' → '"' → key_name → '"' → ':' → value → ...

  S0: 期望 '{'
  S1: 期望 '"' (key 开始)
  S2: 期望 key 内容 ("file_path" / "old_string" / ...)
  S3: 期望 '"' (key 结束)
  S4: 期望 ':'
  S5: 期望 value（string/number/boolean/null/object/array）
  S6: 期望 ',' 或 '}' (下一个 key 或结束)
```

## 4. 生成开头 Token
模型开始生成工具调用的 JSON：
- 第一个 token 必须是 `{`
- [推断] 实际实现中，模型生成 `tool_use` 标记后，框架可能直接注入 `{` 和工具名
- 或者模型自己生成，但通过 mask 确保只能生成 `{`

```
生成序列开始：
{ "name": "Edit", "input": {
← 这部分可能是框架注入的，也可能是模型生成但被约束的
```

## 5. 逐 Token 约束（Token Masking）
每生成一个 token，根据当前状态机位置，**屏蔽不合法的 token**：

```
当前已生成: {"file_path": "/src/
当前状态: 在 string value 内部

合法 token: 任何非 unescaped 引号的字符（路径字符、字母、数字等）
非法 token: 未转义的 } 或 ] 等

操作: 在 logits 上把非法 token 设为 -inf
→ softmax 后这些 token 概率为 0
→ 模型只能从合法 token 中选择
```

具体实现：
```python
# 伪代码
allowed_tokens = grammar.get_allowed_tokens(current_state)
for token_id in range(vocab_size):
    if token_id not in allowed_tokens:
        logits[token_id] = -inf
```

## 6. 处理 Key 名称约束
JSON 的 key 不是随便写的，必须是 Schema 定义的字段名：
```
Schema required keys: ["file_path", "old_string", "new_string"]

当前位置: 期望一个 key name
合法选项: "file_path", "old_string", "new_string", "replace_all"
非法选项: 任何其他字符串

→ 把能组成这些 key 名的 token 保留，其他屏蔽
```

难点：token 粒度和 key 名称粒度不一致
- "file_path" 可能被分成 ["file", "_", "path"] 三个 token
- 在生成 "file" 后，必须允许 "_" 和 "path" 但屏蔽其他
- 需要维护**前缀树（Trie）**来高效判断

## 7. 处理 Value 类型约束
根据 Schema 中声明的类型约束 value：

| Schema 类型 | 约束规则 |
|------------|---------|
| `"type": "string"` | 必须以 `"` 开始和结束，内部处理转义 |
| `"type": "number"` | 只允许数字字符、`.`、`-`、`e` |
| `"type": "boolean"` | 只允许 `true` 或 `false` |
| `"type": "null"` | 只允许 `null` |
| `"type": "array"` | 必须以 `[` 开始，元素间有 `,` |
| `"enum": [...]` | 只允许枚举值中的字符串 |

```
Schema: "replace_all": { "type": "boolean" }
当前位置: "replace_all": 后面

合法 token: "true" 或 "false" 的起始 token
→ 只有 "t" 和 "f" 被允许
```

## 8. 必填字段追踪
确保所有 `required` 字段都被生成：
```
required: ["file_path", "old_string", "new_string"]

已生成的 key: ["file_path", "old_string"]
还缺: ["new_string"]

当前位置: 刚生成完 old_string 的 value

→ 不允许生成 '}'（因为还有必填字段没写）
→ 必须生成 ',' 然后继续写 "new_string"
```

只有所有 required 字段都出现后，才允许生成 `}`。

## 9. 嵌套结构处理
工具参数可能有嵌套对象或数组：
```json
// 比如一个复杂的工具参数
{
  "changes": [
    { "file": "a.js", "line": 10 },
    { "file": "b.js", "line": 20 }
  ]
}
```

状态机需要：
- 维护嵌套深度栈（进 `{` 或 `[` 压栈，出 `}` 或 `]` 弹栈）
- 每层有自己的 Schema 约束
- 数组元素的类型一致性检查
- 正确处理 `,` 的位置（最后一个元素后不加逗号）

## 10. 完成 & 校验
JSON 生成完毕（最外层 `}` 闭合）：
- 状态机到达终态 → JSON 语法合法
- 做一次完整的 Schema 校验（双重保险）：
  - required 字段是否齐全
  - 类型是否匹配
  - 格式是否正确
- 校验通过 → 打包成 `tool_use` content block
- 校验失败 → [推断] 可能重试或返回错误

```
最终输出：
{
  "type": "tool_use",
  "id": "toolu_abc123",
  "name": "Edit",
  "input": {
    "file_path": "/src/UserService.java",
    "old_string": "public void login()",
    "new_string": "public Result login(@Valid LoginDTO dto)",
    "replace_all": false
  }
}
```

## 流程图

```
模型决定调用工具
  ↓
[1] 判断输出类型 → tool_use → 进入约束模式
  ↓
[2] 加载目标工具的 JSON Schema
  ↓
[3] Schema → 有限状态机（FSM / Grammar）
  ↓
[4] 生成开头 { + 工具名
  ↓
[5] ┌─→ 生成下一个 token
    │    ↓
    │   状态机判断合法 token → mask logits → 采样
    │    ↓
    │   [6] Key 名称约束（前缀树匹配）
    │   [7] Value 类型约束（string/number/boolean）
    │   [8] 必填字段追踪（required 是否都有了）
    │   [9] 嵌套结构处理（栈深度管理）
    │    ↓
    └── 还没生成完 → 回到 [5]
  ↓
[10] 最外层 } 闭合 → Schema 校验 → 输出 tool_use block
```

## 为什么 Constrained Decoding 很难

| 挑战 | 说明 |
|------|------|
| Token 粒度不匹配 | "file_path" 可能被分成多个 token，中间状态需要精确追踪 |
| 性能开销 | 每个 token 都要跑一遍状态机 + mask 整个词表 |
| 质量下降 | 过度约束可能让模型"被迫"选次优 token，内容质量下降 |
| Schema 复杂度 | 递归/anyOf/oneOf 等复杂 Schema 让状态机爆炸 |
| 字符串内容自由度 | string value 内部几乎无约束（代码片段、自然语言），不能太严 |
