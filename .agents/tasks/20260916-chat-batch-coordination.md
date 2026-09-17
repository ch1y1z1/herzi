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

## Worker B 修复与第二轮复审

- Worker B 修复提交：`3e7c5e5`（14 files, +659/−105），状态 `idle`、worktree clean。
- 修复内容：F1 drain 式 flush + 可控挂起 Promise 回归测试；F2 新增 `PromptQueueStatus "expired"`、过期事件不再沿用旧 status、区分 `queue-expired-unclaimed` / `queue-expired-unacked`、client trace 记录与 UI 一致、unacked 重试需二次确认；F5 rotate 失败不再清零 `fileBytes`；F3 写入 `docs/prompt-delivery-observability.md` §9；F4/F6–F11/I1–I6 记入 Worker B 任务记录「Review 处置」。
- 范围检查：未触碰 Worker A 文件（`markdownLink*`、`markdownPlugins.ts`、`styles.css`）。
- 唯一重构：`queueLifecycleEvent` / `queueStatusToDeliveryStatus` 从 `src/server/index.ts` 迁至 `src/server/pi-command-queue.ts` 并导出，用于补服务端事件形状测试；无新 HTTP 接口。
- review candidate 更新：`52027bb`（= 7f75693 + 3e7c5e5），再追加第二轮任务定义 `05af238`。
- 已通过 `herdr agent prompt w0:p1` 派发第二轮只读复审，确认状态为 `working`；Integrator 停止等待。
- integration branch 仍不含 Worker B；`main` 未修改。

## 正式集成与完整验证

- 第二轮复审结论：F1 CLOSED、F2 CLOSED、F5 CLOSED、F3 文档与代码一致、延后清单完整、映射函数迁出无行为回归；无阻断问题，新增 5 条 Low/Info 观察（N1–N5）。
- 复审记录：`7ffe565`（只修改第二轮复审任务文件）。
- Worker B 集成结果（无冲突 cherry-pick）：
  - `fa2c92f` = 55839d5 功能提交；
  - `9e62e8f` = 3e7c5e5 findings 修复提交。
- 集成态完整验证：
  - `npm run typecheck` → PASS；
  - `npm test` → PASS（11 files / 60 tests）；
  - `npm run build` → PASS（仅既有 >500 kB chunk warning）。
- 未运行的真实验收：真实 Pi/Herdr Pane 端到端、真实 HTTP/WS 端到端、浏览器视觉与 hover/focus/new-tab 验收、CUA 或 browser-use 实测，均为 `NOT RUN`。
- 批次累计 diff（相对 `0097dc4`）：26 files，+3542/−59；其中含规划基线的 `AGENTS.md`、`CLAUDE.md`、`.agents/tasks/`。
- 已知冲突面：主工作区当前存在未提交的 `AGENTS.md`、`docs/README.md`、`docs/research-log.md` 改动，与批次规划基线中的同名文件区域重叠；合入 `main` 前必须先由开发者决定如何处理这些未提交改动。
- `main` 仍未修改，未 push。

## 批次收尾：合入 main 与合并态验证

- 开发者批准：合入 `main`、暂不 push；先提交主工作区未提交改动；N1–N5 延后并记录为已知限制。
- 主工作区改动提交：`96e0c16`（规则层 + 长期文档，17 个文件）。
- 第二批复审新增限制记录：`9af6505`（`docs/prompt-delivery-observability.md` 第 10 节）。
- 合入方式：`git merge --no-ff`，merge commit `8ded51b`。
- 冲突 4 处，均为文档/记录，无源码冲突：
  - `AGENTS.md`：取 main 侧（已是超集，含流程文档入口）；
  - `docs/README.md`：索引行与结论行取并集；
  - `.agents/tasks/20260916-markdown-link-rendering.md`、`.agents/tasks/20260916-prompt-delivery-observability.md`：取 integration 侧的 Worker 更新版本，而非 Planning stub。
- 合并态验证（main）：
  - `npm run typecheck` → PASS
  - `npm test` → PASS（11 files / 60 tests，exit 0）
  - `npm run build` → PASS（仅既有 chunk size warning）
- 观察到一次偶发测试噪声（两次 `npm test` 中一次出现，exit 仍为 0）：
  `Serialized Error: { code: 'ERR_INVALID_URL', input: '/api/panes/pane-1/chat' }`。
  初步判断为 `ChatView` 在响应后用 `window.setTimeout(..., 250)` 触发 `loadChat`，该定时器未在 unmount 时清理；测试 `afterEach` 已 `unstubAllGlobals()`，于是原生的 Node fetch 收到相对 URL 而报错。属测试期偶发噪声，未影响测试通过，也未在第二轮集成态复现；待后续清理定时器时一并修掉。
- 未执行：真实 Pi/Herdr 端到端、真实 HTTP/WS 与浏览器验收、browser-use/CUA 实测，均为 `NOT RUN`。
- 未 push `origin/main`；Worker A/B 与 Reviewer 的 worktree、branch 全部保留未清理。

## 推送 origin/main

- 开发者明确授权 push。
- 推送前检查：`git remote -v` 为 `git@github.com:ch1y1z1/herzi.git`；工作树 clean；待推送 19 个 commit、37 个文件（+7636/−60）。
- 敏感信息扫描：未发现 API key、私钥、credential 文件或真实 Pi session 路径；命中的 “token” 均为设计讨论用词（token streaming、request token、integration token 等）。
- 推送结果：`0097dc4..833070c main -> main`；fetch 后本地 `main` 与 `origin/main` 均为 `833070c`，无 ahead/behind。
