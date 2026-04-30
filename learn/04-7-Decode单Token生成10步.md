# Decode 深度拆解：一个 Token 从无到有的 10 步

> 聚焦 Transformer Decode 阶段，拆解单个 token 生成的完整过程
> 以 Claude Opus 级别模型为参考（推测 100+ 层，数千亿参数）

## 0. 背景：为什么 Decode 是瓶颈

Prefill 阶段所有 input tokens 并行计算，GPU 算力打满。
Decode 阶段每次只算 **1 个 token**，但要读取 **所有历史 token 的 KV Cache**。

打个比方：Prefill 是一群人同时做卷子，Decode 是一个人做卷子但每道题都要翻一遍前面所有人的答案。

```
GPU 利用率：
  Prefill: ████████████████████ 80-95%（计算密集，算力打满）
  Decode:  █░░░░░░░░░░░░░░░░░░  1-5%（带宽密集，大部分时间在搬数据）
```

---

## 1. 取上一个 Token 的 Embedding

上一步生成的 token（比如"好"，token ID = 12345）查 **Embedding Table**：
- 一张巨大的矩阵，词表大小 × 隐藏维度（如 100K × 8192）
- token ID 12345 → 取第 12345 行 → 得到一个 8192 维的向量
- 加上 **位置编码**（RoPE，Rotary Position Embedding）：把"这是第 N 个 token"的位置信息编码进向量

```
token "好" (ID: 12345)
  → Embedding Table[12345] → [0.12, -0.34, 0.56, ..., 0.78]  (8192维)
  → + RoPE位置编码 → [0.15, -0.31, 0.59, ..., 0.74]
```

这一步很快，就是查表 + 向量运算。

## 2. 进入第一层 Transformer Block

模型有 100+ 层 Transformer Block，每一层结构相同：
```
Input → LayerNorm → Multi-Head Attention → Residual Add
      → LayerNorm → FFN (MLP)             → Residual Add → Output
```

先过 **RMSNorm**（Root Mean Square Layer Normalization）：
- 把向量标准化，防止数值爆炸或消失
- 比传统 LayerNorm 少算一个 mean，更快

## 3. 计算 Q、K、V（Query、Key、Value）

当前 token 的 embedding 经过三个线性变换，生成 Q、K、V：

```
Q = embedding × W_Q    (Query: "我在找什么")
K = embedding × W_K    (Key: "我能提供什么")
V = embedding × W_V    (Value: "我的实际内容")
```

- W_Q、W_K、W_V 是这一层的权重矩阵，训练时学到的
- Multi-Head：把 Q/K/V 切成多个 head（如 64 个 head，每个 128 维）
- [优化] **GQA（Grouped Query Attention）**：多个 Q head 共享一组 KV head，大幅减少 KV Cache 大小
  - 原始 MHA：64 Q heads + 64 KV heads
  - GQA：64 Q heads + 8 KV groups（节省 8 倍 KV 显存）

**当前 token 的 K 和 V 写入 KV Cache**，供后续 token 使用。

## 4. Attention 计算：Q × 所有历史 K

这是 Decode 最耗时的一步——当前 token 的 Q 要和 **所有历史 token 的 K** 做点积：

```
Attention Score = Q_current × K_all^T / sqrt(d_k)

假设已生成 5000 个 token：
Q: [1, 128]          ← 当前 token，1 个
K: [5000, 128]       ← 所有历史 token 的 Key
Score: [1, 5000]     ← 当前 token 对每个历史 token 的注意力分数
```

- 每个 head 独立算，64 个 head 并行
- **这一步的计算量和历史长度成正比**：对话越长越慢
- Score 经过 softmax 归一化 → 注意力权重（概率分布）

**为什么要读 KV Cache：** K 和 V 在 Prefill 或之前的 Decode 步骤中已经算好存在显存里了，不需要重新算，但要从显存搬到计算单元——这就是带宽瓶颈。

## 5. 加权求和：Attention Weight × V

用第 4 步得到的注意力权重，对所有历史 token 的 V 做加权求和：

```
Output = Attention_Weight × V_all

Weight: [1, 5000]    ← 注意力权重
V:      [5000, 128]  ← 所有历史 token 的 Value
Output: [1, 128]     ← 加权后的输出
```

含义：当前 token 从所有历史 token 中"提取"了它需要的信息。
- 权重高的 token 贡献大（模型在"关注"它们）
- 权重低的 token 几乎被忽略

多个 head 的输出拼接 → 线性变换 → 得到 Attention 层的最终输出。

## 6. Residual Add + FFN（前馈网络）

**残差连接**：把 Attention 输出加回原始输入（防止深层网络梯度消失）
```
x = x + Attention(x)
```

然后进入 **FFN（Feed-Forward Network）**，也叫 MLP：
```
FFN(x) = W_down × SiLU(W_gate × x) ⊙ (W_up × x)
```

- W_up：8192 → 32768（扩展 4 倍）
- W_gate：8192 → 32768（门控）
- SiLU 激活函数（Swish）
- 逐元素相乘（⊙）
- W_down：32768 → 8192（压回去）

**FFN 的参数量占整个模型的 2/3**，这是模型"知识"存储的主要位置。
Attention 负责"看哪里"，FFN 负责"知道什么"。

再次残差连接：`x = x + FFN(x)`

## 7. 重复 100+ 层

第 2-6 步在每一层重复一次：
```
Layer 1:  Norm → Attention(读KV Cache) → Add → Norm → FFN → Add
Layer 2:  Norm → Attention(读KV Cache) → Add → Norm → FFN → Add
...
Layer N:  Norm → Attention(读KV Cache) → Add → Norm → FFN → Add
```

- 每一层都有自己的权重（W_Q、W_K、W_V、W_up、W_gate、W_down）
- 每一层都有自己的 KV Cache
- **KV Cache 总显存 = 层数 × 2(K和V) × head数 × head维度 × 序列长度 × 数据精度**
  - 100 层 × 2 × 8(GQA groups) × 128 × 5000 tokens × 2 bytes(FP16) ≈ 2GB
  - 200K context 下：约 80GB，一张 H100 的显存几乎全被 KV Cache 占满

**[优化技术]**：
- **FlashAttention**：不存完整 Attention 矩阵，分块计算，省显存省带宽
- **PagedAttention**（vLLM）：像操作系统管理内存一样管理 KV Cache，支持非连续存储，减少碎片
- **Continuous Batching**：不同请求的 Decode 步骤动态组 batch，提高 GPU 利用率

## 8. 最终 LayerNorm → Logits

所有层跑完，最后一层的输出过一个 **RMSNorm**，然后乘以 **LM Head**（语言模型头）：

```
hidden: [1, 8192]              ← 最后一层输出
LM Head: [8192, 100000]        ← 映射到词表大小
logits: [1, 100000]            ← 每个 token 的"原始得分"
```

logits 是一个 100K 维的向量，每个位置对应词表中一个 token 的得分。
得分高 → 模型认为下一个 token 更可能是它。

[推断] LM Head 的权重可能和 Embedding Table **共享**（Weight Tying），节省参数量。

## 9. Sampling（采样）

从 logits 到最终选出一个 token：

```
logits: [2.1, -0.5, 3.8, 1.2, ..., -1.0]   ← 100K 维原始得分
                        ↓
1. Temperature 缩放:   logits = logits / temperature
   - temperature=1.0: 原样
   - temperature=0.1: 差距放大，趋向确定性（几乎总选最高分）
   - temperature=2.0: 差距缩小，更随机
                        ↓
2. Top-K 截断:         只保留得分最高的 K 个 token，其余置 -inf
                        ↓
3. Top-P (Nucleus):    按概率从高到低累加，超过 P 的截掉
                        ↓
4. Softmax:            logits → 概率分布（所有值加起来 = 1）
   [0.35, 0.28, 0.15, 0.12, 0.05, 0.03, 0.02, ...]
                        ↓
5. 随机采样:            按概率分布掷骰子，选出一个 token
   → 选中 "的" (概率 0.35)
```

**Greedy Decoding**（temperature=0）：直接取 argmax，永远选最高分。确定性但可能无聊。
**Random Sampling**：按概率分布随机，更有创造力但可能跑偏。

## 10. 输出 Token & 更新状态

选出的 token 进入收尾流程：

1. **检查停止条件**：
   - 是否是 EOS（End of Sequence）token → 停止生成
   - 是否命中 `stop_sequences` → 停止
   - 是否达到 `max_tokens` → 停止
   - 是否是工具调用 JSON 的结束 `}` → 可能停止

2. **SSE 推送**：token 立即通过流式连接发给客户端（不等后续 token）

3. **更新状态**：
   - 这个 token 成为下一轮 Decode 的输入（回到第 1 步）
   - 它的 KV 已经在第 3 步写入 Cache 了
   - 序列长度 +1

4. **循环**：回到第 1 步，生成下一个 token，直到触发停止条件

```
Token N 生成完毕
  → 推送给客户端
  → 作为输入送入第 1 步
  → 生成 Token N+1
  → 推送...
  → 循环，直到停止
```

---

## 流程图

```
上一个 token
  ↓
[1] Embedding 查表 + RoPE 位置编码
  ↓
[2] 进入 Transformer Layer 1
  ↓
[3] 线性变换 → Q, K, V（K/V 写入 Cache）
  ↓
[4] Q × 所有历史 K → Attention Score → Softmax
  ↓
[5] Attention Weight × 所有历史 V → 加权求和
  ↓
[6] Residual Add → FFN(SiLU) → Residual Add
  ↓
[7] 重复 [2]-[6] 共 100+ 层
  ↓
[8] 最终 LayerNorm → LM Head → logits (100K维)
  ↓
[9] Temperature → Top-K → Top-P → Softmax → 采样
  ↓
[10] 输出 token → SSE 推送 → 回到 [1] 生成下一个

每生成 1 个 token，完整走一遍 [1]-[10]
生成 500 个 token 的回复 = 走 500 遍
```

## 核心矛盾 & 优化技术

| 问题 | 原因 | 优化技术 |
|------|------|----------|
| GPU 利用率低（1-5%） | 每次只算 1 个 token，大部分时间在搬 KV Cache | **Continuous Batching**：多个请求凑一起算 |
| KV Cache 占满显存 | 100层 × 长序列 × FP16 | **GQA**：减少 KV head 数；**量化**：FP16→INT8/INT4 |
| Attention 随序列长度线性增长 | 每个 token 都要看所有历史 | **FlashAttention**：分块计算省带宽；**Sliding Window**：只看最近 N 个 |
| 显存碎片化 | 不同请求长度不同，KV Cache 分配不均 | **PagedAttention**（vLLM）：分页管理，像虚拟内存 |
| 逐 token 太慢 | 自回归本质限制，无法并行 | **Speculative Decoding**：小模型猜多个 token，大模型一次验证 |
| 模型太大放不下一张卡 | 数千亿参数 | **Tensor Parallelism**：一层的权重切到多张卡；**Pipeline Parallelism**：不同层放不同卡 |
