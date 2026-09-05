# Herzi 与 Herdr 的连接、Terminal 尺寸和多客户端焦点

> 日期：2026-09-03  
> 核对对象：Herzi 当前 Alpha；本机已归档 Herdr 0.8.2 / socket protocol 20 schema  
> 状态：当前实现说明，不代表未来 daemon/client 拆分后的最终协议

## 1. 结论摘要

Herzi 当前仍是单个 Node.js/Fastify 进程，“守护进程”和 Web server 尚未拆开。它使用两条 Herdr 通道：

1. **资源控制面**：先执行 `herdr status server --json` 取得 socket path、版本、protocol 与兼容性，再用 `node:net` 长连接 Herdr Unix domain socket；请求是 LF 分隔 JSON。
2. **Terminal 数据面**：不自行实现 Herdr 内部 terminal streaming handshake，而是为当前浏览器所选 Pane 启动官方 `herdr terminal session control|observe` CLI 子进程，在 stdin/stdout 上传控制事件、下传 ANSI frame。

浏览器通过 Herzi 自己的 `/ws` WebSocket 与这两条通道隔离。一个 Herzi 进程只维护一个资源 socket，但每个浏览器 WebSocket 最多维护一个当前 Terminal stream 子进程。

Herdr 0.8.2 的 session snapshot 只有一组 `focused_workspace_id`、`focused_tab_id`、`focused_pane_id`，原生多客户端是 shared session view，不是 tmux 式的独立客户端导航。**但 Herzi 当前的 `selectedPaneId` 是每个浏览器自己的 React state，不等于 Herdr 的全局 focus。**

## 2. 当前连接链路

~~~text
Browser / React
  │
  │ Herzi WebSocket: state / terminal / chat channels
  ▼
Herzi Node.js + Fastify（当前单进程）
  ├─ HerdrClient
  │    ├─ herdr status server --json       发现 socket / 兼容性
  │    └─ Unix socket + LF JSON             snapshot / agent command
  │
  ├─ TerminalObserver（每个打开的浏览器 Terminal）
  │    └─ herdr terminal session control    JSONL ANSI frame + stdin control
  │         └─ 失败时回退 observe           只读、多 observer
  │
  └─ Pi Chat adapter
       ├─ exact session JSONL               持久历史
       └─ companion extension HTTP events   低延迟 message/tool/status
~~~

### 2.1 发现与 socket

`src/server/herdr-client.ts` 的实际步骤：

1. `execFile("herdr", ["status", "server", "--json"])`；不使用 shell 拼接。
2. 检查 `running`、`socket` 和 `compatible`。
3. `net.createConnection(status.socket)` 建立本机 socket。
4. 每个请求写入一行 `{id, method, params}\n`，按相同 `id` 匹配响应；当前请求超时为 5 秒。
5. 当前 topology 没有使用事件订阅，而是每 1.5 秒请求一次 `session.snapshot`。序列化结果变化时才广播给浏览器。
6. socket 关闭后清理 pending request；后续 poll 会重新发现并连接。当前是固定 1.5 秒重试，不是指数退避。

当前 raw socket 实际使用的方法只有：

- `session.snapshot`：Workspace、Tab、Pane、layout/agent/session reference 的冷启动与轮询快照；
- `agent.prompt`：Chat composer 向明确的 Pi Pane ID 发送 prompt；
- `agent.send_keys`：当前用于向明确 Pane 发送 `esc` 取消。

Pi JSONL 不是 Herdr terminal API。Herdr integration 在 snapshot 中提供准确的 `agent_session` path，Herzi 再在同一台机器只读该文件。

## 3. Terminal 尺寸如何设置

尺寸只传**字符网格的 cols/rows**，不向 Herdr 传 CSS pixel 宽高。

### 3.1 浏览器计算字符网格

`TerminalView` 创建 xterm.js（当前 font size 13、line height 1.35）并加载 `FitAddon`。`ResizeObserver` 监听 `.terminal-host` 的像素尺寸，每次变化调用 `fit.fit()`；FitAddon 根据容器大小和字体 cell metrics 更新 `terminal.cols` / `terminal.rows`。

首次进入 Terminal 时，浏览器发送：

~~~json
{
  "channel": "terminal",
  "type": "control",
  "paneId": "w1:p1",
  "cols": 120,
  "rows": 40
}
~~~

### 3.2 Herzi 转给 Herdr

服务端把初始值约束在 `20..400 cols` 与 `5..200 rows`，然后启动：

~~~text
herdr terminal session control <pane-id> --cols <C> --rows <R>
~~~

没有 `--takeover`。取得 control 首帧后，浏览器再发送一次当前尺寸，避免子进程建立期间容器已经变化。后续 ResizeObserver 变化通过控制子进程 stdin 写入：

~~~json
{"type":"terminal.resize","cols":120,"rows":40}
~~~

Herdr stdout 返回带 `seq`、`width`、`height`、`full` 和 base64 ANSI `bytes` 的 frame；浏览器解码后交给 xterm.js。遇到非 full frame 的 sequence gap，Herzi 丢弃增量状态并重建 control stream，等待新的 full frame。

### 3.3 当前限制

- 同一 terminal 同时只有一个 controller 拥有输入和 resize；多个 observer 可以只读观看。
- Herzi 默认申请 control；已有 controller 时不 takeover，而是回退 `observe`。
- control 模式的浏览器 resize 会更新 Herdr controller viewport，因此不是完全独立的纯本地缩放。
- 当前 readonly fallback 建立时会传初始 `--cols/--rows`，但后续容器 ResizeObserver 只会 fit 本地 xterm，不会重启 observer。窗口大小变化后的只读帧尺寸可能暂时不匹配，这是现有 Alpha 的明确缺口。

## 4. Herdr 提供的相关接口与当前选择

Herdr 官方把入口分为 CLI wrapper 与 raw socket API；两者共享控制面。另有专门的 terminal session streaming CLI。

| 能力 | Herdr 接口 | Herzi 当前是否使用 | 说明 |
| --- | --- | --- | --- |
| 服务发现 | `herdr status server --json` | 是 | 取得 socket、version、protocol、compatible |
| 完整资源状态 | raw socket `session.snapshot` | 是 | 当前每 1.5 秒轮询 |
| 增量资源事件 | `events.subscribe` | 否 | 后续可替换大部分 snapshot polling |
| Workspace/Tab/Pane 操作 | `workspace.*`、`tab.*`、`pane.*` | 大部分否 | 0.8.2 schema 支持 list/get/create/focus/rename/move/close、split/layout/read/input 等 |
| Agent 操作 | `agent.list/get/read/focus/start/prompt/wait/send_keys/...` | 部分 | 使用 `agent.prompt`、`agent.send_keys`；Chat 成功载入一个 `done` Pane 后使用 `agent.focus` 标记 seen |
| 一次性 Pane 文本/ANSI 快照 | `pane.read` | 否（实时 Terminal） | 适合日志与诊断，不适合作为持续 TUI renderer |
| 只读实时 Terminal | `terminal session observe` | fallback | 多 observer、无 input/resize 权限 |
| 可写实时 Terminal | `terminal session control` | 是，默认 | 单 controller；stdin 接受 input/resize/scroll/release |
| 直接终端接管 | `terminal attach` | 否 | 面向真实 outer terminal，不适合浏览器 JSON bridge |
| 全局导航焦点 | `workspace.focus`、`tab.focus`、`pane.focus`、`agent.focus` | 有条件 | 普通侧栏切换不调用；Chat 成功载入 `done` Agent 时调用 `agent.focus`，这是 Herdr 清除未读完成态的官方语义 |

选择混合方案的原因：raw socket 适合长连接资源状态和结构化 agent 命令；官方 terminal session CLI 已经封装稳定的 streaming、序列、full/diff frame 和 controller lease，MVP 没有必要复制内部协议，也不应创建第二套 PTY。

## 5. 多前端、焦点与 controller

必须区分四种状态：

| 状态 | 权威所有者 | 是否跨前端共享 | 当前 Herzi 行为 |
| --- | --- | --- | --- |
| Herdr Workspace/Tab/Pane focus | Herdr session server | 是；snapshot 只有一组 focus ID | 通常只用于 fallback；Chat 打开并成功载入 `done` Agent 后会通过 `agent.focus` 同步全局焦点并标记 seen |
| Herzi 当前选中 Pane | 每个浏览器 React 实例 | 否 | 侧栏点击只更新本地 `selectedPaneId`，不调用 `pane.focus` |
| Terminal controller | Herdr terminal | 排他；一个 terminal 同时一个 controller | 每个浏览器自动申请；失败者回退只读 observer |
| Agent prompt 目标 | 请求中的明确 Pane ID | 不依赖 global focus | Chat 始终调用 `agent.prompt {target: pane.id}` |

因此，对问题“当前实现是否让多个前端共用焦点”的准确答案是：

- **原生 Herdr 客户端层：是。** 同一 session 的导航视图和 focus 是共享状态；官方资料明确说当前不是 tmux 式 per-client independent navigation。
- **Herzi 页面层：通常不是。** 两个浏览器仍可各自选中不同 Pane；但打开一个已完成且未读的 Chat 会调用 `agent.focus`，Herdr 的共享全局焦点会因此改变，以便把 `done` 收敛为 `idle`。
- **输入/尺寸层：仍然共享且互斥。** 两个 Herzi 浏览器可分别观察，但不能同时控制同一 terminal。谁拿到 controller，谁拥有该 terminal 的 input/resize；Herzi 不自动 takeover。

当前侧栏“点击 Pane”的一般语义仍是“把 Herzi 主视图切到这个准确 Pane”，不会无条件修改 Herdr 的 session-global focus。唯一例外是 Chat 已成功载入且该 Agent 为 `done`：Herzi 调用 `agent.focus {target: pane.id}` 标记 seen；Herdr 没有独立 acknowledge API，因此这个动作也会让其他 Herdr 客户端的共享焦点切到该 Pane。Prompt 始终携带明确 Pane ID，不受这个焦点变化影响。

如果未来需要“每次点击 Herzi 都让所有 Herdr 客户端跳过去”，仍应做成显式同步模式。默认继续保持普通选择独立，只为 Herdr 原生 `done → idle` 已读语义使用一次 `agent.focus`；远期若 Herdr 提供独立 acknowledge 或稳定的 per-client view identity，应优先迁移，消除共享焦点副作用。

## 6. 证据与核对边界

- 项目代码：`src/server/herdr-client.ts`、`src/server/terminal-observer.ts`、`src/server/index.ts`、`src/web/components/TerminalView.tsx`、`src/web/App.tsx`。
- 版本化 schema：[`herdr-api-schema.json`](./herdr-api-schema.json)，Herdr 0.8.2 / protocol 20。
- Herdr 官方 Socket API：<https://github.com/herdrdev/herdr/blob/master/docs/next/website/src/content/docs/socket-api.mdx>
- Herdr 官方 CLI reference：<https://github.com/herdrdev/herdr/blob/master/docs/next/website/src/content/docs/cli-reference.mdx>
- 官方多客户端讨论与实测：<https://github.com/herdrdev/herdr/discussions/651>

当前开发线程不在 Herdr 环境中，`HERDR_ENV` 检查失败；本轮没有调用 Herdr CLI 查询或控制任何正在运行的会话，也没有读取 Pane 输出或 Pi transcript。关于当前软件行为的结论来自源码审计和已归档 schema；多客户端共享视图结论以 Herdr 官方文档/讨论为外部证据。
