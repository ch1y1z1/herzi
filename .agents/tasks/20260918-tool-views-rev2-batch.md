# 批次：工具调用展示 Rev.2（单 Worker）

- 日期：2026-09-18
- 模式：**单 Worker + 一个 worktree**。改动集中在 `src/web/toolViews/**` + `ChatView` 的代码块渲染 + 样式 + 新增 shiki 依赖，无可有效隔离的并行范围。
- 设计依据：[`docs/tool-call-detail-ui-plan.md`](../../docs/tool-call-detail-ui-plan.md) §11（Rev.2）
- 前置批次：同方案的 P0–P2.5（已合入本地 `main`，见 [`20260917-tool-call-detail-ui-batch.md`](./20260917-tool-call-detail-ui-batch.md)）

## 授权范围

开发者反馈现有展示「非常不好，而且不美观」（默认折叠 200 行、展开后一次性渲染几千行、代码无高亮），要求按「固定 16 行可视 + 滚动 + 参考 Memoh + 代码高亮」改造。四个确认问题与一个追加问题全部由开发者作答：

| 编号 | 决策 | 结果 |
| --- | --- | --- |
| R1 | 内容区高度 | **16 行**可视 |
| R2 | 虚拟滚动 | **不做**（开发者选择学 Memoh：仅限高 + 原生滚动） |
| R3 | 「展开全部 / 收起」 | **全部去掉**（含 Markdown 类视图） |
| R4 | 代码高亮 | **shiki 按需加载**（开发者批准新增 production dependency） |
| R5 | 视觉采纳 | diff 行背景带 + 左指示条；行号 gutter；命令 `$` 前缀 + 错误红色 |
| R6 | Markdown 类 | 同一 16 行窗口 + 原生滚动 |
| R7 | Chat 正文 ``` 代码块 | **一并接入同一高亮内核**（Integrator 追问后确认） |
| R8 | 字号/配色 | 不改 |

未授权：合入或推送 `main`；操作真实 Pane；`npm run dev`；除 `shiki` 外的依赖变化；`src/server/**`、`src/shared/**`、`integrations/**` 的改动。

## 主控的核对与说明

- **纠正了一个前提**：开发者最初提到「应该加上虚拟滚动条了」，但一手核对 Memoh（commit `1aaef83`）后确认 **Memoh 并没有做虚拟滚动**，它用 `max-h-72`/`max-h-96` + `overflow-y-auto`（DOM 里是全部行）。该事实已写进方案 §11，并由开发者在 R2 中选择「学 Memoh：只限高 + 原生滚动」。
- Memoh 的可借鉴实现已落盘：统一 `CodeBlock` 高亮内核（未就绪时显示纯文本）、`useShikiHighlighter` 的**按行** diff 结构（`{kind, lineNumber, html}`）、统一 `PreviewBox` 收敛漂移的 `max-h`、命令 `$` 前缀与 stderr 红色。
- 依赖体积实测（unpacked 含全部语言）：shiki 602KB、highlight.js 5.5MB、prismjs 2MB、refractor 1MB；shiki 用 `shiki/core` + JS 引擎 + 按需语言/主题。

## 基线

| 项目 | 值 |
| --- | --- |
| Base（main） | `b5b49a7` — `docs: add the Rev.2 presentation revision (fixed-height scroll, shiki, Memoh visuals)` |
| Worker 分支 | `agent-20260918-tool-views-rev2` |
| Worker baseline commit | `adf6219` — `docs: add the worker task contract for the Rev.2 presentation work` |
| Worktree | `/Users/chiyizi/.herdr/worktrees/herzi/agent-20260918-tool-views-rev2` |
| Herdr workspace / pane | `w1C` / `w1C:p1` |
| Agent 名称 | `herzi_viewrev2` |
| 任务契约 | `.agents/tasks/20260918-tool-views-rev2.md`（在 Worker 分支内） |

## 派发记录（2026-09-18）

- `herdr worktree create --workspace wW --branch agent-20260918-tool-views-rev2 --base b5b49a7 --no-focus` → workspace `w1C` / pane `w1C:p1`。
- 契约由 Integrator 写入并提交为 `adf6219`（Worker baseline），含 R1–R8、write set、shiki 接入要求、16 行精确性要求、降级要求与验证命令。
- `herdr agent start herzi_viewrev2 --kind pi --pane w1C:p1` 成功；prompt 已发送，`herdr agent get` 确认 `agent_status: working`，Integrator 停止等待并交回控制。
- 开发者可直接在 `w1C:p1` 与 Worker 交互。

## Worker 完成（2026-09-18）

- Agent `herzi_viewrev2` 状态 `idle`，worktree clean，交付 2 个 commit：`0d973db`（shiki 内核 + 共享 ScrollBox + 依赖）、`91519de`（视图迁移 + 测试 + 记录）。22 文件，+1785 / −267。
- **依赖**：`git diff` 确认只新增 `shiki: ^4.4.3`，无其它包变更。
- **范围**：`git diff --name-only b5b49a7..91519de` 全部在契约 §3 write set 内；`src/server/**`、`src/shared/**`、`integrations/**` **零改动**。
- **超出预期的干净**：`ChatView.tsx` 一行未改，正文代码块通过 `markdownPlugins.ts` 的 `components.SyntaxHighlighter` 钩子接入（仅 1 行改动）。
- 自报验证：目标测试 140 PASS；`npm run typecheck` PASS；`npm test` PASS（20 files / **298 tests**）；`npm run build` PASS。
- 体积（同一方法 `rm -rf dist && npm run build`）：`index-*.js` 544.87 kB **不变**；`ChatView-*.js` 771.73 → 776.00 kB（gzip +1.81 kB）；CSS 65.79 → 66.31 kB；shiki 内核 93.56 kB、引擎 57.63 kB、13 个语言 chunk 与 2 个主题 chunk 均在按需 chunk 内（首屏仅多约 4.7 kB）。
- 开发者在 Pane 中另行给过两次决定（已落地）：`bash` 输出打开即在底部并跟随；错误红色（代价：该详情的 `Arguments` 段也一并变红）。
- Worker 自述的限制（已作为 review 重点）：① 未做真实浏览器验收，「16 行」只是 CSS/常量层断言，没有真的量过渲染高度；② `bash` 尾部跟随只测了逻辑（jsdom 无 `ResizeObserver`），真实 `<details>` 展开触发观察器未实测；③ Markdown 类容器按 16 × 代码行高，可见 Markdown 行数略少于 16；④ `R7` 只加高亮、未给 Chat 代码块加高度窗口；⑤ 通用降级详情 `.tool-detail pre` 仍是 `max-height: 320px`，未纳入 16 行窗口。

## 独立 Review 派发（2026-09-18）

| 项目 | 值 |
| --- | --- |
| Review 分支 | `review-20260918-tool-views-rev2`（base = Worker HEAD `91519de`） |
| Review worktree | `/Users/chiyizi/.herdr/worktrees/herzi/review-20260918-tool-views-rev2` |
| Herdr | workspace `w1D` / pane `w1D:p1` |
| Reviewer agent | `herzi_rev2review`（`--kind pi`，与 Worker 一致） |
| Review 契约 | `.agents/tasks/20260918-tool-views-rev2-review.md`（commit `89af358`） |

十项重点，优先打的四条：

1. **HTML 注入安全**：shiki 输出经 `dangerouslySetInnerHTML` 注入，必须证明注入串只能来自 shiki 且代码内容被正确转义（畸形样本复现）。
2. **是否真的按需**：自己重新 build，并核实首屏 `index-*.js` 内不含 shiki。
3. **「16 行」是否精确**：容器高度与行高是否只有一个来源；若 `styles.test.ts` 只是读源码正则，必须指出它证明不了渲染高度。
4. **正文钩子真伪**：`components.SyntaxHighlighter` 是否真是 assistant-ui 支持的 prop；若不支持，正文高亮其实未生效。

其余：删除是否彻底、`bash` 自动滚底的实现与用户上滚行为、错误红色范围、降级详情 320px 与 R1/R3 的冲突、回归面、测试质量与 10 次连续跑。

已发送 prompt 并确认 `agent_status: working`；Integrator 停止等待并交回控制。

## 独立 Review 结论与 findings 裁决（2026-09-18）

Reviewer `herzi_rev2review` 完成，记录 commit `3189063`，结论：**需修复后合入**。

**实测推翻的两个风险**（原本最担心的两条）：注入面**不存在**（`highlightReact.tsx` 未用 `dangerouslySetInnerHTML`）；shiki **真的按需**（重新 build 后核实首屏 `index-*.js` 零 shiki 引用）。另：删除彻底、`components.SyntaxHighlighter` 确实是 assistant-ui 支持的钩子（正文高亮真生效）。

**8 条 findings**：

| # | 级别 | 问题 | 开发者裁决 |
| --- | --- | --- | --- |
| F1 | medium | `.tool-error .tool-detail pre` 的错误红色泄漏到同一分组内**成功**调用的详情（分组级是祖先，特异性 0,2,1 必胜） | **必修**：红色限定到失败项自身 |
| F2 | medium | 「16 行」只在 `read`/`write` 精确；`.tool-detail pre` 是第二处独立行高来源，实际 ffgrep 约 9–10 行、diff 14–15 行 | **改文案为「窗口高 16 行」**，不改布局；记录列出各视图实际行数 |
| F3 | low | `styles.test.ts` 只是读源码正则，证明不了渲染高度（jsdom 不执行级联） | 记录标注「仅源码层」（Integrator） |
| F4 | low | 通用降级详情仍 320px，形态不一致且多一个滚动容器 | **修**：纳入 16 行窗口 |
| F5 | low | `npm test` 5 次失败 1 次：`promptCalls()` 把 `/api/prompt-delivery/events` 当成 prompt 调用（**既有**缺陷） | **修**：收窄匹配 |
| F6 | low | 记录不准：实际下载 2 个主题（光/暗，约 25.6kB）而非 1 个；语言 chunk 15 而非 13 | 不改代码；记录更正（Integrator） |
| F7 | low | `codeToTokens` 同步执行且无大小上限（2000 行≈400ms、8000 行≈1.45s） | **记为已知项**，不加限制 |
| F8 | info | `plan §11` 只有 R1–R6，R7/R8 只在 Worker 契约 | 补文档（Integrator） |

**已退回原 Worker 修复**（`herzi_viewrev2`，w1C）：F1 + F2 文案 + F4 + F5，并按裁决把 F7 写入已知限制、F3 注明「仅源码层」。要求提供可证伪证据（回退即失败）与 `npm test` 5 次以上连跑。

## 修复交付与 Integrator 验证（2026-09-18）

**Worker 修复**（`cd316ff` fix + `bf6c04c` 记录；8 文件 +317 / −52）：

- **F1**：新增 `.tool-result-error pre { color }`，`ToolResultData` 只在 `isError` 的 Result section 上打该类（**不再以 `.tool-error` 祖先为键**）；分组 summary 的红图标 `.tool-error .tool-state` 未动；Arguments 段回到灰色（消除了原先记录的“Arguments 也变红”代价）。
- **F2**：表述统一为「窗口高 16 个代码行」（`16 × --tool-view-line-height = 260.4px`）；无 UI 文案需改（行数文案本来就是 `共 N 行 · 可滚动查看`）；常量改名 `SCROLL_BOX_LINES` → `SCROLL_WINDOW_LINES`；per-view 实际可见行数表写入任务记录 §11.2。
- **F4**：`ToolData` / `ToolResultData` 的 `<pre>` 各包一层 `ScrollBox`；删除 `.tool-detail pre` 的 `max-height: 320px; overflow: auto` 与随之失效的 `.tool-view pre` 覆盖 —— 面板内**再无任何 `<pre>` 自己是滚动容器**。
- **F5**：`promptCalls()` 改为 `/\/prompt(?:[?#]|$)/u`（不再把 `/api/prompt-delivery/events` 算成 prompt 调用）。
- Worker 自报：目标测试 142 PASS ×3；`npm test` 303 PASS ×6；`typecheck` / `build` PASS；F1/F4 各做了可证伪实验（回退即 FAIL，已还原并校验 md5）。体积：`index-*.js` 0 变化，`ChatView-*.js` +154 B，CSS −85 B。

**Integrator 独立验证**：

| 验证 | 结果 |
| --- | --- |
| `npm run typecheck` | **PASS** |
| focused（`toolViews` + `ChatView.test.tsx`）×6 | **PASS**（每次 9–20 s） |
| `npm test` ×8 | **PASS** |
| `npm test` ×30 | **PASS** |
| 累计 | **44 次连续通过** |
| 但：最初在**重负载**下见过 2 次失败 | focused 那次 `1 failed / 141 passed` 且耗时 **182 s**（正常 9–20 s）；紧接 `npm test` 5 次中第 2 次 `1 failed / 302 passed`。两次均**未保留用例名** |

结论：F5 的修复有效（flake 显著降频），但**不能声称已完全消除**，已交给定向复审独立复跑与定性。

## 定向复审派发（2026-09-18）

| 项目 | 值 |
| --- | --- |
| 复审分支 | `review-20260918-tool-views-rev2-r2`（base = 修复后 HEAD `bf6c04c`） |
| 复审 worktree | `/Users/chiyizi/.herdr/worktrees/herzi/review-20260918-tool-views-rev2-r2` |
| Herdr | workspace `w1E` / pane `w1E:p1` |
| Reviewer agent | `herzi_rev2recheck`（pi） |
| 复审契约 | `.agents/tasks/20260918-tool-views-rev2-review-r2.md`（commit `d082b70`） |

四项必验：F1 是否真不以祖先为键（含可证伪实验）、F2 表述改动是否干净且 per-view 行数表准确、F4 是否真无第二层滚动容器（含可证伪实验）、F5 flake（独立连跑 `npm test` ≥15 次，复现则保留用例名）。已写入 Integrator 观察到但未定位的两次失败事实供其核对。

## 下一步（等开发者通知后由 Integrator 执行）

1. 接收交付：范围检查（尤其确认未改 `src/server/**`、`src/shared/**`、依赖只多了 `shiki`）、worktree clean、记录与实际 diff 相符。
2. **派发独立 Reviewer**（本批新增生产依赖 + 全局视觉改动 + 触及 Chat 正文渲染，按 AGENTS.md 必须 review）：独立 worktree、只读产品代码、只写 review 记录。
3. findings 处置后再集成 → `typecheck` / `test` / `build`（含 bundle 体积核对）。
4. 汇报并等待 `main` 批准（逐批单独批准）。**真实浏览器视觉验收**是本批的核心验收项，需要在授权环境执行。

## 未决事项与资源

- 上一批（`20260917-tool-call-detail-ui`）的 worktree/agent/branch 仍保留（`w19` / `w1A` / `w1B`，agent `herzi_toolviews` / `herzi_toolreview` / `herzi_toolrereview`），等开发者批准后统一清理。
- `main` 尚未 push。
