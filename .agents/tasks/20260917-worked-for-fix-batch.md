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

## Integrator 审阅与集成（2026-09-17）

- 审阅结论：三项修复都落在契约 write set 内（`src/shared/pane-activity.ts(+test)`、`src/web/turnActivity.ts(+test)`、`ChatView.tsx(+test)`、`src/server/index.ts`、任务记录），无越界。
  - F-B：`isPaneActive(status) = working || blocked` 落在 `src/shared`（因 `src/server/index.ts` import 期即 `listen(3030)`，导出判定无法单测），替换 4 处内联比较。
  - F-A：新增 `turnActivity.ts`（`latestAssistantTurn` + 粘性 tracker + `useLatestTurnActivity`）；分组只用 `latestTurnRunning`；composer/working 指示器的 `running` 改为 fail-open 的「任一来源报告忙碌即为忙碌」。
  - F-C：`DisplayMessage.id` → `turn:${firstMessage.id}`；面板 key 与展开状态逻辑未重复改动。
- **Integrator 独立可证伪验证**（不只采信 Worker 自述）：临时把 `isPaneActive` 回退为只认 `working`、并把 turn key 回退为 `lastMessage.id`，目标测试 **5 failed / 27 passed**（`pane-activity` 1 条、`turnActivity` 2 条、`ChatView` 2 条：`keeps the latest turn expanded until the pane actually settles`、`keeps the turn's message id stable while the turn grows`）；还原后 **32 passed**。
- **Integrator 修正（文档/注释漂移，Worker 标注在 write set 之外）**：
  - `src/web/panelOpenState.ts` 头部注释仍写「`DisplayMessage.id` is `turn:<last message id>`」，已改为过去时并说明现在 key 已稳定、持久化仍保留；
  - `docs/chat-tool-presentation-plan.md` §4.6 增加更正说明。
- cherry-pick：`eed99d9` + `371fa99` → main `2ee16d5` + `b824bcf`；唯一冲突是 `.agents/tasks/20260917-worked-for-fix.md`（main 原本没有该文件，modify/delete），按保留 Worker 版本解决。
- 合入后完整验证（main）：`npm run typecheck` PASS；`npm test` PASS（**15 files / 117 tests**，基线 100）；`npm run build` PASS。
- Worker 自述的两点判断已被采纳并在其任务记录中：判定的「必要条件」语义（任一来源活跃即保持展开）、以及粘性标记在当前信号集下不会额外推迟折叠（其价值是把 latch 与清理点显式化）。
- 未验证：真实浏览器视觉验收 `NOT RUN`（闪烁是否消失、blocked 时 composer 显示 Stop 的观感）。
- 未 push；等开发者决定。
