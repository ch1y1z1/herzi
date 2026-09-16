# Prompt 投递可观测性与无声丢失保护

- 状态：规划完成，待用户授权创建 Worker worktree。
- 目标：先建立从 Enter 到 transcript reconciliation 的可关联投递日志，并消除“失败后消息直接消失且无提示”的行为；根据日志证据再定位根因，不先进行大规模架构重写。
- 修改范围：`src/web/components/ChatView.tsx`、prompt delivery 相关的新前端/服务端模块、`src/server/index.ts`、`src/server/pi-command-queue.ts`、必要的 shared type 与测试；不修改 `src/web/styles.css` 和 Markdown 文件。
- 验收条件：同一 `requestId` 可关联客户端提交、HTTP route、Herdr/bridge transport、queue claim/ack/expiry 和 authoritative reconciliation；日志不含 prompt 正文、图片、绝对 session path 或 token；失败至少显示明确错误且保留可恢复信息；不自动重试造成双发；相关测试通过。
- Base：当前 HEAD 为 `0097dc4ded77c32460bee63b95c9652c61ff86d2`，但协作规则和本任务文件尚未提交；创建 worktree 前需先建立用户批准的 committed baseline。

## 过程与决策

- 当前前端已生成 `requestId`，但只发给 server，没有形成可查询的端到端 lifecycle trace。
- `onNew` 先添加 optimistic message；请求失败时会删除该消息并重新抛错，但没有写入 `ChatView` 的 `error` 状态。这是“内容消失且没有提示”的明确风险点，但尚不能证明是所有丢失案例的唯一根因。
- server 使用 Fastify logger，但成功投递、transport 选择和 bridge queue 生命周期没有统一 correlation event。
- Pi native 路径在 enqueue 后即向浏览器返回 `queued`；claim、ack、failed 和 TTL expiry 没有统一暴露给前端，可能形成“HTTP 成功但实际未投递”的观测盲区。
- 推荐新增窄范围的 `PromptDeliveryTrace`，而不是先重写 Chat 架构：
  1. 在 composer Enter/`onNew`/optimistic/request response/error/reconciliation 记录元数据事件；
  2. server 记录 received/validated/transport-selected/submitted/queued/claimed/ack/expired；
  3. 使用 bounded、metadata-only 的本地 JSONL 或等价持久日志，并支持按 `requestId` 查询最近事件；
  4. 请求失败时不再无声撤回，明确显示失败或未确认状态，并保留可恢复内容；
  5. 用日志复现后再决定是否调整 assistant-ui composer/runtime 边界。
- 日志完整性指 lifecycle 完整，不代表记录用户正文；正文、附件内容和敏感路径必须始终排除。

## 验证与交接

规划阶段未修改产品代码、未运行测试。真实复现需要用户后续授权专用 Pi Pane；第一轮实现先使用合成测试。
