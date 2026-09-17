# 待办清单（跨批次）

- 维护者：Integrator
- 最后更新：2026-09-17
- 说明：本文件是当前待办的**唯一有序清单**，不使用 task board；每完成一项就更新状态。

## 依赖顺序

### 1. 集成 `agent-20260917-tool-presentation`（阻塞项）

- 交付：Worker `herzi_tools`（`w14:p1`）commit `e53e3c6`，worktree clean。
- 范围检查：已完成，11 个文件全部落在契约 write set 内，无越界。
- Worker 自报验证：`npm ci` PASS、四个目标测试 PASS、`npm run typecheck` PASS、`npm test` PASS（13 files / 100 tests）、`npm run build` PASS；真实浏览器视觉验收 `NOT RUN`。
- 待 Integrator 执行：逐文件审阅 → 复核目标测试 → 合入前完整验证 → 汇报 → 等批准。
- 阻塞原因：它改的 `ChatView.tsx` / `styles.css` / `protocol.ts` / `pi-session-reader.ts` 是下面第 2、3 项的必改文件。

### 2. 修 `Worked for` 提前出现与闪烁（必须在 1 之后）

- 分析：`.agents/tasks/20260917-worked-for-premature-group-bug.md`
- 候选修复：F-B（`blocked` 视为未结束）、F-A（单调的 turn running 判定）、F-C（稳定 turn key）、F-D（bridge 不再用 `Date.now()` 兜底）。

### 3. 压缩分界 + todo 列表 + ask_user_question（必须在 2 之后）

- 方案：`docs/chat-compaction-todo-askuser-plan.md`
- 阶段：P0 压缩分界（含分割 `Worked for`）、P1 todo 状态条、P2 `ask_user_question` 只读展示 + 切 Terminal；P3 一键回答为可选项。

### 4. 延后项（低优先，可择机批量处理）

来自 chat-reliability 批次：

- F4 reconciliation fingerprint 归属错位；F6 JSONL 0600 仅在创建时生效；F7 无 pagehide flush；F8 迟到 `queue.expired` 留下不可消失的 alert；F9 服务端路由与去重无测试；F10 `imageExpiresAt` 提示误导；F11 `.user-delivery*` 无 CSS；I1–I6（含 `console.debug` 元数据、批量部分写入、映射重复等）。
- N1 混合版本窗口内 `queue.expired` 映射 fail-open；N5 二次确认按钮可能被双击命中。

其它：

- `ChatView` 的 250ms `loadChat` 定时器未在 unmount 清理，导致偶发 `ERR_INVALID_URL` 测试噪声。
- 工具展示增强的 `todo` 不参与阶段动词表决（Worker 自行判断并标注，待确认）。

### 5. 真实验收缺口（需要用户授权环境）

- Markdown 链接：hover / focus / 点击新 tab 的视觉与行为。
- 投递可观测性：真实 Pane 的 claim/ack/expiry 显示、失败气泡与手动重试。
- 工具展示增强：两列布局、等宽截断、diff 配色在真实浏览器中的观感。
- 压缩分界与 todo 状态条（实现后）。

### 6. 环境与仓库收尾

- 推送 `origin/main`（当前领先若干 commit）。
- 清理测试资源：Herdr pane `wW:p5`（agent `pi_cadence`）、`/tmp/pi-cadence-test`；`/tmp/memoh-ref` 参考克隆是否保留。
- 各批次 Worker worktree / branch 的清理（内容已进 main 后）。

## 决策点（等待用户回答）

见对话中给出的选择题；结果会回填到本节。
