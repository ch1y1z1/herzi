# 待办清单（跨批次）

- 维护者：Integrator
- 最后更新：2026-09-17
- 说明：本文件是当前待办的**唯一有序清单**，不使用 task board；每完成一项就更新状态。

## 依赖顺序

### 1. 集成 `agent-20260917-tool-presentation`（已完成）

- 交付：Worker `herzi_tools`（`w14:p1`）commit `e53e3c6`，worktree clean。
- 范围检查：已完成，11 个文件全部落在契约 write set 内，无越界。
- Worker 自报验证：`npm ci` PASS、四个目标测试 PASS、`npm run typecheck` PASS、`npm test` PASS（13 files / 100 tests）、`npm run build` PASS；真实浏览器视觉验收 `NOT RUN`。
- 集成结果：cherry-pick 为 `d9ee427`，Integrator 修正 `b8f232b`（`todo` 真实 action 词表），已推送 `origin/main`。
- 集成态验证：`typecheck` PASS、`npm test` 13 files / 100 tests PASS、`build` PASS。
- 未验证：真实浏览器视觉验收 `NOT RUN`（开发者决定暂不验）。

### 2. 修 `Worked for` 提前出现与闪烁（已完成）

- 分析：`.agents/tasks/20260917-worked-for-premature-group-bug.md`
- 范围 F-B + F-A + F-C（F-D 不做）；交付并入 main：`2ee16d5`(fix) + `b824bcf`(record) + `dc8282c`(注释漂移修正)。
- Integrator 独立可证伪验证：回退修复后目标测试 **5 failed / 27 passed**，还原后 32 passed。
- 合入后完整验证：`typecheck` PASS、`npm test` 15 files / **117 tests** PASS、`build` PASS。已推送 `origin/main` = `dc8282c`。
- 未验证：真实浏览器视觉验收 `NOT RUN`。

### 3. 压缩分界 + todo 状态条（进行中）

- 方案：`docs/chat-compaction-todo-askuser-plan.md`（§8 已记录确认结果）
- 已确认范围：**压缩分界**（语义边界插入、横线 + 可展开摘要与文件列表、作为组边界分割 `Worked for`）+ **todo 状态条**（composer 上方可折叠，计数与分组列表，空列表不占位）。
- 已确认不做：压缩进行中的实时提示；`todo` 继续不参与汇总与阶段动词。
- **暂缓**：`ask_user_question` 全部（含只读展示）——开发者认为「在 Chat 里直接回答」最复杂，稍后单独详谈；在讨论出结论前不派 Worker。
- 批次记录：`.agents/tasks/20260917-compaction-todo-batch.md`；Worker `herzi_compaction`（`w16:p1`）`working`。

### 4. 延后项（低优先；其中三项单独一轮，见开发者决策）

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

已确认（2026-09-17）：

- 集成方式：合入 main 后单独问 push → 已执行并推送 `origin/main` = `b8f232b`。
- bug 范围：F-B + F-A + F-C。
- 顺序：集成 → bug → 压缩/todo/ask_user。
- 延后项：F11 投递状态行 CSS、flaky 定时器清理、N1 fail-open 映射 → **单独一轮**（未开始）。
- 浏览器验收：暂不验，开发者需要时会联系。

仍未回答（压缩方案）：

- P1 分界线位置：语义边界 vs 写入位置。
- P2 被摘要历史：保留显示 vs 隐藏。
- P3 todo 面板位置：composer 上方 / Chat 顶部 / 侧栏。
- P4 `ask_user_question`：只展示 + 切 Terminal vs 也要一键回答。
- P5 压缩进行中的实时提示：做 vs 不做。
- P6 Worker 的 `todo` 表决口径：接受 vs 参与表决。

### 清理记录

- 2026-09-17：删除两个已集成且不再需要的 Worker worktree 与分支。
  - `agent-20260917-tool-presentation`（w14，was `e53e3c6`）→ 内容已随 `d9ee427` 进入 main。
  - `agent-20260917-worked-for-fix`（w15，was `371fa99`）→ 内容已随 `2ee16d5` + `b824bcf` 进入 main。
  - 删除前核实：两分支相对 main **均无"仅存在于该分支的文件"**（0 个）；worktree 均 clean；两份任务记录均已在 main。
  - 删除方式：先删各自 gitignored 的 `node_modules`/`dist`，再用 `herdr worktree remove`（`forced: false`），最后删分支。
  - 仍保留：`agent-20260917-compaction-todo`（w16）—— **正在使用中**。
- 待确认的其它残留资源：测试 pane `wW:p5`（agent `pi_cadence`，用于验证输出节奏规则）、`/tmp/pi-cadence-test`、`/tmp/memoh-ref`（参考克隆，约 65 MB）。
