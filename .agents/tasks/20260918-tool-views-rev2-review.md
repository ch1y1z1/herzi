# Review 任务：工具调用展示 Rev.2（独立审查）

- 日期：2026-09-18
- 审查对象：`review-20260918-tool-views-rev2` 分支（= Worker 交付 `91519de`，base `b5b49a7`）
- 本 worktree：`/Users/chiyizi/.herdr/worktrees/herzi/review-20260918-tool-views-rev2`，Herdr workspace `w1D` / pane `w1D:p1`
- 你的**唯一写入范围**：本文件（`.agents/tasks/20260918-tool-views-rev2-review.md`）

## 1. 必要阅读

1. `.agents/tasks/20260918-tool-views-rev2.md` —— Worker 契约 + Worker 的「过程与决策」「验证与交接」（**逐条核对是否与代码一致**；Worker 自述的限制与两处「自行解释」要认真评估）
2. `docs/tool-call-detail-ui-plan.md` §11（Rev.2 决策 R1–R8）与 §5.4（原视图规格）
3. 交付 diff：`git diff b5b49a7..91519de --stat`，两个 commit（`0d973db`、`91519de`）

## 2. 规则

- **只读产品代码**：不得修改 `src/**`、`docs/**`、`package.json`、任何测试或配置；不得提交除本文件之外的改动。
- **不修 bug**：只报告；由 Integrator 决定退回 Worker 修复。
- **不 merge / rebase / push**，不改 `main`。
- **不运行 `npm run dev`**。可以运行测试与构建。
- **不读取真实 Pi session / JSONL**，不把真实文件内容写入本文件。
- 真实浏览器验收**不要求也不授权**；但**允许**你用 `node` 做真实的渲染/构建产物分析（见 §3.1、§3.9）。

## 3. 重点审查项

### 3.1 shiki 是否真的按需（本批唯一新增依赖）

- `git diff b5b49a7..91519de -- package.json package-lock.json`：确认**只**新增 `shiki`，没有顺带升级/新增其它包。
- 自己跑一次 `rm -rf dist && npm run build`，核对 Worker 自报的体积数字（`index-*.js` 不变、`ChatView-*.js` 771.73→776.00 kB、shiki 内核 93.56 kB / 引擎 57.63 kB / 语言与主题在按需 chunk）。
- **关键**：首屏（`index-*.js`）是否真的不含 shiki？用 `grep -l "shiki\|oniguruma\|createHighlighter" dist/web/assets/index-*.js` 之类的方式核实，而不是只看 chunk 列表。
- 是否存在「未使用但被打进主 chunk」的语言/主题（13 个语言 chunk 是否都在按需边界上）。

### 3.2 HTML 注入安全（最高优先级）

- `src/web/highlightReact.tsx` 是否用 `dangerouslySetInnerHTML`？注入的字符串是否**只能**来自 shiki 的输出？是否存在把模型/工具原文拼接进去再注入的路径？
- 用真实代码样本（含 `<script>`、`&lt;`、引号、`</span>` 之类的畸形内容）验证：代码内容是否被正确转义、有无 XSS 或结构破坏。**给出可复现证据**（`node` 脚本即可，写在 `/tmp`，不要写仓库）。
- 主题前景色相等时丢弃 token 颜色（Worker 自述的 R8 做法）是否会掩盖某些 token（例如注释/字符串）而降低可读性？给出判断依据。

### 3.3 「16 行」是否真的精确

- `src/web/styles.css` 与 `toolViews/ScrollBox.tsx`：容器高度与行高是否**只有一个来源**（同一个 CSS 变量）？有没有第二处硬编码行高（例如 `.diff-line`、`.code-line`、`.output-view pre` 各自的行高）导致实际行数不等于 16？
- Worker 用 `max-height` 而不是固定 `height`：短内容时容器不撑满 16 行（可接受），长内容时是否**正好** 16 行滚动？给出推算与证据（可读取 CSS 计算）。
- `styles.test.ts` 断言「16 行」的方式是否可靠（**读取源码正则** vs **真实渲染测量**）？如果是前者，明确说明它不能证明渲染高度。
- Worker 自述「Markdown 类视图容器按 16 × 代码行高，内部 Markdown 行距不变 → 可见行数略少于 16」：这与 R1/R6 的语义是否冲突？给出你的判断（finding 或 info）。

### 3.4 删除是否彻底

- 全仓搜索残留：`展开全部`、`收起`、`expanded`、`CODE_FOLD_LINES`、`DIFF_FOLD_LINES`、`BODY_FOLD_LINES`、`OUTPUT_TAIL_LINES`、`tailLines`，确认无死代码、无残留状态。
- 六个视图是否都改用了 `ScrollBox`（逐一列出），有没有漏掉的视图仍用旧折叠。

### 3.5 `bash` 自动滚底

- 实现方式是什么（`scrollTop = scrollHeight`？`ResizeObserver`？）？是否**尊重用户上滚**（用户手动上滚后不再被拉回）？给出代码位置与逻辑。
- jsdom 无 `ResizeObserver`，Worker 用 stub 测逻辑；**真实 `<details>` 展开触发观察器**这一环未测——评估该风险的实际影响。

### 3.6 错误红色的范围

- Worker 自述：`.tool-error .tool-detail pre` 会把**该详情的 Arguments 段也染红**。评估这是否可接受（读起来像"整个工具调用失败"还是"输出是错误"），给出建议方向。

### 3.7 通用降级路径未纳入 16 行（Worker 自述的自行解释 ②）

- 契约 R1/R3 要求「内容区 16 行 + 去掉展开按钮」，但解析失败时的通用 `Arguments`/`Result` 详情仍是 `.tool-detail pre { max-height: 320px }`。
- 评估这是不是一个**一致的缺口**（同一工具在不同结果下形态不同），给出严重程度与建议。

### 3.8 Chat 正文改造的回归面

- 改动落在 `markdownPlugins.ts` 的 `components.SyntaxHighlighter`（`ChatView.tsx` 未改）。请核实：
  - 该 prop 名是否是 assistant-ui/react-markdown 真实支持的钩子（**若不支持，正文高亮其实没生效**）——给出证据（类型定义、测试断言，或实际渲染结果）。
  - `markdownShared` 被哪些地方共用（Chat 正文、activity 内嵌文本、divider 摘要、`web_fetch` 正文、`web_search` 条目……），逐一列出并说明各自受到的影响。
  - 行内 code、LaTeX、表格、链接策略、图片预览、`Worked for` 分组、投递状态、todo 条是否**确实未变**（用测试或代码证据）。
- 性能：每个 fenced code block 都会触发 shiki 加载/缓存，评估在多 markdown 同时渲染时是否可能出现重复加载或卡顿；LRU 64 与 in-flight 去重是否足够。

### 3.9 测试质量

- `highlight.test.ts`、`scrollBox.test.tsx`、`styles.test.ts`、`views.test.tsx`、`ChatView.test.tsx`：断言是否真的覆盖契约 §7 要求的项（语言推断、逐行结构、降级、16 行同一变量、按钮移除、diff 类名映射、`$` 前缀、错误红）。
- 是否存在「断言了实现细节而不是行为」或「断言过宽」的用例；有没有测试其实永远不会失败（例如 `expect(true)`、只断言快照）。
- 尝试复现不稳定：把目标测试连续跑 10 次以上（`for i in $(seq 10); do npx vitest run src/web/toolViews src/web/components/ChatView.test.tsx; done`），报告失败次数与断言。

### 3.10 范围与记录一致性

- `git diff --name-only b5b49a7..91519de` 是否全部落在契约 §3 write set 内（应无 `src/server/**`、`src/shared/**`、`integrations/**`）。
- Worker 记录里的每一条「已验证」是否真能复现；两处「开发者拍板」（bash 自动滚底、错误红色范围）是否在记录中可追溯到；R1–R8 是否逐条落地（含 R8「不改字号配色」）。

## 4. Finding 格式

```
[严重程度: blocking | high | medium | low | info]
位置：<path:line>
触发条件：
影响：
证据：（命令 + 实际输出摘要，或引用代码行）
建议方向：
```

要求：每条可证伪；推断标注「推断」；区分「产品代码问题」与「记录不准确」；不要为凑数报风格问题。最后给出结论：**可合入 / 需修复后合入 / 不可合入**，以及运行过的全部命令与结果（`PASS` / `FAIL` / `NOT RUN`）。

## 5. 交接

完成后把 findings 写入本文件并提交 1 个 commit，留在 Pane 等开发者通知 Integrator，不自行合入。需要产品决策的问题直接在 Pane 里向开发者提问。

---

# 独立审查结果：工具调用展示 Rev.2（滚动窗口 + shiki + Chat 正文代码块）

- 日期：2026-09-18
- 审查对象：分支 `review-20260918-tool-views-rev2`，Worker 交付 `91519de`（+ `0d973db`），base `b5b49a7`
- 审查方式：只读源码 + 自建构建 + 基线对照构建 + 真实 shiki 内核/真实组件的 `/tmp` 脚本 + 目标测试重复运行
- 审查契约：`.agents/tasks/20260918-tool-views-rev2-review.md`
- 未做：真实浏览器验收、真实 Pane 验收、`npm run dev`（未授权/禁止）

## 0. 结论

**需修复后合入。**

产品代码的核心机制是成立的：注入面实际不存在（无 `dangerouslySetInnerHTML`，见 §3.2）、shiki 真的按需（首屏 chunk 零 shiki 引用，§3.1）、删除彻底（§3.4）、`SyntaxHighlighter` 是真实支持的钩子（§3.8）。但有 2 条 medium 必须处置：

- **F1（产品代码 bug，必修）**：新加的 `.tool-error .tool-detail pre` 会把**同一 activity 分组内成功调用**的详情文字也染红。
- **F2（产品代码 + 记录不准确，需修复或由用户书面接受）**：`16 行`只在 `read`/`bash` 一类行高均匀的视图里精确成立；`.tool-detail pre { line-height: 1.55 }` 是第二处独立行高来源，grep/diff/Markdown 视图实际可见 9–15 行。记录 §9.3 的「保证 16 行精确而不是近似」与 §10.3 只披露 Markdown 一种情况，都不足以描述实际形态。

其余为 low/info（通用降级仍 320px、全量测试 1/5 不稳定、下载量记录不准、大块 tokenize 无上限）。

## 1. Findings

### F1 — 错误红色泄漏到同一 activity 分组内的成功调用

```
[严重程度: medium]
位置：src/web/styles.css:934（`.tool-error .tool-detail pre { color: #c2635d }`）
     + src/web/components/ChatView.tsx:1338（分组级 `tool-error`）
     + src/web/components/ChatView.tsx:1432（每个子行各有一个 `.tool-detail`）
触发条件：连续 2 个以上工具调用被折叠成一个 activity 分组（ChatView.tsx:2079-2097 的
         「连续 tool-call 合成一个 data-activity(kind: tools)」），其中**任意一个**失败；
         用户展开该分组，再展开**组内某个成功调用**的详情。
影响：成功调用的详情文字变红。对 `bash`（成功）整段输出变红；对 `web_fetch`/`web_search`
     正文，`.markdown-body pre` 的 `#e7e8e2`（styles.css，特异性 0,1,1）也输给新规则，
     连未着色的代码块默认文字一起变红。用户看到的是「该行是成功图标（Check）+ 文字是错误红」
     的矛盾信号，容易被读成「这次调用失败了」。这不是 Worker 记录里写明的那个代价
     （记录只承认「失败调用自己的 Arguments 段也一起变红」）。
证据：
  - 代码路径：ChatView.tsx:1338 的 className 里 `hasError = items.some((item) => item.isError)`，
    整个分组（含所有子行）都在这个 `.tool-error` 子树里；子行自己的 `.tool-detail` 在 1432。
  - CSS 级联（静态推断，非渲染实测）：`.tool-error .tool-detail pre` = (0,2,1)，
    `.tool-detail pre` = (0,1,1)、`.markdown-body pre` = (0,1,1)，两条规则都是无 layer 的顶层规则，
    特异性高的必胜，与源码顺序无关。构建产物核对：`grep -o '\.tool-error .tool-detail pre{[^}]*}' dist/web/assets/index-*.css`
    → `.tool-error .tool-detail pre{color:#c2635d}`（规则确实进了发行 CSS）。
  - 我尝试用 jsdom 读计算样式复现（/tmp/rev2-escape/cascade-check.mjs，内联整份 styles.css）：
    jsdom 对三个节点都返回基色 `rgb(94, 99, 90)`（含本应红的那个），说明 jsdom 不执行该级联，
    **该脚本不作为证据**；写成静态推断。真实浏览器未授权，未实测。
  - 既有先例（说明该模式在本批之前就存在，但影响面小）：base 已有 `.tool-error .tool-state { color:#c2635d }`
    （base styles.css:912），所以分组内有失败时，子行的成功勾也已经是红色图标。本批把同一个
    过宽的类从 12px 图标扩大到整段正文。
建议方向：把红色限定在「失败项自己」而不是祖先分组。最小改动是给 `GenericToolDetail` 的 Result
         section（或 `ToolResultData` 的根 `<section>`）加一个类（如 `.tool-result`），规则改成
         `.tool-error .tool-result pre`；或者让分组不再携带 `tool-error`，改在分组 summary 上加
         `.tool-group-error` 供状态图标用。需要产品决策的是「分组是否应该在视觉上代表其中一次失败」。
```

### F2 — 「16 行」只在部分视图精确；`.tool-detail pre` 是第二处独立行高来源

```
[严重程度: medium]
位置：src/web/styles.css:1017-1020（`.tool-view-scroll`：`--tool-view-line-height: calc(10.5px*1.55)`、
     `max-height: calc(16 * var(--tool-view-line-height))`）
     src/web/styles.css:970-980（`.tool-detail pre { line-height: 1.55 }`，**独立于变量**）
     src/web/styles.css:1126（`.diff-line-skip` 有 2px 上下 margin + 上下各 1px 虚线边框）
     src/web/styles.css:1161/1166（`.match-body{gap:7px}`、`.match-file{gap:1px}`）
     src/web/styles.css:1172（`.match-file-path` 不设 line-height，继承无单位行高）
     src/web/styles.css:1201（`.path-list{gap:1px}`）
触发条件：内容行高不均匀的视图 —— 多文件 `ffgrep`、含 `skip` 占位行的 `edit` diff、
         长行折行的 `bash` 输出、Markdown 类（`web_fetch`/`web_search`）。
影响：容器高度确实 = 16 × 变量（这部分实现正确），但**可见内容行数**不是 16：
     - `read`/`write`（CodeView）：行高与 `min-height` 都是变量，无 gap → 恰好 16 行（唯一的精确情形）。
     - `bash`（OutputView）：`<pre>` 走 `.tool-detail pre` 的 `line-height: 1.55`，
       数值上等于 10.5×1.55，所以现在也是 16 行 —— 但这是**巧合**，两处行高是独立字面量，
       改一处另一处不会跟随。长行 `pre-wrap` 折行时更少。
     - `edit` diff：每个 `skip` 行占 16.275 + 2(边框) + 4(margin) ≈ 22.3px。3 个 skip 行就吃掉约 18px，
       可见约 14–15 行。
     - `ffgrep`：以设计文档 §5.4.2 的真实形状（「12 处命中 · 4 个文件」）估算，4 个文件路径头
       （10.5px × 继承行高 1.68 ≈ 17.6px，共约 71px）+ 3 个文件间 gap 21px + 文件内 1px gap
       ≈ 100px 被消耗 → 可见匹配行约 9–10 行。
     - `fffind` 路径列表：只有 1px gap × 15 ≈ 15px → 约 15 行。
     - `web_fetch`/`web_search`：Markdown 自身行距与 16.275 不同（记录 §10.3 已披露）。
  另外 `calc(10.5px * 1.55)` 与 `calc(16 * ...)` 都是小数（16.275px / 260.4px），浏览器子像素取整
  可能露出第 17 行的一丝或压掉第 16 行的下缘（推断，未实测）。
证据：以上为 CSS 源码算术（契约 §3.3 允许「读取 CSS 计算」）。逐条对应：
  - `grep -n "line-height\|max-height" src/web/styles.css` →
    1018 `--tool-view-line-height: calc(10.5px * 1.55)`、1019 `max-height: calc(16 * var(...))`、
    1061/1072/1190/1207 四处引用变量、970-979 `.tool-detail pre { line-height: 1.55 }`（第二处）。
  - `.tool-view pre { max-height: none; overflow: visible }`（styles.css:998-1001，特异性 0,1,1 与
    `.tool-detail pre` 相同但源码在后）确实覆盖了旧的 320px，所以视图内没有第二层滚动容器 —— 这点是对的。
  - 记录 §9.3 写「保证「16 行」精确而不是近似」「超出时正好 16 行可滚动」，§10.3 只披露 Markdown 一种；
    「多文件 grep / 带 skip 的 diff 可见行数明显小于 16」没有被披露 → **记录不准确**。
建议方向：(a) 想真正统一：让 `.match-body`/`.match-file`/`.path-list` 的 gap 与 `.match-file-path`
        行高也走同一变量（或把 gap 归零），并让 `.diff-line-skip` 不吃 margin；
        (b) 不想动布局：把文档与 UI 文案的表述从「16 行可视」改为「窗口高 16 行」，
        并列出各视图的实际可见行数量级（记录里补一段）。无论选哪条，`.tool-detail pre` 的
        `line-height: 1.55` 应该改成 `var(--tool-view-line-height)`（`pre` 本身不是滚动容器，
        改它不会影响通用降级路径的 320px 行为）。
```

### F3 — `styles.test.ts` 证明不了渲染高度（契约点名要指出）

```
[严重程度: low]
位置：src/web/styles.test.ts（整文件，尤其 `cssRule()` 与「caps the height and sets the row height
     from one variable」用例）
触发条件：把「16 行」当作已被测试保证的事实。
影响：该文件用 `readFileSync(styles.css)` + 正则读源码断言，且文件注释自己写明「These are source
     assertions, not computed styles ... jsdom does not resolve custom properties or cascade」。
     也就是说：没有任何一行测试真的量过渲染高度；如果 `--tool-view-line-height` 被别处的
     `font-size` 改动（如某个父容器的 font-size 变化）间接影响，或行内出现额外的 gap/边框
     （正是 F2），这些断言仍会全绿。它锁住的是「源码里有这条规则」，不是「显示 16 行」。
证据：读源码即可确认；另外我实测 jsdom 的级联能力（/tmp/rev2-escape/cascade-check.mjs）：
     连 `.tool-error .tool-detail pre` 这种两段选择器都不生效，说明该环境不足以做级联/布局断言。
建议方向：把这条从「测试保证」改为「记录在案的未验证项」（记录 §10.3 其实已经这么写了，建议把
        §10.1 表格里「16 行容器与行高同一变量」的 PASS 补一句「仅源码层」）；若将来允许，
        用一次授权的 headless 布局断言（读 offsetHeight / 滚动 1 行后的 scrollTop 变化）替代。
```

### F4 — 通用降级详情仍是 320px，同一工具因结果不同而形态不同

```
[严重程度: low]
位置：src/web/styles.css:970-972（`.tool-detail pre { max-height: 320px; overflow: auto }`）
     + src/web/components/ChatView.tsx:1450（`if (item.isError || !View) return fallback;`）
     + src/web/components/ChatView.tsx:1454-1467（GenericToolDetail）
触发条件：`bash` 调用失败（设计文档实测 217/5192）、`read`/`ffgrep`/`web_fetch` 解析失败、
         所有未知/MCP 工具。
影响：这些路径既没有 16 行窗口，也没有 ScrollBox，而是回到旧的「320px 内滚动」形态：
     同一个 `bash`，成功时是 16 行窗口 + `$` 前缀 + 行号样式，失败时是 320px 的 JSON Arguments +
     Error 两段 `<pre>`。内容仍全量在 DOM（与 R2 一致），所以不是旧的两极体验，但形态不一致，
     且 DOM 里出现第二个滚动容器（`.tool-detail pre` 的 `overflow: auto`）。
     与 R1/R3 的关系：**R3 不违约**（通用路径本来就没有展开按钮）；R1 按 Worker 契约 §4.1 与
     plan §11 的措辞范围只覆盖六个内容视图，通用 Arguments/Result 不在其中，因此也不是契约违约。
     它是「一致性缺口」而不是「违约」，但用户看不出这层范围划分。
证据：`sed -n '970,1002p' src/web/styles.css`（320px 未被 `.tool-view pre` 覆盖，因为通用路径没有
     `.tool-view` 祖先）；ChatView.tsx:1450 保证失败/未知调用一定走 fallback。
建议方向：最小改法是把 `GenericToolDetail` 的两个 `<pre>` 也用 `ScrollBox` 包一层（约 3 行），
        顺带消掉第二层滚动容器；若开发者认为「失败详情保持原样便于读 JSON」更好，
        请在记录里把它从「有意保留」升级为「已确认的产品决定」，并写明是用户拍板。
```

### F5 — 全量测试不稳定（1/5 失败），失败与交付无关但记录未提

```
[严重程度: low]
位置：src/web/components/ChatView.test.tsx:128-149（`keeps a failed prompt in the thread ...`）
     + src/web/components/ChatView.test.tsx:77-81（`promptCalls()` 用 `String(url).includes("/prompt")`）
     + src/web/promptDeliveryTrace.ts:15/93（`FLUSH_DELAY_MS = 300`，每次 record 都 scheduleFlush）
触发条件：机器负载较高时，`waitFor(() => getByText("未送达"))` 把「发出 prompt」到第 148 行断言
         之间的耗时拉到 270ms 以上，于是 300ms 的 trace flush 落进 30ms 的等待窗口。
影响：`npm test` 变红。第 2 次 `apiFetch` 调用是 `/api/prompt-delivery/events`（trace 上传），
     不是真的自动重发 prompt —— 因为 `promptCalls()` 的 `includes("/prompt")` 同时匹配
     `/api/prompt` 和 `/api/prompt-delivery/events`。测试名（"No automatic retry"）因此会在
     trace flush 恰好落在窗口内时误报。属于既有测试缺陷，与 Rev.2 的产品代码无因果关系
     （该测试与 `src/web/promptDeliveryTrace.ts` 都不在本批 diff 内）。
证据：
  - `npm test`（本 worktree，第 1 次）：`Tests 1 failed | 297 passed (298)`；
    失败断言 `expect(promptCalls()).toHaveLength(1)` → `AssertionError: expected [ [ …(2) ], [ …(2) ] ] to have length 1 but got 2`（ChatView.test.tsx:148）。
  - 同一条命令随后 4 次：`298 passed` ×4。单独只跑该用例（`-t "keeps a failed prompt in the thread"`）10 次：全 PASS。
  - 基线（/tmp/rev2-base，b5b49a7 的 `git archive` 副本）：`npm test` 4 次全 264 passed；
    `ChatView.test.tsx` 单文件 8 次全 62 passed（基线 4 次全量未复现）。
  - 失败日志里失败用例的 stdout 有 `phase: client.submit/optimistic/error`（promptDeliveryTrace.ts:87 的
    console.debug），即该用例确实 schedule 了一次 300ms flush。
  - 目标测试 12 次连跑（契约 §3.9 的要求）全 PASS：见 §3.9。
建议方向：这是**测试**问题，与本批交付是否合入可以解耦，但既然 ChatView.test.tsx 在本批 write set 内，
        顺手修最小：把 `promptCalls()` 的匹配收窄为 prompt 端点（例如 `/\/prompt(\?|$)/` 或排除
        `/prompt-delivery/`），或在第 148 行前显式 `await flushPromptDeliveryTrace()` 再断言。
        另外记录 §10.1 的 `npm test PASS` 应注明「重跑后稳定，首跑曾出现 1 次既有 flake」。
```

### F6 — 首次高亮的下载量与语言 chunk 数记录不准

```
[严重程度: low]
位置：src/web/highlight.ts:317-333（`createCore`）
触发条件：任何一次需要高亮时。
影响：记录 §10.2 写「首次高亮的实际下载量约为 core + engine + 1 个语言 + 1 个主题」，
     实际是 **2 个主题**：`themes: [THEME_LOADERS.light(), THEME_LOADERS.dark()]` 在构造数组时
     就调用了两个 loader，光/暗主题各一个 chunk 都会被下载（dist 中
     `github-light-*.js` 11.18 kB + `github-dark-default-*.js` 14.43 kB）。本地服务里没有实质代价，
     但记录不准确；主题按需本来也是缓存键的一部分（契约 §4.2 写的是 `(code, lang, theme)`）。
     另外记录 §10.2 写「新增语言 chunk（13 个）」，实测是 **15 个** chunk：13 个语言里有 2 个
     （css、javascript）各自多一个 re-export 壳（`css-CdtkT07m.js` 59 B、`javascript-Yelw-5ZN.js` 66 B，
     内容只有 `import{t as e}from"./css-LbU1hoFO.js";export{e as default}` 这类一行）。
证据：`cat dist/web/assets/css-CdtkT07m.js`、`ls -la dist/web/assets/`；代码 highlight.ts:324-327。
建议方向：要么把 `THEME_LOADERS` 改成按 theme 懒加载（`getHighlighter(theme)` 里带语言/主题参数），
        要么在记录里把「1 个主题」改成「2 个主题（同属 GitHub 家族，合计约 25.6 kB）」并把 13 改成 15。
```

### F7 — 大块代码在主线程序列 tokenize，没有大小上限

```
[严重程度: low]
位置：src/web/highlight.ts:259-276（`tokenize` 一次性 `highlighter.codeToTokens(code, ...)`）
触发条件：Chat 正文或 `web_fetch` 正文里出现很长的 fenced code block（模型输出与网页正文都没有上限），
         或 `read` 一个很大的文件（结果本身由 Pi 截断，风险较小）。
影响：`codeToTokens` 同步执行且没有 threshold，长块会阻塞主线程；`createJavaScriptRegexEngine`
     比 wasm 引擎慢，本批还是刻意选它（为了不带 wasm 资源）。契约 §6「降级优先」只覆盖失败，
     没有覆盖「太大」。LRU 也只是按**条数**（64）而不是字节数设限。
证据：实测（Node 25，真实 shiki 4.4.3 + JS 引擎 + github-light，/tmp/rev2-escape/perf-check.ts，
     每次先 resetHighlightCache 再计时；首行 410ms 含内核/引擎/主题首次加载）：
       16 行 410.9ms（含冷启动） / 100 行 46.0ms / 500 行 126.5ms / 2000 行 404.3ms / 8000 行 1450.3ms
       缓存命中：0.0–0.6ms
     即约 0.18ms/行；2000 行的聊天代码块 ≈ 400ms 主线程占用。浏览器实测未授权，数值环境为 Node。
建议方向：给 `highlightLines` 加一个行数/字节上限（超过就直接返回 `undefined` 走纯文本，符合既有降级
        语义），或把大块切成分片 + `requestIdleCallback`/`await yield` 分批 tokenize。上限值可参考
        实测曲线（例如 >1000 行不高亮）。这是产品取舍，建议由开发者定。
```

### F8 — 两份决策表不一致（R7/R8 只在 Worker 契约里）

```
[严重程度: info]
位置：.agents/tasks/20260918-tool-views-rev2.md §2（R1–R8）
     vs docs/tool-call-detail-ui-plan.md §11「已确认决策（2026-09-18）」（只有 R1–R6）
触发条件：后续任何人按 plan §11 核对范围时。
影响：记录性不一致。R7（Chat 正文接入同一内核）与 R8（不改字号与配色）在这里的 Worker 契约 §2
     有、plan §11 没有。两处都是文档，改动越少越好，但「R1–R8 是否逐条落地」的核对需要知道
     R7/R8 的出处。逐条落地情况本身是好的（见 §3.10）。
证据：`sed -n '/### 已确认决策/,/### 设计/p' docs/tool-call-detail-ui-plan.md` 与 Worker 契约 §2 对照。
建议方向：在 plan §11 的表格补两行（R7/R8），或注明「R7/R8 见同批 Worker 契约 §2」。
```

## 2. 逐项核查（契约 §3）

### 3.1 shiki 是否真的按需 — PASS（无阻塞问题）

- `package.json`：唯一变化是 `+    "shiki": "^4.4.3"`；`package-lock.json`：+194 行、**0 行删除**
  （`git diff ... | grep -cE '^-[^-]'` → 0），新增的 16 个 `node_modules/*` 条目全部是 shiki 及其
  传递依赖（`@shikijs/*`、`hast-util-to-html`、`html-void-elements`、`oniguruma-parser`、
  `oniguruma-to-es`、`regex*`）。已装版本 `shiki@4.4.3`。**没有顺带升级其它包。**
- 自建构建（`rm -rf dist && npm run build`，exit 0），与记录 §10.2 对照（我另用
  `git archive b5b49a7` → /tmp/rev2-base → `npm ci` + `npm run build` 得到基线）：

  | 产物 | 我实测 base | 我实测交付 | 记录称差值 | 一致？ |
  | --- | --- | --- | --- | --- |
  | `index-*.js` | 544874 B | 544877 B | +3 B（544.87 kB 不变） | 是 |
  | `ChatView-*.js` | 771736 B | 776005 B | +4.17 kB（771.73→776.00） | 是 |
  | `index-*.css` | 65795 B | 66317 B | +0.51 kB（65.79→66.31） | 是 |
  | `core-*.js` | 无 | 93567 B | 93.56 kB / gzip 29.48 | 是 |
  | `engine-javascript-*.js` | 无 | 57636 B | 57.63 kB / gzip 20.18 | 是 |
  | 主题 chunk | 无 | 11181 / 14432 B | 11.18 / 14.43 kB | 是 |
  | 语言 chunk | 无 | 13 个语言 → 15 个 chunk | 记录写「13 个」 | 见 F6（info） |

- **首屏不含 shiki（核实过，不只是看 chunk 列表）**：
  `grep -l "shiki\|oniguruma\|createHighlighter\|codeToTokens" dist/web/assets/index-*.js` → 无匹配；
  `grep -c 'shiki\|oniguruma\|createHighlighter' dist/web/assets/index-CQ1jPMJN.js` → 0；
  `dist/web/index.html` 只引用 `assets/index-CQ1jPMJN.js` 与 `assets/index-CKmVNUL1.css`；
  基线构建的 index 同样是 0（对照）。构建产物里**没有任何 chunk 含 `oniguruma` 字样**
  （`grep -l oniguruma dist/web/assets/*.js` → none），说明 wasm 引擎没有被带进来。
- 13 个语言、2 个主题都是独立 chunk，且都由 `ChatView-*.js` 里的动态 import 引用
  （逐个 grep 命中：`typescript-*`、`tsx-*`、`javascript-*`、`jsx-*`、`json-*`、`markdown-*`、
  `python-*`、`shellscript-*`、`css-*`、`html-*`、`yaml-*`、`go-*`、`rust-*`、
  `github-light-*`、`github-dark-default-*`）。ChatView chunk 只涨 4.17 kB，也反证语言没有被打进主 chunk。
- 唯一的偏差是 F6（记录里的「1 个主题」「13 个 chunk」）：两个主题在 `createCore` 里被同时加载。

### 3.2 HTML 注入安全 — PASS（前提本身不成立：不存在 HTML 注入路径）

- **交付代码里根本没有 `dangerouslySetInnerHTML`**：`grep -rn "dangerouslySetInnerHTML" src/` → 无输出；
  `grep -rn "innerHTML\|__html" src/web/highlight*.ts*` → 无输出；全仓唯一命中是
  `src/web/components/ChatAttachments.test.tsx:115` 的 `container.innerHTML` 断言。
- 也没有使用会产出 HTML 字符串的 shiki API：`grep -rn "codeToHtml" src/` → 无。
  内核用的是 `highlighter.codeToTokens`（highlight.ts:268），拿到的是 token 对象数组，
  由 `HighlightedText`（highlightReact.tsx:63-81）以 `token.content` 作为 **React 子节点**渲染 ——
  字符串子节点由 React 转义，不存在「拼接字符串再注入」的路径。
- **畸形样本实测（真实内核 + 真实组件，不是 mock）**：/tmp/rev2-escape/escape-check.tsx
  （用项目自带 esbuild `--jsx=automatic` 打包后 node 运行）。样本含
  `"<script>alert(1)</script>"`、`"</span><img src=x onerror=alert(2)>"`、`&lt;script&gt;` 实体、
  引号、反引号、`<style>`。结果 **ALL PASS**：
  - `tokens reconstruct the input text byte-for-byte`（token 内容是原始文本，没有被 shiki 预转义）；
  - 渲染出的 HTML 里 `<` → `&lt;`、`&` → `&amp;`、`"` → `&quot;`、`'` → `&#x27;`；
    代码里的字面 `</span>` 变成 `&lt;/span&gt;`，**无法闭合 token span**；
  - `no executable <script>`、`no <img onerror>`、`no <style>`；
  - 高亮未就绪/不支持语言的分支（`line === undefined`）同样转义。
    渲染片段示例（截取一行）：`<span style="color:#032F62">&quot;&lt;script&gt;alert(1)&lt;/script&gt;&quot;</span>;`
- 额外防线（README 之外的实证）：`HighlightedText` 在 `joinedContent(line) !== codeLineText(text)`
  时退回纯文本（highlightReact.tsx:71），所以即使 tokenizer 切分与原始行不一致，也不会显示
  与真实内容不同的文字。
- 「前景色相等时丢弃 token 颜色」不会掩盖注释/字符串：实测
  （/tmp/rev2-escape/color-check.ts，真实内核）typescript 样本 46 token / 25 有色 / 6 种颜色，
  注释行颜色 `#6A737D`（light）/`#8B949E`（dark），字符串 `#032F62`（light）/`#A5D6FF`（dark），
  关键字与数字也都保留颜色；python/json/shellscript 样本同样（distinctColors 2–6）。
  被丢弃的只有等于主题前景色的 token，继承样式表的 `#5e635a` / `#e7e8e2` —— 与 R8 的意图一致，
  可读性没有下降。

### 3.3 「16 行」是否真的精确 — 部分成立，见 F2 与 F3

- 容器与行高**确实**来自同一个变量：`.tool-view-scroll` 定义 `--tool-view-line-height` 并用它算
  `max-height: calc(16 * var(...))`；`.code-body`/`.diff-body`（1061）、`.code-line`（1072）、
  `.match-line-number`/`.match-line-text`（1190）、`.path-list`（1207）都引用该变量。
- 但存在**第二处独立行高**：`.tool-detail pre { line-height: 1.55 }`（styles.css:979），
  `OutputView` 的 `<pre>` 正是走这一条（数值上恰好 = 10.5×1.55 = 16.275px，所以现在也是 16 行，
  但改变量它不会跟随）。另外 `.match-file-path` 不设行高（继承无单位 1.68）、`.diff-line-skip` 有
  margin+border、`.match-body`/`.match-file`/`.path-list` 有 gap，都会吃掉窗口高度。
- `max-height`（不是 `height`）：短内容不撑满 16 行（符合 Worker 记录里开发者拍板的选择），
  长内容时容器 = 260.4px；对 `read`（行高与 min-height 都是 16.275、无 gap）正好 16 行。
- 结论：**R1/契约的字面要求（容器高度与行高同一变量）成立**；但「可见 16 行」只在
  `read`/`write`（以及无折行的 `bash`）成立，`ffgrep` 多文件大约 9–10 行，带 skip 的 diff 约 14–15 行。
  这一点记成 F2。
- `styles.test.ts` 是**读源码正则**断言（F3）：`readFileSync` + `cssRule()` 正则，且文件注释自己承认
  jsdom 不解析自定义属性与级联。它证明的是「源码里有这条规则」，**不能证明渲染高度**。

### 3.4 删除是否彻底 — PASS

- 全仓搜索残留（`src/**` 含 .ts/.tsx/.css）：`展开全部`/`收起` 只出现在
  「测试里用来断言按钮不存在」的匹配模式（views.test.tsx:51、ChatView.test.tsx:1343）与两处注释；
  `CODE_FOLD_LINES`/`DIFF_FOLD_LINES`/`BODY_FOLD_LINES`/`OUTPUT_TAIL_LINES`/`tailLines`/`LineSlice`/
  `ExpandButton`/`tool-view-expand` **全部为 0 命中**（`tool-view-expand` 只剩 styles.test.ts:73 的
  `not.toContain` 断言）。`expanded` 的命中全部在无关位置（panelOpenState、WorkspaceSidebar、
  turnActivity 注释）。`tailLines` 与其测试用例（toolText.test.ts）一并删除，没有死代码。
- `.tool-view-action`（styles.css:1036）仍在使用，唯一使用点是 `CopyButton`（common.tsx:71）—— 不是残留。
- 六个内容视图全部改用 `ScrollBox`（`grep -c '<ScrollBox'`）：CodeView 1、DiffView 1、OutputView 2
  （命令 + 输出，同级不嵌套）、WebFetchView 1、WebSearchView 2（解析失败原文 + 结果列表）、
  MatchListView 2（grep 匹配 + fffind 路径）。`TodoView`/`QuestionView` 是卡片视图，不在 R1/R6 范围内。
  `ScrollBox` 自身有测试断言「只有一个 `.tool-view-scroll`、没有嵌套」（scrollBox.test.tsx）。
- R3 的整页断言也在：ChatView.test.tsx:1343 `queryByRole("button", { name: /展开全部|收起/u })` 为 null。

### 3.5 bash 自动滚底 — 实现与测试成立；真实浏览器的观察器一环未验证

- 实现：`ScrollBox` 的 `followTail` → `useFollowTail`（ScrollBox.tsx:62-92）。初始 `pinned = true`，
  `toBottom()` 设 `node.scrollTop = node.scrollHeight`；`scroll` 监听器按
  `scrollHeight - scrollTop - clientHeight <= 2` 重新计算 `pinned`，所以**用户上滚后不会被拉回**
  （pinned=false），滚回底部自动恢复跟随。没有 `ResizeObserver` 时静默跳过（`typeof ResizeObserver === "undefined"`），
  不抛错。观察器回调也用于「内容变长」。仅 `OutputView` 的输出块用它（followTail），命令块不用。
- 测试：scrollBox.test.tsx 用 `FakeResizeObserver` 提供 jsdom 缺失的观察器，并 `Object.defineProperty`
  伪造 `scrollHeight`/`clientHeight` 来验证三条行为（打开即在底部 520；上滚到 100 后再触发仍是 100；
  回到底部后触发跳到 700）以及「非 followTail 不创建观察器」。逻辑被真实覆盖，但它驱动的是 stub。
- 风险的实际影响：真实浏览器里 `<details>` 展开时元素从 0×0 变成有布局，理论上会触发 ResizeObserver
  （Chromium 会对「之前没有 box、现在有 box」的元素投递回调）。若某个浏览器不投递，表现是
  `bash` 输出窗口停在**顶部**（第 1 行），不报错、不跳动 —— 即「从尾部读」的设计意图失效，
  比旧的「尾部 20 行」体验差，而且用户很难判断这是 bug。这一环未测（未授权真实浏览器），
  记录 §10.3 已如实标注。
- 建议（低优先，可选）：给 `<details>` 的 `onToggle` 也触发一次 `toBottom`，或把 `open` 状态作为
  prop 传进 `ScrollBox` 在 `open` 变 true 时重置滚动，成本很小，可以把这条从「依赖观察器」变成「两重保险」。

### 3.6 错误红色的范围 — 见 F1（比记录自述的更宽）

- 记录自述的代价是「失败调用自己的 Arguments 段也一起变红」。实际范围更大：由于分组级 `tool-error`
  （ChatView.tsx:1338）覆盖整个 `activity-tool-list`，**同组内成功调用**的详情也会变红（F1）。
- 落点判断：`if (item.isError || !View) return fallback;`（ChatView.tsx:1450）确实让失败调用一律
  走通用详情，所以「视图内的 `.output-error` 基本走不到」这个判断是对的；红色只能靠 CSS 规则落到
  通用详情的 `<pre>` 上。
- 「整个工具调用失败」还是「输出是错误」：目前两种都会红（Arguments 也红），语义上偏
  「整次调用失败」，这与行首的成功/失败图标可能冲突（F1 里的成功行场景）。建议把红色绑到 Result 段。

### 3.7 通用降级路径未纳入 16 行 — 见 F4

与 R1/R3 不冲突（R3 本来就没有按钮；R1 的范围按 §4.1 只覆盖六个内容视图），但构成
「同一工具不同结果形态不同」的缺口。严重程度 low，建议要么包一层 `ScrollBox`，要么把
「有意保留」升级为开发者确认过的决定。

### 3.8 Chat 正文改造的回归面 — PASS（`SyntaxHighlighter` 是真钩子，R7 确实生效）

- **prop 真实性（契约点名要证）**：`@assistant-ui/react-markdown@0.14.13` 的类型定义
  `node_modules/@assistant-ui/react-markdown/dist/code-fence.d.ts:15-27` 里
  `ComponentsByLanguage` 与 `SyntaxHighlighterProps` 明确存在；运行时实现
  `dist/primitives/MarkdownText.js` 从用户 `components` 里解构 `SyntaxHighlighter`
  （`const { pre = DefaultPre, code = DefaultCode, SyntaxHighlighter = DefaultCodeBlockContent, CodeHeader = DefaultCodeHeader } = userComponents ?? {}`），
  并在 `dist/overrides/CodeOverride.js` / `CodeBlock.js` 里对每个 fenced block 调用
  `<SyntaxHighlighter node components language code />`。所以 `SyntaxHighlighter` 是**真实支持的钩子**；
  `markdownShared.components.SyntaxHighlighter`（markdownPlugins.ts:32）确实会被调用，
  行内 code 走的是 `components.Code`（`useIsMarkdownCodeBlock()` 为 false 时直接渲染 `components.Code`），
  不经过该钩子。
- **端到端证据**：ChatView.test.tsx 新增用例在真实 `MarkdownTextPrimitive` 管线里断言
  `.markdown-body pre code .code-block-line` 恰好 1 条、文本与 fence 内容一致、随后出现带
  `style="color:…"` 的 token span，且行内 `code` 内没有 `.code-block-line`。该用例在我 12 次连跑中稳定通过。
- **`markdownShared` 的共用面（逐一）**：
  1. `src/web/components/ChatView.tsx:1187`（`AssistantText`，Chat 正文）—— R7 的目标面；
  2. `ChatView.tsx:1375`（`ActivityItemRow` 的 message，activity 内嵌文本）—— 现在 fenced block 也会高亮；
  3. `ChatView.tsx:1627`（`ChatDivider` 的 `divider.summary`）—— 同上；
  4. `src/web/toolViews/common.tsx:56`（`MarkdownText`）→ `WebFetchView` 正文、
     `WebSearchView` 的 preamble/每条结果/解析失败原文 —— 也会高亮。
  共同影响：这四处多了「fenced block 走高亮内核」这一行为（都符合「同一内核」，但 note：打开 `web_fetch`
  详情若含代码块，会触发 shiki chunk 下载，这一点记录没写）。共同不变：`components.a = MarkdownLink`
  仍在（markdownPlugins.ts:32）、`remarkGfm`/`remarkMath`/`rehypeKatex`/`preprocess` 一字未改，
  `ChatView.tsx` 本次 **0 行改动**（`git diff b5b49a7..91519de -- src/web/components/ChatView.tsx` 无输出）。
- **「未变」的证据**：改用 `components.SyntaxHighlighter` 是往既有 `components` 对象**加一个键**，
  不触碰 `pre`/`code`/`a`；行内 code 由 `CodeOverride` 分派（上面已核）；LaTeX/表格/链接策略/图片预览/
  `Worked for` 分组/投递状态/todo 条的实现文件都不在本批 diff 内（`git diff --name-only` 可核），
  且既有测试全绿（`markdownLink.test.tsx`、表格/LaTeX 等用例在 `npm test` 的 297 个通过项里）。
  这是间接证据（不是针对每一项的单测），已如实说明。
- **性能**：`inFlight` 去重 + 模块级单例 `highlighterPromise` + `loadedLanguages` 集合
  （highlight.ts:194-256、344-350）确实能避免同一 `(code,lang,theme)` 重复加载；LRU 按条数 64 有测试
  （highlight.test.ts "bounds the cache"）。
  两个更细的点：(a) 两个并发请求同一**未加载**语言时会各自调一次 `loadLanguage`（`loadedLanguages`
  在 await 之后才写入），是重复工作但不是错误；(b) 大块同步 tokenize 无上限 → F7。LRU 按条数而不是
  字节数，一个 229 kB 的 `web_fetch` 正文作为一个条目可能占约 1 MB 量级的 token 对象，64 条上限
  并不等于内存上限（info，未实测内存）。

### 3.9 测试质量 — 目标测试稳定（12/12），断言覆盖基本到位，全量套件有 1 次既有 flake

- 我读过的 5 个测试文件（highlight.test.ts / styles.test.ts / scrollBox.test.tsx / views.test.tsx /
  ChatView.test.tsx 新增部分）与契约 §7 逐条对应：
  - 语言推断（路径 / fence info / 未知→text / 大小写 / 查询串 / 点文件 / 原型链名）✓ highlight.test.ts；
  - 逐行结构（token 拼接 == 原行；两主题颜色不同而文本相同；CRLF）✓；
  - 高亮未就绪的纯文本降级（**真实内核**，首次渲染无 inline color、随后出现且行数不变；不支持语言恒为纯文本）✓；
  - 16 行容器与行高同一变量 ✓（但只是源码正则，见 F3）；
  - 展开按钮移除 ✓（`expandControls()` 在 Code/Diff/Output/WebFetch 为空 + ChatView 整页断言 + CSS 无 `.tool-view-expand`）；
  - diff kind → 类名映射 ✓（四种 kind 的 className 精确列表 + CSS 侧背景/条）；
  - `$` 前缀 ✓（`.output-prompt` == `"$ "`、`.output-command-text` 文本不变 + CSS muted/不可选中）；
  - 错误红 ✓（`.output-body pre.output-error` + CSS 两条规则，但级联未验证，见 F1 的证据说明）；
  - 尾部跟随 ✓（stub 观察器下的三条行为）。
- 未发现「永远不会失败」的用例：`it.skip`/`describe.skip`/`it.todo`/`expect(true)`/`toMatchSnapshot`
  在这 5 个文件里 0 命中。
- 断言过宽/耦合实现的地方（不构成 bug，记录为观察）：`styles.test.ts` 的 `cssRule()` 依赖 CSS 的
  精确格式（选择器列表必须逐字相等，`\n` 与缩进都算），prettier 或人工重排会让它报错；这是
  源码断言的必然代价，文件里已注明。
- 覆盖缺口（low，可选补）：DiffView / MatchListView / WebSearchView 的用例没有断言
  `.tool-view-scroll` 存在（CodeView 1、OutputView 2、WebFetchView 1 有断言）；六个视图里
  三个的「已用共享滚动容器」目前只有代码阅读为证。
- **稳定性实测**（契约 §3.9 要求 ≥10 次）：
  - `npx vitest run src/web/toolViews src/web/components/ChatView.test.tsx` × **12** →
    **12/12 PASS，失败 0 次**（每次 4 files / 140 tests；日志 /tmp/rev2-loop-1..12.log）。
  - `npm test`（全量 20 files）→ 第 1 次 **FAIL（1 failed / 297 passed）**，随后 4 次 **PASS（298 passed）**。
    失败用例是 `keeps a failed prompt in the thread with an explicit error and recovery actions`
    （ChatView.test.tsx:148），与本批产物无因果，机制见 **F5**。
  - 基线对照（/tmp/rev2-base，b5b49a7）：`npm test` 4 次全 PASS（264 passed），
    ChatView.test.tsx 单文件 8 次全 PASS（62 passed）—— 基线 4 次没复现，所以要诚实标注：
    该 flake 是既有测试缺陷，但本批增大的测试量/负载会提高它的触发概率。
  - 单独只跑失败用例 ×10 → 10/10 PASS。

### 3.10 范围与记录一致性 — PASS（除 F6/F8 的记录性偏差）

- `git diff --name-only b5b49a7..91519de` 22 个文件，全部落在契约 §3 write set 内：
  `package.json`、`package-lock.json`、`src/web/**`（含新文件与测试）、`.agents/tasks/20260918-tool-views-rev2.md`。
  **没有** `src/server/**`、`src/shared/**`、`integrations/**`、`docs/**` 的改动；
  `src/web/components/ChatView.tsx` 一行未改（已核对空 diff），与记录一致。
- 两个 commit（`0d973db`、`91519de`）与契约一致。
- 记录里逐条「已验证」的复现结果：`npm ci` PASS ✓；`npm install shiki`（版本/唯一性）✓；
  目标测试 PASS ✓（我 12/12）；`npm run typecheck` PASS ✓（exit 0，无输出）；
  `npm test` —— 我 4/5 PASS、1 次 FAIL（记录写 PASS，未提 flake，见 F5）；
  `npm run build` PASS ✓（含 build:server + build:web）；体积数字 ✓（F6 的两处例外）。
- 三处「开发者拍板」在记录里都能追溯到：`max-height` 而非 `height`（§9.3「已获开发者确认」）、
  `bash` 打开即在底部（§9.3「开发者确认」）、错误红色的落点与代价（§9.4「已获开发者确认」）。
  这一点我**无法独立证实**（没有决策记录或聊天记录可查，也不应去翻），只能确认记录里有明确署名说法。
- R1–R8 逐条：R1 见 F2（容器侧正确、可见行数在部分视图不足）；R2 成立（无虚拟化，DOM 全量，
  有测试断言 250 行都在 DOM）；R3 成立（删除彻底，见 §3.4）；R4 成立（按需，见 §3.1）；
  R5 三项都落地（diff 背景带 + 3px inset 条、gutter 固定右对齐不可选、`$` 前缀 + 错误红 —— 但错误红
  的范围有 F1）；R6 成立（两个 Markdown 视图都进 ScrollBox，无展开按钮）；
  R7 成立（见 §3.8，端到端有测试）；R8 成立（`git diff -- src/web/styles.css | grep font-size` 无输出；
  diff 里新增的颜色只有 `#c2635d`（既有状态色复用）与 `#a2a79c`（既有 muted 色复用）以及两条
  box-shadow 用的既有色，没有引入新配色体系）。
- 「未运行 npm run dev」无法验证（NOT VERIFIABLE），但没有发现 dev 副作用（无新增 dev 配置/端口改动）。

## 3. 我的运行记录（全部命令与结果）

PASS/FAIL/NOT RUN 均指**实际执行**的结果。

| # | 命令 | 结果 |
| --- | --- | --- |
| 1 | `git status` / `git log --oneline -3` | PASS（工作树 clean；`91519de`、`0d973db` 在 `b5b49a7` 之上） |
| 2 | `git diff b5b49a7..91519de --stat` | PASS（22 files, +1897/−267） |
| 3 | `git diff b5b49a7..91519de -- package.json` | PASS（只多 `+ "shiki": "^4.4.3"`） |
| 4 | `git diff b5b49a7..91519de -- package-lock.json \| grep -cE '^-[^-]'` | PASS（0 行删除；新增 16 个 node_modules 条目全是 shiki 家族） |
| 5 | `git diff --name-only b5b49a7..91519de` | PASS（全在 write set 内，无 server/shared/integrations/docs） |
| 6 | `npm ci` | PASS（exit 0） |
| 7 | `rm -rf dist && npm run build` | PASS（exit 0；typecheck+server+web 全过） |
| 8 | `grep -l "shiki\|oniguruma\|createHighlighter\|codeToTokens" dist/web/assets/index-*.js` | PASS（无匹配 → 首屏不含 shiki） |
| 9 | `grep -o 'assets/...' dist/web/index.html` | PASS（只有 index-*.js + index-*.css） |
| 10 | `grep -l oniguruma dist/web/assets/*.js` | PASS（none → 未引入 wasm 引擎资源） |
| 11 | `git archive b5b49a7 \| tar -x -C /tmp/rev2-base && (cd /tmp/rev2-base && npm ci && rm -rf dist && npm run build)` | PASS（基线构建 exit 0） |
| 12 | 基线/交付体积逐项比对（见 §3.1 表） | PASS（与记录一致，仅 F6 两处记录偏差） |
| 13 | `node /tmp/rev2-escape/out/escape-check.js`（esbuild 打包真实内核 + 真实组件） | PASS（ALL PASS，无 XSS/结构破坏） |
| 14 | `node /tmp/rev2-escape/out/color-check.js` | PASS（注释/字符串/关键字均保留颜色） |
| 15 | `node /tmp/rev2-escape/out/perf-check.js` | PASS（测得 100/500/2000/8000 行 = 46/126/404/1450 ms，记入 F7） |
| 16 | `node /tmp/rev2-escape/cascade-check.mjs`（jsdom 级联） | NOT USABLE（jsdom 未应用 `.tool-error .tool-detail pre`，输出不可作为证据；F1 改以静态特异性推断） |
| 17 | `npx vitest run src/web/toolViews src/web/components/ChatView.test.tsx` × 12 | **PASS 12/12**（每次 4 files / 140 tests，失败 0 次） |
| 18 | `npm run typecheck` | PASS（exit 0，无输出） |
| 19 | `npm test`（第 1 次，delivered） | **FAIL**（`Tests 1 failed \| 297 passed (298)`，ChatView.test.tsx:148） |
| 20 | `npm test` × 4（delivered） | PASS 4/4（298 passed） |
| 21 | 失败用例单独 `npx vitest run src/web/components/ChatView.test.tsx -t "keeps a failed prompt in the thread"` × 10 | PASS 10/10 |
| 22 | `npm test` × 4（基线 /tmp/rev2-base） | PASS 4/4（264 passed） |
| 23 | `npx vitest run src/web/components/ChatView.test.tsx` × 8（基线） | PASS 8/8（62 passed） |
| 24 | 残留搜索（`展开全部`/`收起`/`CODE_FOLD_LINES`/`DIFF_FOLD_LINES`/`BODY_FOLD_LINES`/`OUTPUT_TAIL_LINES`/`tailLines`/`LineSlice`/`ExpandButton`/`tool-view-expand`） | PASS（无死代码；命中均为测试断言或注释） |
| 25 | `grep -rn dangerouslySetInnerHTML\|innerHTML\|__html\|codeToHtml src/` | PASS（产品代码 0 命中，唯一命中是无关测试断言） |
| 26 | 六个视图 `<ScrollBox` 计数、`markdownShared` 使用点枚举、`SyntaxHighlighter` 类型与运行时核对 | PASS |
| 27 | `git diff b5b49a7..91519de -- src/web/styles.css \| grep font-size` | PASS（无 font-size 变化 → R8） |
| — | 真实浏览器 / 真实 Pane 验收 | NOT RUN（未授权） |
| — | `npm run dev` | NOT RUN（禁止） |
| — | 记录里「未运行 npm run dev / 未做破坏性 Git」 | NOT VERIFIABLE（无异常迹象） |

## 4. 交给开发者的决策点

1. **F1**：修复方式选哪种？(a) 把红色限定到 Result 段（加一个类，最小侵入）；(b) 分组不再带
   `tool-error`，只在分组 summary 上用别的类。必须选一个，否则成功调用的输出会被读成错误。
2. **F2**：是统一各视图的可见行数（改 gap/`match-file-path`/`.diff-line-skip` 的占位高度），
   还是接受「窗口高 16 行、可见行数随视图不同」并在文档/UI 文案里写清？无论哪种，
   `.tool-detail pre { line-height: 1.55 }` 建议改成 `var(--tool-view-line-height)`。
3. **F4**：通用降级详情要不要也进 `ScrollBox`（3 行改动），还是明确保留 320px 并写成
   「开发者已确认的例外」？
4. **F7**：要不要给高亮加行数上限（例如 >1000 行直接走纯文本）？

其余（F3、F5、F6、F8）我认为不需要阻塞合入，但 F5 的测试修改很便宜，建议一并处理。

## 5. 未验证与限制（诚实边界）

- 未做真实浏览器/Pane 验收（未授权）：**没有任何渲染高度、滚动条外观、子像素取整、CSS 级联的
  真实测量**。F1 是静态特异性推断；F2 是 CSS 算术推断；F7 是 Node 下计时（浏览器数值可能不同）。
- jsdom 不能做级联与布局：我尝试过（第 16 条命令），结论不可用，已明确排除；这也意味着
  「16 行」与「错误红是否生效」在本环境中都只能靠源码/算术推断。
- 三处「开发者拍板」只核到记录里有明确说法，未能独立证实。
- 记录里「未运行 npm run dev / 未做破坏性 Git」为不可验证项（无异常迹象）。
- 未检查真实 Pi session / JSONL，未把任何真实文件内容写入本文件；体积与测试数字均来自本次自建
  的 build 与 test 输出。
- 基线对照用的 `/tmp/rev2-base` 是 `git archive` 副本（不是 worktree），不影响本仓库状态。
