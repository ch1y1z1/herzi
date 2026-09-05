# Pi 实时事件桥

> 日期：2026-09-03  
> 状态：代码已完成；安装到 Pi 并在专用 Herdr Pane 中做写入式验收待进行

## 1. 目的

首个 Alpha 只读取 Pi session JSONL，因此 assistant 生成过程中要等消息落盘，tool 状态也只能最终一致显示。`integrations/pi` 中的 companion extension 补充运行时事件，但不替换 Herdr 管理的 Pi integration，也不创建第二个 Pi runtime。

扩展当前上报：

- assistant/user message 的 start、update、end；
- tool execution 的 running、complete、result 与 error；
- Pi 的 working、waiting、idle；
- `/tree` 的当前 leaf；
- session start/shutdown。

## 2. 数据链路

~~~text
Pi extension
  │  HTTP batch（loopback，60 ms 合并）
  ▼
POST /api/integrations/pi/events
  │  校验 HERDR_PANE_ID 对应的 exact session path
  ▼
PiRealtimeStore
  │  当前状态快照
  ▼
/ws ──────────► React / assistant-ui
                    │
                    └─ JSONL 落盘后以 role + timestamp 去重收敛
~~~

JSONL 仍然是持久历史的权威来源。扩展或 Herzi 不可用时，Pi 不受影响，Chat 自动保留原来的 1.5 秒 JSONL 轮询。

## 3. 身份与分支

- 扩展只在 `HERDR_ENV=1` 且 Pi 运行模式为 `tui` 时启用。
- Pane 身份来自 Herdr 注入的 `HERDR_PANE_ID`。
- session path 来自 Pi 的只读 `ctx.sessionManager.getSessionFile()`。
- Herzi 接收事件时，把二者与当前 Herdr snapshot 再核对；不匹配的 batch 返回 409，不会串到另一个 Pane。
- `/tree` 后，extension 上报 `newLeafId`。服务端把它传给只读 JSONL parser，因此不必等待下一条 entry 才能显示正确分支；产生新 entry 后恢复跟随 JSONL 最后一条记录。

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

开发时也可以只对一次新的 Pi 进程使用 `pi -e ./integrations/pi`。本轮没有自动执行全局安装，也没有对现有用户会话执行 `/reload`，避免在未明确确认时改变所有 Pi 进程的扩展集合。

## 5. 当前限制

- 实时 bridge 只保留当前 runtime 最近 64 条 live message 和 256 个 tool 状态；完整历史仍来自 JSONL。
- 实时图片先显示 `[image]`，落盘后由 JSONL reader 替换为实际图片。
- 连接失败静默降级，不在 Pi TUI 中弹错误；Chat footer 会显示“JSONL 同步”而不是“实时已连接”。
- 尚未在专用 Herdr + Pi Pane 中执行真实 prompt/tool/`/tree` 冒烟；当前已验证编译、fallback 页面和服务端拒绝无效 batch。
