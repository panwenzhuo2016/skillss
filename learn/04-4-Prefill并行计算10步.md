# Prefill（并行计算 Input Tokens）：从 Token 到 KV Cache 的 10 步

> 对应服务端推理流程第 4 步的深度拆解

## 1. 确定 Prefill 范围
根据 Prompt Cache 结果，确定需要计算的 token 范围：
```
全部 input tokens: [0 ─────────────────── 12000]
已缓存（跳过）:    [0 ──── 8000]
需要 Prefill:                   [8000 ──── 12000]  ← 只算这 4000 个
```
- 已缓存的 KV Cache 直接从显存读取
- 未缓存的 4000 个 token 送入 Prefill 计算

## 2. Embedding 批量查表
4000 个 token 同时查 Embedding Table：
- 不像 Decode 一次查 1 个，Prefill 是**批量并行**查
- 4000 个 token → 4000 个 embedding 向量（每个 8192 维）
- 加上 RoPE 位置编码（位置从 8001 开始，接续缓存部分）
- 结果：`[4000, 8192]` 的矩阵

```
token_ids[8000:12000] → Embedding Table → [4000, 8192] 矩阵
+ RoPE(position=8001..12000) → 带位置信息的 embedding 矩阵
```

## 3. 分块策略（Chunked Prefill）
4000 个 token 可能一次算不完（显存限制），需要分块：
- 按 chunk_size 切分（如 512 或 1024 个 token 一块）
- 4000 tokens → 4 个 chunk × 1000 tokens
- 为什么分块：
  - Attention 矩阵是 `[seq_len, seq_len]`，太长会爆显存
  - 分块后可以和其他请求的 Decode 交替执行，减少排队

```
[chunk1: 1000] → [chunk2: 1000] → [chunk3: 1000] → [chunk4: 1000]
每个 chunk 内并行，chunk 间顺序执行
```

## 4. 第一层 Attention 计算（并行版）
与 Decode 的最大区别——**所有 token 的 Q、K、V 同时计算**：
```
Q = embeddings × W_Q    → [4000, 8192] × [8192, 8192] → [4000, 8192]
K = embeddings × W_K    → [4000, 8192] × [8192, 1024] → [4000, 1024]  (GQA)
V = embeddings × W_V    → [4000, 8192] × [8192, 1024] → [4000, 1024]  (GQA)
```

Attention Score 矩阵：
```
Score = Q × K^T → [4000, 4000+8000]
                    ↑当前chunk  ↑加上缓存的历史K

这是个巨大矩阵，FlashAttention 分块计算避免显存爆炸
```

## 5. FlashAttention 优化
传统 Attention 需要存完整的 `[4000, 12000]` Score 矩阵 → 显存爆炸。
FlashAttention 的做法：
- 把 Q、K、V 切成小 tile（如 128×128）
- 每个 tile 在 GPU SRAM（高速缓存）中计算，不写回显存
- 在线计算 softmax（不需要先算完所有 score 再 softmax）
- 显存占用从 O(N²) 降到 O(N)

```
传统: Q×K^T → [4000,12000] 存显存 → softmax → ×V    显存: O(N²)
Flash: 分块计算，每块在 SRAM 中完成，只存最终结果     显存: O(N)
```

## 6. KV Cache 写入
Prefill 过程中，每一层的 K 和 V 写入 KV Cache：
- 新计算的 K：追加到缓存 K 的后面 → `[8000+4000, head_dim]`
- 新计算的 V：追加到缓存 V 的后面 → `[8000+4000, head_dim]`
- 每一层都要写，100 层就是 100 份 KV
- [PagedAttention] 按 block 分配显存页，支持非连续存储

## 7. FFN 并行计算
每一层 Attention 后，4000 个 token 同时过 FFN：
```
FFN(x) = W_down × SiLU(W_gate × x) ⊙ (W_up × x)

x:      [4000, 8192]
W_up:   [8192, 32768]  → 中间结果: [4000, 32768]
W_gate: [8192, 32768]  → 中间结果: [4000, 32768]
W_down: [32768, 8192]  → 输出:     [4000, 8192]
```

这一步是**计算密集型**，矩阵乘法，GPU 核心满载。
Prefill 的 GPU 利用率高就是因为这里 batch 大，矩阵乘法效率高。

## 8. 逐层推进（Layer Pipeline）
100+ 层依次计算：
```
Layer 1:  Attention(Q×K^T, 含缓存KV) → FFN → 输出 [4000, 8192]
Layer 2:  Attention(Q×K^T, 含缓存KV) → FFN → 输出 [4000, 8192]
...
Layer N:  Attention(Q×K^T, 含缓存KV) → FFN → 输出 [4000, 8192]
```

- **Tensor Parallelism**：一层的权重切到多张 GPU 卡上并行算
  - 如 8 张 H100：每张算 1/8 的 attention heads 和 1/8 的 FFN
  - 每层结束需要 AllReduce 同步结果（通信开销）
- **Pipeline Parallelism**：不同层放不同卡
  - 卡 1 算 Layer 1-25，卡 2 算 Layer 26-50，以此类推

## 9. Prefill 与 Decode 的调度冲突
Prefill 是计算密集的大任务，会抢占 GPU：
- **问题**：一个大 Prefill（如 100K tokens）会让同节点上正在 Decode 的请求卡住
- **解决**：Chunked Prefill
  - Prefill 分小块（如 512 tokens 一块）
  - 每算完一块，让 Decode 请求插队执行几个 iteration
  - 交替执行，避免 Decode 延迟飙升

```
时间线: [Prefill chunk1][Decode batch][Prefill chunk2][Decode batch]...
         不再是 Prefill 独占到底
```

## 10. Prefill 完成 → 产出最后一个位置的 Hidden State
所有层跑完，4000 个 token 都有了输出，但只关心**最后一个位置**：
- 最后一个 token 的 hidden state → 送入 Decode 阶段
- 这个 hidden state 过 LM Head 就能生成第一个输出 token
- 所有 4000 个 token 的 KV Cache 已经写好，Decode 可以直接用

```
Prefill 产出:
  ├─ KV Cache: 所有 12000 个 token 的 K/V（含缓存 + 新计算）→ 供 Decode 用
  └─ Hidden State: 最后一个 token 的 [1, 8192] 向量 → 生成第一个输出 token
       ↓
  进入 Thinking / Decode 阶段
```

## 流程图

```
未缓存的 token 序列（如 4000 个）
  ↓
[1] 确定 Prefill 范围
  ↓
[2] 批量 Embedding 查表 + RoPE → [4000, 8192]
  ↓
[3] 分块（Chunked Prefill, 如 1000/chunk）
  ↓
[4] Attention: 所有 Q×K^T 并行（含缓存历史 KV）
  ↓
[5] FlashAttention 优化（分 tile 计算，省显存）
  ↓
[6] K/V 写入 KV Cache（追加到缓存后面）
  ↓
[7] FFN 并行计算（矩阵乘法，GPU 满载）
  ↓
[8] 重复 [4]-[7] 共 100+ 层（Tensor/Pipeline 并行）
  ↓
[9] 与 Decode 交替调度（Chunked Prefill）
  ↓
[10] 完成 → 最后一个 hidden state + 完整 KV Cache → 进入 Decode
```

## Prefill vs Decode 对比

| 维度 | Prefill | Decode |
|------|---------|--------|
| 一次处理 | N 个 token（批量） | 1 个 token |
| GPU 利用率 | 80-95%（计算密集） | 1-5%（带宽密集） |
| 瓶颈 | 算力（FLOPS） | 显存带宽（GB/s） |
| 耗时 | 与 input 长度成正比 | 与 output 长度成正比 |
| 用户感知 | 等待时间（TTFT） | 打字速度（TPS） |
