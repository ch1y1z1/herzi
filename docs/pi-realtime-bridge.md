# Pi 实时事件桥

> 日期：2026-09-03  
> 状态：protocol v2 已安装到用户 Pi packages；已有进程 reload 与专用 Herdr Pane 写入式验收待进行

## 1. 目的

首个 Alpha 只读取 Pi session JSONL，因此 assistant 生成过程中要等消息落盘，tool 状态也只能最终一致显示。`integrations/pi` 中的 companion extension 补充运行时事件；2026-09-15 起，protocol v2 又增加 Herzi 向同一个现有 Pi runtime 下发原生图片 user message 的命令通道。它不替换 Herdr 管理的 Pi integration，也不创建第二个 Pi runtime。

扩展当前上报：

- assistant/user message 的 start、update、end；
- tool execution 的 running、complete、result 与 error；
- Pi 的 working、waiting、idle；
- `/tree` 的当前 leaf；
- session start/shutdown；
- command/image input capability，以及当前模型是否声明 `input:["image"]`。

扩展当前接收：

- `user-message` command；
- 与 command 绑定的 base64 图片；
- idle 时立即发送，运行中按 Pi `steer` 语义发送；
- 通过 `pi.sendUserMessage()` 进入同一 runtime，并回报 `dispatched/failed`。

## 2. 数据链路

~~~text
Pi extension
  │  HTTP batch（loopback，60 ms 合并）
  ▼
POST /api/integrations/pi/events ──► PiRealtimeStore ──► /ws ──► React

Pi extension
  │  20 秒 HTTP long poll + claim/ack
  ▼
POST /api/integrations/pi/commands/poll
  ▲
  │  image command + 受 claim 保护的图片读取
  │
Prompt Router ◄── UploadStore ◄── assistant-ui attachment adapter
  │
  └─ bridge 不可用：Herdr agent.prompt + managed host path

Pi JSONL ──► PiSessionReader ──► React / assistant-ui
~~~

JSONL 仍然是持久历史的权威来源。扩展或 Herzi 不可用时，Pi 不受影响，Chat 自动保留原来的 1.5 秒 JSONL 轮询。

## 3. 身份与分支

- 扩展只在 `HERDR_ENV=1` 且 Pi 运行模式为 `tui` 时启用。
- Pane 身份来自 Herdr 注入的 `HERDR_PANE_ID`。
- session path 来自 Pi 的只读 `ctx.sessionManager.getSessionFile()`。
- Herzi 接收事件时，把二者与当前 Herdr snapshot 再核对；不匹配的 batch 返回 409，不会串到另一个 Pane。
- `/tree` 后，extension 上报 `newLeafId`。服务端把它传给只读 JSONL parser，因此不必等待下一条 entry 才能显示正确分支；产生新 entry 后恢复跟随 JSONL 最后一条记录。
- v2 command poll 同样携带 `paneId + sessionPath + runtimeId`，服务端与当前 Herdr snapshot 核对后才登记 presence 或返回命令。
- 图片读取还必须持有该 runtime 已 claim 的 commandId；UploadStore 再校验 upload 与 Pane/session 的绑定以及 SHA-256。
- extension heartbeat/capability 来自 command poll 和 event batch；presence 超过 35 秒未刷新后，Prompt Router 自动选择 host-path fallback。
- command 以 browser requestId 幂等，单个 command 只允许一个 runtime claim；已 claim 的命令不会自动改走 fallback，避免双发。

## 4. 安装和运行

在 Herzi 仓库根目录执行：

~~~bash
pi install ./integrations/pi
~~~

这会把本地 package 路径写入用户 Pi 设置，使后续启动的 Herdr + Pi TUI 自动加载扩展。已有 Pi 进程需要执行 `/reload` 或重新启动后才会加载。

如果 Herzi 使用非默认端口，在启动 Pi 前设置完整入口：

~~~bash
export HERZI_REALTIME_URL=http://127.0.0.1:3031/api/integrations/pi/events
~~~

开发时也可以只对一次新的 Pi 进程使用 `pi -e ./integrations/pi`。

2026-09-15 用户明确要求安装图片输入集成后，已在仓库根目录执行：

~~~bash
pi install ./integrations/pi
pi list
~~~

安装命令返回 `Installed ./integrations/pi`；`pi list` 确认用户 package 已登记为当前仓库的 `integrations/pi` 绝对路径。后续新启动的 Pi 会自动加载该 package；安装前已运行的 Pi 必须执行 `/reload` 或重启。此次安装没有自动向现有 Pane 发送 `/reload`，避免同时改变多个正在工作的会话。

## 5. 图片输入与 fallback

- composer 接收 PNG/JPEG/WebP/GIF，单图 10 MiB、单消息最多 4 图/20 MiB；服务端验证 magic bytes、尺寸、像素预算、SHA-256 和文件权限。
- bridge v2 在线且当前 model capability 不明确或支持 image 时，Prompt Router 返回 `transport=pi-native`，extension 获取图片后调用 `pi.sendUserMessage()`。
- bridge 离线、旧版或当前模型明确不支持 image 时，Prompt Router 返回 `transport=host-path`，通过 Herdr `agent.prompt` 发送受管文件路径。
- fallback prompt 中的 `<herzi-attachments>` block 会被 JSONL reader 识别；只有 ledger 中同 Pane/session 的 uploadId 才能恢复为图片，不会根据 transcript 中任意路径读取文件。
- 含图片的 realtime user event 不重复发送大型 base64；前端 optimistic 图片保留到 JSONL 原生 image block 或 fallback marker 收敛。

## 6. 当前限制

- 实时 bridge 只保留当前 runtime 最近 64 条 live message 和 256 个 tool 状态；完整历史仍来自 JSONL。
- connection/command failure 不能中断 Pi；Chat 通过 transport label 和 JSONL 最终一致降级。
- `ExtensionAPI.sendUserMessage()` 返回 void，所以 `dispatched` 表示已调用 API，不等于已落盘；最终确认仍来自 realtime/JSONL。
- UploadStore 当前位于 OS temp 的 Herzi 私有目录；fallback 默认保留 30 天，native 副本保留 24 小时，未提交上传保留 1 小时。
- 浏览器 command 投递状态尚未单独通过 WebSocket 展示 claimed/dispatched/failed 全状态；首轮依赖 prompt response、optimistic bubble 和 JSONL 收敛。
- protocol v2 package 已安装到用户 Pi packages，但现有进程尚未 `/reload`，也未在专用 Herdr + Pi Pane 中执行真实图片 prompt；当前已验证类型、21 项自动测试、完整构建与只读 HTTP 冒烟。
