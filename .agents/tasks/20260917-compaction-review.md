# 独立复审执行记录：压缩分界 + todo 状态条（含上一轮回归修复）

- 状态：**复审完成**
- 角色：独立 Reviewer（与实现者、修复者均非同一 Agent；只读产品代码，只写本文件）
- Candidate：`b201c43`（= `25a72ab` + 合并 `agent-20260917-compaction-fix`）
- 对照基线：`dc8282c`（回归前已批准状态）；被撤回的实现：`9af9eac`
- 范围：相对 `25a72ab` 的全部改动（`src/server/pi-session-reader.ts`(+test)、`src/shared/protocol.ts`、`src/shared/todo-tasks.ts`、`src/web/components/ChatView.tsx`(+test)、`src/web/styles.css`）
- 修复者自查记录：`.agents/tasks/20260917-compaction-fix.md`（读过，但不作为结论依据）

## 1. 结论摘要

**结论：可以合入 `main`（无阻断），但开发者需要显式接受 1 项 P2 与 6 项 P3 的已记录降级/遗留，且真实浏览器与真实 session 验收本轮 NOT RUN。**

两个原始问题都已独立复核：

1. **顺序回归（B1）确认已修复。** 我用自建的 DOM 溯源（`TreeWalker` 前序遍历即文档顺序）与「文本节点 pairwise 顺序」两套互不相同的方法，在候选树上验证 `组 → 正文`、`组 → 横线 → 组 → 正文` 恒成立；并在**真实 `9af9eac` 代码树**上复跑修复者新增的顺序断言，得到 `6 failed | 6 passed | 33 skipped`（与修复者 §4.1 一致），在 **`dc8282c`** 上跑同一套得到 `1 passed | 11 failed`——那 11 条失败全部是因为 `dc8282c` 尚无分界功能（`.chat-divider` 永不渲染），而其中关键的那条 `keeps the Worked for group above the turn's final answer` 是 **PASS**。
2. **无分界 / 无 todo 的既有行为与 `dc8282c` 完全一致。** 16 个形状（含 3 个运行中形状）在两棵树上的渲染轨迹 **逐字节 identical**，不是"逐字段"或抽样。

发现的问题全部是 P2/P3：1 项布局遮挡（展开 todo 条会盖住正文尾部）、以及少量未记录的降级路径与测试脆弱点；**没有发现功能性阻断**。

## 2. 复审方法（不采信任何 claim）

- **零仓库改动**：没有修改 `src/**`、`docs/**`、其它任务记录，也没有在仓库内新增文件（`git status` 在复审前后均为 clean）。全部复核脚本与临时树放在 `/tmp/review/`（用完删除）。
- **独立的 DOM 顺序取值**：不使用修复者的 `landmarks()` 辅助函数。另写两套：
  - `trace()`：`Node` 递归 + 文档顺序拼接，把 `.work-group/.worked-row/.chat-divider/.chat-todo-bar/.activity-group.tool-group` 就地展开成 token（组在正文下方时 token 顺序即错），文本节点原样输出。
  - `textIndex()`：`document.createTreeWalker(SHOW_TEXT)` 收集文档顺序的非空文本节点，用 `indexOf` 做 pairwise 断言（这是"用户实际看到的顺序"，与类名无关）；另用 `element.compareDocumentPosition()` 做元素级交叉验证。
- **按目录做基线对照**：`git archive dc8282c src | tar -x -C /tmp/review/base`，用同一份测试文件、同一份断言跑两棵树，然后 `diff` 输出。
- **反向验证（变异测试）**：把 `src/` 复制到 `/tmp/review/mut`，注入 9 个变异（含忠实复现 `9af9eac` 的旧插入路径），分别跑「修复者的测试」与「我的测试」，确认断言会失败。
- **不改产品代码的前提下跑别人的测试**：把候选的 `ChatView.test.tsx` 复制进 `/tmp/review/base`（dc8282c）与 `/tmp/review/old`（9af9eac）两棵临时树运行。

主要命令（均可复跑，脚本已删除）：

```bash
# 本候选
npm test                                  # 157/157
npm run typecheck                         # exit 0
npm run build                             # exit 0（仅既存 chunk 体积警告）
# 无分界回归对照（同一断言跑两棵树后 diff）
npx vitest run --config /tmp/review/vitest.base.config.ts shape       # dc8282c
npx vitest run --config /tmp/review/vitest.candidate.config.ts shape  # 本候选
diff /tmp/review/base2.traces /tmp/review/cand2.traces                # → IDENTICAL
# 断言不迁就实现
npx vitest run --config /tmp/review/vitest.basetree.config.ts src/web/components/ChatView.test.tsx -t "ChatView turn order"   # dc8282c: 1 passed | 11 failed（11 fail = dc8282c 无分界功能）
npx vitest run --config /tmp/review/vitest.oldtree.config.ts  src/web/components/ChatView.test.tsx -t "ChatView turn order"   # 9af9eac: 6 failed | 6 passed
```

## 3. 逐项复核结果

### 3.1 顺序（最高优先）——已核对无问题

构造并渲染的完成态 turn 形状与实测文档顺序（`trace()`，其中 `<ROW>` 为空 `Worked for` 行）：

| 形状 | 实测文档顺序 |
| --- | --- |
| reasoning → tool → 正文 | `<GROUP …> "这是最终答复"` ✅ 组在正文之前 |
| 正文 → reasoning → tool | `<ROW Worked for 21s> "这是最终答复" "Thinking" …tool…`（与 `dc8282c` 一致） |
| reasoning → tool → 正文 → tool | `<GROUP …> "中间答复" "npm run build"` ✅ |
| reasoning → tool → 文本1 → reasoning → tool → 文本2 | `<GROUP …文本1…> "第二段答复"`（文本1 被折叠，与基线一致） |
| 只有工具无正文 | 单个 `<GROUP …>` ✅ |
| 只有正文 | `<ROW Worked for 21s> "只有答复"` ✅ |
| 两段正文 | `<GROUP …第一段> "第二段"`（与基线一致） |
| 只有 reasoning | `<GROUP …>` ✅ |
| 图片在末尾 | `<GROUP …>` 之后为 `<img>`：`compareDocumentPosition` 断言 `isBefore(group, image) === true` ✅ |
| 分界在中间 | `<GROUP 压缩前的思考> <DIVIDER> <GROUP 压缩后的思考> "最终答复"` ✅ |
| 分界在段首 | `<DIVIDER> <GROUP 新的思考> "新的答复"` ✅ |
| 分界在段尾 | `<GROUP 收尾工作> <DIVIDER>`（不额外造组）✅ |
| 正文后接分界 | `<ROW> "已经答完" <DIVIDER>` ✅ |
| 连续两条分界 | `<GROUP> <DIVIDER> <DIVIDER> <GROUP>`（无空组）✅ |

- pairwise 断言（`before("压缩前的思考","上下文已压缩")`、`before("上下文已压缩","压缩后的思考")`、`before("压缩后的思考","最终答复")`）全部通过；我的独立断言集在注入了"旧插入路径"变异（M1）后失败 7 条，说明这批断言真的能抓住该回归。
- `9af9eac` 上我的同一套断言同样失败（见 §3.3），确认这是历史缺陷而非"新期望"。

### 3.2 分界语义——已核对无问题

- **真的切断组**：`groups[0]` 不含分段后的工作文本、`groups[1]` 不含分段前的（断言 `not.toContain`）✅
- **分界前后各自判定"最后输出"**：`reasoning → tool → 正文 → 分界 → reasoning → tool` 得到 `组 → 正文 → 横线 → 组`，正文不被第二段吸走、第二段工作行不留在组外 ✅
- **分界在开头**：`<DIVIDER> <GROUP> 正文` ✅；**在结尾**：单组 + 横线，不产生空组 ✅；**连续多条**：两条横线之间不建组、段号不跳号（我自写的 `stacks consecutive rules without an empty group` 同时断言了两条横线的相对顺序与两段的展开状态独立）✅
- **`firstKeptEntryId` 缺失 / 不在分支上 / 指向不产生消息的 entry**：我自写的 reader fixture 覆盖三种，分界退回写入位置或顺延到下一条已渲染消息前，均不吞正文、不产生重复 id；两条分界指向同一 kept entry 时保持分支顺序且 id 唯一 ✅
- **运行中的 turn**：`running` 时不折叠（0 个 `.work-group`），分界照常渲染 ✅

### 3.3 回归对照 `dc8282c`——已核对无问题（16 形状逐字节一致）

| 项目 | 结果 |
| --- | --- |
| 无分界 13 形状（含正文在中间/末尾、多段正文、只有工具、空文本 part、工具报错、图片在末尾、双 turn） | 两棵树 `trace()` **diff 为空** |
| 运行中 3 形状（reasoning、reasoning+tool、reasoning+正文） | 同上，**identical**（"运行中不折叠"、live 标签 `思考中`/`Thinking` 位置一致） |
| 时长 | 两棵树均输出 `Worked for 21s` / `已思考 5s`，文本一致 |
| 空 turn | `text-only` 形状两棵树均为 `<ROW Worked for 21s> 正文` |
| 修复者新增断言的来源 | 在 `dc8282c` 代码树跑候选测试：关键顺序断言 **PASS**；在 `9af9eac` 代码树跑同一套：**6 failed**。→ B1 是真实回归，断言不是迁就新实现 |
| 既有测试基线 | 我把三棵树的**各自原始测试**分别跑了一遍：`dc8282c` → 117/117 通过；`9af9eac` → 137/137 通过；候选 → 157/157 通过。即「137 个测试全绿也没抓住 B1」这一说法成立 |

### 3.4 todo 条——已核对无问题

计数与分组（`待办 2 · 进行中 1 · 完成 1`）、`in_progress` 优先用 `activeForm`（缺 `activeForm` 时回落 `subject`，已实测）、分组顺序 `进行中 → 待办 → 已完成`、tombstone 不显示（全部为 tombstone 时整条不渲染且正文无残留）、未知 status 计入“待办”、`blockedBy` 指向快照外 id 显示“未知”且不算阻塞、`blockedBy` 指向已完成项不显示“被阻塞”、空/无快照/`truncated` 均不占位、展开状态跨轮询保持（我自己构造 `realtime` tick 的 rerender 验证：`open=true` 保持）。位置经 `isBefore(bar, .chat-composer)` + `bar.parentElement === .chat-footer` + `bar.nextElementSibling === .chat-composer` 三重确认。

### 3.5 诚实性——已核对（发现 1 项未记录的路径 + 2 项未记录的降级）

修复者自查里写明并被我用不同方法独立复现的：

- 借用 `createdAt` 当排序锚点（`divider.createdAt === 下一条消息.createdAt ≠ at`）✅ 实测；
- 每段 `Worked for` 共用整轮时长：两段 `title` 实际都是 `Worked for 21s`（含工具的那段可见文案是阶段动词，不显示数字）✅ 实测；
- `at: 0` 共享展开状态：我构造两条 `at: 0` 分界，打开第一条后第二条也 open → **该降级真实存在**，与代码注释/记录一致 ✅；
- §3.3 的"turn 状态取最后一条真实消息"是 DOM 不可见修复：我把该修复回退（变异 M9），**0 个测试失败**，与修复者自述一致 ✅ 未把未验证写成已验证。

未写进的（见 §4）：`nextId` 缺失/非数字会静默丢弃整份快照、展开 todo 条会遮挡正文尾部、客户端不限制渲染行数。

### 3.6 测试质量——反向验证通过（9 个变异）

对 `/tmp/review/mut` 注入变异后，修复者的测试与我的测试各自失败数：

| 变异 | 修复者测试失败 | 我的测试失败 |
| --- | --- | --- |
| M1 忠实复现 `9af9eac` 旧插入路径（组追加到段末） | 6（含 `keeps the Worked for group above the turn's final answer`） | 7 |
| M2 `segmentOutputLimit` 改成"整段全折叠"（正文被吸进组） | 8 | 4 |
| M3 取消分段（分界不再是边界） | 8 | 5 |
| M4 分界保持 raw part（不渲染成横线） | 18 | 15 |
| M5 reader 忽略 `firstKeptEntryId` | 4 | 4 |
| M6 todo 条保留 tombstone | 2 | 2 |
| M7 divider-only turn 造 `Worked for` | 1 | 1 |
| M8 分界丢掉借用锚点（改用压缩时间） | 2 | 5 |
| M9 回退 `lastTimedMessage` 修复（DOM 不可见） | **0**（与自述一致） | 0 |

结论：**新增断言是真的可证伪**，不是只数类名。存在使用类名计数（`querySelectorAll(".work-group")).toHaveLength(n)`）的弱断言，但关键顺序用例都带文档位置断言（`compareDocumentPosition` + landmark 序列），M1/M3 这类"只错顺序"的变异确实被抓住。

### 3.7 越界与风险——已核对无问题

- **write set**：修复者自身改动（`git diff 9af9eac..71fe33c`）只落在 `ChatView.tsx`(+101/-27)、`ChatView.test.tsx`(+568)、`pi-session-reader.test.ts`(+104)、其任务记录 —— 与契约一致。契约禁改文件（`toolCatalog.ts`/`panelOpenState.ts`/`turnActivity.ts`/`pane-activity.ts`/`index.ts`/`pi-realtime.ts`/`integrations/`）均未出现在 `git diff --name-status 25a72ab..b201c43` 中。
- **`protocol.ts` 纯新增**：`ChatDividerKind` / `ChatDividerPart` / `TodoTask` / `TodoStatus` / `ChatTodosSnapshot` 均为新增；`ChatPart` 只是并上 `| ChatDividerPart`；`ChatSnapshot` 只加可选 `todos?`。无删除行、无既有字段语义变更。
- **特征与修复的可分离性**：`git diff 9af9eac 0a73bc4` 只有 docs（两棵树的 `src` 完全一致）→ 候选里的功能就是被撤回的那一份，没有被悄悄改动；`git diff 9af9eac..b201c43 -- src/server/pi-session-reader.ts src/shared/protocol.ts src/shared/todo-tasks.ts src/web/styles.css` 为空 → 修复没有动功能实现。
- **realtime / 轮询去重 / Pane 切换**：`pi-realtime.ts` 未改；`/api/panes/:paneId/chat` 直接返回 reader 快照，无 response schema 会剥掉新字段；`todos` 每次轮询新对象但 `useMemo` 依赖不变，不产生额外请求；分界消息的 `createdAt` 排序键在同值下依赖 `Array#sort` 的稳定性（ES2019 起规范保证），Pane 切换 + realtime tick 后顺序不变（我的用例与修复者用例都覆盖）。
- **`hydrateManagedAttachments`**：`if (message.role !== "user") return message;` → 分界（assistant）原样通过，不会被剥掉（本人核对代码 `pi-session-reader.ts:512`）。
- **DOM 结构**：`.chat-divider` 的直接父节点是 `div.chat-message.assistant-message`（不是 `<p>`），不存在浏览器重新解析导致移位的问题。

## 4. Findings（按严重程度排序）

### F1

```
Severity: P2
File: src/web/styles.css:1438（.todo-list max-height: 260px）、src/web/components/ChatView.tsx:853（<TodoStatusBar/> 在 .chat-footer 内）、src/web/styles.css:512（.chat-viewport padding-bottom: 176px）
Finding: 展开 todo 条会把 footer 撑高（摘要行 + 列表最多 260px + 内边距 ≈ 300px），但 .chat-viewport 为固定 footer 预留的 padding-bottom 仍是 176px，多出的约 200px 会永久盖住正文尾部且无法滚出来。
Why: .chat-footer 是 position: fixed 的浮层（styles.css:1069），transcript 只能滚到"最后一条消息下方留 176px"。footer 高 ≈ 176px 时刚好；展开 todo 条后 footer ≈ 390px+，最后约 200px 正文被浮层压住，用户无法把它滚到浮层之上（只能折叠 todo 条）。composer 本身不被遮挡。
Evidence: 静态 CSS 推断 + DOM 归属断言（我的用例：bar.parentElement 是 .chat-footer、bar.nextElementSibling 是 .chat-composer，说明它确实长在浮层里、位于 composer 上方）。真实浏览器高度测量本轮 NOT RUN（无授权运行时）。
Suggested direction: 三选一——(a) 打开 todo 条时同步增大 .chat-viewport 的 padding-bottom（例如给 body/footer 加一个 state class）；(b) 把 .todo-list 的 max-height 限制在既有预留空间内；(c) 让 todo 条改用不参与 footer 高度的浮层/popover。修复前建议在真实浏览器确认一次实际遮挡像素。
```

### F2

```
Severity: P3
File: src/shared/todo-tasks.ts:31-35（isTodoDetails）、src/shared/protocol.ts:202（nextId）
Finding: isTodoDetails 要求 details.nextId 必须是 number，否则整份快照被静默丢弃；而 nextId 在 UI/协议里从未被使用（客户端只用 tasks）。
Why: `todo` 扩展换版本或某次调用没有数字 nextId 时，todo 条会整体消失，且没有任何日志/降级提示，排查成本高；这是"用一个未被使用的字段把关一个被使用的字段"。
Evidence: 我的 reader 用例（合成 session）实测：tasks 合法但 nextId 为 undefined / "4" / null 时，snapshot.todos 全部为 undefined；仓库现有测试没有覆盖这条路径。
Suggested direction: 放宽为 `typeof nextId === "number" ? nextId : -1`（或把 nextId 变成可选），只要 tasks 是数组就产出快照；若要保留严格校验，至少在丢弃时打一条 debug 日志，并补一条测试把该行为固定下来。
```

### F3

```
Severity: P3
File: src/shared/todo-tasks.ts:19（128 KiB）、:70-76（超限 → tasks: [] + truncated）
Finding: 设计文档 §4.2 要求超限时"只保留计数并降级"，实现是"整条不渲染"；这一点与设计文档不一致，只在修复者的任务记录 §6.2 里说明。
Why: 触发门槛 128 KiB 按常见任务体积约合 1800+ 项（实测真实上限 56 项），实际不可达，因此影响很小；但不一致本身应被开发者显式确认，而不是只存在于任务记录。
Evidence: docs/chat-compaction-todo-askuser-plan.md:195 与 todo-tasks.ts:75 对比；我的 reader 用例（4000 项）实测得到 {tasks: [], truncated: true}；渲染侧用例确认此时无任何占位。
Suggested direction: 由开发者二选一——接受实现（把"整条不渲染"回写进设计文档 §4.2），或改为只显示不可信计数（需要接受"数字可能不准"）。
```

### F4

```
Severity: P3
File: src/web/components/ChatView.tsx:1497（dividerPanelKey = `divider:<kind>:<at>`）
Finding: 两条同 kind 且都拿不到时间戳（at === 0）的分界共用同一个展开标志，打开其中一条会同时打开另一条。
Why: 只影响降级情形（entry 无可用 timestamp）下的交互，不丢信息、不误报数据。
Evidence: 我的用例构造两条 at:0 分界 → 对第一条派发 toggle 后 `dividers[1].open === true`。代码注释与修复者 §6.4 均已记录。
Suggested direction: 保留现状并接受（推荐），或在 key 里加入分界 entry id（协议里已按 `divider:<entryId>` 生成消息 id，取末段即可）。
```

### F5

```
Severity: P3
File: src/server/pi-session-reader.ts:288-307（neighbourAt 借用相邻 createdAt）、src/web/components/ChatView.tsx:2061-2064（mergeRealtime 去重键 role:createdAt）
Finding: 分界消息借用相邻消息的 createdAt，使其在 `role:createdAt` 去重键下与相邻消息同键；理论上可能挤掉一条毫秒级同值、同角色的"尚未落盘"实时 assistant 消息。
Why: 只有在 kept entry 是 user 消息（分界借用 user 的 createdAt）且恰有一条实时 assistant 消息与之毫秒同值时才会发生；这是既有去重键的弱点，本批次只是略微扩大暴露面。
Evidence: 代码路径核对 + 我的用量（分界在段尾/段首、Pane 切换 + realtime tick）未复现任何消息丢失。修复者已在记录 §6.1 主动披露。**未构造出真实触发场景**，因此不做阻断判定。
Suggested direction: 接受现状（推荐，且跨范围）；若后续要收拾，可把去重键改成 `role:createdAt:id` 或让分界消息不参与实时去重。
```

### F6

```
Severity: P3
File: src/web/components/ChatView.tsx:1570-1615（TodoStatusBar 全量渲染 todos.tasks）
Finding: 客户端对 todo 行数没有上限，服务端上限 128 KiB 仍允许一次性渲染上千个 `.todo-task` 节点（且折叠状态下也在 DOM 里）。
Why: 折叠时同样付出渲染成本；实测 4000 项在 jsdom 下挂载 + 展开约 1.2s。真实上限 56 项时无感（<10ms 量级），故风险低。
Evidence: 我的用例注入 4000 项快照，`document.querySelectorAll(".todo-task").length === 4000`，耗时打印 `TODO-BIG render 1185ms`（jsdom，非真实浏览器）；另实测折叠态（`open=false`）下节点就已经在 DOM 里（`taskNodes=2`）。
Suggested direction: 折叠态不渲染列表内容（`<details>` 的 children 仍会进 DOM，可改为展开后才渲染），或给列表做窗口化/截断 + 「还有 N 项」提示。
```

### F7

```
Severity: P3（既有问题，非本批次引入）
File: src/web/components/ChatView.test.tsx:91-93（promptCalls 过滤 `String(url).includes("/prompt")`）、:145（toHaveLength(1)）
Finding: 该辅助函数同时匹配 `/prompt` 与 `/api/prompt-delivery/events`，使断言对 trace 上传时机敏感；机器负载高时会偶发失败。
Why: 会让「157 tests 全绿」这条证据打折（我的一次变异运行里它失败过 1 次，同一候选 8 次干净运行 0 失败）。
Evidence: dc8282c 里该 helper 与断言已存在（`git show dc8282c:src/web/components/ChatView.test.tsx | grep promptCalls`）；失败信息为 `expected [ [ … ], [ … ] ] to have a length of 1 but got 2`；在负载下复现 1 次、干净运行 8/8 通过，单独跑该用例 5/5 通过。
Suggested direction: 把过滤条件收紧为 `/\/prompt$/`（或排除 `/prompt-delivery/`），顺带检查 :176 处 `toHaveLength(2)` 的同类依赖。非本批阻断项。
```

### F8

```
Severity: P3
File: src/server/pi-session-reader.ts:254-268（keptIndex 取自 branchIndexById）
Finding: 当 firstKeptEntryId 指向一个不产生消息的 entry（例如 toolResult）时，分界会顺延到下一条已渲染消息之前，语义边界不精确。
Why: 语义上"保留段起点"落在工具结果上时，横线会画在它所属的 assistant 消息之后，读者会以为压缩点更靠后。
Evidence: 我的 reader 用例（`m1, m2, toolResult, m3, compaction(firstKeptEntryId=toolResult)`）实测输出 `m1, m2, divider:c1, m3`；修复者已用测试固定该降级（§2.3.4）。
Suggested direction: 保留并接受（推荐）；若要精确，可把 keptIndex 向前解析到最近一个会产生消息的 entry。
```

### F9

```
Severity: P3（信息项，未发现用户可见影响）
File: src/web/components/ChatView.tsx:1778-1786（timedMessages / lastTimedMessage）、src/web/turnActivity.ts:50-62（latestAssistantTurn 取 turn[0].id）
Finding: 分界作为独立 assistant 消息，会改变"最后一段 assistant run"的首条 id；当分界落在 run 头部时 latestTurn.id 变化，turnActivity 的 latch 会被重置。
Why: 该 latch 只影响 useLatestTurnActivity 返回的 running（`settled` 在 ChatView 中未被使用），而 running 的判定是 fail-open 的，未找到可观察差异。
Evidence: 变异 M9（回退 lastTimedMessage 修复）0 个测试失败；`grep settled` 显示它只在 turnActivity 内部使用；`[data-status]` 序列在有分界的 turn 上与无分界时相同（`["u1=-","turn:a1=-"]`）。修复者已在 §3.3、§6.3 如实登记。
Suggested direction: 不需动作；仅作为后续 review 的背景信息。
```

## 5. 明示「已核对无问题」的重点项

- 顺序（最高优先）：见 §3.1，独立两套 DOM 方法 + 变异 M1/M3 反向验证。
- 分界语义：见 §3.2，覆盖开头/中间/结尾/连续/两端独立判定/`firstKeptEntryId` 三态。
- 回归对照：见 §3.3，16 形状逐字节一致；新增断言在 `dc8282c` 通过、在 `9af9eac` 失败。
- todo 条：见 §3.4。
- 诚实性：见 §3.5，含 `at:0` 共享状态实测。
- 测试质量：见 §3.6，9 个变异。
- 越界与风险：见 §3.7。
- `protocol.ts` 只做新增：`git diff 25a72ab..b201c43 -- src/shared/protocol.ts` 逐行核对，无删除/无既有字段改写。
- 不遮挡 composer：见 §3.4/§F1 —— composer 本身未被遮挡；被遮挡的是正文尾部（F1）。

## 6. NOT RUN

| 项目 | 原因 |
| --- | --- |
| 真实浏览器视觉验收（横线样式、todo 条实际高度与遮挡像素、hover 时长标签） | 需授权的隔离运行时与端口；按约定不跑 `npm run dev`。F1 的结论是静态 CSS 推断 |
| 真实 Pi session / 真实 transcript 校验（`compaction`、`branch_summary`、`todo` 的真实分布与极端体积） | 读真实 transcript 需开发者明确许可；本轮全部为合成 fixture |
| 真实 Pane / session / companion bridge 集成验收 | 未授权 |
| 56 项以上真实快照的浏览器性能 | 无授权运行时；仅做了 jsdom 合成测量 |
| `npm ci` | 机器上依赖已就绪，未重复执行（`npm test/typecheck/build` 均基于现有 `node_modules`） |

## 7. 剩余风险

1. **F1 的遮挡幅度是静态推断**，真实浏览器下可能略大或略小；这是唯一"用户会看到"的新问题。
2. 真实 session 里 `firstKeptEntryId` 是否总在分支上、`compaction` 与 `branch_summary` 的共存密度，仍未在真实数据上验证（设计文档 §9.4 亦列为未知项）。
3. `mergeRealtime` 去重键（F5）的暴露面略有扩大，未构造出触发场景。
4. 运行中的 turn 若以分界 part 结尾，其上方的 live reasoning 会短暂显示 `Thinking` 而非 `思考中`（上游 assistant-ui 只标记最后一个 part）；修复者已用测试固定，我确认该形状在两棵树上行为一致（`running-*` 形状 diff 为空）。

## 8. 独立判断

- **能否合入 `main`：可以合入（无阻断）。**
- 依据：两个原始问题均已用与修复者不同、且可证伪的方法复核——顺序回归在真实 `9af9eac` 上复现（6 条顺序断言失败）、在本候选上全绿；无分界/无 todo 的既有行为在 16 个形状上与 `dc8282c` 逐字节一致；新增断言在变异下确实会失败；改动未越界。
- **建议在合入前由开发者明确接受的三件事**（都是已记录降级，不改变我的"可合"判断）：
  1. F1（P2）展开 todo 条遮挡正文尾部——接受、或安排一个小的后续修复；不要把它当成"已验收无问题"。
  2. F2/F3/F8 的降级语义（`nextId` 把关、超限整条不渲染、kept entry 非消息时横线顺延）——接受，否则需先改。
  3. F7 是既有测试脆弱点，非本批引入，不应作为本候选的阻断项。
- 本轮没有任何 P0/P1。合入后建议补一次真实浏览器/真实 session 验收，用于确认 F1 的实际遮挡并校验真实数据形状。
