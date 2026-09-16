# Prompt 投递可观测性与无声丢失保护（Worker B 执行记录）

- 状态：实现完成，合成测试与构建 PASS；真实 Pi/Herdr Pane 写入式验收 NOT RUN，待用户授权。
- 角色：本批次 Worker B。
- 范围：`src/web/components/ChatView.tsx`、新增窄范围 prompt delivery trace 模块、`src/server/index.ts`、`src/server/pi-command-queue.ts`、必要 shared type 与测试。经用户明确批准，额外最小改动 `src/web/App.tsx`（WS 消息转发）。
- Base worktree：`/Users/chiyizi/.herdr/worktrees/herzi/agent-20260916-prompt-observability`，base SHA `dd8cbe983c9f30bc795bc95209ddbac490b4b889`。
- 长期文档：[`docs/prompt-delivery-observability.md`](../../docs/prompt-delivery-observability.md)。

## 目标与验收条件

目标：先建立从 composer Enter/`onNew` 到 HTTP、Herdr/Pi bridge queue、ack/expiry、authoritative reconciliation 的 `requestId` 关联日志，并修复“请求失败后 optimistic 消息被撤回却没有可见错误/恢复信息”的风险；不先做大规模 Chat 架构重写。

验收条件（本轮状态）：

1. 同一 `requestId` 可关联客户端提交/optimistic/响应/错误/reconciliation，server received/validated/transport-selected/submitted 或 queued，以及 queue claimed/ack failed/dispatched/expired —— 实现完成，合成测试 PASS；真实链路 NOT RUN。
2. 日志 bounded 且 metadata-only，不含 prompt 正文、图片、token、绝对 session path —— 实现完成并有单元测试锁死不变量。
3. 失败至少显示明确错误且保留可恢复信息 —— 实现完成（失败气泡 + alert + 手动重试/复制）。
4. 不自动重试造成双发 —— 实现完成（仅手动重试，且使用新 requestId）。
5. 相关测试通过 —— PASS。

## 需求澄清（用户已确认）

1. 日志落点：服务端 bounded JSONL + 客户端上报接口 `POST /api/prompt-delivery/events` + 查询接口 `GET /api/prompt-delivery`。
2. 失败 UI：保留失败气泡，显示明确状态、requestId、原因，并提供手动“重试”与“复制内容”；不自动重试。
3. queued 回执：扩展 WebSocket（`ServerMessage` 新增 `chat/prompt-delivery`）推送 queue claimed/dispatched/failed/expired。
4. `src/web/App.tsx` 允许最小改动，但必须记录（见上）。

## 关键决策

- **双端 sanitize**：`src/shared/prompt-delivery.ts` 是唯一允许进入 trace 的字段边界；server 对客户端事件按 `source: "client"` 重新清洗，客户端无法伪造 `server.*`/`queue.*` phase，也无法写入 prompt 正文、图片、token、session path。
- **不记录原始错误文本**：bridge ack 的 `error` 文本可能包含模型侧回显，因此 trace 只写固定码 `bridge-failed`；`server.error` 只写 `errorCode` + `errorClass`。
- **人工重试必须换 requestId**：`PiCommandQueue.enqueue` 按 requestId 去重（防止浏览器 HTTP 重试双发），所以复用旧 id 的手动重试会被静默吞掉；重试改为新 requestId + `attempt + 1`。
- **投递错误与 chat 加载错误分离**：`ChatView` 的 `error` 会被 1.5s 轮询成功回调清空，新增独立的 `deliveryError` 才能在失败后持续可见。
- **队列过期巡查独立定时器**：原 30 分钟 upload 清理顺带执行队列清理，会让 60s TTL 的过期最迟 30 分钟才可见；拆出 15s 定时器（upload 清理仍 30 分钟）。
- **文件位置**：默认 `$TMPDIR/herzi-<uid>/prompt-delivery.jsonl`（`HERZI_TRACE_DIR` 可覆盖），与既有 image upload 目录约定一致，不写入用户 home 或仓库。
- **未改 styles.css**：按范围约束，投递状态行的两个按钮使用内联样式，样式统一留给集成阶段处理。

## 实际改动

新增：

- `src/shared/prompt-delivery.ts` + `src/shared/prompt-delivery.test.ts`
- `src/server/prompt-delivery-trace.ts` + `src/server/prompt-delivery-trace.test.ts`
- `src/web/promptDeliveryTrace.ts` + `src/web/promptDeliveryTrace.test.ts`
- `src/web/components/ChatView.test.tsx`
- `docs/prompt-delivery-observability.md`

修改：

- `src/shared/protocol.ts`（trace 类型 + WS 消息）
- `src/server/pi-command-queue.ts`（lifecycle 回调）与其测试
- `src/server/index.ts`（trace 实例、prompt 路由阶段记录、两个新路由、WS 广播、15s 队列巡查、关闭时 flush）
- `src/web/components/ChatView.tsx`（投递状态、失败气泡与操作、reconciliation 记录）
- `src/web/App.tsx`（WS 转发，经授权）
- `docs/README.md`、`docs/development-log.md`（索引与变更记录）

## 验证结果

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm run typecheck` | PASS | `tsc --noEmit` 无输出 |
| `npm test` | PASS | 10 files / 47 tests（新增 5 个测试文件，含 17 项新用例） |
| `npm run build` | PASS | `dist/web` 产出正常，仅既有 >500 kB chunk warning |

测试覆盖的关键不变量：

- sanitizer 丢弃 `text`/`images`/`token`/`sessionPath`，拒绝跨来源 phase 与非法 correlation id，clamp 客户端时间戳；
- trace 的 ring / 每请求 / LRU 边界、JSONL 轮转与启动时轮转、订阅者异常隔离、写失败不抛出；
- queue 生命周期事件顺序、失败只记录 `bridge-failed`、TTL 过期、observer 抛异常不影响入队；
- 客户端批量上报、未知字段剔除、批次有界、server 不可用时不丢缓冲；
- ChatView：失败气泡保留 + alert + 重试/复制、不会自动重发、手动重试用新 requestId、queued→expired 显示未确认、claimed→dispatched 后状态行消失。

NOT RUN：真实 Pi bridge claim/ack/expiry 在浏览器中的显示、真实 Herdr prompt 失败路径、`GET /api/prompt-delivery` 的真实数据核对。均需要用户授权的专用 synthetic Pane。

## 未决问题与风险

1. `queue.expired` 最长约 75s 才可见（15s 巡查 + 60s TTL）。若需要更快，可让 bridge poll 超时时主动回报，但那属于 bridge 协议改动，未在本轮实施。
2. `GET /api/prompt-delivery` 与既有 GET 一致未要求 request token；只监听 loopback 且不含正文，但是否要收紧为需要 token 未决定。
3. `host-path` / `text` 路径只有 `server.submitted`（Herdr 已接收），没有像 queue 那样的最终 ack；Pi 未落盘时仍无法判定“未确认”，需要日志证据后再决定是否扩展。
4. 投递状态按钮使用内联样式，等 `styles.css` 的并行改动集成后应统一为类名。
