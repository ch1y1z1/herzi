# 第三轮（聚焦）独立复审执行记录：F-A/F-B/F-D/F-E 小补丁

- 状态：**复审完成**
- 角色：同一独立 Reviewer（`herzi_reviewer2`；只读产品代码，只写本文件）
- Candidate：`3721dd6` = 上轮候选 `2c546ee`（含第二轮记录 `f9f5c5a`）+ `0795d9f` / `ef8d890`
- 上轮记录：`.agents/tasks/20260917-compaction-rereview.md`（未重写）
- 基线仍然启用：`dc8282c`（回归前已批准）
- 本轮范围：F-A / F-B / F-D / F-E 四条 P3 的闭合情况 + 回归 + 越界

## 1. 结论摘要

| 编号 | 结论 | 一句话依据 |
| --- | --- | --- |
| F-A | **已闭合** | 变异（删 `observer.observe(viewport)`）→ 恰好那一条新断言失败（1 failed，无其他），我的 3 条独立断言也失败；断言绑在"同一个 observer 实例同时观察二者"上，不会因 assistant-ui 另观察 viewport 而假通过 |
| F-B | **已闭合** | 变异（`return () => undefined`）→ 恰好 teardown 那条失败，我的断言也失败 |
| F-D | **已闭合（代码层）**；视觉 **NOT RUN** | 代码确认为 `useLayoutEffect`（`ChatView.tsx:317`），本轮唯一可执行改动；**没有写假测试**（确实没写测试，并在 commit 里说明了原因）。仅一处措辞需要更精确（见 F-D-1） |
| F-E | **已闭合** | 从 `cwd=/tmp` + `--root <tree>` 运行通过；改回 `process.cwd()` 立刻 `ENOENT ... /private/tmp/src/web/styles.css`；变异被测树 CSS 能被抓住（证明读的是被测树） |

**独立判断：现在可以合入 `main`（无阻断）。** 本轮无 P0/P1/P2，新发现只有 1 条措辞精确性（P3）与 2 条信息性说明。

## 2. 独立复跑 gates（不采信 Integrator 的 166）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | **PASS**（exit 0） |
| 全量测试 | `npm test` | **PASS** 15 files / **166 tests** |
| 构建 | `npm run build` | **PASS**（exit 0，仅既存 chunk >500 kB 警告） |
| 我的独立断言集 | `/tmp/rr`（4 个文件共 32 条） | **PASS** 32/32 |

## 3. 逐条核对

### 3.1 F-A：断言是否真的绑在"观察 footer 的那个 observer"上 —— 已闭合

- 代码位置：`src/web/components/ChatView.tsx:354-355`（`observer.observe(footer); observer.observe(viewport);`）；断言位置：`src/web/components/ChatView.test.tsx:2028`（`watches the pane's bottom edge with the same observer as the footer`）。
- 断言形式核对（读代码）：`observers.some((observer) => observer.targets.has(footer) && observer.targets.has(viewport))` —— 这是"**同一个实例**同时 watch 两个元素"，不是"存在某个 watch viewport 的 observer"。
- 变异 R-A（删掉 `observer.observe(viewport);`）：

```
worker tests failing (cwd=/tmp): 1
  - ChatView footer reservation watches the pane's bottom edge with the same observer as the footer
```

  → 恰好一条失败、别无其他 ⇒ 断言确实钉在这一点上。
- **不会假通过**（我自己的三重证据）：
  1. 我自己 dump 了全部 observer：assistant-ui 的实例只 watch `.chat-footer`；本组件的实例 watch `{chat-footer, chat-viewport}`。所以"没有实例同时观察二者"是可达状态；
  2. 我在自己的断言集里写了两种**互相独立**的形式——bookkeeping（同一实例 watch 二者）与 behaviour（**只**通知观察 viewport 的 observer，并把 viewport 底边从 900 移到 1000，要求预留 480→580）。R-A 下三条全失败；
  3. behaviour 形式在 R-A 下失败这一点尤其关键：它不依赖 `targets` 记账，只依赖"移动 viewport 底边能否改变预留"，因此"assistant-ui 也观察 viewport"不可能让它变绿。

### 3.2 F-B：teardown 断言能否抓住回归 —— 已闭合

- 断言位置：`src/web/components/ChatView.test.tsx:2063`（`disconnects its observers when the view is torn down`）；被测代码：`src/web/components/ChatView.tsx:358`（`return () => observer?.disconnect();`）。
- 变异 R-B（改成 `return () => undefined;`）：

```
worker tests failing (cwd=/tmp): 1
  - ChatView footer reservation disconnects its observers when the view is torn down
reviewer tests failing: 2
  - REVIEW F-A: viewport observation the instance watching both is the one that writes the variable
  - REVIEW F-B: teardown disconnects every observer that watched the footer
```

  → 修复者的断言精确抓住该回归；我的断言（`view.unmount()` 后所有观察过 footer 的 observer 都必须 disconnected）同样失败。
- 关于"会不会把 assistant-ui 的 observer 误判成本组件的"：该断言是**全称**（所有观察过 `.chat-footer` 的实例都必须 disconnect），因此它**同时覆盖 assistant-ui 的实例**。这不是误判，而是"卸载后不该有人还在看这个已被移除的元素"这一更强、也更正确的性质；代价是：若将来 assistant-ui 自己的清理出问题，会以 F-B 的名字报出来（需要读失败信息才能定位到不是我们的代码）。这一点我按信息项记在 §6.2，不构成缺陷。
- 顺带核对：断言里的 `expect(watchingFooter.every((o) => !o.disconnected)).toBe(false)`（unmount 前）只要求"至少一个还活着"，因此不会被"effect 因依赖变化替换过 observer"这一正常行为误伤（我第一版写成"全部都必须活着"，在**未变异**的候选上就会失败——那是我的断言过严，已修正）。

### 3.3 F-D：是否真的改成 layout timing；是否存在能证伪它的测试 —— 已闭合（代码层），视觉 NOT RUN

- **代码确认（不是读注释）**：`git diff 2c546ee..3721dd6 -- src/web/components/ChatView.tsx` 的可执行改动只有两行：

```
+  useLayoutEffect,          # import
-  useEffect(() => {
+  useLayoutEffect(() => {
```

  位置：`src/web/components/ChatView.tsx:37`（import）与 `:317`（hook）。`measureInset` / `Math.max(measured, CHAT_FOOTER_MIN_RESERVE_PX)` / `:347` 的 `setProperty(CHAT_FOOTER_INSET_VAR, ...)` / `:354` 的 `observe(footer)` / `:355` 的 `observe(viewport)` / `:358` 的 `disconnect` **一行未动** ⇒ F1 的测量语义未被本轮改动（另有 §4 的两个变异佐证）。
- **是否有假测试：没有。** 修复者**没有**为 F-D 加任何测试，并在 commit message 里说明原因。核对 `git show 0795d9f -- src/web/components/ChatView.test.tsx`：新增的两条测试分别是 F-A 与 F-B，没有"timing"相关断言；也没有把某个必然通过的东西包装成"首帧已修"。
- **它的理由是否成立**（我做了独立探针 `/tmp/rr/timing.test.tsx`）：
  - 它引用的那条："`flushSync` render outside `act()` 也会冲掉被动 effect" —— **实测成立**：`FLUSHSYNC layout=layout passive=passive`（flushSync 返回后被动 effect 已跑）。
  - 但"jsdom cannot distinguish the two timings"这一概括**不完全准确**：我找到过一个可区分的窗口 —— 用 `createRoot()` 直接渲染、不套 `act()`、不做 flushSync，在 `setTimeout(0)` 之后读 DOM 时得到 `AFTER_TASK layout=layout2 passive=<none>`，即 layout effect 已跑而 passive 未跑。
  - 因此更精确的说法是：**jsdom 里没有"绘制"，所以"某一帧是否用旧预留"这个视觉结论无法断言；能构造出来的只是调度时序层面的断言，它依赖微任务/宏任务次序，测的是 React 内部调度而不是可见结果。** 不写这样的断言是合理选择，但"完全无法区分"这句话不该被当作定论。
  - 佐证：变异 R-D1（把 `useLayoutEffect` 改回 `useEffect`）→ **修复者 0 失败、我的 0 失败**。也就是说当前两套测试都区分不了，与"没有可证伪测试"这一自述一致。
- **是否真的修到了 F-D 指出的窗口**：成立，且理由比 commit 里写的更具体。ChatView 重挂载时第一次 commit 的 `chat` 是空快照（尚无 todos），todo 条要等轮询回来才出现；也就是说"footer 已经很高"的那一帧正是 `reserveTodoBar` 由 false 变 true 的那次 commit。`useLayoutEffect` 在该 commit 的 DOM 变更后、绘制前补齐预留；`useEffect` 则会先绘一帧旧值。
- **结论**：代码层已按建议修好，且没有用假测试掩盖；**真实浏览器里这一帧是否可见 = NOT RUN**，需 Integrator 的 browser-use（或开发者确认）。

#### F-D-1（P3，措辞精确性）

```
Severity: P3
File: src/web/components/ChatView.tsx:306-314（注释）、0795d9f 的 commit message
Finding: "jsdom cannot distinguish the two timings" 这一概括不准确：`flushSync` 那条理由是实测成立的，但存在不套 act/flushSync 的调度层窗口能区分 layout 与 passive。
Why: 结论本身（不写这个测试、代码层修复、视觉 NOT RUN）是对的，也不影响合入；只是把"测不了"写成了绝对判断，后续读者可能据此认为"不可能有测试"，从而放弃一个（虽然脆弱的）回归护栏。
Evidence: /tmp/rr/timing.test.tsx 实测 `FLUSHSYNC layout=layout passive=passive`（理由成立）与 `AFTER_TASK layout=layout2 passive=<none>`（存在可区分窗口）；变异 R-D1 两套测试均 0 失败（说明当前确实没覆盖）。
Suggested direction: 把注释/记录里的措辞改为"jsdom 没有绘制，无法断言可见结果；调度层断言依赖微任务次序、测的是 React 内部，故不写"，或在 §未决限制里登记为"已知无回归护栏"。
```

### 3.4 F-E：是否真的与 cwd 解耦、是否读被测树 —— 已闭合

- 代码位置：`src/web/components/ChatView.test.tsx:2174`（`path.join(import.meta.dirname, "../styles.css")`）。
- **非仓库根 cwd 下运行（candidate）**：

```bash
cd /tmp && <repo>/node_modules/.bin/vitest run --root <repo> \
  --config <repo>/vite.config.ts src/web/components/ChatView.test.tsx -t "keeps the stylesheet wired"
# Test Files 1 passed (1) / Tests 1 passed | 52 skipped (53)
```

- **改回 `process.cwd()` 就会坏（变异 R-E2，同样从 `cwd=/tmp` 运行）**：

```
Error: ENOENT: no such file or directory, open '/private/tmp/src/web/styles.css'
       Tests 1 failed | 52 skipped (53)
```

  → 说明这次改动确实是把断言从 cwd 解耦所必需的。
- **读的是被测树**：把被测树（`/tmp/rr/mut`，用 `--root` 指向它）的 `styles.css` 里 `padding-bottom` 改回固定 `176px`（变异 R-1），从 `cwd=/tmp` 运行：

```
worker tests failing (cwd=/tmp): 1
  - ChatView footer reservation keeps the stylesheet wired to the footer inset variable
```

  → 既证明"锚定路径找到了被测树"，也证明"断言的 CSS 来自被测树而不是仓库那份"。
- 边界核对：`import.meta.dirname` 需要 Node ≥ 20.11，`package.json` 的 engines 要求 `^22 || ^24 || >=26` ✓。测试文件物理位于 `src/web/components/`，`../styles.css` 指向 `src/web/styles.css` ✓（该文件不会移动；若将来移动测试文件需同步改这一行，属可接受耦合）。

### 3.5 越界（只有 ChatView.tsx / ChatView.test.tsx / 任务记录）

```
git diff --stat 2c546ee..3721dd6 -- src
 src/web/components/ChatView.test.tsx | 135 ++++++++++++++++++++++++-------
 src/web/components/ChatView.tsx      |   9 ++-
git diff --name-status 2c546ee..3721dd6 -- .agents docs
 M .agents/tasks/20260917-compaction-fix.md
 A .agents/tasks/20260917-compaction-rereview.md   # 我的第二轮记录被集成进来
```

`styles.css` / `protocol.ts` / `todo-tasks.ts` / 全部 `src/server/*` / `integrations/` **本轮零改动** ⇒ 只落在契约允许的三个位置，**已核对无问题**。

## 4. 回归与反向验证

**变异矩阵（6 个；修复者套件从 `cwd=/tmp` + `--root /tmp/rr/mut` 运行，顺带覆盖 F-E）**

| 变异 | 修复者测试失败 | 我的测试失败 | 说明 |
| --- | --- | --- | --- |
| R-A 删 `observer.observe(viewport)` | 1（F-A 那条，无其他） | 3 | F-A 精确被抓住，且不假通过 |
| R-B 去掉 `disconnect()` | 1（F-B 那条，无其他） | 2 | F-B 精确被抓住 |
| R-1 被测树 CSS 改回固定 176px | 1（stylesheet wired） | 0 | F-E 读的是被测树 |
| R-3 去掉 `Math.max(measured, 176)` | 1（never reserves less） | 0 | F1 下界语义仍被覆盖 |
| R-E2 F-E 改回 `process.cwd()` | 1（ENOENT，见 §3.4） | 0 | 改动必要且有效 |
| R-D1 `useLayoutEffect` → `useEffect` | **0** | **0** | 与"无 timing 护栏"自述一致（F-D-1） |

**上轮及上上轮断言抽样复跑（我自己写的那套）**

- 顺序 / 分段 / 分界：`组 → 正文`、正文在中间、`组 → 横线 → 组 → 正文`、段首/段尾/连续分界、divider-only 不造 `Worked for`、图片在组之后 —— 全部通过。
- todo 条：计数/分组/tombstone/不占位/composer 相对位置 —— 全部通过。
- 与 `dc8282c` 机械对照：10 个无分界形状 + 2 个运行中形状的 DOM trace **逐字节 identical**（`diff` 空）；`dc8282c` 侧只有 4 条分界相关用例失败（它没有该功能），符合预期。
- F1 语义（我自己新写的 5 条，不引用修复者断言）：下界恒 ≥176（10 个 measured 值）、实测值精确跟随（480/600/690）、有条时回退 ≥176+260、无条时回退恰为 176、CSS 契约（变量名一致 + 回退 176 + `var()` 在 `padding` 简写之后）—— 全部通过。

## 5. NOT RUN

| 项目 | 原因 |
| --- | --- |
| **F-D 的真实浏览器可见性**（重挂载时首帧是否还闪一下旧预留） | jsdom 无绘制；需要 browser-use / 开发者确认。代码层已确认，但**不能被记为"已验证可见性"** |
| F1 的真实遮挡像素 / 展开前后留白 | 同上，需 Integrator 的 browser-use |
| 真实 Pi session / Pane / companion 集成 | 未授权 |
| `npm ci` | 依赖已就绪，未重复执行 |

## 6. 剩余风险（都不阻断）

1. **F-D 无回归护栏**（F-D-1）：`useLayoutEffect` 若被改回 `useEffect`，现有 166 个测试不会报警。可选补一个调度层断言（脆弱）或在记录里显式登记为已知缺口。
2. **F-B 断言是全称**：它也覆盖 assistant-ui 自己的 observer，因此 assistant-ui 的清理若出问题会以本组件测试失败的形式暴露（信息噪声，非缺陷）。
3. **预留没有上限**：`Math.max(measured, 176)` 只有下界。若 footer 比 viewport 还高（窗口高度 < 约 450px 且 todo 条展开），预留会超过容器高度、正文可视区被压到 0；此时 composer 本身也已部分出屏，属极端布局，且用户折叠 todo 条即可恢复。建议登记为已知边界，不做代码改动。
4. **F-C（上轮 P3，本轮未触及）**：`promptCalls()` 过滤同时匹配 `/api/prompt-delivery/events`，负载下偶发失败；本轮多次全量运行未复现，但上轮已两次复现。
5. **F3–F9（第一轮登记，未触及）**：超 128 KiB 整条不渲染、`at: 0` 共享展开状态、`role:createdAt` 去重键、客户端不限 todo 行数、`promptCalls` 脆弱、kept entry 非消息时横线顺延、turnActivity latch。均已在记录中登记，待开发者决定。

## 7. 独立判断

**可以合入 `main`（无阻断）。**

- 四条 P3 中三条（F-A / F-B / F-E）已完全闭合，且都是**变异可证伪**的闭合；F-D 在代码层闭合（本轮唯一可执行改动就是 `useEffect` → `useLayoutEffect`），唯一遗留是"真实浏览器这一帧是否可见"，这本就不在 jsdom 能力范围内，需 Integrator 的 browser-use 补测才能记为已验证。
- 没有假测试：F-D 确实没有测试，修复者也如实说明了；`flushSync` 那条理由经我实测成立，仅概括措辞可再精确（F-D-1）。
- 回归无损失：gates 独立复跑 166/166、我的 32 条断言全绿、与 `dc8282c` 的 12 个形状 trace 逐字节一致、F1 下界与 CSS 契约仍被变异覆盖。
- 越界无问题：本轮只改 `ChatView.tsx`（1 行 import + 1 行 hook + 注释）与 `ChatView.test.tsx`。

---

## 附：本轮任务定义原文（逐字保留，避免契约文本被记录覆盖）

> 说明：本轮任务定义与复审记录使用同一路径 `.agents/tasks/20260917-compaction-rereview2.md`，写入记录会覆盖契约原文。为不丢失契约，这里附上 `eb92526` 中的原文（逐字）。

> # 第三轮（聚焦）复审：F-A/F-B/F-D/F-E 小补丁
> 
> - 状态：待 Reviewer 执行
> - 角色：**同一位独立 Reviewer**（`herzi_reviewer2`）
> - Candidate：`3721dd6` = 上轮候选 `2c546ee`（含 `f9f5c5a` 第二轮记录）+ 小补丁 `0795d9f` / `ef8d890`
> - 上轮记录：`.agents/tasks/20260917-compaction-rereview.md`（**不要重写它**）
> - 上轮结论：可合入、无阻断；新 findings 全为 P3（F-A/F-B/F-C/F-D/F-E），开发者选择"先打小补丁再合"
> 
> ## 本轮范围（聚焦，只复核这 4 条 + 回归）
> 
> 实现者自述的补丁内容（**不采信**，逐条独立验证）：
> 
> | 编号 | 声称的修法 |
> | --- | --- |
> | F-D | `useChatFooterInset` 的 dependency effect 由 `useEffect` 改为 `useLayoutEffect` |
> | F-A | 新增断言：**观察 `.chat-footer` 的那个 observer 必须同时观察 `.chat-viewport`**（不是"存在某个观察 viewport 的 observer"） |
> | F-B | 新增 teardown 断言：unmount/`cleanup()` 后所有观察过 `.chat-footer` 的 observer 都已 `disconnect()` |
> | F-E | 样式表断言改为 `path.join(import.meta.dirname, "../styles.css")`，不再依赖 `process.cwd()` |
> 
> 请独立核对：
> 
> 1. **F-D 是否真的改成 layout timing**（读代码确认，不是读注释）；并判断**是否存在能证伪它的测试**——若 jsdom 无法区分 `useLayoutEffect` 与 `useEffect`，请明确写"该点只能代码审阅确认，浏览器可见性 NOT RUN"，并说明**如果实现者写了假测试你要指出来**。
> 2. **F-A 的断言是否真的绑在"观察 footer 的那个 observer"上**：用你自己的变异（删掉 `observer.observe(viewport)`）确认它失败；并确认它不会因为 assistant-ui 自己也观察 viewport 而假通过。
> 3. **F-B 的断言能否抓住 teardown 回归**：变异（`return () => undefined;`）后必须失败；同时确认该断言不会把 assistant-ui 的 observer 误判成本组件的。
> 4. **F-E 是否真的与 cwd 解耦**：请在**非仓库根 cwd** 下运行该用例（例如把工作目录切到 `/tmp` 用配置指向候选树，或等价方式）确认仍能读到被测树的 `styles.css`；并确认它读的是**被测树**的 CSS（用变异改 CSS 应能被抓住）。
> 5. **回归**：独立复跑 `typecheck` / `npm test` / `npm run build`（Integrator 实测 166 tests PASS，不许采信）；至少抽样复跑你前两轮的顺序/分段/`dc8282c` 对照断言；确认本轮补丁没有改动 F1 的测量语义（下界、变量名、CSS 契约）。
> 6. **越界**：本轮补丁只应落在 `ChatView.tsx`、`ChatView.test.tsx`、任务记录；请确认。
> 
> ## 权限与交付
> 
> - **只读产品代码**；只允许写本文件（`.agents/tasks/20260917-compaction-rereview2.md`）并提交。
> - 可以：目标测试、`npm run typecheck`、`npm test`、`npm run build`、`git show`/临时树对照、在 `/tmp` 写临时脚本（用完删除，不得留在仓库）。
> - 不得：运行 `npm run dev`、操作真实 Pane、merge/rebase/push。
> - 上一轮你已用 `/tmp/rr` 做过临时树与变异，可以复用同样的做法（若目录已清理请重建）。
> 
> ## 输出
> 
> - 逐条给出 F-A/F-B/F-D/F-E 的结论：`已闭合` / `未闭合` / `有条件闭合`，每条附 `path:line` 与证据（变异结果或命令输出）。
> - 单列 `NOT RUN` 与剩余风险。
> - 最后给出独立判断：**现在能否合入 `main`**（可以合 / 有阻断 / 需要条件）。
