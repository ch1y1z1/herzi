# Review 任务：Rev.2 —— N1 修复的最小定向复审（第三轮）

- 日期：2026-09-19
- 复审对象：`review-20260918-tool-views-rev2-r3` 分支 = `ddbabf4`（= `bf6c04c` + 修复 `b8ee7a2` + 记录 `ddbabf4`）
- 本 worktree：`/Users/chiyizi/.herdr/worktrees/herzi/review-20260918-tool-views-rev2-r3`，Herdr workspace `w1F` / pane `w1F:p1`
- 唯一写入范围：本文件（`.agents/tasks/20260918-tool-views-rev2-review-r3.md`）

## 1. 背景（只读这一段就够）

第二轮复审（`.agents/tasks/20260918-tool-views-rev2-review-r2.md`，可用
`git show review-20260918-tool-views-rev2-r2:.agents/tasks/20260918-tool-views-rev2-review-r2.md` 读）判定 **N1（blocking）**：F1 的修复把红色规则写成 `.tool-result-error pre`（0,1,1），而 `.tool-detail pre { color: gray }` 也是 (0,1,1) 且源码在后 → 红色被覆盖，失败正文渲染成灰色（"泄漏没了，红色也没了"）。

本轮修复 `b8ee7a2` 的改动（`git diff bf6c04c..ddbabf4`）：

- CSS：`.tool-result-error pre` → **`.tool-detail .tool-result-error pre`**（0,2,1）。
- `styles.test.ts`：新增一个迷你 CSS 级联解析器（`specificity` / `matchesPath` / `resolvedColor`），断言"失败 result 的 `<pre>` 解析为红色、成功兄弟与 Arguments 仍是灰色"。
- 顺带改掉 N2 的 3 处代码注释（`styles.css`、`styles.test.ts`、`WebFetchView.tsx`）。

## 2. 规则

只读产品代码（唯一可写文件是本 review 记录）；不修 bug；不 merge / rebase / push；不运行 `npm run dev`；不读真实 session；
真实浏览器验收不授权；可用 `/tmp` 临时脚本。

## 3. 本轮只需验三件事

### 3.1 N1 是否真的闭合

- 独立确认两条规则的**特异性与顺序**：`.tool-detail .tool-result-error pre` vs `.tool-detail pre` —— 谁是胜者？**不要只看顺序**（顺序只是等特异性时的 tie-breaker）。给出你自己的计算。
- 确认红色规则的祖先 `.tool-detail` 在真实 DOM 中**始终存在**（`GenericToolDetail` 的渲染路径；`ChatView.tsx` 里 `.tool-detail` 是怎么挂的）——否则新选择器会在某条路径上失效。
- 全量确认 CSS 里**没有**别的规则能把失败 result 的 `<pre>` 重新染灰（包括 `.markdown-body pre`、`.tool-view pre` 等更靠后的规则在这个 DOM 路径上是否匹配）。
- **可证伪实验（必须做）**：把选择器降回 `.tool-result-error pre`，确认 `styles.test.ts` 的级联断言 **FAIL**（应报 `expected '#5e635a' to be '#c2635d'` 之类），随后还原并校验 md5 一致。

### 3.2 新断言本身是否可信

- 那个迷你级联解析器（`specificity` / `matchesPath` / `resolvedColor`）是否有会让它**误判**的缺陷？至少检查：多选择器逗号列表、后代 vs 子选择器（是否处理 `>`）、伪类/属性选择器、`!important`（全文件 0 处，确认）、层叠层（`@layer`，确认没有）、以及"命中但属性不是 `color`"的规则会不会被当成候选。
- 断言是否**真的会在回归时失败**（你在 3.1 已实测一次，说明它有效）；有没有"永远为真"的部分。
- 判断它是否足以替代真实浏览器验证（诚实说明它能证明什么、不能证明什么）。**不要**把 jsdom 的计算样式当证据（上一轮已确认 jsdom 不做级联）。

### 3.3 N2 的 3 处注释是否改干净

- `src/web/styles.css`（scroll window 注释）、`src/web/styles.test.ts`、`src/web/toolViews/WebFetchView.tsx`：确认已统一为「窗口高 16 个代码行」的表述，与 `§11.2` 的 per-view 行数表不冲突。
- 顺便全仓 grep 一次还有没有残留的「可见 16 行 / 16 visible lines / exactly 16 of those lines」写法（`src/**` 范围；`docs/**` 归 Integrator，不计入本轮）。

## 4. 可运行的验证

```bash
npx vitest run src/web/styles.test.ts src/web/toolViews src/web/components/ChatView.test.tsx
npm run typecheck
npm test          # 建议 2–3 次
npm run build
```

## 5. 结论格式

findings 沿用既有格式；最后给出 **可合入 / 需修复后合入 / 不可合入**，附全部命令的 `PASS` / `FAIL` / `NOT RUN`。
若三条全部通过且你未发现新问题，直接给「可合入」。

## 6. 交接

写入本文件并提交 1 个 commit，留在 Pane 等通知，不自行合入。

---

# 独立复审结果：N1 修复的最小定向复审（第三轮）

- 日期：2026-09-19
- 复审对象：分支 `review-20260918-tool-views-rev2-r3` 的代码状态 `ddbabf4`（= `bf6c04c` + 修复 `b8ee7a2` + 记录 `ddbabf4`）；本 worktree 的 HEAD = `df0945f`（`ddbabf4` + 本契约提交，`src/**` 未变）
- 复审范围：只验三件事 ——（1）N1 是否闭合；（2）新迷你级联解析器是否可信；（3）N2 的 3 处注释是否改干净。未重开已裁决的 N3/N4/N6，未重审已关闭的 F1/F2/F4/F5。
- 方式：只读源码 + 自建 postcss 级联解析（独立实现）+ 契约要求的可证伪实验 + 对**构建产物**（含 Tailwind）再跑一次独立解析 + 解析器对抗性探测
- 未做：真实浏览器 / 真实 Pane 验收（未授权）、`npm run dev`（禁止）、读取真实 session / JSONL

## 0. 结论

**可合入（N1 闭合；无阻塞项）。**

| 本轮三项 | 判定 |
| --- | --- |
| 3.1 N1 是否闭合 | **闭合**：`.tool-detail .tool-result-error pre` 特异性 (0,2,1) 严格高于 `.tool-detail pre` (0,1,1)，靠特异性取胜而非顺序；祖先 `.tool-detail` 在真实 DOM 路径上恒在；无更靠后规则能把失败 `<pre>` 重新染灰。可证伪实验实测 **FAIL（预期）** 并已还原（md5 一致）。 |
| 3.2 新断言是否可信 | **在本文件与本 DOM 路径范围内可信、且可证伪**；有明确的盲区与「不能证明什么」，见 §2。不阻塞。 |
| 3.3 N2 的 3 处注释 | **改干净**：`styles.css` / `styles.test.ts` / `WebFetchView.tsx` 已统一为「窗口高 16 个代码行」；`src/**` 无残留「可见 16 行 / 16 visible lines」写法。 |

唯一的非阻塞观察是 **O1（info）**：本轮新加的 `FAILED_OUTPUT_PRE` 断言的注释高估了该路径的可达性（真实失败调用一律走通用详情）。不影响 N1 闭合，也不要求本轮修复。

## 1. N1 是否闭合（3.1）

### 1.1 我自己的特异性计算

按 CSS Selectors Level 4 §17（A=id，B=class/属性/伪类，C=元素/伪元素），我**不看源码顺序先算特异性**：

| 选择器 | A | B | C | 特异性 |
| --- | --- | --- | --- | --- |
| `.tool-detail .tool-result-error pre`（`src/web/styles.css:948`） | 0 | 2 | 1 | **(0,2,1)** |
| `.tool-detail pre`（`src/web/styles.css:984`） | 0 | 1 | 1 | (0,1,1) |

`compareSpecificity(红, 灰) = +1 > 0` → **红色规则在没有 `!important`、同源、同层叠层的前提下必胜灰色规则，与源码顺序无关**。文件里红色（L948）确实排在灰色（L984）**之前**，但这不再影响结果。（上一轮 N1 的两条规则都是 (0,1,1)，才落到「后出现者胜」→ 灰色。）

### 1.2 `.tool-detail` 祖先在真实 DOM 路径上恒在

- 全仓（非测试）只有两处渲染 `<ToolDetail>`：`ChatView.tsx:1251`（`ToolFallback`）与 `ChatView.tsx:1431`（`ToolItemRow`），**两处都被 `<div className="tool-detail">` 包住**（`:1250`、`:1430`）。
- `GenericToolDetail` 只被构造一次：`ChatView.tsx:1445`，位于 `ToolDetail` 内；没有其它调用点。
- 失败结果 `<pre>` 的链路：`ToolDetail`（`:1451` `if (item.isError || !View) return fallback;`）→ `GenericToolDetail` → `ToolResultData` → `section.tool-result.tool-result-error`（`:1560`）→ `ScrollBox`(`div.tool-view-scroll`) → `<pre>`。**`.tool-detail` 必然在链上**，故新选择器不会在某条路径上失效。
- 成功兄弟的 Result section 不带 `tool-result-error`（只有 `isError` 才加，`:1560`），所以「绑到失败项自身」的语义成立。

### 1.3 没有更靠后的规则会把失败 `<pre>` 重新染灰

我用 postcss 独立枚举「最右复合选择器能命中裸 `<pre>`」的全部规则，并对**源码**和**构建产物**各跑一次：

- 源码 `src/web/styles.css`：能命中 `<pre>` 的规则只有 4 条（`*`、`.markdown-body p/…/pre` 的 margin 组、`.markdown-body pre`、`.tool-detail .tool-result-error pre`、`.tool-detail pre`）。其中只有后两条 + `.markdown-body pre` 声明 `color`；`.markdown-body pre` 需要 `.markdown-body` 祖先（通用详情里没有，且它顺序更靠前）。
- 构建产物 `dist/web/assets/index-WzzfKINp.css`（已含 Tailwind）：额外出现 Tailwind 的 `code,kbd,samp,pre`（`@layer base`，**无 `color`**）、`*` 与 `.katex *`（**无 `color`**），**没有任何规则能重新给失败 `<pre>` 上灰色**。
- 关键：**发行包里红色仍排在灰色之前**（offset 19782 < 20361），但独立解析的 WINNER 是 `#c2635d` —— 这正是「靠特异性、不靠顺序」的直接反证（上一轮同位置顺序下 WINNER 是灰）。

**独立解析的胜出者**（postcss 解析 + 我自己的规范特异性实现）：

| 路径 | 参与竞争 | WINNER |
| --- | --- | --- |
| 失败项的 Result `<pre>` | `.tool-detail .tool-result-error pre` (0,2,1) `#c2635d`；`.tool-detail pre` (0,1,1) `#5e635a` | **`#c2635d`** |
| 同失败分组内成功兄弟的 `<pre>` | 仅 `.tool-detail pre` | `#5e635a` |
| 失败项的 Arguments `<pre>` | 仅 `.tool-detail pre` | `#5e635a` |
| 失败的 `bash` 视图输出 `<pre class="output-text output-error">` | `.output-body pre.output-error` (0,2,1) | `#c2635d` |

结论与 `styles.test.ts` 的 4 条用例完全一致。

### 1.4 可证伪实验（契约强制，已实测）

- **基线**：`npx vitest run src/web/styles.test.ts` → **PASS**（18 tests）。
- **实验**：把 `src/web/styles.css:948` 的选择器降回 `.tool-result-error pre`（等特异性、仍在灰规则之前）→
  `npx vitest run src/web/styles.test.ts` → **FAIL 3 条**，含决定性的
  `renders the failing result red`：`AssertionError: expected '#5e635a' to be '#c2635d'`
  （正是 N1 的「失败正文变灰」症状）；另两条是 guard 的 Set 不等与机制外的其它断言。
- **还原**：`cp` 回备份 → `md5 = a6efdf4c4fe592e85d43c65b635325ce`（与实验前一致），`git diff src/web/styles.css` 为空。
- **附加实验（另一方向）**：改成祖先键控的旧写法 `.tool-error .tool-detail pre` →
  **FAIL 4 条**，含 `leaves a successful sibling in a failed group gray`：`expected '#c2635d' to be '#5e635a'`
  （F1 泄漏形态）→ 已还原，md5 一致。即两个方向的回归都能被这套断言抓住。

## 2. 新断言（迷你级联解析器）是否可信（3.2）

### 2.1 我能独立复核的核心结论

- 我把 `specificity` / `matchesPath` / `resolvedColor` 的语义用 postcss + 独立实现复算，对 §1.3 的 4 条路径**结论一致**。
- 解析器只对 `color` 属性建立候选：`resolvedColor` 先 `declarations(body).get("color")`，命中其它属性的规则不会成为候选；合成用例 `pre { border-color: red; background-color: blue }` **不会**被当成候选（实测 WINNER 仍是灰）。「命中但不是 `color`」这一点没问题。
- 逗号列表：`rulesOf` 对选择器列表按 `,` 拆分，普通列表正确（`a,\nb` 与 `a, b` 等价）。
- 后代 vs 子选择器：`>` 已建模，`div.tool-view-scroll > pre` 判真、`.tool-detail > pre` 判假，方向正确。

### 2.2 已知盲区（会让它误判的缺陷）与为何当前无影响

| 盲区 | 具体行为 | 当前是否影响 |
| --- | --- | --- |
| `!important` 被忽略 | 排序只用「特异性 → 顺序」，不看 importance；且值会带 ` !important` 后缀返回。合成用例 `.tool-detail pre{gray}` + `pre{blue !important}` → 解析器错误地给 `gray` | **无**：全文件 `!important` 计数 **0**（已确认）。若将来加了带 `!important` 的**新** `pre` 颜色选择器，guard 的 Set 会因选择器变化而 FAIL；只有「同一选择器 + `!important`」才漏 |
| 层叠层 `@layer` 未建模 | 源码 `styles.css` 检查：`@layer` / `@supports` / `@container` 出现 **0 次** | 无（构建产物里的 Tailwind `@layer base` 不在这份源码里，且无 pre 颜色） |
| `@media` 条件被「拍平」 | 正则解析会丢掉 `@media (...)` 包裹，把内部规则当成无条件规则（合成用例实测 `@media{ .tool-detail pre{color:pink} }` 被判为无条件命中） | **无**：`styles.css` 唯一的 `@media`（L1917）只改布局、无 `color`。残留风险：未来若在 `@media` 里给**已有**的 pre 选择器加颜色，Set guard 不会变，可能漏 |
| 特异性对 `::伪元素` / `:nth-child()` / `:not()` / `:is()` 与规范有偏差 | 实测：`pre::before` → 测试 [0,1,1] vs 规范 [0,0,2]；`:nth-child(even)` → [0,1,1] vs [0,0,1]；`:not(.foo)` → [0,2,0] vs [0,1,0]；`:is(#a,.b)` → [1,2,0] vs [1,1,0] | **无**：guard 强制每条「能命中 `pre`」的选择器**每个复合选择器只能含元素名与 `.class`**（正则 `^[a-zA-Z]*(\.[\w-]+)*$`），伪类/属性/函数式伪类一旦出现在 pre 规则里会直接 FAIL。本案 4 条 pre 规则的复合选择器全部落在这个子集内（实测 true），所以特异性偏差碰不到 |
| `matchesPath` 不支持兄弟组合符 `+`/`~` | 直接返回 false | 无：本案无此类 pre 规则；若新增，其最右复合选择器是 `pre` 会被 Set guard 抓住 |
| 逗号出现在 `:is(...)` / 属性值 | 会在 `,` 处错误拆分 | 无：本案无此类 pre 规则（且会被 guard 的复合选择器正则拦住） |
| `@import "tailwindcss";` 被粘进第一条规则的「选择器」 | `rulesOf` 的第一条是 `@import "tailwindcss"; :root`，因此 `cssRule(":root")` / `hasRule(":root")` 会失败 | 无：当前没有针对 `:root` 的断言；也不影响 `<pre>` 路径（最右复合选择器是 `:root`，匹配不到 `pre`） |
| 只解析本文件、不解析 Tailwind 产物 | 解析器无法看见 Tailwind 注入的规则 | 我用**构建产物**独立复算（§1.3）：Tailwind 相关规则无 `color`，故无影响 |

### 2.3 这个断言能证明什么、不能证明什么（诚实边界）

- **能证明**：在这份 `styles.css` 的解析结果与所述祖先链下，失败结果 `<pre>` 的 `color` 胜出者是 `#c2635d`，且它**靠特异性**（0,2,1 > 0,1,1）而不是顺序取胜；成功兄弟与 Arguments 仍是灰。它在两个方向都已实测可证伪（§1.4）。
- **不能证明**：不是真实浏览器的计算样式测量；不覆盖继承、`var()`、preflight、Tailwind 生成的层、`@media` 条件、`!important` 与层叠层；也不覆盖真实渲染的取整/滚动条观感。**我未把 jsdom 计算样式当证据**（沿用上一轮结论：jsdom 忽略特异性，仅可作旁证，本轮干脆不依赖它）。
- **一条自我测试的边界**：`resolves colors with CSS's own precedence` 里对 `specificity(".tool-detail pre")` 的断言只测「解析器对两个硬编码字符串的返回值」，**不读 styles.css** —— 它在 N1 缺陷态也会通过。真正锁住 N1 的是 guard + `resolvedColor` 那 4 条结果断言（§1.4 已实测它们在缺陷态 FAIL）。这不是缺陷，只是「别把它当唯一锁」。
- 未发现 `expect(true)` / `it.skip` / `it.only` / 只做快照的永真断言（`styles.test.ts` 共 18 条 `it`，全为具体值断言）。

## 3. N2 的 3 处注释（3.3）

- `src/web/styles.css`（L1018-1023）：已改为「the window is 16 **code lines** tall — not 15, not 17 — and the content it shows depends on each view's own row heights（`edit` ~14–15、multi-file `ffgrep` ~9–10、Markdown ~12–13）」；并把横向滚动那句改成如实说明 Markdown 代码块保留自己的横向滚动。
- `src/web/styles.test.ts`（L282）：`of the 16 visible lines` → `of the window's 16 code lines`。
- `src/web/toolViews/WebFetchView.tsx`（L9-12）：`the shared ScrollBox (16 lines visible, native scroll)` → `a window 16 code lines tall, native scroll`，并补「Markdown 自身行距导致可见行数少于 16」。
- 与 §11.2 的 per-view 行数表**不冲突**（Edit ~14–15 / ffgrep ~9–10 / Markdown ~12–13 与表中「窗口 16 代码行、各视图更少」一致）。
- 全仓 grep（`src/**`）：`可见 16` = 0、`16 行` = 0、`16 visible` = 0、`visible lines` = 0、`exactly 16` = 0、`16 of those lines` = 0。唯一命中 `16 lines` 的是 `ScrollBox.tsx:10` 的 `"16 lines" is the height of the window in **code lines**` —— 这是上一轮就已改好的正确表述，不属于 N2 的 3 处残留。（`docs/**` 按裁决归 Integrator，未查。）

## 4. Findings

### O1 — 新加的 `FAILED_OUTPUT_PRE` 断言注释高估了该路径的可达性（info，非阻塞）

```
[严重程度: info]
位置：src/web/styles.test.ts:258-266（FAILED_OUTPUT_PRE 定义与注释「A failed `bash` output, which renders
      inside the registered view.」）、:388-390（renders a failed call's view output red too）
触发条件：任何 `item.isError === true` 的调用。
影响：注释不准确 —— `ChatView.tsx:1451` 的 `if (item.isError || !View) return fallback;` 让**所有**失败调用
      走通用详情，因此 `.output-body pre.output-error` 这条链在集成后的 ChatView 路径上**不可达**；它只在
      `OutputView` 的组件级单测（`views.test.tsx:316`）里被渲染过。该断言本身无害（只是锁住一条当前不可达的
      class 链），不会掩盖 N1，也不影响用户可见行为。`views.test.tsx` 的注释其实已承认「real failed calls take
      the generic error detail instead」，与此处注释自相矛盾。
证据：全仓非测试代码中 `OutputView` 只有 `toolViews/index.ts:29` 一处注册；`ToolDetail` 只在 `ChatView.tsx:1251/1431`
      两处被调用，且都先经 `if (item.isError || !View) return fallback;`。
建议方向：不改代码也可接受；若顺手，把该注释改为「the class chain OutputView renders when given isError
      (component-level; integrated failed calls take the generic detail)」，避免读者以为它在集成路径上生效。
```

其余为**已验证通过、无新问题**：`ChatView.tsx` 的改动仍只在 `GenericToolDetail` / `ToolData` / `ToolResultData` 内；六个已注册视图与通用详情的 DOM 结构未变；`npm test` 20 files / **309 tests** 全绿（较上一轮 +6，正是新解析器的 5 条 + 机制断言 1 条）。

## 5. 我的运行记录（全部命令与结果）

PASS / FAIL / NOT RUN 均指**本次实际执行**的结果。

| # | 命令 / 动作 | 结果 |
| --- | --- | --- |
| 1 | `git log --oneline -5` / `git status --short` / `git branch --show-current` | PASS（HEAD `df0945f`，工作树 clean，分支 `review-20260918-tool-views-rev2-r3`） |
| 2 | 读 `.agents/tasks/20260918-tool-views-rev2-review-r3.md` | PASS（本轮契约） |
| 3 | `git show review-20260918-tool-views-rev2-r2:...review-r2.md` | PASS（上一轮 N1/N2/N5 原始判定） |
| 4 | `git diff bf6c04c..ddbabf4`（全文） | PASS（CSS 选择器、styles.test.ts、WebFetchView 注释、任务记录共 4 文件） |
| 5 | 读 `ChatView.tsx`（ToolFallback / ToolItemRow / ToolDetail / GenericToolDetail / ToolData / ToolResultData） | PASS（`.tool-detail` 祖先恒在；`tool-result-error` 只落失败 result） |
| 6 | 全量 grep：`tool-result-error` / `tool-detail pre` / `markdown-body pre` / `output-body pre` / `!important` / `@layer` / `@supports` / `@container` / `@media` / `color: var(` | PASS（`!important`=0、`@layer`=0、`@supports`=0、`@container`=0；`@media` 仅 1 处布局） |
| 7 | `npm ci` | PASS（493 packages，未改依赖版本） |
| 8 | 独立解析器 `/tmp/r3-independent/independent.mjs`（postcss + 规范特异性）跑源码 | PASS（FAILED_RESULT_PRE WINNER `#c2635d`；SIBLING/ARGUMENTS `#5e635a`；pre 规则集合 = 4 条） |
| 9 | 独立解析器跑**构建产物** `dist/web/assets/index-WzzfKINp.css` | PASS（WINNER 仍 `#c2635d`，红规则 offset 19782 < 灰 20361；Tailwind 规则无 `color`） |
| 10 | 解析器对抗性探测 `/tmp/r3-independent/parser-probe.mjs`（特异性差异、matchesPath、@media/`:is`/属性逗号） | PASS（差异项已记录在 §2.2，均不影响本案） |
| 11 | 合成用例 `/tmp/r3-independent/synth.mjs`（`!important` / 非 color / `@media` 拍平） | PASS（复现盲区，见 §2.2） |
| 12 | **基线**：`npx vitest run src/web/styles.test.ts` | **PASS**（18 tests） |
| 13 | **可证伪实验**：选择器降回 `.tool-result-error pre` → `npx vitest run src/web/styles.test.ts` | **FAIL（预期）** 3 条，含 `expected '#5e635a' to be '#c2635d'` |
| 14 | 还原 → `md5` + `git diff` | PASS（md5 与实验前一致；diff 空） |
| 15 | **附加实验**：改为 `.tool-error .tool-detail pre` → 同上 | **FAIL（预期）** 4 条，含 sibling 泄漏 `expected '#c2635d' to be '#5e635a'`；已还原 |
| 16 | `npx vitest run src/web/toolViews src/web/components/ChatView.test.tsx` | **PASS**（4 files / 142 tests，5.53 s） |
| 17 | `npm run typecheck` | **PASS**（exit 0） |
| 18 | `npm test` × 3 | **PASS 3/3**（每次 20 files / 309 tests；6.89 / 6.92 / 8.81 s） |
| 19 | `rm -rf dist && npm run build` | **PASS**（exit 0；`index-WzzfKINp.css` = 66245 B，与 Worker 记录一致） |
| 20 | 全仓 grep `src/**` 残留「16 行 / 16 visible lines / exactly 16 of those lines」 | PASS（全部 0；唯一 `16 lines` 命中是 `ScrollBox.tsx:10` 的正确表述） |
| 21 | 收尾：`md5` 三个被检查文件、`git status --short` | PASS（`styles.css a6efdf4c…`、`styles.test.ts 4be467fe…`、`WebFetchView.tsx 1516a796…`；工作树 clean） |
| — | 真实浏览器 / 真实 Pane 验收 | **NOT RUN**（未授权） |
| — | `npm run dev` | **NOT RUN**（禁止） |
| — | 读取真实 session / JSONL | **NOT RUN**（禁止） |

## 6. 未验证与限制（诚实边界）

- 未做真实浏览器与真实 Pane 验收（未授权）：**没有任何真实渲染测量**。N1 的闭合结论来自三部分相互独立的静态证据：① 规范特异性计算（0,2,1 > 0,1,1）；② postcss 独立级联解析（源码与构建产物各一次）；③ DOM 层源码核对（`.tool-detail` 恒在、`tool-result-error` 只落失败 result）。**三者都不是浏览器的计算样式测量**，属静态推断。
- 我**没有**把 jsdom 计算样式当证据（沿用上一轮结论：jsdom 忽略特异性）。本轮完全未使用 jsdom 做级联判断。
- 迷你解析器的盲区（`!important`、`@layer`、`@media` 条件、伪类/伪元素特异性、兄弟组合符、`@import` 粘选择器）已在 §2.2 逐条列出并验证「当前无影响」；这些是**范围限制**，不是本批缺陷。
- 我在本 worktree 的 `src/web/styles.css` 上做过 3 次**临时**改写（降级、还原、祖先键控），均已还原并逐个校验 md5、`git status` clean；`styles.test.ts`、`WebFetchView.tsx`、`dist`、`package.json`、配置未做持久改动。
- /tmp 实验产物：`/tmp/r3-independent/`（`independent.mjs`、`parser-probe.mjs`、`synth.mjs`、`styles.css.orig` + `.md5`、`a/b/c/d.css`）、`/tmp/r3-npmci.log`。

## 7. 交接

- 结论：**可合入**（三条全过；唯一 info 级观察 O1 不阻塞、不要求本轮修复）。
- 记录已写入本文件并提交 1 个 commit；未 merge / rebase / push，未自行合入，留在 Pane 等通知。
