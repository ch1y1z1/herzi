# Herzi Agent 协作规范

## 1. 适用范围与优先级

- 本文件是本项目所有 coding agent 的共同规则源，适用于整个仓库。
- 用户在当前任务中的明确要求高于本文件；若要求冲突、含糊或存在多种合理解释，先询问，不自行选择。
- 修改某个子目录前，检查是否存在更近的 `AGENTS.md` 和相关设计文档；局部规则只补充本文件，不应复制通用规则。
- `CLAUDE.md` 等工具适配文件只导入本文件，不维护第二份规则正文。

## 2. 文件化记录是硬要求

- 所有工作过程都必须及时、如实地记录在项目内文件中，包括需求澄清、资料调研、技术决策、计划、实现进展、测试验证、问题排查、风险和后续变更。
- 关键事实、未决问题和验证结果不得只存在于聊天回复中；结束任务前必须更新对应记录。
- 记录位置按用途选择，不再要求所有记录都位于 `docs/`：
  - 长期有效的架构、研究、功能说明、ADR 和项目状态放入 `docs/`，并按需更新 `docs/README.md`。
  - 并行任务的执行记录放入 `.agents/tasks/<task-id>.md`，一任务一文件，避免多个 Agent 同时修改共享日志。
  - 与代码紧密绑定且离开代码就难以理解的不变量，可写入测试或简短代码注释，但影响实现的结论仍需在任务记录或长期文档中说明。
- 不记录密钥、令牌、私人会话正文、真实用户数据或不必要的绝对路径。

## 3. 工作区与隐私安全

- 开始编辑前检查当前分支和 `git status`，识别用户已有改动。
- 不覆盖、回退、整理、stash 或提交非本任务改动；发现意外变化时立即停止并询问用户。
- 未经用户明确许可，不访问当前项目目录之外的私人文件、真实 transcript、数据库、凭据或配置。
- 不执行 destructive Git、force remove、删除 branch/worktree、全局安装、真实 Agent prompt、GUI 控制等高影响操作，除非用户已明确授权。
- 不按进程名、路径模式或模糊条件终止进程；只操作本任务明确拥有的资源。

## 4. 轻量并行模式

- 简单任务默认单 Agent 完成；只有目标独立、修改范围基本不重叠、共享接口已确定且并行收益明确时才并行。
- 并行开发优先使用独立 Herdr worktree；同一批次的 worktree 从同一个已提交 base SHA 创建。
- 每个批次只有一个 Integrator：负责拆分范围、接收 Worker 结果、集成、完整验证和向用户请求最终批准。
- Worker 只修改约定范围，维护自己的 `.agents/tasks/<task-id>.md`，运行局部检查，并交付 commit、验证结果和未决问题。
- Worker 不合并其他 Worker 分支，也不直接合入或推送 `main`。
- Reviewer 仅在协议、并发、持久化、安全、隐私或较大改动中按需使用；默认只报告带文件和行号的问题。
- Integrator 发送 Worker prompt 后，只确认 Agent 已进入 `working` 就返回控制，不持续等待完成；用户可以直接与 Worker 交互，并在 Worker 完成后手动通知 Integrator继续集成。
- Worker 遇到问题或决策点时直接在自己的 Pane 向用户提问并等待，不通过 Integrator 代传或自行猜测。
- 无法明确隔离修改范围时，改为串行，不增加管理层来强行并行。
- 完整批次流程（worktree 拓扑、派发、开发者直接交互、独立 review、集成、批准与清理）见 `docs/agent-collaboration-workflow.md`；本文件只保留必须始终遵守的规则，不复制流程细节。

## 5. 验证与诚实报告

- Worker 可以在自己的 worktree 中运行目标测试、`npm run typecheck` 和 `npm run build`；缺少依赖时使用锁文件执行 `npm ci`，不修改依赖版本。
- Worker 默认不得运行 `npm run dev`：当前 server/Vite 固定使用 3030/5173，多个 worktree 会端口冲突或连到错误后端。只有用户或 Integrator 分配独占运行时和明确的隔离端口后才可启动。
- Integrator 在合并态默认运行：
  - `npm run typecheck`
  - `npm test`
  - `npm run build`
- 所有验证必须明确标记 `PASS`、`FAIL` 或 `NOT RUN`，并记录实际命令和重要限制。
- 不把类型检查、构建成功或合成测试写成真实 Herdr/Pi/Devin/Codex/浏览器验收完成。
- 真实 Pane、session、GUI 或 companion integration 验收必须使用经授权的专用 synthetic 环境，不干扰用户正在工作的资源。

## 6. 必须询问用户的情况

遇到以下情况必须暂停并询问：

1. 需求有多种合理解释。
2. 需要修改架构、公开协议、数据 schema 或 production dependency。
3. 需要访问项目外私人文件、真实 transcript、token 或数据库。
4. 需要 destructive Git、force、删除资源或覆盖已有改动。
5. 需要控制 GUI、真实 Agent Pane、安装全局 integration 或发送真实 prompt。
6. integration branch 准备合入或推送 `main`。

正常的仓库内阅读、约定范围内修改和无副作用检查无需重复询问。

## 7. 集成与完成

- Integrator 按依赖顺序集成 Worker commit；纯文本冲突可在理解双方意图后解决，行为或接口冲突退回相关 Worker。
- 集成后更新长期文档、索引和任务记录，使文件状态与真实实现、验证结果一致。
- 未经用户最终批准，不合入或推送 `main`，也不清理仍需复核的 worktree/branch。
- 若协调成本高于并行收益，减少并行，而不是增加角色、状态机或模板。
