# Chat 链接与投递可靠性并行批次

- Integrator workspace：`wX`
- Integration branch：`integration-20260916-chat-reliability`
- Planning baseline：`dd8cbe983c9f30bc795bc95209ddbac490b4b889`
- 用户授权：创建一个 integration worktree 和两个 Worker worktree；允许发送约定 prompt；禁止操作真实 Pi Pane；禁止合入或推送 `main`。

## Worker A：Markdown 链接

- Workspace / Pane：`wY` / `wY:p1`
- Branch：`agent-20260916-markdown-links`
- Agent name：`herzi_links`
- Task：`.agents/tasks/20260916-markdown-link-rendering.md`
- 派发结果：prompt 已发送；2026-09-16 通过 `herdr agent get herzi_links` 确认状态为 `working`。

## Worker B：Prompt 投递可观测性

- Workspace / Pane：`wZ` / `wZ:p1`
- Branch：`agent-20260916-prompt-observability`
- Agent name：`herzi_delivery`
- Task：`.agents/tasks/20260916-prompt-delivery-observability.md`
- 派发结果：prompt 已发送；2026-09-16 通过 `herdr agent get herzi_delivery` 确认状态为 `working`。

## 协调约定

- Integrator 确认两个 Worker 进入 `working` 后停止等待并把控制交还用户。
- 用户可直接在 Worker Pane 中交互；Worker 的问题和决策点直接由用户处理。
- Worker 完成后由用户手动通知 Integrator；在此之前 Integrator 不轮询、不读取 Worker 输出、不开始集成。

## 创建记录

- 首次尝试以 linked integration workspace `wX` 作为 `worktree create --workspace` 来源，Herdr 0.8.2 返回 `linked_worktree_source`；按该版本要求改用父仓库 workspace `wW` 后，两个 Worker worktree 创建成功。未产生失败的 checkout 或 branch。

## Worktree 测试约定

- Worker 可在各自 worktree 中运行目标测试、`npm run typecheck` 和 `npm run build`；若 `node_modules` 不存在，按锁文件执行 `npm ci`。
- 当前不允许两个 Worker 运行 `npm run dev`：server 固定监听 3030，Vite 固定监听 5173 且 proxy 指向 3030，无法保证 per-worktree 隔离。
- 当前批次的真实 UI/交互验证由 Integrator 在代码集成后串行执行；若端口被现有实例占用，再向用户请求独占运行环境或先实现可配置端口。

## Browser Use / CUA 实测约定

- 用户可以单独授权 Worker 使用 browser-use 或 CUA，但授权不等于允许共享 3030/5173、读取真实 transcript 或操作业务 Pane。
- Web 交互优先 browser-use 后台 CDP；CUA 仅用于原生窗口/菜单/焦点等 CDP 无法覆盖的场景，foreground delivery 需再次明确授权。
- 当前配置没有 per-worktree dev port 和 synthetic Chat 数据环境，因此本批次两个 Worker 继续只做自动/合成验证；实际浏览器验证默认在集成后由 Integrator 串行执行。
- 若后续要求 Worker 实测，先为其分配独占测试租约、隔离端口、synthetic session/fixture，以及其自行创建和清理的 tab/window；不得并发争用用户的本地浏览器或现有 dev server。

## Worker A 阶段性集成

- 用户通知 `herzi_links` 已完成后，Integrator 确认 Agent 为 `idle`、worktree clean，分支包含 `ee77e0b`（实现）和 `eaf19a5`（任务记录）。
- 修改范围检查通过：只涉及 Worker A 任务记录、Markdown link renderer/测试、共享 Markdown 配置和样式；未触碰 Worker B 范围。
- 两个 commit 无冲突 cherry-pick 到 integration branch，生成 `7cee417`、`cea7125`。
- 集成态验证：目标测试 7/7 PASS、`npm run typecheck` PASS、`npm run build` PASS；完整 `npm test` 待 Worker B 集成后统一运行。
- 真实浏览器验收仍为 `NOT RUN`；Worker A worktree/branch 保留，不清理，不合入或推送 `main`。

## 独立 Code Review 派发

- 用户在 Worker B 正式集成前要求暂停，并授权创建独立 review candidate；Worker B commit `55839d5` 仍未进入 integration branch。
- Review workspace / Pane：`w0` / `w0:p1`。
- Review branch：`review-20260916-chat-reliability`，基于 integration commit `83f76d6`。
- Worker B 在 review branch 中 cherry-pick 为 `39b9423`；review 任务定义 commit 为 `e82506a`。
- Reviewer agent：`herzi_reviewer`；只允许修改 `.agents/tasks/20260916-chat-reliability-review.md`，不得修改产品代码。
- 已发送审查 prompt，并通过 `herdr agent get herzi_reviewer` 确认状态为 `working`。
- Integrator 现在停止等待和轮询；Reviewer 完成后由用户手动通知。期间用户可直接与 Reviewer 交互，决策点由 Reviewer 直接向用户提问。

## 独立 Review 结果（已收到）

- Reviewer `herzi_reviewer` 已完成，findings commit `7f75693`（只修改 review 任务文件），worktree clean，未触碰产品代码。
- 结论：未发现阻断问题；Medium ×3、Low ×8、Informational ×6。
- Medium：F1 客户端 trace 在 flush 并发时滞留终态事件（已运行时复现）；F2 `queue.expired` 沿用过期前 status，且"认领后 ack 丢失"与"从未认领"在 UI 上不可区分并同样引导重试；F3 同 requestId 去重路径一律回 `queued`，终态命令会静默 no-op（latent）。
- Reviewer 组合态验证：`npm ci` / `npm run typecheck` / `npm test`（11 files / 54 tests）/ `npm run build` 全 PASS；未发现 Worker A×B 交互回归。
- 真实 Pi/Herdr 端到端与真实 HTTP/WS 行为为 `NOT RUN`（未运行 `npm run dev`）。
- 处置：Wait —— Worker B commit `55839d5` 仍未进入 integration branch；等待开发者决定 F1/F2/F3 是退回 Worker B 修复，还是接受并在文档中记录为已知限制。

## Review Findings 处置（开发者选择方案 A）

- 2026-09-17 开发者选择方案 A：
  - F1、F2、F5 退回 Worker B（`wZ:p1`）修复；
  - F3 作为已知 API contract 限制写入 `docs/prompt-delivery-observability.md`，本轮不重构路由；
  - F4、F6–F11、I1–I6 记为延后，由 Developer 明确接受，不在本轮实现。
- F1/F2/F5 的修复必须带能复现原问题的回归测试；F2 还要求 UI 不得再对“claimed 后 ack 丢失”给出一键即发的重试。
- 已通过 `herdr agent prompt wZ:p1` 派发修复任务；确认状态为 `working`。
- Worker B 修复后仍需一次复审（更新 review candidate 并让 Reviewer 核对 findings 是否真正关闭），通过后才进入正式集成。
- 当前 integration branch 仍不含 Worker B commit 55839d5；`main` 未修改。
