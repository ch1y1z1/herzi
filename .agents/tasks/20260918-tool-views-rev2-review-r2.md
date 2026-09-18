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
