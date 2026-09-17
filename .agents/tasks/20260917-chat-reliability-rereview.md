# Chat Reliability Re-review（第二轮复审）

- 状态：第二轮复审完成，结论已填写。
- 角色：只读 Code Review Agent（同一 Reviewer 继续）。
- 第一轮 findings：commit `7f75693`，记录在 `.agents/tasks/20260916-chat-reliability-review.md`。
- 本轮 candidate：`52027bb` = 第一轮 candidate `7f75693` + Worker B 修复 commit `3e7c5e5`。
- 开发者处置（方案 A）：F1、F2、F5 必须修复；F3 作为已知 contract 限制写入文档；F4、F6–F11、I1–I6（含 I2–I6）记为延后并由开发者明确接受。

## 复审目标

只核对“处置是否被真正落实”，并对新增改动做必要回归检查。不要重新发起第一轮已延后的项目，除非发现新增改动引入了新的阻断问题。

1. **F1 是否真正关闭**：并发 flush 场景下，终态事件（`client.response` / `client.error` / `client.reconciliation`）在 in-flight 请求结束后仍会被上报；新增回归测试是否能在回退修复后失败（可自行验证测试有效性，例如临时构造旧行为或在注释中给出证据）。
2. **F2 是否真正关闭**：
   - 过期事件的 `status`/`queueStatus`/`errorCode` 是否不再沿用过期前状态；
   - “从未被 claim”与“claimed 后 ack 丢失”是否可区分；
   - `client.delivery-status` 记录的 status 是否与 UI 实际显示一致；
   - UI 是否确实不再对 unacked 提供一键即发的重试（请核对真实代码路径，而非文档描述）。
3. **F5 是否真正关闭**：`rotate()` 失败时 `fileBytes` 是否不再被清零、上限是否仍然有效、失败是否可诊断。
4. **F3 文档是否准确**：`docs/prompt-delivery-observability.md` 中的 contract 限制描述是否与当前代码一致。
5. **延迟清单是否完整**：`.agents/tasks/20260916-prompt-delivery-observability.md` 的「Review 处置」是否覆盖 F4、F6–F11、I1–I6 并标注延后。
6. **修复是否引入新问题**：尤其 `queueLifecycleEvent` / `queueStatusToDeliveryStatus` 从 `src/server/index.ts` 迁出的重构是否改变了既有行为（含 `queue.enqueued` 是否仍按原规则不广播）。
7. **组合态回归**：Worker A（Markdown links）与 Worker B 组合后 typecheck / test / build 是否仍通过。

## 权限

- 不得修改任何产品代码、测试或现有文档。
- 只允许写入本文件（`.agents/tasks/20260917-chat-reliability-rereview.md`）并提交。
- 可以执行 `npm ci`、目标测试、`npm run typecheck`、`npm test`、`npm run build`。
- 不得运行 `npm run dev`，不得操作真实 Pi/Herdr 业务 Pane，不得 merge/rebase/push。
- 遇到产品决策或需要扩大权限时，直接向用户提问并等待。

## 复审结论

**没有发现新的阻断问题。F1 / F2 / F5 全部 CLOSED。**

| 项目 | 结论 | 关键证据 |
| --- | --- | --- |
| F1 客户端 trace 滞留终态事件 | **CLOSED** | `src/web/promptDeliveryTrace.ts:106-153`；新回归测试在旧实现下实测 FAIL（见 §F1） |
| F2 `queue.expired` 语义与 UI | **CLOSED** | `src/server/pi-command-queue.ts:207-224,307-340`、`src/web/components/ChatView.tsx:172-190,427-429,854-944`；模块级运行时复现 + 二次确认调用链核对（见 §F2） |
| F5 `rotate()` 失败清零计数 | **CLOSED** | `src/server/prompt-delivery-trace.ts:186-198`；新回归测试在旧实现下实测 FAIL（见 §F5） |
| F3 文档 contract | **文档与代码一致（CLOSED）** | `docs/prompt-delivery-observability.md` §9 逐条对照 `pi-command-queue.ts:112-115`、`index.ts:551`、`pi-command-queue.ts:225-228`（见 §F3） |
| 延后清单覆盖 | **完整** | 任务记录覆盖 F4、F6–F11、I1–I6（见 §延后清单） |
| 映射函数迁出重构的行为一致性 | **无行为回归** | `index.ts:58-68` 与 `7f75693` 逐字节相同；4 个既有 status 映射输出不变（见 §重构核对） |
| 组合态 typecheck / test / build | **PASS** | 11 files / 60 tests；见 §验证记录 |
| 本轮新观察 | 5 条，均为 Low/Info，非阻断 | 见 §本轮新观察 |

### 候选构成核对

- `git diff --stat 3e7c5e5 52027bb` 只列出 Worker A 的 7 个文件与任务文档，**没有** `src/`、`docs/`、`src/*.test.*` 中的 Worker B 文件差异，确认 `52027bb` 的修复内容与 `3e7c5e5` 完全一致（cherry-pick 无漂移）。
- `git show --stat 05af238` 只有 `.agents/tasks/20260917-chat-reliability-rereview.md`（35 行），非产品改动。

---

## F1 — CLOSED

**实现证据**

- `src/web/promptDeliveryTrace.ts:106-111`：`flushPromptDeliveryTrace()` 现在把 `inFlight` 设为 `drainPendingBatches()`。
- `:113-154`：`drainPendingBatches()` 用 `while (pending.length > 0)` 持续发送批次，每批成功后 `pending = pending.filter(...)`，因此**在途请求会继续消费在途期间新记录的事件**；失败时 `failureCount += 1` 并保留 `MAX_FLUSH_ATTEMPTS = 5`（`:17`、`:140`）的退避上限。
- `:141-153` finally 安全网：`inFlight = null` 后，若 `pending.length > 0 && failureCount === 0 && retryTimer === undefined && flushTimer === undefined` 则补排程一次 300ms flush，覆盖“最后一次循环判断之后、`inFlight` 置空之前”记录的竞态事件。

**运行时验证（真实定时器，真实模块，非只看测试）**

用 `/tmp/rev2/f1-recheck.mts` 重跑第一轮完全相同的复现脚本（第一次 POST 用可控 Promise 挂起，其结束后**不再记录任何新事件**）：

```
posts: 2 [[...client.submit...], [...client.response...]]
terminal event delivered without a new event? true
```

第一轮同一脚本的输出是 `posts: 1` / `false`（见第一轮 findings F1 证据），即终态事件当时被滞留、只有新事件才能解开；现在不依赖任何后续事件即被上报。

**回归测试有效性（临时回退验证，已完全恢复）**

- 临时把 `flushPromptDeliveryTrace` 回退为第一轮的单次发送实现（仅本地编辑，未提交；见本文件 §验证记录说明），运行 `npx vitest run src/web/promptDeliveryTrace.test.ts`：
  ```
  FAIL src/web/promptDeliveryTrace.test.ts > drains events recorded while a flush request is still in flight
  AssertionError: expected "vi.fn()" to be called 2 times, but got 1 times
   ❯ src/web/promptDeliveryTrace.test.ts:160:30
  Tests  1 failed | 3 passed (4)
  ```
  即该测试确实能抓住旧行为，不是自我实现式的空测试。
- 恢复后再跑：`Tests 4 passed (4)`；`git diff --stat` 为空、`git status --porcelain` 为空（见 §验证记录）。

**F1 残余（第一轮已记录的延后项，未扩大）**：页面卸载时 `pending` 仍会丢失（F7）；POST 成功但响应丢失时，重试会造成同一批 trace 事件重复上报（第一轮 I2 同类，未变）；`drainPendingBatches` 没有迭代次数上限（只有“每批 20 条 + 服务端持续 200 + 持续产生新事件”才可能长时间循环，理论性风险，不构成阻断）。

---

## F2 — CLOSED

### 1) 服务端事件形状不再沿用过期前状态，两类过期可区分

- `src/shared/protocol.ts:199-204`：`PromptQueueStatus` 新增 `"expired"`。
- `src/shared/prompt-delivery.ts:57-63`：`PROMPT_QUEUE_STATUSES` 同步加入 `"expired"`（否则 sanitizer 会丢弃该字段值）。
- `src/server/pi-command-queue.ts:205-224`：`cleanup()` 对 `queued` 与 `claimed` 分别发 `queue.expired`，`queueStatus` 一律传 `"expired"`，`errorCode` 分别为 `queue-expired-unclaimed` / `queue-expired-unacked`（此前传的是过期前的 `queued` / `claimed` 且无 errorCode）。
- `src/server/pi-command-queue.ts:307-340`：`queueLifecycleEvent` 与 `queueStatusToDeliveryStatus` 迁出 `index.ts` 并导出；`expired → delivery-unconfirmed`（`:335-336`）。

**模块级运行时复现**（真实 `PiCommandQueue` + 真实 `queueLifecycleEvent` + 真实共享 sanitizer，见 `/tmp/rev2/f2-shape.mts`）：

```
== unclaimed ==
lifecycle: {"phase":"queue.expired",...,"queueStatus":"expired","errorCode":"queue-expired-unclaimed"}
trace   : {...,"status":"delivery-unconfirmed","errorCode":"queue-expired-unclaimed","queueStatus":"expired",...}
recorded (sanitizer kept it): true

== unacked ==
lifecycle: {"phase":"queue.expired",...,"queueStatus":"expired","errorCode":"queue-expired-unacked"}
trace   : {...,"status":"delivery-unconfirmed","errorCode":"queue-expired-unacked","queueStatus":"expired",...}
recorded (sanitizer kept it): true
```

两点由此确认：**（a）**`status` 不再读作 `claimed`/`queued`，两类原因由 `errorCode` 区分；**（b）**事件能通过 sanitizer（因此会真正落 trace 并经 `index.ts:59-66` 广播到前端），不是“只改了类型但会被清洗掉”。

### 2) `client.delivery-status` 与 UI 状态一致

- `src/web/components/ChatView.tsx:427`：改记 `deliveryTraceStatus(nextState)`（UI 状态）而不是 `event.status`/`queueStatus`；`:428-429` 同时转发 `queueStatus` 与 `errorCode`，因此 `expired` 与 `unacked` 语义不丢。
- `:154-170`：`deliveryTraceStatus` 对 `unacked`/`unconfirmed` 都返回 `delivery-unconfirmed`，与 UI 的“回执丢失（可能已送达）”/“未确认送达”在 delivery 状态粒度上一致，两种原因由 `errorCode` 区分。
- 测试覆盖：`src/web/components/ChatView.test.tsx:329-343` 断言上传批次里该 requestId 的 `client.delivery-status` 为 `{status:"delivery-unconfirmed", queueStatus:"expired", errorCode:"queue-expired-unacked"}`，并显式断言 `status === "claimed"` **不存在**；`:387-397` 覆盖 never-claimed 的同类断言。

### 3) UI 是否真的不再一键即发地重试（按真实调用链核对，不采信文档/commit message）

调用链（唯一发送路径）：

1. `src/web/components/ChatView.tsx:857`：`actionable = state === "failed" || state === "unconfirmed"` —— **`unacked` 不在其中**，所以 `failed`/`unconfirmed` 专用的第一段（含直接 `重试`）不会渲染。
2. `:858-859`：`maybeDelivered = state === "unacked"`；`confirming = maybeDelivered && actions.confirmingMessageId === info.messageId`。
3. `:902`：`unacked` 渲染第二段；未确认时（`:923-941`）只有 `重试…` → `actions.requestRetryConfirmation(info.messageId)`（`:928`）。
4. `:707`：`requestRetryConfirmation` 只执行 `setConfirmingRetryId(messageId)`，**没有任何网络调用**。
5. 只有 `confirming === true` 时（`:904-922`）才渲染 `确认重复发送`，其 `onClick`（`:910`）调用 `actions.retry(info.messageId)`。
6. `:706` `retry` → `:647` `retryPendingMessage` → `:669` `deliverPrompt` → `:498` 唯一的 `POST /api/panes/:paneId/prompt`。
7. 另一处 `actions.retry` 调用点是 `:887`，位于第 1 步的 `actionable` 分支内，`unacked` 不可能进入。

补充核对：`grep -rn "deliverPrompt\|/prompt\`" src/web` 显示 `deliverPrompt` 只有 `:636`（`onNew`）与 `:669`（重试）两个调用点；全仓库没有第二条向 `/prompt` 发请求的路径，也没有全局快捷键/自动重试。

测试对这条性质的锁定：`src/web/components/ChatView.test.tsx:311-325` —— 点击 `重试…` 后 `expect(promptCalls()).toHaveLength(1)` 且出现“重试会重复发送这条消息”；点 `取消` 后仍为 1；再次 `重试…` + `确认重复发送` 后才变为 2。该断言能在“恢复一键重试”时立即失败，属有效回归测试。

**结论**：F2 的四条子项全部落实，**CLOSED**。

---

## F5 — CLOSED

**实现证据**

- `src/server/prompt-delivery-trace.ts:186-198`：`rotate()` 只在 `rename` 成功时 `this.fileBytes = 0`；失败进入 catch，先 `this.onWriteError?.(error)`（可诊断），再 `writeFile(this.filePath, "", { mode: 0o600 })` 截断后才把计数归零。计数与真实文件大小重新一致，2 MiB 上限不再失效。
- `:172-176`：`prepareFile()` 对超大既有文件的轮转包了 `.catch(() => undefined)`，启动不会因为轮转失败而失败（写失败仍经 `appendLine` 的 catch 走 `onWriteError`，`:155-163`）。
- `src/server/index.ts:50-55` 已提供 `onWriteError`（写入 `app.log.warn`），所以失败可见。

**回归测试有效性（临时回退验证，已完全恢复）**

把 `rotate()` 临时回退为第一轮的 `rename(...).catch(() => undefined); this.fileBytes = 0;`，运行 `npx vitest run src/server/prompt-delivery-trace.test.ts`：

```
FAIL src/server/prompt-delivery-trace.test.ts > keeps the size cap when rotation fails instead of resetting the counter
AssertionError: expected 0 to be greater than 0
 ❯ src/server/prompt-delivery-trace.test.ts:161:27
 Tests  1 failed | 9 passed (10)
```

旧实现下 `onWriteError` 从不触发（`errors.length === 0`），且后续断言的文件大小上限也已被破坏；恢复后 `Tests 10 passed (10)`。

**F5 的取舍说明**：轮转失败时降级为“截断 + 报警”，会丢失更早的 JSONL 内容（内存 ring/LRU 不受影响）。这是有意的、已被 `:191-193` 注释与 `docs/prompt-delivery-observability.md` §8 明确记录的取舍，不是静默行为。

---

## F3 文档与代码一致性核对 — 文档准确

逐条对照 `docs/prompt-delivery-observability.md` §9：

| 文档陈述 | 代码事实 | 结论 |
| --- | --- | --- |
| `enqueue()` 命中 `requestCommands` 时无条件返回旧 command（不含 status） | `src/server/pi-command-queue.ts:112-115`（无状态判断） | 一致 |
| `pi-native` 分支硬编码 `{ transport: "pi-native", status: "queued" }` | `src/server/index.ts:547-553`（`status: "queued"` 在 `:551`） | 一致 |
| 已 `failed` 的命令在窗口内仍会被去重命中 | `cleanup()` 只在 TTL 后删除命令与映射（`:225-228`），failed 命令在此期间仍在 `commands` | 一致 |
| 终态命令不会补发事件 | `cleanup()` 只对 `queued`/`claimed` 发 `queue.expired`（`:207-224`） | 一致 |
| 已 `expired` 的命令不在此列（重发会新建） | 同一循环内删除命令与 `requestCommands` 映射（`:225-228`） | 一致 |
| 当前 UI 不可达（每次尝试均新 UUID） | `ChatView.tsx:654`（`retryPendingMessage`）、`:596`（`onNew`）均为 `crypto.randomUUID()` | 一致 |
| 相关取舍：响应丢失 + 手动重试会产生内容级双发 | `retryPendingMessage` 换新 requestId（`:654-658`、`:659-665`），服务端无内容幂等 | 一致 |

结论：**F3 文档描述与当前代码一致，无夸大或遗漏**。

## 延后清单核对 — 覆盖完整

`.agents/tasks/20260916-prompt-delivery-observability.md` 的「Review 处置 → 延后（本轮不实现）」逐条覆盖第一轮 findings：F4、F6、F7、F8、F9、F10、F11、I1、I2、I3、I4、I5、I6（共 13 条 = 7 个 Low + 6 个 Informational），并逐条写明“延后”与原因：

- F4（fingerprint 归属）、F6（0600 只在创建时生效）、F7（无 unload flush）、F8（迟到 expired 留下 alert）、F10（imageExpiresAt TTL）、F11（`.user-delivery*` 无 CSS）——全部标注延后。
- F9 标注为“部分保留”：映射函数抽出并可测（本轮已实现），路由/dedupe 测试仍延后 —— 与当前事实一致（`grep -rn "server/index" src/ --include=*.test.*` 仍为空，没有任何测试导入 `src/server/index.ts`）。
- I4 标注“部分处理：删除了重复映射 `deliveryTraceStatusForQueue`，两处映射保留” —— 与代码一致（`grep` 无 `deliveryTraceStatusForQueue` 残留，`queueStatusToDeliveryStatus` 与 `deliveryTraceStatus` 各留一处）。

未发现漏项。第一条 findings（F1/F2/F3/F5）的其它内容也在表中标注为已修/已写入文档。

## 重构核对：映射函数迁出 `index.ts` 是否改变既有行为 — 未改变

1. **调用点逐字节相同**：`git show 7f75693:src/server/index.ts` 与当前 `src/server/index.ts:56-68` 的回调完全一致（`promptTrace.record(queueLifecycleEvent(event))` 先记录，然后 `if (recorded && recorded.phase !== "queue.enqueued") broadcast(...)`）。
2. **`queue.enqueued` 仍然“只记录、不广播”**：`src/server/index.ts:59-60`；同时确认该事件仍能被 sanitizer 接受并落 trace（`/tmp/rev2/f2-shape.mts` 输出 `enqueued sanitized: {...}`），与第一轮语义一致。
3. **映射输出对既有值不变**：`queueStatusToDeliveryStatus` 的 `dispatched/claimed/failed/default(queued)` 分支与第一轮实现文本一致，仅新增 `case "expired"`（`src/server/pi-command-queue.ts:328-339`）；运行时 dump：`queued→queued, claimed→claimed, dispatched→dispatched, failed→failed, expired→delivery-unconfirmed`。
4. **`at` 语义不变**：新签名 `queueLifecycleEvent(event, at = Date.now())`（`:307-309`），`index.ts:59` 仍以单参数调用，因此 `at` 仍在调用时刻取值；只有在测试里显式传值时才可注入。
5. **无循环依赖 / 无运行时副作用**：`pi-command-queue.ts:1-8` 对 `shared/protocol.js` 使用 `import type`（编译期擦除），未引入运行时 import 环。
6. **唯一消费者**：`grep -rn "queueLifecycleEvent\|queueStatusToDeliveryStatus" src/` = `index.ts:31,59` + `pi-command-queue.test.ts`；无其它调用点，无旧函数名残留。

## 组合态回归 — PASS

- `npm run typecheck`：PASS（`tsc --noEmit` 无输出）。
- `npm test`：PASS，**11 files / 60 tests**（第一轮组合态为 11 / 54；本轮 +6：F1 回归 1、F5 回归 1、queue 过期形状与映射 2、ChatView 两类过期 2）。
- `npm run build`：PASS（server + web；仅既有 >500 kB chunk warning）。
- Worker A 的 `markdownLink.tsx` / `markdownPlugins.ts` / `styles.css` / `markdownLink.test.tsx` 在本轮修复 commit 中未被触碰（`git diff --stat 7f75693 52027bb` 不含它们），修复与 Worker A 无文件交集。

## 本轮新观察（均为非阻断）

**N1（Low，混合版本窗口内的 fail-open 映射）** — `src/web/components/ChatView.tsx:186` 只用 `event.errorCode === "queue-expired-unacked"` 判定 `unacked`，其余一切 `queue.expired` 都落到“未确认送达 + 一键重试 + 提示‘Pi 没有认领这条命令’”。当浏览器加载了**新前端 bundle 但服务端仍是旧进程**（`src/web/api.ts:33-35` 明确容忍这种混合状态，`index.ts` 也按请求实时读盘提供 `dist/web`）时，旧服务端会发 `queueStatus: "claimed"`、无 `errorCode` 的 `queue.expired`，新前端就会把它显示成“Pi 没有认领”、并给出一键重试 —— 正是 F2 想消除的误导。当前候选的服务端总会带 `errorCode`，所以不影响本轮判为 CLOSED；建议把默认值改为安全侧（例如 `queueStatus === "expired"` 且 `errorCode !== "queue-expired-unclaimed"` 即按 `unacked` 处理），这样未来新增错误码也不会 fail-open。

**N2（Info，`queue.dispatched` 的 trace 状态改为 UI 值）** — 由于 `ChatView.tsx:427` 现在统一用 UI 状态，`queue.dispatched` 对应 `nextState = "sent"`，trace 里记录的 `status` 从第一轮的 `"dispatched"` 变为 `"submitted"`（`deliveryTraceStatus`，`:160-161`）。队列事实仍由 `queueStatus: "dispatched"` 保留，不算信息丢失，但按 `status === "dispatched"` 过滤 `client.delivery-status` 的消费者会看不到该信号。若希望完全无歧义，可在文档里点明“client.delivery-status 的 status 字段是 UI 投递状态，队列事实看 queueStatus/errorCode”。

**N3（Info，轮转失败降级会丢历史 JSONL）** — `src/server/prompt-delivery-trace.ts:190-197`：rename 失败时截断整个 JSONL，只保留内存 ring/LRU。已在代码注释与 docs §8 声明，但集成后若要长期留存 trace，需要知道“轮转失败 = 历史文件内容丢失”。同时 F6 的 0600 只在创建时生效的说明仍然成立（`writeFile(..., {mode:0o600})` 对已存在文件同样不改权限）。

**N4（Info，状态联合类型重复定义）** — `src/server/pi-command-queue.ts:54-59` 新增导出类型 `PiCommandQueueStatus`，与 `src/shared/protocol.ts:199-204` 的 `PromptQueueStatus` 结构完全重复，需要人工保持同步；`queueLifecycleEvent` 正是依赖二者“碰巧同形”才能把 `event.queueStatus` 赋给 `PromptDeliveryEvent.queueStatus`。这个重复在第一轮就存在（当时是内联字面量联合），本轮只是给它起了名字，建议后续改为从 shared 引入同一类型。

**N5（Info，二次确认按钮的命中位置，未在真实浏览器验证）** — `ChatView.tsx:923-941`（`[重试…][复制内容]`）与 `:904-922`（`[警告文本][确认重复发送][取消]`）在同一行的不同分支渲染。快速双击 `重试…` 时，第二次点击落在重新渲染后的哪个元素取决于布局；在 jsdom 测试里无法覆盖，真实浏览器中若“确认重复发送”恰好落在原位置，则存在“双击即确认”的可能。因 `.user-delivery*` 无 CSS（F11 延后），布局本身未定型。建议集成时把确认态改为竖直堆叠/独立区域，或让确认按钮带延迟启用。**本条为静态推断，未在浏览器验证（NOT RUN）**。

## 验证记录

环境：worktree `/Users/chiyizi/.herdr/worktrees/herzi/review-20260916-chat-reliability`，分支 `review-20260916-chat-reliability`，node v25.9.0 / npm 11.12.1，`node_modules` 沿用第一轮 `npm ci` 的锁文件安装结果（本轮未改依赖）。

| 命令 / 操作 | 结果 | 说明 |
| --- | --- | --- |
| `git diff --stat 3e7c5e5 52027bb` | PASS | 仅 Worker A 文件与任务文档差异，修复内容与 Worker B commit 一致 |
| `git show --stat 05af238` | PASS | 仅新增本轮任务文件 35 行 |
| `npm run typecheck` | PASS | `tsc --noEmit` 无输出 |
| `npm test`（组合态） | PASS | 11 files / 60 tests |
| `npm run build` | PASS | server + web，仅既有 chunk size warning |
| `npx vitest run src/web/promptDeliveryTrace.test.ts` | PASS | 4/4（修复态） |
| 临时回退 F1 后同上 | **FAIL（预期）** | `promptDeliveryTrace.test.ts:160` expected 2 calls, got 1 —— 证明回归测试有效 |
| `npx vitest run src/server/prompt-delivery-trace.test.ts` | PASS | 10/10（修复态） |
| 临时回退 F5 后同上 | **FAIL（预期）** | `prompt-delivery-trace.test.ts:161` expected 0 to be greater than 0 —— 证明回归测试有效 |
| `/tmp/rev2/f1-recheck.mts` | — | 真实定时器重跑第一轮 F1 复现脚本：`posts: 2`、终态事件在新事件到来前已上报 |
| `/tmp/rev2/f2-shape.mts` | — | 真实 `PiCommandQueue` + `queueLifecycleEvent` + sanitizer：两类过期形状与状态映射 dump |
| `git status --porcelain` | PASS | 复审结束时为空；两次临时回退均已用备份还原，`git diff --stat` 为空 |
| `grep -rn "server/index" src/ --include=*.test.*` | — | 无结果，确认服务端路由/dedupe 仍无测试（F9 延后项状态未变） |

临时回退说明：仅在两处 `src/**` 文件内做了**本地**临时改写以验证回归测试，随后立即用 `/tmp/rev2/*.bak` 还原；未提交、未留在仓库（`git status --porcelain` 与 `git diff --stat` 均为空），`/tmp/rev2` 为仓库外临时目录。

## NOT RUN / 剩余风险

- **NOT RUN**：真实 Pi pane / Pi bridge 的 claim→ack→expiry 在浏览器中的显示，真实 Herdr prompt 失败路径，`GET /api/prompt-delivery` 真实数据核对 —— 需要用户授权的专用 synthetic 环境；本轮仍未运行。
- **NOT RUN**：未启动任何服务（禁止 `npm run dev`，未占用 3030/5173 端口）；未做真实浏览器验收，因此 N5（双击命中位置）与二次确认的实际视觉布局未验证，F2 的 UI 结论来自 jsdom 测试 + 代码调用链。
- **NOT RUN**：F3 的 latent 场景（同 requestId 二次 POST 命中终态命令）没有做端到端运行时复现，结论来自代码路径核对；该场景 UI 不可达，属文档化 contract。
- 剩余风险（承接第一轮，均被开发者明确接受）：F3 去重响应不透明（文档化）；F4 fingerprint 失配；F6 JSONL 权限；F7 卸载丢批次；F8 迟到 expired 留下 alert（现在文案变为“回执丢失（可能已送达）”，机制未变）；F9 服务端路由/dedupe 无测试；F10 图片过期提示；F11 无 CSS；I1–I6。
- 本轮新增风险：N1（混合版本窗口内的 fail-open 映射，Low）、N5（双击确认，Info，未在浏览器验证）。
