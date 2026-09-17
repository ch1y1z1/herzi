# Worker 任务契约：压缩分界 + todo 状态条的系统性自查与修复

- 状态：**第一轮自查/修复 + 第二轮 F1/F2 + 第三轮 F-A/F-B/F-D/F-E 均已修复并本地验证完成，待同一独立 Reviewer 聚焦复验**（详见文末三份执行记录）
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

---

# 第二轮：Reviewer findings F1 / F2 处理记录（2026-09-17）

- 状态：**F1、F2 已修复并本地验证完成，待同一独立 Reviewer 复验**
- 依据：独立复审记录 `/Users/chiyizi/.herdr/worktrees/herzi/review-20260917-compaction-fix/.agents/tasks/20260917-compaction-review.md`（只读；F1 = P2 遮挡，F2 = P3 用未使用字段把关）；开发者决定「修完这两项 → 同一 Reviewer 复验 → 批准合入」
- 改动范围：`src/shared/todo-tasks.ts`、`src/shared/protocol.ts`（仅放宽）、`src/web/components/ChatView.tsx`、`src/web/styles.css`、`src/web/components/ChatView.test.tsx`、`src/server/pi-session-reader.test.ts` + 本记录。未碰 `toolCatalog.ts` / `panelOpenState.ts` / `turnActivity.ts` / `pane-activity.ts` / `src/server/index.ts` / `pi-realtime.ts` / `integrations/`
- 未运行 `npm run dev`、未操作真实 Pane、未 merge/rebase/push、未新增 production dependency

## 1. F1：展开 todo 条遮挡正文尾部（P2）

### 1.1 方案与理由

原来的 `.chat-viewport` 写死 `padding-bottom: 176px`，而 `.chat-footer` 是 `position: fixed` 浮层；todo 条展开后 footer 变高，多出来的部分永久压住正文尾部。修法：**测量 footer 实际占用的空间，写进 CSS 变量，`padding-bottom` 跟随它**。

两点必须说明的偏离/取舍（都与「更准确」有关，不是简化）：

1. **变量含义是 footer 的「inset」，不是 footer 的「height」**（变量名因此是 `--chat-footer-inset`，而不是建议里的 `--chat-footer-height`）。
   理由：footer 是相对**窗口**定位的（`.chat-footer { bottom: 35px }`），而正文滚动容器的底边在窗口上方 19px（`.app-shell` 18px padding + `.app-window` 1px border），两者相差 16px。正文真正要让出的空间是 `footer 高度 + 16`，只预留高度会少 16px。
   代码不写死这 16px，而是直接量 `viewport.getBoundingClientRect().bottom - footer.getBoundingClientRect().top`——即「footer 顶边到正文底边的实际距离」，与窗口尺寸、响应式断点（移动端 `.chat-footer { bottom: 16px }`）、app 外壳 padding 无关，窗口缩放时也自动跟着变。
2. **下界保留 176px**：`reserve = max(measured, 176)`。这样改动只可能让正文更可见、绝不会比改动前更少（176 是已在生产上跑的常量，用它兜住「我们对布局的判断可能有偏差」的风险）。todo 条撑高 footer 后，实测值超过 176，预留随之上浮——这正是 F1 要修的部分。

### 1.2 回退策略（不依赖 ResizeObserver 的那条路）

- 预留值**本身从不依赖观测**：当无法得到「活的」测量时，直接用由已知状态算出的保守值：
  - 无 todo 条：`176px`（原常量）；
  - 渲染了 todo 条：`176 + 320 = 496px`，其中 320 = `.todo-list` 的 `max-height: 260px` + 条的 summary 行、边框、外边距、列表内边距（上取整，宁多不少）。
- 「没有活的测量」= ①没有 `ResizeObserver`，或 ②footer 报告高度 ≤ 0（首帧、隐藏面板、jsdom 都属此类）。**在无可观测时故意预留展开后的最坏值**，因为那种情况下后续展开不会再有任何回调来修正预留。
- 诚实说明：本应用**整体**其实还离不开 `ResizeObserver`——`assistant-ui` 的 `ViewportFooter` 会无条件 `new ResizeObserver(...)`（我在测试里把全局置为 `undefined` 时，component 直接抛 `ResizeObserver is not a constructor`）。所以「浏览器完全没有 ResizeObserver」这条分支目前不可达，它是防御性守卫（让**我们自己的**代码不会抛，并保证预留保守）。**能被断言的回退路径**是 ②（无可用测量），已在 jsdom 下直接断言（见 §3）。

### 1.3 实现要点

- `useChatFooterInset(viewport, footer, reserveTodoBar)`：`ResizeObserver` 同时观测 footer 与 viewport（footer 变高、窗口缩放导致 pane 底边移动都会重算），回调里 `getBoundingClientRect` 取 inset 并 `Math.max(inset, 176)`，写入 `viewport.style.setProperty("--chat-footer-inset", ...)`。
- footer / viewport 元素用 `useState` 承载（不是 `useRef`）：元素被替换时 effect 会重跑，两个元素都就位后立即生效。
- `reserveTodoBar` 由父组件的 `visibleTodoTasks.length > 0` 提供；tombstone 过滤上移到 `ChatView`，`TodoStatusBar({ tasks })` 只负责渲染。**交互语义未变**：默认折叠、空/只有 tombstone/降级快照时不渲染、展开状态仍走 `panelOpenState`。
- CSS：`.chat-viewport` 保留原 `padding` 简写（176px 作为文档化的旧值），下一行覆盖 `padding-bottom: var(--chat-footer-inset, 176px)`——变量缺失（首帧）时仍用 176px。

### 1.4 只能靠真实浏览器验证的部分

- **实际遮挡像素、展开前后「最后一条消息与 composer 之间的留白」在真实布局下的数值**：`NOT RUN`。jsdom 不做布局（所有 rect / offsetHeight 为 0），本轮只能断言 CSS 变量与 CSS 规则，不能断言像素。开发者会另做 browser-use 测量。
- 需要开发者确认的一点：`reserve = max(实测 inset, 176)` 在展开态会给出「恰好等于遮挡区」的预留；如果实测发现展开态希望保留和折叠态一样的视觉留白，只需把下界（或一个附加常量）调大——这是常量调整，不是结构问题。

## 2. F2：用未使用的字段把关有用的字段（P3）

- `isTodoDetails()` 不再要求 `nextId`：只要 `tasks` 是数组就认。`nextId` 允许缺失 / 非数字。
- 类型只做放宽：`ChatTodosSnapshot.nextId` 由必填 `number` 改为可选 `number`（纯放宽，无既有字段语义变化）；`TodoDetails.nextId` 由 `number` 改为可选 `unknown`。
- **不造数字**：非数字的 `nextId` 直接**省略**，没有用 `-1` 之类的占位（Herzi 从不读它，编一个数是关于扩展的断言）；`buildTodoSnapshot` 的降级分支（超 128 KiB）同样只带上真实存在的 `nextId`。
- 现有的 `nextId` 直通用例（真实数字 9 / 4001 等）继续通过，行为不回归。

## 3. 可证伪验证（两次实测）

同一份测试文件、同一命令，只换代码树（`/tmp/herzi-f1f2-prefix` = `git archive 6212c4b`，即本轮修复前的 HEAD）：

### 3.1 F1 修复前失败 → 修复后通过

```bash
# 修复前
npx vitest run src/web/components/ChatView.test.tsx -t "ChatView footer reservation"
# Tests  5 failed | 46 skipped (51)
#   × follows the space the fixed footer covers
#   × never reserves less than the previous constant
#   × reserves the conservative height while the footer reports no layout
#   × keeps the base reservation when the todo bar renders nothing
#   × keeps the stylesheet wired to the footer inset variable
```

关键原文（修复前根本没有这个 CSS 变量）：

```
FAIL … > follows the space the fixed footer covers
AssertionError: expected '' to be '496px' // Object.is equality
 ❯ src/web/components/ChatView.test.tsx:2005:30
      expect(footerInsetVar()).toBe("496px");
```

```
FAIL … > keeps the stylesheet wired to the footer inset variable
AssertionError: expected '\n  width: 100%;\n  height: 100%;\n\n…'
                to contain 'padding-bottom: var(--chat-footer-inset, 176px)'
```

修复后同一命令：`Tests 5 passed | 46 skipped (51)`。

这 5 条分别钉住：①实测 inset 跟随（480px → 600px，且首帧用保守值 496px）；②下界 176px 不被突破（inset=20 时仍预留 176）；③无可用测量时按「基础 + 列表上限」保守预留（断言 ≥ 176+260，且条仍默认折叠）；④没有 todo 条（含只有 tombstone）时保持 176px；⑤样式表确实消费该变量（jsdom 不解析 `var()`，所以直接断言 `.chat-viewport` 规则文本，否则「组件写变量」与「布局用它」可以各错一半而无人发现）。

### 3.2 F2 修复前失败 → 修复后通过

```bash
# 修复前
npx vitest run src/server/pi-session-reader.test.ts -t "keeps a snapshot whose nextId"
# Tests  1 failed | 21 skipped (22)
```

```
FAIL … > keeps a snapshot whose nextId is missing or not a number
AssertionError: missing: expected undefined to deeply equal [ { id: 1, subject: '任务', …(1) } ]
 ❯ src/server/pi-session-reader.test.ts:696:43
      expect(snapshot.todos?.tasks, name).toEqual([...]);
```

修复后：`Tests 1 passed`。该用例逐一覆盖 `nextId` 为 `undefined` / `"4"` / `null` 三种情况：都能产出快照、tasks 正确、`updatedAt` 正确、`truncated` 未置、且不造 `nextId`。

诚实标注：同批新增的组件用例 `renders a snapshot that carries no nextId`（断言计数与展开列表正常渲染）**在修复前后都通过**——客户端本来就不读 `nextId`，所以它只能作为「客户端确实不依赖该字段」的回归护栏，不是 F2 的证伪证据；F2 真正被证伪的是服务端「快照被整份丢弃」那条路径。

## 4. 验证结果（本轮修复后的 HEAD）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 目标测试（服务端） | `npx vitest run src/server/pi-session-reader.test.ts` | **PASS** 22/22 |
| 目标测试（组件） | `npx vitest run src/web/components/ChatView.test.tsx` | **PASS** 51/51 |
| 全量测试 | `npm test` | **PASS** 15 files / **164 tests**（上一轮 157，本轮 +7） |
| 类型检查 | `npm run typecheck` | **PASS**（exit 0） |
| 构建 | `npm run build` | **PASS**（仅既存 chunk 体积警告） |
| 真实浏览器遮挡像素 / 视觉留白 | browser-use（开发者） | **NOT RUN** |
| 真实 Pi session / 真实 Pane 验收 | — | **NOT RUN** |

## 5. 本轮新增的未决限制

1. **F1 的预留是「恰好等于遮挡区 + 176px 下界」**：展开态下没有额外的视觉留白（折叠态保留下界 176px，因此折叠态外观不变）。若真实浏览器测量后希望展开态也留白，调整常量即可。
2. `assistant-ui` 无条件使用 `ResizeObserver`，因此「完全没有 ResizeObserver 的浏览器」目前无法渲染 ChatView；我们自己的「无观测」回退仍是保守的，且「无可用测量」路径已被断言（§1.2）。
3. F3（超 128 KiB 整条不渲染）、F4（`at: 0` 共享展开状态）、F5（`role:createdAt` 去重键）、F6（客户端不限制 todo 行数）、F7（`promptCalls()` 断言脆弱）、F8（kept entry 非消息时分界顺延）、F9（turnActivity latch）本轮**未处理**：开发者只要求先处理 F1、F2，其余仍按 Reviewer 记录的降级/遗留登记，待开发者决定。

## 6. 交接

- 建议复验重点：`useChatFooterInset()` 的 inset 语义与 176px 下界、回退值（176 / 496）与「无可用测量」判据、`TodoStatusBar` 改为接收 `tasks` 后交互语义是否完全不变、`ChatTodosSnapshot.nextId` 放宽后是否仍无既有字段语义变化。
- 本分支未 push；合入 `main` 需开发者逐批批准。

---

# 第三轮：Reviewer 第二轮 findings F-A / F-B / F-D / F-E 关闭记录（2026-09-17）

- 状态：**4 项 P3 已处理并本地验证完成，待同一 Reviewer 聚焦复验**
- 依据：`/Users/chiyizi/.herdr/worktrees/herzi/review-20260917-compaction-fix/.agents/tasks/20260917-compaction-rereview.md` §4（F-A / F-B / F-D / F-E）与 §3.1.4 / §3.1.5（只读）
- 改动范围：**仅** `src/web/components/ChatView.tsx`、`src/web/components/ChatView.test.tsx` + 本记录（F-C 未做，按开发者指示本轮只关这 4 条）
- 未运行 `npm run dev`、未操作真实 Pane、未 merge/rebase/push、未新增依赖

## 1. F-D：首帧瞬态（effect 改为 layout timing）

- 改动：`useChatFooterInset` 的 `useEffect` → `useLayoutEffect`（新增 `useLayoutEffect` import）。注释写明原因：todo 条的展开状态存在 `panelOpenState` 里、**跨重挂载保留**，而 ChatView 在 Terminal↔Chat 与 Pane 切换时被 `key={pane.id}` 重挂载；被动 effect 的时间点在提交之后，重挂载后的首帧会先用样式表的 176px 回退。CSR-only，没有 SSR 分支。
- **验证边界（重要，不做假测试）**：jsdom 下无法用断言区分两者。我先按开发者建议尝试写「变量在提交阶段就写好」的断言——用 `createRoot` + `flushSync` 渲染且**不**包在 testing-library 的 `act()` 里，期望被动 effect 仍处于 pending：
  - 该断言在 `useLayoutEffect` 下通过，**把实现改回 `useEffect` 后同样通过**（React 的 `flushSync` 在同步提交后也会把 pending 的被动 effect 冲刷掉）；
  - 也就是说这条断言无法证伪，属于「假测试」→ **已删除**（连同 `flushSync` / `createRoot` / `act` 的 import 一起），没有留在测试集里。
  - 结论：**F-D 由代码审阅确认（一行改动 + 注释说明），真实浏览器下一帧的可见性 `NOT RUN`**，请审阅者按此口径复验；若真实浏览器仍能看到残留遮挡，优先改这里而不是改常量。

## 2. F-A：观测绑定（P3，测试缺口）

- 断言位置：新增用例 `watches the pane's bottom edge with the same observer as the footer`。
- 断言写法严格按 Reviewer 的要求绑定「观测 `.chat-footer` 的那个 observer」：`observers.some(o => o.targets.has(footer) && o.targets.has(viewport))`，即**同一个实例**同时观测两者；没有写成「存在某个观测 viewport 的 observer」（assistant-ui 自己也观测 viewport，那样抓不住回归——Reviewer 已在 F-A 里实测说明）。
- 同一条用例还加了行为层断言（超出「只读结构」的补强）：只把 **pane 底边**下移 100px（footer 尺寸不变）、只通知观测 viewport 的 observer，预留必须从 `480px` 变成 `580px`。这直接钉住「窗口 resize / 窄屏 sidebar 时预留会跟着走」这一 F-A 关心的场景。
- 为写这条断言，测试的假 ResizeObserver 从「收集 footer 回调」升级为记录**每个实例的 targets + callback + disconnected**（`stubResizeObserver()` / `observersWatching()` / `notifyObservers()`），原有 5 条用例改用同一套 API，语义不变。
- **可证伪验证（实测）**：

  ```bash
  # 在 /tmp/herzi-fix3-mut（工作区 src 的副本）里删掉 `observer.observe(viewport);`
  npx vitest run src/web/components/ChatView.test.tsx -t "ChatView footer reservation"
  # Tests  1 failed | 6 passed | 46 skipped (53)
  #   × watches the pane's bottom edge with the same observer as the footer
  # 原文：AssertionError: expected false to be true  ❯ ChatView.test.tsx:2048
  # 还原后同一命令：Tests 7 passed | 46 skipped (53)
  ```

  即只有这一条失败、其它 6 条不受影响 → 断言与实现严格对应。

## 3. F-B：observer teardown（P3，测试缺口）

- 断言位置：新增用例 `disconnects its observers when the view is torn down`。
- 断言：unmount 之前先确认「观测 footer 的 observer 尚未 disconnected」（防止假阳性），`view.unmount()` 之后断言这些 observer **全部** `disconnected === true`。
- **可证伪验证（实测）**：

  ```bash
  # 把 `return () => observer?.disconnect();` 改成 `return () => undefined;`
  npx vitest run src/web/components/ChatView.test.tsx -t "ChatView footer reservation"
  # Tests  1 failed | 6 passed | 46 skipped (53)
  #   × disconnects its observers when the view is torn down
  # 原文：AssertionError: expected false to be true  ❯ ChatView.test.tsx:2079
  # 还原后：Tests 7 passed | 46 skipped (53)
  ```

## 4. F-E：样式表断言的 cwd 依赖（P3，可移植性）

- 改动：`readFileSync(path.join(process.cwd(), "src/web/styles.css"))` → `readFileSync(path.join(import.meta.dirname, "../styles.css"))`，锚定到测试文件自身所在的被测树。
- 尝试过的另外两种写法（都不可用，记录以免后来者重踩）：
  1. `new URL("../styles.css", import.meta.url)`：Vite 会把**字面量**形式的 `new URL(..., import.meta.url)` 重写成 dev-server URL，实测解析成 `http://localhost:3000/src/web/styles.css`，`readFileSync` 报 `TypeError: The URL must be of scheme file`。（把相对路径放进变量后它就不再被改写，但需要额外解释这条 Vite 行为，故改用 `import.meta.dirname`。）
  2. `import stylesheetSource from "../styles.css?raw"`：vitest 的 CSS 处理下该模块内容是**空字符串**（`rawLength: 0`），断言直接失效。
  `import.meta.dirname` 在 vitest 转换后的模块里可用（`@types/node` 也声明了它，`npm run typecheck` 通过），并且 Vite 不会改写它；jsdom 环境的 `document.baseURI` 是 `http://localhost:3000/`，但 `import.meta.url` / `import.meta.dirname` 仍是真实 file 路径（已实测打印确认）。
- **可证伪验证（实测，两次都从 `cwd=/tmp` 启动、root 指向被测树）**：

  ```bash
  cd /tmp
  # 修复前：被测树 = /tmp/herzi-fix3-prefix（git archive 8fe5b3f，含 process.cwd() 版本的用例）
  vitest run --config /tmp/herzi-fix3-prefix/vitest.cwd.config.ts ChatView.test.tsx -t "keeps the stylesheet wired"
  # Tests  1 failed (1)
  # Error: ENOENT: no such file or directory, open '/private/tmp/src/web/styles.css'
  #        ❯ ChatView.test.tsx:2092  path.join(process.cwd(), "src/web/styles.css")

  # 修复后：被测树 = /tmp/herzi-fix3-mut（当前工作区 src 的副本），同一 cwd
  HERZI_TEST_ROOT=/tmp/herzi-fix3-mut vitest run --config /tmp/herzi-fix3-prefix/vitest.cwd.config.ts \
    ChatView.test.tsx -t "keeps the stylesheet wired"
  # Tests  1 passed | 52 skipped (53)
  ```

  （那是为了固定 `root` 而临时写的 vitest 配置，放在 /tmp 的临时树里，没有进入工作区。）

## 5. 验证结果（本轮工作区）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 目标测试（组件） | `npx vitest run src/web/components/ChatView.test.tsx` | **PASS** 53/53 |
| 目标测试（服务端，未改动） | `npx vitest run src/server/pi-session-reader.test.ts` | **PASS** 22/22 |
| 全量测试 | `npm test` | **PASS** 15 files / **166 tests**（基线 164，本轮 +2：F-A、F-B 各一条） |
| 类型检查 | `npm run typecheck` | **PASS**（exit 0） |
| 构建 | `npm run build` | **PASS**（仅既存 chunk 体积警告） |
| F-A / F-B 变异验证 | 见 §2 / §3 | 各自**只**让对应那一条失败 |
| F-D 真实浏览器首帧可见性 | — | **NOT RUN**（jsdom 无法区分 `useLayoutEffect` 与 `useEffect`，已如实记录，见 §1） |
| 真实 Pane / session 验收 | — | **NOT RUN** |

## 6. 本轮未做（按开发者指示不扩大）

- F-C（`promptCalls()` 过滤 `/prompt` 同时命中 `/prompt-delivery/events` 导致负载下偶发失败）：既有测试脆弱点，非本批引入，本轮未改。
- 上轮登记、仍未处理的降级项：超 128 KiB 整条不渲染、`at: 0` 共享展开状态、`role:createdAt` 去重键、客户端不限制 todo 行数、kept entry 非消息时分界顺延、turnActivity latch（背景项）。
