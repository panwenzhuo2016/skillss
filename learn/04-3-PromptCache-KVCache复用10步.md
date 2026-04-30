# Prompt Cache（KV Cache 复用）：从查缓存到命中的 10 步

> 对应服务端推理流程第 3 步的深度拆解

## 1. 计算缓存 Key
根据 token 序列的前缀生成缓存标识：
- 取带 `cache_control` 标记的 token 序列（通常是 system + tools）
- 计算 hash（如 SHA-256）作为缓存 key
- key 必须精确匹配——**哪怕一个 token 不同，缓存就失效**
- 这就是为什么 system prompt 和 tools 定义放在最前面：它们是稳定前缀

```
Cache Key = hash(token_ids[0:cache_prefix_length] + model_id + layer_config)
```

## 2. 缓存索引查找
在缓存存储中查找是否存在该 key：
- [推断] 分布式缓存系统（跨多个 GPU 节点共享）
- 查找维度：
  - 精确前缀匹配（逐 token 比对）
  - 同一模型版本
  - 同一推理配置
- 返回：命中（hit）/ 未命中（miss）/ 部分命中（partial hit）

## 3. 命中判定 & 前缀匹配
缓存不是全有全无，支持**前缀部分命中**：
```
请求 tokens: [A, B, C, D, E, F, G, H, I, J]
缓存 tokens: [A, B, C, D, E, F]
→ 前 6 个 token 命中，后 4 个需要重新计算

上次请求: system(5000) + tools(3000) + msg1(2000) + msg2(1000)
本次请求: system(5000) + tools(3000) + msg1(2000) + msg2(1000) + msg3(500)
→ 前 11000 个 token 全部命中，只需计算最后 500 个
```

## 4. KV Cache 数据加载
命中后，从缓存存储加载 KV 张量到 GPU 显存：
- KV Cache 内容：每一层 Transformer 的 Key 和 Value 矩阵
- 数据量：`层数 × 2(K+V) × head数 × head维度 × 序列长度 × 精度`
  - 100 层 × 2 × 8(GQA) × 128 × 8000 tokens × 2 bytes ≈ 3.2GB
- 从哪加载：
  - **同节点 GPU 显存**（最快，纳秒级）— 同一用户连续请求
  - **同节点 CPU 内存**（毫秒级）— 被换出但还在
  - [推断] **跨节点网络**（较慢）— 分布式缓存

## 5. KV Cache 校验
加载后验证缓存数据完整性：
- token 序列是否真的匹配（防止 hash 碰撞）
- 数据是否损坏（checksum 验证）
- 模型版本是否一致（模型更新后旧缓存失效）
- 校验失败 → 当作 cache miss 处理

## 6. 缓存未命中处理
如果完全未命中（首次请求或 prompt 大改）：
- 标记所有 input tokens 需要完整 Prefill
- 预分配 KV Cache 显存空间
- Prefill 完成后，将新计算的 KV Cache 写入缓存系统
- 报告 `cache_creation_input_tokens`（这些 token 的缓存是新建的）

## 7. 缓存淘汰策略
显存有限，需要淘汰旧缓存：
- **LRU（Least Recently Used）**：最久没用的先淘汰
- **TTL（Time To Live）**：超过一定时间自动过期（Anthropic 文档称约 5 分钟）
- **容量驱动**：显存不够时强制淘汰
- [推断] 优先保留：
  - 高频用户的缓存
  - 前缀被多个请求共享的缓存（如通用 system prompt）

## 8. 多租户前缀共享
[推断] 不同用户如果 system prompt 完全相同，可以共享缓存：
- 典型场景：同一个应用的所有用户用同一个 system prompt
- 共享部分：system prompt + tools 定义的 KV Cache
- 不共享：messages（每个用户的对话不同）
- 安全隔离：确保 messages 部分的 KV Cache 不跨用户泄露

## 9. 计算分界点确定
最终确定哪些 token 需要计算、哪些跳过：
```
Token 序列: [################|===========]
             ↑ 缓存命中，跳过  ↑ 需要 Prefill
             cache_read: 8000  new_tokens: 4000

→ cache_read_input_tokens: 8000   (省钱：只收 10% 费用)
→ cache_creation_input_tokens: 0  (没有新建缓存)
→ 需要 Prefill 的 tokens: 4000   (只算这部分)
```

## 10. 进入 Prefill（带缓存上下文）
缓存处理完毕，进入下一阶段：
- 已缓存部分的 KV Cache 已在显存中就位
- 未缓存部分的 token 送入 Prefill 阶段计算
- Prefill 时，新 token 的 Attention 可以"看到"缓存中的历史 KV
- 新计算的 KV 追加到 Cache 末尾
- 整个 KV Cache（旧 + 新）一起供后续 Decode 使用

## 流程图

```
Token 序列到达
  ↓
[1] 计算缓存 Key（前缀 hash）
  ↓
[2] 查缓存索引 → 命中？
  ├─ 命中 ──────────────────────────┐
  │   ↓                            │
  │  [3] 前缀匹配（确定命中多少）     │
  │   ↓                            │
  │  [4] 加载 KV Cache 到 GPU 显存   │
  │   ↓                            │
  │  [5] 校验完整性                  │
  │   ↓                            │
  └─→[9] 确定计算分界点              │
      ↓                            │
  ├─ 未命中 ────────────────────────┘
  │   ↓
  │  [6] 标记全量 Prefill + 预分配显存
  │   ↓
  │  [7] 淘汰旧缓存腾空间
  │   ↓
  │  [8] [多租户共享检查]
  │   ↓
  └─→[9] 确定计算分界点
      ↓
[10] 进入 Prefill（已缓存的 KV 就位 + 新 token 待计算）
```

## 成本影响

| 场景 | cache_read | cache_creation | 实际 Prefill 计算量 | 费用 |
|------|-----------|----------------|-------------------|------|
| 首次请求 | 0 | 12000 | 全部 12000 tokens | 100% |
| 同一对话第 2 轮 | 11000 | 500 | 只算新消息 500 | ~15% |
| 同一对话第 10 轮 | 11000 | 2000 | 只算新增 2000 | ~25% |
| 换了 system prompt | 0 | 12000 | 全部重算 | 100% |

**省钱关键**：保持 system prompt + tools 不变，对话间隔别超过缓存 TTL（约 5 分钟）。
