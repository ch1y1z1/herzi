# Prompt 投递可观测性与无声丢失保护（Worker B 执行记录）

- 状态：首轮实现完成（commit `55839d5`），第二轮 Review 修复完成（F1/F2/F5 已修，F3 已写入文档，其余延后）；合成测试与构建 PASS；真实 Pi/Herdr Pane 写入式验收 NOT RUN，待用户授权。
- 角色：本批次 Worker B（`herzi_delivery`）。
- 范围：`src/web/components/ChatView.tsx`、新增窄范围 prompt delivery trace 模块、`src/server/index.ts`、`src/server/pi-command-queue.ts`、必要 shared type 与测试。经用户明确批准，额外最小改动 `src/web/App.tsx`（WS 消息转发）。
- Base worktree：`/Users/chiyizi/.herdr/worktrees/herzi/agent-20260916-prompt-observability`，branch `agent-20260916-prompt-observability`，base SHA `dd8cbe983c9f30bc795bc95209ddbac490b4b889`。
- Commit：首轮 `55839d5`；第二轮 Review 修复见文末“交付”。
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
| `npm test` | PASS | 第二轮后 10 files / 53 tests（首轮为 10 files / 47 tests） |
| `npm run build` | PASS | `dist/web` 产出正常，仅既有 >500 kB chunk warning |
| `git diff --check` | PASS | 无空白错误 |

测试覆盖的关键不变量：

- sanitizer 丢弃 `text`/`images`/`token`/`sessionPath`，拒绝跨来源 phase 与非法 correlation id，clamp 客户端时间戳；
- trace 的 ring / 每请求 / LRU 边界、JSONL 轮转与启动时轮转、订阅者异常隔离、写失败不抛出；
- queue 生命周期事件顺序、失败只记录 `bridge-failed`、TTL 过期、observer 抛异常不影响入队；
- 客户端批量上报、未知字段剔除、批次有界、server 不可用时不丢缓冲；
- ChatView：失败气泡保留 + alert + 重试/复制、不会自动重发、手动重试用新 requestId、queued→expired 显示未确认、claimed→dispatched 后状态行消失。

第二轮新增的不变量：

- `promptDeliveryTrace` 在 POST 在途期间记录的事件会被继续 drain（回归测试在修复前实测 FAIL）；
- `queue.expired` 的事件形状两类可区分（`queueStatus: "expired"` + `queue-expired-unclaimed` / `queue-expired-unacked`），且 `status` 不再沿用过期前状态；
- ChatView 的 `client.delivery-status` trace 状态与界面显示一致（过期时记 `delivery-unconfirmed`，不再记 `claimed`）；
- “认领后未 ack”需要二次确认才能重发，单击“重试…”不会触发请求；
- `rotate()` 失败时不再静默清零 `fileBytes`，上限保持有效且 `onWriteError` 可诊断（回归测试在修复前实测 FAIL）。

NOT RUN：真实 Pi bridge claim/ack/expiry 在浏览器中的显示、真实 Herdr prompt 失败路径、`GET /api/prompt-delivery` 的真实数据核对。均需要用户授权的专用 synthetic Pane。

## 未决问题与风险

1. `queue.expired` 最长约 75s 才可见（15s 巡查 + 60s TTL）。若需要更快，可让 bridge poll 超时时主动回报，但那属于 bridge 协议改动，未在本轮实施。
2. `GET /api/prompt-delivery` 与既有 GET 一致未要求 request token；只监听 loopback 且不含正文，但是否要收紧为需要 token 未决定。
3. `host-path` / `text` 路径只有 `server.submitted`（Herdr 已接收），没有像 queue 那样的最终 ack；Pi 未落盘时仍无法判定“未确认”，需要日志证据后再决定是否扩展。
4. 投递状态按钮使用内联样式，等 `styles.css` 的并行改动集成后应统一为类名。

## Review 处置（第二轮，Reviewer commit `7f75693`）

Reviewer 结论为“未发现阻断问题”。开发者确认按方案 A 处置：F1/F2/F5 必须修，F3 只写文档，其余延后。

### 已修复

| 编号 | severity | 处置 | 验证 |
| --- | --- | --- | --- |
| F1 | Medium | `src/web/promptDeliveryTrace.ts` 的 flush 改为持续 drain 直到 `pending` 为空或失败；`finally` 中补安全网（`pending` 非空且无 retry/flush timer 时补排程），并保留“连续 5 次失败后停止自动重试”的退避上限。新增可控挂起 Promise 的回归测试。 | PASS，回归测试修复前实测 FAIL（1 次 POST 而非 2 次） |
| F2 | Medium | 服务端：`PromptQueueStatus` 新增 `"expired"`，两类过期写不同 `errorCode`（`queue-expired-unclaimed` / `queue-expired-unacked`），`status` 统一为 `delivery-unconfirmed`，不再沿用过期前状态；把 `queueLifecycleEvent` / `queueStatusToDeliveryStatus` 从 `index.ts` 移到 `pi-command-queue.ts` 以使其可测。客户端：新增 `unacked` UI 状态（“回执丢失（可能已送达）”），`client.delivery-status` trace 改用 UI 实际状态（不再记 `claimed`）；`unacked` 的重试需要二次确认（`重试…` → `确认重复发送` / `取消`）并提示先查看 Terminal。 | PASS，服务端事件形状、状态映射、UI 两态、trace 一致性均有测试 |
| F5 | Low | `rotate()` 仅在 `rename` 成功时重置 `fileBytes`；失败时调用 `onWriteError` 并降级为截断，`prepareFile` 不让启动失败。新增“旋转目标为目录”的回归测试。 | PASS，回归测试修复前实测 FAIL（errors=0） |

### 已写入文档（不重构）

| 编号 | severity | 处置 |
| --- | --- | --- |
| F3 | Medium（latent contract） | 作为明确 API contract 限制写入 [`docs/prompt-delivery-observability.md`](../../docs/prompt-delivery-observability.md) §9：同 `requestId` 在 60s TTL 内二次 POST 命中终态命令时仍回 `status:"queued"`，客户端可能永远等不到终态；触发条件、当前 UI 不可达（每次尝试均新 UUID）、为何暂不修（属公开 HTTP 语义变更 + 引出“重试用旧 id”的产品决策）已逐条说明。 |

### 延后（本轮不实现）

| 编号 | severity | 状态 |
| --- | --- | --- |
| F4 | Low | 延后：相同内容两条 pending 时 fingerprint 归属错位，可能丢弃失败气泡并记录虚假 reconciliation。需改用 requestId/投递确认判定收敛，涉及 pending 收敛逻辑重做。 |
| F6 | Low | 延后：JSONL `0600` 只在首次创建时生效；已在文档 §8 诚实标注为契约说明。 |
| F7 | Low | 延后：缺少 pagehide/unload flush，最后一个批次可能随页面关闭丢失。 |
| F8 | Low | 延后：迟到的 `queue.expired` 可能为已 reconciliation 的消息留下不消失的 alert。 |
| F9 | Low | 部分保留：服务端路由与 dedupe 仍无测试（`src/server/index.ts` 在 import 期 `listen`，需注入式 build 重构）。本轮仅把 `queueLifecycleEvent` 状态映射抽到可测模块以满足 F2 的测试要求，路由/dedupe 测试继续延后。 |
| F10 | Low | 延后：`imageExpiresAt` 用发送前 1h TTL，可能误报“已过期”（实际 `markSubmitted` 后 TTL 延长）。 |
| F11 | Low | 延后：`.user-delivery*` 无 CSS（属 `styles.css` 并行 Worker 范围），集成时收口。 |
| I1 | Info | 延后：`GET /api/prompt-delivery` 无 token 校验（与现有 GET 一致）；是否收紧未决定。 |
| I2 | Info | 延后：批量上报部分非法时会先写入前 k−1 条再回 400，可能重复记录。 |
| I3 | Info | 延后：客户端 `console.debug` 无条件输出 metadata-only 事件。 |
| I4 | Info | 部分处理：删除了重复映射 `deliveryTraceStatusForQueue`，两处映射保留（server 一处、client 一处）；全部收敛到 shared 属延后项。 |
| I5 | Info | 延后：非法 `requestId` 被静默替换为随机 UUID（响应会回传服务端 requestId）。 |
| I6 | Info | 延后：`text`/`host-path` 无终态确认（已在文档 §8 标注为已知限制）。 |

### 范围说明

- 为满足 F2 “补服务端事件形状回归测试”的要求，把两个纯映射函数从 `src/server/index.ts` 移到 `src/server/pi-command-queue.ts` 并导出；未做其他重构，也未新增公开 HTTP 接口。
- F2 的 UI 产品决策采用“显式二次确认 + 重复发送警告”。理由：仍保留用户恢复能力（与首轮已确认的“失败气泡 + 手动恢复”一致），同时消除“一键即发、看起来安全”的误导；选另一方案（隐藏重试、提示切换到 Terminal）会降低可恢复性，故未采用。若需改为隐藏重试，只需删除 `unacked` 分支的按钮块。

## 交付（第二轮）

- commit：见最终回复（本文件在同 commit 内更新）。
- 修改文件：`src/shared/protocol.ts`、`src/shared/prompt-delivery.ts`、`src/server/pi-command-queue.ts`、`src/server/pi-command-queue.test.ts`、`src/server/prompt-delivery-trace.ts`、`src/server/prompt-delivery-trace.test.ts`、`src/server/index.ts`、`src/web/promptDeliveryTrace.ts`、`src/web/promptDeliveryTrace.test.ts`、`src/web/components/ChatView.tsx`、`src/web/components/ChatView.test.tsx`、`docs/prompt-delivery-observability.md`、本文件。
- 未 merge / rebase / push；未操作真实 Pi/Herdr Pane；未运行 `npm run dev`。
