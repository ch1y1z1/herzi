# 批次：Chat 过程展示增强（单 Worker）

- 日期：2026-09-17
- 模式：**单 Worker + 一个 worktree**（开发者指定；改动集中在同一批文件，无可并行的独立范围，因此不建 integration worktree，也不拆多 Worker）
- 设计依据：[`docs/chat-tool-presentation-plan.md`](../../docs/chat-tool-presentation-plan.md)

## 授权范围

开发者授权：使用一个 worktree 创建一个新代理完成该任务，范围 = P0 + P1 + P2 + P3（仅持久化部分），D1–D6 全部按推荐执行。

未授权：合入或推送 `main`；操作真实 Pi/Herdr 业务 Pane；`npm run dev`；新增 production dependency。

## 基线

| 项目 | 值 |
| --- | --- |
| Base（main） | `a28176e` — `docs: confirm the presentation plan decisions` |
| Worker 分支 | `agent-20260917-tool-presentation` |
| Worker baseline commit | `2dd3868` — `docs: add worker task contract for the tool presentation work` |
| Worktree | `/Users/chiyizi/.herdr/worktrees/herzi/agent-20260917-tool-presentation` |
| Herdr workspace / pane | `w14` / `w14:p1` |
| Agent 名称 | `herzi_tools` |
| 任务契约 | `.agents/tasks/20260917-chat-tool-presentation.md`（在 Worker 分支内） |

## 派发记录

- 已发送实施 prompt（含 D1–D6、write set 边界、验证命令、禁止项与 AGPL 约束）。
- 通过 `herdr agent get herzi_tools` 确认状态为 `working` 后，Integrator 停止等待并交回控制。
- 开发者可直接在 `w14:p1` 与 Worker 交互；Worker 遇决策点直接向开发者提问。
- 完成后由开发者手动通知 Integrator，届时执行：检查越界 → 目标测试复核 → 合入前完整验证（typecheck/test/build）→ 汇报，等待是否进入 `main` 的决定。

## 未决事项

- 真实浏览器视觉验收（组头文案与行的实际观感、tooltip 行为）预计仍需授权后在隔离环境执行。
- `main` 当前领先 `origin/main` 若干 commit，尚未推送（等待开发者决定）。

## Worker 完成（2026-09-17）

- Worker `herzi_tools` 状态 `idle`，worktree clean，交付 commit `e53e3c6`。
- 范围检查：11 个文件全部在契约 write set 内（`toolCatalog.ts(+test)`、`panelOpenState.ts(+test)`、`ChatView.tsx(+test)`、`styles.css`、`pi-session-reader.ts(+test)`、`protocol.ts`、任务记录），无越界。
- Worker 自报：`npm ci` PASS；`toolCatalog` 17 / `panelOpenState` 9 / `pi-session-reader` 8 / `ChatView` 15 PASS；`npm run typecheck` PASS；`npm test` PASS（13 files / 100 tests）；`npm run build` PASS；真实浏览器视觉验收 `NOT RUN`。
- Worker 标注了两处口径：D1 只有 `edit`/`write` 按 path 去重（`read` 按调用次数）；D3 结束边界取 `min(本条 entry 写入时间, 下一条 entry 起始时间)`。另自行判断 `todo` 不参与阶段动词表决并标注待确认。
- Integrator 尚未复核，尚未合入 `main`。待办清单见 [`20260917-pending-backlog.md`](./20260917-pending-backlog.md)。
