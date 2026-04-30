# Sampling 采样策略：从 Logits 到选中 Token 的 10 步

> 对应服务端推理流程第 6 步的深度拆解

## 1. 获取原始 Logits
模型最后一层输出经过 LM Head（线性变换）后得到 logits：
- 维度：`[1, vocab_size]`（如 `[1, 100000]`）
- 每个值是该 token 的原始得分（未归一化，可正可负）
- 得分高 ≠ 概率高（还没做 softmax）

```
logits = [2.1, -0.5, 8.3, 1.2, 0.0, ..., -3.2]
          ↑ID:0 ↑ID:1 ↑ID:2 ↑ID:3        ↑ID:99999

ID:2 得分最高(8.3)，但还不知道概率是多少
```

## 2. Logit Bias / 屏蔽处理
在采样前对某些 token 的 logits 做调整：
- **强制屏蔽**：某些 token 设为 `-inf`（永远不会被选中）
  - 如：EOS token 在生成太短时被屏蔽（防止过早停止）
  - 如：Constrained Decoding 中不合法的 JSON token
- **Logit Bias**：API 参数，手动调高/调低特定 token 的分数
  - `logit_bias: { 12345: -100 }` → 几乎不可能生成 token 12345
- **安全过滤**：[推断] 某些有害内容相关的 token 序列可能被降权

## 3. Temperature 缩放
用 temperature 参数缩放 logits，控制随机性：
```
scaled_logits = logits / temperature
```

| temperature | 效果 | 场景 |
|-------------|------|------|
| 0.0 | 等同 greedy（取最大值） | 需要确定性输出 |
| 0.5 | 差距放大，高概率 token 更突出 | 较保守的生成 |
| 1.0 | 原样不变（默认值） | 平衡创造力和准确性 |
| 1.5+ | 差距缩小，更随机 | 创意写作 |

```
原始 logits:     [8.3, 2.1, 1.2]
temp=0.5 后:     [16.6, 4.2, 2.4]   → softmax 后差距更大，ID:0 接近 100%
temp=2.0 后:     [4.15, 1.05, 0.6]  → softmax 后差距更小，更均匀
```

## 4. Top-K 截断
只保留得分最高的 K 个 token，其余置为 `-inf`：
```
K = 50（只考虑前 50 名）

排序后: [8.3, 5.1, 4.8, 3.2, ..., -1.0, -2.5, ...]
        ←── 保留 top 50 ──→    ←── 置为 -inf ──→

目的：排除极低概率的 token，防止生成乱码/胡言乱语
```

- K 越小越保守（只从最可能的几个中选）
- K 越大越多样（罕见 token 也有机会）
- 某些实现中默认不启用 Top-K

## 5. Top-P（Nucleus Sampling）截断
按概率累计从高到低，保留累计概率不超过 P 的 token：
```
先做 softmax 得概率:
  token_A: 0.35
  token_B: 0.25    累计: 0.60
  token_C: 0.15    累计: 0.75
  token_D: 0.10    累计: 0.85
  token_E: 0.05    累计: 0.90 ← P=0.9 截断线
  token_F: 0.03    ← 丢弃
  token_G: 0.02    ← 丢弃
  ...

P=0.9: 保留前 5 个 token（累计 90% 概率）
P=0.5: 只保留前 2 个 token
```

- 比 Top-K 更智能：当模型很确信时自动缩小候选集，不确信时自动扩大
- 例：模型 99% 确定下一个是 "的" → 只保留 1 个 token
- 例：模型不确定 → 保留 20+ 个候选

## 6. Min-P 过滤（新型策略）
[部分模型支持] 过滤掉概率低于 `min_p × max_prob` 的 token：
```
max_prob = 0.35（最高概率 token）
min_p = 0.1

阈值 = 0.35 × 0.1 = 0.035

token_A: 0.35  ✓
token_B: 0.25  ✓
token_C: 0.15  ✓
token_D: 0.10  ✓
token_E: 0.05  ✓
token_F: 0.03  ✗ (< 0.035)
```

比 Top-P 更动态：高置信度时严格过滤，低置信度时宽松。

## 7. 重复惩罚（Repetition Penalty）
防止模型不停重复同一段话：
- **Frequency Penalty**：已出现的 token 按出现次数降低 logit
  - `logit -= frequency_penalty × count(token)`
- **Presence Penalty**：只要出现过就降低，不管次数
  - `logit -= presence_penalty × (1 if token appeared else 0)`

```
"的的的的" → "的" 的 logit 被反复降低 → 模型被迫换其他词

但要小心：惩罚太重会让模型为了避免重复而生成不通顺的句子
```

## 8. Softmax 归一化
经过所有过滤后，对剩余 token 的 logits 做 softmax 转成概率：
```
P(token_i) = exp(logit_i) / Σ exp(logit_j)

过滤后剩余:  logits = [16.6, 4.2, 2.4, 1.8, 0.5]
softmax:    probs  = [0.72, 0.14, 0.08, 0.04, 0.02]
                      ↑ 所有概率加起来 = 1.0
```

## 9. 随机采样（掷骰子）
根据概率分布随机选择一个 token：
```
probs = [0.72, 0.14, 0.08, 0.04, 0.02]

生成随机数 r = 0.83（均匀分布 [0,1]）

累计概率:
  0.72           → r > 0.72，不选 token_A
  0.72 + 0.14 = 0.86  → r < 0.86，选中 token_B ✓

→ 输出 token_B
```

- **Greedy**（temperature=0）：不掷骰子，直接选概率最高的
- **Beam Search**：同时保留 N 条路径，最后选总概率最高的（LLM 较少用）
- 随机种子（seed）：设定相同 seed + temperature 可以复现结果

## 10. 输出采样结果
选中 token 后，输出给后续流程：
```
{
  token_id: 67890,          // 选中的 token ID
  token_text: "的",         // 对应文本
  logprob: -0.33,           // log概率（ln(0.72)）
  top_logprobs: [           // 候选 token 的概率（可选返回）
    { token: "的", logprob: -0.33 },
    { token: "了", logprob: -1.97 },
    { token: "是", logprob: -2.53 }
  ]
}
```

- `logprob` 可用于评估模型置信度
- `top_logprobs` API 参数可以返回 top N 个候选的概率
- 选中的 token 送入 Decode 循环的下一轮（回到 Embedding 查表）

## 流程图

```
LM Head 输出 logits [1, 100000]
  ↓
[1] 原始 logits
  ↓
[2] Logit Bias / 屏蔽（强制禁用某些 token）
  ↓
[3] Temperature 缩放（logits / T）
  ↓
[4] Top-K 截断（只保留前 K 个）
  ↓
[5] Top-P 截断（累计概率 ≤ P 的保留）
  ↓
[6] Min-P 过滤（低于阈值的丢弃）
  ↓
[7] 重复惩罚（降低已出现 token 的分数）
  ↓
[8] Softmax → 概率分布
  ↓
[9] 随机采样（按概率掷骰子）
  ↓
[10] 输出 token_id + logprob → 送入下一轮 Decode
```

## 不同场景的推荐配置

| 场景 | temperature | top_p | top_k | 效果 |
|------|------------|-------|-------|------|
| 代码生成 | 0.0-0.3 | 0.9 | - | 确定性高，减少语法错误 |
| 对话聊天 | 0.7-1.0 | 0.95 | - | 自然流畅，有适度变化 |
| 创意写作 | 1.0-1.5 | 0.98 | - | 多样性高，出人意料 |
| JSON/结构化 | 0.0 | 1.0 | - | 完全确定性，格式可靠 |
| Claude Code | 1.0 | (默认) | - | Anthropic 默认值 |
