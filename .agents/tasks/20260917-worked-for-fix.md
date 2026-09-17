# Worker 任务契约：修 `Worked for` 提前出现与闪烁

- 状态：已派发
- 角色：Worker（单 Agent）
- Base：`b8f232b`（`main`，含工具展示增强）
- Branch：`agent-20260917-worked-for-fix`
- Worktree：`/Users/chiyizi/.herdr/worktrees/herzi/agent-20260917-worked-for-fix`
- 分析依据：`.agents/tasks/20260917-worked-for-premature-group-bug.md`（**先完整读**）

## 现象

1. turn 还在进行中（回答未结束）就出现了 `Worked for` 组；
2. 界面闪烁。

## 根因（已定位，勿重新调查）

- 分组是**二值**判定：`running === false` 就立刻把整轮收进 `Worked for`（`ChatView.tsx` 的 `combineAssistantTurn`）。
- `running` 有三个来源，全都有假阴性：
  - `chat.running` 只认 Herdr 的 `working`，**`blocked` 被当成"已结束"**（`src/server/index.ts:302`、`:316`；`ChatView.tsx:248`、`:284` 共 4 处各写了一遍 `agentStatus === "working"`）；
  - `realtime.status` 新建状态初值就是 `idle`（`src/server/pi-realtime.ts:127`），`session` 事件也会重置为 idle；
  - 持久化消息的 `status` 默认是 `complete`，永远不可能是 `running`，所以消息级兜底对已落盘内容无效。
- 闪烁的第二个来源与状态无关：`DisplayMessage.id` 是 `turn:${lastMessage.id}`（`ChatView.tsx:1488`），**turn 内每新增一条 assistant 消息，React key 就变一次**，整棵子树重挂载，既闪又重置展开状态。

> 注意：面板展开状态已经稳定（`work:${firstMessage.id}`，`panelOpenState`），**不要重做**；本任务只处理上面三条。

## 必须完成的三项

### F-B 单一判定 + `blocked` 视为未结束

- 建立**唯一**的 Pane 活跃判定（不要继续在 4 处各写一遍），语义为：
  `isPaneActive(status) = status === "working" || status === "blocked"`
- 用于 `src/server/index.ts:302`、`src/server/index.ts:316`、`ChatView.tsx:248`、`ChatView.tsx:284`。
- 因为 `src/server/index.ts` 在 import 期就 `listen(3030)`、无法在测试里引入，判定函数必须抽到**可测的独立模块/导出**（例如 `src/shared/pane-activity.ts`），并在那里做单测。

### F-A 单调（粘性）的 turn running 判定

- 为**最新的 turn**记录"曾观察到在运行"的粘性标记（按 turn 的稳定 id 记录）。
- 一旦置为 true，就保持 `turnRunning = true`，直到**同时**满足以下全部条件才折叠：
  1. `realtime.status === "idle"`（若该 Pane 没有 realtime，则用 `chat.running === false`）；
  2. 该 turn 内没有任何 `status.type === "running"` 的消息；
  3. Pane 不是 `blocked`（若前端能拿到 agentStatus）。
- 任一条件不满足 → 继续按"运行中"处理（**fail-open：宁可晚折叠**）。
- 粘性标记只作用于**最后一个 turn**；历史 turn 一律视为已结束，行为不变。
- 切换 Pane / 收到新 session 时清空该标记。

### F-C turn 使用稳定 React key

- `DisplayMessage.id` 由 `turn:${lastMessage.id}` 改为 **`turn:${firstMessage.id}`**，使 turn 内追加消息不再改变 key。
- 必须核实没有其它逻辑依赖旧值（面板 key 已独立；`convertMessage` 直接透传 message.id）。

## 允许修改的文件（write set）

- `src/server/index.ts`
- `src/web/components/ChatView.tsx`
- `src/web/components/ChatView.test.tsx`
- 新增的判定模块及其测试（例如 `src/shared/pane-activity.ts` + `src/shared/pane-activity.test.ts`）
- 你自己新增的前端状态模块及其测试（如需，例如 `src/web/turnActivity.ts`）
- 本任务记录

**禁止**：改 `styles.css`、改 `protocol.ts` 的既有字段语义、改 `toolCatalog.ts` / `panelOpenState.ts`、改 `pi-session-reader.ts`、新增 HTTP/WS 接口。若确有必要扩范围，先在 Pane 里问开发者。

## 禁止事项（通用）

- 不运行 `npm run dev`；不操作真实 Pi/Herdr 业务 Pane；不 merge / rebase / push。
- 不新增 production dependency，不引入 i18n 框架。
- 不为了让测试变绿而弱化断言。

## 验收条件（每条都必须有能证伪的测试）

1. **F-B 单测**：`working` → 活跃；`blocked` → 活跃；`idle` / `done` / `unknown` → 不活跃。
2. **F-A 组件测试**：构造"turn 曾运行 → 随后出现空窗（无 running 消息、`realtime.status` 变为 idle、未收到 settle）"的场景，断言**没有**渲染 `Worked for`；再补上 settle 信号后，断言**出现** `Worked for`。该测试在修复前必须失败。
3. **F-C 测试**：同一 turn 内追加一条 assistant 消息后，渲染出的 `[data-message-id]` 保持不变。
4. **回归**：既有 100 个测试全部继续通过；无压缩、非运行中的普通 turn 仍照常折叠成一段 `Worked for`。

## 必须运行的验证

```bash
npm ci            # 若 worktree 无 node_modules
npx vitest run <你改动涉及的目标测试>
npm run typecheck
npm test
npm run build
```

结果明确标记 `PASS` / `FAIL` / `NOT RUN`，并记录实际命令。真实浏览器视觉验收无法自行完成，标 `NOT RUN` 即可。

## 交付要求

- 一个或少量清晰 commit；不 merge / rebase / push。
- 更新本任务记录：实际改动、关键决策、命令与结果、未决问题。
- 结束后留在本 Pane，由开发者手动通知 Integrator 集成。

## 备注

- 新会话全局规则要求"过程中主动给阶段性文字更新"：请照做，但不要逐个工具调用报账。
- 界面文案中文硬编码，沿用现状。

---

## 执行记录（Worker，2026-09-17）

- 分支：`agent-20260917-worked-for-fix`；代码 commit：`eed99d9`（parent `514b48c`）。
- 状态：三项修复已实现并通过验证，等待开发者通知 Integrator 集成。

### 实际改动

1. **F-B 单一 Pane 活跃判定**
   - 新增 `src/shared/pane-activity.ts`：`isPaneActive(status) = status === "working" || status === "blocked"`，放在 `src/shared` 是因为 `src/server/index.ts` import 期即 `listen(3030)`，不可在测试中引入。
   - 四处内联判断全部替换为它：`src/server/index.ts:303`（`piSessions.read` 的 running）、`src/server/index.ts:317`（`emptyChatSnapshot`）、`ChatView.tsx:250`（初始 chat 状态）、`ChatView.tsx:286`（换 Pane 时重置 chat 状态）。
   - 新增 `src/shared/pane-activity.test.ts`（3 个用例）。
2. **F-A 单调（粘性）turn running 判定**
   - 新增 `src/web/turnActivity.ts`：`latestAssistantTurn()`（取线程末尾的 assistant run，语义与 `groupAssistantTurns` 的 `isLatestTurn` 一致）、`createTurnActivityTracker()`（粘性标记，按 turn 稳定 id + `paneId:runtimeId` 记录）、`useLatestTurnActivity()`（React 绑定）。
   - `ChatView.tsx` 中：`running`（composer/工作指示）改为 fail-open 的 "pane 忙" 信号；新增 `latestTurnRunning` 只喂给分组，`groupAssistantTurns` 的第二个参数更名为 `latestTurnRunning`。
   - 新增 `src/web/turnActivity.test.ts`（11 个用例：turn 识别 3 个 + tracker 8 个）。
3. **F-C 稳定 React key**
   - `ChatView.tsx:1510`：`DisplayMessage.id` 由 `turn:${lastMessage.id}` 改为 `turn:${firstMessage.id}`。
   - 已核实无其它逻辑依赖旧值：全仓仅 `docs/chat-tool-presentation-plan.md:160` 与 `src/web/panelOpenState.ts:4` 的注释提到旧值（均为文档漂移，见未决问题），`convertMessage` 直接透传 `message.id`，面板 key 一直独立用 `work:${firstMessage.id}`。
   - 新增 3 个组件测试（2 个 turn 活跃 + 1 个 message id）。

### 关键决策

- **折叠条件是必要条件，不是充分条件**：契约写的是"只有同时满足 realtime idle（或无 realtime 时 chat.running=false）、turn 内无 running 消息、Pane 非 blocked 才折叠"。实现按"必要条件"执行，因此额外把 `chat.running`（服务端 F-B 判定）与 `isPaneActive(pane.agentStatus)` 也当作"仍在运行"的证据，即使 realtime 存在且为 `idle`。理由是根因 R1.1/R1.2/R1.3：`realtime` 会被重置为初值 `idle`，若 realtime 优先级高于轮询，F-B 在 realtime 存在的场景下就完全不起作用。方向只会更晚折叠，符合"宁可晚折叠"。
- **验收条件 2 中"settle 信号"的解读**：空窗场景里 `realtime.status` 已是 `idle`、turn 内无 running 消息，因此让折叠条件不成立的只能是"Pane 未 settle"——测试用 `pane.agentStatus = "blocked"`（仍在等用户）作空窗，再切到 `"done"` 作 settle。两个新组件测试都验证了这一点（一个走 pane blocked，一个走轮询仍为 working 而 realtime 掉回 idle）。
- **粘性标记的诚实说明**：在现有信号集里，"所有来源都 idle 才释放"与"所有来源都 idle 才折叠"等价，所以标记本身不会在信号之外额外推迟折叠；它的作用是把 latch 及清理点（换 Pane、新 session、新 turn）显式化、可测试化，并 gate `settled` 观测（只有曾被观察到运行的 turn 才会报告 `settled`）。未观察到运行的普通 turn 行为与修复前完全一致。这是本次实现与契约措辞之间的已知偏差，已如实记录。
- `pane.agentStatus !== "done"` 的"标记已读"逻辑（`ChatView.tsx:341`、`src/server/index.ts:612`）与"是否在运行"无关，未改动。
- 未触碰 `styles.css`、`protocol.ts`、`toolCatalog.ts`、`panelOpenState.ts`、`pi-session-reader.ts`，未新增依赖，未新增 HTTP/WS 接口。

### 验证结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 依赖 | `npm ci` | PASS（worktree 原无 node_modules） |
| 目标测试（修复前） | `npx vitest run src/web/components/ChatView.test.tsx`（临时 `git checkout 514b48c -- <两处源码>` 后运行） | **预期失败，已复现**：3 个新测试全 FAIL（两组 `expected <span></span> to be null`，一组 `expected [ 'u1', 'turn:a2' ] to include 'turn:a1'`） |
| 目标测试 | `npx vitest run src/web/components/ChatView.test.tsx src/web/turnActivity.test.ts src/shared/pane-activity.test.ts` | PASS（32/32） |
| 类型检查 | `npm run typecheck` | PASS |
| 全量测试 | `npm test` | PASS（15 files / 117 tests；既有 100 个全部保留，新增 17 个） |
| 构建 | `npm run build` | PASS（仅有既存的 chunk >500 kB 警告） |
| 真实浏览器视觉验收 | — | **NOT RUN**（未运行 `npm run dev`，未操作真实 Pane，需开发者自行验收） |

未执行：`merge` / `rebase` / `push`；未修改依赖版本；未弱化任何断言。

### 未决问题（交 Integrator / 开发者裁决）

1. **文档漂移**：`src/web/panelOpenState.ts:4` 与 `docs/chat-tool-presentation-plan.md:160` 仍写 `DisplayMessage.id` 是 `turn:<last message id>`。前者在本次契约的禁止修改清单内，后者在我的 write set 之外，均未改动，建议集成时一并更新。
2. **粘性标记的语义取舍**（上文"关键决策"第 3 条）：如果评审认为标记必须在信号之外额外推迟折叠（例如要求"同 runtime 上观察到 realtime 从非 idle 回到 idle"才算 settle），需要新增前端可区分的 settle 事件或放宽既有测试，请先确认再改。
3. **Fail-open 的极端情况**：Pane 的 `agentStatus` 轮询 1.5s 且可能滞后；若某轮在"轮询/消息/realtime 全为 idle"时实际仍在跑，本轮仍会折叠（与修复前一致），契约接受"宁可晚折叠"但也接受不了"永远展开"，本次选择了信号集内的最小改动。

