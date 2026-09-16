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
