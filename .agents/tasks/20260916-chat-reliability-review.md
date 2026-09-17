# Chat Reliability Review

- 状态：Reviewer 只读审查完成（findings 已填写）。
- 角色：只读 Code Review Agent。
- Candidate base：integration commit `83f76d6`（已包含 Markdown Worker）。
- Candidate addition：Worker B commit `55839d5`，在本 review branch 中 cherry-pick 为当前候选 commit。
- 正式 integration branch 尚未加入 Worker B；`main` 未修改。

## 审查范围

重点检查 Worker B 与组合后的候选结果：

1. prompt 是否仍可能无声丢失；
2. 手动重试、requestId 去重是否可能双发或吞消息；
3. queue 的 enqueued/claimed/dispatched/failed/expired 状态与 trace 是否一致；
4. client trace 批处理、并发 flush、重试是否会遗漏事件；
5. JSONL ring、LRU、轮转和关闭流程是否真正有界且 crash-safe；
6. 日志/API/WS 是否可能泄露 prompt、图片、token、绝对 session path、原始错误或私人数据；
7. GET/POST API、Origin/request token 和 loopback 边界是否合理；
8. optimistic message、失败保留、手动重试和 authoritative reconciliation 是否正确；
9. App WS state 是否会重复、遗漏或无界增长；
10. 测试是否覆盖实际实现，是否存在只验证 mock/自我实现的测试；
11. 约 2495 行改动是否存在不必要复杂度或回归风险；
12. Worker A 链接改动与 Worker B 组合后是否发生交互回归。

## 权限

- 不得修改任何产品代码、测试或文档正文。
- 只允许更新本 review 文件记录 findings，并提交该文件。
- 可以运行目标测试、`npm run typecheck`、`npm test`、`npm run build`；缺依赖可执行 `npm ci`。
- 不得运行 `npm run dev`，不得操作真实 Pi/Herdr 业务 Pane，不得 merge/rebase/push。
- 遇到产品决策或需要扩大权限时，直接在 Reviewer Pane 向用户提问并等待。

## 结论摘要

**未发现阻断问题（no blocker）**。候选可以进入集成流程，但建议先修 F1/F2，并在集成前重新评估 F3 的 API contract。

按严重程度排序：Medium ×3（F1–F3），Low ×8（F4–F11），Informational ×6（I1–I6）。

| 编号 | severity | 一句话 | 位置 |
| --- | --- | --- | --- |
| F1 | Medium | 并发 flush 时客户端 trace 事件会被长期滞留（已运行时复现） | `src/web/promptDeliveryTrace.ts:105` |
| F2 | Medium | `queue.expired` 沿用过期前状态，且"认领后过期"（很可能已送达）与"从未认领"不可区分，UI 反而鼓励重试 | `src/server/pi-command-queue.ts:186`、`src/server/index.ts:917,923-934`、`src/web/components/ChatView.tsx:187` |
| F3 | Medium | 同 requestId 的 POST 一律回 `status: "queued"`，即使该命令已 failed/dispatched；手动重试无服务端幂等校验 | `src/server/index.ts:538`、`src/server/pi-command-queue.ts:91` |
| F4 | Low | 相同内容两条 pending 时 fingerprint 归属错位，可能丢弃失败气泡并记录虚假 `client.reconciliation` | `src/web/components/ChatView.tsx:1453`、`:362` |
| F5 | Low | `rotate()` 失败仍把 `fileBytes` 归零，2 MiB 上限可能永久失效 | `src/server/prompt-delivery-trace.ts:182` |
| F6 | Low | JSONL 权限只在创建时生效，文档"0600"只在特定条件下成立 | `src/server/prompt-delivery-trace.ts:178` |
| F7 | Low | 无 pagehide/unload flush，最后一个批次随页面关闭丢失 | `src/web/promptDeliveryTrace.ts:71-98` |
| F8 | Low | 已 reconciliation 的 requestId 收到迟到的 `queue.expired` 会留下永不消失的 alert | `src/web/components/ChatView.tsx:439` |
| F9 | Low | 服务端路由与 dedupe 无测试；ChatView 测试 fixture 使用服务端不会产生的 `status`；批处理测试掩盖 F1 | 见正文 |
| F10 | Low | `imageExpiresAt` 用发送前 1h TTL，可能误报"已过期，请重新粘贴" | `src/web/components/ChatView.tsx:587`、`:887` |
| F11 | Low | `.user-delivery*` 无任何 CSS，状态只靠文字区分 | `src/web/components/ChatView.tsx:846`、`src/web/styles.css` |

---

## Findings

### F1（Medium）客户端 trace 在 flush 并发时滞留事件，终态事件可能永远不落盘

- **位置**：`src/web/promptDeliveryTrace.ts:105-107`（`if (inFlight) return inFlight;`）、`:123-132`（成功/失败后只改 `inFlight`，不再排程）、`:147-157`（`scheduleFlush` 在 `flushTimer` 已存在时不重复排程）。
- **触发条件**：一次 flush 的 POST 用时 > `FLUSH_DELAY_MS`（300ms，例如慢网络、服务端卡顿、token 403 重试）。期间记录的新事件会排程一个 flush 定时器；该定时器触发时 `inFlight` 仍非空，于是 `flushPromptDeliveryTrace()` 直接返回在途 promise，**不会重新排程**；在途 POST 完成后也没有补排程。
- **影响**：新事件留在 `pending`，直到"下一条事件被记录"或有人显式调用 `flushPromptDeliveryTrace()` 才会上报。若这批事件是本轮会话的最后一批（`client.response` / `client.error` / `client.reconciliation` 常常正是最后一批），服务端 trace 会永久缺失终态；页面在滞留期间关闭则彻底丢失（与 F7 叠加）。这恰好削弱本次改动的核心目标——"HTTP 200 隐藏投递失败"在 trace 里仍然看不到终态证据。
- **证据（运行时复现，非静态推断）**：用仓库真实模块 `src/web/promptDeliveryTrace.ts` 写临时脚本（`/tmp/herzi-review-repro/strand.mts`，未写入仓库），stub `fetch` 让第一次 POST 挂起：
  ```
  posts before release: 1
  posts after release: 1 [[{"phase":"client.submit", ...}]]
  second event delivered? false        // client.response 全程未上报，等待 1.2s
  posts after a new event: 2           // 记录 client.error 后才连带上报
  ```
  即：在途 POST 结束 1.2s 后，`client.response` 仍未发送，只有新事件才能解开。
- **建议方向**：在 `finally` 中（或定时器回调里）若 `pending.length > 0` 且无 `retryTimer`，补排程一次 `scheduleFlush(RETRY_DELAY_MS)`（更简单：把 flush 实现成"持续 drain 直到 pending 为空或失败"的循环）；并增加一个用可控 Promise（非 mock 立即 resolve）复现"in-flight + timer 竞争"的回归测试。

### F2（Medium）`queue.expired` 的 status/queueStatus 语义与 UI 状态不一致，且两类过期不可区分

- **位置**：`src/server/pi-command-queue.ts:185-187`（`emitLifecycle(commandId, "queue.expired", queued.status)`）、`src/server/index.ts:908-921`（`queueLifecycleEvent`）与 `:923-934`（`queueStatusToDeliveryStatus`）、`src/web/components/ChatView.tsx:177-192`（`pendingStateForQueuePhase` 把所有 `queue.expired` 映射为 `unconfirmed`）、`:412`（用 `event.status` 写入 `client.delivery-status`）。
- **触发条件**：(a) bridge 从未 poll（`queueStatus:"queued"`）；(b) bridge 已 poll/claim，但 ack 没到达服务端——bridge 侧 `acknowledgeCommand` 吞掉一切错误（`integrations/pi/extensions/herzi-bridge.ts:227-241`），且服务端 `ack` 要求 `claimedBy === identity.runtimeId` 且 sessionPath 一致（`src/server/pi-command-queue.ts:148-156`），而 `runtimeId` 是 bridge 进程级随机值（`integrations/pi/extensions/herzi-bridge.ts:118`），因此 bridge 重启或 sessionPath 变化后，旧 claim 的 ack 会返回 409，命令必然走到过期。60s TTL + 15s 巡查后触发。
- **影响**：
  1. trace 事件是 `phase: "queue.expired"` + `status: "claimed"` + `queueStatus: "claimed"`（或两者 `"queued"`），`errorCode` 缺失。只读 `status` 的消费者会把"已过期"读成"仍在投递中"，"未投递"这个结论只能靠 phase 猜。
  2. 客户端 `client.delivery-status` 直接复用 `event.status`，于是 trace 里记 `status: "claimed"`，而同一时刻 UI 显示 `未确认送达`，同一条 requestId 上自相矛盾，违背 `deliveryTraceStatus(state)` 自身的映射意图。
  3. 影响最大的不是 trace 而是 UI：case (b) 的语义是"Pi 很可能已经收到并写入了消息，只是回执丢了"，但 UI 与 case (a) 一样给出 `未确认送达` + 醒目的`重试`按钮。用户点重试就会**真的再投递一次**，即本次改动刻意避免的双发，反而被这个提示引导出来。
- **证据（运行时复现）**：用真实 `PiCommandQueue` 驱动 claim 后不 ack，再把时钟推快 61s 执行 `cleanup()`：
  ```
  trace event would carry: { phase: 'queue.expired', queueStatus: 'claimed', status: 'claimed', errorCode: undefined }
  never-claimed trace event would carry: { phase: 'queue.expired', queueStatus: 'queued', status: 'queued' }
  ```
  另外现有测试 `src/web/components/ChatView.test.tsx:175-183` 的 fixture 直接写 `status: "delivery-unconfirmed"`，而服务端对该 phase **永远不会**产生这个 status，测试因此看不到这处不一致（见 F9）。
- **建议方向**：让生命周期事件把过期表达完整——例如 `PromptQueueStatus` 增加 `"expired"`，或 `queueLifecycleEvent()` 对 `queue.expired` 写 `status: "delivery-unconfirmed"` 并区分 `errorCode: "queue-expired-unclaimed"` / `"queue-expired-unacked"`；客户端据此把 case (b) 的文案/操作降级（例如不直接给"重试"，或提示"可能已送达，重试会重复发送"），并让 `client.delivery-status` 记录 UI 实际状态而不是服务端原始 status。

### F3（Medium）同 requestId 的 prompt 请求一律回 `status:"queued"`，去重结果不透明；手动重试缺少服务端幂等校验

- **位置**：`src/server/index.ts:538-554`（enqueue 后硬编码 `{ transport: "pi-native", status: "queued" }`）、`src/server/pi-command-queue.ts:91-93`（`enqueue` 命中 `requestCommands` 时无条件返回旧 command）、`src/web/components/ChatView.tsx:636-660`（`retryPendingMessage` 固定换新 requestId）。
- **触发条件（latent，当前 UI 不可达）**：若某个 requestId 在 60s TTL 内被第二次 POST（未来客户端、脚本调用、或将来"复用 requestId 更安全"的重构）：
  - 旧 command 已经 `failed`：路由仍回 `{status:"queued"}`，而 `queue.failed` 早已广播完毕、不会重发（`cleanup()` 也不会为 failed 命令补发任何事件，`src/server/pi-command-queue.ts:183-192`），客户端只能停在 `等待 Pi 接收…`，**永远等不到失败**——即"HTTP 200 掩盖未投递"在原路径上被修好、在去重路径上又被重新引入；trace 也无法闭环。
  - 旧 command 已 `dispatched` 或仍处于 `claimed`：同样回 `"queued"`，只能靠后续事件（不可能再有）或 transcript reconciliation 兜底。
  - 旧 command 仍 `queued`：此处行为正确（这正是去重目的）。
  - 已 `expired` 的 command 不在此列：`cleanup()` 在发出过期事件的同时删除了命令与 requestId 映射，重发会新建命令。
- **触发条件（可达，属于取舍而非缺陷）**：服务端已接受 prompt 但 HTTP 响应丢失（网络中断、休眠）时，客户端显示"未送达"，用户点`重试`即产生**内容级双发**：服务端对文本/内容没有任何幂等，只对 requestId 去重，而重试刻意换了新 id。
- **影响**：去重路径上的静默未投递 + 用户不可见失败（不可当前复现，但属服务端公开 contract 缺陷）；以及"响应丢失 → 重试"路径上的重复投递。
- **证据**：`enqueue()` 的返回路径不携带 command.status（`src/server/pi-command-queue.ts:91-93`），路由不检查返回值（`src/server/index.ts:538`）。对照 trace：`queue.*` 只在状态迁移时发一次（`src/server/pi-command-queue.ts:159-164`、`:186`），不存在重放。
- **建议方向**：`enqueue()` 返回 `{ command, deduped, status }`，路由据此返回真实 queue status（或对终态 requestId 返回 409 + 明确错误码），让客户端能区分"新入队/去重命中/已终态"；`重试` 前可先查 `GET /api/prompt-delivery?requestId=<old>`（已有接口，内存命中时可用）给出"服务端已有终态，重复发送可能重复投递"的提示。若暂不实现，请在文档中把"requestId 复用会静默 no-op"写成明确 contract 限制。

### F4（Low）相同内容的 pending 消息会让 reconciliation 错位，可能丢弃失败气泡并写入虚假 reconciliation

- **位置**：`src/web/components/ChatView.tsx:1453-1462`（`unmatchedPendingUserMessages` 用 `countUserMessages(...) <= authoritativeOccurrence`）、`:362-386`（reconciliation 记录 + 清 alert）、`:599-607`（`authoritativeOccurrence` 叠加 `unmatched` 计数）。
- **触发条件**：先发一条会失败的消息，再用**完全相同的内容**（同文本 + 同 sha256 图片）发第二条。两条 pending 的 `authoritativeOccurrence` 分别为 0 和 1；当权威 transcript 出现 1 条匹配消息时，保留条件是 `countUserMessages(...) <= authoritativeOccurrence`，于是第一条（1 > occ 0）不再保留而被移除，第二条（1 <= occ 1）继续保留。
  - 若失败的是第一条、成功的是第二条：**失败气泡被丢弃**（用户再也看不到那次的失败与重试入口），而保留的那条状态是 `sent`；同时 reconciliation effect 会为**失败**的 requestId 记一条 `client.reconciliation`，`status` 却是 `"failed"`——trace 上表现为"已失败的投递最终被 transcript 收敛"，是误导性证据。
  - 该路径在改动前不可达（旧实现失败即删除消息），是本轮"失败气泡保留"新增的可达组合。
- **影响**：失败记录丢失/错误归属；trace 出现"failed 却 reconciled"的假证据。因为内容确实已进入会话，用户意图基本得到满足，故定级 Low。
- **证据**：`authoritativeOccurrence` 与 `unmatched` 的计数关系见 `src/web/components/ChatView.tsx:599-607`；按该定义推演 occ=0/1 两条 pending 即可复现上述分支（未写测试复现，标记为 NOT RUN）。
- **建议方向**：用 requestId/投递确认而不是内容 fingerprint 判定 pending 收敛（例如 pi-native 收到 `queue.dispatched` 后可用 requestId 关联；或至少在 `delivery.state === "failed"` 时要求额外的权威副本才移除），并避免为从未 dispatch 成功的 requestId 记录 `client.reconciliation`。

### F5（Low）`rotate()` 失败仍把 `fileBytes` 归零，2 MiB 上限可能永久失效

- **位置**：`src/server/prompt-delivery-trace.ts:182-185`（`await rename(...).catch(() => undefined); this.fileBytes = 0;`）。
- **触发条件**：`rename` 失败（Windows 上目标 `.1` 已存在时 rename 会失败；POSIX 上 EACCES / EBUSY / 只读目录亦可能）。`prepareFile()`（`:165-173`）与 `writeLine()`（`:175-180`）都会走到这里。
- **影响**：`fileBytes` 被清零但文件实际内容仍存在，之后每累计约 2 MiB 就再尝试一次失败的轮转并再次清零，**JSONL 实际无界增长**；`只记录写失败并告警` 不会发生（rename 的错误被 catch 吞掉，`onWriteError` 不触发），属于静默失效。
- **证据**：代码路径如上；`prompt-delivery-trace.test.ts` 的轮转测试（`rotates the JSONL file so it cannot grow unbounded`）只在 rename 成功的环境下运行，无法覆盖该分支。
- **建议方向**：仅在 rename 成功时重置 `fileBytes`；失败时退化为截断/换用带序号的新文件名，或至少调用 `onWriteError` 让"上限失效"可见。

### F6（Low）JSONL 权限只在文件首次创建时生效，文档"文件权限 0600"表述不严谨

- **位置**：`src/server/prompt-delivery-trace.ts:178`（`appendFile(this.filePath, line, { mode: 0o600 })`）、`:166`（`mkdir(..., mode: 0o700)`）。
- **触发条件**：目标文件已存在（上一次运行、或 `HERZI_TRACE_DIR` 指向共享目录）时 `appendFile` 的 `mode` 被忽略；父目录已存在时 `mkdir` 的 `mode` 同样不生效、也不 chmod。
- **影响**：`docs/prompt-delivery-observability.md` §4 的"文件权限 0600"只在全新文件/目录下成立。内容本身是 metadata-only（无 prompt 正文/图片/session path），所以影响有限，属文档与实现的一致性问题。
- **证据**：Node 文档语义（`mode` 仅在创建文件时使用）——**未运行时验证**，标记为未查证级别：本次只做代码与文档比对（`docs/prompt-delivery-observability.md` §4 声称 0600）。
- **建议方向**：用 `open(path, "a", 0o600)` + `stat`/`fchmod` 修正过宽权限，或在文档中写明"仅在首次创建时设置"。

### F7（Low）缺少 pagehide/unload flush，最后一个批次随页面关闭丢失

- **位置**：`src/web/promptDeliveryTrace.ts:71-98`（记录后只靠 300ms 定时器）、`:105-133`（flush 入口，无 unload 钩子）。
- **触发条件**：刷新/关闭标签页时 `pending` 非空（记录后 300ms 内，或正处于失败退避/被 F1 滞留）。
- **影响**：本轮最"关键"的终态事件（`client.error`/`client.response`/`client.reconciliation`）最容易落在这一批里；与 F1 叠加会造成服务端 trace 长期缺终态。
- **证据**：全仓库无 `pagehide`/`beforeunload`/`visibilitychange` 相关处理（`grep` 结果为空）。
- **建议方向**：在 `pagehide` 用 `keepalive: true` 或 `navigator.sendBeacon` 发送当前批次（批 ≤20 条，体积很小）。

### F8（Low）迟到的 `queue.expired` 会为已 reconciliation 的消息留下永不消失的 alert

- **位置**：`src/web/components/ChatView.tsx:439-444`（`setDeliveryError` 不受 pending 是否仍存在约束）、`:362-386`（清除 alert 只发生在 pending item 命中 reconciliation 时）。
- **触发条件**：prompt 已 dispatch、transcript 已写入并被 reconciliation 移除气泡，随后（约 60–75s 后）同名 requestId 的 `queue.expired` 到达（即 F2 的 ack 丢失场景，或 ack 在 60s TTL 之后到达被 cleanup 删除而返回 409）。
- **影响**：顶部永久停留"未确认送达：requestId xxxxxxxx"，而该消息其实已在会话中；气泡已消失，用户既无法重试也无法消除该提示，只能靠下一次成功发送把它清掉。属可见的假告警。
- **证据**：代码路径如上；`deliveryError` 只在 `deliverPrompt` 成功、reconciliation 命中同一 item、或用户重试时被清空。
- **建议方向**：对已在 `reconciledRef` 中的 requestId 忽略后续 queue 事件（只写 trace、不设 alert）；或让 alert 自带关闭按钮/超时。

### F9（Low）测试覆盖与 fixture 漂移：服务端路径与去重逻辑完全未测

- **位置/证据**：
  1. 新增的两条服务端路由与 `queueLifecycleEvent` / `queueStatusToDeliveryStatus`（`src/server/index.ts:429-464`、`:908-934`）**没有任何测试**：全仓库唯一引用 `/api/prompt-delivery` 的测试文件只有客户端两个（`grep -rn "api/prompt-delivery" src/`）。原因是 `src/server/index.ts` 在 import 期就 `await app.listen({host:"127.0.0.1", port:3030})`（`:878`），无法在测试中安全引入——F3 的 dedupe 分支、批量事件部分写入后返回 400 的分支（`:445-464`）都因此无覆盖。
  2. `src/web/components/ChatView.test.tsx:175-183` 手写 `status: "delivery-unconfirmed"`，服务端对 `queue.expired` 实际产生的是 `"claimed"/"queued"`（F2），fixture 与真实输出不一致。
  3. `src/web/promptDeliveryTrace.test.ts:105-116` 用 `while` 手动连调 `flushPromptDeliveryTrace()` 来检查"不遗漏事件"，掩盖了 F1 的定时器/in-flight 竞争。
  4. ChatView 测试只断言 UI（DOM），没有任何断言检查 trace 上报内容；`deliveryEvents` 全部为手工构造，未由真实队列序列驱动。
  5. `src/server/prompt-delivery-trace.ts:136-139` 的 `subscribe()` 与 `src/web/promptDeliveryTrace.ts:100-103` 的 `recentPromptDeliveryEvents()`、`:136-145` 的 `resetPromptDeliveryTrace()` 只被测试使用（生产 `src/server/index.ts` 从不 subscribe），属长期死代码/测试专用导出。
- **影响**：本次最容易出错的代码（HTTP 路由、去重、状态映射）没有自动化防线；已发现的 F2/F3 都出现在这一空白区。
- **建议方向**：把 `queueLifecycleEvent`/`queueStatusToDeliveryStatus` 与路由的纯逻辑抽到可测模块（或让 `index.ts` 支持注入 `listen:false` build），补 3 个用例：dedupe 命中终态命令的响应、批量部分非法时的 400 语义、`queue.expired` 的真实事件形状；把 ChatView 的 `queue.expired` fixture 换成服务端真实形状。

### F10（Low）`imageExpiresAt` 使用发送前的 1h TTL，可能误报"已过期"

- **位置**：`src/web/components/ChatView.tsx:587-589`（`Math.min(...uploadedImages.map(u => u.expiresAt))`，来自上传响应，即 `createdAt + 1h`）、`:887-892`（`deliveryImageHint` 在超过该时刻后提示"图片附件已过期，请重新粘贴后再发送"）。
- **触发条件**：首发送失败且用户 1 小时后才点重试。
- **影响**：服务端在 `markSubmitted` 后会把 TTL 延长为 native 24h / fallback 30d（`src/server/image-upload-store.ts:192-199`、`:13-15`），此时重试其实仍可用，但提示让用户以为必须先重新粘贴（部分缓解："过期"仅提示，重试按钮仍可用）。属误导性文案，不影响正确性。
- **建议方向**：不要用上传响应里的 TTL 作为重发窗口；或把提示改成"重发可能失败"，并在 4xx `not-found/expired` 时再提示重新粘贴。

### F11（Low）`.user-delivery*` 无任何 CSS，状态差异只剩文字

- **位置**：`src/web/components/ChatView.tsx:846-885`（类名 `user-delivery` / `-line` / `-request` / `-error` / `-hint` / `-actions`）、`src/web/styles.css`（`grep -n "user-delivery" src/web/styles.css` 无结果；只有 `.chat-error`）。
- **触发条件**：任意失败/未确认消息。
- **影响**：`failed` / `unconfirmed` 与 `sending` / `queued` 在视觉上无区别（按钮靠内联样式），只剩 label 文本与顶部 `.chat-error` 承担区分。Worker 已在 `docs/prompt-delivery-observability.md` §8 与任务记录中声明样式延后，属已知取舍，这里记录以便集成时收口。
- **建议方向**：集成阶段统一为类名样式（含 `failed`/`unconfirmed` 的强调色），并移除内联样式对象。

---

## Informational

- **I1 访问边界**：`GET /api/prompt-delivery` 因 `preHandler` 直接放行 GET（`src/server/index.ts:81-88`、`:429-443`）而无 token/origin 校验；返回内容是 metadata-only，且响应无 CORS 头，跨站 JS 无法读取，与本仓库既有 GET（`/api/bootstrap`、`/api/chat`）一致。`/ws` 同样无 token/origin 校验，现在会额外收到 prompt-delivery metadata；由于它本就推送完整 chat 消息与终端帧，本次未引入新的泄露类别。是否收紧请按文档中的未决项决策，本审查不视为缺陷。
- **I2 批量部分写入**：`POST /api/prompt-delivery/events`（`src/server/index.ts:445-464`）逐条 record，遇到第 k 条非法时已写入前 k−1 条并返回 400；客户端把非 2xx 视为失败、保留整批重试，可能产生重复 trace 记录（事件无 id，服务端无去重）。有界且仅影响 trace 保真度。建议先全量校验再写入。
- **I3 控制台输出**：`src/web/promptDeliveryTrace.ts:86` 无条件 `console.debug` 每个事件（metadata-only），会在任意打开 app 的浏览器 devtools 中留下 requestId/paneId。建议加 dev 条件或移除。
- **I4 复杂度/重复映射**：同一组状态在服务端（`queueStatusToDeliveryStatus`）、客户端（`deliveryTraceStatus`、`deliveryTraceStatusForQueue`、`pendingStateForQueuePhase`、`DELIVERY_LABELS`）之间被映射 4 次，F2 的不一致正是这种多份映射的产物；建议把 queue→delivery→UI 状态的映射收敛到 `src/shared/prompt-delivery.ts` 一处。另有 F9.5 的无用导出/死代码可清理。
- **I5 requestId 契约变化**：原实现接受任意 ≤100 字符的 requestId，现在不满足 `isPromptCorrelationId` 时**静默替换**为随机 UUID（`src/server/index.ts:471-475`）；响应回传了服务端 requestId，但 `ChatView` 忽略 `body.requestId` 而使用本地值。当前无影响，仅在第三方调用时表现为"响应里的 requestId 与请求不同"。
- **I6 text/host-path 无终态确认**：该路径只有 `server.submitted`（Herdr 已接收），Pi 未落盘时无法判定"未确认"（Worker 记录在案，属已知限制，非本轮缺陷）。

## 验证记录

环境：worktree `/Users/chiyizi/.herdr/worktrees/herzi/review-20260916-chat-reliability`，分支 `review-20260916-chat-reliability`，node v25.9.0 / npm 11.12.1，依赖用 `npm ci` 按锁文件安装。

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `git status --porcelain` | PASS | 审查前/后均无未预期改动（仅 ignored 的 `node_modules/`、`dist/`） |
| `git diff --stat 55839d5 39b9423` | PASS | 两 commit 差异仅 Worker A 的 7 个文件，确认 cherry-pick 未引入内容漂移 |
| `npm ci` | PASS | 按 `package-lock.json` 安装，未改依赖版本 |
| `npm run typecheck` | PASS | `tsc --noEmit` 无输出 |
| `npm test` | PASS | 11 files / 54 tests（含 Worker A 的 markdownLink 与 Worker B 的 5 个新测试文件） |
| `npm run build` | PASS | server + web 构建成功，仅既有 >500 kB chunk warning |
| 临时脚本 `/tmp/herzi-review-repro/strand.mts` | — | 导入真实 `src/web/promptDeliveryTrace.ts`，复现 F1（未写入仓库） |
| 临时脚本 `/tmp/herzi-review-repro/queue-expired.mts` | — | 导入真实 `src/server/pi-command-queue.ts`，复现 F2 的事件形状（未写入仓库） |

组合回归检查（第 12 项）：Worker A（`markdownLink.tsx` / `markdownPlugins.ts` / `styles.css`）与 Worker B 修改文件集合无重叠；`UserMessage` 的 `data.by_name.delivery` 与 markdown 的 `a` renderer 走不同渲染分支，无交互；合并态 typecheck/test/build 全绿。**未发现组合交互回归**。

## NOT RUN / 剩余风险

- **NOT RUN**：真实 Pi pane / Pi bridge 的 claim→ack→expiry 端到端（含浏览器显示）——需要用户授权的专用 synthetic 环境；未运行。
- **NOT RUN**：真实 Herdr `agent.prompt` 失败路径与 `server.rejected` 各分支的运行时核对。
- **NOT RUN**：`GET /api/prompt-delivery` 的真实数据核对、真实 WS push 的端到端核对。
- **NOT RUN**：未启动任何真实服务（严格禁止 `npm run dev`；也未在 3030 端口起服务），因此所有 HTTP 行为结论均来自代码阅读，唯一运行时证据是上述两个不联网的临时脚本。
- **未运行时验证（仅按文档语义判断）**：F6 的 `appendFile` mode 行为。
- 剩余风险：
  1. 服务端 prompt 路由与 trace 上报路由无自动化测试（F9），集成后仍可能回归；
  2. `text` / `host-path` 通道只有 `submitted` 终态（I6），"Pi 是否落盘"仍不可判定；
  3. 手动重试在"响应丢失但服务端已接受"时会重复投递（F3 第二段），当前设计明确接受该取舍；
  4. trace 落在 `$TMPDIR`，重启即失（本地调试用途可以接受，但 `GET /api/prompt-delivery` 不能当作持久审计）；
  5. Worker B 的文档把 `npm test` 记为 "10 files / 47 tests"，那是其自身分支的数字；合并态为 11 files / 54 tests，非错误但集成时应更新记录。
