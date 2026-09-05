# Herzi 开发记录

> 本文只记录实现过程、验证结果与已知问题，不记录私人会话正文、session 文件路径或 terminal 内容。

## 2026-09-03 — 首个可运行 Alpha

### 本轮目标

按照“功能优先、减少防备性测试”的要求，直接打通以下真实链路：

1. 单个本机 Node 进程连接已经运行的 Herdr；
2. Web UI 显示 Workspace → Tab → Pane 导航；
3. 选择 Pane 后通过 xterm.js 显示官方 terminal observer 帧，并在用户明确点击后申请 control；
4. 对 Herdr 已准确识别的 Pi Pane，读取其 JSONL 当前分支并显示 Chat；
5. Chat 输入经 Herdr `agent.prompt` 回到同一个 Pi Pane；运行中可发送 `esc` 停止。

### 环境与实现前确认

- 时间：2026-09-03 约 17:30–18:00 CST。
- 本机 Herdr：0.8.2，socket protocol 20，server 已运行。
- 本机 Node：25.9.0，npm：11.12.1；pnpm 未安装。
- 直接连接 Herdr Unix socket 并请求 `session.snapshot` 成功。
- 快照的聚合验证为 6 个 workspace、17 个 tab、17 个 pane，其中 10 个 pane 带准确的 Pi path session 引用。日志未输出 workspace 名称、session 路径或会话正文。
- 因 pnpm 不存在，本轮改用 npm。生产目标限定为 Node LTS 22/24 或 26+；当前非 LTS Node 25 可以完成构建，但 npm 会为 `nanoid` 的 LTS-only engines 范围发出警告。

### 实现内容

#### 工程骨架

- 建立单 package 的 React 19 + Vite 8 + TypeScript 5.9 前端。
- 建立 Fastify 5 + WebSocket 的本机服务，默认只监听 `127.0.0.1:3030`。
- 生产构建由 tsup 输出 Node ESM server，由 Vite 输出 Web 静态资源；Fastify 直接托管 `dist/web`。
- 增加 `.gitignore`，排除 `node_modules/`、`dist/`、系统文件和日志。

#### Herdr 连接与资源导航

- `src/server/herdr-client.ts` 通过 `herdr status server --json` 发现 socket，再使用 LF 分隔 JSON 请求 `session.snapshot`。
- 每 1.5 秒刷新一次快照；socket 被 Herdr 关闭后下一轮会重新发现并连接。
- Browser DTO 只暴露 UI 所需的 workspace/tab/pane、agent/status 和 `hasChatSession`；Pi session 的真实 path 只保留在服务端内存，不下发浏览器。
- 左侧 Workspace 树显示 Herdr 的完整层级、选中态和 agent 状态；顶部显示当前 Pane，并提供 `Term / Chat` 双向切换。
- 窄屏默认收起 Workspace 树，通过 header 按钮打开；选择 Pane 后自动收起，避免侧栏覆盖内容后无法退出。

#### Terminal View

- 服务端对选中 Pane 启动 `herdr terminal session observe <pane> --cols <n> --rows <n>`，不接管或创建第二个 PTY。
- JSONL `terminal.frame` 通过 WebSocket 转发；浏览器把 base64 `bytes` 解码并交给 xterm.js。
- 实测确认 `encoding` 是解码后格式 `ansi`，而不是传输编码名；此前假设为 `base64` 的判断已在实现中修正。
- ResizeObserver 在 xterm 行列数变化后重开 observer 获得相应尺寸；检测到非 full 帧 sequence gap 时也重开 observer。
- 默认是只读 Terminal。用户点击“启用输入”后才启动 `herdr terminal session control`，不传 `--takeover`；第一帧到达后视为取得控制权，xterm 键盘输入通过 JSONL `terminal.input` 写入。
- control 状态下 resize 使用 `terminal.resize`；用户点击“释放控制”、切换 Pane、关闭 WebSocket 或服务退出时发送 `terminal.release`/终止 child process，再回到 observer。
- 为实现这条链路再次核对了 Herdr 官方 `src/client/terminal_sessions.rs`；目前没有实现 mouse/scroll control，也没有 takeover UI。

#### Pi Chat History

- `src/server/pi-session-reader.ts` 只使用 `node:fs` 读取 Herdr 对该 Pane 上报的 exact path，不调用可能迁移/重写文件的 Pi `SessionManager.open()`。
- 为确定格式，只对一个真实 session 统计了 entry/message/content 的键名与类型，没有打印任何内容或路径。
- 当前支持 Pi `session`、`model_change`、`thinking_level_change`、`message` 中的：
  - user/assistant 文本；
  - assistant thinking；
  - image data URL；
  - toolCall arguments；
  - toolResult 与 toolCallId 配对、错误状态。
- 当前分支用最后一条 entry 沿 `parentId` 回溯得到。它符合落盘后的当前 leaf；用户刚在 Pi `/tree` 导航但尚未产生新 entry 的短窗口仍需要 P4 extension 才能精确识别。
- 文件 `mtime + size` 未变化时复用内存缓存；Chat 打开时每 1.5 秒拉取一次。首版没有 byte-offset 增量读取。

#### assistant-ui 接入

- 使用 `useExternalStoreRuntime` 映射 Herzi 持有的消息，不创建或拥有第二个 Pi runtime。
- `unstable_enableToolInvocations` 明确保持为 `false`，浏览器只渲染 Pi 已执行的工具，不重复执行。
- 使用 assistant-ui Thread、Message、Composer primitives；Markdown 使用 `@assistant-ui/react-markdown`，并加入 `remark-gfm`。
- 一个实现层面的澄清：`@assistant-ui/react` npm 包提供 tool-call part、状态、renderer slot 和 `ToolCallMessagePartProps`，但不直接导出带完整视觉的 `ToolFallback` 成品。官方 starter/CLI 中的 ToolFallback 属于可复制修改的应用组件。因此 Herzi 本轮实现了自己的紧凑可折叠 tool card，显示 arguments/result/error/running；以后可按 tool name 注册专用 renderer。
- ChatView 使用动态 import，避免 Terminal 首屏同步载入整个 assistant-ui/Markdown 包。

#### Chat 输入与停止

- `POST /api/panes/:paneId/prompt` 检查 Pane 仍存在且为 Pi，再调用 Herdr `agent.prompt`；文本不进入 shell 参数。
- `POST /api/panes/:paneId/cancel` 调用 Herdr `agent.send_keys`，向同一 Pane 发送规范键名 `esc`。
- 本轮未对私人 Pane 实际发送 prompt 或 cancel，避免改变正在进行的用户会话；只验证路由、schema 和构建。

### 当前内部接口

| 接口 | 用途 |
| --- | --- |
| `GET /api/health` | Herzi/Herdr 简单健康状态 |
| `GET /api/bootstrap` | 当前可公开给 UI 的 Herdr Workspace 树 |
| `GET /api/panes/:paneId/chat` | 读取所选 Pi Pane 当前 JSONL 分支 |
| `POST /api/panes/:paneId/prompt` | 向同一个 Pi Pane 发送文本 |
| `POST /api/panes/:paneId/cancel` | 向同一个 Pi Pane 发送 `esc` |
| `GET /ws` | Workspace 快照更新与 terminal observe 帧 |

### 验证记录

执行并通过：

~~~bash
npm run typecheck
npm run build
npm audit --omit=dev --json
~~~

- TypeScript 无错误。
- server 与 web production build 均成功。
- production dependency audit：0 个已知漏洞；完整依赖树仍报告 1 个 low severity 开发依赖问题，本轮没有执行可能扩大升级范围的自动修复。
- 真实 Herdr 冒烟：静态首页返回成功；bootstrap 返回 Herdr 0.8.2/protocol 20；Pi Chat endpoint 返回 197 条当前分支消息与 196 个已配对工具调用；这些数字仅作为当次结构验证，不保存正文。
- terminal WebSocket 首帧成功：`seq=1`、`encoding=ansi`、`full=true`、90×28、base64 解码后 4,873 bytes。验证脚本只输出元数据，不输出终端内容。
- WebSocket 回归确认 observer 仍能取得 `ansi` full frame；向不存在的 Pane 申请 control 会在启动 child process 前被拒绝。
- Browser 控制能力当时未发现可用浏览器实例，因此尚未完成真实浏览器视觉/交互检查；没有改用额外 Playwright 套件，以遵守精简测试约束。为避免改变现有用户终端，也没有在真实 Pane 上自动申请 control 或注入按键。

### 运行方法

开发模式（服务端 3030，Vite 5173）：

~~~bash
npm install
npm run dev
~~~

生产模式：

~~~bash
npm run build
npm start
~~~

打开 <http://127.0.0.1:3030/>。开发模式打开 <http://127.0.0.1:5173/>。

### 已知限制与下一步

1. 后续故障修复阶段已经完成真实浏览器的加载与基础 DOM 检查；仍需要用户对布局、滚动、Markdown、tool card、Terminal/Chat 切换和 composer 做主观验收。
2. Terminal 的默认 control 已实现，但尚需用户在专用开发 Pane 上人工验证“输入 → resize → wheel scroll”；目前不提供 `--takeover` 或 mouse control。
3. Chat 的 Pi companion extension 代码已经完成；未安装时仍是 1.5 秒轮询 + 完成消息最终一致。安装和真实 streaming/tool/`/tree` 写入式验收待进行。
4. 大 session 仍会在文件变化时整文件读取；真实使用确认出现性能问题后再做 offset 增量。
5. Chat 发送/停止已经实现但未对用户真实 agent 做写入式冒烟。首次手动验证应使用专用开发 Pane。
6. assistant-ui 与 xterm 仍形成较大分包；Chat 已按需载入，后续只在首屏性能真的成为问题时继续拆包。

相关一手实现来源（访问：2026-09-03）：

- <https://github.com/herdrdev/herdr/blob/master/src/client/terminal_sessions.rs>

## 2026-09-03 — 空白页与 JavaScript MIME 故障修复

### 用户报告

打开 Herzi 后页面为空，浏览器控制台报告：module script 请求预期 JavaScript/Wasm，但服务器返回 `text/html`。

### 复现与根因

本地重新运行 `npm run dev` 后复现了静态托管问题：

1. `src/server/index.ts` 原本用当前入口文件目录推导 Web root。tsx 开发模式下入口位于 `src/server`，于是错误地把 `src/web` 当成生产构建目录；该目录没有 `index.html`。
2. 生产 SPA fallback 对所有非 `/api` GET 请求返回 `index.html`。当浏览器持有一次旧构建的 hashed JS URL，或者请求不存在的 asset 时，`.js` 路径也得到 200 + HTML，触发严格 MIME 拒绝并造成空白页。
3. 此前交付前只用 curl 验证了当时存在的 asset，没有验证“缺失 `.js` 必须返回 404”，也没有在重新启动的开发模式访问 3030，因此漏掉了问题。

### 修复

- `npm run dev` 的 server 子进程现在显式设置 `HERZI_DEV=1`。
- 开发模式访问 `http://127.0.0.1:3030/` 会 302 到 Vite 的 `http://127.0.0.1:5173/`，不再尝试从源码目录托管静态资源。
- 生产模式的 Web root 固定为项目 `dist/web`，不再依赖开发入口位置。
- `index.html` 返回 `Cache-Control: no-store`，避免旧入口长时间引用已经被新构建删除的 hashed asset。
- SPA fallback 只响应接受 `text/html` 且没有文件扩展名的客户端路由；`/assets/*`、`.js`、`.css` 等缺失资源明确返回 JSON 404。
- 未构建 `dist/web/index.html` 时，生产根路径返回解释性的 503 文本，而不是空白页或错误 fallback。

### 修复后验证

- `npm run build`：TypeScript、server build、web build 全部通过。
- 开发入口：3030 返回 302 到 5173；Vite 首页为 `text/html`；`/src/web/main.tsx` 为 `text/javascript`。
- 生产入口在独立端口 3031 验证：首页 200 + `text/html` + `Cache-Control: no-store`；hashed JS 为 `application/javascript`；CSS 为 `text/css`。
- 生产模式请求不存在的 `/assets/missing.js` 返回 404 + `application/json`，不再返回 HTML；无扩展名的客户端路由仍正确返回 SPA 首页。
- 使用真实浏览器分别打开开发入口和生产入口：标题为 Herzi，`.app-shell` 与 Herdr Workspace 导航均已渲染，控制台错误为 0。
- 未进行 Chat 发送、Terminal control 等写入式操作。

## 2026-09-03 — Terminal 输入、顶部切换器与滚动修正

### 用户反馈

1. Terminal 应默认允许输入，不应要求用户在“启用输入/释放控制”之间切换；原切换流程本身也有 bug。
2. 顶部 `Term / Chat` segmented control 被错误拉伸到最右侧。
3. Terminal 上下滚动没有与 Herdr 的远端 scroll 协议正确适配。

### 根因与修改

- **输入模式**：此前 TerminalView 先启动 observer，等待用户点击后才切换为 controller，产生了额外状态与切换竞态。现在 Terminal mount/切换 Pane/从 Chat 返回时直接发送 `control`，首帧确认后立即启用 xterm 输入；移除整个控制按钮和对应 UI 状态。Pane 切换或组件卸载仍通过 `stop` 关闭 child process，由服务端释放 controller。
- **顶部切换器**：header 原来使用三列 CSS Grid，但桌面端第一个 sidebar 按钮是 `display:none`。剩余元素自动落入前两列，导致 `view-switch` 占据 `minmax(0, 1fr)` 的伸展列。header 已改为 Flex；Pane 标题使用 `flex: 1 1 auto`，切换器使用 `inline-flex + width: fit-content + flex: 0 0 auto`。
- **远端滚动**：浏览器现在在 xterm host 的 capture 阶段拦截垂直 wheel，阻止 xterm 仅滚动本地 buffer；把 pixel/line/page delta 归一化并按 animation frame 合并，然后发送 `terminal.scroll`。服务端验证 Pane/controller 后调用 control child stdin，写入 `{type:"terminal.scroll", direction, lines, source:"wheel"}`。单帧最多 100 行，避免高分辨率触控板产生无界请求。
- 如果默认 control 因已有 controller 等原因失败，页面会自动回退 observer 并明确显示当前只读，而不是重新显示控制切换按钮。
- Terminal sequence gap 现在重建 control session，不再错误地降级为 observer 后失去输入。

### 验证

- `npm run build` 通过，包含 TypeScript、server bundle 和 Vite production bundle。
- 纯前端真实浏览器布局检查：1280px viewport 下 header 宽 952px，`Term / Chat` 控件宽 152px，右边距 16px；`.terminal-control` 不存在。
- 当前执行环境不在 Herdr Pane 内（`HERDR_ENV` 检查失败）。按项目的 Herdr 控制规范，本轮没有从外部环境启动服务或接管真实 Pane，因此默认输入、wheel → remote scroll 的写入式验证待在 Herdr 环境内完成。

## 2026-09-03 — 生产构建后 hashed asset 404 修复

### 用户报告

3030 首页引用的 `/assets/index-CL5yK6l_.css` 与 `/assets/index-Cx1qPf5B.js` 均返回 404，页面仍然无法打开。

### 现场证据与根因

- 监听 `127.0.0.1:3030` 的 `node dist/server/index.js` 于 18:28:29 启动。
- 当前 `dist/web/index.html` 与两个被请求的 asset 均于 18:49:43 生成，文件名和入口引用完全一致。
- 同一时刻，首页由 3030 返回 200，但磁盘上确实存在的两个 asset 都由 3030 返回 JSON 404。
- `@fastify/static` 配置了 `wildcard: false`。该模式会在插件注册时扫描文件并逐一创建固定路由，而且官方说明明确指出它不会服务后来新增的文件。因此运行中的服务只认识 18:28 启动时的旧哈希，新构建产生的哈希没有路由。

### 修复

- 静态托管改为 `wildcard: true`，通过 wildcard route 在请求时解析实际文件；后续执行 `npm run build:web` 后无需重启服务就能识别新哈希资源。
- Vite 改为 `emptyOutDir: false`，保留以前构建生成的 hashed asset。这样已经打开的旧页面即使跨过一次本地重建，仍能完成旧 JS/CSS 请求。
- 继续保留上一轮的安全边界：缺失 asset 返回真正的 404，不会被 SPA fallback 伪装成 HTML；`index.html` 继续使用 `Cache-Control: no-store`。

### 验证

- `npm run build` 通过：TypeScript、server bundle 与 Vite production bundle 均成功。
- 重启当前项目的生产进程后，用户报告的 `index-Cx1qPf5B.js` 返回 200 + `application/javascript`，`index-CL5yK6l_.css` 返回 200 + `text/css`。
- 缺失的 `/assets/missing.js` 仍返回 404 + `application/json`，没有回归为错误的 HTML fallback。
- 为直接验证“服务启动后新增文件”场景，在运行中的 3030 服务启动后临时加入一个 asset；无需重启即返回 200，随后已移除该临时文件。
- 真实浏览器重新打开 `http://127.0.0.1:3030/`：标题为 Herzi，Workspace 导航、Term/Chat 与 Terminal input 均已渲染；浏览器控制台 error 为 0。

## 2026-09-03 — P4 Pi 实时 Chat bridge

### 目标与取舍

按原实施计划继续进入 P4。保持功能优先：只实现一条可降级的实时链路，不新增数据库、消息队列、第二个 agent runtime 或大规模测试夹具。

### 本机接口核对

- 本机 Pi 为 0.84.4。安装包公开 extension API 包含 `message_start/update/end`、`tool_execution_start/update/end`、`agent_start/agent_settled`、`ui_prompt_start/end` 和 `session_tree`。
- `message_update` 提供当前完整 assistant message 以及 token 事件；`message_end` 在 session persistence 前触发，因此不能把该时刻的 `getLeafId()` 当作新 entry id。
- Herdr 管理的 Pi integration 会从环境读取 `HERDR_PANE_ID`，并用 `getSessionFile()` 上报 exact path。新 bridge 放在独立目录中，没有修改 Herdr 管理且会被升级覆盖的文件。
- 当前 Codex 执行环境的 `HERDR_ENV` 检查失败。按 Herdr 操作规范，本轮没有从外部控制或读取任何 Pane，只读取了本机已安装包的公开文档/类型和 integration 源码。

### 实现

- 新增 `integrations/pi` 本地 Pi package。扩展只在 Herdr TUI 中启用，把消息、tool、状态和分支事件按 60 ms 合并后异步 POST 到 loopback；Herzi 不存在时静默降级，不阻塞 Pi turn。
- 新增 `/api/integrations/pi/events`。服务端要求 `paneId + sessionPath` 与最新 Herdr snapshot 一致，随后把 runtime state 通过既有 `/ws` 广播。
- 新增 `PiRealtimeStore`，保留每个 Pane 当前 runtime 的最近 live message、tool 状态、working/waiting/idle 与 branch leaf；新浏览器连接也会收到现有实时快照。
- JSONL reader 支持显式 leaf。`session_tree` 发生后立即显示该 leaf；下一条消息落盘后恢复跟随文件末尾。
- Chat View 把 live 与 JSONL 消息按原始 `role + timestamp` 合并。相同消息落盘后自然由持久版本替代，tool complete 结果在对应 `toolCallId` 上覆盖；extension 未连接时 footer 明确显示“JSONL 同步”。
- 完整数据流、安装方式和限制见 [`pi-realtime-bridge.md`](./pi-realtime-bridge.md)。

### 验证

- `npm run typecheck` 与 `npm run build` 均通过；TypeScript 检查范围已包含 companion extension。
- 新 server bundle 已在 3030 重启；`/api/health` 返回 `ok=true` 且当次 `herdrConnected=true`。
- bridge endpoint 对空 batch 返回 400，没有把无效输入广播给浏览器。
- 真实浏览器打开 production 页面并切换 Chat：JSONL 历史、tool card、composer 与 fallback 同步标识正常渲染，控制台 error 为 0。
- 本轮没有安装全局 Pi package，也没有发送 prompt、按键或 `/reload`；因此真正的 token/tool/branch 事件仍需在专用 Pane 中做一次人工验收。

## 2026-09-03 — Codex 风格 Chat activity 折叠

### 用户反馈

- 完成 turn 需要显示 `Worked for <duration>`，并默认折叠最后正文之前的全部 assistant 过程消息。
- 连续工具调用需要合并，thinking/tool 在收起状态只显示一行摘要和省略号。
- agent 运行期间，消息末尾需要 `working`（或可用的 waiting 状态）与旋转指示。
- 首版实现后用户进一步指出：展开 `Worked for` 时还应包含过程中的普通 assistant message，不能只包含 thinking/tool。本节以下实现已按该反馈修正。

### 实现

- `ChatMessage` 新增可选 `completedAt`。JSONL reader 使用 assistant entry timestamp，Pi bridge 在 `message_end` 使用当前时间。
- Chat View 把一个 user message 后的连续 assistant messages 合并为 display turn；最后一个非空 text/image 是最终输出边界。
- 完成 turn 在最终 text/image 之前的 text、image、reasoning 和 tool parts 全部转换为 assistant-ui `data-activity` part，使用自定义 renderer 输出默认关闭的 `Worked for …`。
- 折叠区中的普通 text 通过 assistant-ui `TextMessagePartProvider` 继续使用现有 Markdown renderer 完整显示；图片保持原始输出。只有最后一个 text/image part 留在折叠区外。
- 运行中的相邻 tool-call 自动组合为 `Ran N tools`；单个 thinking/tool 以及展开后的 activity item 都显示本地生成的一行摘要。
- 原工具卡片改为轻量行式 UI；arguments/result 仍可二次展开，不丢失调试信息。
- Chat 消息末尾新增运行状态条；无 realtime bridge 时使用 Herdr snapshot 的 running 状态并显示 `working`。

### 验证

- `npm run build` 完整通过。
- 重启 production server 后，首页与当前 hashed JS/CSS 均正常返回，Chat API 包含 `completedAt`。
- 使用浏览器在既有 Pi session 上做只读检查：完成会话的 `Worked for` 默认关闭；含普通过程消息的真实 turn 在关闭时只显示 `Worked for` 与最终正文，展开后确认 3 条普通 assistant message 位于折叠区内，且 Markdown、Thinking/tool 摘要与二级详情均正常。
- 正在运行的真实 Pane 中可见 `Ran 2 tools`/`Ran 3 tools` 与底部 `working` spinner；未对 agent 发送输入或取消命令。
- 规则、公开资料边界和限制详见 [`chat-activity-ui.md`](./chat-activity-ui.md)。

## 2026-09-03 — Markdown 表格、行内代码与完整高度展开

### 用户反馈

- GFM 表格虽已解析成 HTML table，但缺少主题样式，视觉结构错误。
- 行内 code 缺少基础颜色区分。
- `Worked for` 展开后不应出现固定高度与内部纵向滚动，应直接完整展开。

### 修改

- 为 `.markdown-body table` 补充完整宽度、外边框、圆角、表头底色、单元格分隔线、斑马纹和长内容换行。
- 行内 code 改为浅绿色背景、绿色文字与细边框；`pre code` 继续显式覆盖为 fenced code block 的深色主题。
- 删除 `.activity-list` 的 `max-height: 360px` 与 `overflow-y: auto`。展开区现在按全部内容自然增高，页面只保留外层 Chat viewport 滚动。

### 验证

- `npm run build` 通过，TypeScript、server 和 Vite production bundle 全部成功。
- 既有真实会话中检测到 2 个 `.markdown-body table` 和 16 个段落内 code，确认不是使用合成 fixture 验证。
- 计算样式确认 table 使用独立边框和 865px 当前可用宽度；行内 code 使用 `rgb(82, 106, 67)` 文字、`rgb(237, 241, 232)` 背景和 1px 边框。
- 展开真实 activity 后，`.activity-list` 的 `clientHeight` 与 `scrollHeight` 都为 1303px，`max-height: none`、`overflow-y: visible`，没有内部纵向滚动。

## 2026-09-03 — 恢复 Worked for 内层工具折叠

### 用户澄清

`Worked for` 外层展开后应完整展示整个过程且不产生内部滚动，但其中连续出现的多个工具调用仍应保留第二层折叠。两项要求并不冲突：外层控制过程是否可见，内层控制连续 tool group 的明细是否可见。

### 修改

- 完成态 activity renderer 在保持原始顺序的同时扫描连续 tool item。
- 两个及以上相邻工具合并为默认关闭的 `Ran N tools`；单工具继续直接显示。
- 内层摘要显示工具数量、工具名预览和总体完成/错误/运行状态；展开后显示原有逐工具摘要，工具参数与结果仍可继续展开。
- 未恢复任何 `max-height` 或 `overflow-y`，外层依旧按自然内容高度展开。

### 验证

- `npm run build` 通过。
- 真实历史会话的首个 `Worked for` 内识别到 8 个连续工具组，初始 `open` 状态全部为 false。
- 首个 `Ran 5 tools` 展开后包含 5 个真实 tool item；其余普通 message 与 Thinking 顺序保持不变。
- 外层 activity list 的 `clientHeight=710px`、`scrollHeight=710px`、`max-height=none`、`overflow-y=visible`，确认两层折叠没有引入外层内部滚动。

## 2026-09-03 — Agent Pane 默认进入 Chat

### 用户要求

切换到一个 Pane/Tab 后，如果 Herdr 已识别到其中的 agent，应默认显示 Chat，而不是 Terminal。

### 实现

- 视图选择从单一全局 `mode` 改为带 `paneId` 的当前 Pane 手动选择。
- 新选择的 Pane 没有手动选择记录时，根据 `pane.agent` 决定默认模式：存在 agent 使用 Chat，否则使用 Terminal。
- 在当前 Pane 点击 Term/Chat 后，手动选择保持有效，不会被后续 WebSocket snapshot 对象刷新覆盖。
- 从侧栏选择另一个 Pane 时清除旧 Pane 的手动选择；以后切回 agent Pane 会重新采用 Chat 默认值。
- 已识别但当前没有受支持 Chat session 的 agent 仍进入 Chat，并显示现有的“暂无 Chat 数据”状态；不会悄悄退回 Terminal。

### 验证

- `npm run build` 通过。
- 真实初始 Pi Pane：`Chat aria-selected=true`、`Term=false`。
- 切换到无 agent 的真实 shell Pane：`Term=true`、`Chat=false`。
- 再切换到 Pi agent Pane：自动恢复 `Chat=true`。
- 在同一 Pi Pane 手动切到 Term 并等待状态更新后仍保持 Term；切走再返回时按默认规则回到 Chat。

## 2026-09-03 — 无初始 session 的 Pi Chat 允许发送

### 用户反馈与根因

用户可能直接在 Terminal 中启动 `pi`，此时 Herdr 已识别 agent，但 Pi 在收到第一条消息前可能还没有可读取的 session JSONL。原实现有两个阻断点：

1. App 只有在 `hasChatSession=true` 时才渲染 `ChatView`，否则显示没有 composer 的静态空状态。
2. Chat API 在 session path 缺失时返回 404；path 已上报但文件尚未创建时，`stat` 抛出 `ENOENT` 并返回 503。ChatView 又把任何历史读取错误映射为 `isDisabled=true`。

旧服务现场日志中观察到真实的过渡窗口：同一 Pi Pane 的 JSONL path 连续数次 `ENOENT → 503`，随后文件创建后恢复 200。这与用户描述一致。

### 修改

- 已识别 Pi 的 Pane 无论 `hasChatSession` 是否为 true，都渲染完整 `ChatView` 和 composer。
- Chat API 对“Pi 存在但 session path 为空”返回 `messages=[]` 的 200 空快照。
- session path 存在但文件尚未创建时，把 `ENOENT` 同样映射为空快照，不再记录成暂时性服务故障。
- composer 是否可用只取决于当前 Pane 是否为 Pi，不再由历史读取错误决定。真正的读取错误仍显示在 composer 上方，但不阻断用户发送第一条消息。
- Prompt 路径未改变：`POST /api/panes/:paneId/prompt` 继续调用 Herdr `agent.prompt`，不依赖 session 文件。后续 1.5 秒轮询会在 JSONL 创建后自动加载历史。

### 验证

- `npm run build` 通过；server 与 web 已重新构建并在 3030 重启。
- 当前所有真实 Pi Pane 都已经有历史，未为了测试而创建或干扰新 Agent；使用旧服务的真实 `ENOENT` 日志作为“文件未创建”现场证据。
- 在现有 Pi Chat 中确认默认选择 Chat、输入框未禁用；只在输入框临时键入未提交文本后，发送按钮由 disabled 变为 enabled，随后清空。没有向任何用户 Agent 发送测试 prompt。

## 2026-09-03 — 侧栏按 Pane 单行平铺

### 用户澄清

侧栏的交互单位应是 Pane，而不是 Tab。常见的一 Tab/一 Pane 应自然显示为一行；同一 Tab 发生 split 时，每个 Pane 仍要成为一条独立、平铺的可选行。点击某一行后，主视图必须选择该行绑定的准确 Pane，不能只选择 Tab 后再推断 Pane。

### 修改

- 保留服务快照中的 Workspace → Tab → Pane 数据关系，但渲染时在每个 Workspace 内把所有 `tab.panes` 展平成一个列表，移除可见的 Tab 分组标题。
- 每行 `key`、点击目标和选中态都直接使用 `pane.id`；显示文字只使用所属 Herdr Tab 的 `tab.label`。
- Pi Pane 使用专门的 `π` 图标，普通 shell 使用 Terminal 图标，其他已识别 agent 使用通用 agent 图标；状态点继续取当前 Pane 的状态。
- 同一 Tab 的多个 Pane 会出现多行相同 Tab label，由环境图标区分；完整 Pane title 与 opaque Pane ID 放在 tooltip 中，避免增加第二行。
- Pane label 使用独立 class 承担省略号与伸展，避免旧的通用 `span` 规则把文本型 `π` 图标拉宽；三种环境图标现在共用 16px 固定列宽。

### Herdr 验证边界

当前开发线程的 `HERDR_ENV` 检查失败，因此本轮没有调用 Herdr CLI 读取、聚焦或控制会话。只读检查了当前本地服务的 `/api/bootstrap` 快照，其中 `herzi` Workspace 的 Tab `1` 确实包含 Pi 与 Terminal 两个 Pane，可用于页面侧验证平铺和精确选择。

### 验证

- `npm run build` 通过，包括 TypeScript、server bundle 与 Vite production bundle；仅保留既有的 bundle size 提示。
- 本地服务快照共有 17 个 Pane，页面 DOM 对应出现 17 个 `.pane-row`，旧 `.tab-label` 数量为 0；其中 11 个 Pi Pane 显示 `π` 图标。
- `herzi` 的同名 Tab `1` 在侧栏显示为两行：`1，Pi agent` 与 `1，Terminal`。点击前者后 header 为 `π - herzi` 且默认选择 Chat；点击后者后 header 为 `~/a/herzi` 且默认选择 Term，确认两行分别绑定不同 Pane ID。
- 页面未发送 prompt、键盘输入或取消命令。选择 Terminal 时，前端按既有 TerminalView 生命周期建立了 controller；验收后立即关闭页面，由 WebSocket teardown 释放连接。

## 2026-09-04 — 新建 Pi session 首条用户消息即时显示

### 用户反馈与根因

用户可能先在 Terminal 中启动 Pi，再切换 Chat。此时 Herdr 已识别 agent，但 Pi session JSONL 尚未创建。Chat composer 的 `onNew` 原来只调用 `/api/panes/:paneId/prompt`，成功后等待实时 bridge 或下一次 JSONL 轮询；前端 external store 没有乐观写入。因此 prompt 已经送入 Agent、composer 也已清空，但 user bubble 可能一直缺失到整个回复落盘。

### 修改

- ChatView 新增当前 Pane 范围内的 `pendingUserMessages`。
- 提交非空文本时，先生成 `optimistic:<pane>:<uuid>` user message 并立即加入渲染消息，再发起 prompt HTTP 请求。
- 请求失败时只撤回对应 optimistic message，并继续把错误交给 assistant-ui；不会把未送达内容伪装成已发送。
- 提交时记录同一规范化文本已经存在的权威 occurrence 数；JSONL 或 companion realtime 出现新增的对应 occurrence 后才移除该本地副本。这样用户短时间重复发送“继续”等相同文本时，每条输入仍一对一收敛，不依赖脆弱的时间窗口。
- Pane 切换时清空旧 Pane 的 pending/chat 状态，避免短暂串显示。
- 空 Chat API 的定时轮询只替换权威快照，optimistic 层独立合并，因此 session 文件仍不存在时不会把刚提交的用户输入覆盖掉。

### 验证边界

- 本轮不向任何真实用户 Agent 发送测试 prompt，避免修改正在进行的会话。
- `npm run build` 通过，包含 TypeScript、server bundle 与 Vite production bundle；仅保留既有的 bundle size 提示。
- 代码路径复核确认：空 `ChatSnapshot.messages` 只更新 authoritative 层，pending message 仍参与最终 merge；请求异常按 optimistic ID 精确撤回；权威同文本 occurrence 数增长后才清除对应 pending。
- 没有增加大规模合成 transcript 或新的端到端测试框架；真实首条 prompt 的最终确认留给专用开发 Pane 冒烟。

## 2026-09-04 — Herdr Agent 状态点分色

### 用户反馈

- 左侧 workspace / pane 的 Agent 状态点没有按状态区分颜色，多个状态会显示成相同颜色。

### 排查与修改

- 核对项目保存的 Herdr API schema，确认正式 `AgentStatus` 枚举为 `idle / working / blocked / done / unknown`。
- 原样式只覆盖 `working / waiting / error`，其余 Herdr 正式状态都回退成默认灰色。
- 根据 Herdr 官方视觉语义为需关注状态分色：`working` 黄色、`blocked` 红色、`done` 蓝色。
- 保留 UI 兼容态的独立映射：`running` 跟随 working，`waiting` 橙色，`error` 洋红色，`down` 深红色。
- 同步补齐前端 `AgentStatus` 类型中遗漏的 `blocked / done / down` 字面量。

### 已读语义与降噪修正

- Herdr 官方定义中没有 Agent `down` 状态；用户描述的“完成但未读，点开后恢复普通状态”对应 `done → idle`。
- 官方说明 `done` 是后台任务完成但尚未查看，聚焦 Tab 或显式调用 `pane.focus / agent.focus` 会标记 seen；单纯读取内容不会标记。
- Herzi 新增 `POST /api/panes/:paneId/seen`：仅当目标仍为 `done` Agent 时调用 raw socket `agent.focus {target: pane.id}`，随后刷新并广播 snapshot。
- ChatView 只有成功读取 Chat 后才请求标记 seen；加载失败不算已读。一次 `done` 周期只发起一次请求，失败会显示错误并允许后续轮询重试。
- Herdr 没有独立 acknowledge API，所以 `agent.focus` 会同步改变 session-global focus；普通 Pane 选择仍保持浏览器本地状态。
- 侧栏不再为 `idle`、`unknown` 和未来未识别状态创建 DOM 指示灯；只显示 `working / blocked / done` 及兼容的 `running / waiting / error / down` 等需要注意的状态。
- 颜色调整为贴近 Herdr 官方语义：`working` 黄、`blocked` 红、`done` 蓝；兼容状态继续各自区分。
- 一手依据：Herdr 官方 [CLI reference](https://herdr.dev/docs/cli-reference/)、[Agent automation](https://herdr.dev/docs/agent-automation/) 与项目归档的 protocol 20 schema。

### 验证

- `npm run build` 通过，包括 TypeScript、server bundle 与 Vite production bundle；仅保留既有的 bundle size 提示。
- 静态代码路径确认：`StatusDot` 对 `idle / unknown / 空值或未来未知值` 返回 `null`；ChatView 仅在 Chat 加载成功、无错误且 Agent 仍为 `done` 时请求 seen；服务端再次核对实时状态，只对 `done` 调用 `agent.focus`。
- 当前开发线程 `HERDR_ENV` 未设置，遵循 Herdr skill 未调用真实 Pane 的 focus，也未读取任何 Pane/Chat 内容；真实 `done → idle` 与跨客户端全局焦点变化留待 Herdr 内的专用会话冒烟。
- 本轮新增服务端路由；已运行的 production server 需要重启，不能只刷新浏览器。

## 2026-09-04 — 侧栏 Workspace / Tab 右键菜单

### 需求更正

- 初始列表曾包含 `copy tab`；用户随即明确这是误述，最终实现完全不包含复制或克隆 Tab。
- Workspace 菜单实现：新建 Tab、重命名、复制路径、关闭 Workspace。
- 当前侧栏按 Pane 平铺，故 Pane 行右键菜单以行所属的稳定 `tab.id` 为操作目标：重命名、复制路径、关闭 Tab。

### 实现

- `WorkspaceSidebar` 新增基于 React state + `createPortal` 的 pointer context menu；支持窗口边缘位置约束、点击外部/滚动/resize/blur/Escape 关闭。
- 增加操作图标、分隔线、危险操作样式，以及 2.4 秒成功/错误提示。
- 新建 Tab 调用 Herzi server，服务端转发 Herdr `tab.create {workspace_id, focus:true}`；等返回的 root Pane 出现在 WebSocket snapshot 后再选中，避免响应竞态。
- Rename 分别映射 `workspace.rename` 和 `tab.rename`；初版使用浏览器 prompt 获取名称，前后端都拒绝空值。
- Close 分别映射 `workspace.close` 和 `tab.close`；提交前确认会终止范围内 Pane 与进程。
- Copy path 仅写入浏览器剪贴板，不修改 Herdr。Workspace 取 active Tab 的可用 Pane cwd；Pane 行优先取本行 Pane cwd，无路径时禁用。
- `HerdrClient` 增加按稳定 ID 查询 Workspace/Tab 的方法；所有 mutation 在服务端重新核对目标存在，成功后立即 refresh snapshot。

### 验证

- `npm run build` 通过，包括 TypeScript、server bundle、Vite production bundle；仅有既有的 bundle size warning。
- 当前线程 `HERDR_ENV` 未设置，按 Herdr skill 未读取或变更真实 session；没有对用户 Workspace 执行 create/rename/close。
- 详细行为、API 映射和人工验收边界见 [`sidebar-context-menu.md`](./sidebar-context-menu.md)。
## 2026-09-05 — 初始化 Git 并公开发布到 GitHub

### 用户授权与目标

- 用户明确要求在当前项目目录初始化 Git 仓库，使用现有 GitHub 凭据创建 public repository 并推送。
- 目标仓库名采用项目名 `herzi`，目标账号由 GitHub CLI 当前 active account 确认为 `ch1y1z1`。

### 发布前检查

- 当前目录不是 Git 仓库；`gh auth status` 确认账号 `ch1y1z1` 已登录，Git protocol 为 SSH，凭据具有创建公开仓库所需权限。
- `.gitignore` 已覆盖 `node_modules/`、`dist/`、`.DS_Store` 与 `*.log`。
- 对工作区跟踪候选文件执行敏感模式扫描，没有发现 GitHub token、API key、私钥或密码；唯一的路径模式命中是架构文档中对 `.jsonl` 文件类型的正常说明，不含真实 session 路径或正文。
- 没有发现 5 MiB 以上的待跟踪文件。
- `npm run build` 通过 TypeScript、server bundle 与 Vite production bundle；仅保留既有的 bundle size warning。
- `gh repo view ch1y1z1/herzi` 返回 repository 不存在，可使用该名称创建。

### 执行结果

- 本地仓库使用 `git init -b main` 初始化，Git 作者沿用现有全局配置。
- GitHub CLI 创建 public repository [`ch1y1z1/herzi`](https://github.com/ch1y1z1/herzi)，描述为 “A local web GUI and structured chat client for the Herdr terminal multiplexer.”。
- `origin` 使用现有 GitHub SSH 凭据配置为 `git@github.com:ch1y1z1/herzi.git`。
- 首次提交和 push 状态将在命令完成后复核；远端可见性已通过 GitHub API 确认为 `PUBLIC`。
