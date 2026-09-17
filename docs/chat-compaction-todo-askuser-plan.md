# Chat 过程区增补方案：压缩分界、ask_user_question、todo 列表

> 日期：2026-09-17（UTC+08:00）
> 状态：可行性已核实，方案完成，待决策
> 需求来源：用户提出（1）压缩没有展示，希望用横线展示并可分割 `Worked for` 组；（2）ChatView 能响应 `ask_user_question` 工具调用并显示 todo 列表
> 本轮边界：只做可行性与设计，不改代码

## 1. 结论摘要

| 需求 | 可行性 | 关键依据 |
| --- | --- | --- |
| 压缩用横线展示 + 分割 `Worked for` 组 | **完全可行**，数据本来就在文件里，只是被 reader 丢掉 | Pi `CompactionEntry` / `BranchSummaryEntry` 定义；实测 3 个本地 session 含 `compaction`、1 个含 `branch_summary` |
| ChatView 响应 `ask_user_question` | **显示完全可行；"在 Chat 里直接回答"没有官方 API**，只能注入按键，属于有风险的可选项 | `rpiv-ask-user-question` 的 tool schema、事件契约与 `hosts.md` |
| 显示 todo 列表 | **完全可行，成本很低**：每次 `todo` 调用的结果里都带完整快照 | `todo` 返回包 `details.tasks`；实测 166 条 todo 结果全部带 `{action,nextId,params,tasks}` |

## 2. 需求一：上下文压缩

### 2.1 现状事实

Pi 的会话文件是 append-only 树，压缩会追加一个 entry（`pi-coding-agent` 的 `dist/core/session-manager.d.ts`）：

```ts
interface CompactionEntry<T = unknown> {
  type: "compaction";
  summary: string;          // LLM 生成的摘要正文
  firstKeptEntryId: string; // 保留段的起点
  tokensBefore: number;     // 压缩前的上下文 token 数
  details?: T;              // 默认实现里是 { modifiedFiles, readFiles }
  usage?: Usage;
  fromHook?: boolean;
}

interface BranchSummaryEntry<T = unknown> {
  type: "branch_summary";
  fromId: string;
  summary: string;
  details?: T; usage?: Usage; fromHook?: boolean;
}
```

本地实测（只统计结构与长度，未读正文）：

| 项目 | 实测值 |
| --- | --- |
| 含 `compaction` 的 session 文件 | 3 个（另有 1 个含 `branch_summary`） |
| entry 键 | `details, firstKeptEntryId, fromHook, id, parentId, summary, timestamp, tokensBefore, type, usage` |
| `details` 键 | `modifiedFiles, readFiles` |
| `tokensBefore` 实例 | 111867 / 396805 / 320842 |
| `summary` 长度 | 6785 / 8986 / 8637 字符 |
| `fromHook` | `false`（pi 自身生成） |
| 位置（示例） | 分支共 447 条，compaction 在 index 323，`firstKeptEntryId` 在 index 255；分界线前 321 条消息，之后 122 条 |

**为什么现在看不到**：`PiSessionReader.convertActiveBranch()` 只把 `entry.type === "message"` 且 role 为 `user`/`assistant` 的条目转成消息（`src/server/pi-session-reader.ts:156-161`），其它 entry 一律丢弃；`ChatPart` 里也没有对应的 part 类型，前端自然无从渲染。

### 2.2 设计

**数据层**：在 `ChatPart` 增加一个分界 part（名字待定，例如 `divider`）：

```ts
{ type: "divider";
  kind: "compaction" | "branch-summary";
  summary: string;
  tokensBefore?: number;
  modifiedFiles?: string[];
  readFiles?: string[];
  at: number; }
```

`convertActiveBranch` 在遍历分支时，遇到 `compaction` / `branch_summary` entry 就插入这个 part（而不是丢弃）。

**位置（重要，需决策 D1）**：实测 `firstKeptEntryId` 在分支中的位置**早于** compaction entry 自身（255 vs 323）。两种放法：

- **A（推荐）语义边界**：插在 `firstKeptEntryId` 之前 —— 上方是被摘要替代的历史，下方是仍然在模型上下文里的内容（摘要 + 保留段）。这与 Pi 的 `buildContextEntries()` 语义一致。
- **B 写入时刻**：插在 compaction entry 自己的位置 —— 表示"这一刻发生了压缩"，但上方会混着"仍在上下文里"的保留段，容易误读。

两种都用同一条横线渲染，标签里带上压缩发生的 `timestamp`，因此时间信息不会丢。

**展示层**：

```
──────────────────  上下文已压缩 · 压缩前 111,867 tokens · 摘要 8.9k 字  ──────────────────
   ▸ 查看摘要与涉及文件（modifiedFiles 12 · readFiles 47）
```

- 横线居中带标签，视觉上明确「这里断开」；
- 摘要默认**折叠**（实测 6.8–9k 字符，展开会顶掉整屏），展开后按 Markdown 渲染（复用 `markdownShared`）；
- 文件列表默认折叠，只显示数量；
- `branch_summary` 用同一组件，文案改为「分支摘要」。

**分割 `Worked for` 组**：把分界 part 视为**组边界**。`combineAssistantTurn` 在切分 work 段时以分界 part 为断点，于是一个 turn 若中途发生压缩，会得到两段 `Worked for`，中间夹着横线。这与用户要求一致，也不影响没有压缩的常见情况（仍是一段）。

**保留还是隐藏被摘要的历史（需决策 D2）**：

- **A（推荐）保留全部历史 + 横线**：transcript 忠于"发生过什么"；横线只是告诉读者"模型现在看不到横线以上的部分"。
- B 隐藏横线以上的消息（对齐模型上下文）：更"真实地反映模型所见"，但用户会以为历史丢了。

**实时提示（可选）**：Pi 的 extension 事件里有 `compaction_start` / `compaction_end`（见 `dist/core/agent-session.d.ts`）。可在 companion bridge 订阅并转发，压缩进行中显示一条「正在压缩上下文…」。具体 payload 需在实现前用真实事件核实，未核实前不做。

### 2.3 影响面

- `src/server/pi-session-reader.ts`：分支遍历插入分界 part（并需处理 `firstKeptEntryId` 不在分支上的退化 → 退回 B 位置）。
- `src/shared/protocol.ts`：新增 part 类型（纯新增，不改现有语义）。
- `src/web/components/ChatView.tsx`：分界渲染 + 组切分；`styles.css` 加横线样式。
- 与正在进行的「工具展示增强」任务**同文件**，必须串行（见 §5）。

## 3. 需求二之一：`ask_user_question`

### 3.1 现状事实

该工具**不是** Pi 内置工具，而是用户安装的扩展包 `@juicesharp/rpiv-ask-user-question`（`pi list` 可见）。

**参数**（`docs/tool-schema.md`）：

```ts
ask_user_question({
  questions: [{
    question: string,      // 完整问题，以 "?" 结尾
    header: string,        // 芯片标签，≤16 字符
    options: [{ label, description, preview? }],  // 2–4 个
    multiSelect?: boolean,
  }],                      // 1–4 个问题
})
```

**结果**（工具结果 entry 的 `message.details`）：

```ts
{ answers: [{ questionIndex, question, kind: "option"|"custom"|"multi",
              answer: string|null, selected?: string[], notes?, preview? }],
  cancelled: boolean, globalNote?: string, error?: string }
```

本地实测：5 条 `ask_user_question` 结果，`details` 键为 `{answers, cancelled}`，单条 answer 键为 `{answer, kind, question, questionIndex}`。

**可用事件**（第三方向其它扩展公开）：

- `rpiv:ask-user:prompt` — 校验通过、对话框显示**之前**发出；payload 含 `questions[].{question, header, multiSelect, options[].{label, description, hasPreview}}`。文档承诺：频道名不可变、payload 只增不改且可选、JSON 安全。
- `rpiv:ask-user:blocked` `{active: boolean}` — 用户已有一个桥接扩展 `~/.pi/agent/extensions/herdr-rpiv-bridge.ts` 把它映射成 `herdr:blocked`，因此 Herdr 现在就能显示 `blocked` 状态（Herzi 侧栏已在用）。

**回答路径**（`docs/hosts.md` + `docs/keyboard.md`）：

- 在**终端/TUI host**（我们就是这种）里，扩展渲染自己的终端对话框；
- **没有任何"由外部提交答案"的 API**；答案只能来自该对话框的键盘交互，或（RPC/ACP host）宿主自己的 `select`/`input` 对话框；
- 键盘契约：`↑/↓` 移动、`Enter` 确认、`Space` 切换复选、`Tab`/`→` 切问题、`n` 写备注、`Ctrl+]` 折叠、**`Esc` 取消整个问卷**；单选取选项列表（含自动追加的 `Type something.` 行），多选额外有 `Next` 行。

### 3.2 设计（分两档）

**P0：只读展示（推荐先做，零风险）**

1. **实时**：companion extension（`integrations/pi/extensions/herzi-bridge.ts`）订阅字符串频道 `rpiv:ask-user:prompt`，把 questions/options 转发给 Herzi（沿用现有 event POST 通道）。订阅字面频道名即可，不必给 Herzi 增加对该 npm 包的依赖。
2. **兜底**：没有 bridge 时，用工具调用的 `args.questions` 渲染（JSONL 里就有），只是延迟到落盘。
3. **展示**：Chat 里出现一张「需要你回答」卡片：问题、选项与描述（`preview` 标记为有预览）、是否多选；并提供醒目的**「切到 Terminal 回答」**按钮（复用现有 view 切换）。
4. **回答后**：从 toolResult 的 `details.answers` 渲染结果（选中项 / 自定义答案 / 已取消 / 全局备注），并解除 alert。

**P1：一键回答（可选，需要用户显式接受风险）**

只对**单选题且选项 ≤ 4**提供"点击选项即回答"，实现方式是通过 Herdr 向同一 pane 注入按键（`agent.send_keys` 目前只演示过 `esc`；需要确认支持方向键）：

1. 发送前先读屏（`pane read` / `agent read visible`）确认对话框仍在、当前高亮行位置可解析；
2. 计算 `↓` 次数 + `Enter`，逐次或一次发出；
3. 发送后校验工具结果（`details.answers`）是否与点击项一致；
4. **任何不确定**（读屏失败、行数不符、问题已切换、用户正在终端输入）→ 立刻停止注入并提示切 Terminal；
5. **绝不发送 `Esc`**（会取消整个问卷）、**不支持多选与自定义输入**（需要文本输入或多次切换 tab）。

风险要说清楚：这是"按键回放"，依赖对话框布局与当前焦点状态，属于尽力而为；P0 的"切到 Terminal"永远是可靠路径。

### 3.3 影响面

- `integrations/pi/extensions/herzi-bridge.ts`：新增订阅与上行事件类型；
- `src/shared/protocol.ts`：新增实时事件与快照字段；
- `src/server/pi-realtime.ts` / `index.ts`：接收与广播；
- `src/web/components/ChatView.tsx`：问题卡片与结果卡片；`styles.css` 样式。

## 4. 需求二之二：todo 列表

### 4.1 现状事实

`todo` 同样来自扩展包 `@juicesharp/rpiv-todo`。它的**每次成功调用都返回完整快照**（`docs/tool-schema.md`）：

```ts
details: {
  action, nextId, params,
  tasks: Array<{ id, subject, description?, activeForm?, status, blockedBy?, owner?, metadata? }>
}
```

并且文档明确：`details` 就是持久化格式，"replay 通过遍历分支取最后一个快照"。该包自己的 `state/replay.ts` 也是这个实现（last-write-wins）。

本地实测：166 条 `todo` 结果，`details` 键全为 `{action,nextId,params,tasks}`；task 键为 `{activeForm, description, id, status, subject}`；快照规模从 1 到 56 个任务；状态取值 `pending` / `in_progress` / `completed` / `deleted`（`delete` 是 tombstone，`list` 默认隐藏）。

### 4.2 设计

**不需要重建状态机**：只要取**最后一个 `todo` 工具结果的 `details.tasks`** 即可，和该包 replay 的语义一致。

- **数据层**：`PiSessionReader` 在收集 toolResults 时，对 `toolName === "todo"` 额外保留一份结构化快照（`tasks` + `nextId`）；`ChatSnapshot` 增加可选字段（例如 `todos?: { tasks: TodoTask[]; updatedAt: number }`）。需要给快照设大小上限（实测最大 56 项，序列化约 10KB 量级），超限时只保留计数并降级。
- **展示**：Chat 顶部或 composer 上方放一条**可折叠的 todo 状态条**：
  - 折叠态：`待办 3 · 进行中 1 · 完成 12`（只显示非零项 + 进度比例）；
  - 展开态：按状态分组列出任务（`in_progress` 用 `activeForm` 文案），`pending` 显示被 `blockedBy` 阻塞的标记；`completed` 默认折叠或只显示最近若干条；tombstone 不显示。
  - 空列表或从未使用 `todo` → 完全不渲染该条（不占位）。
- **更新时机**：现有 1.5 秒 chat 轮询会重读 JSONL，因此快照最迟 1.5 秒内刷新；如需即时，可由 bridge 在 `tool_execution_end` 时捎带一个轻量摘要（只带计数与状态，不带完整任务文本，避免大 payload）。

### 4.3 影响面

- `src/server/pi-session-reader.ts`、`src/shared/protocol.ts`、`src/web/components/ChatView.tsx`、`styles.css`；
- 与「工具展示增强」同样触碰 `ChatView.tsx` / `protocol.ts`，需串行。

## 5. 排期与冲突（重要）

当前**已有一个 Worker 在跑**「Chat 过程展示增强」（`herzi_tools` / `w14:p1`，分支 `agent-20260917-tool-presentation`），它的写入范围包含：

```
src/web/components/ChatView.tsx
src/web/styles.css
src/shared/protocol.ts
src/server/pi-session-reader.ts
```

本方案的三个需求**全部命中这四个文件**（`ChatView.tsx`、`styles.css`、`protocol.ts`、`pi-session-reader.ts`）。因此：

- **不建议并行**：同一批文件的并发修改会带来必然的 cherry-pick 语义冲突；
- 建议顺序：等 `herzi_tools` 完成 → 我检查并集成 → 再为本方案开新的 Worker（同样单 Worker 单 worktree）；
- 如果希望现在就动，只能接受"后做的人必须基于前一个的集成结果"，也就是串行。

## 6. 建议的实施方案（待批准）

| 阶段 | 内容 | 依赖 |
| --- | --- | --- |
| P0 | 压缩分界：reader 插入 divider part + 前端横线与组切分 | 需等当前 Worker 集成 |
| P1 | todo 状态条：快照读取 + 折叠面板 | 同上 |
| P2 | `ask_user_question` 只读展示 + 切 Terminal 回答 + 结果回显 | 同上（bridge 侧可与 P0/P1 并行改，但合并需串行） |
| P3（可选） | 单选题一键回答（按键注入 + 读屏校验 + 失败降级） | P2 完成后，且需用户显式接受风险 |

每个阶段都遵循既有约定：单 Worker + 一个 worktree、局部验证、Integrator 集成后跑 `typecheck` / `test` / `build`、`main` 需用户批准。

## 7. 测试与验收要点

- **压缩分界**：`firstKeptEntryId` 不在分支上时退回写入位置；连续多次压缩产生多条分界；`branch_summary` 渲染为分支摘要；无压缩时不出现横线（现有 UI 不变）。
- **组切分**：带压缩的 turn 呈现两段 `Worked for`；无压缩仍是单段（回归）。
- **todo**：仅 `create`/`update` 序列（无 `list`）也能显示正确快照；tombstone 不显示；空列表不渲染；快照超限降级；56 项快照不造成明显卡顿。
- **ask_user_question**：有 bridge / 无 bridge 两条路径都能显示问题；回答后正确显示选中项与自定义答案；`cancelled: true` 显示为"已取消"而不是空答案。
- **不使用真实 Pane 也能测**：以上数据全部来自 JSONL 解析与本地 fixture，测试可完全合成。

## 8. 已确认决策（2026-09-17）

| 编号 | 决策 | 确认结果 |
| --- | --- | --- |
| P1 | 分界线位置 | **语义边界**：插在 `firstKeptEntryId` 之前（上方已被摘要替代、下方仍在模型上下文里） |
| P2 | 被摘要的历史消息 | **保留显示** + 横线提示；不隐藏 |
| P3 | todo 面板位置 | **composer 上方可折叠条** |
| P4 | `ask_user_question` 「在 Chat 里直接回答」 | **暂缓**：开发者认为这是最复杂的部分，稍后会单独详谈；本轮不对该需求做任何实现（含只读展示） |
| P5 | 压缩进行中的实时提示 | **不做**（不订阅 `compaction_start/end`） |
| P6 | `todo` 是否参与阶段动词表决 | **接受现状**：`todo` 既不计数也不参与动词（与已确认的 D2 一致） |

### 8.1 因此本轮实现范围

**压缩分界 + todo 状态条**（即原 P0 与 P1）；`ask_user_question`（原 P2/P3）整体暂缓。

分界 part 作为组边界时，仍需保证无压缩情形下的单组行为不变。

## 9. 实现前需要验证的未知项

1. `compaction_start` / `compaction_end` 的真实 payload 形状（只在类型定义里见到名字，未取到实际事件）。
2. Herdr `agent.send_keys` 是否支持方向键（`up` / `down`）与空格；目前只验证过 `esc`。这直接决定 P3 是否可行。
3. `todo` 快照在极端情况下的最大体积（现实中已见 56 项，未见更大）。
4. `firstKeptEntryId` 指向的 entry 是否**总是**在当前分支上（实测 2/2 是，但不是穷尽验证）。
