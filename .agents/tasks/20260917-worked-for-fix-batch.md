# 批次：修 `Worked for` 提前出现与闪烁（单 Worker）

- 日期：2026-09-17
- 模式：**单 Worker + 一个 worktree**（三项修复集中在 `ChatView.tsx` / `src/server/index.ts`，无可并行范围）
- 分析依据：[`.agents/tasks/20260917-worked-for-premature-group-bug.md`](./20260917-worked-for-premature-group-bug.md)

## 开发者决策（2026-09-17）

- 修复范围：**F-B + F-A + F-C**（不含 F-D）。
- 顺序：集成 → 本 bug → 压缩/todo/ask_user。
- 三项延后项（F11 投递状态行 CSS、flaky 定时器清理、N1 fail-open 映射）**单独一轮**，不并入本次。
- 真实浏览器验收：**暂不验**，开发者会在需要时联系。

## 基线

| 项目 | 值 |
| --- | --- |
| Base（main，已推送） | `b8f232b` |
| Worker 分支 | `agent-20260917-worked-for-fix` |
| Worker baseline commit | `514b48c`（含任务契约） |
| Worktree | `/Users/chiyizi/.herdr/worktrees/herzi/agent-20260917-worked-for-fix` |
| Herdr workspace / pane | `w15` / `w15:p1` |
| Agent 名称 | `herzi_fix` |
| 任务契约 | `.agents/tasks/20260917-worked-for-fix.md`（在 Worker 分支内） |

## 派发记录

- 已发送实施 prompt（含 F-B/F-A/F-C 定义、write set 边界、可证伪测试要求、禁止项）。
- 通过 `herdr agent get herzi_fix` 确认状态为 `working` 后，Integrator 停止等待并把控制交回开发者。
- 开发者可直接在 `w15:p1` 与 Worker 交互；Worker 遇决策点直接向开发者提问。
- 完成后由开发者手动通知 Integrator，届时执行：越界检查 → 目标测试复核（含"修复前失败"验证）→ 完整验证（typecheck/test/build）→ 汇报 → 等 push 决定。

## 相关状态

- `origin/main` 已同步到 `b8f232b`（工具展示增强 + Integrator 修正已推送）。
- 未决：压缩方案的 P1–P6 决策（分界线位置、被摘要历史、todo 面板位置、ask_user 一键回答、实时提示、todo 表决口径）仍待开发者回答。
