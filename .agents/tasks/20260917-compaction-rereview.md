# 第二轮独立复审执行记录：F1/F2 修复后的候选

- 状态：**复审完成**
- 角色：同一独立 Reviewer（`herzi_reviewer2`；只读产品代码，只写本文件）
- Candidate：`2c546ee` = 上轮候选 `b201c43` + `c4dd3ed`（F1/F2 修复）+ `8fe5b3f`（修复记录）
- 上轮结论（本文件不重写）：`.agents/tasks/20260917-compaction-review.md`（可合入、无阻断、无 P0/P1；要求先修 F1(P2)、F2(P3)）
- 本轮范围：F1/F2 修复是否成立 + 回归/反向验证 + 上轮 F1–F9 现状
- 上轮基线仍在用：`dc8282c`（回归前已批准）；修复前树：`6212c4b`（F1/F2 之前的 src）

## 1. 结论摘要

**结论：现在可以合入 `main`（无阻断）。F1 的机制层成立且可证伪，F2 成立；两者都在真实修复前树上复现了 fail-before-fix。真实浏览器遮挡像素本轮标为 `NOT RUN`，建议作为合入前的最后一道确认（Integrator 的 browser-use 测量）。**

要点：

1. **F1 机制成立**：测量路径与回退路径都 `>= 176px`（`Math.max(measured, 176)` + 回退 176/496），只可能让正文更可见；不存在"永远量不到"的退化 —— 没有 `ResizeObserver` 时**整个 ChatView 都渲染不出来**（assistant-ui 抛错），而 `offsetHeight <= 0` 只出现在首帧/未布局，此时回退值保守。
2. **F2 成立**：`nextId` 缺失 / `"4"` / `null` / `true` / 对象都能产出可渲染快照，数值 `nextId` 原样透传且不造数字；`protocol.ts` 只放宽（`nextId: number` → `nextId?: number`），`isTodoDetails` 仍要求 `tasks` 是数组（不是"什么都收"）。
3. **独立复跑 gates**：`typecheck` exit 0；`npm test` **164/164 PASS**；`npm run build` exit 0（仅既存 chunk 体积警告）。
4. **反向验证**：9 个变异，其中 4 个是本轮指定的必测项（N1 CSS 改回 176px、N2 永不测量、N3 去掉下界、N4 把 `nextId` 校验加回）**全部被修复者的测试抓住**；另有 2 个变异暴露**测试缺口**（N5 去掉 viewport 观测、N7 去掉 disconnect 时，修复者测试 0 失败）。
5. **上轮结论未被破坏**：20 条回归断言 + 与 `dc8282c` 的 12 个形状 trace **逐字节一致**；本轮只在 7 个 hunk 内改动，`combineAssistantTurn` / 分界 / 去重 / turnActivity 等全部未触及。

本轮新发现全部是 P3（1 个首帧窗口、2 个测试缺口、1 个既有 flaky 断言、1 个测试可移植性），**无 P0/P1/P2**。

## 2. 复审方法

- 零仓库改动（`git status` 前后 clean）；临时脚本与临时树放 `/tmp/rr`，用完删除。
- 复用了第一轮的自建断言（文档顺序 `TreeWalker` trace + 文本节点 pairwise 顺序），并把 `@target` 别名指向候选 / `dc8282c` 导出 / 变异副本，三棵树跑同一份断言。
- 变异测试：把 `src/` 复制到 `/tmp/rr/mut`，注入变异后同时跑「修复者的测试」与「我的测试」；修复者的测试用 `cwd=/tmp/rr/mut` 运行，使读 `styles.css` 的用例读的是变异后的 CSS。
- 真实修复前树：`git archive 6212c4b src`，把**候选的**测试文件放进去运行。

```bash
# gates
npm run typecheck                          # exit 0
npm test                                   # 15 files / 164 tests PASS
npm run build                              # exit 0
# 我的独立断言集（37 条）
npx vitest run --config /tmp/rr/vitest.candidate.config.ts
# 修复前树（6212c4b）上跑候选测试
npx vitest run --config /tmp/rr/vitest.prefix.config.ts src/web/components/ChatView.test.tsx -t "ChatView footer reservation"   # 5 failed | 46 skipped
npx vitest run --config /tmp/rr/vitest.prefix.config.ts src/server/pi-session-reader.test.ts -t "keeps a snapshot whose nextId" # 1 failed | 21 skipped
```

## 3. 逐项结果

### 3.1 F1（P2）：机制是否成立

**1) 回退与测量两条路径都不小于 176px —— 已核对无问题**

- 代码：`Math.max(measured, CHAT_FOOTER_MIN_RESERVE_PX)`（`ChatView.tsx:332-341`）；回退 `176 + (reserveTodoBar ? 320 : 0)`（`:312-313`）。
- 我的断言（`inset.test.tsx`）：
  - 实测值被精确跟随：`viewport.bottom - footer.top` = 480 / 600 / 690 → 变量 480px / 600px / 690px；
  - 低于下界（inset = 20 / 0 / −100）→ 一律 176px；
  - 遍历 10 个 measured 值（含 −1000、5000、恰好 0）断言 `inset >= 176` 恒成立。
- 结论：预留只会 **≥ 176px**，即相对改动前"只能更可见，不能更差"。

**2) 是否存在"永远量不到 → 永远走保守值"的退化 —— 已核对无问题（不存在可长期触发的退化）**

- `measureInset()` 只在两种情况下返回 `null`：`observer === null`（宿主没有 `ResizeObserver`）或 `footer.offsetHeight <= 0`。
- **"宿主没有 ResizeObserver"这条分支不可达**：我实测把全局 `ResizeObserver` 删掉后，`render(<ChatView/>)` 直接抛 `ReferenceError: ResizeObserver is not defined`（React 19 包成 `AggregateError`，两个内层错误同源），抛出点是 assistant-ui 的 `useSizeHandle`（`node_modules/@assistant-ui/react/src/utils/hooks/useSizeHandle.ts:30`），即**在 `useChatFooterInset` 有机会起作用之前**整个视图就渲染不出来。这是 assistant-ui 的既有约束，不是本轮引入；因此 `ChatView.tsx:322` 的 `observer === null` 守卫是防御性的。
- `offsetHeight <= 0` 只对应"尚未布局 / 隐藏 / jsdom"：`ChatView` 在 App 里是条件渲染（`mode === "terminal" ? <TerminalView/> : <ChatView key={pane.id}/>`），**不存在隐藏但挂载**的状态，因此真实浏览器里 footer 一旦渲染就有高度；我的 `inset.test.tsx` 也验证了"先在无测量状态下走保守值、随后进入测量路径并跟随变化"。
- jsdom 里 `offsetHeight` 恒为 0，所以**测试断言的是回退值**（496/176），这部分我明确区分（见 3.1.5）。

**3) 观测是否覆盖真正会变的场景 —— 已核对无问题（机制），但测试有缺口（见 F-A）**

- 同一个 observer 同时观测 footer 与 viewport（`ChatView.tsx:345-348`）。我 dump 了全部 observer：assistant-ui 自己的那个只观测 `.chat-footer`；本组件创建的两个实例观测 `[chat-footer, chat-viewport]`。
- 覆盖能力（按几何推理 + 可测部分实测）：
  - footer 变高（todo 条展开/收起、错误行出现）：footer 尺寸变化 → RO 回调 → 重算 ✓（实测 480→600）；
  - 窗口 resize：`.chat-viewport` 是 `width/height:100%`，其尺寸随窗口变化 → viewport 的 RO 回调 ✓（这正是 `observe(viewport)` 的作用）；
  - 窄屏 sidebar：桌面布局下 footer 的 `left/right` 由 CSS（`.chat-footer { right/left: max(...) }`）决定，宽度会变 → footer RO ✓；移动端（`max-width: 760px` 断点）同样改变宽度 → ✓；断点切换必然伴随宽度变化，所以"CSS 常量变了但没人通知"的窗口不存在；
  - Pane 切换：`key={pane.id}` 强制重挂载 + `reserveTodoBar` 翻转 → effect 重跑 ✓（实测：轮询刷新与 Pane 切换后变量值仍为测量值且 ≥176）。
- 注意：RO 只报尺寸变化，不报位置变化。这里的正确性依赖"viewport 的尺寸会随窗口变化"这一事实（上一条已验证），因此不存在"窗口变了但预留没跟上"的缺口。

**4) `reserveTodoBar` 用"条存在"而非"展开" —— 有可见副作用，但只可能是首帧瞬态（P3，见 F-D）**

- `reserveTodoBar` 只影响**回退值**（176 → 496）；测量路径下用的是实测 inset，与展开/折叠无关。
- 因此"折叠态也留 496px 空白"只会发生在回退路径上。真实浏览器里 effect 在提交后运行，读 `offsetHeight` 时布局已完成 → 走测量路径 → 回退值基本不会被应用。可达的首帧场景见 F-D。
- jsdom 下确实是"折叠态也按 496 预留"，但那正是测试要断言的回退值本身。

**5) 是否有可证伪的测试锁住回退值；它测的是哪一层 —— 有，且测的是"组件写入的 CSS 变量 + 样式表消费该变量"两层，不是像素**

- 修复者的 `ChatView footer reservation`（`ChatView.test.tsx:1929`）5 条用例分别钉住：实测跟随（480→600）、下界 176、无布局时 ≥176+260、无 todo 条时 176、样式表消费变量（`:2088`）。
- 我的变异验证（同一份代码、只改实现）：
  - 回退常量 320→0（N8）→ 修复者 2 条失败；
  - `reserveTodoBar` 强制 false（N6）→ 修复者 2 条失败；
  - 完全不写变量（N9）→ 修复者 4 条失败；
  - CSS 改回固定 176px（N1）→ 修复者 1 条失败（样式表那条）。
  即"回退值"与"两端契约"都有可证伪的断言。
- **它测到哪一层**：`viewport.style.getPropertyValue("--chat-footer-inset")`（组件是否写对变量与值）+ `.chat-viewport` 规则文本里是否存在 `padding-bottom: var(--chat-footer-inset, 176px)`（样式表是否消费）。jsdom 不做布局、不解析 `var()`，所以**没有任何测试断言"真实像素预留/遮挡是否消失"**。这一点修复者的记录也如实标注了（§1.4）。

### 3.2 F2（P3）：修复是否成立

- **已核对无问题。** `isTodoDetails` 现在只要求 `Record` + `tasks` 是数组（`todo-tasks.ts:35`）；`nextId` 非数字时**省略而不用占位值**（`:77`），数值时原样透传。
- 我的 reader 用例（自建 fixture）：`nextId` 缺失 / `"4"` / `null` / `true` / 对象 五种形状都产出快照（tasks/updatedAt 正确、`truncated` 未置、`nextId` 为 `undefined`）；数值 9 原样透传；`tasks` 不是数组（`"nope"` / `null` / `undefined` / `{0:"x"}` / `7`）仍然不产出快照 —— 放宽没有退化成"什么都收"。
- `protocol.ts` 只放宽：`ChatTodosSnapshot.nextId` 由 `number` 改为 `nextId?: number`（`:207`），`TodoDetails.nextId` 由 `number` 改为 `nextId?: unknown`（`todo-tasks.ts:24`）；本轮对 `protocol.ts` 只有这 2 个 hunk，无新增/删除字段、无既有字段语义变化。全仓库 `nextId` 只出现在这两处类型与 snapshot 构造里 —— UI 从不读它（我的客户端用例用不含 `nextId` 的快照渲染出正常计数与列表）。
- 没有引入新的静默丢弃路径：畸形任务仍逐条丢弃（既有的 `projectTodoTasks`），只有顶层 `tasks` 不是数组时才整份不认。
- 超限降级分支同步放宽：有真实 `nextId` 时带上、没有时不带（我的用例两种都覆盖）。

### 3.3 回归与反向验证

**独立复跑 gates（不采信 Integrator 的 164/164）**

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | **PASS**（exit 0） |
| 全量测试 | `npm test` | **PASS** 15 files / 164 tests |
| 构建 | `npm run build` | **PASS**（exit 0，仅既存 chunk >500 kB 警告） |
| 我的独立断言集 | `npx vitest run --config /tmp/rr/vitest.candidate.config.ts` | **PASS** 37/37（F1 机制 9 + 回归 20 + F2 5 + 无 ResizeObserver 1 + 重挂载/StrictMode 2） |

**真实"修复前"树上的 fail-before-fix（不只是变异）**

| 用例 | 修复前 `6212c4b` | 候选 `2c546ee` |
| --- | --- | --- |
| `ChatView footer reservation`（5 条） | **5 failed**（follows the space / never reserves less / reserves the conservative height / keeps the base reservation / stylesheet wired） | 5 passed |
| `keeps a snapshot whose nextId is missing or not a number` | **1 failed** | 1 passed |

与修复者 `§3` 的自述一致 → 两处修复都有真实的 fail-before-fix 证据。

**变异测试（9 个；"修复者测试"用 `cwd=/tmp/rr/mut` 运行）**

| 变异 | 修复者测试失败 | 我的测试失败 | 判定 |
| --- | --- | --- | --- |
| N1 CSS `padding-bottom` 改回固定 176px | 1（stylesheet wired） | 1 | 有覆盖 |
| N2 `measureInset()` 永远返回 null | 1（follows the space） | 2 | 有覆盖 |
| N3 去掉 `Math.max(measured, 176)` | 1（never reserves less） | 2 | 有覆盖 |
| N4 把 `nextId === "number"` 校验加回 | 1（reader 用例） | 3 | 有覆盖 |
| N5 只观测 footer（去掉 `observe(viewport)`） | **0** | 1 | **测试缺口（F-A）** |
| N6 `reserveTodoBar` 强制 false | 2 | 2 | 有覆盖 |
| N7 去掉 `observer?.disconnect()` | **0** | 1 | **测试缺口（F-B）** |
| N8 回退常量 320 → 0 | 2 | 2 | 有覆盖 |
| N9 完全不写 CSS 变量 | 4 | 6 | 有覆盖 |

**上轮验证过的行为未被破坏（抽样复跑我第一轮的断言）**

- 20 条断言在候选上全部通过：`组 → 正文`、正文在中间、`组 → 横线 → 组 → 正文`、段首/段尾/连续分界、divider-only turn 不造 `Worked for`、图片在组之后、todo 计数/分组/tombstone/未知依赖/不占位/composer 相对位置。
- 与 `dc8282c` 的机械对照：10 个无分界形状 + 2 个运行中形状的 DOM trace **逐字节 identical**（`diff` 为空）→ 本轮 F1 修复没有改变 transcript 渲染。
- 候选 20/20 通过；`dc8282c` 只有 4 条分界相关用例失败（它没有该功能），符合预期。

### 3.4 越界与副作用 —— 已核对无问题

- 本轮改动只在契约 write set 内：`src/shared/todo-tasks.ts`、`src/shared/protocol.ts`（仅放宽）、`src/web/components/ChatView.tsx`、`src/web/styles.css`、两个测试文件 + 任务记录。
- `src/server/index.ts`、`src/server/pi-realtime.ts`、`src/web/turnActivity.ts`、`src/web/panelOpenState.ts`、`src/web/toolCatalog.ts` 相对上轮候选**完全未改**（`git diff --quiet` 逐文件确认）。
- `ChatView.tsx` 本轮只有 7 个 hunk，全部属于 F1/F2；`combineAssistantTurn` / `segmentOutputLimit` / `dividerPanelKey` / `mergeRealtime` / `todoBlockedLabel` 等上轮复核过的逻辑一行未动。
- 轮询/去重/Pane 切换：`visibleTodoTasks` 是布尔派生值，effect 依赖 `[footer, viewport, reserveTodoBar]`，每 1.5s 轮询产生的新 `chat.todos` 对象**不会**让 effect 重跑；`TodoStatusBar` 收到的仍是过滤后的任务数组（与上轮同一份语义），无额外请求、无额外渲染循环。
- StrictMode：App 用 `<StrictMode>`；我实测 effect 双调用下变量仍为 480px、无 `Maximum update depth`、无 console 错误。
- 内联样式的持久性：实测轮询刷新与 Pane 切换后变量仍为测量值（≥176），说明用 `useState` 承载元素引用、被替换时重跑 effect 的做法有效。
- 移动端：`@media (max-width: 760px)` 只改 `.chat-viewport` 的左右 padding 与 `.chat-footer` 的定位，**没有**覆盖 `padding-bottom`，所以 var() 在两套布局下都生效；因为值是被测量的，断点差异（桌面 16px 间隙 vs 移动端 0/16px）不需要写死。

## 4. Findings

### F-A

```
Severity: P3（测试缺口，不是实现缺陷）
File: src/web/components/ChatView.test.tsx:1929（ChatView footer reservation 全组）
Finding: 没有任何测试覆盖「观测 viewport」这件事：删掉 ChatView.tsx:348 的 observer.observe(viewport) 后，修复者的 164 个测试全部通过。
Why: viewport 的观测是"窗口 resize / 窄屏 sidebar 变化导致 pane 底边移动"这一场景的唯一触发源（RO 只报尺寸变化）。它坏掉时预留会在这些场景下保持旧值——由于 Math.max 下界它不会小于 176px，所以后果是"预留偏小"，即 F1 类的遮挡在最需要修正的场景下失效。
Evidence: 变异 N5（删除 `observer.observe(viewport);`）→ worker tests failing: 0；reviewer tests failing: 1（我新增的 `observes both the footer and the viewport with the same observer`）。
         注：我第一版断言写成"存在某个观测 viewport 的 observer"，在 N5 下**没有**失败——因为 assistant-ui 自己也观测 viewport；改成"观测 footer 的那个 observer 必须同时观测 viewport"才抓得住（dump 结果：本组件的 observer = [chat-footer, chat-viewport]，assistant-ui 的 = [chat-footer]）。
Suggested direction: 在 `follows the space the fixed footer covers` 里加一句"驱动 viewport 的 observer 也会重算"，或断言观察 footer 的 observer 同时观察 viewport（一行）。
```

### F-B

```
Severity: P3（测试缺口）
File: src/web/components/ChatView.test.tsx:1929（同上）
Finding: 没有测试覆盖 observer 的 teardown：把 ChatView.tsx:351 的 `return () => observer?.disconnect();` 改成 `return () => undefined;` 后，修复者测试 0 失败。
Why: ChatView 在 Terminal↔Chat 切换与 Pane 切换时会重挂载（`key={pane.id}`），且 effect 依赖变化本身就会替换 observer；不 disconnect 会累积观察者（每次依赖变化泄漏一个）。当前实现是正确的（我用 cleanup 断言了断开），但回归时无人拦。
Evidence: 变异 N7 → worker tests failing: 0；reviewer tests failing: 1（`disconnects its observers when the view is torn down`）。
Suggested direction: 在 `ChatView footer reservation` 里补一条 unmount 断言（`cleanup()` 后所有观察过 footer 的 observer 都已 disconnect）。
```

### F-C

```
Severity: P3（上轮 F7 重述；既有测试脆弱点，非本批引入，本轮再次实测复现）
File: src/web/components/ChatView.test.tsx:93-96（promptCalls 用 `String(url).includes("/prompt")`）、:144/:147（toHaveLength(1)）
Finding: 该过滤同时匹配 `/prompt` 与 `/api/prompt-delivery/events`，断言对 trace 上传时机敏感；负载下会偶发失败。
Why: 它让"164 tests 全绿"这条证据在负载下不稳定，也污染了我的变异结果（N1/N2/N3/N6 那几轮的失败列表里都混进了这一条，我逐条剔除后才得到干净矩阵）。
Evidence: 同一候选代码 — 干净运行 5/5、6/6 通过；在并行运行另一个 vitest 的负载下 3 次里有 1 次失败，失败信息 `expected [ [ … ], [ … ] ] to have a length of 1 but got 2`（`promptCalls()` 同时数到了 delivery 上传）。该 helper 与断言在 `dc8282c` 中已存在。
Suggested direction: 收紧为 `/\/prompt$/` 或排除 `/prompt-delivery/`；顺带检查 :178/:335 处 `toHaveLength(2)` 的同类依赖。
```

### F-D

```
Severity: P3（首帧瞬态；需要真实浏览器判断可见性）
File: src/web/components/ChatView.tsx:305-352（effect 用 useEffect 而非 useLayoutEffect）、src/web/styles.css:518（CSS 回退 176px）
Finding: 首帧仍用样式表里的 176px 回退值，测量结果要到被动 effect 之后才写入；当 ChatView 重挂载且 todo 条处于"展开"状态时，footer 在首帧就已经很高，因此存在一帧预留不足。
Why: todo 条的展开状态保存在 per-pane 的 `panelOpenState`，**跨重挂载保留**（我实测：展开 → cleanup → 重新挂载同一 pane，`open` 仍为 true）。而 App 在 Terminal↔Chat 切换与 Pane 切换时都会重挂载 ChatView（`key={pane.id}`）。反向的瞬态是无害的：条存在但折叠时回退值 496px 大于实际需要（多留空白）。
Evidence: 我的 `REMOUNT open=true` 实测（重挂载后 `<details open>`）；`useEffect` 的时序是"提交后、首帧之后"。因此这一帧的预留=176px，而 footer 已因展开的 todo 条而更高。**是否肉眼可见（一帧闪烁）本轮 NOT RUN。**
Suggested direction: 改用 `useLayoutEffect`（CSR-only，风险很低）即可闭合这一帧；或接受并在真实浏览器测量后确认不可见。若实测显示仍有残留遮挡，优先改这里而不是改常量。
```

### F-E

```
Severity: P3（测试可移植性）
File: src/web/components/ChatView.test.tsx:2088-2100（`readFileSync(path.join(process.cwd(), "src/web/styles.css"))`）
Finding: 样式表断言依赖 `process.cwd()` 恰好是仓库根；在别的 cwd 下运行该用例会读不到文件（或读错文件）而失败。
Why: `npm test` 从包根运行所以现在是绿的，但这条断言在 CI/其他工作目录下有隐式前提；我自己写同类断言时正好踩到（第一次读到的是未变异的 CSS，导致变异 N1 在 reviewer 侧显示 0 失败）。
Evidence: 我把断言改为读取"被测树根"（由配置注入 `__TARGET_ROOT__`）后，N1 立刻被抓住（reviewer tests failing: 1）。修复者的用例在我用 `cwd=/tmp/rr/mut` 运行时才能正确读变异 CSS。
Suggested direction: 用 `new URL("./../styles.css", import.meta.url)` 之类锚定到测试文件，或与其它 CSS/文本断言共用同一注入根。
```

## 5. 明示「已核对无问题」的项

- **F1 下界**：10 个 measured 值（含负值与 0）断言 `>= 176`；低于下界的实测值一律 176px。
- **F1 测量语义**：`viewport.bottom - footer.top` 是"footer 顶边到正文底边的距离"，与被观测元素自身的 padding 无关（量的是 border box），因此不存在"设 padding → 触发 RO → 值又变"的自激；实测连续通知后值稳定收敛（480→600 后不再变化）。
- **F1 观测目标**：dump 全部 observer 确认本组件的 observer 同时观测 footer 与 viewport；assistant-ui 的 observer 只观测 footer。
- **F1 teardown / 重挂载**：`cleanup()` 后所有观察 footer 的 observer 都已 disconnect；轮询刷新与 Pane 切换后变量仍为测量值（≥176）；StrictMode 下 inset=480px、0 console 错误。
- **F1 CSS 契约**：正则从 `.chat-viewport` 的**包含 `padding-bottom` 的那条规则**里取出变量名 `--chat-footer-inset` 与回退 `176`，并断言组件写的是同一个名字、且 `var()` 声明位于 `padding` 简写之后（否则简写会赢）。移动端媒体查询不覆盖 `padding-bottom`（`@media (max-width: 760px)` 块，`styles.css:1523-1556`），因此两套布局都生效。
- **F2**：五种非数字 `nextId` 形状 + 数值形状 + `tasks` 非数组 + 超限降级 + 畸形任务逐条丢弃，全部独立验证；`protocol.ts` 仅放宽。
- **回归**：20 条上轮断言 + 12 个形状与 `dc8282c` 逐字节一致的 trace。
- **越界**：只改契约 write set 内的 6 个文件；禁改文件未变；`ChatView.tsx` 7 个 hunk 全属 F1/F2。

## 6. 上轮 findings 现状

| 编号 | 内容 | 现状（本轮核对方式） |
| --- | --- | --- |
| F1 (P2) | 展开 todo 条遮挡正文尾部 | **已修（机制层）**。测量+回退两条路径 ≥176px，CSS 契约与组件写入一致，fail-before-fix 在 `6212c4b` 上 5 条失败；**真实像素 NOT RUN** |
| F2 (P3) | `isTodoDetails` 用未使用的 `nextId` 把关 | **已修**。非数字 `nextId` 不再丢快照，数值原样透传，`protocol.ts` 仅放宽；fail-before-fix 1 条失败 |
| F3 (P3) | 超 128 KiB 时整条不渲染（设计文档说"只保留计数"） | **未触及**（该分支代码未改；我的超限用例仍得到 `{tasks: [], truncated: true}`，无占位） |
| F4 (P3) | `at: 0` 的同 kind 分界共享展开状态 | **未触及**（`dividerPanelKey` 本轮无改动；上轮已实测该降级真实存在） |
| F5 (P3) | 分界借用 `createdAt` 扩大 `role:createdAt` 去重键暴露面 | **未触及**（`mergeRealtime` 本轮无改动） |
| F6 (P3) | 客户端不限制 todo 行数（折叠态也建节点） | **未触及**（`TodoStatusBar` 仍全量 map；本轮只改了 props 来源） |
| F7 (P3) | `promptCalls()` 断言脆弱 | **未触及**，且本轮在负载下再次复现（见 F-C） |
| F8 (P3) | kept entry 非消息时分界顺延 | **未触及**（reader 的 `keptIndex` 逻辑未改） |
| F9 (P3) | `latestAssistantTurn` 的 turnId 变化 | **未触及**（`turnActivity.ts` 未改） |

## 7. NOT RUN

| 项目 | 原因 |
| --- | --- |
| **真实浏览器遮挡像素 / 展开前后留白**（F1 的最终验收） | 需要 Integrator 用 browser-use 测量（3041 端口的候选服务按其安排使用，我未触碰）。本轮只证明机制与 CSS 变量契约，**不能用 jsdom 断言像素** |
| F-D 的首帧闪烁是否肉眼可见 | 同上，需要真实浏览器/录屏 |
| 真实 Pi session / 真实 Pane / companion 集成验收 | 未授权 |
| 移动端断点下的实际 inset | 需要真实浏览器缩窗；本轮只做了 CSS 阅读 + 几何推理（媒体查询不覆盖 padding-bottom） |
| `npm ci` | 依赖已就绪，未重复执行 |

## 8. 剩余风险

1. **F1 的"可见性"仍未闭环**：机制上"能滚出来"成立（预留 = footer 顶边到 pane 底边的实测距离），但**展开 todo 条的那一刻不会自动滚动**，用户可能需要向下滚一次才能看到原本被压住的最后一行；这是预留空间类修复的固有性质，不是回归。是否可接受由真实测量/开发者判断。
2. **F-D 一帧瞬态**：`useLayoutEffect` 可消除；不改的话需要真实浏览器确认不可见。
3. **F6 与 F1 的交互**：todo 条展开后的高度上限依赖 `.todo-list { max-height: 260px }`（`styles.css:1444`）；若将来放开这个上限，测量路径会自动跟上（无需改常量），但**回退常量 320px 会偏小**——回退路径只服务首帧/无布局，风险低，值得在注释里保留关联。
4. F3–F9 与 F-A/F-B 两个测试缺口仍待处理（都是登记在案的既有遗留或测试质量问题）。
5. F7 的 flaky 断言会让"全绿"结论在负载下不可靠；本轮已明确剔除其干扰，仍建议尽快收紧。

## 9. 独立判断

- **现在能否合入 `main`：可以合入（无阻断）。**
- 依据：F1 的两条路径都不小于原来的 176px、没有可长期触发的退化、CSS 契约两端一致，并且在**真实修复前树**上有 fail-before-fix；F2 的放宽既覆盖了缺失/非数字 `nextId`，又没有退化成"什么都收"；本轮改动只落在契约范围内且未触及上轮已复核的逻辑；上轮的顺序/分段/`dc8282c` 对照断言抽样复跑全部通过。
- **建议把真实像素测量作为合入前的最后一道确认**（Integrator 的 browser-use）：若能确认展开态不再遮挡、首帧闪烁不可见，则 F1 可完全关闭；若测量显示仍有残留遮挡，优先按 F-D 的方向（`useLayoutEffect`）或调整下界常量，而不是回退方案。
- **合入前应当被显式接受的已知项**：F-A/F-B（测试缺口）、F-C（既有 flaky 断言，非本批引入）、F-D（首帧瞬态）、F3–F9（上轮遗留，本轮未触及）。这些都不改变"可合"的判断。

---

## 附：本轮任务定义原文（逐字保留，避免契约文本被记录覆盖）

> 说明：本轮任务定义与复审记录使用同一路径 `.agents/tasks/20260917-compaction-rereview.md`，写入记录会覆盖契约原文。为不丢失契约，这里附上 `bb56f1b` 中的原文（逐字）。第一轮的契约文本已在 `304a6b9` 中被覆盖，仍可从 `ce16cd5` 取回。

> # 第二轮独立复审：F1/F2 修复后的候选
> 
> - 状态：待 Reviewer 执行
> - 角色：**同一位独立 Reviewer**（`herzi_reviewer2`）
> - Candidate：`2c546ee` = 上轮候选 `b201c43` + F1/F2 修复（`c4dd3ed`、`8fe5b3f`）
> - 上轮复审记录：`.agents/tasks/20260917-compaction-review.md`（**你的第一轮结论，本轮不要重写它**）
> - 上轮结论：可合入、无阻断、无 P0/P1；F1(P2) + F2(P3) 被要求先修，F3–F9 待开发者接受或另行处理
> 
> ## 本轮范围（只做这些）
> 
> ### 1. F1（P2）修复是否成立
> 
> 修复做法（实现者自述，**不采信**）：
> 
> - `src/web/styles.css`：`.chat-viewport` 的 `padding-bottom` 改为 `var(--chat-footer-inset, 176px)`；
> - `src/web/components/ChatView.tsx` 新增 `useChatFooterInset(viewport, footer, reserveTodoBar)`：用 `ResizeObserver` 观测 `.chat-footer` 与 `.chat-viewport`，把「viewport 底边 − footer 顶边」写回该 CSS 变量；**量不到高度或没有 ResizeObserver 时**回退 `176px`，当存在可见 todo 任务时回退 `176 + 320px`；`Math.max(measured, 176)` 保证不小于原常量。
> - `reserveTodoBar` 取「可见（非 tombstone）todo 任务数 > 0」，即**条存在**就按保守值回退，而不是按"展开"。
> 
> 请独立核对：
> 
> 1. 回退路径与测量路径是否都不小于原 176px（**只能更可见，不能更差**）；
> 2. 是否有"永远量不到 → 永远走保守值"的退化（例如 `observer === null` 时 `measureInset()` 直接返回 null 是否合理；真实浏览器是否总能进入测量路径）；
> 3. 观测是否覆盖真正会变的场景：footer 变高（todo 条展开/收起）、窗口 resize、窄屏 sidebar 变化、Pane 切换；
> 4. `reserveTodoBar` 用「条存在」而非「展开」是否会造成可见的副作用（例如无 ResizeObserver 环境下折叠态也留出 496px 空白）；
> 5. 是否有可证伪的测试锁住回退值（jsdom 无布局，请说明它测的是哪一层：CSS 变量写入、还是组件 wiring）；
> 6. **真实像素测量不在你的权限内**：Integrator 会在开发者开启 Chrome 调试端口后用 browser-use 补测。本轮你只需判断**机制与测试**是否成立，并把「真实遮挡是否消除」明确标为 `NOT RUN（等待 Integrator 证据）`。
> 
> ### 2. F2（P3）修复是否成立
> 
> - `src/shared/todo-tasks.ts`：`isTodoDetails` 是否已放宽为「`tasks` 是数组」即可；`nextId` 缺失/非数字时是否仍产出快照；
> - `src/shared/protocol.ts`：本轮对 `nextId` 的类型改动是否**只放宽/新增**，无既有字段语义变化；
> - 测试是否覆盖 `nextId` 为 `undefined` / `"4"` / `null` 三种输入并能产出可渲染快照；
> - 是否引入新的静默丢弃路径。
> 
> ### 3. 回归与反向验证
> 
> - 独立复跑：`npm run typecheck`、`npm test`、`npm run build`（Integrator 实测为 164 tests PASS，请自行复核）；
> - **至少 2 个新变异**，针对本轮修复：
>   - 把 `padding-bottom` 改回固定 `176px` → 应有测试失败；
>   - 让 `measureInset()` 永远返回 null（或把 `Math.max(measured, 176)` 去掉）→ 应有测试失败；
>   - 把 `isTodoDetails` 的 `nextId` 校验加回 → 应有测试失败。
>   若某变异**没有**测试失败，请指出这是测试缺口而非"实现无误"。
> - 复核上轮已验证过的行为未被本轮修复破坏：顺序（组在正文之前）、分界分段、与 `dc8282c` 的对照——至少抽样你自己上轮的断言复跑一次。
> 
> ### 4. 上轮 findings 的现状
> 
> 逐条给出状态：F1 `已修/未修`、F2 `已修/未修`、F3–F9 `未触及`（并确认没有被本轮修复意外改变）。
> 
> ## 权限与交付
> 
> - **只读产品代码**：不得修改 `src/**`、`docs/**`、其它任务记录。
> - 只允许写入本文件（`.agents/tasks/20260917-compaction-rereview.md`）并提交。
> - 可以：目标测试、`npm run typecheck`、`npm test`、`npm run build`、`git show` 对照、在 `/tmp` 写临时脚本（用完删除，不得留在仓库）。
> - 不得：运行 `npm run dev`、操作真实 Pane、merge/rebase/push；**不要动 3041 端口上正在运行的候选服务**（那是 Integrator 为浏览器测量留的）。
> 
> ## 输出格式
> 
> 同第一轮：逐条 findings（Severity / File:line / Finding / Why / Evidence / Suggested direction），每项无问题写「已核对无问题」并给出核对方式；单列 `NOT RUN` 与剩余风险；最后给出你对「**现在**能否合入 main」的独立判断（可以合 / 有阻断 / 需要条件）。
