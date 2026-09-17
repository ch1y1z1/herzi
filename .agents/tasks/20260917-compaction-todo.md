# Worker 任务契约：压缩分界 + todo 状态条

- 状态：已实现并本地验证完成，待集成（详见文末「执行记录」）
- 角色：Worker（单 Agent）
- Base：`dc8282c`（`main`，已推送）
- Branch：`agent-20260917-compaction-todo`
- Worktree：`/Users/chiyizi/.herdr/worktrees/herzi/agent-20260917-compaction-todo`
- 设计依据：`docs/chat-compaction-todo-askuser-plan.md`（**先读 §2、§4、§8**，§3 的 `ask_user_question` 本轮**不做**）

## 范围（只做两项）

### 一、压缩分界

Pi 会话是 append-only 树，压缩会追加一个 entry（`pi-coding-agent` 的 `dist/core/session-manager.d.ts`）：

```ts
CompactionEntry     { type:"compaction";     summary; firstKeptEntryId; tokensBefore; details?: { modifiedFiles?, readFiles? }; usage?; fromHook? }
BranchSummaryEntry  { type:"branch_summary"; fromId; summary; details?; usage?; fromHook? }
```

本地实测：3 个 session 含 `compaction`（`tokensBefore` 111867 / 396805 / 320842，`summary` 6785–8986 字符，`details` 键为 `modifiedFiles, readFiles`），1 个含 `branch_summary`；示例中 `firstKeptEntryId` 在分支里的位置（index 255）**早于** compaction entry 自身位置（index 323）。

现状：`pi-session-reader.ts` 的 `convertActiveBranch()` 只转换 `entry.type === "message"`（约 `:156-161`），其它 entry 一律丢弃，所以压缩完全不可见。

**要求**

1. `ChatPart` 新增一个分界 part（**纯新增**，不改既有成员语义）：
   `{ type: "divider"; kind: "compaction" | "branch-summary"; summary: string; tokensBefore?: number; modifiedFiles?: string[]; readFiles?: string[]; at: number }`
2. **位置＝语义边界（已确认 P1）**：`compaction` 的分界插在「id === `firstKeptEntryId` 的那条 entry」之前，而不是 compaction entry 自己的位置。若 `firstKeptEntryId` 缺失或不在当前分支上 → **退回** compaction entry 自身位置，并保持不崩。
   `branch_summary` 没有 kept 边界，插在它自己的位置即可。
3. `at` 取该 entry 的 timestamp；`tokensBefore` / `details.modifiedFiles` / `details.readFiles` 原样带上（缺失就不带）。
4. **被摘要的历史消息照常显示（已确认 P2）**：不要隐藏任何消息。
5. **渲染**：一条居中带标签的横线，例：
   `──── 上下文已压缩 · 压缩前 111,867 tokens · 摘要 8.9k 字 ────`
   - 摘要与文件清单**默认折叠**（实测摘要 6.8–9k 字符），展开后用 `markdownShared` 渲染摘要，并显示 `modifiedFiles` / `readFiles` 的数量（有内容时再列出文件名，注意长度上限）；
   - `branch_summary` 用同一组件，文案改为「分支摘要」；
   - 展开状态复用现有 `panelOpenState`（稳定的 key，例如基于 `at` + kind）。
6. **分界 part 必须作为 `Worked for` 组的边界**：一个 turn 若中途发生压缩，应渲染为「一段 `Worked for` → 横线 → 另一段 `Worked for`」；**没有分界时仍然只能是一段（回归要求）**。
   实现提示：`combineAssistantTurn()` 现在把「turn 最后一个非空 text/image 之前的一切」收进一个组，需要改成按分界 part 分段。
   注意 `divider` **不是** work part（`isWorkPart()` 必须返回 false），`toActivityItem()` 对它应返回 null。
7. **不做**压缩进行中的实时提示（已确认 P5）：不要订阅 `compaction_start/end`，不要动 `pi-realtime`。

### 二、todo 状态条

`todo` 是第三方工具（`@juicesharp/rpiv-todo`），**每次成功调用都返回完整快照**：

```ts
toolResult.message.details = { action, nextId, params, tasks: Array<{ id, subject, description?, activeForm?, status, blockedBy?, owner?, metadata? }> }
```

其官方 `docs/tool-schema.md` 明确 `details` 就是持久化格式，"replay 取分支上最后一个 `toolResult` 的快照"（last-write-wins）。本地实测：166 条结果该形状全部成立；task 键为 `{activeForm, description, id, status, subject}`；快照 1–56 项；`status` 取 `pending` / `in_progress` / `completed` / `deleted`。

**要求**

1. `PiSessionReader` 在收集 toolResults 时，对 `toolName === "todo"` 且 `details` 形状匹配（`Array.isArray(details.tasks) && typeof details.nextId === "number"`）的结果**保留最后一个**。
2. `ChatSnapshot` 新增可选字段（纯新增）：
   `todos?: { tasks: TodoTask[]; nextId: number; updatedAt: number }`；`updatedAt` 取该 entry 的 timestamp。
   `TodoTask` 只声明已核实的字段：`id: number`、`subject: string`、`status`、`activeForm?`、`description?`、`blockedBy?: number[]`；丢弃未核实字段。
3. **体积上限与降级**：序列化超过上限（建议 128 KiB）时不带 `tasks`（可只带计数），并在任务记录里写明该降级。实测最大 56 项（约 10 KiB 量级）。
4. **UI 位置（已确认 P3）**：放在 **composer 上方**（`ComposerPrimitive.Root` 之前）的可折叠条。
   - 折叠态只显示非零计数，例：`待办 3 · 进行中 1 · 完成 12`；
   - 展开态按状态分组；`in_progress` 优先显示 `activeForm`（缺失退回 `subject`）；`pending` 显示 `subject`，被 `blockedBy` 阻塞时给出标记；
   - `deleted` 是 tombstone，**永不显示**；**空列表或从未用过 `todo` → 整条不渲染、不占位**；
   - 不做 WS/实时推送：沿用现有 1.5 秒 chat 轮询刷新即可。
5. `todo` 仍然**不计入**组头计数，也**不参与**阶段动词（已确认 P6）——这条已经实现，不要改坏。

## 允许修改的文件（write set）

- `src/server/pi-session-reader.ts` 及其测试
- `src/shared/protocol.ts`（**只允许新增**：新 part 类型、新可选字段）
- `src/web/components/ChatView.tsx` 及其测试
- `src/web/styles.css`
- 你新增的小模块及其测试（如需，例如 todo 投影/状态分组）
- 本任务记录

**禁止**：改 `toolCatalog.ts`、`panelOpenState.ts`、`turnActivity.ts`、`pane-activity.ts`、`src/server/index.ts`、`pi-realtime.ts`、`integrations/`；不做 `ask_user_question`；不新增 HTTP/WS 接口；不新增 production dependency。需要扩范围先在 Pane 里问开发者。

## 通用禁止

不运行 `npm run dev`；不操作真实 Pi/Herdr 业务 Pane；不 merge / rebase / push；不为了让测试变绿而弱化断言。

## 验收条件（每条都要有能证伪的测试）

1. `compaction` entry → 分界 part 落在「`firstKeptEntryId` 那条 entry 之前」；`firstKeptEntryId` 缺失或不在分支上时退回自身位置且不崩。
2. 连续多次压缩 → 多条分界；`branch_summary` → kind 为 `branch-summary` 的分界。
3. **无压缩时行为不变**（回归）：一个普通 turn 仍然只有一段 `Worked for`。
4. 有分界时：渲染出「两段 `Worked for` + 一条横线」（组件级断言）。
5. `tokensBefore` / 摘要长度 / 文件数量正确显示；摘要与文件清单默认折叠。
6. todo：只出现 `create`/`update` 序列（没有 `list`）也能得到正确快照；tombstone 不显示；空列表不渲染；`in_progress` 显示 `activeForm`。
7. todo：超上限时降级为不带 `tasks`，不抛错。
8. 既有 117 个测试全部继续通过。

**请对第 1 条与第 4 条各做一次「修复前失败」验证**，并把命令与结果写进任务记录。

## 必须运行的验证

```bash
npm ci            # 若 worktree 无 node_modules
npx vitest run <涉及的目标测试>
npm run typecheck
npm test
npm run build
```

结果明确标记 `PASS` / `FAIL` / `NOT RUN`。真实浏览器视觉验收标 `NOT RUN` 即可。

## 交付要求

- 一个或少量清晰 commit；不 merge / rebase / push。
- 更新本任务记录：实际改动、关键决策、命令与结果、未决问题（尤其是"哪些是近似/退化"）。
- 结束后留在本 Pane，由开发者手动通知 Integrator 集成。

## 备注

- 摘要只能来自真实数据，禁止推测；无法判定时降级显示（例如只显示 tokensBefore）。
- 界面文案中文硬编码，沿用现状。
- 过程中按全局规则主动给阶段性文字更新，但不要逐个工具调用报账。

---

# 执行记录（Worker，2026-09-17）

- 状态：**已实现并本地验证完成，待 Integrator 集成**（未 merge / rebase / push）
- 范围：严格按上面的 write set，未改 `toolCatalog.ts` / `panelOpenState.ts` / `turnActivity.ts` / `pane-activity.ts` / `src/server/index.ts` / `pi-realtime.ts` / `integrations/`
- 未新增 production dependency，未运行 `npm run dev`，未操作真实 Pane

## 1. 实际改动

| 文件 | 改动 |
| --- | --- |
| `src/shared/protocol.ts` | **纯新增**：`ChatDividerKind`、`ChatDividerPart`（加入 `ChatPart` 联合类型）、`ChatSnapshot.todos?`、`TodoTaskStatus`、`TodoTask`、`ChatTodosSnapshot`。既有成员语义未动 |
| `src/shared/todo-tasks.ts`（新增） | `TODO_SNAPSHOT_MAX_BYTES = 128 KiB`、`isTodoDetails()`、`projectTodoTasks()`、`buildTodoSnapshot()`（投影 + 体积降级） |
| `src/server/pi-session-reader.ts` | `convertActiveBranch()` 改为返回 `{ messages, todos }`；`compaction` / `branch_summary` entry → 分界消息；`todo` toolResult → 最后一个快照 |
| `src/web/components/ChatView.tsx` | 分界 part 渲染（`data-divider`）、`combineAssistantTurn()` 按分界分段、composer 上方 todo 状态条与分组逻辑 |
| `src/web/styles.css` | `.chat-divider` / `.divider-*`、`.chat-todo-bar` / `.todo-*` |
| 测试 | `pi-session-reader.test.ts` +10 用例、`ChatView.test.tsx` +10 用例 |

### 数据层要点

- 分界以**独立 assistant 消息**（`id = divider:<entryId>`，content 只有一个 `divider` part）插入，才能正好落在两条消息之间、并且成为同一 turn 内 `Worked for` 的分段点。
- 位置＝语义边界：`boundary = branch.index(firstKeptEntryId)`；缺失或不在分支上（`branchIndexById.get()` 返回 `undefined`）→ 退回 compaction entry 自身位置，不抛错。
- `branch_summary` 用自身位置；`firstKeptEntryId` 缺失或不在分支上时同一条退化路径（用例覆盖）。
- 消息与分界按 `(branchIndex, rank)` 排序（message rank 1、divider rank 0），稳定排序保证同一位置的多条分界保持分支顺序；多个 compaction 也能产生多条分界。
- 摘要/文件清单只从 entry 真实字段取：`summary` 非字符串 → 空串；`tokensBefore` 非有限正数 → 不带；`details.modifiedFiles/readFiles` 只保留字符串元素。
- todo：只要求 `toolName === "todo"` 且 `details` 形状匹配（`tasks` 数组 + `nextId` 数字），遍历分支时**最后一个**生效（与扩展自身 replay 的 last-write-wins 一致）；只投影已核实字段（`id/subject/status/activeForm/description/blockedBy`），其余字段丢弃。
- 体积：只对**最终保留**的那一份快照做投影与体积检查（长会话里被丢弃的中间快照不付代价）。超过 128 KiB → `{ tasks: [], nextId, updatedAt, truncated: true }`。

### 展示层要点

- 分界＝居中带标签横线：`上下文已压缩 · 压缩前 111,867 tokens · 摘要 8.9k 字`；`branch_summary` 文案为「分支摘要」。摘要与文件清单默认折叠，展开后摘要用 `markdownShared` 渲染，并列出 `涉及文件 N` / `已读文件 N`（文件名最多 12 个，其余写「…另有 N 个」）。
- 展开状态复用 `panelOpenState`，key 为 `divider:<kind>:<at>`（未改 `panelOpenState.ts`）。
- 分段：`combineAssistantTurn()` 以分界 part 为断点，每段一个 `work` 组（`work:<turnId>`、`work:<turnId>:<segment>`）；**没有分界时仍然只有一段**（既有回归用例 + 新增用例都断言）。分界不是 work part：`isWorkPart()` 只认 text/reasoning/image/tool-call，`toActivityItem()` 对它返回 `null`（组件级断言：`.work-group .chat-divider` 不存在，且两段各自的 work 行不串段）。
- todo 状态条在 `ComposerPrimitive.Root` **之前**：折叠显示非零计数（`待办 3 · 进行中 1 · 完成 12`），展开按 `进行中 → 待办 → 已完成` 分组，`in_progress` 优先 `activeForm`（缺失退回 `subject`），`completed` 加删除线；`deleted` 过滤后**永不显示**；过滤后为空（含降级快照）→ 整条不渲染。刷新沿用既有 1.5 秒轮询，未加 WS。
- `todo` 仍然不计入组头计数、不参与阶段动词（未改 `toolCatalog.ts`，相关既有用例继续通过）。

## 2. 近似 / 退化（真实实现与设计文档的差异，必读）

1. **分界消息的 `createdAt` 是「位置锚点」**：取最近的相邻真实消息时间戳（优先后一条），而 part 上的 `at` 才是 compaction entry 的真实时间。原因：`mergeRealtime()` / `mergePendingUserMessages()` 会按 `createdAt` 重新排序，若分界带 compaction 时间（通常晚于被保留段），它会被排到「它本该在其上方」的消息之后，语义边界就丢了。已在代码注释与用例（`divider.createdAt === 后一条消息的 createdAt`）中固定。
2. **每段 `Worked for` 的时长＝整个 turn 的时长**，没有按分界切分。分界的 `at` 是「写入压缩条目的时刻」，不代表两段工作的真实时间分界，按它切分会造出不存在的数字，因此选择不造。
3. **没有可用时间戳时**：part 的 `at` 为 `0`，UI 不显示时间（`.divider-time` 不渲染），面板 key 退化为 `divider:<kind>:0`（同 kind 的无时间分界共享展开状态）。
4. **分界插在「边界 entry 之后的第一条已渲染消息之前」**：若 `firstKeptEntryId` 指向的 entry 本身不产生聊天消息（例如 toolResult），分界会落在其后第一条消息之前；若其后没有任何已渲染消息，则落在末尾。契约的示例（boundary 在 275 条消息中）属于前一种情况，位置正确。
5. **未知 todo 状态**归入「待办」组显示（不丢任务）；`blockedBy` 指向的快照外 id 显示为 `#N（未知）` 且不算阻塞（无法判定就不判定）。
6. **摘要长度** `8.9k 字` = `summary.length` 截断到一位小数（8986 → 8.9k），与设计文档示例一致；不是 token 数。
7. **降级**：todo 超 128 KiB → 不带 `tasks`（`truncated: true`），客户端因此什么都不显示（不显示残缺列表）；这是唯一被记录的体积降级路径。
8. `todo` 快照采集**不要求** `role === "toolResult"`（只要求工具名 + details 形状），避免角色字段差异造成静默丢失；工具行本身仍按既有 `role === "toolResult"` 逻辑收集。

## 3. 验证结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 依赖 | `npm ci` | PASS（worktree 无 `node_modules`，按锁文件安装） |
| 目标测试（服务端） | `npx vitest run src/server/pi-session-reader.test.ts` | **PASS** 18/18 |
| 目标测试（组件） | `npx vitest run src/web/components/ChatView.test.tsx` | **PASS** 28/28 |
| 全量测试 | `npm test` | **PASS** 15 files / 137 tests（既有 117 + 新增 20）；连跑 3 次均 137 passed |
| 类型检查 | `npm run typecheck` | **PASS** |
| 构建 | `npm run build` | **PASS**（仅有既存的 chunk >500 kB 警告） |
| 真实浏览器视觉验收 | — | **NOT RUN** |
| 真实 session 文件校验 | — | **NOT RUN**（读取真实 transcript 需要用户明确许可；本轮全部断言基于合成 fixture + 契约/类型文档给出的形状） |

### 修复前失败验证（验收条件第 1、4 条，硬性要求）

在**不改动工作区**的前提下，用 base 源码 + 新测试复现（临时目录）：

```bash
TMP=/tmp/herzi-prefix-check && mkdir -p $TMP && git archive dc8282c | tar -x -C $TMP
cp src/server/pi-session-reader.test.ts $TMP/src/server/
cp src/web/components/ChatView.test.tsx $TMP/src/web/components/
ln -s "$PWD/node_modules" $TMP/node_modules
cd $TMP && npx vitest run src/server/pi-session-reader.test.ts -t "places the compaction divider before the first kept entry"
cd $TMP && npx vitest run src/web/components/ChatView.test.tsx -t "breaks a turn into two Worked for groups around a compaction divider"
```

- **第 1 条（语义边界）FAIL 原文**：

  ```
  AssertionError: expected [ 'm1', 'm2', 'm3', 'm4', 'm5' ] to deeply equal [ Array(6) ]
    [
      "m1",
      "m2",
  -   "divider:c1",
      "m3",
      "m4",
      "m5",
    ]
   ❯ src/server/pi-session-reader.test.ts:282:60
   Test Files  1 failed (1)
        Tests  1 failed | 17 skipped (18)
  ```

  （旧 reader 丢弃 compaction entry，分界 part 完全不存在；实现后同一命令 18/18 PASS。）

- **第 4 条（两段 `Worked for` + 横线）FAIL 原文**：

  ```
  TestingLibraryElementError: Unable to find an element with the text: done. ...
  Error: Unsupported assistant message part type: divider
   Test Files  1 failed (1)
        Tests  1 failed | 27 skipped (28)
  ```

  （旧 UI 的 `fromThreadMessageLike` 对未知 part 类型直接抛错，说明分界 part 无法渲染；实现后同一命令 28/28 PASS。）

- 实现前一次性跑完新增的两组用例时：服务端 `Tests 8 failed | 9 passed (17)`、组件 `Tests 5 failed | 21 passed (26)`，即新增针对新行为的用例在旧实现下全部失败；当前实现下全绿。

（说明：在临时复现目录里把两个测试文件**一起**跑时，既有用例 “keeps a failed prompt in the thread…” 偶发 `promptCalls() got 2`；在工作区里该用例单独连跑 3 次与全量连跑 3 次均通过，判为临时目录的偶发，与本次改动无关。）

## 4. 未决问题 / 交接提示

1. 真实 session 的结构校验未做（需用户许可）。若允许，建议只读结构做一次核对：`compaction` 的 `details` 键、`todo` 结果的 `role` / `toolName` / `details` 形状、`firstKeptEntryId` 是否始终在分支上（设计文档 §9 第 4 项仍未穷尽验证）。
2. 分界在「已渲染消息之间」的插入规则见 §2.4；如果实际数据里 `firstKeptEntryId` 经常指向 toolResult，建议复核一次视觉效果（本轮无浏览器验收）。
3. 每段 `Worked for` 共用整个 turn 时长（§2.2）；若希望按时长切分，需要先确认 compaction entry 时间与真实工作段边界的关系（当前证据不支持）。
4. `docs/` 长期文档与 `docs/README.md` 未改（本轮按契约只更新本任务记录），是否需要记录到长期文档由 Integrator 决定。
