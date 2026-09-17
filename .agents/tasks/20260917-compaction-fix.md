# Worker 任务契约：压缩分界 + todo 状态条的系统性自查与修复

- 状态：**自查 + 修复完成，本地验证完成，待独立 Reviewer 复审**（详见文末「执行记录」）
- 角色：Worker（单 Agent，**新 Agent，不是原实现者**）
- Base：`9af9eac`（原实现 commit，位于分支 `agent-20260917-compaction-todo`）
- Branch：`agent-20260917-compaction-fix`
- Worktree：`/Users/chiyizi/.herdr/worktrees/herzi/agent-20260917-compaction-fix`
- 设计依据：`docs/chat-compaction-todo-askuser-plan.md` §2 / §4 / §8
- 原任务契约：`/Users/chiyizi/.herdr/worktrees/herzi/agent-20260917-compaction-todo/.agents/tasks/20260917-compaction-todo.md`（可读，勿改）
- 事故记录：`.agents/tasks/20260917-compaction-todo-batch.md`

## 背景（必读，决定了本任务的性质）

上一版实现（`9af9eac`，就是你现在的 base）**未经开发者批准就被合入 main，随后被发现质量不合格并被撤回**。开发者已确认：本批次必须做**系统性自查 + 修复**，然后由**独立 Reviewer** 复审，再向开发者请求批准。

已知缺陷（已复现）：

**B1 `Worked for` 组渲染到了正文下方。**
- 现象：一个完成 turn `thinking → tool → 最终文本`，渲染顺序变成 `文本 → Worked for 组`，正确顺序应是 `组 → 文本`。
- 证据：探针量到 `activity-group index 347`、`final text index 315`；`body.textContent` 为 `问题 → 这是最终答复 → 已运行1 条命令 Thinking…`。
- 根因：`combineAssistantTurn` 改成「循环结束后 `if (items.length) pushWorkGroup(segment, items)`」，而改动前是在**第一个被吸收的 work part 处**插入组，于是组落到 content 末尾。
- 测试缺口：现有测试**没有**断言「组与正文的相对顺序」，所以 137 个测试全绿也没抓住。

## 任务

### 一、系统性自查（必须逐项做，并把结论写进任务记录）

对 `9af9eac` 引入的全部改动做一次从头到尾的行为审计，至少覆盖：

1. **顺序**：组与正文、组与分界、组与图片、组与工具行的相对顺序；多段（有分界）时的顺序；`groupConsecutiveTools()` 在分段后的行为。
2. **分段**：分界在 turn 开头/中间/结尾；连续多条分界；分界恰好是 turn 最后一条消息；分界与 `activityLimit`（最后一个输出）交叉时的归属是否正确（分界不能把正文吸进组，也不能把 work part 留在组外）。
3. **分界位置**：`firstKeptEntryId` 在分支上 / 不在 / 缺失三种情况；分界消息借用相邻消息 `createdAt` 的排序是否在轮询、realtime 合并、Pane 切换下稳定；一个 turn 里多个分界时 segment id 是否唯一。
4. **todo 条**：快照为 `pending/in_progress/completed` 混合、只有 tombstone、未知 status、`blockedBy` 指向不存在 id、降级（`truncated`）时的渲染；空/无快照不占位；与非 Pi Pane、未识别 Pane 共存时不影响布局。
5. **回归**：无压缩、无 todo 时的原有行为是否与 `dc8282c` 完全一致（**用 `dc8282c` 作对照基线**，而不是凭记忆）。
6. **降级与诚实**：所有近似是否都写清楚（不得把借用时间戳当真实压缩时间、不得按分界切分造时长、不得猜 todo 状态）。

自查结论必须写成「发现 / 证据（命令或 DOM 断言）/ 是否修复」的列表；**没问题也要写"已核对无问题"**，不允许只写结论。

### 二、修复

- 修掉 B1，并修掉自查中发现的所有其它缺陷。
- **必须补上能证伪的测试**，至少包含：
  - **DOM 顺序断言**：`组出现在最终正文之前`（修复前必须失败，请实际验证一次）；
  - 分段/顺序组合：有分界时的顺序是 `组 → 横线 → 组 → 正文`；
  - 分界在 turn 末尾时仍是 `组 → 横线`，不额外造组；
  - 降级路径（快照 truncated、无 todo、无分界）不产生占位或空行。
- 既有 117 个测试以及本批次原有测试必须全部继续通过。

### 三、约束

- write set：`9af9eac` 触动的那些文件（`src/server/pi-session-reader.ts`(+test)、`src/shared/protocol.ts`、`src/shared/todo-tasks.ts`、`src/web/components/ChatView.tsx`(+test)、`src/web/styles.css`），本任务记录，以及你新增的测试文件。**不要改** `toolCatalog.ts` / `panelOpenState.ts` / `turnActivity.ts` / `pane-activity.ts` / `src/server/index.ts` / `pi-realtime.ts` / `integrations/`。
- 可以（也应该）参考 `dc8282c` 的既有行为作为回归基线：`git show dc8282c:src/web/components/ChatView.tsx`。
- 不运行 `npm run dev`；不操作真实 Pi/Herdr 业务 Pane；不 merge / rebase / push；不新增 production dependency；不为让测试变绿而弱化断言。
- **不要合入 main**；你的分支就是候选，后续由独立 Reviewer 复审、再由开发者批准。

## 验证要求

```bash
npm ci            # 若 worktree 无 node_modules
npx vitest run <涉及的目标测试>
npm run typecheck
npm test
npm run build
```

结果明确标记 `PASS` / `FAIL` / `NOT RUN`；对 B1 的顺序断言请给出「修复前失败 / 修复后通过」两次实测输出。

## 交付

- 一个或少量清晰 commit。
- 任务记录中给出：自查清单与逐项结论、每个缺陷的证据与修复方式、两次可证伪验证、未决限制。
- 完成后留在本 Pane；开发者会通知 Integrator 安排独立 Reviewer。

---

# 执行记录（Worker，2026-09-17）

- 状态：**自查 + 修复完成，本地验证完成，待独立 Reviewer 复审**；未 merge / rebase / push，未动 `main`
- 角色：Worker（新 Agent，非原实现者）
- Base：`9af9eac`；对照基线：`dc8282c`（原实现之前、已批准的 main 状态）
- 分支 / worktree：`agent-20260917-compaction-fix` / `/Users/chiyizi/.herdr/worktrees/herzi/agent-20260917-compaction-fix`
- 改动范围：`src/web/components/ChatView.tsx`、`src/web/components/ChatView.test.tsx`、`src/server/pi-session-reader.test.ts`（+1 份临时对照 harness，验证后已删除）+ 本任务记录。未改 `toolCatalog.ts` / `panelOpenState.ts` / `turnActivity.ts` / `pane-activity.ts` / `src/server/index.ts` / `pi-realtime.ts` / `integrations/` / `protocol.ts` / `todo-tasks.ts` / `styles.css`
- 未新增 production dependency；未运行 `npm run dev`；未操作真实 Pane

## 1. 结论摘要

1. **B1 已修复**：`combineAssistantTurn()` 的组不再在循环结束后追加，而是插在「该段第一个被折叠的 part」原来所在的位置，恢复 `dc8282c` 的 `组 → 正文` 顺序。
2. **开发者决策 A 已实现**：分界是真正的段边界，每段各自按「段内最后一次输出」折叠；分界之后的工作行不再以裸行留在组外。无分界时渲染与 `dc8282c` **逐场景等价**（下方 §4.3 机械对照，11 个形状完全一致）。
3. 另修 1 处一致性缺陷（turn 状态取错消息，§3.3），并补 20 个新测试；157 个测试全绿、typecheck / build 通过。
4. 发现并如实记录 **3 项未决限制**（§6），未做任何猜测性补偿。

## 2. 自查清单与逐项结论

方法说明：能写成断言的一律写成测试（下表「证据」列的测试名都在 `ChatView.test.tsx` / `pi-session-reader.test.ts` 中）；行为等价类问题用「同代码 + 同测试跑两棵树」的机械对照，不凭记忆。

### 2.1 顺序

| # | 项目 | 证据 | 结论 |
| --- | --- | --- | --- |
| 1 | 组与正文（B1） | `keeps the Worked for group above the turn's final answer`（`compareDocumentPosition` + landmark 顺序 `["group","text"]`） | **有缺陷，已修复**（§3.1） |
| 2 | 组与分界（中间） | `renders group -> rule -> group -> answer around a mid-turn compaction` → `["group","divider","group","text"]` | 有缺陷（与 1 同源），已修复 |
| 3 | 组与分界（段首） | `puts a divider at the start of a turn above the group it introduces` → `["divider","group","text"]` | 有缺陷（同源），已修复 |
| 4 | 组与分界（段尾） | `keeps a trailing divider below the group without inventing another one` → `["group","divider"]`；`keeps the answer, then a trailing divider…` → `["row","text","divider"]` | 已核对无问题（修复前后都通过） |
| 5 | 连续多条分界 | `renders consecutive dividers without opening an empty segment` → `["group","divider","divider","group"]` | 已核对无问题：空段不建组，段号只在真正建组后递增 |
| 6 | 组与图片 | 机械对照场景 `image-then-text`（两树完全一致） | 已核对无问题：图片仍是 work part，折叠行为与 `dc8282c` 相同 |
| 7 | 组与工具行 | `summarizes a finished turn…` 等既有用例全绿；`does not merge a run of tool rows across a divider` | 已核对无问题；需修的是段归属（§3.2，已按决策 A 改） |
| 8 | 多段顺序 | 同上 2/3/4/5 | 已核对无问题（修复后一致：`组 → 横线 → 组 → 正文`） |
| 9 | `groupConsecutiveTools()` 分段后行为 | `does not merge a run of tool rows across a divider` → `["group","text","toolgroup","divider","group","text","toolgroup"]`，两个 tool-group 不跨分界合并 | 已核对无问题 |

### 2.2 分段

| # | 项目 | 证据 | 结论 |
| --- | --- | --- | --- |
| 1 | 分界在 turn 开头 | `puts a divider at the start of a turn above the group it introduces` | 有缺陷（B1 同源），已修复 |
| 2 | 分界在 turn 中间 | `renders group -> rule -> group -> answer…`（并断言两段 `title` 同为整轮时长） | 有缺陷（同源），已修复 |
| 3 | 分界是 turn 最后一条消息 | `keeps a trailing divider below…`、`renders a divider-only turn as just the rule`（`["divider"]`，无 `Worked for` 伪造行） | 已核对无问题 |
| 4 | 分界与 `activityLimit` 交叉 | `keeps the middle segments…`（`["group","divider","group","text"]`）+ `folds each segment around its own last output`（`["group","text","divider","group"]`） | **有缺陷**：分界之后、turn 末次输出之后的 work part 会留在组外；按开发者决策 A 改为每段独立判定（§3.2） |
| 5 | 正文不得被吸进组 | 上述用例都断言最后的正文 landmark 在组之外 | 已核对无问题 |

### 2.3 分界位置

| # | 项目 | 证据 | 结论 |
| --- | --- | --- | --- |
| 1 | `firstKeptEntryId` 在分支上 | `places the compaction divider before the first kept entry (semantic boundary)`（既有） | 已核对无问题 |
| 2 | 不在分支上 | `falls back to the compaction entry position when firstKeptEntryId is off the branch`（既有） | 已核对无问题 |
| 3 | 缺失 | `falls back … when firstKeptEntryId is missing`（既有） | 已核对无问题 |
| 4 | 被保留 entry 自身不产生消息 | 新增 `puts the divider before the next rendered message when the kept entry has none` | 已核对无问题（记录在案的顺延降级，现已被测试固定） |
| 5 | 借用相邻 `createdAt` 的排序稳定性 | 新增 `keeps the divider above its neighbour through the realtime merge`（`realtimeTick` 合并 + Pane 切换后顺序不变）；`keeps the expanded divider across the 1.5s poll refresh`（既有，轮询） | 已核对无问题：轮询每次重算、结果确定；`mergeRealtime` / `mergePendingUserMessages` 的 `createdAt` 排序是稳定排序，分界与它借用时间戳的那条消息同值，相对顺序不会翻转 |
| 6 | 多分界 segment id 唯一性 | 新增 reader 用例 `keeps both dividers in branch order when they share a first kept entry`（同时断言 message id 全唯一）+ 新增组件用例 `keeps each segment's expanded state separate (unique segment ids)`（打开第 1 段后轮询刷新，第 2 段仍关闭 → 面板 key 未碰撞） | 已核对无问题：`work:<turnId>` / `work:<turnId>:<n>`，`n` 只在真正建组后递增 |
| 7 | 分界 part 进 `hydrateManagedAttachments` | 代码核对：只处理 `role === "user"`，分界是 assistant | 已核对无问题 |

### 2.4 todo 状态条

| # | 项目 | 证据 | 结论 |
| --- | --- | --- | --- |
| 1 | 混合状态、计数、分组、`activeForm` | `shows non-zero counts above the composer and groups the tasks when expanded`（既有） | 已核对无问题 |
| 2 | 只有 tombstone | 新增 `renders nothing when every task is a tombstone`（无条、无空容器、正文无残留文本） | 已核对无问题 |
| 3 | 未知 status | 新增 `keeps an unknown status visible as pending work`（计入「待办」、任务文本仍显示） | 已核对无问题；不猜状态也不丢任务 |
| 4 | `blockedBy` 指向不存在 id | 既有用例（指向 tombstone）+ 新增 `#99`（快照完全不存在）→ 显示「依赖 #99（未知）」且**不算阻塞** | 已核对无问题：无法判定就不判定 |
| 5 | `truncated` 降级 | 既有 `renders nothing for a degraded snapshot…` + 新增 `still renders the divider when the todo snapshot was degraded`（两种降级互不影响） | 已核对无问题（降级表现见 §6.2） |
| 6 | 空 / 无快照不占位 | 既有 `renders nothing without a todo snapshot or with an empty one` + 新增 `leaves no placeholder when there is no todo snapshot and no divider`（无 `.todo-list` / `.divider-detail` / `待办` 文本） | 已核对无问题 |
| 7 | 非 Pi Pane 不影响布局 | 新增 `adds no bar or spacing for a pane that is not a Pi session`（无条；composer 的前一个兄弟不是 todo 条；切回 Pi Pane 仍无条） | 已核对无问题 |
| 8 | `todo` 不计入组头计数 / 阶段动词 | 既有用例 `… todo rows are displayed but never counted (decision D2)` 继续通过；未改 `toolCatalog.ts` | 已核对无问题 |

### 2.5 回归（对照 `dc8282c`，不凭记忆）

| # | 项目 | 证据 | 结论 |
| --- | --- | --- | --- |
| 1 | 既有 117 个测试 | `npx vitest run`（全量） | 全绿，见 §5 |
| 2 | B1 顺序断言是否只是「新期望」 | 把**本任务的测试文件**复制进 `dc8282c` 的代码树（`git archive dc8282c`）跑 `-t "keeps the Worked for group above the turn's final answer"` | **在 `dc8282c` 上 PASS** → 该断言编码的是原有正确行为，9af9eac 才是回归 |
| 3 | 无分界渲染是否与 `dc8282c` 等价 | 临时 harness（11 个无分界形状：reasoning/tool/text 组合、纯文本、纯思考、双消息、纯工具、中间输出、输出后工具、图片、空白文本、运行中、双 turn），记录 `landmarks` + 组内行数 + `worked-row` 数 + 文本 + 组 id 类名，在两棵树各跑一次后 diff | **`identical: True`**（含决策 A 改动**之后**复跑） |
| 4 | 有分界时的组数（原验收条件 3/4） | 既有 `renders no divider and a single group when nothing was compacted`、`breaks a turn into two Worked for groups around a compaction divider` | 继续通过 |

### 2.6 降级与诚实

| # | 项目 | 证据 | 结论 |
| --- | --- | --- | --- |
| 1 | 不得把借用时间戳当真实压缩时间 | reader 用例断言 `divider.createdAt === 后一条消息的 createdAt ≠ at`；part 上的 `at` 才是 entry 时间；UI 只显示 `at`（`.divider-time`） | 已核对无问题 |
| 2 | 不得按分界切分造时长 | 新增断言：两段组的 `title` 完全相同（整轮时长），并读作 `Worked for N` | 已核对无问题（时长是整轮值，不是两段各自的数字） |
| 3 | 不得猜 todo 状态 | 未知状态归「待办」而非映射到猜测值；快照外 `blockedBy` 显示「未知」且不计阻塞 | 已核对无问题 |
| 4 | 摘要长度语义 | `formatSummarySize` = `summary.length` 截断一位小数，标签写「字」而非 tokens；`tokensBefore` 才标 tokens | 已核对无问题 |
| 5 | 无时间戳 | `at: 0` → 不显示时间、不显示展开箭头（无其他内容时渲染为纯横线） | 已核对无问题（既有用例 `renders a bare marker…`） |
| 6 | 体积降级 | `buildTodoSnapshot` 超 128 KiB → `{tasks: [], truncated: true}`，只对最终保留的那一份快照做投影与体积检查 | 已核对无问题（表现见 §6.2） |

## 3. 缺陷清单与修复

### 3.1 B1：`Worked for` 组渲染到正文下方（回归，主缺陷）

- 现象：完成 turn `thinking → tool → 最终文本` 渲染为「文本 → 组」，应为「组 → 文本」。
- 根因：`9af9eac` 把组的插入改成「循环结束后 `if (items.length) pushWorkGroup(segment, items)`」，而 `dc8282c` 是在**第一个被吸收的 work part 处**插入。
- 修复：`foldSegment()` 在需要时**就地**把组 part 推进 `content`（即该段第一个折叠 part 的原位置），`items` 数组仍被组引用、后续继续追加；段结束时只重置状态。
- 测试缺口修复：新增 landmark 顺序辅助函数（按 DOM 文档顺序取最外层 `.work-group` / `.worked-row` / `.chat-divider` / `.markdown-body` / `.reasoning-block` / `.tool-card` / `.activity-group.tool-group`），既有测试只做「类名计数」，看不到相对顺序。

### 3.2 分段归属：分界之后的 work part 留在组外（缺陷，开发者决策 A 后修复）

- 现象：turn 为 `r → tool → 正文 → 横线 → r → tool` 时，横线之后的工作行以裸行渲染、不属于任何组，与契约「分界不能把 work part 留在组外」冲突（该形状下又与 `dc8282c` 的「末次输出之后一律内联」冲突）。
- 决策：把两种方案（A 每段独立判定 / B 保持 `dc8282c` 全局规则）连同渲染预览交给开发者，**开发者选 A**。
- 修复：`parts` 按 `divider` 切成若干段，每段用自己的「最后一次输出」（`segmentOutputLimit`）作为折叠上界；段内无输出则整段折叠，段为空则什么都不做。无分界时只有一段，等价于 `dc8282c`（§4.3 机械验证）。
- 保留的 `dc8282c` 规则：整轮没有任何折叠组、但有真实消息可计时时，仍在**整轮最后一次输出之前**插入一条空 `Worked for` 行（每轮恰好一次）。

### 3.3 turn 状态取自不携带状态的分界消息（一致性缺陷，防御性修复）

- 现象：turn 以分界消息结尾时，`combineAssistantTurn()` 的 `lastMessage = messages.at(-1)` 是分界消息，它既无 `status` 也无 `completedAt`，于是 display message 变成「无状态 turn」。
- 修复：状态与完成时间改从 `timedMessages.at(-1)`（最后一条真实消息）取；无分界时两者相同，行为不变。
- **诚实说明**：实测该差异**当前不影响 DOM**（`useExternalStoreRuntime` 在 `isRunning` 时会给线程最后一条消息赋予 running 状态；我临时回退过这段修复，`[data-status]` 序列完全一致）。因此这是数据一致性修复而非可见缺陷，测试里也不谎称可见。相关观察与上游限制记在 §6.3。

## 4. 可证伪验证（两次实测）

### 4.1 B1：修复前失败 → 修复后通过

同一份测试文件、同一命令，只换代码树（`/tmp/herzi-b1-prefix` = `git archive 9af9eac`）：

```bash
# 修复前（9af9eac 的 ChatView.tsx）
npx vitest run src/web/components/ChatView.test.tsx \
  -t "keeps the Worked for group above the turn's final answer"
```

```
FAIL src/web/components/ChatView.test.tsx > ChatView turn order >
     keeps the Worked for group above the turn's final answer
AssertionError: expected +0 to be truthy
 ❯ src/web/components/ChatView.test.tsx:617:7
  616|       group.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_F…
  617|     ).toBeTruthy();
 Test Files  1 failed (1)
      Tests  1 failed | 44 skipped (45)
```

```bash
# 修复后（本分支）
npx vitest run src/web/components/ChatView.test.tsx \
  -t "keeps the Worked for group above the turn's final answer"
# Test Files 1 passed (1) / Tests 1 passed | 44 skipped (45)
```

修复前的第二个顺序实测（分界在 turn 中间）：

```
FAIL … renders group -> rule -> group -> answer around a mid-turn compaction
AssertionError: expected [ 'group', 'divider', 'text', 'group' ]
                to deeply equal [ 'group', 'divider', 'group', 'text' ]
 ❯ src/web/components/ChatView.test.tsx:651:25
```

`ChatView turn order` 整组在 9af9eac 上：`Tests 6 failed | 6 passed | 33 skipped (45)`；在本分支：12/12 通过。这 6 个失败覆盖 §3.1 与 §3.2。

### 4.2 反向对照：这些断言编码的是 `dc8282c` 的既有行为

```bash
TMP=/tmp/herzi-order-base && mkdir -p $TMP && git archive dc8282c | tar -x -C $TMP
cp src/web/components/ChatView.test.tsx $TMP/src/web/components/
ln -s "$PWD/node_modules" $TMP/node_modules
cd $TMP && npx vitest run src/web/components/ChatView.test.tsx \
  -t "keeps the Worked for group above the turn's final answer"
# Test Files 1 passed (1) / Tests 1 passed | 44 skipped (45)
```

即在**被撤回前的已批准代码**上通过、在被撤回的 `9af9eac` 上失败 → B1 是真实回归，而不是「把测试改成迁就新实现」。

### 4.3 无分界回归：11 个形状机械对照

用临时 harness（已删除）在两棵树记录无分界场景的 DOM landmark 顺序 + 组内行数 + `worked-row` 数 + 文本 + 组类名：

```bash
# 两棵树各跑一次
LANDMARK_OUT=/tmp/herzi-landmarks-base.json npx vitest run src/web/components/order-baseline.test.tsx   # in /tmp/herzi-order-base (dc8282c)
LANDMARK_OUT=/tmp/herzi-landmarks-new2.json npx vitest run src/web/components/order-baseline.test.tsx   # 本分支（决策 A 之后）
# 逐字段 diff → identical: True
```

对照形状（全部无分界）：`reasoning-tool-text`、`text-only`、`reasoning-only`、`two-assistant-messages`、`tools-only`、`intermediate-output`、`output-then-tool`、`image-then-text`、`whitespace-text`、`running-reasoning-tool`、`two-turns`。

## 5. 验证结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 依赖 | `npm ci`（worktree 原本无 `node_modules`） | **PASS** |
| 目标测试（服务端） | `npx vitest run src/server/pi-session-reader.test.ts` | **PASS** 21/21（原 18） |
| 目标测试（组件） | `npx vitest run src/web/components/ChatView.test.tsx` | **PASS** 45/45（原 28） |
| 全量测试 | `npx vitest run` | **PASS** 15 files / **157 tests**（`dc8282c` 基线 117；`9af9eac` 基线 137；本任务 +20） |
| 类型检查 | `npm run typecheck` | **PASS**（exit 0） |
| 构建 | `npm run build` | **PASS**（仅既存 chunk >500 kB 警告） |
| 真实浏览器视觉验收 | — | **NOT RUN** |
| 真实 session 文件校验 | — | **NOT RUN**（读真实 transcript 需开发者明确许可；本轮全部基于合成 fixture + 契约/类型文档形状） |

## 6. 未决限制（不在本轮范围内，如实登记）

1. **分界消息的 `createdAt` 是排序锚点，不是压缩时间**：取相邻真实消息的时间戳（优先后一条、否则前一条、否则该 entry 自己的时间、否则 0）。真实压缩时间在 part 的 `at` 上、UI 单独显示。`mergeRealtime()` 的去重键是 `role:createdAt`，分界消息与相邻消息同键、同角色时理论上可能挤掉一条**尚未落盘**的实时 assistant 消息（毫秒级同值 + 同角色的偶发情形）；这是既有去重键的弱点，本批次只略微提高其暴露面，未改（改它属跨范围）。
2. **todo 快照超 128 KiB 时完全不显示**（`{tasks: [], truncated: true}`）：快照里没有可信的状态计数，与其猜或显示半张列表，选择整条不渲染；设计文档 §4.2 的「只保留计数」无法在不造数字的前提下实现。
3. **运行中的 turn 若以分界 part 结尾，其上方的 live reasoning 会短暂显示 `Thinking` 而不是 `思考中`**：`assistant-ui` 只把 running 消息的**最后一个 part** 标为 running，分界正好占了这个位置；下一个 part 到达即恢复。这是上游行为，无法在本层修好，已用 `shows a divider below an unmodified turn when the marker is not live` 固定（测试注释写明这是被刻意固定的限制）。
4. **每段 `Worked for` 共用整轮时长**（不按分界切分造数字）；**`at: 0` 的同 kind 分界共享展开状态**（面板 key 为 `divider:<kind>:<at>`）；这两条沿用原记录的降级说明，未变。
5. `firstKeptEntryId` 指向不产生消息的 entry 时分界顺延到下一条已渲染消息之前（§2.3.4，已有测试固定）。
6. 真实数据分布仍未穷尽（例如 `firstKeptEntryId` 是否总是落在分支上、`todo` 快照的极端体积），需要开发者许可后才能读真实 session 核对。

## 7. 交接

- 建议 Reviewer 重点检查：`ChatView.tsx` 的 `combineAssistantTurn()` / `segmentOutputLimit()`（决策 A 的段语义与段号唯一性）、`ChatView.test.tsx` 的 landmark 辅助函数是否真的能看见顺序、以及 §6.1 的去重键暴露面是否接受。
- 本分支未 push；合入 `main` 需开发者逐批批准，随后由 Integrator 集成。
