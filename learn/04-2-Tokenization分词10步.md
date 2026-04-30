# Tokenization 分词：从文本到 Token ID 的 10 步

> 对应服务端推理流程第 2 步的深度拆解

## 1. 文本规范化（Normalization）
原始文本预处理：
- Unicode 标准化（NFC/NFKC），把等价字符统一
- 处理特殊字符：零宽空格、BOM 标记、控制字符
- 保留换行符、空格等空白字符（对代码生成很重要）
- 不做大小写转换（LLM 需要区分）

```
输入: "Hello,  世界！\n代码：print('hi')"
规范化后: "Hello,  世界！\n代码：print('hi')"  (基本不变，主要处理异常字符)
```

## 2. 预分词（Pre-tokenization）
在 BPE 之前先做粗分割：
- 按空格、标点、数字、中文字符等边界切分
- 正则表达式模式（类似 GPT 的分词正则）：
  - 英文单词：连续字母
  - 数字：连续数字
  - 中文/日文：每个字单独成一段
  - 空格：可能合并或保留
- 目的：限制 BPE 合并的范围，不让跨越自然边界

```
"Hello, 世界" → ["Hello", ",", " ", "世", "界"]
```

## 3. BPE 编码（核心算法）
Byte-Pair Encoding，逐步合并高频字节对：
- 初始：每个字符（或字节）是一个 token
- 查找**合并规则表**（训练时学到的，按优先级排序）
- 按优先级逐条应用合并：
  - 优先级 1: `"H" + "e"` → `"He"`
  - 优先级 2: `"He" + "l"` → `"Hel"`
  - 优先级 3: `"Hel" + "lo"` → `"Hello"`
- 直到没有可合并的对为止

```
"Hello" → ['H','e','l','l','o'] → ['He','l','l','o'] → ['Hel','lo'] → ['Hello']
```

## 4. 特殊 Token 注入
在 token 序列中插入模型需要的特殊标记：
- `<|begin_of_turn|>` / `<|end_of_turn|>` — 对话轮次边界
- `<|system|>` — system prompt 标记
- `<|user|>` / `<|assistant|>` — 角色标记
- `<|tool_use|>` / `<|tool_result|>` — 工具调用标记
- 这些特殊 token 在词表中有固定 ID，不经过 BPE

## 5. Token ID 映射
每个 token 查词表（Vocabulary）得到整数 ID：
- 词表大小约 100K（Anthropic 具体未公开）
- "Hello" → ID 12345
- "世" → ID 67890
- 未知字节 → 回退到 byte-level token（UTF-8 字节）

```
["<|system|>", "Hello", ",", " ", "世", "界"]
→ [100001, 12345, 256, 220, 67890, 67891]
```

## 6. 多段拼接（System + Messages + Tools）
按 API 格式拼接多个部分的 token 序列：
```
[system tokens] + [separator] + [tools tokens] + [separator]
+ [user msg 1 tokens] + [separator] + [assistant msg 1 tokens] + [separator]
+ [user msg 2 tokens] + [separator]
```
每段之间用特殊 token 分隔，让模型知道各部分的边界。

## 7. 图片/文件的 Token 化
如果 messages 中包含非文本内容：
- **图片**：不走 BPE，由 Vision Encoder 处理
  - 图片 → resize → patch 切分 → Vision Transformer → 特征向量
  - 特征向量转成"虚拟 token"插入序列
  - 一张图约消耗 几百到几千 tokens
- **PDF**：先渲染成图片再走上述流程

## 8. Token 数量统计 & 截断检查
计算总 token 数，检查是否超限：
- `total_input_tokens = system + tools + messages + special tokens`
- 检查是否超过模型的 `context_length`（如 200K）
- 超限 → 返回 `400 Bad Request`，提示 token 超限
- 计算剩余空间：`remaining = context_length - total_input_tokens`
- `max_tokens = min(用户设的 max_tokens, remaining)`

## 9. Cache Control 标记
标记哪些 token 范围参与 Prompt Caching：
- 带 `cache_control: {"type": "ephemeral"}` 的部分打上缓存标记
- 通常是 system prompt + tools 定义（每次对话不变的部分）
- 生成缓存 key（token 序列的 hash），用于后续 KV Cache 查找
- 标记缓存边界点（从哪个 token 开始是新的/不可缓存的）

## 10. 输出 Token 序列
最终产物交给推理引擎：
```
{
  token_ids: [100001, 12345, 256, 220, ...],    // 整数 ID 序列
  attention_mask: [1, 1, 1, 1, ...],            // 哪些位置参与注意力
  cache_prefix_length: 8000,                     // 前 8000 个 token 可查缓存
  total_tokens: 12000,                           // 总 token 数
  segment_map: {                                 // 各段的起止位置
    system: [0, 5000],
    tools: [5000, 8000],
    messages: [8000, 12000]
  }
}
```

## 流程图

```
原始文本（JSON 中的 string）
  ↓
[1] Unicode 规范化
  ↓
[2] 预分词（按空格/标点/中文边界切分）
  ↓
[3] BPE 编码（字节对合并 → token）
  ↓
[4] 注入特殊 Token（角色标记、工具标记）
  ↓
[5] 查词表 → Token ID 整数序列
  ↓
[6] 多段拼接（system + tools + messages）
  ↓
[7] 图片/文件 → Vision Encoder → 虚拟 token
  ↓
[8] 总数统计 → 超限检查 → 截断
  ↓
[9] Cache Control 标记（哪些可缓存）
  ↓
[10] 输出 token_ids + metadata → 送入推理引擎
```
