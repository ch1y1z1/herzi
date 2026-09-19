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
