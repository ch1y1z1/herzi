# 批次：压缩分界 + todo 状态条（单 Worker）

- 日期：2026-09-17
- 模式：**单 Worker + 一个 worktree**（两项都集中在 `pi-session-reader.ts` / `ChatView.tsx` / `protocol.ts` / `styles.css`，无可并行范围）
- 设计依据：[`docs/chat-compaction-todo-askuser-plan.md`](../../docs/chat-compaction-todo-askuser-plan.md) §2 / §4 / §8

## 开发者决策（2026-09-17）

- 范围：**压缩分界 + todo 状态条**（plan 的 P0 + P1）。
- P1 分界线＝**语义边界**（`firstKeptEntryId` 之前）；P2 **保留显示**被摘要历史；P3 todo 放 **composer 上方可折叠条**；P5 **不做**压缩进行中实时提示；P6 `todo` 继续不参与计数与阶段动词。
- **暂缓**：`ask_user_question` 全部（含只读展示）——开发者要单独详谈「在 Chat 里直接回答」的取舍。

## 基线

| 项目 | 值 |
| --- | --- |
| Base（main，已推送） | `dc8282c` |
| Worker 分支 | `agent-20260917-compaction-todo` |
| Worker baseline commit | `e58507d`（含任务契约） |
| Worktree | `/Users/chiyizi/.herdr/worktrees/herzi/agent-20260917-compaction-todo` |
| Herdr workspace / pane | `w16` / `w16:p1` |
| Agent 名称 | `herzi_compaction` |
| 任务契约 | `.agents/tasks/20260917-compaction-todo.md`（在 Worker 分支内） |

## 派发记录

- 已发送实施 prompt（含两项范围、语义边界与组边界的关键要求、write set 边界、可证伪验证要求、禁止项）。
- 通过 `herdr agent get herzi_compaction` 确认状态为 `working` 后，Integrator 停止等待并把控制交回开发者。
- 开发者可直接在 `w16:p1` 与 Worker 交互；Worker 遇决策点直接向开发者提问。
- 完成后由开发者手动通知 Integrator，届时执行：越界检查 → 复核两处「修复前失败」验证 → 完整验证（typecheck/test/build）→ 汇报 → 等 push 决定。

## 相关状态

- `origin/main` 已同步到 `dc8282c`（工具展示增强 + `Worked for` 修复 + 记录）。
- 待办清单：[`20260917-pending-backlog.md`](./20260917-pending-backlog.md)。
- 下一批候选：三项延后项（F11 投递状态行 CSS、flaky 定时器清理、N1 fail-open 映射）单独一轮；`ask_user_question` 待与开发者详谈后再定。

## 全局约定更正（2026-09-17）

- 我最初误把开发者的「永远使用中文」理解为针对 `todo` 的 `activeForm`，并误加了独立的「工具文案」一节；开发者随后澄清：指的是**全局 `~/.pi/agent/AGENTS.md` 的「输出节奏」第 2 条**那句「过程中主动给阶段性文字」。
- 已更正：删除误加的「工具文案」节，直接改第 2 条 —— 过程中的阶段性文字必须用中文，且仍然不是请求确认。
- 与本批次的关系：无代码影响（todo 状态条与本约定无关）。当前文件为 4 节：全局要求、输出节奏、提问方式。
