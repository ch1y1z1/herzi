# Herzi：Herdr GUI / Web Chat View 可行性与架构报告

> 状态：推荐方案已形成，可进入技术验证阶段  
> 日期：2026-09-03（Asia/Shanghai）  
> 调研基线：Herdr 0.8.2 / socket protocol 20；Pi 0.84.4 / session JSONL v3  
> 项目代号：Herzi（沿用当前目录名，正式产品名待定）

## 1. 执行摘要

本项目在技术上可行，而且不需要在第一阶段重写终端复用器或接管 Pi 运行时。推荐方案是：

1. Herdr 继续拥有 workspace、tab、pane、PTY 和正在运行的 Pi 进程。
2. Herzi MVP 是一个只监听本机 loopback 的单进程 Web 应用。
3. 原始终端视图通过 Herdr 官方 `terminal session observe/control` 流接入，浏览器用 xterm.js 渲染。
4. Chat View 是同一个 pane 的“结构化视觉层”，不是第二个 agent：
   - Herdr 提供 `pane → Pi → exact session id/path` 的身份链；
   - Pi JSONL 提供权威的持久历史；
   - 一个独立的 Herzi Pi companion extension 提供 token、tool、状态和当前分支等低延迟运行时事件；
   - prompt、stop 和键盘输入仍回到原 Herdr pane。
5. 原始终端始终是 source of truth 和安全降级路径。找不到准确 session、解析器不兼容、结构化 action 无法无歧义映射时，不猜测、不伪装成功，直接保留或引导切回 Terminal View。

这一方案与 Moshi Desktop 和 Orca 已公开说明的 terminal-backed Chat View 路线一致，同时符合“先做单进程、Pi-only、本地 Web UI，后拆 daemon + client”的目标。

### 可行性判断

| 能力 | 判断 | 置信度 | 关键前提 |
| --- | --- | --- | --- |
| 发现并连接已有 Herdr session/pane | 可行 | 高 | Herdr socket snapshot + subscriptions |
| 显示已有 pane 的实时原始 TUI | 可行 | 高 | 官方 terminal observe 流 + xterm.js |
| 完整键盘/resize/scroll 控制 | 可行 | 中高 | 显式 controller lease；处理 takeover 与多客户端 |
| 对已有 Pi pane 显示已落盘 Chat 历史 | 可行 | 高 | 必须使用准确 session path，不按 mtime 猜测 |
| token/tool 级实时 Chat View | 可行 | 中高 | 安装非阻塞的 Herzi Pi companion extension |
| 无 extension 的实时 Chat View | 部分可行 | 中 | JSONL 只能最终一致，生成中内容仍看 Terminal |
| approval/question 全结构化交互 | 可逐步实现 | 中低 | 每类交互都要有稳定、无歧义的回送协议 |
| 未来远程 daemon + desktop client | 可行 | 高 | host-side adapter 留在 agent 主机，SSH 转发 |

## 2. 目标、边界与成功标准

### 2.1 用户目标的工程化拆解

核心目标分成四层：

1. **连接层**：发现 Herdr server，获取 workspace/tab/pane/agent/session/status，并在断线后恢复。
2. **终端层**：显示同一 PTY 的 ANSI 画面，支持尺寸变化与可控输入。
3. **语义层**：把 Pi session JSONL 解析成消息、thinking、tool call/result、compaction、branch 等结构化模型。
4. **产品层**：同一 pane 可在 Terminal View 与 Chat View 间切换；Chat composer 写回原 pane；能力不足时解释原因并降级。

### 2.2 推荐 MVP 范围

MVP 应包括：

- macOS 和 Linux 本机运行；Windows named pipe 留好抽象但不作为首个发布门槛。
- 自动连接本机现有 Herdr server，不创建第二套 multiplexer。
- workspace/tab/pane 导航，以及 agent/status/session 基础信息。
- 一个 pane 的实时 Terminal View；第一版至少 observe，随后加入显式 control。
- Pi-only Chat View：准确 session 映射、历史快照、增量更新、基本 user/assistant/tool 渲染。
- Chat composer 使用 Herdr `agent.prompt` 写回现有 pane；stop 使用 agent/pane 按键接口。
- 可选 Herzi Pi extension：streaming、tool lifecycle、`agent_settled`、`session_tree`。
- loopback-only、安全 origin 校验、资源上限、内容不落应用日志。

### 2.3 MVP 明确不做

- 不由 Herzi 创建或拥有新的 Pi RPC/SDK runtime。
- 不支持除 Pi 外的 agent transcript parser。
- 不从 ANSI 画面反向猜测结构化消息或 approval。
- 不默认监听 LAN、公网或提供云同步。
- 不承诺首次版本覆盖所有 Pi extension 自定义 entry/UI。
- 不在 MVP 内做完整桌面壳、移动端、SSH fleet 或多人协作。

## 3. 当前项目与本机事实基线

当前目录尚无产品代码，已有以下研究资产：

- 根目录 `AGENTS.md` 已强制所有过程文档写入 `docs/`。
- `docs/research-log.md` 已记录 Herdr、Pi、Moshi、Orca、Paseo、Webmux 的查证过程。
- `docs/herdr-api-schema.json` 是本机 Herdr 0.8.2 导出的协议 schema，后续应作为生成类型和兼容性测试输入。

本机验证结果：

- `herdr 0.8.2`，socket protocol 20。
- `pi 0.84.4`，session format 当前版本为 v3。
- Herdr Pi integration 为 current v8，安装在 `~/.pi/agent/extensions/herdr-agent-state.ts`。
- Herdr 官方 integration 负责向 server 上报 Pi session id/path 和 agent state；当前实现没有转发 `message_update` 或 tool delta。

本次核查没有读取任何真实 pane 内容或私人 Pi transcript。

## 4. 已验证的基础能力

### 4.1 Herdr：资源控制面与终端数据面是两条通道

Herdr socket API 使用 Unix domain socket（Windows 为 named pipe）上的 LF 分隔 JSON。客户端启动时先调用 `session.snapshot`，随后订阅 workspace/tab/pane/layout/agent 等事件；重连或发现 revision/sequence 缺口时重新拉取 snapshot。

资源控制面可以提供：

- workspace、tab、pane 拓扑；
- pane 对应的 `terminal_id`、cwd、title、agent、agent status；
- agent session reference，形如 `source + agent + kind(id|path) + value`；
- prompt、send keys、pane input/read 等控制动作。

逐帧实时终端不走普通资源事件，而由官方命令提供独立会话流：

- `herdr terminal session observe <target>`：多观察者，只读；
- `herdr terminal session control <target>`：同一终端单 controller，可显式 `--takeover`。

输出为 JSONL：`terminal.frame` 含单调 `seq`、宽高、`full` 和 base64 ANSI bytes；`terminal.closed` 表示结束。第一帧、重绘或尺寸变化通常是 full frame，其余为 ANSI diff。control stdin 接受 `terminal.input`、`terminal.resize`、`terminal.scroll` 与 `terminal.release`。

由此得到一个重要实现选择：**MVP 不需要 node-pty，也不应再 attach 一套 PTY。Herdr 已经拥有 PTY，Herzi 只转发官方终端流。**

### 4.2 Pi：JSONL 是树，而不是普通聊天数组

Pi session JSONL 首行为 header，随后 entry 通过 `id`/`parentId` 构成树。常见 entry 包括：

- `message`；
- `thinking_level_change`、`model_change`；
- `compaction`、`branch_summary`；
- `custom`、`custom_message`、`label`、`session_info`。

正确渲染不能简单“逐行变气泡”：

- 主 Chat View 应沿当前 leaf 的 parent 链重建当前 branch；
- compaction 是模型上下文语义，不等同于删除历史展示；
- 未知 custom entry 必须保留可诊断占位或安全忽略，不能使整个 session 失败；
- 只解析以换行结束的完整记录；尾部半行要等待下一次写入。

还确认了两个容易踩坑的事实：

1. Pi 的 `SessionManager.open()` 在加载旧 session 时可能迁移并重写文件。Herzi 是旁观者，不能在活跃 session 上调用会产生写入副作用的 API；MVP 应实现隔离的、只读、version-tolerant parser，并用 Pi 的 fixtures 做兼容测试。
2. `/tree` 导航只改变运行时 `leafId` 时，新的 leaf 未必立刻写入 JSONL；文件解析器通常只能把最后 entry 当默认 leaf。Herzi extension 必须监听 `session_tree` 并上报 `newLeafId`，才能在活跃进程中立即显示正确分支。没有 extension 时应标记“分支状态最终一致”，而不是假装绝对准确。

### 4.3 Pi runtime events：实时层，不是历史权威层

Pi Extension API 已提供：

- `session_start/switch/tree/shutdown`；
- `agent_start/end/settled`；
- `turn_start/end`；
- `message_start/update/end`；
- tool execution 生命周期。

其中 `message_update` 用于 assistant streaming；最终消息以 `message_end` 和后续 JSONL entry 为准。`agent_end` 之后 Pi 仍可能自动 retry、compact 或处理 follow-up，因此 UI 的“真正空闲”应依赖 `agent_settled`。

正确关系是：

- JSONL：权威、可恢复、最终一致；
- extension events：低延迟、临时、可能丢失；
- watcher reconciliation：把临时状态与权威历史合并并修复缺口。

## 5. 相关产品实施方案与启示

### 5.1 Moshi Desktop / Moshi Hook

Moshi 是与目标最相近的公开产品说明：

- `moshi-hook serve` 运行在 agent 主机，接收本地 hook，并提供 loopback gateway；
- Desktop/浏览器端通过既有 SSH 做端口转发，不把宿主 gateway 暴露到公网；
- Chat View 是同一 terminal/session 的视觉层，terminal 保持 source of truth；
- hook 负责把 pane 精确映射到 agent native session；gateway 再读取 host 上的 transcript；
- composer 和可安全映射的 action 写回原 PTY；无法安全映射时切回 terminal；
- 支持按能力分层：原始 terminal、agent-aware、transcript-backed native chat。

最重要的原则是官方排障文档明确强调：**不能按“最近修改的 transcript”猜 session。** 身份链必须是 `pane → agent → exact native session → exact transcript`。

Moshi Desktop 还验证了目标中的长期双层架构：同一二进制可承担 host daemon 与本地 Web client 两种角色；远程主机只运行 daemon/multiplexer，本地应用通过 SSH 转发读取数据。

限制：Moshi 客户端内部实现没有公开，本报告只能依据官方文档提取架构模式，不能把其内部 parser/schema 当成可复用代码。

### 5.2 Orca Native Chat

Orca 的公开源码提供了 transcript watcher 的工程样本：

- terminal-backed Chat UI 与 runtime-owned structured agent 是两种模式；existing/remote session 继续以 PTY 为准；
- hook 报告的 `transcriptPath` 优先，ID 扫描只作为受约束 fallback；
- 增量读取使用 byte offset，妥善处理 UTF-8 跨 chunk、尾部半行和单条超大 JSON；
- `fs.watch` 只降低延迟，周期 polling/reconciliation 才保证正确性；
- 监听父目录并检查 inode/identity、size、mtime、边界 fingerprint，识别 truncate、rotate、atomic replace 和同尺寸重写；
- 初始历史可做有界 tail，旧消息按 byte cursor 分页，避免大 session 一次占满内存；
- read/subscribe 之间的 gap、首次 flush、文件短暂消失、unsubscribe race 都有专项测试。

公开 issue 又暴露了四类值得直接防守的问题：

- session/path 传播不完整会得到空 transcript；
- 错误地 resume 同一 transcript 会启动第二个 live process，形成双运行时所有权；
- 交互式 question 状态若只依赖 status path，远端 Chat UI 会漏掉；
- PTY 写入失败时，乐观“已发送”气泡会永久误导用户。

截至所核查 Orca commit，Pi 可作为普通 CLI agent 使用，但不在 terminal-backed native chat 支持列表；公开 issue 仍在请求 Pi Native Chat。它是通用 watcher 与所有权问题的参考，而不是现成 Pi 适配器。

### 5.3 Pi Web、Picot、Paseo 与 Webmux

这些产品证明了另一条路线：应用自行启动并拥有 agent runtime。

- 两个 Pi Web 项目分别采用 Pi SDK 或 daemon + Pi process，能自然获得结构化事件和完整控制。
- Picot 用 Tauri/Rust host 管理 `pi --mode rpc`，浏览器消费结构化 WebSocket。
- Paseo 的 daemon/provider/timeline protocol 很适合未来“由 Herzi 新建 agent”的扩展。
- Webmux 证明本地 Web + xterm 的终端 dashboard 可以快速交付。

但它们不解决 MVP 的核心约束：**无侵入连接 Herdr 中已存在、正在运行的交互式 Pi。** 对同一 session 再启动 SDK/RPC runtime 会引入双写、重复工具调用、锁与状态分叉风险。因此这些项目只用于借鉴 UI、协议、序列号、catch-up 和未来 runtime-owned 模式。

### 5.4 竞品结论对照

| 产品/方案 | 谁拥有 PTY/agent | Chat 数据来源 | 与 Herzi 可直接借鉴的部分 | 不应照搬的部分 |
| --- | --- | --- | --- | --- |
| Moshi | 原 multiplexer | exact transcript + hook + PTY | host gateway、能力分层、SSH、准确映射 | 闭源内部协议/解析器 |
| Orca terminal-backed | 原 PTY | transcript watcher + PTY | watcher、replace/resync、fallback | 当前无 Pi Native Chat |
| Pi Web / Picot | 应用 | SDK/RPC events | Pi UI、结构化事件、parser fixtures | 接管已有 pane |
| Paseo | daemon | provider timeline | protocol、seq、catch-up、远程演进 | MVP 的 agent ownership |
| Webmux | tmux/Web app | ANSI PTY | xterm、本地单端口体验 | 深层 Chat 语义、许可证未明代码 |

## 6. 推荐总体架构

### 6.1 MVP：一个进程，内部仍保持两层边界

~~~mermaid
flowchart LR
    B[Browser UI\nTerminal / Chat] <-->|HTTP + WebSocket\n127.0.0.1 only| H[Herzi Host Process]
    H --> HA[Herdr Adapter]
    H --> PA[Pi Transcript Adapter]
    H --> EI[Pi Extension Ingress]
    HA <-->|LF JSON socket| HD[Herdr Server]
    HA <-->|terminal observe/control CLI| PTY[Existing Herdr PTY]
    PA -->|read-only exact path| J[Pi session JSONL]
    PE[herzi-bridge.ts\noptional] -->|local UDS events| EI
    PE -. same process/session .-> PI[Existing Pi]
    PI --> J
    PI --> PTY
~~~

虽然物理上是一个 Node.js 进程，逻辑上必须保留：

- `host adapters`：只存在 agent 主机，接 Herdr socket、terminal stream、Pi 文件和 extension UDS；
- `application protocol`：向浏览器输出稳定、版本化、脱敏后的资源；
- `web UI`：不接触任意文件路径、Herdr socket 或宿主命令。

这样未来拆成 daemon + desktop client 时，迁移的是进程边界，不是重写业务模型。

### 6.2 建议技术栈

| 区域 | 推荐 | 原因 |
| --- | --- | --- |
| Runtime | Node.js 22 + TypeScript strict | Pi 生态同语言；UDS、文件 watcher、child process、WebSocket 成熟 |
| HTTP/WS | Fastify + websocket/static 插件 | 单进程、本地服务、schema 校验与限流方便 |
| Web UI | React 19 + Vite + Tailwind CSS 4 + shadcn/ui | 便于实现 Workspace 树、segmented toggle 和可定制桌面风格 |
| Chat UI | assistant-ui External Store Runtime | 复用 thread/message/composer/tool primitives，同时由 Herzi 保持 Pi 数据所有权 |
| Terminal | `@xterm/xterm` 6 + fit addon | 专门处理真实 ANSI/TUI、宽高与输入 |
| Validation | TypeBox 或 Zod | wire protocol 与 JSONL entry 做运行时边界校验 |
| Testing | Vitest + Playwright | watcher/adapter 单测和浏览器端到端覆盖 |
| Packaging | 开发期 npm workspace；稳定后再选 Tauri/Electron | 避免过早引入桌面壳和签名发布复杂度 |

选择 Node 而不是 Rust 并非长期限制：最风险集中的部分是协议、身份、JSONL/reconciliation 与 UI，而不是 CPU。等 watcher、协议和产品边界稳定后，host daemon 可独立迁移。

## 7. 核心组件设计

### 7.1 HerdrConnection

职责：

- 从 Herdr CLI/config 解析当前 socket 地址；
- 连接并校验 protocol version；
- `session.snapshot` 后订阅必要事件；
- 维护内存中的 workspace/tab/pane replica 与本地 revision；
- 对 unknown fields 前向兼容，对 unknown required method 明确报错；
- 断线指数退避，重连后丢弃旧 replica 并重新 snapshot。

所有 target 必须来自当前 snapshot 中的 opaque id，禁止把浏览器字符串直接拼进 shell。启动 CLI 子进程必须使用 executable + argv 数组且 `shell: false`。

### 7.2 TerminalBridge

每个打开的 terminal view 启动或复用一个 observer：

1. 使用 `herdr terminal session observe <pane-id> --cols C --rows R`。
2. 逐行校验 JSON；base64 decode 前检查上限。
3. 验证 `seq` 单调递增；首帧或 `full=true` 重置浏览器端终端状态。
4. MVP 先通过统一 WebSocket 的 terminal channel 转发给 xterm.js；只有真实使用证明 ANSI 流阻塞控制/Chat 消息时，再拆成独立 WebSocket。
5. 发生 sequence gap、无效帧或进程退出时关闭该 stream，重新 observe 获取 full frame。

交互模式使用 `control`，但必须把 controller 当成显式 lease：

- 默认不带 `--takeover`；
- 已被占用时显示当前不可控状态；
- 只有用户明确确认才 takeover；
- 页面隐藏、WS 断开或空闲超时后发送 `terminal.release`；
- 多浏览器客户端不能同时认为自己拥有输入权。

### 7.3 PaneSessionResolver

Chat View 只有在以下校验全部通过后才激活：

1. pane 存在且 agent 为 Pi；
2. agent session reference 来源受信任，类型为 exact id/path；
3. path canonicalize 后是预期的 `.jsonl` regular file，且未逃逸允许根；
4. JSONL header 可解析，session id 与 Herdr reference 一致（如果两者均有）；
5. 同一个 `(paneId, terminalId, sessionId/path identity)` 生成稳定的内部 `sessionKey`。

浏览器只收到 `sessionKey`、basename/可选脱敏 cwd，不收到任意绝对路径。失败时返回结构化 reason，例如 `no-agent`、`no-exact-session`、`file-pending-first-flush`、`permission-denied`、`unsupported-version`。

禁止 fallback 到“目录中 mtime 最新文件”。若未来加入 ID 扫描，只能在 agent 固有目录内扫描 header id 精确匹配。

### 7.4 PiTranscriptReader

第一版应自行实现只读 parser，不实例化会迁移 session 的 `SessionManager.open()`。模块边界分成：

- `JsonlScanner`：byte offset、StringDecoder、完整行、大小上限；
- `PiEntryDecoder`：v1-v3 兼容读取，unknown entry 保留；绝不回写迁移；
- `PiSessionTree`：id/parentId 索引、leaf path、branch 切换；
- `PiChatProjection`：把 entry 投影为 UI block，不改变原始语义；
- `TranscriptWatchEngine`：watch + poll + identity/fingerprint + resnapshot；
- `TranscriptStore`：有界内存 snapshot、旧历史分页、订阅与 sequence。

成熟实现应采用有限窗口，例如最近 2–8 MiB 或最近 500 个可见 block；用户向上滚动时用不透明 byte cursor 读取更早内容。按当前功能优先路线，首版先在文件变化时重新读取常用规模的 JSONL，只有出现实际性能问题后再实现 byte cursor、分页和完整资源上限。

Watcher 正确性算法：

1. 打开后记录 file identity、size、mtime、头尾 fingerprint 与 offset。
2. 初始 scan 完成后再建立订阅，并再次 stat/reconcile，覆盖 read/subscribe gap。
3. `fs.watch` 父目录只触发快速 reconcile。
4. 固定间隔 polling 确保漏事件仍收敛。
5. size 增长：从 offset 读取，保留半行 buffer。
6. size 缩小、identity 变化、同尺寸 fingerprint 改变或边界不一致：发 `replace`，从新文件重建 snapshot。
7. 文件暂时不存在：进入 retrying，不立即解除 pane/session 映射。

### 7.5 Herzi Pi companion extension

Herdr 管理的 `herdr-agent-state.ts` 会被集成安装流程更新，**不得修改它**。Herzi 应安装旁边独立的 `herzi-bridge.ts`，并提供 status/install/uninstall 命令。

Extension 应：

- 仅在 `HERDR_ENV=1` 且能取得 pane/session identity 时启用；
- 连接用户专属 runtime 目录内的 Herzi Unix socket；Herzi 未运行时快速失败且不影响 Pi；
- 上报 `bootId + paneId + sessionId/path token + seq + event type`；
- 监听 session、agent、turn、message、tool 和 `session_tree`；
- 对 token delta 合并/节流，队列有界；背压时允许丢 provisional delta，但必须发送 `resync-required`；
- 不把整个历史通过 hook 重发，不把 secret、认证信息或任意文件暴露为 RPC；
- handler 不阻塞 Pi 主流程，所有异常本地吞吐并做无正文诊断。

运行时消息使用 provisional id。最终 JSONL entry 出现后，Chat store 用 session/turn/role/toolCallId/内容摘要等受约束信息合并；无法可靠合并则以持久记录替换临时 block，而不是保留两个“确定消息”。

### 7.6 ChatCommandRouter

动作遵循“原 pane 单写者”原则：

- 新 prompt：优先 Herdr `agent.prompt`，由 Herdr 做 bracketed paste/状态保护；
- stop：使用 Herdr agent send keys 或受控 `Esc`；
- 普通终端键盘：只在 controller lease 下走 terminal control；
- approval/question：仅在 adapter 声明具体 capability 且有确定 response mapping 时显示结构化按钮，否则显示“请在 Terminal View 完成”。

浏览器发送 command 时带 `requestId/idempotencyKey`。Herzi 只在 Herdr 接受写入后返回 `submitted`；Chat 中不立刻创建“已确认的用户消息”。如果在超时内没有 extension/JSONL 证据，显示 `delivery-unconfirmed`，允许用户检查 Terminal，避免虚假成功或自动重复发送。

## 8. Web 协议与 UI 模型

### 8.1 建议 endpoint

MVP 先保持最少接口：

- `GET /api/v1/bootstrap`：版本、server 状态、capabilities 与初始资源 snapshot。
- `WS /ws`：通过 `channel` 字段复用资源事件、terminal frame、Chat 更新和 command result。
- `GET /api/v1/health`：仅返回无敏感内容的本地健康信息。

如果真实使用中出现 terminal 数据造成 head-of-line blocking，再把它拆为 `/ws/v1/terminal`，把控制与 Chat 留在 `/ws/v1/control`。前后端共享消息 envelope，因此拆分不需要改变业务模型。

统一 envelope 示例：

~~~json
{
  "v": 1,
  "type": "chat.append",
  "requestId": null,
  "paneId": "opaque-pane-id",
  "sessionKey": "opaque-session-key",
  "seq": 184,
  "payload": {}
}
~~~

客户端发现 `seq` 缺口时不能自行猜补，需请求 `chat.resync` 或重取 snapshot。server 的 hello 必须返回 capability 集合，前端据此显示或禁用功能。

### 8.2 能力模型

| 层级 | 能力 | UI 表现 |
| --- | --- | --- |
| Disconnected | 无 Herdr | 连接诊断与重试 |
| Terminal | `terminal.observe` | 原始 TUI 可见 |
| Terminal Control | `terminal.control` | 键盘、resize、scroll，显示 lease |
| Agent-aware | `agent.status/prompt` | Pi 标识、working/idle、composer |
| Chat History | exact session + parser | 已落盘结构化历史 |
| Chat Live | extension online | streaming、tool/status、current leaf |
| Structured Interaction | per-action mapping | 可审计的 approval/question 按钮 |

能力是逐 pane、逐 session 的，不是应用全局布尔值。同一页面里一个 pane 可以是 Chat Live，另一个只能 Terminal。

### 8.3 页面结构

- 左侧：workspace/tab/pane 树、agent 状态和连接状态。
- 主区顶部：pane title、cwd（可选脱敏）、Pi/session 状态、Terminal/Chat toggle。
- Terminal View：xterm.js、只读/控制权标识、takeover 显式动作。
- Chat View：消息块、thinking 折叠、tool card、compaction/branch marker、流式状态。
- 底部 composer：发送、stop、发送状态；在 blocked/交互态提示切回 Terminal。
- 全局诊断抽屉：只显示版本、连接、capability、last seq/reconcile，不显示消息正文。

Terminal 和 Chat View 切换不能改变底层 session，也不能触发 resume/new process。

具体参考图拆解、组件库比较、tool/message/composer 设计见 [`ui-research-and-direction.md`](./ui-research-and-direction.md)。

## 9. 安全、隐私与信任边界

这是一个拥有宿主用户权限的 coding-agent 控制界面。即使只在本机，浏览器页面一旦被恶意站点调用，也可能触发任意命令执行。最低要求如下：

### 9.1 网络边界

- 默认只 bind `127.0.0.1` 和 `::1`，不使用 `0.0.0.0`。
- 校验 HTTP `Host` 与 WebSocket `Origin`；拒绝任意网页跨站连接。
- 启动时生成随机 session secret，通过一次性 URL 换取 HttpOnly、SameSite=Strict cookie；WS 复用该认证。
- 设置严格 CSP、`frame-ancestors 'none'`、禁用 MIME sniffing。
- 非 loopback 模式必须是未来单独功能，要求明确认证、TLS 或 SSH tunnel，不能只加一个 `--host`。

### 9.2 文件与内容边界

- 不提供通用“读取任意路径”API；只接受 Herdr/Pi 身份链解析出的 session。
- canonicalize、限定根目录、检查 regular file；可行时拒绝 symlink escape / 使用 no-follow 打开。
- transcript 正文默认不写 Herzi 日志；诊断中路径和内容做脱敏。
- 浏览器不持久缓存 transcript；draft 可单独、明确地本地保存。
- Markdown 禁止 raw HTML，使用 allowlist sanitizer；链接协议白名单；tool output 纯文本/代码块渲染。

### 9.3 终端边界

- xterm 的 OSC 52 clipboard、超链接与自定义 handler 默认禁用或要求用户手势。
- 输入控制权可见、可释放；不静默 takeover。
- 所有 child process `shell: false`，pane/session id 经 snapshot allowlist 验证。
- 限制 ANSI frame、base64、JSON line、WS buffer 和每客户端队列大小；慢客户端丢弃并 resync，不能拖垮 host。

### 9.4 Pi trust

MVP 不创建新 Pi，因此沿用正在运行的 Pi 信任上下文。未来若加入 runtime-owned Pi RPC，必须实现项目 trust UI；不能因为浏览器是本机就自动传 `--approve`。Pi extension 只能读取 `ctx.sessionManager` 等所需状态，不应扩大项目级配置的信任范围。

## 10. 一致性、恢复与失败语义

| 故障 | 用户可见行为 | 恢复策略 |
| --- | --- | --- |
| Herdr socket 断开 | 顶部 disconnected；保留只读最后画面 | 退避重连，重新 snapshot/subscriptions |
| terminal sequence gap | Terminal 显示重同步，不继续应用 diff | 重启 observer，等待 full frame |
| transcript 尾部半行 | 不显示半条消息 | 保留 buffer，下一次增量完成后解析 |
| transcript truncate/replace | Chat 短暂 resync | 发送 replace snapshot，重置 offset/identity |
| 首次 assistant 前文件不存在 | Chat 显示 waiting for first flush | 周期重试，不按 mtime 换文件 |
| extension 丢包/重启 | streaming 降级、标记 syncing | 依靠 bootId/seq 发现缺口，JSONL reconcile |
| 当前 leaf 不可知 | 标记 branch state uncertain | extension `session_tree` 修正；否则以落盘末 entry 为默认 |
| prompt 接受但无消息证据 | delivery unconfirmed | 不自动重发，提示检查 Terminal |
| 结构化 approval 无映射 | 不显示可误触按钮 | 一键切到相同 pane 的 Terminal |
| Herdr server 重启 | 普通进程可能终止 | 显示 session 状态；恢复动作交由 Herdr/Pi，不暗中另启 runtime |

## 11. 方案比较与决策

### A. Terminal-backed overlay（推荐）

优点：连接已有 session；只有一个 runtime/PTY 写入者；原始视图和结构化视图天然对应；可逐步增强。缺点：需要 agent-specific transcript adapter 和 companion extension；完整交互覆盖较慢。

### B. 由 Herzi 启动 Pi RPC/SDK

优点：最完整的结构化事件和命令语义，适合未来新建 session。缺点：不能安全“接管”已在 Herdr pane 中运行的 Pi；若指向同一 transcript 可能双运行时、双工具执行和会话分叉。因此不作为 MVP。

### C. 从 ANSI 反向解析聊天

优点：似乎无需 JSONL/extension。缺点：主题、宽度、重绘、alternate screen、进度动画和 agent 版本都会破坏语义；无法可靠识别 tool/approval/current branch。仅可用于截图/终端，不可作为 Chat authority。

### D. Fork/修改 Herdr 输出语义事件

优点：统一协议。缺点：Herdr 本身不拥有 Pi 消息语义；会增加上游耦合和维护成本。未来可向 Herdr 提议通用 extension event relay，但 MVP 不需要 fork。

### E. 直接实现 Herdr 内部终端二进制协议

优点：少一个 CLI 子进程。缺点：当前公开稳定边界是 terminal session CLI；过早复刻内部握手收益低、兼容风险高。MVP 先包装官方 CLI，数据证明进程开销成为瓶颈后再考虑直接协议。

最终决策详见 `docs/decisions/0001-terminal-backed-local-web-mvp.md`。

## 12. 从单进程演进到 daemon + client

阶段 1 的接口要按最终拓扑设计：

~~~mermaid
flowchart LR
    D[Herzi Daemon\nagent host] <-->|Herdr socket / Pi files / extension UDS| A[Herdr + Pi]
    C[Desktop/Web Client\nuser machine] <-->|versioned Herzi protocol\nover SSH tunnel| D
~~~

拆分时：

- `HerdrConnection`、`TerminalBridge`、`PaneSessionResolver`、`PiTranscriptReader`、extension ingress 全部留在 agent host；
- UI 状态、渲染和用户交互留在 client；
- 远程默认使用 `ssh -L`、`ssh -W` 或 stdio transport；daemon 仍监听 UDS/loopback；
- 同一协议提供 snapshot + sequence event + resync；桌面壳仅是 client，不读取远端本地路径；
- 将来若引入 relay，需要端到端加密和最小元数据设计，不能让云端看到 transcript。

这一演进不要求改变“terminal-backed existing session”和“runtime-owned new session”两个明确的 ownership 模式。

## 13. 风险排序与缓解

| 风险 | 概率/影响 | 缓解 |
| --- | --- | --- |
| Pi schema/extension API 随版本变化 | 中/高 | adapter version、fixtures、unknown tolerant、兼容矩阵 |
| JSONL watcher race/重写导致漏消息 | 高/高 | Orca 式 watch + poll + identity/fingerprint + replace 测试 |
| active branch 只存在 Pi 内存 | 中/中高 | extension 上报 `session_tree`; 无 extension 显式标记最终一致 |
| 多客户端输入冲突 | 中/高 | controller lease、idempotency、显式 takeover |
| 浏览器跨站触发 agent 命令 | 中/极高 | loopback、secret cookie、Host/Origin/CSP |
| 大 transcript/tool output 内存失控 | 高/高 | byte pagination、record/frame/queue 上限、慢客户端 resync |
| 结构化 action 误映射 | 中/高 | per-capability allowlist；不确定时 terminal fallback |
| Herdr/Pi 双运行时所有权 | 低/极高 | MVP 禁止 SDK/RPC attach/resume 已有 session |
| Windows/WSL 文件和 named pipe 差异 | 高/中 | 首版 macOS/Linux；抽象 transport/watch；后续专项阶段 |
| 上游许可证/闭源实现不可复用 | 中/中 | 优先依据公开协议自行实现，复制前逐文件核查许可证 |

## 14. 默认产品决策与待确认项

为了不阻塞技术验证，本报告建议先采用以下默认值：

1. 首个受支持平台为 macOS，Linux 同期尽量兼容；Windows/WSL 后置。
2. Web listener 只允许本机，默认浏览器自动打开；不支持 LAN 分享。
3. Terminal observe、Chat history 和 composer 是首个可用版本的必要功能；完整 raw control 紧随其后。
4. Pi extension 是“增强实时体验”的可选安装项；不安装也能看 Terminal 和最终一致 Chat history。
5. 不复制 Moshi 闭源代码；Orca/Pi/Herdr 等开源实现如需复用，单独做许可证与 attribution 记录。
6. 项目名暂为 Herzi；正式品牌、图标和发布渠道不影响架构。

仍需产品负责人后续确认：

- 是否把 Linux 作为首个 release gate；
- 首版是否必须包含完整终端 controller/takeover；
- 是否允许用户主动打开远程 SSH 模式；
- Chat View 首版需要哪些 tool card 与交互式 approval/question；
- transcript 默认显示/脱敏策略和诊断包策略。

这些选择会改变排期和验收，不改变推荐的底层架构。

## 15. 总结

最短且可持续的路径不是“把 Pi 搬出 Herdr”，而是为 Herdr 已有 PTY 增加两个同步视图：ANSI terminal 与结构化 transcript。Herdr 负责 session/terminal ownership，Pi 文件负责可恢复历史，Pi extension 负责低延迟语义，Herzi host 负责身份映射、合并、安全与 Web 协议。

这条路线能先用一个本地 Node 进程交付，又不会封死未来 daemon + desktop/SSH。长期工程难点包括准确 session identity、分支/compaction 语义、文件替换与漏事件恢复、多客户端写入所有权，以及本机 Web 控制面的安全边界。根据当前“功能优先”的产品要求，MVP 只处理主路径和低成本的必要边界，其余硬化工作在真实使用证明需求后逐步加入。

## 16. 一手来源与证据范围

所有链接访问日期均为 2026-09-03。

### Herdr

- Socket API：<https://herdr.dev/docs/socket-api/>
- CLI Reference：<https://herdr.dev/docs/cli-reference/>
- Integrations：<https://herdr.dev/docs/integrations/>
- Session state：<https://herdr.dev/docs/session-state/>
- 官方仓库（Apache-2.0）：<https://github.com/herdrdev/herdr>
- terminal session 客户端实现：<https://github.com/herdrdev/herdr/blob/master/src/client/terminal_sessions.rs>
- Pi integration v8 实现：<https://github.com/herdrdev/herdr/blob/master/src/integration/assets/pi/herdr-agent-state.ts>
- 本机版本化 schema：[`herdr-api-schema.json`](./herdr-api-schema.json)

### Pi

- Session format：<https://pi.dev/docs/latest/session-format>
- Extensions：<https://pi.dev/docs/latest/extensions>
- RPC：<https://pi.dev/docs/latest/rpc>
- JSON mode：<https://pi.dev/docs/latest/json>
- Security：<https://pi.dev/docs/latest/security>
- 官方仓库（MIT）：<https://github.com/earendil-works/pi>

### Moshi

- Chat View：<https://getmoshi.app/docs/chat-view>
- Hooks / Moshi Hook：<https://getmoshi.app/docs/hooks>
- Desktop install / client-server roles：<https://getmoshi.app/docs/install-desktop>
- Gateway debugging：<https://getmoshi.app/docs/debug-gateway>
- Chat View identity debugging：<https://getmoshi.app/docs/debug-chat-view>

### Orca

- Native Chat 文档：<https://www.onorca.dev/docs/agents/native-chat>
- 官方仓库（MIT）：<https://github.com/stablyai/orca>
- 当前 Native Chat agent 支持列表：<https://github.com/stablyai/orca/blob/main/src/shared/native-chat-agent-support.ts>
- Transcript reader：<https://github.com/stablyai/orca/blob/main/src/main/native-chat/transcript-reader.ts>
- Incremental reader：<https://github.com/stablyai/orca/blob/main/src/main/native-chat/transcript-incremental-reader.ts>
- Watch engine：<https://github.com/stablyai/orca/blob/main/src/main/native-chat/transcript-watch-engine.ts>
- Pi Native Chat feature request：<https://github.com/stablyai/orca/issues/13185>
- Runtime ownership defect example：<https://github.com/stablyai/orca/issues/13716>
- Interactive question propagation：<https://github.com/stablyai/orca/issues/11761>
- Optimistic send mismatch：<https://github.com/stablyai/orca/issues/11511>

### 相邻方案

- agegr Pi Web（MIT）：<https://github.com/agegr/pi-web>
- jmfederico Pi Web（MIT）：<https://github.com/jmfederico/pi-web>
- Picot（MIT）：<https://github.com/shixin-guo/picot>
- Paseo（Apache-2.0）：<https://github.com/getpaseo/paseo>
- Webmux：<https://github.com/windmill-labs/webmux>
- xterm.js（MIT）：<https://github.com/xtermjs/xterm.js>

### 证据限制

- Moshi 的结论来自官方产品文档，未审计闭源客户端源码。
- 本次查看 Orca 官方仓库 commit `968dbd905faa1c34b6b9fe181c6392d698fea632`、Herdr 官方仓库 commit `94f6d9c0d9bb9cf9ffae99d8bbfb09e9bf2fc9e0`；未来上游可能变化。
- 任何工期数字都是单名熟悉 TypeScript/Web/PTY 工程师的粗略估算，不是承诺。
