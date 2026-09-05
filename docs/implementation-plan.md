# Herzi 精简实施计划

> 日期：2026-09-03  
> 状态：首个 Alpha 已于 2026-09-03 实现；当前位于 P3/P4 集成验收关口，完整盘点见 [`project-status.md`](./project-status.md)  
> 关联方案：[`feasibility-and-architecture-report.md`](./feasibility-and-architecture-report.md)

## 1. 当前阶段的原则

项目初期优先尽快形成能用的产品闭环：

1. 先连接真实 Herdr，显示真实 pane，再做 Chat View。
2. 先支持最常见的 Pi 消息，不在首版完整覆盖所有 branch、compaction 和 custom entry。
3. 先使用真实的专用开发 session 手工验证，不建设大规模合成数据和穷举式测试矩阵。
4. 只保留少量能防止明显回归的自动测试；复杂竞态、跨版本矩阵、Windows/WSL 和性能压力测试推迟到产品证明价值以后。
5. 不为未来 daemon、桌面壳或多 agent 提前写大量基础设施，但代码边界不要阻碍后续拆分。

仍保留三条最低限度约束：不启动第二个 Pi runtime 接管已有 session；Web server 默认只监听 loopback；不把浏览器参数拼进 shell 命令。这些约束实现成本很低，但能避免严重的数据与安全问题。

### 1.1 当前进度

| 阶段 | 状态 | 2026-09-03 实际结果 |
| --- | --- | --- |
| P0 | 完成 | Fastify/Vite 单 package、Herdr socket snapshot、Workspace 下按 Pane 平铺的单行导航 |
| P1 | 完成 | official terminal observer → WebSocket → xterm.js，含 resize/sequence resync |
| P2 | 完成 | exact Pi JSONL 当前分支、assistant-ui、thinking/tool/result、Term/Chat toggle |
| P3 | 代码完成、待人工验证 | composer → `agent.prompt`、stop → `agent.send_keys esc`；Terminal 打开即申请 control，不默认 takeover |
| P4 | 代码完成、待安装验收 | 独立 companion extension、token/tool/status/`session_tree`、JSONL 收敛 |
| P5 | 未开始 | 按真实使用反馈处理 |

## 2. 第一版技术选型

### 2.1 Runtime 与服务端

- **Node.js 22 + TypeScript**：Herdr socket、child process、Pi JSONL 和 Web 服务都可在一个进程内完成。
- **Fastify**：提供本地 HTTP、静态文件与少量 API。
- **WebSocket（`@fastify/websocket`/`ws`）**：`/ws` 复用 Workspace snapshot 和 terminal frame。首个 Alpha 的 Chat 先用 1.5 秒 HTTP 轮询，避免提前建设增量事件协议。
- **`node:net`**：直接连接 Herdr 的 Unix socket，读取 snapshot、pane/agent/session 信息并发送 prompt。
- **`node:child_process.spawn`**：调用 Herdr 官方 `terminal session observe/control`，不引入 node-pty，也不重做 Herdr 的 PTY。

### 2.2 Web 前端

- **React 19 + Vite + TypeScript**：开发快，并满足当前 Chat 组件生态。
- **Tailwind CSS 4 +应用内组件**：首个 Alpha 直接实现 Sidebar、Collapsible、segmented toggle 和 composer 样式；需要更多 Dialog/Tooltip/Form 时再按需加入 shadcn/ui 源码组件。
- **assistant-ui + External Store Runtime**：负责 Chat thread、message parts、composer、reasoning 与 tool fallback；Herzi 自己的 store 仍拥有 Pi/Herdr 数据。
- **`@assistant-ui/react-markdown` + `remark-gfm`**：渲染消息 Markdown；不启用 raw HTML。
- **xterm.js 6**：显示和交互 Herdr 输出的真实 ANSI terminal frame。
- **lucide-react**：统一图标。
- **Vitest**：只给少量协议/解析纯函数做快速测试；首版不引入完整 Playwright 套件。

AI Elements 只作为 Tool/Reasoning/Prompt Input 的视觉和独立组件参考，不整体引入其 Next.js/AI SDK runtime。详细比较见 [`ui-research-and-direction.md`](./ui-research-and-direction.md)。

### 2.3 Pi 数据

- 第一版用 Node `fs` 只读打开 Herdr 上报的准确 Pi session JSONL。
- 实现一个小型 line parser，先识别 `session`、`message` 及常见 tool 内容；未知 entry 跳过或显示简单占位。
- 先在文件变化时重新读取并投影当前内容。等大 session 或频繁更新真的出现性能问题，再升级为 byte-offset 增量 watcher。
- 不调用可能迁移并重写用户 session 的 `SessionManager.open()`。
- 不引入数据库；pane、session 和 UI 状态放在进程内存中。

### 2.4 工程组织

初期采用单 package，不创建多 package monorepo：

~~~text
src/
├── server/
│   ├── herdr-client.ts       # socket、snapshot、commands
│   ├── terminal-observer.ts  # observe 子进程
│   ├── pi-session-reader.ts  # JSONL 只读解析与缓存
│   └── index.ts              # Fastify、HTTP 与 WebSocket
├── web/
│   ├── components/
│   │   ├── WorkspaceSidebar.tsx
│   │   ├── TerminalView.tsx
│   │   └── ChatView.tsx
│   ├── App.tsx
│   ├── styles.css
│   └── main.tsx
└── shared/
    └── protocol.ts           # 前后端共享消息类型
~~~

等 daemon/client 真正拆分时，再把 `server` 和 `shared protocol` 提取成独立 package。

### 2.5 运行与桌面包装

- 开发期使用 npm 单 package（本机未安装 pnpm），Node 进程监听本机端口并由普通浏览器打开。
- Web UI 稳定后优先考虑 Electron：主进程可直接复用现有 Node host，改造成本最低。
- Tauri 体积更小，但会引入 Node sidecar 或 Rust 重写；在产品价值确认前不选择它。

## 3. Pi 插件策略

### 3.1 第一版：不新增插件

本机已有的 Herdr Pi integration 会向 Herdr 上报：

- 当前 pane 中运行的是 Pi；
- Pi 的状态；
- 准确的 session id/path。

因此第一版 Chat View 可以直接：

1. 从 Herdr snapshot 得到 pane 对应的 Pi session path；
2. 读取该 JSONL；
3. 在文件变化后刷新 Chat View；
4. 发送 prompt 时仍调用 Herdr，把输入写回同一个 pane。

这已经能完成“已有 session + Terminal/Chat 切换 + Chat 中发消息”的基本闭环。限制是 assistant 生成过程中可能暂时只能在 Terminal View 看到，等 Pi 把完成消息写入 JSONL 后 Chat View 才刷新。

### 3.2 第二版：可选的 Herzi Pi companion extension

只有当需要更流畅的实时体验时，才新增独立 `herzi-bridge.ts`。它不替换也不修改 Herdr 管理的插件，只旁路上报：

- `message_start/update/end`：assistant token streaming；
- tool start/end：实时 tool card 状态；
- `agent_start/settled`：working/idle；
- `session_tree`：Pi 在 `/tree` 中切换后的当前 leaf；
- session start/switch：运行时 session 身份确认。

插件只上报增量事件，不传整份历史。插件不存在或连接失败时，Pi 和第一版 Chat View 仍正常工作。

## 4. 开发阶段

### P0：项目骨架与 Herdr 连接（1–2 天）

- 初始化 Node/TypeScript/Fastify/Vite/React。
- 连接本机 Herdr socket，获取 session snapshot。
- 页面列出 workspace、tab 和 pane。
- 显示 pane 的 agent/status/session 基本信息。

完成标志：浏览器能看到当前真实 Herdr pane 列表，Herdr 重启后刷新页面可以重新连接。

### P1：Terminal View（2–4 天）

- 启动 `herdr terminal session observe`。
- WebSocket 把 `terminal.frame` 转发给浏览器。
- xterm.js 解码 base64 ANSI bytes 并显示。
- 支持基本 resize；如果时间允许，同阶段加入键盘 control，否则放到 P3。

完成标志：浏览器里的 TUI 与真实 pane 基本一致，可以持续看到更新。

### P2：Pi Chat History（3–5 天）

- 从 pane 取得 Herdr 上报的 exact Pi session path。
- 只读解析 JSONL 中常见 user/assistant/tool 内容。
- 用 assistant-ui External Store Runtime 映射 Herzi messages；若半天内发现明显模型冲突，退回 shadcn + 自有 message list，不调整后端数据模型。
- 文件变化后刷新 Chat View。
- 增加 Terminal/Chat toggle，同一 pane 间切换不启动新进程。
- 侧栏数据仍按 Workspace → Tab → Pane 读取，但视觉上把各 Tab 的 Pane 平铺；每行绑定一个真实 Pane ID，显示所属 Tab label 与 Pane 类型图标。
- 选择新 Pane 时，Herdr 已识别到 agent 则默认进入 Chat；普通 shell Pane 默认进入 Terminal。当前 Pane 的手动模式切换保持到下一次选择 Pane。
- 无 Pi 时保留 Terminal；已识别 Pi 但尚无 session path/JSONL 时显示可发送的空 Chat，首条 prompt 仍通过 Herdr 发往当前 Pane，文件出现后轮询自动接入历史。历史读取失败只提示错误，不禁用 composer。

完成标志：一个真实开发 Pi session 可以在 Chat View 中看到历史与新完成的回复。

### P3：输入与可用闭环（2–4 天）

- Chat composer 通过 Herdr `agent.prompt` 发送到所选 pane。
- 支持 stop/Esc。
- 根据 Herdr 状态显示 working/idle/blocked。
- 补齐 Terminal control、控制权提示和最基础的错误提示。

完成标志：用户可以只在浏览器里选择已有 Pi pane、查看 Chat、发送问题、看到回复，并随时切回 TUI。

### P4：实时 Chat 增强（可选，3–6 天）

- 编写独立 Pi companion extension。
- 接入 message delta、tool lifecycle、agent settled 和 session tree。
- 把生成中的临时消息与随后落盘的 JSONL 消息合并。

完成标志：不切 Terminal 也能看到 assistant 流式生成和常见 tool 状态；禁用插件后仍退回 P2 的最终一致模式。

2026-09-03 实施结果：代码链路已经完成，见 [`pi-realtime-bridge.md`](./pi-realtime-bridge.md)。尚未改动用户的全局 Pi 设置，也未对现有 Pane 执行 `/reload`；安装后真实 prompt/tool/`/tree` 验收通过时再把 P4 标记为完全完成。

### P5：按真实使用反馈修补

只有在真实开发使用中遇到后，再按优先级处理：

- 大 transcript 的增量读取和分页；
- 文件 truncate/replace 的完整恢复；
- 多浏览器 controller lease；
- 更多 Pi branch/compaction/custom entry；
- Windows/WSL；
- daemon + desktop client + SSH；
- 其他 coding agent。

## 5. 精简验证方式

每个阶段只做以下验证：

1. 使用一个专门、无敏感内容的真实 Herdr + Pi 开发 session 手工走通主流程。
2. 为纯函数保留少量单元测试，例如 terminal frame 解码、JSONL 单行解析和前后端消息校验。
3. 保留一条端到端冒烟流程：打开页面 → 选 pane → 看 Terminal → 切 Chat → 发 prompt → 看到完成回复。
4. 每次完成阶段后把实际命令、结果、已知问题写入 `docs/development-log.md`。

第一版不要求：

- 手写大量合成 transcript/terminal 数据；
- 穷举 watcher race、rotation、同尺寸重写等异常；
- 大规模性能/压力测试；
- 跨多个 Herdr/Pi 版本的兼容矩阵；
- 完整 Playwright 浏览器测试套件；
- Windows/WSL 专项测试。

## 6. 初步排期

不含可选实时插件时，第一条完整产品链路预计约 **8–15 个工程日**：

| 阶段 | 预计 |
| --- | --- |
| P0 骨架与 Herdr | 1–2 天 |
| P1 Terminal | 2–4 天 |
| P2 Chat History | 3–5 天 |
| P3 输入闭环 | 2–4 天 |

P4 实时 extension 另需约 3–6 天。估算以功能验证为目标，不包含桌面打包、视觉精修、远程 SSH 和正式公开发布。

## 7. 第一版验收标准

第一版达到以下条件即可认为成功，不等待完整硬化：

- 能连接当前机器的 Herdr，并列出现有 pane。
- 能在 Web UI 中实时显示选中 pane 的 TUI。
- 对有准确 session path 的 Pi pane，能显示常见 Chat 历史。
- 能从 Chat composer 向同一个 pane 发送 prompt 并看到完成回复。
- Terminal/Chat 切换不会新建或重启 Pi。
- 失败时能回到 Terminal，不会误连到另一个 Pi session。
- 服务默认只监听本机，不把用户输入拼成 shell 字符串。
- 实际开发过程和已知问题已经写入 `docs/`。
