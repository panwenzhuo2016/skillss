# Streaming SSE 推送：从 Token 生成到客户端接收的 10 步

> 对应服务端推理流程第 9 步的深度拆解

## 1. Token 生成完毕 → 进入推送队列
Decode 阶段每生成一个 token，立即送入推送流水线：
- 不等整个回复生成完再发（那就不是 streaming 了）
- token 进入一个异步队列，推送线程从队列消费
- 推送和生成是**并行的**：GPU 在算 token N+1，网络在发 token N

```
GPU Decode:   [token1][token2][token3][token4]...
SSE 推送:      [token1] [token2] [token3]...
              ← 流水线并行，推送略滞后于生成 →
```

## 2. Token Detokenization
token ID 转回可读文本：
- 查词表反向映射：token ID 67890 → "的"
- 处理 BPE 边界：相邻 token 可能拼成一个词
  - token "hel" + token "lo" → 展示 "hello"（需等第二个 token 到了才推送）
- 处理 UTF-8 多字节：一个中文字可能跨多个 byte-level token
  - 需要缓冲，等字节凑齐才能解码成完整字符
- [推断] 可能做微批量（micro-batch）：攒 2-3 个 token 一起推送，减少网络开销

## 3. 构建 SSE Event 数据
把 token 文本封装成 SSE 事件格式：

```
# 文本 token
event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"好的"}}

# 工具调用参数（增量 JSON）
event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"file_pa"}}
```

不同 content block 类型对应不同的 delta 类型：
- `text_delta`：普通文本
- `thinking_delta`：思考内容
- `input_json_delta`：工具参数 JSON 片段

## 4. Content Block 生命周期管理
每个 content block 有完整的生命周期事件：

```
# 1. 开始一个新 block
event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

# 2. 逐 token 推送
event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"好"}}

# 3. 这个 block 结束
event: content_block_stop
data: {"type":"content_block_stop","index":0}
```

一个 message 可以有多个 content block（先文本，再工具调用，再文本...）。

## 5. Message 级别事件
包裹在 content block 之外的 message 事件：

```
# 请求开始
event: message_start
data: {"type":"message_start","message":{"id":"msg_xxx","model":"claude-opus-4-6","role":"assistant","usage":{"input_tokens":1200}}}

# ... content blocks ...

# 请求结束
event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":350}}

event: message_stop
data: {"type":"message_stop"}
```

## 6. HTTP Chunked Transfer Encoding
SSE 事件通过 HTTP Chunked 编码传输：
- 响应头：`Transfer-Encoding: chunked`
- 每个 chunk：`<长度>\r\n<数据>\r\n`
- 不需要预先知道总响应大小
- 保持 TCP 连接不断开，持续推送

```
HTTP 响应:
  HTTP/1.1 200 OK
  Content-Type: text/event-stream
  Transfer-Encoding: chunked

  [chunk1: "event: message_start\ndata: {...}\n\n"]
  [chunk2: "event: content_block_start\ndata: {...}\n\n"]
  [chunk3: "event: content_block_delta\ndata: {...}\n\n"]
  ...
```

## 7. 网络层传输
从服务端到客户端的网络路径：
- GPU 服务器 → 内部网络 → API Gateway → CDN/Edge → 公网 → 客户端
- 每一跳都可能引入延迟
- **TCP Nagle 算法**：默认会缓冲小包合并发送
  - 对 SSE 有害：每个 event 很小，Nagle 会增加延迟
  - 需要设置 `TCP_NODELAY` 关闭 Nagle
- 如果经过反向代理（Nginx）：需要关闭 `proxy_buffering`，否则 Nginx 会攒满缓冲区才转发

```nginx
# Nginx SSE 配置
proxy_buffering off;
proxy_cache off;
proxy_set_header Connection '';
proxy_http_version 1.1;
chunked_transfer_encoding on;
```

## 8. 客户端 SSE 解析
客户端（Claude Code CLI / SDK）解析 SSE 流：
- 监听 TCP 连接，按 `\n\n` 分割事件
- 解析 `event:` 行 → 事件类型
- 解析 `data:` 行 → JSON.parse 得到结构化数据
- 按事件类型分发处理：
  - `message_start` → 初始化消息对象
  - `content_block_delta` → 追加文本 / 拼接 JSON
  - `message_stop` → 完成

```javascript
// 伪代码
eventSource.on('content_block_delta', (data) => {
  if (data.delta.type === 'text_delta') {
    terminal.write(data.delta.text)  // 实时渲染到终端
  } else if (data.delta.type === 'input_json_delta') {
    jsonBuffer += data.delta.partial_json  // 拼接工具参数
  }
})
```

## 9. 断线重连 & 错误处理
流式传输过程中可能中断：
- **网络闪断**：TCP 连接断开
  - SSE 标准支持 `Last-Event-ID` 重连，但 Anthropic API [推断] 不支持断点续传
  - 断了就是断了，需要重新发请求
- **服务端超时**：生成太慢，连接超时
  - 客户端设置 read timeout（如 10 分钟）
  - 服务端可能发 ping 事件保持连接活跃
- **服务端错误**：推理过程中 GPU OOM / 崩溃
  - 推送 error event → 客户端处理
- **客户端取消**：用户按 Ctrl+C
  - 客户端关闭连接 → 服务端检测到 → 停止生成，释放资源

## 10. 流完成 & 连接关闭
最后一个事件推送完毕：
- 发送 `message_stop` 事件
- 发送最后一个 HTTP chunk（`0\r\n\r\n` 表示 chunked 结束）
- TCP 连接关闭（或保持 keep-alive 供后续请求复用）
- 客户端确认收到所有事件
- 统计最终 usage（input_tokens + output_tokens + cache tokens）

```
完整的 SSE 事件序列：
  message_start          ← 开始
  content_block_start    ← 第 1 个 block 开始（如 thinking）
  content_block_delta ×N ← thinking 内容
  content_block_stop     ← thinking 结束
  content_block_start    ← 第 2 个 block 开始（如 text）
  content_block_delta ×N ← 文本内容
  content_block_stop     ← text 结束
  content_block_start    ← 第 3 个 block 开始（如 tool_use）
  content_block_delta ×N ← JSON 参数
  content_block_stop     ← tool_use 结束
  message_delta          ← stop_reason + usage
  message_stop           ← 结束
```

## 流程图

```
GPU 生成 token
  ↓
[1] Token 进入推送队列（异步，不阻塞 GPU）
  ↓
[2] Detokenization（ID → 文本，处理多字节/BPE 边界）
  ↓
[3] 封装 SSE Event（event + data JSON）
  ↓
[4] Content Block 生命周期（start → delta ×N → stop）
  ↓
[5] Message 级别事件包裹（message_start / message_stop）
  ↓
[6] HTTP Chunked 编码传输
  ↓
[7] 网络传输（TCP_NODELAY，关闭 proxy_buffering）
  ↓
[8] 客户端 SSE 解析 → 实时渲染
  ↓
[9] 异常处理（断线/超时/取消）
  ↓
[10] 流完成 → 连接关闭 → usage 统计
```
