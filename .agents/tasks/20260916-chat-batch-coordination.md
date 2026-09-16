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
