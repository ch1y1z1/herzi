# 多 Agent 架构与 Devin 首期实施方案

> 日期：2026-09-15（Asia/Shanghai）
> 状态：待决策后实施
> 首期范围：Herdr 中已有 Devin CLI Pane
> 长期范围：Pi、Devin、Codex 及其他 terminal-backed / runtime-owned / remote-api agent
> 配套调研：[`devin-integration-research-report.md`](./devin-integration-research-report.md)

## 1. 实施目标

在不破坏现有 Pi Alpha 的前提下：

1. 从当前 Pi-only 路由中抽出通用 Agent adapter 层。
2. 让 Herdr 中 `agent=devin` 的 Pane 可以默认进入 Chat。
3. 复用现有页面风格、assistant-ui 消息展示、composer、停止、seen 状态和 Terminal 切换。
4. 使用 Devin 官方 hooks 构建安装后可恢复的 derived Chat history、tool cards 和 final assistant response。
5. 对不能实现的 token streaming、旧历史回填、结构化 approval 做清晰 capability 降级。
6. 保留后续 Codex adapter 与 ACP/runtime-owned 模式的扩展边界。

## 2. 验收口径

### 2.1 首期必须完成

- Herdr snapshot 中的 Devin Pane 被正确识别并显示 Devin 图标/名称。
- Herdr official Devin integration 报告 session id 后，server 生成稳定 opaque `sessionKey`。
- Devin Pane 可以打开 Chat，即使 companion 尚未安装也不会 404 或误报 Pi。
- 文本 prompt 发送到同一 Herdr Pane，不创建第二个 Devin process。
- working/blocked/done 状态继续来自 Herdr。
- companion 安装后的 `UserPromptSubmit`、tool start/result、Stop final answer 能进入同一 Chat timeline。
- Chat 刷新、server 重启后能从 Herzi journal 恢复 companion 安装后的历史。
- cancel 在专用 Pane 中验证；blocked 时可一键切换 Terminal。
- 未安装、hook 丢失、session 切换、事件乱序、重复事件和 payload 超限均有明确降级。
- 所有 Pi 自动测试继续通过，Pi 的 JSONL、realtime、图片输入和 branch 行为不退化。

### 2.2 明确不作为首期失败条件

以下差异由 capability 明示，不伪装成已支持：

- assistant token-by-token streaming；
- thinking/reasoning streaming；
- companion 安装前的完整历史；
- Chat 内直接完成 Devin permission/question；
- Pi `/tree` 等价分支体验；
- Devin 原生 image content。

若这些被改为硬验收项，必须暂停 terminal-backed 实施并重新评估 ACP ownership。

## 3. 关键技术决策

### D1：Adapter，而不是品牌条件分支

所有 Chat 请求经 `AgentAdapterRegistry` 按 server 端最新 Pane context 选择 adapter。禁止在路由和 React 页面继续增加散落的 `agent === "pi" || agent === "devin"`。

### D2：状态、历史和实时分别定义 authority

- status authority：Herdr；
- Pi history authority：Pi JSONL；
- Devin history：Herzi derived journal，明确 `consistency=derived/partial`；
- live events：各 adapter 自己管理；
- Terminal：所有 terminal-backed agent 的完整兜底。

### D3：首期不引入 ACP runtime

`devin acp` 留作未来 `runtime-owned` provider。首期禁止对当前 TUI session 另起 ACP load/resume。

### D4：默认链路不依赖 Devin 内部 session DB

主链只使用公开 hooks、`devin list --format json`（由 Herdr official integration 使用）、可选 `--export` 和 Herdr API。数据库专项调研已确认当前 CLI 使用 SQLite，但 schema/message forest 没有公开兼容承诺；因此只允许在独立 feature flag 下，用 SQLite Online Backup API 生成 Herzi 私有一致性快照，作为实验性旧历史 bootstrap。禁止直接 copy/query/修改 live DB，任何 fingerprint 不匹配必须 fail closed。详见 [`devin-local-database-research.md`](./devin-local-database-research.md)。

### D5：Capability 驱动 UI

页面不根据 agent 名推断功能，所有可见动作由 server 下发的 `AgentCapabilities` 控制。

### D6：Devin event store 是 derived journal

journal 不是 Devin transcript 的 source of truth；UI 必须显示 history coverage，例如 `since-integration`。

## 4. 分阶段计划

### P0：Synthetic 验证与兼容矩阵

**目标：** 在写主架构前消除 hook payload、cancel 和 export 的关键未知。Moshi 当前也只把 Devin 列为 Terminal/TUI Tier C，而非 Native Chat Tier A，因此不能跳过这一验证门假定已有成熟 transcript 方案。

任务：

1. 经用户明确授权后检查：
   - `devin version`
   - `herdr --version`
   - `herdr integration status`
2. 在专用 Herdr + Devin Pane 安装/更新 official integration：
   - `herdr integration install devin`
3. 创建临时 companion capture hook，只写脱敏 synthetic payload shape，不记录真实正文。
4. 用无敏感测试任务触发：
   - SessionStart
   - UserPromptSubmit
   - PreToolUse / PostToolUse
   - PermissionRequest
   - Stop
   - PostCompaction（如可控）
   - SessionEnd
5. 验证实际字段：
   - `session_id`
   - `prompt_id`
   - `last_assistant_message`
   - tool call id 是否存在
   - tool response 的 success/output/error shape
6. 验证 `Ctrl+C`、`Esc Esc`、blocked `Esc`。
7. 用临时新 session 验证 `--export`：
   - 文件 path 与命名；
   - 每 turn 是 overwrite、atomic replace 还是 append；
   - ATIF 顶层 schema、step id、message/tool correlation；
   - resume 后行为。
8. 执行 `P0-DB` 研究门：
   - 只在专用 synthetic session 上，用 SQLite Online Backup API 创建私有快照；
   - 对照 Terminal、hooks 和 ATIF 验证 `sessions.main_chain_id`、`message_nodes`、fork/revert、compaction、tool 与 subagent 语义；
   - 验证 active writer 下的 busy/locking/latency 和 CLI upgrade/schema fingerprint；
   - 不读取用户真实 Devin DB，不对 live DB 使用 `immutable=1`，不手工复制主库/WAL/SHM。
9. 将 sanitized fixtures 放入 `integrations/devin/fixtures/`，调研结果写入 docs。

出口条件：

- 能取得 final assistant message，或明确接受“最终答复仍看 Terminal”。
- 能确认 session/prompt identity。
- cancel 策略通过真实 Pane。
- 如果 tool event 无可靠配对字段，产品接受 best-effort tool cards。
- DB importer 只有在 main-chain 投影与可见历史一致、backup 不影响 Devin 且 schema mismatch 能 fail closed 时才可进入可选阶段；失败不阻塞 hooks-only 首期。

失败处理：

- `Stop` 无 final answer 且 ATIF 不可稳定使用：首期只能做状态+输入，不应继续宣称 Chat parity；这会与 Moshi 当前 Devin Tier C 的能力边界一致。
- 用户不接受该降级：切换到 ACP 方案评审。

粗估：1–2 工程日。

### P1：建立通用 Agent contract

**目标：** 在不改变 Pi 行为的前提下抽出通用边界。

任务：

1. 新增 `src/server/agents/types.ts`：
   - `AgentPaneContext`
   - `AgentSessionRef`
   - `AgentCapabilities`
   - `AgentConversationSnapshot`
   - `DeliveryReceipt`
   - `CancelReceipt`
2. 新增 `src/server/agents/session-key.ts`：
   - server + agent + exact session ref → opaque key；
   - 单测覆盖 pane 移动、session 替换与不同 server 防碰撞。
3. 新增 `src/server/agents/registry.ts`：
   - adapter 注册；
   - exact match；
   - unsupported adapter 返回结构化 reason。
4. 新增 `src/server/agents/coordinator.ts` 与 `command-router.ts`。
5. 改造 `HerdrClient`：
   - 保留通用 `agent_session`；
   - 保留 `terminal_id`；
   - 提供 `getAgentContext(paneId)`；
   - `getPiSessionPath()` 暂时作为兼容 wrapper。
6. 把当前 Pi 逻辑包装成 `PiTerminalAdapter`；尽量只移动装配，不重写 parser。
7. 给原有 HTTP 路由加 contract tests，证明响应与错误行为未退化。

出口条件：

- Pi 测试、typecheck、build 全通过。
- server 入口不再直接判断 Pi 才能读 Chat/prompt/cancel。
- 尚未启用 Devin UI 时，现有功能行为不变。

粗估：2–4 工程日。

### P2：泛化共享协议与 Web Chat

**目标：** 同一个 Chat view 能按 capability 渲染 Pi 与 Devin。

任务：

1. 扩展 `PaneSummary`：
   - `terminalId`
   - opaque session availability
   - Chat availability/capability summary
2. 将 `ChatSnapshot` 演进为通用 snapshot；保留旧字段过渡期兼容。
3. 把 `PiBridgeCapabilities` 移入 Pi adapter wire type，前端只消费通用 capability。
4. 将 `ChatView` 重命名/抽象为 `AgentChatView`：
   - 通用 fetch/prompt/cancel；
   - capability banner；
   - history coverage notice；
   - terminal-only interaction CTA；
   - provider-specific transport label 通过数据驱动，不写品牌分支。
5. 侧栏图标映射集中到 agent presentation registry；Devin 使用独立图标/字标，未知 agent 继续 Bot fallback。
6. WebSocket 增加 generic agent conversation event；Pi 旧事件可在 server 转换。

出口条件：

- Pi UI 快照/交互测试通过。
- 构造的 Devin partial snapshot 能正确显示 capability 降级。
- sessionKey 改变时不会把 optimistic message 带到新 session。

粗估：2–3 工程日。

### P3：Devin companion helper、安装器与 ingress

**目标：** 安全采集官方 hook 事件，不影响 Devin 主流程。

任务：

1. 创建 `integrations/devin/`：
   - 无重依赖 helper；
   - stdin JSON parser；
   - 环境检查；
   - event normalization；
   - spool/journal client；
   - 硬性 payload/timeout 上限。
2. 创建显式 installer：
   - 解析 JSON-with-comments 的策略需先确认；Devin config 支持 comments，不能直接用 `JSON.parse` 覆盖；
   - 使用保留格式的 JSONC 编辑或最小 AST patch；
   - 添加 Herzi 自有 hook command；
   - 不改 Herdr managed script；
   - 原子写、备份、status、uninstall。
3. 创建 integration credential：
   - 随机 256-bit；
   - 私有文件；
   - rotation；
   - 不进入日志/URL。
4. 新增 `POST /api/integrations/devin/events`：
   - token 校验；
   - schema/size 校验；
   - Pane + exact session id 校验；
   - batch idempotency；
   - 普通 logger 脱敏。
5. 新增 `EventJournal`：
   - append-only；
   - fsync 策略；
   - session 索引；
   - rotation/retention；
   - crash tail recovery；
   - corrupt record quarantine。
6. helper 网络失败时先安全 spool；后续 hook 或 server 启动负责 replay。
7. 单测 Windows path、Unix permission、配置已有用户 hooks、重复 install/uninstall。

出口条件：

- Herzi 未运行时 hook 在限定时间内退出，Devin 不受影响。
- 假事件无法跨 Pane/session 注入。
- 重复 batch 不生成重复 timeline。
- uninstall 只移除 Herzi 自有 entries。

粗估：3–5 工程日。

### P4：Devin projector 与实时合并

**目标：** 把 journal 变成稳定的通用 Chat timeline。

任务：

1. 新增 `devin/event-schema.ts`：
   - 仅校验已查证字段；
   - unknown fields 保留但不执行。
2. 新增 `devin/projector.ts`：
   - session/prompt turn index；
   - user optimistic reconciliation；
   - tool start/result；
   - permission notice；
   - Stop final assistant；
   - partial/unknown marker。
3. 稳定 id：
   - 有 upstream id 时直接 namespaced hash；
   - 无 id 时用 journal sequence；
   - 禁止仅用内容生成全局 id。
4. merge state：
   - journal revision；
   - in-order append；
   - out-of-order replace；
   - WS gap resync。
5. history coverage：
   - `none`
   - `since-integration`
   - `complete`（仅 ATIF 验证后）
6. `DevinTerminalAdapter.read()` 从 projector snapshot 返回通用模型。
7. integration missing/old/partial 诊断。

出口条件：

- fixtures 覆盖正常 turn、tool failure、permission、cancel、重复 Stop、乱序事件、session switch。
- server 重启后 snapshot 与重启前一致。
- 无 `last_assistant_message` 时不伪造空 assistant bubble。

粗估：2–4 工程日。

### P5：Prompt、Cancel、seen 与附件

**目标：** 完成可用闭环。

任务：

1. Prompt：
   - server 重新校验 adapter/session；
   - Herdr `agent.prompt`；
   - optimistic user message；
   - hook confirmation；
   - delivery timeout → unconfirmed。
2. Cancel：
   - working 与 blocked 使用 P0 验证后的不同按键策略；
   - 等待状态变化但不无限阻塞 HTTP；
   - 返回 `requested/confirmed/unconfirmed/no-active-turn`。
3. seen：复用 `agent.focus`，移除 Pi 假设。
4. 附件：
   - UploadStore 绑定从 `sessionPath` 泛化为 `sessionKey`；
   - Devin 只声明 `host-path`；
   - 保留 Pi native channel；
   - prompt marker/ledger 按 adapter 投影。
5. blocked UX：Chat 顶部和 composer 显示原因，一键切 Terminal。

出口条件：

- text prompt → user confirmed → working → tool → assistant final → done 全链走通。
- cancel 不退出 Devin process，不取消错误 Pane。
- host-path 附件不会被另一个 Pane/session 读取。

粗估：2–3 工程日。

### P6a：可选 SQLite 快照历史 bootstrap

**前置：** P0-DB 通过，且产品明确接受依赖未公开内部 schema 的维护成本。

任务：

1. 新增 `DevinDbLocator`，只在 agent host 的已知 data dir 查找 DB，不接受 browser 任意 path。
2. 新增 compatibility probe：exact CLI version、`refinery_schema_history` version/name/checksum、`app_state`、required columns 和 synthetic JSON variant allowlist。
3. 使用 SQLite Online Backup API 分页复制到 `0600` 临时文件；设置 busy timeout、总 deadline、crash cleanup 和原子 rename。
4. 只对完成的快照使用 `mode=ro&immutable=1`、`query_only=ON`、`trusted_schema=OFF`。
5. 按 exact session id 参数化查询，重建 main-chain message forest；未知 variant 生成 diagnostic 并 fail closed，不按 node id 平铺猜测。
6. DB history 只做 bootstrap/idle reconciliation；working/blocked 期间继续以 hooks journal 为实时来源。
7. UI 标记 `source=sqlite-snapshot`、`support=experimental-internal`；不能在验证前声明 `history=complete`。
8. 增加禁用/清理 Herzi snapshot cache 的动作，绝不删除 Devin 源库。

出口条件：

- 不展示 unreachable、reverted、hidden 或内部 agent message。
- tool、compaction、subagent 和 resume fixture 与 Terminal/ATIF 对照一致。
- active writer 下 backup 无可感知卡顿，所有 busy/upgrade/schema mismatch 安全降级。
- 关闭 `DEVIN_DB_HISTORY` 后完全回到 hooks-only，不影响 Devin runtime。

粗估：3–6 工程日；不是首期主链必需。

### P6b：可选 ATIF 历史增强

**前置：** P0 证明当前 ATIF 可稳定解析，且产品需要由 Herzi 创建 Devin session。

任务：

1. 新建 Devin action 时通过 Herdr `agent.start --kind devin ... -- --export <managed-path>`。
2. 记录 launch ledger，绑定 pane/terminal/session/export path。
3. 实现 replace-safe watcher 和 bounded parser。
4. 建立 hook journal ↔ ATIF step reconciliation。
5. Herdr restore 时确保自定义 export metadata 不丢；若 Herdr API 无法表达，明确把该限制写进 UI。

出口条件：

- 新建、多个 turn、server 重启、Devin resume、export atomic replace 均可恢复。
- 未知 ATIF schema 安全降级，不读取错误文件。

粗估：3–5 工程日；不是首期主链必需。

### P7：真实验收、灰度与文档

任务：

1. 自动验证：
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
2. synthetic E2E：
   - companion fixtures；
   - duplicate/out-of-order/restart；
   - payload/size/auth/path attack cases。
3. 专用真实 Pane：
   - fresh Devin session；
   - resume session；
   - tool success/failure；
   - permission block；
   - prompt while working；
   - cancel；
   - attachment fallback。
4. 兼容矩阵至少记录：
   - 当前 Devin stable version；
   - 当前 Herdr version/integration version；
   - macOS；
   - Linux 尽量用 CI synthetic 覆盖；
   - Windows 首期若无机器则明确未验证。
5. 更新：
   - `docs/development-log.md`
   - `docs/project-status.md`
   - 本方案状态与真实偏差
   - `docs/README.md`
6. 提供 install/status/uninstall/doctor 用户指南。

出口条件：

- 无 Pi 回归。
- 所有已承诺 Devin 主链在真实专用 Pane 通过。
- 所有未通过项保持未完成状态，不以“代码完成”代替真实验收。

粗估：2–3 工程日。

## 5. 总体排期

不含可选 ATIF 的单人粗估：

| 阶段 | 粗估 |
| --- | ---: |
| P0 验证 | 1–2 日 |
| P1 contract/adapter | 2–4 日 |
| P2 Web 泛化 | 2–3 日 |
| P3 bridge/installer/journal | 3–5 日 |
| P4 projector | 2–4 日 |
| P5 command/attachment | 2–3 日 |
| P7 验收/文档 | 2–3 日 |
| 合计 | **14–24 工程日** |

可选 P6a SQLite 快照 importer：再加 3–6 日；可选 P6b ATIF：再加 3–5 日。若 P0 发现 hook 字段不足，需要转 ACP，不能沿用此排期。

## 6. 测试设计

### 6.1 Contract tests

每个 adapter 共用测试套件：

- unsupported pane；
- identity pending；
- exact session key；
- read snapshot shape；
- prompt identity recheck；
- cancel capability；
- session replacement；
- capability honesty。

### 6.2 Devin event tests

至少覆盖：

1. 正常文本 turn。
2. assistant final 缺失。
3. 一个 tool 成功。
4. 一个 tool 失败。
5. 两个并行同名 tool。
6. PostToolUse 先于 PreToolUse 到达。
7. 重复 event/batch。
8. PermissionRequest 后 cancel。
9. prompt id 缺失。
10. session id 改变。
11. server 在半条 journal write 后 crash。
12. journal 超限/rotation。
13. token 错误、Pane 错误、session 错误。
14. malicious strings 不进入 shell、HTML 或日志。

可选 DB importer 另需覆盖：

- backup 遇到 `BUSY/LOCKED`、残留 WAL、源文件替换与 deadline；
- migration checksum/required column/JSON discriminant 不匹配时 fail closed；
- main chain、fork/revert、compaction、subagent 和 hidden session；
- 快照权限、crash cleanup、cache 清除不触碰源库；
- 禁止对 live DB 使用 immutable，禁止仅复制 `sessions.db`。

### 6.3 Pi 回归重点

- JSONL branch projection。
- realtime merge。
- tool result image。
- optimistic prompt 去重。
- native/fallback attachment。
- bridge command claim/ack。
- working/seen 状态。

### 6.4 Web tests

- Pi full capability 与 Devin partial capability 的同一 Chat UI。
- 无 streaming 时正确文案。
- blocked CTA 切 Terminal。
- history coverage banner。
- sessionKey 替换清除 optimistic state。
- unknown content block 安全占位。

## 7. 迁移与兼容策略

1. 第一版保留 `/api/panes/:paneId/chat|prompt|cancel`，减少前端和已有测试同时变化。
2. `PiSessionReader` 先包 adapter，不立即大规模移动文件。
3. generic WS 与 Pi realtime 可以并存一个版本；前端切换后再删除旧 envelope。
4. `hasChatSession` 先 deprecated，再由 `chatAvailability` 替代。
5. integration protocol 全部带版本；server 至少兼容当前与前一版本。
6. Devin companion 默认 feature flag 关闭；P0/P3 测试通过后只对已安装用户启用。
7. journal schema 只 append 新字段，迁移失败时保留旧文件并降级只读。
8. DB importer 使用独立 `DEVIN_DB_HISTORY` feature flag 和 exact fingerprint allowlist；CLI 更新后默认暂停而不是乐观解析。

## 8. Rollout 与回滚

### Rollout

1. `MULTI_AGENT_ADAPTERS=1`：只启用通用 registry，仍只注册 Pi。
2. `DEVIN_CHAT=1`：注册 Devin adapter，但 companion 可缺失。
3. 用户显式执行 Devin integration install。
4. synthetic/专用 Pane 验收。
5. 默认启用 Devin partial Chat。
6. SQLite history importer 使用独立 `DEVIN_DB_HISTORY` research flag，仅对通过 fingerprint 的版本开启。
7. ATIF 单独 feature flag。

### 回滚

- 关闭 `DEVIN_CHAT` 后 Devin Pane 回到 Terminal，不影响 Devin process。
- uninstall companion 只移除 Herzi hook，不移除 Herdr official integration。
- journal 保留或按用户确认删除；关闭功能不自动删历史。
- 通用 Pi adapter 出现回归时，可在过渡期切回旧 Pi route；回滚期结束后再删除旧路径。

## 9. 可观测性

仅记录无正文指标：

- adapter 选择成功/失败原因；
- hook batch count、bytes、latency、reject reason；
- event lag 与 journal size；
- snapshot replace/append/resync count；
- prompt submitted/confirmed/unconfirmed；
- cancel requested/confirmed；
- tool correlation uncertain count；
- schema/version incompatibility。

诊断页面允许用户主动导出脱敏 metadata；默认不包含 prompt/tool 正文、绝对路径、token 或 session id 原值。

## 10. 需要产品确认的事项

在开始 P1 前，应确认：

| 决策 | 推荐默认 | 不接受时的影响 |
| --- | --- | --- |
| 无 token streaming | 接受 | 改 ACP ownership |
| 旧历史不完整 | 接受并显示 coverage；可另启实验性 SQLite snapshot bootstrap | 若要求官方稳定且完整，只能 `--export`-only 新 session 或改 ACP |
| approval/question | Terminal-only | 改 ACP或等待上游 API |
| 图片 | host-path fallback | 改 ACP或等待上游 API |
| journal retention | 30 天 | 需选择更短/关闭持久化 |
| 自动配置 | 仅显式 install | 若禁止改 config，只能状态+输入 |
| ATIF | 第二阶段可选 | 若首期必需，增加 3–5 日和兼容风险 |

## 11. Definition of Done

首期只有同时满足以下条件才可标记完成：

- P0 真实字段和按键验证已有文档证据。
- 通用 adapter 已承载 Pi，Pi 无回归。
- Devin companion 安装、卸载和失败降级通过。
- 真实 Devin Pane 完成 prompt → working → tool → final → done。
- cancel 与 blocked Terminal fallback 通过。
- 自动测试、typecheck、build 全通过。
- docs 记录版本、命令、结果、限制与未验证平台。
- UI 不把 derived/partial history 标记为完整或 authoritative。

## 12. 推荐实施顺序

建议批准以下顺序：

1. 先做 P0，不直接重构。
2. P0 证明 final answer/tool payload 可用后，做 P1–P2。
3. 再做 P3–P5 完成 Devin 主链。
4. 稳定使用一段时间后，分别决定是否做 P6a SQLite snapshot bootstrap 与 P6b ATIF；两者使用独立 feature flag。
5. Codex 接入前复用 contract，但单独调研它的 terminal-backed read-only 边界，不复制 Devin hook adapter。

这种顺序把最大的不确定性放在 1–2 天的验证门，而不是完成两周开发后才发现 terminal-backed Devin 无法提供所需 transcript。
