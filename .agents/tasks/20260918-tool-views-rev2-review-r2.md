# Review 任务：Rev.2 修复的定向复审

- 日期：2026-09-18
- 复审对象：`review-20260918-tool-views-rev2-r2` 分支 = `bf6c04c`（= 首轮交付 `91519de` + 修复 `cd316ff` + 记录 `bf6c04c`）
- 本 worktree：`/Users/chiyizi/.herdr/worktrees/herzi/review-20260918-tool-views-rev2-r2`，Herdr workspace `w1E` / pane `w1E:p1`
- 你的**唯一写入范围**：本文件（`.agents/tasks/20260918-tool-views-rev2-review-r2.md`）

## 1. 背景

首轮审查（`.agents/tasks/20260918-tool-views-rev2-review.md`，结论「需修复后合入」，8 条 findings）已完成。读取方式：

```bash
git show review-20260918-tool-views-rev2:.agents/tasks/20260918-tool-views-rev2-review.md
```

开发者裁决：**F1 必修、F2 改文案（「窗口高 16 行」，不改布局）、F4 修、F5 修、F6 不改代码、F7 记为已知项、F3/F8 由 Integrator 处理文档**。

修复 diff：`git diff 91519de..bf6c04c`。Worker 的处置记录：`.agents/tasks/20260918-tool-views-rev2.md` §11。

**本轮只审这 4 条修复是否成立、是否正确、是否引入回归**；不要重开已裁决的项（F2 的"不改布局"、F6、F7 都是开发者的决定，除非你发现修复本身有错）。

## 2. 规则

- **只读产品代码**：不得修改 `src/**`、`docs/**`、`package.json`、测试或配置；只能写本文件。
- **不修 bug**；不 merge / rebase / push；不运行 `npm run dev`；不读取真实 session/JSONL。
- 真实浏览器验收不授权；允许用 `/tmp` 临时脚本做真实执行与构建分析。

## 3. 必须独立验证的四条

### 3.1 F1 —— 错误红色是否真的不再泄漏到成功项

- Worker 的方案是把标记放到**失败项自己的 Result section**（`tool-result-error`），而不是以 `.tool-error` 祖先为键。请核实：
  - CSS 里是否**不存在**任何以 `.tool-error` 为祖先的 `<pre>` 着色规则（`grep` 全量确认）。
  - `ChatView.tsx` 里 `tool-result-error` 只加在 `isError` 的那个 section 上；分组级 `tool-error` 的红图标行为是否保持不变。
  - 关键推理复核：**分组内的成功子行是否确实拿不到红色**？给出你的独立证据（源码级 + 类结构级；注意 jsdom 不做级联，别用计算样式当证据）。
  - 做一次**可证伪实验**：把规则改回 `.tool-error .tool-detail pre` 或以祖先为键的写法，确认新增测试会失败；随后还原（校验 md5 一致）。
- 顺带核对 Worker 的说法「Arguments 段回到灰色，只有错误正文是红的」是否属实。

### 3.2 F2 —— 「窗口高 16 行」的表述是否改干净

- 检查**所有**出现「16 行」的位置（代码注释、常量名、UI 文案、任务记录、`data-*` 属性、测试断言），确认表述已统一为「窗口高 16（代码）行」而不是「可见 16 行」。
- 核对 Worker 给的 per-view 可见行数表（`read/write` 16、`bash` 16、`edit` 14–15、`ffgrep` 9–10、`fffind` 15、Markdown ≤16）是否与 CSS 算术一致；抽查 2–3 行自己算一遍。
- 确认 UI 里确实不存在「16 行」文案（Worker 说行数文案是 `共 N 行 · 可滚动查看`）；并评估 `lineCountNote` 的阈值语义在「行数少但行高大」时会不提示滚动，是否会误导。

### 3.3 F4 —— 通用降级详情是否真的进窗口、是否真的没有第二层滚动容器

- 全量确认 CSS 里**没有任何 `<pre>` 自带的 `max-height`/`overflow: auto`**（除有意保留的地方，逐一列出并说明）。
- 确认 `ToolData`/`ToolResultData` 的 `ScrollBox` 包裹对成功路径无影响、对失败/未知/解析失败路径生效；`ScrollBox` 是否自包含（不依赖 `.tool-view` 祖先）。
- 做一次可证伪实验（去掉包裹 → 目标测试失败 → 还原）。

### 3.4 F5 —— flaky 是否真的收敛（**重点，Integrator 观察到了未定位的失败**）

事实交代（Integrator 实测，供你核对而**不是**结论）：

- 修复后 Integrator 在**一次重负载**环境下见过 2 次失败：① `npx vitest run src/web/toolViews src/web/components/ChatView.test.tsx` → `1 failed | 141 passed`，该次耗时 **182 秒**（正常为 9–20 秒）；② 紧接着 `npm test` 5 次里第 2 次 `1 failed | 302 passed`。两次都**没有保留失败用例名**。
- 随后 Integrator 复跑：`npm test` ×8 全绿、×30 全绿（各 5–6 秒），focused ×6 全绿（9–20 秒）。累计 44 次连续通过。
- 首轮审查记录过同一测试（`keeps a failed prompt in the thread ...`）在负载下的失败，并定性为**既有**测试缺陷。

请独立完成：

1. 连续跑 `npm test` **≥15 次**，报告失败次数与每次耗时；若复现，**必须保留失败用例名与断言输出**。
2. 单独针对 `promptCalls()` 的修复判断：`/\/prompt(?:[?#]|$)/u` 是否真的排除了 `/api/prompt-delivery/events`；有没有别处也用 `includes("/prompt")` 之类的宽匹配（全仓搜索）。
3. 评估「重负载下仍有其他时序敏感测试」的可能性：除了 `promptCalls`，本批 diff 内的新测试（shiki 异步、ScrollBox/ResizeObserver stub、滚动跟随）有没有依赖时序、真实计时器、`waitFor` 的地方？逐一列出并给出是否可能在高负载下失败。
4. 给出结论：F5 是否算已修复；剩余 flake 是否阻塞合入（你的依据）。

## 4. 回归面（快速核对，不必重复首轮结论）

- `ChatView.tsx` 本轮的改动是否**只在** `GenericToolDetail` / `ToolData` / `ToolResultData` 三处（折叠行、分组、`Worked for`、投递状态、todo 条应一行未改）。
- 六个已注册视图的窗口与 `bash`/`diff` 等既有断言是否照旧通过。
- 新增测试是否**可证伪**（有没有永远为真的断言）。

## 5. Finding 格式与结论

沿用首轮格式（严重程度 / 位置 / 触发条件 / 影响 / 证据 / 建议方向），可证伪、标注推断。最后给出：**可合入 / 需修复后合入 / 不可合入**，以及运行过的全部命令与结果（`PASS` / `FAIL` / `NOT RUN`）。

## 6. 交接

把结果写入本文件并提交 1 个 commit，留在 Pane 等开发者通知 Integrator，不自行合入。

---

# 独立复审结果：Rev.2 修复的定向复审（第二轮）

- 日期：2026-09-18
- 复审对象：分支 `review-20260918-tool-views-rev2-r2` 的 `bf6c04c`（首轮交付 `91519de` + 修复 `cd316ff` + 记录 `bf6c04c`）
- 复审范围：只审 F1 / F2 / F4 / F5 四条修复是否成立、是否正确、是否引入回归（F2 的「不改布局」、F6、F7 是开发者已裁决项，未重开）
- 方式：只读源码 + 自建构建 + 按 CSS 规范实现的级联解析 + jsdom 旁证 + 契约要求的两次可证伪实验 + 交付/base 双分支的负载对照实验
- 未做：真实浏览器与真实 Pane 验收（未授权）、`npm run dev`（禁止）、读取真实 Pi session / JSONL

## 0. 结论

**需修复后合入。**

| 修复 | 判定 |
| --- | --- |
| F1 错误红不再泄漏到成功项 | **部分成立 + 引入回归（阻塞，见 N1）**：泄漏确实消失了，但红色也彻底不生效 |
| F2 表述改为「窗口高 16 行」 | **基本成立**（常量改名彻底、UI 无「16 行」文案、per-view 行数表与 CSS 算术一致）；残留 3 处注释与 docs（见 N2） |
| F4 通用降级详情纳入窗口 | **成立**（见 §2.3） |
| F5 flaky 断言收窄 | **成立**，且有 base 对照的强证据（见 §2.4） |

唯一的阻塞项是 **N1**：`.tool-result-error pre` 与 `.tool-detail pre` 特异性相同却排在前面，被后者覆盖 —— 修复前红色是生效的（特异性 0,2,1 稳胜），修复后完全不生效。F1 的裁决目标是「红色限定到失败项自身」，实际交付的是「没有红色」。

剩余 flake（`ChatAttachments` 5s 超时）**不阻塞合入**：它在 base 与交付分支上以同样概率出现，与产品代码无关。

## 1. Findings

### N1 — F1 修复后错误红色被 `.tool-detail pre` 覆盖，实际不再生效（回归）

```
[严重程度: blocking]
位置：src/web/styles.css:940（`.tool-result-error pre { color: #c2635d }`）
     vs src/web/styles.css:976-986（`.tool-detail pre { ... color: #5e635a; ... }`）
触发条件：任何失败工具调用的通用详情。`ChatView.tsx:1449` 的 `if (item.isError || !View) return fallback;`
         保证失败调用一定走 `GenericToolDetail`，所以这条路径就是真实失败路径。
影响：① 两条规则特异性都是 (0,1,1)，`.tool-detail pre` 在源码中**更靠后** → 后出现者胜 → 失败正文
     实际渲染为灰色 `#5e635a`。② 修复前 `.tool-error .tool-detail pre` 特异性 (0,2,1) 稳胜
     `.tool-detail pre`，红色是真生效的（代价是泄漏到同组成功项）。所以这是修复引入的**回归**：
     泄漏没了，红色也没了。③ 用户可见后果：F1 裁决要求的「红色限定到失败项自身」在真实浏览器里
     表现为「完全没有红色」，R5 的错误红色从本批第一轮的可疑状态退化为不可见。
     ④ 测试抓不到：`npm test` 21/21 全绿（含本轮新加的 F1 用例）；发行 CSS 里两条规则的顺序原样保留。
证据：
  - 规则枚举 + 按 CSS 规范实现的级联解析（importance > specificity > source order；
    /tmp/rev2r2/resolve.mjs，用 postcss 解析**真实** styles.css），目标元素路径
    `.tool-item.tool-error div.tool-detail section.tool-result.tool-result-error div.tool-view-scroll pre`：
      · 交付状态：`order#122 spec=(0,1,1) ".tool-result-error pre" -> #c2635d`，
                  `order#127 spec=(0,1,1) ".tool-detail pre" -> #5e635a` → **WINNER #5e635a**
      · 旧写法：`order#122 spec=(0,2,1) ".tool-error .tool-detail pre" -> #c2635d` → **WINNER #c2635d**
      · 仅把 `.tool-result-error pre` 移到 `.tool-detail pre` 之后：**WINNER #c2635d**
  - 构建产物核对（`rm -rf dist && npm run build`）：`dist/web/assets/index-DiLH9O1W.css` 里
    offset 19782 = `.tool-result-error pre{color:#c2635d}`，offset 20348 = `.tool-detail pre{color:#5e635a;...}`
    → **发行 CSS 里红色规则在前，会输**，缺陷会随构建出货。
  - jsdom 实跑真实 styles.css（/tmp/rev2r2/probe.mjs，真实分组 DOM）：失败 result `<pre>` = `rgb(94, 99, 90)`
    （灰）、Arguments = 灰、成功兄弟 = 灰。
    **诚实标注（推断边界）**：jsdom 不是合规的级联引擎 —— 我用同一套脚本证明它**忽略特异性**：把旧写法
    `.tool-error .tool-detail pre`（0,2,1）放回前面的位置时，jsdom 仍返回灰色。因此 jsdom 只在**等特异性**
    这一情形与本例的规范结论一致（本例恰好是等特异性），只能作旁证；决定性证据是上面的规范级联解析。
  - 全量确认：CSS 里**不存在任何以 `.tool-error` 为祖先的 `<pre>` 着色规则**（含 `.tool-error` 的选择器
    只剩 `.tool-error .tool-state`，styles.css:922；`!important` 全文件 0 处）。
建议方向：三种最小改法任选其一：
         (a) 把 `.tool-result-error pre` 移到 `.tool-detail pre` 之后（一行位置调整，零视觉副作用）；
         (b) 提高特异性为 `.tool-detail .tool-result-error pre`；
         (c) 在 `.tool-result-error` 段上设 `color` 让 `<pre>` 继承（需确认 `<pre>` 未显式覆盖）。
         同时补一条能真正锁住级联的断言（例如断言两条规则的出现顺序，或断言红规则特异性高于灰规则）——
         现在的 `styles.test.ts` 只断言「源码里有这条规则」，这也是它放行本 bug 的原因（见 N5）。
```

### N2 — F2 表述残留：3 处代码注释 + docs 仍写「可见 16 行」

```
[严重程度: low]
位置：src/web/styles.css:1010-1011（「a body taller than the window shows exactly 16 of those lines
       — not 15, not 17」）—— 正是 F2 判定为不准确的「可见 16 行」说法，且它与同文件 §11.2 的
       「窗口高 16 个代码行、各视图可见更少」自相矛盾
     src/web/styles.test.ts:72（「of the 16 visible lines」）
     src/web/toolViews/WebFetchView.tsx:9（「the shared `ScrollBox` (16 lines visible, native scroll)」）
       —— 对 Markdown 视图，Worker 自己 §11.2 的表说实际约 12–13 行
     docs/tool-call-detail-ui-plan.md:437（「**16 行**可视」）、:446（「保证「16 行」精确而不是近似」）
       —— docs 归 Integrator（F3/F8 已有安排）
触发条件：按 F2 的裁决「表述改为窗口高 16 行」核对时。
影响：仅文档/注释不一致，无行为影响。但 WebFetchView 与 styles.css 那两处与 Worker 本轮自己的
     记录直接冲突，「表述是否改干净」的答案是否定的（代码注释层面 3 处未改）。
证据：`grep -rn "16 行\|16 lines\|visible\|可视" src/ docs/` 逐处阅读；`SCROLL_BOX_LINES` 在 `src/**`
     已 0 命中（改名本身是彻底的）。
建议方向：把这三处注释统一成「窗口高 16 个代码行」；docs 由 Integrator 随 F3/F8 一并更正。
```

### N3 — F4 之后仍存在的 `<pre>` 自身滚动：只剩横向一处（有意保留）

```
[严重程度: info]
位置：src/web/styles.css:728-734（`.markdown-body pre { overflow-x: auto; ... }`）
触发条件：`web_fetch` / `web_search` 正文里的 fenced code block 遇到长行。
影响：纵向限高确实只剩 `.tool-view-scroll` 一处（F4 目标达成）；但窗口**内部**仍有一个横向滚动容器。
     这与 styles.css:746-751 的注释（R7 有意保留「dark background / horizontal scroll / padding」）一致，
     但 `ScrollBox` 注释里「lines wrap, so no horizontal scrollbar can steal a line worth of height」
     对 markdown 代码块不成立。非本批引入，不阻塞。
证据：全量枚举（postcss 遍历 styles.css）——含 `pre` 元素选择器的规则只有 5 条：`.markdown-body p,...,pre`
     (margin)、`.markdown-body pre`(728)、`.markdown-body pre code`(736)、`.tool-result-error pre`(940)、
     `.tool-detail pre`(976)、`.output-body pre.output-error`(1161)；其中只有 `.markdown-body pre` 带
     overflow，且仅为 `overflow-x`（全文件无 `max-height` 落在 `<pre>` 上）。
建议方向：不改；可选地在 `.markdown-body pre` 那节注释里补一句「markdown 代码块保留自己的横向滚动」。
```

### N4 — 剩余 flake：既有 `ChatAttachments` 的 5 秒超时（不阻塞）

```
[严重程度: low]
位置：src/web/components/ChatAttachments.test.tsx:29
     （`adds a pasted image to the assistant-ui composer`）
触发条件：极端并发负载。我实测的负载是 5 个全量 `npm test` 并行，单次 39–45 秒（常规 5–6 秒的 7–8 倍）。
影响：`Test timed out in 5000ms`（该文件当次 7636ms）。本批 diff **不含**这个文件，自 base `b5b49a7` 起未改。
证据：交付分支 10 次并行全量中复现 1 次；base 同一负载下同样复现 1 次（base round 2 run 4，
     该次同时还有 F5 用例失败）。→ **base 与交付都会出现，不是本批引入**。
建议方向：不阻塞本批。若要治理属测试基础设施问题（给该用例更宽的 timeout / 限制并发 / 减少
     跨文件串行开销），建议单开一轮。
```

### N5 — 新测试只能锁规则名，锁不住级联（本轮 F1 上再次发生）

```
[严重程度: info]
位置：src/web/styles.test.ts:139-147
触发条件：任何「规则存在但在级联中不生效」的改动。
影响：这正是 N1 逃过全套测试的原因。`expect(cssRule(".tool-result-error pre")).toContain("color: #c2635d")`
     与 `expect(hasRule(".tool-error .tool-detail pre")).toBe(false)` 都只断言选择器文本的存在/不存在，
     不断言谁在级联中胜出。
证据：两个方向都验证过 ——（a）实验 A 把规则名改回旧写法，该用例确实 FAIL（说明可证伪）；（b）在
     **交付状态**（红色被覆盖、功能失效）下，`styles.test.ts` 12/12 全绿、全量 303 tests 全绿。
建议方向：加一条把「红规则必须排在 `.tool-detail pre` 之后（或特异性更高）」写进测试的断言。
```

### N6 — `lineCountNote` 的「可滚动查看」阈值保守，会漏提示

```
[严重程度: info]
位置：src/web/toolViews/common.tsx:114-117
触发条件：`ffgrep` 多文件这类「行数 ≤ 16 但行高大」的内容。
影响：会滚动却不显示「可滚动查看」。方向是保守的（不会对放得下的内容误报），Worker 已在注释与
     §11.2 写明，属于已知取舍。
证据：`.match-file-path` 不设 line-height，继承 `.chat-message`(styles.css:552-553)/
     `.activity-message`(styles.css:1412-1418) 的 1.68 → 10.5×1.68 = 17.64px；`.match-body { gap: 7px }`。
建议方向：无（记录在案即可）。
```

## 2. 四条修复的独立判定

### 2.1 F1 — 无泄漏成立，但红色失效（见 N1）

- **CSS 全量确认**：不存在任何以 `.tool-error` 为祖先的 `<pre>` 着色规则。含 `.tool-error` 的选择器只剩
  `.tool-error .tool-state`（styles.css:922，分组/单行的状态图标，本轮未改）。
  `grep -rn "tool-error" src/` 的其余命中全部是注释文字或测试断言。
- **`ChatView.tsx:1560`**：``className={`tool-result${isError ? " tool-result-error" : ""}`}`` —— 只有
  `isError` 的 Result section 拿到该类；`ToolData` 的 Arguments section 是 `tool-data`，永不携带错误类。
- **分组级红图标行为保持不变**：`.tool-error .tool-state` 原文保留（`git diff 91519de..bf6c04c -- src/web/styles.css`
  只改了错误红规则与 320px 两处）。
- **分组内成功子行确实拿不到红色**：**成立**（成功兄弟的 `<section>` 没有 `tool-result-error`，且不再有
  任何祖先键控规则）。代价是失败项自己也拿不到红色 —— 这正是 N1。
- **Worker 说法核对**「Arguments 段回到灰色，只有错误正文是红的」：
  前半**属实**（Arguments 为灰）；后半**不属实**（错误正文也是灰）。
- **可证伪实验（契约要求）**：把 `.tool-result-error pre` 改回 `.tool-error .tool-detail pre` →
  `npx vitest run src/web/styles.test.ts` → **FAIL**
  （`Error: stylesheet has no rule for .tool-result-error pre`，src/web/styles.test.ts:140）；
  还原后 md5 = `1618006e7d99f07ebd0b92d30bb21ce2`（与初始值一致），`git status` clean。
- **附加实验（证明正确的写法本身可行）**：仅把 `.tool-result-error pre` 移到 `.tool-detail pre` 之后 →
  级联解析 WINNER 变为 `#c2635d`，同时 Arguments 与成功兄弟仍为 `#5e635a`。即「绑到失败项自身」的设计是
  对的，错的只是**规则顺序**。

### 2.2 F2 — 表述基本改干净；per-view 行数表算术一致

- **常量改名彻底**：`SCROLL_BOX_LINES` 在 `src/**` 中 0 命中（只存在于 Worker 记录里描述这次改名的文字）。
  `SCROLL_WINDOW_LINES` 在 `ScrollBox.tsx:35/60`、`common.tsx:115`、`styles.test.ts:15/69`、
  `scrollBox.test.tsx:12/46` 一致使用。
- **`data-*` 属性**：`data-scroll-lines={SCROLL_WINDOW_LINES}` → `"16"`，是数值不是文案。
- **UI 文案**：**确认不存在**「16 行」文案；行数提示是 `lineCountNote` 的 `共 N 行` / `共 N 行 · 可滚动查看`
  （`grep -rn "16 行" src/` 只命中 CSS/TS 注释，无 JSX 文本）。
- **残留**：见 N2（3 处代码注释 + docs）。
- **per-view 行数表抽查**（CSS 算术，非渲染实测；临界高度 = 16 × 16.275px = 260.4px）：

  | 视图 | Worker 表 | 我的算术 | 一致 |
  | --- | --- | --- | --- |
  | `read` / `write` | 16 | `.code-body` 无 gap + `.code-line { min-height: var }` → 260.4/16.275 = **16.0** | ✓ |
  | `bash` | 16 | 输出 `<pre>` 命中 `.tool-detail pre { font-size: 10.5px; line-height: 1.55 }` → 16.275px/行 → **16.0** | ✓ |
  | `fffind` | 约 15 | `.path-list { line-height: var; gap: 1px }` → n×16.275+(n−1) ≤ 260.4 → n ≤ 15.13 → **15** | ✓ |
  | `ffgrep`（4 文件） | 约 9–10 | 4×17.64 + 3×7 + 4×1 = 95.56 → (260.4−95.56)/16.275 = **10.1** | ✓ |
  | `edit`（3 个 skip 行） | 约 14–15 | 每 skip 行多 2×1px 边框 + 2×2px margin = 6px → (260.4−18)/16.275 = **14.9** | ✓ |
  | Markdown 类 | ≤16，约 12–13 | `.tool-view .markdown-body { font-size: 12px }` + 继承 1.68 → 20.16px/行，再叠加段落/标题间距 | ✓（推断） |
  | 通用 Arguments/Result | 各约 16 | `.tool-detail pre` 的 1.55（数值等于变量） | ✓ |

  结论：**行数表与 CSS 算术一致**（我实算了 6 行，不只 2–3 行）。但全部是算术推断，无一处真实渲染测量，
  Worker 也已如此标注。

### 2.3 F4 — 成立

- `.tool-detail pre` 的 `max-height: 320px` 与 `overflow: auto` 已删除；`.tool-view pre { max-height: none;
  overflow: visible }` 也随之删除（不再需要）。当前 `.tool-detail pre`（styles.css:976-986）只有
  margin / padding / color / background / font-family / font-size / line-height / white-space / word-break。
- 全量枚举含 `max-height` / `overflow` 的规则：与工具面板相关的**只剩 `.tool-view-scroll`**
  （`max-height: calc(16 * var(--tool-view-line-height))` + `overflow-x: hidden` + `overflow-y: auto`）。
  唯一另一处含 `<pre>` 的是 `.markdown-body pre { overflow-x: auto }`（横向，见 N3，有意保留）。
- `ScrollBox` 自包含：`--tool-view-line-height` 定义在 `.tool-view-scroll` **自身**（styles.css:1022），
  `max-height` 与它在同一条规则内 → 不需要 `.tool-view` 祖先；通用详情确实没有 `.tool-view` 祖先
  （`ChatView.tsx:1430` 的 `div.tool-detail` 直接包 `GenericToolDetail`）。
- 成功路径未受影响：六个已注册视图的 `<ScrollBox` 计数不变（CodeView 1 / DiffView 1 / OutputView 2 /
  WebFetchView 1 / WebSearchView 2 / MatchListView 2）；`npm test` 21/21 全绿。
- **可证伪实验（契约要求）**：去掉 `ToolData` / `ToolResultData` 的 `ScrollBox` 包裹 →
  `npx vitest run src/web/components/ChatView.test.tsx -t "generic Arguments/Result detail"` → **FAIL**
  （`Expected 2 / Received 0`，src/web/components/ChatView.test.tsx:1469）；
  还原后 md5 = `3609d9a645cc580be296e6551c769f38`（与初始值一致），`git status` clean。

### 2.4 F5 — 成立（有 base 对照的强证据）

1. **`npm test` 连跑次数与结果**（本 worktree，交付 `bf6c04c`）：
   - **顺序连跑 21 次**（后台 20 次 + 事后 1 次）：**21 PASS / 0 FAIL，每次 303 passed**。
     耗时（秒）：6.44, 6.20, 5.89, 6.01, 5.96, 6.79, 6.40, 5.77, 5.27, 5.55, 5.88, 6.15, 7.05, 6.58, 7.34,
     11.75, 17.73, 12.75, 12.67, 11.41, 4.61。第 16–20 次明显变慢（11–18 秒）是因为我在同一台机器上并发跑
     分析脚本 —— 这本身构成一次「真实负载」，仍全绿。
   - focused `npx vitest run src/web/toolViews src/web/components/ChatView.test.tsx` **8 次**：
     **8 PASS / 0 FAIL**，每次 4 files / 142 tests，耗时 4.3–5.3 秒。
   - **重负载对照**（我自己造的真实负载：5 个全量 `npm test` 并行，单次 39–45 秒，约为常规的 7–8 倍）：
     - **交付分支 10 次**：9 PASS / **1 FAIL** —— 失败是 `ChatAttachments.test.tsx:29` 的
       `Test timed out in 5000ms`（见 N4）；**F5 那个用例 0 次失败**。
     - **base `b5b49a7` 10 次**（`git archive` 到 /tmp/rev2r2-base + `npm ci`）：**0 PASS / 10 FAIL**，
       耗时 32.5–33.4 秒。其中 **9 次**失败用例是
       `ChatView.test.tsx > ChatView prompt delivery visibility > keeps a failed prompt in the thread with an
       explicit error and recovery actions`，断言输出：

       ```
       AssertionError: expected [ [ …(2) ], [ …(2) ] ] to have a length of 1 but got 2
        ❯ src/web/components/ChatView.test.tsx:148:27
           146|     // No automatic retry: the user stays in control.
           147|     await new Promise((resolve) => window.setTimeout(resolve, 30));
           148|     expect(promptCalls()).toHaveLength(1);
       ```

       （第 10 次即 round 2 run 4 同时出现该用例与 `ChatAttachments` 超时，共 2 failed / 262 passed。）

   → **同一负载下 base 9/10 复现 F5、交付 0/10**，这是 F5 根因确已消除的直接证据。失败用例名与断言已按
   契约要求完整保留（原始日志 `/tmp/rev2r2/load-r1-2.log`、`/tmp/rev2r2/base-r1-1.log` …）。

2. **`promptCalls()` 的正则核对**：
   - 真实 prompt 端点 = `` `/api/panes/${encodeURIComponent(pane.id)}/prompt` ``（ChatView.tsx:694）→
     `/\/prompt(?:[?#]|$)/u` **匹配**（不会退化成永不成立的空断言）。
   - trace 端点 `/api/prompt-delivery/events`（promptDeliveryTrace.ts:11）→ `/prompt` 后面是 `-` → **不匹配**。
   - 实测 6 个 URL：`/api/panes/w1E:p1/prompt` → MATCH；`/api/prompt-delivery/events` → no；
     `/api/panes/x/prompt?x=1` → MATCH；`/api/panes/x/prompt#f` → MATCH；`/api/prompts/list` → no；
     `/api/mcp/promptfoo` → no。
   - **全仓搜索**：`includes("/prompt")` 一类的宽匹配 **0 命中**；`mock.calls.filter` 全仓只有
     `ChatView.test.tsx:103` 一处（就是修好的这个）。

3. **本批 diff 内新测试的时序敏感性（逐一）**：

   | 测试 | 时序机制 | 高负载下可能失败？ |
   | --- | --- | --- |
   | `ChatView.test.tsx` 新增 F4 用例（:1447） | `findByText` + `waitFor`（RTL 默认 1 秒轮询） | 无真实计时器依赖；仅极端负载下可能 1 秒超时（未观察到） |
   | `ChatView.test.tsx` 新增 F1 用例（:1483） | `findByText` + `waitFor` | 同上 |
   | `ChatView.test.tsx:153` 的 `setTimeout(30)` | 真实计时器，30ms | 机制上安全：它断言「没有第二次 prompt」，收窄后 trace 上传不再计数 |
   | trace 上传用例（:346 / :404） | 显式 `await flushPromptDeliveryTrace()` | 否（不依赖 300ms 定时器） |
   | `scrollBox.test.tsx` 滚动跟随 | `FakeResizeObserver` 主动触发回调 | 否（stub 驱动，无真实布局） |
   | `views.test.tsx` shiki 异步用例 | `waitFor` 等 token 颜色出现 | 无真实 sleep；同样只受 1 秒默认超时约束 |
   | `styles.test.ts` | 纯文本正则断言 | 否 |

   → 除 `setTimeout(30)` 外，本批新测试没有依赖真实计时器 / 真实布局的地方；`waitFor` 的 1 秒默认超时是
   整个测试套件的通用特性（全部 65 处 `waitFor` 都如此），不是本批引入。

4. **结论**：**F5 算已修复**（根因消除有 base 对照）。剩余 flake 是既有 `ChatAttachments` 5 秒超时，
   在 base 与交付上同样出现、只在极端并发下出现、与产品代码无关 → **不阻塞合入**。

## 3. 回归面

- **`ChatView.tsx` 本轮改动确实只在 4 处**：`import { ScrollBox }`（:63）、`GenericToolDetail`（新增注释 +
  传 `isError`）、`ToolData`（section 加 `tool-data` 类 + `ScrollBox` 包裹）、`ToolResultData`（新增 `isError`
  prop + section 加 `tool-result[-error]` 类 + `ScrollBox` 包裹）。折叠行、分组规则、`Worked for`、投递状态、
  todo 条**一行未改**（`git diff 91519de..bf6c04c -- src/web/components/ChatView.tsx` 全文逐行核对）。
- **六个已注册视图 + `bash`/`diff` 既有断言**：`npm test` 21/21 全绿（303 tests）。
- **新增测试可证伪性**：F1 / F4 各有一条已用实验证伪（§2.1 / §2.3）；`styles.test.ts` 新增 4 条断言全部
  可证伪（改一处即失败）；未发现 `expect(true)` / `it.skip` / 只做快照的永真断言。
- **构建/类型**：`npm run typecheck` PASS；`rm -rf dist && npm run build` PASS；体积与 Worker §11.3 一致
  （`index-*.js` 544.87 kB、`ChatView-*.js` 776.15 kB、`index-*.css` 66232 B）。
- **范围**：`git diff --name-only 91519de..bf6c04c` 正好 8 个文件，全在 Worker 声明的 write set 内
  （无 `src/server/**`、`src/shared/**`、`integrations/**`、`docs/**`）。

## 4. 我的运行记录（全部命令与结果）

PASS / FAIL / NOT RUN 均指**本次实际执行**的结果。

| # | 命令 | 结果 |
| --- | --- | --- |
| 1 | `git log --oneline -5` / `git status --short` | PASS（HEAD = `d082b70`；工作树 clean） |
| 2 | `git show review-20260918-tool-views-rev2:.agents/tasks/20260918-tool-views-rev2-review.md` | PASS（读到首轮 8 条 findings） |
| 3 | `git diff 91519de..bf6c04c`（全文） | PASS（4 条修复的完整改动） |
| 4 | `.agents/tasks/20260918-tool-views-rev2.md` §11 | PASS（Worker 逐条处置记录） |
| 5 | `npm ci` | PASS（493 packages；未改依赖版本） |
| 6 | `npm test` × 21（顺序） | **PASS 21/21**（303 passed；5.27–17.73 s） |
| 7 | `npx vitest run src/web/toolViews src/web/components/ChatView.test.tsx` × 8 | **PASS 8/8**（142 passed；4.28–5.28 s） |
| 8 | 5 × 并行 `npm test` × 2 轮（交付） | **9 PASS / 1 FAIL**（`ChatAttachments.test.tsx:29` `Test timed out in 5000ms`；39–45 s/次） |
| 9 | `git archive b5b49a7 \| tar -x -C /tmp/rev2r2-base && npm ci` | PASS（base 副本就绪） |
| 10 | 5 × 并行 `npm test` × 2 轮（base） | **0 PASS / 10 FAIL**（9 次为 F5 的 `promptCalls` 断言，1 次额外含 `ChatAttachments` 超时；32.5–33.4 s/次） |
| 11 | `/tmp/rev2r2/resolve.mjs`（postcss + 规范级联解析，三种 CSS 变体） | PASS（交付 → `#5e635a`；旧写法 → `#c2635d`；重排后 → `#c2635d`） |
| 12 | `/tmp/rev2r2/probe.mjs`（jsdom + 真实 styles.css + 真实分组 DOM） | PASS（失败正文 = `rgb(94, 99, 90)` 灰）；`/tmp/rev2r2/cascade.mjs` 证明 jsdom 忽略特异性 → 仅作旁证 |
| 13 | **实验 A**：`.tool-result-error pre` → `.tool-error .tool-detail pre`；`npx vitest run src/web/styles.test.ts` | **FAIL（预期）**：`stylesheet has no rule for .tool-result-error pre`；已还原，md5 `1618006e…` 一致 |
| 14 | **实验 B**：把 `.tool-result-error pre` 移到 `.tool-detail pre` 之后（/tmp 副本 + 一次原地验证） | PASS（WINNER 变 `#c2635d`，Arguments/成功兄弟仍灰）；已还原，md5 一致 |
| 15 | **实验 C**：去掉通用详情两处 `ScrollBox` 包裹；`npx vitest run src/web/components/ChatView.test.tsx -t "generic Arguments/Result detail"` | **FAIL（预期）**：`Expected 2 / Received 0`（ChatView.test.tsx:1469）；已还原，md5 `3609d9a6…` 一致 |
| 16 | `npm run typecheck` | PASS（exit 0，无输出） |
| 17 | `rm -rf dist && npm run build` | PASS（exit 0；体积与记录一致） |
| 18 | 构建产物规则顺序核对（`dist/web/assets/index-*.css`） | PASS（红色规则 offset 19782 在前、灰色规则 20348 在后 → 缺陷随构建出货） |
| 19 | 全量 CSS 枚举：含 `pre` 的规则、含 `max-height`/`overflow` 的规则、含 `.tool-error`/`.tool-result` 的选择器、`!important` 计数 | PASS（N1/N3 的证据） |
| 20 | 全仓搜索 `SCROLL_BOX_LINES` / `SCROLL_WINDOW_LINES` / `16 行` / `includes("/prompt")` / `mock.calls.filter` | PASS（改名彻底；无「16 行」UI 文案；无宽匹配残留） |
| 21 | ChatView.tsx / GenericToolDetail / ToolData / ToolResultData DOM 结构核对 | PASS（error 类只落在 `isError` 的 Result section） |
| 22 | 实验后 md5 与 `git status --short` 收尾核对 | PASS（8 个被检查文件 md5 与初始值一致；工作树 clean） |
| — | 真实浏览器 / 真实 Pane 验收 | **NOT RUN**（未授权） |
| — | `npm run dev` | **NOT RUN**（禁止） |
| — | 记录里「未运行 npm run dev / 未做破坏性 Git」 | **NOT VERIFIABLE**（未见异常迹象） |

初始 md5（实验前，用于还原校验）：`styles.css` `1618006e7d99f07ebd0b92d30bb21ce2`、
`ChatView.tsx` `3609d9a645cc580be296e6551c769f38`、`ChatView.test.tsx` `4bff8dd52f739a45d71fc3f291af2fe2`、
`styles.test.ts` `790553c9ca92a9aaf407910c40eadc8d`、`ScrollBox.tsx` `2586ebc27dd0a1197364f9d4de1673d8`、
`common.tsx` `dbd089c6601a030d0a2e23c23b7d0398`、`scrollBox.test.tsx` `7a1ca198bbf4df74739ffa88f1dca3ca`。

## 5. 未验证与限制（诚实边界）

- 未做真实浏览器 / 真实 Pane 验收（未授权）：**没有任何真实渲染测量**，没有子像素取整、滚动条观感、
  真实级联结果的现场验证。
- **jsdom 不是合规的级联引擎**（我用同一套脚本证明它忽略特异性），所以 N1 的决定性证据是「按 CSS 规范
  实现的级联解析 + 发行 CSS 里的规则顺序」，jsdom 只在等特异性这一情形作为旁证 —— 与首轮一样，这是
  静态推断而非浏览器实测。
- per-view 行数表全部是 CSS 算术，不是渲染测量（Worker 的记录也如此标注）。
- 三处「开发者拍板」（`max-height` 而非 `height`、`bash` 打开即在底部、错误红落点）仍只核到记录里有
  明确说法，未独立证实。
- 重负载复现用的是**我自造**的负载（5 路并行全量测试，7–8 倍减速），不等同于 Integrator 那两次
  （182 秒的 focused 与 1/5 的全量）；但 base/交付的双分支对照使结论仍然成立。
- 未读取真实 Pi session / JSONL，未把任何真实文件内容写入本文件。
- /tmp 下的实验产物：`/tmp/rev2r2/`（`resolve.mjs`、`probe.mjs`、`cascade.mjs`、`loop.sh`、
  `focus-load.sh`、`*.log`、`delivered.css` / `old.css` / `reordered.css`）与 base 副本 `/tmp/rev2r2-base`。
- 我在本 worktree 的 `src/**` 上做过 3 次**临时**改写（实验 A / B / C），均已还原并逐个校验 md5、
  `git status` clean；`docs/**`、`package.json`、配置与测试规则未做任何持久改动。

## 6. 交给开发者的决策点

1. **N1（唯一阻塞项）**：F1 的红色落点已按要求改到失败项自身，但规则顺序使它被 `.tool-detail pre` 覆盖。
   选哪一种最小修法？
   (a) 把 `.tool-result-error pre` 移到 `.tool-detail pre` 之后（零视觉副作用，最推荐）；
   (b) 提高特异性为 `.tool-detail .tool-result-error pre`；
   (c) 在 `.tool-result-error` 段上设 color 让 `<pre>` 继承。
   无论选哪种，建议同时补一条能锁住级联的测试断言（否则同一类问题还会再漏）。
2. **N2**：三处代码注释要不要一并改成「窗口高 16 个代码行」？docs 的更正是否随 F3/F8 交给 Integrator？
3. **N4**：既有 `ChatAttachments` 5 秒超时要不要单开一轮治理（提高 timeout / 限制并发）？我判断不阻塞本批。

