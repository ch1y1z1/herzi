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

## Worker 完成（2026-09-18）

- Agent `herzi_toolviews` 状态 `idle`，worktree clean，交付 3 个 commit：`c06e4c4`（协议 + 服务端白名单投影 + bridge 实时投影）、`0cc3bea`（`src/web/toolViews/**` 8 个视图 + `ChatView` 接线 + 样式）、`04ed530`（P2.5 `todo` / `ask_user_question` 卡片 + 任务记录两节）。
- 规模：22 文件，+4225 / −29。10 个工具 → 8 个视图（`read`/`write` 共用 `CodeView`，`ffgrep`/`fffind` 共用 `MatchListView`）。
- Worker 自报验证：`npm ci` PASS（依赖无 diff）；§6 四文件 vitest 177/177 PASS（连续 32 次）；`typecheck` PASS；`npm test` 251/251 PASS（连续 8 次）；`build` PASS；真实浏览器 / 真实 Pane 验收与 `npm run dev` 均 NOT RUN。
- Worker 已记录一次**未能复现**的测试失败（首次 4 文件同时运行时 `1 failed | 176 passed`，输出未保存，随后 40 次通过；已加 `afterEach` 统一 `unstubAllGlobals`），提请 Reviewer 与集成态复跑。
- **Worker 在 P2.5 遇到的协议字段新增已由开发者当场批准**：新增 `question` + `todo` 两个白名单字段，不加 `pageIndex`。

## Integrator 接收检查（2026-09-18）

- **范围**：`git diff --name-only 4b549a1..04ed530` 全部落在契约 §3 write set 内，无越界。
- **既有行为不变**：`src/web/toolCatalog.ts` 只把 `TODO_ACTIONS`、`webHost` 从模块内提升为导出（+8/−2，无逻辑改动），折叠行语义未变；`src/shared/protocol.ts` 为纯新增 108 行（0 删除），`result` 语义未动。
- **记录一致**：任务记录含「过程与决策」（10 条有意偏离，逐条可核对）、「格式来源」（只读 Pi 源码，未读 session，未写入真实内容）、「不稳定项」、「剩余风险与未验证项」。
- **两处笔误已核实不影响交付**：Worker 交付说明写「分支 `herzi/agent-…`、2 个 commit」，实际分支为 `agent-20260917-tool-call-detail-ui`、3 个 commit。
- 结论：交付完整、可进入独立 review。

## 独立 Review 派发（2026-09-18）

| 项目 | 值 |
| --- | --- |
| Review 分支 | `review-20260917-tool-call-detail-ui`（base = Worker HEAD `04ed530`） |
| Review worktree | `/Users/chiyizi/.herdr/worktrees/herzi/review-20260917-tool-call-detail-ui` |
| Herdr | workspace `w1A` / pane `w1A:p1` |
| Reviewer agent | `herzi_toolreview`（`--kind claude`，与 Worker 不同模型以获得交叉视角） |
| Review 契约 | `.agents/tasks/20260917-tool-call-detail-ui-review.md`（commit `60165cf`） |

- claude 首次启动时停在「是否信任该目录」提示（该 worktree 由本批新建），Integrator 选择信任后达到 `interactive_ready`。
- 契约覆盖七个重点：白名单可否被畸形 `details` 绕过、解析器会否输出错值（含 `read` marker 两份正则一致性）、bridge 手抄副本漂移、前端只读性与外链安全、范围与既有行为不变、复现 flaky 测试、六种降级路径。
- 已发送 prompt 并通过 `herdr agent get` 确认 `working`，Integrator 停止等待并交回控制。

### Reviewer 重建（2026-09-18，开发者误关后）

- 开发者误关 Reviewer 进程。核实：`herzi_toolreview` 已不在 live agent 列表；但 pane `w1A:p1` 仍在（`agent_status: unknown`，回到 shell）、review worktree 仍在且 **clean**，Reviewer 未留下任何未提交的半成品，契约文件 `60165cf` 完好。
- 处理：在同一 pane 用相同名称重启（`herdr agent start herzi_toolreview --kind claude --pane w1A:p1`），claude 未再询问目录信任（已持久化），`interactive_ready: true`。
- 重新发送同一份 review prompt（并在开头说明「上一进程被意外关闭，无部分结果，从零开始」）；`herdr agent get` 确认 `working`。
- 未新建 worktree、未改契约、未动产品代码。

## 未决事项

- Reviewer findings 待裁决（accepted → 退回 Worker 修复；blocking → 修复且复审后才能集成）。
- 一次未能复现的测试失败（`1 failed | 176 passed`）：需在集成态多轮复跑；若再次出现应定位根因后再合入。
- 真实浏览器视觉验收（diff 配色、行号对齐、长内容折叠、匹配列表分组）预计仍需授权后在隔离环境执行。
- `main` 当前领先 `origin/main`；本批新增三个 docs commit（`4b549a1`、`29e85c2`、本记录），未推送。
