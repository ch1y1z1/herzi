# Prompt 投递可观测性与无声丢失保护

- 状态：首轮实现完成（合成测试与构建通过），真实 Pi Pane 写入式验收 **NOT RUN**。
- 目标：把从 composer Enter 到 authoritative reconciliation 的投递过程用 `requestId` 串成一条可查询的 trace，并消除“请求失败后 optimistic 消息被撤回却没有可见错误/恢复信息”的风险。

## 1. 问题与边界

- 前端已在 `onNew` 生成 `requestId` 并发给 server，但没有形成端到端生命周期记录。
- 请求失败时旧实现直接删除 optimistic 消息并重新抛错，`ChatView` 的 `error` 状态没有被写入；而 `error` 又被 1.5s 的 chat 轮询不断清空，因此失败几乎不可见。
- Pi-native 路径 enqueue 后立即返回 `queued`，queue 的 claim/ack/failed/expiry 对前端完全不可见，形成“HTTP 成功但实际未投递”的观测盲区。
- 本轮不重写 Chat 架构，不引入自动重试（避免双发），只增加 trace、投递状态推送和失败可见性。

## 2. 生命周期

单次投递尝试 = 一个 `requestId`。阶段（`PromptDeliveryPhase`）：

| 来源 | phase | 含义 |
| --- | --- | --- |
| client | `client.submit` | composer 提交、构造本次尝试 |
| client | `client.optimistic` | optimistic 消息进入 thread |
| client | `client.response` | 收到 HTTP 响应（记录 `httpStatus` / `transport` / `status`） |
| client | `client.error` | 请求失败（HTTP 非 2xx 或网络错误） |
| client | `client.retry` | 用户手动重试，使用新的 `requestId`、`attempt + 1` |
| client | `client.delivery-status` | 应用 server 推送的 queue 状态 |
| client | `client.reconciliation` | 权威 transcript 出现同内容消息、pending 气泡收敛 |
| server | `server.received` | prompt 路由收到请求 |
| server | `server.rejected` | 校验失败（`pane-not-found` / `invalid-attachments` / `empty-prompt` / `prompt-too-large` / `images-too-large`） |
| server | `server.validated` | 文本、附件、大小校验通过 |
| server | `server.transport-selected` | 选定 `text` / `host-path` / `pi-native` |
| server | `server.submitted` | Herdr `agent.prompt` 成功返回 |
| server | `server.error` | 附件绑定或 Herdr 调用抛错 |
| queue | `queue.enqueued` | Pi bridge 命令入队 |
| queue | `queue.claimed` | bridge poll 认领命令 |
| queue | `queue.dispatched` | bridge ack `dispatched` |
| queue | `queue.failed` | bridge ack `failed`（只记录固定错误码 `bridge-failed`） |
| queue | `queue.expired` | 60s TTL 内未被认领，或认领后未 ack |

## 3. 事件 schema 与隐私边界

`PromptDeliveryEvent`（`src/shared/protocol.ts`）只允许以下字段：
`seq`、`requestId`、`paneId`、`source`、`phase`、`at`、`attempt`、`transport`、`status`、`httpStatus`、`errorCode`、`errorClass`、`latencyMs`、`queueStatus`、`commandId`。

- **禁止**记录 prompt 正文、图片内容/路径、token、绝对 session path、Herdr/bridge 原始错误文本。
- bridge ack 的原始 `error` 文本仍留在内存队列里（既有行为），但 trace 只写固定码，避免模型错误信息回显正文。
- 双端强制 sanitize：`src/shared/prompt-delivery.ts` 的 `parsePromptDeliveryEvent` 只保留 allowlist 字段并做长度/枚举/数值范围约束；server 的 `POST /api/prompt-delivery/events` 会把客户端事件按 `source: "client"` 重新清洗，因此客户端主动塞入 `text`、`sessionPath`、`token` 也不会落盘。
- 客户端事件的时间戳会被 clamp 到 `[now - 1h, now + 60s]`，server 事件 `at` 取记录时刻。
- 客户端 phase 与服务端 phase 分属不同 allowlist，客户端无法伪造 `queue.*` / `server.*`。

## 4. 存储与查询

- `src/server/prompt-delivery-trace.ts` 的 `PromptDeliveryTrace`：
  - 内存全局 ring 2000 条；按 `requestId` 保留最近 64 条、最多 200 个 request（LRU）。
  - JSONL 追加写入，单文件上限 2 MiB，超过即轮转为 `<file>.1`（同样有界）。
  - 写失败只记录 `lastWriteError` 并回调告警，绝不影响 prompt 投递。
- 默认文件路径：`$HERZI_TRACE_DIR/prompt-delivery.jsonl`，未设置时为 `$TMPDIR/herzi-<uid>/prompt-delivery.jsonl`（与既有 image upload 目录约定一致）；文件权限 0600。
- 接口：
  - `POST /api/prompt-delivery/events`：`{ events: PromptDeliveryEvent[] }`，最多 50 条，走既有 request token + origin 校验。
  - `GET /api/prompt-delivery?requestId=<id>&limit=<n>`：`requestId` 缺省时返回最近事件（`limit` 默认 50，上限 2000）。与既有 GET 一致，不要求 token。
- WebSocket：`ServerMessage` 新增 `{ channel: "chat"; type: "prompt-delivery"; paneId; payload }`，server 在 `queue.claimed|dispatched|failed|expired` 时广播；`queue.enqueued` 不推送（HTTP 响应已经表达）。

## 5. 失败可见性与恢复

- 失败或被判定未确认时，optimistic 气泡**不撤回**：保留正文、图片预览、`requestId` 与尝试次数。
- 气泡内新增状态行（`data-delivery` part）：`正在发送…` / `等待 Pi 接收…` / `Pi 已接收，正在写入会话…` / `未确认送达` / `未送达`；`sent` 不显示状态行。
- 失败与未确认状态提供两个手动操作：`重试`（单次、显式，使用新的 `requestId` 与 `attempt + 1`）与 `复制内容`。
  - 必须换新 `requestId`，否则会被 `PiCommandQueue` 的 requestId 去重逻辑吞掉。
- composer 上方新增 role=alert 的错误条；它与 `error` 分开保存，因为 chat 轮询的成功回调会清空 `error`。
- 消息被权威 transcript 收敛时会清除对应的错误条，并记录 `client.reconciliation`。
- 图片附件过期信息来自 upload 的 `expiresAt`，过期后提示“请重新粘贴”。
- 不做任何自动重试。

## 6. 关键实现位置

| 文件 | 内容 |
| --- | --- |
| `src/shared/protocol.ts` | `PromptTransport`、`PromptDeliveryPhase`、`PromptDeliveryEvent`、WS 消息类型 |
| `src/shared/prompt-delivery.ts` | phase allowlist、字段级 sanitizer、correlation id 校验 |
| `src/server/prompt-delivery-trace.ts` | bounded ring + JSONL 轮转 + subscribe |
| `src/server/pi-command-queue.ts` | `PiCommandLifecycleEvent` 回调（enqueued/claimed/dispatched/failed/expired） |
| `src/server/index.ts` | trace 实例、prompt 路由各阶段记录、两个查询/上报路由、WS 广播、15s 队列巡查 |
| `src/web/promptDeliveryTrace.ts` | 客户端 ring（200）+ 待上报批次（40，单批 20）+ 失败退避上报 |
| `src/web/components/ChatView.tsx` | 投递状态、失败气泡与操作、reconciliation 记录、`deliveryError` |
| `src/web/App.tsx` | 转发 WS `prompt-delivery` 事件（每 pane 最近 20 条） |

队列过期巡查由 30 分钟改为独立的 15s 定时器（upload 清理仍为 30 分钟），使 60s TTL 的过期能在约 75s 内可见。

## 7. 验证

- `npm run typecheck`：PASS。
- `npm test`：PASS（10 files / 47 tests）。
- `npm run build`：PASS（仅既有 chunk size warning）。
- 新增测试：
  - `src/shared/prompt-delivery.test.ts`：字段边界、正文/图片/token/session path 被丢弃、phase 归属、时间戳 clamp。
  - `src/server/prompt-delivery-trace.test.ts`：ring/每请求/LRU 边界、JSONL 轮转、启动时轮转超大文件、订阅者异常隔离、写失败不抛出。
  - `src/server/pi-command-queue.test.ts`：生命周期事件顺序、失败只记录 `bridge-failed`、TTL 过期、observer 抛异常不影响入队。
  - `src/web/promptDeliveryTrace.test.ts`：批量上报、未知字段剔除、批次/local ring 边界、server 不可用时保留缓冲。
  - `src/web/components/ChatView.test.tsx`：失败气泡保留 + alert + 重试/复制、手动重试使用新 requestId、queued → `queue.expired` 显示未确认、claimed → dispatched 后状态行消失。

## 8. 未完成与限制

- 真实 Pi Pane / bridge 写入式验收 **NOT RUN**，需要用户授权的专用 synthetic Pane。
- `src/web/styles.css` 本轮未修改（属并行 Worker 范围），投递状态行的两个按钮使用内联样式；样式统一待集成后处理。
- `GET /api/prompt-delivery` 未加 token 校验，与现有 GET 接口保持一致（仅 loopback 可访问，且不含正文）。
- `queue.expired` 的可见延迟取决于 15s 巡查周期，最长约 75s。
- 未记录 Herdr/bridge 原始错误文本是刻意的隐私取舍；排查具体投递失败时仍需结合 server 日志与 Herdr 侧信息。
