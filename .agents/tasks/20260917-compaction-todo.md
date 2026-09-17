# Worker 任务契约：压缩分界 + todo 状态条

- 状态：已派发
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
