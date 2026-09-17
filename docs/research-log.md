# 调研与工作日志

> 项目：Herzi（暂用工作目录名）  
> 目标：Herdr 的 GUI/Web 前端，先支持 pi coding agent，并逐步提供原始 TUI 与结构化 Chat View。  
> 所有日期采用本机时区（UTC+08:00）。

## 2026-09-03

### 15:04 — 建立文档规范

- 确认项目根目录最初为空，尚无代码、`docs/` 或项目级 `AGENTS.md`。
- 确认当前进程位于 Herdr 管理环境中：`HERDR_ENV=1`。
- 阅读 Herdr 操作技能说明，明确：
  - Herdr 具有 server/daemon、workspace、tab、pane、agent 等概念。
  - CLI 能列举和读取 pane/agent，提供文本或 ANSI 快照；控制面可发送 prompt、按键及等待状态。
  - `visible`、`recent`、`recent-unwrapped`、`detection` 是不同读取源。
  - alternate screen 中已经离屏的内容可能无法从 Herdr host scrollback 恢复；这对可靠 Chat View 是关键限制，需要结合 pi 的结构化会话数据或实时事件采集。
- 在根目录创建 `AGENTS.md`，加入硬性要求：所有过程文档必须进入 `docs/`。
- 创建 `docs/README.md` 文档索引及本日志。

### 待调研问题

1. Herdr 当前公开 CLI、IPC、server/session 协议与许可证分别是什么？GUI 应调用 CLI、链接内部库，还是通过稳定 socket API？
2. 是否能无损订阅 pane 的实时 PTY 输出、屏幕状态、尺寸和输入事件？
3. pi 的会话 JSONL 存储位置、schema、分支/compaction 语义以及实时写入行为是什么？
4. pi 是否有 extension/SDK 事件接口，可比“直接 tail JSONL”更稳地推送结构化 turn/tool/approval 状态？
5. 用户提及的“Moshi Desktop / Moshi Hook / Chat View”和“ORCA Chat UI”具体指哪些产品/仓库？公开资料是否足以验证实现细节？如名称存在歧义，报告必须明确标注。
6. 单进程本地 Web MVP 怎样同时支持原始 TUI、结构化 Chat View、输入与权限控制，并可平滑演进到 daemon + desktop client？

### 15:05–15:25 — 核查本机 Herdr 与官方接口

- 本机已安装 Herdr `0.8.2`，server 正在运行，socket protocol 为 `20`；默认 Unix socket 位于用户配置目录。只记录了 session 的名称/运行状态和协议元数据，没有读取任何 pane 输出或私人会话正文。
- `herdr api schema --output docs/herdr-api-schema.json` 成功导出安装版本自带的完整 JSON Schema（约 255 KB），作为后续协议实现的版本化依据。
- 官方 Socket API 文档确认：
  - 传输为本地 socket 上的 LF 分隔 JSON；Unix 使用 Unix domain socket，Windows 使用 named pipe。
  - `session.snapshot` 用于客户端冷启动；随后应订阅 workspace/tab/pane/layout/agent 等资源事件；重连后重新拉 snapshot。
  - API 支持 pane 读取/输入、布局控制、agent 状态和事件订阅，但普通资源事件不是逐字节 PTY 输出流。
  - 原始终端实时视图应使用 `herdr terminal session observe|control`：输出 `terminal.frame`（base64 ANSI bytes）与 `terminal.closed` JSONL；control 通过 stdin 接受 `terminal.input`、`terminal.resize`、`terminal.scroll`、`terminal.release`。同一终端可有多个 observer，但同一时间只有一个 controller，`--takeover` 会替换现有 controller。
  - 官方建议简单自动化先走 CLI，直接 socket 适合自定义协议客户端和长期订阅。Web MVP 适合“资源面走 raw socket；终端面先包装官方 terminal session CLI”，避免重写未单独稳定化的终端流传输。
- 官方集成文档确认 Pi 集成属于 lifecycle authority，并上报 native session identity；本机 `herdr integration status` 显示 Pi 集成已是 current（v8）。出于隐私，本次没有打开集成脚本或任何真实 Pi session 文件。
- Herdr 服务器重启后普通进程不会继续；可恢复布局。Pi 如有当前官方集成提供的 session reference，可用 `pi --session <path>` 恢复 agent 会话。实验性 pane history 默认关闭，因为其中可能含密钥、提示词和命令输出。

### 15:25–15:50 — 完整阅读相关 Pi 文档

- 按 pi 项目要求完整阅读主 README，以及 `sessions.md`、`session-format.md`、`extensions.md`、`sdk.md`、`rpc.md`、`json.md`、`security.md`。
- 当前本机 pi package 版本为 `0.84.4`。关键结论：
  - Session 默认是 JSONL v3，位于 agent dir 下的 `sessions/`，每个 entry 以 `id`/`parentId` 组成追加式树，而不是简单线性聊天；支持分支、label、compaction、branch summary 与 custom entry。
  - 直接 `tail` JSONL 只能看到**已持久化完成**的 entry，无法表现 token 级 streaming；Chat View 若要实时，必须同时接入 pi 的运行时事件。
  - Pi Extension 暴露 `message_start/update/end`、tool execution、agent lifecycle、UI prompt、session switch/shutdown 等事件，非常适合新增一个只负责向本地 bridge 推送结构化事件的伴随扩展。
  - Pi RPC mode 本身已是适合自定义 UI 的严格 JSONL 双向协议，支持 prompt/steer/follow-up/abort、消息和 entry 查询、session tree、工具流、extension UI 对话框等；但它通常由客户端**启动并拥有一个新的 pi 进程**，不等同于无侵入地接管 Herdr 中已经运行的交互式 pi。
  - Pi SDK 更适合从应用内创建并拥有 agent runtime；它也不应在 MVP 中替代 Herdr 已有 pane/进程的所有权，否则会形成第二套会话运行时。
  - 非交互 RPC 模式不会弹项目 trust UI；默认 `ask` 时会忽略未获信任的项目资源。未来若支持“由 GUI 新建 pi”，必须显式设计 trust 流程，不能偷传 `--approve`。
  - Pi/extension 与 coding tools 具有宿主用户权限，没有内建沙箱；Web bridge 绝不能默认监听非 loopback，也不能把原始文件读取能力暴露为通用 API。

### 当前技术判断（中间结论）

1. **已有 Herdr pi pane 的原始视图可行性高**：官方已有 snapshot、事件和终端 observe/control 流。
2. **已有交互式 pi 的结构化历史可行性高**：Herdr 的 `agent_session` 可给出 Pi session path，再使用 Pi 的 `SessionManager` 或兼容 parser 读取。
3. **已有交互式 pi 的结构化实时流可行，但需要桥接扩展**：单靠 Herdr pane ANSI 或 tail JSONL 不足；推荐一个 Pi extension 将 runtime events 发送给本地应用。
4. **Chat View 输入初期应继续交给现有 pane**：用 Herdr `agent.prompt`/受控终端输入，而不是同时用 Pi SDK/RPC 操作同一会话，避免双写和所有权冲突。
5. **GUI 需要明确降级模式**：无 Pi extension 时仍显示完整原始终端，并用 session JSONL 显示“最终一致”的历史；只有 extension 在线时提供 token/tool 实时结构化显示。

### 记录约定

- 后续每次文档/代码写入、关键命令验证和来源核查均在此追加。
- 不记录用户私人 agent 会话正文；实验只使用测试 session 或合成数据。

### 16:00–16:35 — 竞品与相邻架构调研

#### Moshi Desktop / `moshi-hook`

本节依据 Moshi 官方 Chat View、Hooks、Gateway 与 Chat View 排障文档，属于一手公开资料核实；未审计闭源移动客户端实现。

- `moshi-hook` 是运行在 agent 主机上的 companion daemon：管理 agent hook、接收本机 Unix socket 事件，并在 `127.0.0.1:24543` 提供 host gateway。移动应用通过既有 SSH 连接做本地端口转发，而不是让 gateway 监听公网。
- Gateway 将低敏感度上下文流与高敏感度 transcript 流拆开：
  - `/events` WebSocket 返回当前 terminal/multiplexer context、cwd、git、识别出的 agent/session 及 dev server；
  - `/v1/transcripts` WebSocket 在 session identity 已确定后返回 `backlog`，随后按完成的 JSONL 行发送 `append`。
- Chat View 的可用性链是三阶段：①识别当前 pane 的 agent；②通过 hook 把 pane 映射到该 agent 的准确 native session；③解析该 session 的 transcript path 并流式读取。官方明确拒绝用“最新修改 transcript”猜测 session，因为可能把另一段会话展示给用户。
- Chat View 是同一 PTY/session 的视觉层，而非第二个 agent 或协议接管：历史来自本机 transcript，composer、stop、可安全映射的 approval/question action 回到原 multiplexer pane；不能安全映射的交互明确要求切回 terminal。
- 其支持分层值得直接采用：Tier C 原始终端、Tier B agent-aware 状态、Tier A transcript-backed native chat。降级不是异常分支，而是产品能力模型。
- 隐私边界清楚：完整 transcript、diff 和 source file 留在 host 与 app 的 SSH-forwarded 直连通道；Moshi 云端只承载受限通知摘要和控制元数据。Herzi MVP 不需要云端，因此可采用更严格的全本地边界。
- Moshi 官方当前把 Pi 列为 Tier A，并允许 `/v1/transcripts?source=pi&session=...`；这证明“已有 multiplexer Pi + transcript Chat View”的产品路径已经有人实现，但其 Pi parser 和内部 wire schema未公开，不能直接视作可复用实现。

关键来源（访问：2026-09-03）：

- <https://getmoshi.app/docs/chat-view>
- <https://getmoshi.app/docs/hooks>
- <https://getmoshi.app/docs/debug-gateway>
- <https://getmoshi.app/docs/debug-chat-view>

#### Orca Chat UI

本节依据 Orca 官方文档、公开仓库 `stablyai/orca` 的 `src/main/native-chat/` 源码与相关 issue/PR，属于一手公开资料核实。

- Orca 的主要 Chat UI 同样是 terminal-backed：terminal 是 source of truth，Chat UI 是 transcript decoder + composer，并控制同一 PTY。
- 公开支持集合以源码为准：`NATIVE_CHAT_SUPPORTED_AGENT_LIST` 当前包含 Claude/OpenClaude、Codex、Grok、OMP；Pi 虽可作为普通 CLI agent 运行并支持 session history/resume，但**不在 terminal-backed native transcript decoder 集合中**。
- Orca 另有 runtime-owned structured Codex chat，只用于新建、本地、受支持平台的 Codex session；existing/remote/SSH session 仍走 terminal-backed Chat UI。这验证了应把“接管已有进程”和“应用拥有新 runtime”设计成两种模式，不能混为一谈。
- `src/main/native-chat/` 的工程实现显示可靠 transcript tail 远比一次 `tail -f` 复杂：
  - 优先使用 hook 报告的权威 `transcriptPath`，不存在时才按 agent/session ID 扫描；
  - 初次可读取完整或窗口化历史，后续按 byte offset 增量读取；不解析未以换行结束的半条 JSONL；
  - 对单条超大记录设置上限并跳过，以避免内存失控；批量 append 限制消息数；
  - `fs.watch` 只做加速，定时 reconciliation 才负责正确性；监听父目录以容忍原文件替换；
  - 检测 inode/identity、size、mtime 和边界 fingerprint，以识别 truncate、rotate、同尺寸重写；重写时 reset offset 并发 `replace` snapshot；
  - 首次 flush 尚未发生、文件短暂消失或被替换都按可重试状态处理，而不是永久 `not found`；
  - WSL/UNC I/O 单独做超时、并发 gate、abort、运行中 distro 探测和 backoff，避免挂死 Electron main process。
- Orca 对远端曾出现“desktop Native Chat 错读 client-local transcript”的公开缺陷，进一步证明 transcript resolver 必须运行在 session 所在主机，而不是默认运行在 GUI 主机。
- Orca 为 transcript 和 watcher 写了大量 unit/E2E race test（first flush、rotation、missed event reconciliation、unsubscribe race、WSL stall 等）；Herzi 实施计划应把这些场景纳入核心测试，而不是后补。
- Orca 许可证已核实为 MIT；只能在遵守许可证与 attribution 的前提下参考或复用代码。当前报告仅提取设计模式，没有复制实现。

关键来源（访问：2026-09-03）：

- <https://www.onorca.dev/docs/agents/native-chat>
- <https://raw.githubusercontent.com/stablyai/orca/main/src/shared/native-chat-agent-support.ts>
- <https://raw.githubusercontent.com/stablyai/orca/main/src/main/native-chat/session-file-resolver.ts>
- <https://raw.githubusercontent.com/stablyai/orca/main/src/main/native-chat/transcript-reader.ts>
- <https://raw.githubusercontent.com/stablyai/orca/main/src/main/native-chat/transcript-incremental-reader.ts>
- <https://raw.githubusercontent.com/stablyai/orca/main/src/main/native-chat/transcript-native-watcher.ts>
- <https://raw.githubusercontent.com/stablyai/orca/main/src/main/native-chat/transcript-watch-engine.ts>
- <https://github.com/stablyai/orca/issues/7404>
- <https://raw.githubusercontent.com/stablyai/orca/main/LICENSE>

#### Paseo 与 Webmux

- Paseo 是 daemon-owned agent runtime：本地 Node daemon 创建和管理 agent 进程，通过统一 WebSocket timeline 向 Expo/Electron/CLI 客户端提供结构化事件；Pi adapter 使用本地 Pi RPC process。它适合未来的“由应用新建 session”，不适合 MVP 无侵入接管已在 Herdr pane 中运行的 Pi。
- Paseo 可借鉴的部分是 protocol package、hello/capability negotiation、sequence/gap detection、authoritative catch-up、客户端 replica cache、背压与可选 E2EE relay；不应照搬其 agent ownership。
- Webmux 是 Bun + tmux + xterm.js 的本地 Web dashboard，证明单机单端口浏览器终端、worktree/task 列表与移动简化 UI可快速交付。它主要拥有 tmux/worktree 生命周期，结构化 transcript 深度弱于 Moshi/Orca。
- Webmux README/网站宣称 MIT，但截至本次核查仓库根目录没有 `LICENSE`，且存在对应公开 issue；因此在许可证澄清前不能复制其源代码，只能把公开行为当产品参考。

关键来源（访问：2026-09-03）：

- <https://raw.githubusercontent.com/getpaseo/paseo/main/docs/architecture.md>
- <https://github.com/getpaseo/paseo/blob/main/docs/providers.md>
- <https://raw.githubusercontent.com/getpaseo/paseo/main/LICENSE>
- <https://raw.githubusercontent.com/windmill-labs/webmux/main/README.md>
- <https://webmux.dev/docs/>
- <https://github.com/windmill-labs/webmux/issues/297>

### 16:35 — 竞品调研收敛结论

1. Herzi 的 MVP 应采用 Moshi/Orca 已验证的 **terminal-backed Chat View**，而非另启 Pi SDK/RPC runtime。
2. `pane → agent → exact session → transcript` 必须是显式身份链；无准确 session identity 时禁用 Chat View，不按 mtime 猜测。
3. 原始 terminal 始终保留并可一键切回；结构化 parser 缺失、延迟、未知 entry 或 action 无法安全回送时都要降级，不得伪装为完整支持。
4. transcript history 与 runtime live delta 是两条数据面：JSONL 负责权威持久历史，Pi companion extension 负责低延迟 token/tool/lifecycle；定期 JSONL reconciliation 修补 extension event 丢失。
5. filesystem watcher 只能作为延迟优化，正确性依赖 byte offset、完整行边界、replace/resync、周期 reconciliation 及 sequence 去重。
6. 单进程 MVP 也应保留 host-side adapter 边界。未来拆 daemon + desktop 或加 SSH host 时，Herdr socket、Pi transcript reader 和 Pi extension ingress 必须都迁到 agent 所在主机，浏览器/桌面端只消费 Herzi 协议。
7. 许可核查：Herdr 与 Paseo 为 Apache-2.0，Orca 为 MIT；Moshi 客户端实现未公开；Webmux 缺少根许可证文件。优先自行实现协议适配，避免不必要的代码复制。

### 本轮补充 — 上游源码复核与关键更正

为了区分公开文档描述和真实实现，本轮只克隆了官方公开仓库到系统临时目录，没有把第三方源码复制进项目：

- Herdr `herdrdev/herdr`，commit `94f6d9c0d9bb9cf9ffae99d8bbfb09e9bf2fc9e0`，Apache-2.0。
- Orca `stablyai/orca`，commit `968dbd905faa1c34b6b9fe181c6392d698fea632`，MIT。

复核结论：

- Herdr `src/client/terminal_sessions.rs` 确认 terminal stream 的 wire 细节：`terminal.frame` 包含单调 `seq`、`encoding=ansi`、`width/height`、`full` 和 base64 `bytes`；control 输入含 `terminal.input/resize/scroll/release`。server 的绘制编码器只在首帧、强制重绘或尺寸变化发 full，其余发 diff。因此浏览器发现 sequence gap 时必须重开 observer 取得 full frame，不能继续盲写 diff。
- 读取 Herdr **公开仓库中的** Pi integration 资产（不是私人 transcript）确认当前版本为 v8；它上报准确 session id/path 和状态，并处理 `session_start`、`agent_start`、`agent_settled` 等，但没有转发 message/tool delta。Herzi 应安装旁路 companion extension，不能编辑会被 Herdr 管理/覆盖的 `herdr-agent-state.ts`。
- 再次执行只读 `herdr integration status`：本机 Pi 为 current v8。命令还显示其他 agent integration 状态，但这些不属于 Pi-only MVP。
- Orca 当前源码支持的 Native Chat agent 列表不含 Pi；公开 issue #13185（2026-08-08）仍在请求 Pi Native Chat。此前“Orca 可作为 Pi Chat UI 成品参考”的表述需要收窄：它可作为 terminal-backed 架构、watcher 和失败案例参考，不能作为可直接复用的 Pi adapter。
- Orca issue #13716 记录同一 transcript 被两个 live process 使用的 ownership 缺陷；#11761 记录交互问题状态传播缺口；#11511 记录 PTY 写入失败后乐观消息仍显示的问题。这些分别支持“禁止第二 runtime”“无法映射时回 Terminal”“发送状态需 unconfirmed”的决策。

新增一手来源（访问：2026-09-03）：

- <https://github.com/herdrdev/herdr/blob/master/src/client/terminal_sessions.rs>
- <https://github.com/herdrdev/herdr/blob/master/src/integration/assets/pi/herdr-agent-state.ts>
- <https://github.com/stablyai/orca/blob/main/src/shared/native-chat-agent-support.ts>
- <https://github.com/stablyai/orca/issues/13185>
- <https://github.com/stablyai/orca/issues/13716>
- <https://github.com/stablyai/orca/issues/11761>
- <https://github.com/stablyai/orca/issues/11511>

### 本轮补充 — Pi session leaf 与只读副作用核查

本轮完整检查本机 Pi 0.84.4 的公开 package 源码/类型及 extension 文档，没有打开任何真实 session 文件。

- `SessionManager` 加载文件后默认把最后一个 entry 设为 `leafId`；每次追加 entry 又推进 leaf。
- `/tree` 导航调用 branch 行为时，可以只改变进程内 `leafId` 而不立刻追加 entry。因此只读 JSONL watcher 在“导航后、下一次追加前”不能绝对知道活跃分支。
- Pi 的 `session_tree` extension event 明确提供 `newLeafId/oldLeafId`，所以 companion extension 应把该事件作为活跃分支的运行时权威；无 extension 时 UI 必须标注最终一致限制。
- `SessionManager.open()` 在旧版本 session 迁移时会 `_rewriteFile()`。即使其读取 API 很好用，把它直接用于旁观活跃 session 仍可能改变用户文件。Herzi MVP 决定实现隔离的只读 parser，并用 Pi fixtures 对齐 tree/compaction 语义。
- `agent_end` 不是最终空闲：Pi 仍可能 retry、compact 或执行 queued follow-up；状态集成必须用 `agent_settled` 收口。

### 本轮交付 — 形成报告、计划与 ADR

- 新增 `docs/feasibility-and-architecture-report.md`：需求边界、事实基线、竞品比较、可行性、推荐架构、协议/组件、安全、一致性、演进路线、风险和来源。
- 新增 `docs/implementation-plan.md`：M0–M6 里程碑、验收标准、测试矩阵、性能预算、诊断与文档工作流。
- 新增 `docs/decisions/0001-terminal-backed-local-web-mvp.md`：正式记录 terminal-backed、单 runtime 所有权与本地单进程 Web MVP 决策。
- 保留 `docs/herdr-api-schema.json` 作为 Herdr 0.8.2 / protocol 20 的版本化输入。
- 根 `AGENTS.md` 已满足用户要求，无需重复或改写；更新 `docs/README.md` 索引状态。

### 本轮验证

- `find . -maxdepth 3 -type f` 确认项目过程文件只存在于根 `AGENTS.md` 和 `docs/`；尚无产品代码。
- `jq empty docs/herdr-api-schema.json` 通过，基线 schema 是有效 JSON。
- 检查报告、计划、ADR 的标题层级与索引路径；未发现待创建占位或误写文本。
- 当时交付共 1,237 行 Markdown（含根 `AGENTS.md` 与既有日志，不含 JSON schema）；后续计划已按新的产品要求精简。

### 产品要求调整 — 功能优先、精简测试

用户指出原 M0–M6 计划防备性过强，过多异常测试和手写合成数据可能影响初期开发效率。经确认，这一判断适合当前从零验证产品价值的阶段，计划作如下调整：

- 用 P0–P3 在约 8–15 个工程日内先完成真实 Herdr 连接、Terminal、Pi Chat history 和输入闭环。
- 第一版以专用的真实 Herdr/Pi 开发 session 做手工验证，只给少量纯函数保留单元测试和一条端到端冒烟流程。
- 删除首版的大规模合成 fixtures、watcher 竞态矩阵、跨版本矩阵、压力测试与 Windows/WSL 专项要求。
- 大 transcript、完整 replace/reconcile、多浏览器控制权和复杂 Pi entry 改为真实使用遇到后处理。
- 保留三个低成本底线：不创建第二个 Pi runtime、默认只监听 loopback、浏览器输入不拼接 shell。

同时澄清 Pi 插件策略：

- 第一版不需要新增 Herzi 插件；现有 Herdr Pi integration 已会上报 agent、状态和 exact session path，足以实现完成消息的 JSONL Chat View。
- token/tool/current branch 的低延迟体验作为可选 P4，届时再安装独立 `herzi-bridge.ts`；不得修改 Herdr 管理的 integration 文件。

第一版技术路线同步收敛为：Node.js 22 + TypeScript + Fastify + 单 WebSocket；React + Vite + Tailwind CSS + xterm.js；Pi JSONL 用 Node `fs` 只读并先做整文件刷新；pnpm 单 package。Web 版本稳定后如需桌面壳，优先 Electron 以复用 Node host，暂不引入 Tauri/Rust。

### UI 参考图与组件生态调研

用户明确要求参考 Moshi 截图中的两个主要交互：右上角 `Terminal / Chat` segmented control，以及左侧完整 Herdr Workspaces 导航。

对截图的结构化观察：

- 左侧是 workspace/session 树，选中项使用浅蓝背景，working/unread 使用小状态点；底部是 host/connection/settings。
- 主区顶部展示 pane/session 标题和少量 metadata，模式切换固定在右上；Terminal 与 Chat 共用同一 pane。
- Chat 不是大量社交气泡：assistant 是宽幅文档流，thinking 弱化，tool call 使用紧凑可折叠卡片，composer 固定在底部。
- 右侧窄工具 rail 可用于未来文件/diff/context，但不属于 MVP。

组件库查证结论：

- shadcn/ui 的 Sidebar 已提供 group、submenu、active、badge、collapsible、rail 和 CSS variable theming，适合作为 Workspace 树与应用基础组件；源码进入项目，MIT。
- assistant-ui 官方支持 Vite，并提供 External Store Runtime，明确允许应用自己持有 message/thread/persistence；其 Message primitives、Tool fallback/UI、Reasoning 和 Composer 可适配 Herzi 外部 Pi 数据，MIT。
- AI Elements 的 Message/Tool/Reasoning/Prompt Input/IDE 示例非常接近目标视觉，且为 Apache-2.0；但官方前置条件偏 Next.js + AI SDK + React 19 + Tailwind 4，Tool 类型也绑定 AI SDK。因此不整体引入，只作为视觉/独立源码组件参考。
- 主 Terminal 必须继续使用 xterm.js 6；AI Chat 库中的 Terminal output card 不能替代完整终端模拟器。
- MUI/Ant Design 虽完整，但默认 Material/企业后台风格较强，定制到参考图成本更高。

最终 UI 栈建议更新为 React 19 + Vite + Tailwind CSS 4 + shadcn/ui + assistant-ui External Store Runtime + xterm.js + lucide-react。新增 `docs/ui-research-and-direction.md` 保存完整分析、组件边界、页面结构、tool renderer 和一手来源。

### assistant-ui 选型深化与同类方案比较

进一步核对 assistant-ui External Store、Message、ToolFallback、Tool UI 与 runtime 文档：

- External Store 支持自有 messages、converter、`isRunning`、`onNew/onCancel`，UI feature 按 callback/capability 开启，符合 Herzi 持有 Pi/Herdr 状态的前提。
- ToolFallback 是现成可修改的 shadcn 组件，覆盖 args、result、error、cancel、approval 与 streaming lifecycle；可按 tool name 注册专用 renderer，并用 toolCallId 关联 result。
- External Store 的 client tool invocation tracker 默认关闭。Herzi 必须保持关闭，只渲染 Pi 已执行的工具，避免浏览器重复执行。
- assistant-ui 已发布 `@assistant-ui/react-pi`，但其 Node client 通过 Pi SDK 在进程内拥有 AgentSession/thread；这适合新建 Pi runtime，不适合 attach Herdr 已有进程。Herzi 仍选通用 `@assistant-ui/react` External Store。
- 代价是需要 message converter，且上游 API 演进较快；应锁版本，并保留“半天真实接入不顺则退回自有 message list”的快速退出条件。

同类方案对比补充：AI Elements 偏 Next/AI SDK；CopilotKit 偏 AG-UI/full-stack agent frontend；LlamaIndex Chat UI 示例偏 AI SDK `useChat`；Chatscope/NLUX 更偏通用 Chat/LLM adapter，缺少与 Herzi 同样合适的外部状态 + coding tool parts 组合。

### 首个 Alpha 实施与本地协议复核

2026-09-03 17:30–18:00 CST 开始按精简计划实现。完整变更、命令、验证与已知限制见 [`development-log.md`](./development-log.md)。本轮对前期调研作出以下实现级确认或修正：

- 真实 `terminal.frame` 的 `encoding` 值为 `ansi`；帧的 `bytes` 字段仍是 base64 字符串。实现应无条件按协议解码 `bytes`，不能判断 `encoding === "base64"`。
- 从真实 Pi JSONL 的字段形态确认首版需要处理 `session`、`model_change`、`thinking_level_change`、`message`；message role 包含 `user`、`assistant`、`toolResult`，content 包含 `text`、`thinking`、`toolCall`、`image`。检查脚本只输出字段名与类型，没有输出正文或 path。
- tool result 是单独的 `toolResult` message，通过 `toolCallId` 与 assistant content 中的 toolCall 配对。服务端已在投影时完成合并。
- `@assistant-ui/react` 本身导出 tool-call 数据模型、renderer slot、状态与 props，但不直接导出一套带视觉样式的 `ToolFallback` 成品；官方 starter/CLI 展示的是复制进项目后修改的 UI 源码。Herzi 因而保留 assistant-ui runtime/primitives，自行实现目标视觉的紧凑 tool card。
- 使用 External Store Runtime 的真实类型检查通过，并保持 client tool invocation tracker 关闭。这验证了它可以在不创建第二个 Pi runtime 的前提下消费 Herzi 自有消息。
- 为减少首版连接协议，资源快照与 Terminal 走 WebSocket，Chat History 暂时走带缓存的 1.5 秒 HTTP 轮询；后续 companion extension 出现时再统一增量消息。
- 实现 Terminal control 前再次读取 Herdr 官方 `terminal_sessions.rs`：control CLI 从 stdin 接收 LF JSON，`terminal.input` 二选一接受 `text` 或 base64 `bytes`，`terminal.resize` 接受 `cols/rows`，`terminal.release` 映射 detach。Alpha 据此使用显式按钮申请、不自动 takeover，并在断线/切换时释放。来源：<https://github.com/herdrdev/herdr/blob/master/src/client/terminal_sessions.rs>（访问：2026-09-03）。

### Terminal 交互方向调整

用户实际试用后明确要求 Terminal 默认可输入，并指出控制切换器竞态、顶部 Term/Chat 控件拉伸和上下滚动未适配。当前产品结论取代早期“显式按钮申请”的交互设计：

- Terminal View mount 后直接申请 control，UI 不再暴露启用/释放按钮；不使用 `--takeover`，失败时自动回退只读 observer。
- wheel 必须走 Herdr `terminal.scroll`，不能只移动 xterm 本地 scrollback；输入、resize、scroll 都复用同一个 control child stdin。
- header 使用 Flex 明确分配“可收缩标题 + 固定宽 segmented control”，避免隐藏 sidebar button 后的 Grid 自动放置改变列归属。

### 21:20–21:45 — 连接、尺寸与多客户端焦点复核

- 审计当前实现确认 Herzi 使用混合连接：`herdr status server --json` 发现 socket；资源快照和 agent 命令走 LF JSON raw socket；实时 Terminal 走 `herdr terminal session control|observe` CLI stream。
- 当前 HerdrClient 尚未订阅 `events.subscribe`，而是每 1.5 秒轮询 `session.snapshot`；这是 Alpha 的简化，不应在说明中误写成已经增量订阅。
- xterm.js `FitAddon` 把浏览器容器像素尺寸换算为 cols/rows；初始通过 `--cols/--rows`，后续 control resize 通过 stdin `terminal.resize` 传给 Herdr。server clamp 为 20–400 列、5–200 行。
- readonly fallback 只在建立 observer 时传一次尺寸；之后 ResizeObserver 只 fit 本地 xterm，未重建 observer。这可能造成只读窗口 resize 后短暂尺寸不匹配，记录为现有缺口。
- 本机 0.8.2 / protocol 20 schema 的 `SessionSnapshot` 只有单个 `focused_workspace_id`、`focused_tab_id`、`focused_pane_id`。Herdr 官方文档说明 persistent session 是 shared view，不是 tmux 式 per-client navigation；官方 discussion #651 的 stock Herdr 实测也确认 focus/API view/size 不是 per-client。
- Herzi 没有调用 `pane.focus`：浏览器侧栏只更新本地 `selectedPaneId`，初始或选中 Pane 消失时才用 snapshot `focusedPaneId` fallback。Chat 和 Terminal 始终使用明确 Pane ID，因此不依赖 global focus。
- Terminal focus 与 controller ownership 不是同一概念。多个 observer 可以共存，同一 terminal 只有一个 controller；当前 Herzi 默认申请且不传 `--takeover`，失败后回退只读。
- 完整说明新增为 [`herdr-backend-connection-and-focus.md`](./herdr-backend-connection-and-focus.md)。
- 变更和验证细节见 [`development-log.md`](./development-log.md)。

### P4 实时 bridge 的本机 API 复核

2026-09-03 继续对本机 Pi 0.84.4 安装包的 `docs/extensions.md`、`dist/core/extensions/types.d.ts`、`pi-ai/dist/types.d.ts` 和 `agent-session.js` 做只读核对：

- `message_update` 提供累积的完整 assistant message，可直接投影为 assistant-ui external message；extension 不必自己拼 provider-specific delta。
- `tool_execution_start/update/end` 提供稳定的 `toolCallId`、tool name、arguments、result 和 error，可与 JSONL toolCall 使用同一 id 合并。
- `agent_end` 后仍可能 retry/compact；实时 idle 必须以 `agent_settled` 收口。阻塞式 extension UI 另有 `ui_prompt_start/end`。
- `session_tree` 提供 `newLeafId`。它补足了 JSONL append-only 文件无法表达纯内存 leaf 导航的缺口。
- Pi 源码注释和调用顺序确认 `message_end` 先于 session persistence；实现因此在消息结束后上报“恢复跟随最新 entry”，而不是猜测新 leaf id。
- 本机 Herdr integration 源码确认 Pane id 由 `HERDR_PANE_ID` 注入，session path 来自 `getSessionFile()`；Herzi bridge 复用同一事实来源但保持为独立 package。

这些结论已落实到 [`pi-realtime-bridge.md`](./pi-realtime-bridge.md) 与 P4 代码。没有打开或记录真实 session 正文。

### Codex activity UI 参考核对

- 用户提供的 Codex macOS 截图显示：完成 turn 用 `Worked for …` 作为 activity 总摘要；关闭时隐藏工具/思考列表，展开时显示多条轻量 action；运行态在底部持续显示动态指示。
- 检索 OpenAI 官方 Codex/Developer 文档，没有找到客户端折叠阈值、摘要命名或 `Worked for` 私有判断算法的公开说明。
- OpenAI Responses API 公开 schema 确认 response 有 `created_at`、完成后有 `completed_at`，并保持 output item 顺序。它只用于验证时间与有序 item 的通用数据模型，不作为 Codex UI 私有算法的证据。来源：<https://developers.openai.com/api/reference/cli/resources/responses/methods/create>（访问：2026-09-03）。
- 产品决策：基于截图实现可解释的本地规则——user→assistant turn 边界、最后 text/image 为最终输出边界、此前全部 assistant parts 默认折叠、相邻 tools 分组；普通过程消息在展开区完整渲染，只有 thinking/tool 摘要做本地单行截断，不新增模型调用。
- 详细规则、实现与真实只读验证见 [`chat-activity-ui.md`](./chat-activity-ui.md)。
## 2026-09-04：Herdr `done` / seen 语义复核

- 用户描述的 `down` 实际对应 Herdr AgentStatus 的 `done`。本项目归档的 protocol 20 schema 正式枚举仍为 `idle / working / blocked / done / unknown`，不存在 Agent `down`。
- Herdr 官方 CLI reference 与 Agent automation 文档一致说明：`done` 是已完成但所在 Tab 尚未被查看，`idle` 是 ready 且已 seen；聚焦 Tab 或以 `pane.focus / agent.focus` 定位目标会标记 seen，CLI read 不会。
- protocol 20 暴露 `agent.focus` 和 `pane.focus`，没有独立的 acknowledge/mark-seen 请求。因此 Herzi 如需遵循原生已读语义，必须接受 session-global focus 同步变化这一副作用。
- 官方状态视觉语义为 `blocked` 红、`working` 黄、`done` 蓝、`idle` 绿；Herzi 为降低侧栏噪声按用户要求隐藏 idle、unknown 和未识别状态，只保留前三种关注态，并为本地兼容的 waiting/error/down 分色。
- 一手来源（访问日期 2026-09-04）：[Herdr CLI reference](https://herdr.dev/docs/cli-reference/)、[Agent automation](https://herdr.dev/docs/agent-automation/)、[Concepts](https://herdr.dev/docs/concepts/) 与 [`herdr-api-schema.json`](./herdr-api-schema.json)。
- 当前线程不在 Herdr 环境中，未使用 CLI 或 socket 操作真实会话；实现判断来自官方资料、skill 与版本化 schema。

## 2026-09-14：Herdr 侧边栏隐藏配置核查（只读）

用户要求检查本机 herdr 配置，并联网调研"侧边栏不显示"的配置方法；本次明确不做任何改动。

### 本机现状（只读检查）

- 二进制 `~/.local/bin/herdr`，版本 0.8.2（stable 通道），client/server protocol 20 兼容，`herdr config check` 通过。
- 配置文件位于 `~/.config/herdr/config.toml`（mtime 2026-09-14 16:07），当前内容：
  - `onboarding = false`
  - `[ui] sidebar_start_collapsed = true`（启动即折叠侧边栏）
  - `[ui] sidebar_collapsed_mode = "compact"`（折叠时仍保留窄条状态栏）
  - `[terminal] default_shell = "/opt/homebrew/bin/fish"`
- 即当前已是"启动折叠"，但折叠模式为 `compact`，侧边栏并未完全消失。

### 联网调研结论（官方 stable 0.9.0 文档）

- Config reference 确认两个键（来源：<https://herdr.dev/docs/config-reference/>，版本化源 <https://raw.githubusercontent.com/herdrdev/herdr/v0.9.0/docs/next/website/src/data/config-reference.json>，访问 2026-09-14）：
  - `ui.sidebar_start_collapsed`（boolean，默认 false）："Start Herdr with the sidebar collapsed. Changes take effect on the next launch."（下次启动生效）
  - `ui.sidebar_collapsed_mode`（enum `compact | hidden`，默认 `compact`）：`compact` 保留窄条状态栏，`hidden` 为零宽度、完全隐藏，可用 `toggle_sidebar`（默认 `prefix+b`）重新打开。
- Configuration 文档 "UI and sidebar" 章节指向 Config reference；并说明 sidebar 等呈现类设置属于 client 本地配置，`herdr server reload-config` 可热加载大部分 UI 设置，启动类设置仍需重启（来源：<https://herdr.dev/docs/configuration/>，访问 2026-09-14）。
- `hidden` 模式的需求出处：GitHub Discussion #842 "Option to fully hide the collapsed sidebar"（<https://github.com/herdrdev/herdr/discussions/842>）；`sidebar_start_collapsed` 的需求出处为 Discussion #848。两个键在本机 0.8.2 的 `herdr --default-config` 输出中均已存在，无需升级即可使用。

### 结论（未执行）

要把侧边栏完全不显示，只需把 `sidebar_collapsed_mode` 由 `"compact"` 改为 `"hidden"`（当前配置已是 collapsed 启动，`sidebar_start_collapsed` 无需再动）；修改后可 `herdr server reload-config` 或重启会话生效。本次遵照用户要求未做任何改动。

## 2026-09-14：追查 `~/.config/herdr/config.toml` 16:07 变更来源

用户询问当天 16:07 是谁修改了 herdr 配置文件。经只读取证，结论如下。

### 结论

- **直接修改者：moshi-hook 0.3.22（Moshi 桥接守护进程）**。当天 16:04 用户 `brew upgrade moshi-hook`（0.3.10→0.3.22，fish 历史可查），16:05:15 新版守护进程启动。16:07:05.962 用户从 Moshi 客户端 attach herdr（hook.log 记录 `gateway pty: client attached pid=57975`），触发其内嵌脚本：用 perl 原地改写 `config.toml` 中的 `sidebar_collapsed_mode`（此次写入 `"compact"`）→ `herdr server reload-config`（服务端日志 16:07:06.228）→ exec attach。
- **16:07:06 的"创建时间"是假象**：moshi-hook 的 perl 以临时文件+rename 方式写回（`-pi`），会重置 APFS birth 时间（已用 /tmp 实验验证；对照：本会话 16:19:45 用编辑工具原地修改后 birth 保持 16:07:06 不变）。文件本体及其中的中文注释在 16:07 之前就已存在（原始作者无法从现有日志确定，早于本次追查窗口）。
- 关键佐证：moshi-hook 二进制内嵌脚本头注释 *"Set the shared collapsed rail presentation, reload, then attach"*、*"Keep other sections, comments and permissions intact"*——解释了为何中文注释、644 权限、其余内容全部保留；脚本只管 `sidebar_collapsed_mode` 一个键（不含 `sidebar_start_collapsed`/`onboarding`/`default_shell`，二进制中也无中文）。
- 排除项：本 pi 会话 16:07:25 才启动（晚于文件变更 19 秒，pid 58794）；16:07:06 时无任何其他 coding agent 在运行（今日 pi 会话最早 16:07:25，claude/codex 无当日会话记录）；herdr 二进制无中文文本；VS Code/Cursor/Windsurf 本地历史无此文件；fish 历史无手动编辑命令。
- **影响与提醒**：moshi-hook 在每次从 Moshi 端 attach herdr 时都会执行该脚本，把 `sidebar_collapsed_mode` 设为 Moshi 应用侧当前偏好（当日三次 attach 对应 16:05:50 / 16:06:36 / 16:07:06 三次 reload_config）。因此本会话 16:19:45 手动改成的 `"hidden"`，下次从 Moshi 连接 herdr 时可能被改回 `"compact"`；如需稳定保持完全隐藏，应在 Moshi 应用内的对应设置（hide sidebar）里切换，而不是只改本地 config.toml。

### 证据来源

- fish 历史（~/.local/share/fish/fish_history，带时间戳）
- herdr 服务端日志 ~/.config/herdr/herdr-server.log（reload_config / client connected / agent changed）
- herdr 客户端日志（pid 57975 启动时间）
- Moshi 守护日志 hook.log 与 /opt/homebrew/var/log/moshi-hook.log（pty attach/detach、daemon 启动、hooks 更新）
- moshi-hook 0.3.22 二进制 strings 提取的内嵌 bash+perl 脚本；brew 缓存 9 月 13 日旧版 tar.gz 对照（旧版无该功能）
- APFS birth 时间实验（perl -pi 重置 birth；编辑工具原地写不重置）

## 2026-09-15：Chat 图片粘贴方案调研

### 当前项目审计

- 当前 Git 基线为 `a2a2d17`，工作树在调研开始时 clean；本轮没有读取真实 Pane、Pi transcript 或用户图片。
- `src/server/pi-session-reader.ts` 和 shared `ChatPart` 已支持展示 Pi JSONL 中的 image content；缺口主要在输入侧。
- `ChatView` 的 assistant-ui External Store 没有 attachment adapter，`ComposerPrimitive.Input` 因 capability=false 不会接收 clipboard file；`onNew` 和 optimistic reconciliation 也都只处理文本。
- Herdr protocol 20 的 `agent.prompt` 只有文本字段；现有 prompt HTTP API 同样只有 `{text}`。
- companion bridge 当前只有 Pi 到 Herzi 的 event POST，并把 live image 暂时转换为 `[image]`，没有向同一 Pi runtime 下发结构化 user message 的能力。

### 一手资料结论

- Moshi 的 Image and file paste 文档确认其把手机图片/文件通过 SCP 写到 agent 主机的 `~/.moshi/uploads/`，再把宿主路径附到 Chat composer 或插入 Terminal。这是 terminal-backed 模式的可靠 fallback。
- Moshi Chat View 文档确认 Pi 属于 Tier A，Chat composer 可 attach image，且 prompt 仍进入同一个 multiplexer session；其闭源内部 Pi 图片 wire format未公开，本轮没有推断。
- Orca Native Chat 文档确认 updated structured Codex chat 支持 clipboard 图片、发送前缩略图/移除/大图预览和 draft 重连恢复；terminal-backed Chat 只在 host capability 支持时提供 attachment。当前 `main` 的 terminal-backed transcript agent 列表不含 Pi，因此 Orca 只作为 UX/生命周期参考。
- Pi 0.84.4 README 和本机 interactive-mode 源码确认 Ctrl+V 会读取宿主剪贴板、写入 `os.tmpdir()/pi-clipboard-<uuid>`，再把路径插入 editor；Pi `read` tool 会把该路径中的图片作为 tool result image 交给视觉模型。
- Pi 0.84.4 extension API 的 `pi.sendUserMessage()` 可以向现有 runtime 发送 text + image，并正式进入 session。该版本 `session-format.md`、`pi-ai/dist/types.d.ts` 和 runtime 实现都使用 `{type:"image", data, mimeType}`；`extensions.md` 一处示例使用 `source`，与同版本实现不一致，后续必须按安装类型编译并做真实冒烟。
- assistant-ui 0.15.17 的 `ComposerPrimitive.Input` 已内建 clipboard file 处理；只需给 External Store 配置 `adapters.attachments`，并渲染 attachment primitives。attachment send 失败会恢复 draft，适合复用。

### 技术决策

- 推荐采用“Pi bridge 原生 image content 为主、Moshi/Pi 式宿主文件路径为 fallback”的双通道，不创建第二 runtime。
- 前端使用 assistant-ui attachment adapter；服务端使用 multipart + opaque uploadId + 受管 UploadStore；bridge v2 通过 heartbeat/capability + long poll command 调用 `pi.sendUserMessage()`。
- 旧 bridge/无 bridge 通过现有 Herdr `agent.prompt` 发送用户文本和受管路径，并用同 Pane/session ledger 恢复 Chat 中的附件显示。
- 禁止 base64 文本 prompt、修改系统剪贴板、直接写 Pi JSONL和另起 Pi RPC/SDK。
- multipart 引入跨站提交面，Origin/Host/CSRF guard 是实施前置；图片、base64、正文与绝对路径不得进入普通日志。

### 交付

- 新增 [`image-paste-implementation-plan.md`](./image-paste-implementation-plan.md)，包含范围、现状、竞品、方案对比、端到端架构、API、状态机、安全、测试、文件清单、排期、验收与风险。
- 更新 [`README.md`](./README.md) 文档索引和当前结论。
- 本轮只形成研究和方案，未修改产品代码、未安装或 reload Pi extension、未执行写入式 prompt。

来源（访问日期 2026-09-15）：

- <https://getmoshi.app/docs/chat-view>
- <https://getmoshi.app/docs/image-paste>
- <https://getmoshi.app/docs/hooks>
- <https://www.onorca.dev/docs/agents/native-chat>
- <https://github.com/stablyai/orca/blob/main/src/shared/native-chat-agent-support.ts>
- <https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent>
- <https://www.assistant-ui.com/docs/ui/Attachment>

## 2026-09-15：Herdr Git worktree 能力梳理

### 触发与范围

- 用户要求详细介绍 Herdr 的 git worktree 相关内容。本轮为**只读调研**：未创建、打开或删除任何 worktree，未修改产品代码，未读取任何 pane 输出或私人会话正文。

### 一手核查过程

- 确认运行环境：`HERDR_ENV=1`，`herdr 0.8.2`（client/server 同版本），socket protocol 20，stable 渠道。
- 用 `herdr worktree`（无子命令）取得该版本的真实用法；用 `herdr api schema --output` 重新导出协议 schema，并抽取 `WorktreeCreateParams` / `WorktreeOpenParams` / `WorktreeRemoveParams` / `WorktreeListParams` / `WorktreeInfo` / `WorktreeSourceInfo` / `WorkspaceWorktreeInfo` 及 `worktree_*` 事件与响应结果定义。
- 用 `herdr --default-config` 取得 `[worktrees] directory`、`keys.new_worktree`（默认 `prefix+shift+g`）与 `open_worktree`/`remove_worktree`（默认未绑定）的真实默认值。
- 在二进制字符串中核实错误码与 UI 文案（`dirty_worktree_requires_force`、`not_linked_worktree`、`ambiguous_worktree_branch`、`worktree_operation_in_progress`、`stale_worktree_operation`、`confirmation_required`、`Close worktree group?`、`Delete worktree checkout?`、`─ no matching worktrees` 等）。
- 只读执行 `herdr worktree list` 与 `herdr workspace list`，记录实际 JSON 形状；确认当前工作目录为普通 checkout，`WorkspaceInfo.worktree` 在非 worktree workspace 上被省略而非置 null。

### 关键结论

- worktree 不是新容器类型，而是"带 Git provenance 的普通 workspace"，创建后与父仓库 workspace 组成 sidebar 的 Space / worktree group。
- `worktree create` 命中已有本地分支则 checkout，否则从 `--base`（缺省 `HEAD`）新建；不给 `--path` 时落在 `<worktrees.directory>/<repo>/<branch-slug>`（`branch-slug` 规则未查证）。
- `worktree remove` 只执行 `git worktree remove`，**从不删除分支**；脏 checkout 需 `--force`。
- `worktree.create` / `worktree.remove` 是异步的，存在 `worktree_operation_in_progress` 与 `stale_worktree_operation`。
- **版本差异已核实**：官方文档描述的 `--trust-repository`、`workspace close --group`、`close_group` 在本机 0.8.2 二进制中不存在（`strings` 逐项确认为 NO）；本机 `release-notes.json` 记录的是 0.9.0 内容，不可当作当前行为。
- 已知缺陷：issue #2952 报告 linked worktree 的 builtin `branch` 侧栏 token 为空（0.8.0 报告，本机 0.8.2 未复现验证）。

### 交付

- 新增 [`herdr-worktree.md`](./herdr-worktree.md)：概念模型、CLI 契约、数据模型、事件、错误码、分组关闭语义、TUI 入口、配置、与 Herzi 的关系、未查证清单与来源。
- 更新 [`README.md`](./README.md) 文档索引与当前结论。

来源（访问日期 2026-09-15）：

- 本机：`herdr --help` / `herdr worktree` / `herdr --default-config` / `herdr api schema` / `herdr worktree list` / `herdr workspace list` / `/Users/chiyizi/.local/bin/herdr` 字符串 / `~/.config/herdr/release-notes.json`
- <https://herdr.dev/docs/cli-reference/>
- <https://herdr.dev/docs/socket-api/>
- <https://herdr.dev/docs/config-reference/>
- <https://github.com/herdrdev/herdr/issues/2952>

## 2026-09-15：Chat 图片粘贴首轮实施复核

- 实施采用既定双通道，没有改变单 runtime 决策：bridge v2 用 Pi extension API 直接发送 image content，离线时用受管 host path + Herdr text prompt。
- 本机 Pi 0.84.4 TypeScript 编译再次确认 extension image shape 为 `{type:"image", data, mimeType}`，没有采用同版本文档中不一致的 `source` 示例。
- assistant-ui 真实 primitive 的 jsdom 测试确认：`ComposerPrimitive.Input` paste file 后调用 attachment adapter；点击 send 后先上传，再把 complete attachment 交给 `onNew`。
- server 实施后补充了最初方案中的像素边界：PNG/JPEG/GIF/WebP 读取尺寸，拒绝超过 40MP 或任一边超过 16384 的图片；未知/无法解析尺寸同样拒绝。
- bridge command long poll 增加 abort 释放，避免旧 runtime 断开后 waiter 抢先 claim 新命令导致图片消息丢失。
- 为避免 server 尚未重启时新 hashed Web bundle立刻破坏既有 mutation，前端 token helper 对旧 server 的 `/api/request-token` 404 临时回退旧行为；新 server仍强制 token。
- 完整实现和验证记录见 [`development-log.md`](./development-log.md) 与 [`image-paste-implementation-plan.md`](./image-paste-implementation-plan.md) 第 22 节。

## 2026-09-15：Devin 首期与多 Agent 架构调研

### 需求澄清

- 用户确认首期目标是 **Herdr 中已经运行的 Devin CLI Pane**，不是 Devin Cloud API session，也不是由 Herzi 新建 ACP runtime。
- 体验希望与当前 Pi Chat 一致；公开接口难以实现的能力可以单独商议。

### 当前项目审计

- `src/server/herdr-client.ts` 只缓存 Pi session path，未保留通用 `agent_session`/`terminal_id`。
- `src/server/index.ts` 的 Chat、upload、prompt、cancel、bridge identity 多处硬编码 `pane.agent === "pi"`。
- `src/web/App.tsx` 与 `ChatView.tsx` 同样按 Pi 判断 Chat 可用性和能力。
- 结论：不能继续堆品牌条件分支，应先引入 Agent adapter、ownership 和 capability 模型；Pi parser/realtime 作为 Pi adapter 私有实现保留。

### 一手资料结论

- Herdr 官方已支持 `herdr integration install devin`；公开源码中的 Devin integration v2 通过 hooks 报告 exact native session id，并使用 `devin --resume <id>` 恢复。Devin 状态仍以 screen manifest 为权威，因为 hooks 不能覆盖 permission cancellation、interrupt 等全部转换。
- Herdr `agent.prompt`、`agent.send_keys`、`agent.focus`、`agent.wait` 与 terminal observe/control 可以继续用于同一 Devin Pane，不需创建第二 runtime。
- Devin 官方 hooks 提供 SessionStart、UserPromptSubmit、Pre/PostToolUse、PermissionRequest、Stop、PostCompaction、SessionEnd，并带 `session_id`/`prompt_id`；没有 assistant token delta、thinking delta 或历史 replay。
- Devin stable changelog说明新版 Stop hook包含 `last_assistant_message`，但 lifecycle hook 字段表尚未同步列出；最低版本和真实 payload 必须通过 synthetic fixture 验证，不能直接假设。
- Devin CLI 支持 `--export [PATH]`，每 turn 导出 ATIF；官方文档未提供本轮可依赖的完整 ATIF schema，且已运行 Pane 无法补加启动参数，因此只能作为 Herzi 新建 session 的可选 history reconciliation。
- `devin acp` 通过 ACP 提供 message chunks、tool、permission、elicitation、cancel 和 history load/resume，是 rich client 的最佳接口；但它要求 Herzi 启动另一个 subprocess，不是旁观已有 TUI 的接口，首期不能并发 load/resume 活跃 session。
- Devin Cloud v3 API 提供 session CRUD、flat messages、状态与 attachment；官方 common flow要求 polling，本轮未找到 session webhook/token/tool stream。它属于未来 remote-api provider，不解决本地 Pane。
- ACP TypeScript SDK `@agentclientprotocol/sdk` 为 Apache-2.0；上游当前 package 文件标记 1.4.0，stable 入口为 ACP v1，v2 仍 experimental。
- 为后续 Codex 只做了边界核实：Herdr 可报告 Codex session id；Codex 官方 app-server 有 thread read/list/resume、turn/item stream、approval 与 interrupt。Codex 应有独立 adapter，不能复制 Devin 的弱 hook 假设。

### 推荐决策

- 首期采用 `terminal-backed/devin adapter + 独立 companion hook journal`。
- companion 必须安装在 Herdr managed hook 旁边，不能修改会被 Herdr update 覆盖的脚本。
- status authority = Herdr；Devin Chat history = 明确标记 derived/partial 的 Herzi journal；Terminal = 完整兜底。
- prompt 继续走 Herdr；cancel 策略（`Ctrl+C` 或 `Esc Esc`）先在专用 Pane 验证；approval/question 首期只提示切 Terminal。
- event ingress 使用独立 integration credential + Pane/session 双校验；journal/spool 私有权限、有限保留、正文不进普通日志。
- assistant token streaming、安装前旧历史、原生图片和结构化审批不是首期可诚实承诺的能力。若这些成为硬要求，应改评 Herzi-owned ACP 模式。

### 未查证项

- 当前用户环境的 Devin CLI 版本、登录状态、Herdr Devin integration 安装状态均未读取/执行检查。
- Stop payload、tool call id、ATIF 写入模式/schema、prompt working 语义、cancel 按键和 host-path 图片均待 P0 synthetic 验证。
- 本轮没有读取用户 Devin config、session DB、真实 Pane 或私人 transcript，也没有调用带 credential 的 Devin API。

### 交付

- 新增 [`devin-integration-research-report.md`](./devin-integration-research-report.md)。
- 新增 [`multi-agent-architecture-and-devin-plan.md`](./multi-agent-architecture-and-devin-plan.md)。
- 更新 [`README.md`](./README.md) 文档索引与当前结论。
- 本轮只形成调研、架构和实施方案，未修改产品代码、未安装 Devin/Herdr integration、未启动 Devin session。

来源（访问日期 2026-09-15）：

- <https://docs.devin.ai/cli>
- <https://docs.devin.ai/cli/reference/commands>
- <https://docs.devin.ai/cli/extensibility/hooks/overview>
- <https://docs.devin.ai/cli/extensibility/hooks/lifecycle-hooks>
- <https://docs.devin.ai/cli/changelog/stable>
- <https://docs.devin.ai/api-reference/overview>
- <https://docs.devin.ai/api-reference/common-flows>
- <https://docs.devin.ai/api-reference/v3/sessions/post-organizations-sessions>
- <https://agentclientprotocol.com/protocol/v1/overview>
- <https://agentclientprotocol.com/protocol/v1/prompt-turn>
- <https://agentclientprotocol.com/protocol/v1/tool-calls>
- <https://agentclientprotocol.com/libraries/typescript>
- <https://herdr.dev/docs/agents/>
- <https://herdr.dev/docs/integrations/>
- <https://herdr.dev/docs/socket-api/>
- <https://herdr.dev/docs/session-state/>
- <https://github.com/herdrdev/herdr/blob/master/src/integration/assets/devin/herdr-agent-state.sh>
- <https://github.com/herdrdev/herdr/blob/master/src/detect/manifests/devin.toml>
- <https://developers.openai.com/codex/app-server>

## 2026-09-15：补充核查 Moshi 如何处理 Devin

用户追问 Moshi 如何完成同类接入。重新读取 Moshi 当前官方 Chat View、Hooks、Debug Chat View 与 gateway 文档后确认：

- Moshi 对 Tier A agent 的实现不是用 hooks 拼 transcript，也不是 ACP。`moshi-hook` 负责把 tmux/Herdr Pane 映射到 exact native session/transcript；host gateway 读取 agent 本地 transcript，经 `/v1/transcripts` WebSocket 发 `backlog` 与后续完整 JSONL row `append`；app 端 agent-specific parser 再投影为消息、tool card、plan、question 和图片。
- Prompt 与可安全映射的 approval 通过 multiplexer 写回同一个 live TUI；无法确定回送方式的交互提示用户回 Terminal。
- gateway 只监听 `127.0.0.1:24543`，app 通过已有 SSH connection 转发；完整 transcript 不经过 Moshi backend，hook 的小摘要/通知是另一条数据链。
- **Moshi 当前并没有为 Devin CLI 实现 Native Chat View。** 官方 Tier A 列表不含 Devin，Tier C Terminal/TUI 列表才包含 Devin；Tier C 明确不承诺 hook、session detection、transcript parser 或 native resume。`/v1/transcripts` 的支持 source 列表也不含 Devin。
- 这印证了本报告的关键限制：Devin 缺少 Moshi Tier A 模式所需的公开稳定 local transcript 接口。Herzi 的 companion hook journal 是自建 derived/partial history，比 Moshi 当前 Devin Tier C 更进一步，但不能冒充 agent-native transcript authority，必须先过 P0 synthetic 验证门。

已把该结论补入 [`devin-integration-research-report.md`](./devin-integration-research-report.md) 和 [`multi-agent-architecture-and-devin-plan.md`](./multi-agent-architecture-and-devin-plan.md)。

来源（访问日期 2026-09-15）：

- <https://getmoshi.app/docs/chat-view>
- <https://getmoshi.app/docs/hooks>
- <https://getmoshi.app/docs/debug-chat-view>
- <https://getmoshi.app/docs/debug-gateway>

## 2026-09-16：Devin 本地数据库读取方案专项调研

### 范围与隐私边界

- 用户要求评估“读取 Devin 数据库”方案。
- 本轮没有读取用户真实 Devin 配置、session DB、Pane 或 transcript。
- 本机实验只下载官方公开 CLI artifact，在项目内临时目录设置隔离 `HOME`/XDG，执行 `devin list` 生成空白 synthetic DB；SHA-256 校验通过，实验结束后临时文件已删除。

### 官方资料与公开 artifact 核查

- 官方 current manifest 当时指向 `v3000.10.27`；验证的 macOS arm64 artifact SHA-256 为 `d25e50086b3f84286b6ca1a69f890331436ef9b757c937fa18f716fbef384edd`。
- stable changelog直接提到 local/session database、SQLite corruption fix、旧 CLI 打开较新 DB 的兼容错误，以及 ACP dedicated database thread；但官方没有公开 DB path/schema/message JSON/第三方并发读取契约。
- 公共二进制中确认存在 SQLite SQL、migration、WAL/busy timeout、`sessions.db-wal`/`sessions.db-shm` 和内部 `CHISEL_SESSION_DB`；最后一项没有文档，不能作为产品契约。

### 隔离实验结果

- 默认 macOS/Linux data path 实测为 `~/.local/share/devin/cli/sessions.db`；设置 `XDG_DATA_HOME` 时跟随 `$XDG_DATA_HOME/devin/cli/sessions.db`。
- 空库表包括 `sessions`、`message_nodes`、`prompt_history`、`tool_call_state`、`subagent_heads`、`rendered_commits`、`app_state`、`refinery_schema_history`。
- `message_nodes` 包含 `node_id/parent_node_id/chat_message/metadata`，说明历史是 forest，不是简单平面行；`sessions` 含 `main_chain_id`。
- migration 从 V1 到 V17，覆盖 message forest、node metadata、shell context、rendered commits、workspace dirs、tool state、hidden、session metadata 和 subagent heads。
- 空库关闭后 `journal_mode=delete`，但二进制明确包含 WAL 初始化与 sidecar 处理；因此 live runtime 必须动态探测并按 WAL-capable 处理，不能硬编码 journal mode。
- 由于空库没有 turn，main-chain、fork/revert、compaction、tool、subagent、commit timing 和 `chat_message` JSON variant 均保持未查证。

### 方案结论

- 技术上可从 DB 补齐 companion 安装前的旧历史，但这是内部实现，不是稳定 transcript API。
- 禁止对 live DB 使用 `immutable=1`；SQLite 官方说明文件实际变化时可能返回错误结果或 corruption。
- 禁止只复制 `sessions.db`，也不建议依次复制 main/WAL/SHM；WAL 是持久状态的一部分，逐文件 copy 不是一致 snapshot。
- 若进入实验，唯一推荐形态是 SQLite Online Backup API：短暂只读打开 source，分页复制到 Herzi `0600` 私有快照，再对完成快照使用 immutable/query-only parser。
- importer 必须按 exact CLI version + ordered migration checksum + app state + required columns + synthetic JSON variants 做 allowlist；任何 mismatch fail closed。
- 数据库只作为 feature-flagged history bootstrap/idle reconciliation；Herdr 状态 + hooks journal 仍是首期主链，Terminal 仍是交互 authority。

### 计划更新

- 新增 [`devin-local-database-research.md`](./devin-local-database-research.md)，记录证据、schema、方案矩阵、推荐架构、安全要求、compatibility gate 和 P0-DB 测试。
- 更新 [`devin-integration-research-report.md`](./devin-integration-research-report.md)：把“完全拒绝 DB”修订为“默认不依赖，仅允许一致性快照实验”。
- 更新 [`multi-agent-architecture-and-devin-plan.md`](./multi-agent-architecture-and-devin-plan.md)：新增 P0-DB 和可选 P6a SQLite snapshot bootstrap，ATIF 顺延为 P6b。
- 更新 [`README.md`](./README.md) 索引与当前结论。
- 未修改产品代码、未安装 dependency、未执行真实 Devin session 写入。

来源（访问日期 2026-09-16）：

- <https://docs.devin.ai/cli/reference/commands>
- <https://docs.devin.ai/cli/changelog/stable>
- <https://docs.devin.ai/cli/troubleshooting>
- <https://static.devin.ai/cli/current/manifest.json>
- <https://static.devin.ai/cli/3000.10.27/devin-3000.10.27-aarch64-apple-darwin.tar.gz>
- <https://www.sqlite.org/wal.html>
- <https://www.sqlite.org/backup.html>
- <https://www.sqlite.org/uri.html>
- <https://www.sqlite.org/pragma.html>
