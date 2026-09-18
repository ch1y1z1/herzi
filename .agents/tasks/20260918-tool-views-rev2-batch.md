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

## 下一步（等开发者通知后由 Integrator 执行）

1. 接收交付：范围检查（尤其确认未改 `src/server/**`、`src/shared/**`、依赖只多了 `shiki`）、worktree clean、记录与实际 diff 相符。
2. **派发独立 Reviewer**（本批新增生产依赖 + 全局视觉改动 + 触及 Chat 正文渲染，按 AGENTS.md 必须 review）：独立 worktree、只读产品代码、只写 review 记录。
3. findings 处置后再集成 → `typecheck` / `test` / `build`（含 bundle 体积核对）。
4. 汇报并等待 `main` 批准（逐批单独批准）。**真实浏览器视觉验收**是本批的核心验收项，需要在授权环境执行。

## 未决事项与资源

- 上一批（`20260917-tool-call-detail-ui`）的 worktree/agent/branch 仍保留（`w19` / `w1A` / `w1B`，agent `herzi_toolviews` / `herzi_toolreview` / `herzi_toolrereview`），等开发者批准后统一清理。
- `main` 尚未 push。
