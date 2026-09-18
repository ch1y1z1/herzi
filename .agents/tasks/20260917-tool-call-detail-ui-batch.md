# 批次：工具调用专属展开视图（单 Worker）

- 日期：2026-09-17
- 模式：**单 Worker + 一个 worktree**。改动集中在同一批文件（协议、reader、bridge、`ChatView`、新 `toolViews/` 目录），没有可有效隔离的并行范围，因此不建 integration worktree、不拆多 Worker。
- 设计依据：[`docs/tool-call-detail-ui-plan.md`](../../docs/tool-call-detail-ui-plan.md)

## 授权范围

开发者授权（2026-09-17）：参考既有做法，由主控开一个 worktree，让 Worker 开始实现工具调用展示。

已确认决策：D1 覆盖范围（第一层 8 个工具 + 第二层 `todo`/`ask_user_question`）、D2 只读真实 session 做结构统计（已由 Integrator 完成）、D3 延续现有紧凑行只换展开区、D4 允许服务端按需读取宿主文件。

未授权：合入或推送 `main`；操作真实 Pi/Herdr 业务 Pane；`npm run dev`；新增 production dependency；P3 宿主文件读取（本批已主动拆出，理由见下）。

## 主控的范围决定（需要开发者默认接受或纠正）

- **本批 = P0 + P1 + P2 + P2.5**（六类工具视图 + 两个卡片）。
- **P3（`bash`「查看完整输出」+ 任何宿主文件读取）拆到下一批**：它是本方案唯一新增的**服务端攻击面**，且核对显示价值有限（31/9550 次调用有 `fullOutputPath`，其中 26 个文件已被系统清理），值得单独一批 + 独立安全评审，不与展示层混在一起。

## 基线

| 项目 | 值 |
| --- | --- |
| Base（main） | `4b549a1` — `docs: record the tool-call detail UI plan and the four pre-implementation checks` |
| Worker 分支 | `agent-20260917-tool-call-detail-ui` |
| Worker baseline commit | `bdedcbf` — `docs: add the worker task contract for the tool detail views` |
| Worktree | `/Users/chiyizi/.herdr/worktrees/herzi/agent-20260917-tool-call-detail-ui` |
| Herdr workspace / pane | `w19` / `w19:p1` |
| Agent 名称 | `herzi_toolviews` |
| 任务契约 | `.agents/tasks/20260917-tool-call-detail-ui.md`（在 Worker 分支内） |

## 派发记录（2026-09-17）

- worktree 由 `herdr worktree create --workspace wW --branch agent-20260917-tool-call-detail-ui --base 4b549a1 --no-focus` 创建，返回 workspace `w19` / pane `w19:p1`；`herdr worktree list --workspace wW` 已核实该分支与路径。
- 契约由 Integrator 写入并提交为 `bdedcbf`（Worker baseline）。
- `herdr agent start herzi_toolviews --kind pi --pane w19:p1 --timeout 90000` 成功（`interactive_ready: true`）。
- 已发送实施 prompt（含 P0–P2.5 顺序、write set 边界、核对结论直达、P3 排除、验证命令、禁止项）；`herdr agent get herzi_toolviews` 确认 `agent_status: working` 后，Integrator 停止等待并交回控制。
- 开发者可直接在 `w19:p1` 与 Worker 交互；Worker 遇决策点直接向开发者提问。

## 下一步（等开发者通知后由 Integrator 执行）

1. 接收交付：检查 agent 状态、worktree clean、commit 范围是否越界、任务记录与实际 diff 是否相符、是否有未回答的产品决策。
2. **派发独立 Reviewer**（本批涉及协议新增字段与服务端投影，按 AGENTS.md 必须 review）：从集成候选创建独立 review worktree，只读产品代码、只写 review 记录。
3. findings 处置完毕后再集成：cherry-pick → `npm run typecheck` / `npm test` / `npm run build`。
4. 汇报并等待是否合入 `main` 的决定（逐批单独批准）。

## 未决事项

- 真实浏览器视觉验收（diff 配色、行号对齐、长内容折叠、匹配列表分组）预计仍需授权后在隔离环境执行。
- `main` 当前领先 `origin/main`；本批新增两个 docs commit（`4b549a1`、本记录），未推送。
