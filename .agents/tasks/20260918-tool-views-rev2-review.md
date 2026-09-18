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
