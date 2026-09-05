# Herzi 项目总进度

> 盘点日期：2026-09-03  
> 对照范围：最初任务书、后续 UI/交互修订、当前代码与开发记录  
> 当前阶段：可用 Alpha 收尾；P3/P4 集成验收关口

## 1. 总体判断

项目已经完成“可行性研究 → 技术路线确定 → 单进程 Web Alpha → Herdr Terminal → Pi Chat”的主干，不再是概念原型。按最初允许大幅简化的 **Pi-only、本机、单进程 Web UI** 口径，当前完成度约为 **85–90%**；按最终设想的 **独立 host daemon + 桌面 GUI client + 多客户端/远程能力** 口径，约为 **45–55%**。

百分比是工程范围估计，不是测试覆盖率。差异来自任务书本身包含两个目标层级：先快速交付本机 Web Alpha，之后才演进为完整双层桌面产品。

## 2. 对照最初任务书

| 最初要求 | 当前状态 | 已完成 | 尚缺 |
| --- | --- | --- | --- |
| 了解现状、调研竞品并形成全面方案 | 完成 | Herdr/Pi/Moshi/Orca/UI 库调研、可行性与 ADR 已落盘 | 随版本变化持续更新 |
| 所有过程写入 `docs/`，并写入 `AGENTS.md` 硬要求 | 完成并持续执行 | 文档索引、研究、方案、决策、实施、排障、验证均已建立 | 后续变更继续维护 |
| 连接已有 Herdr session | Alpha 完成 | 发现本机 server、raw socket、protocol 检查、snapshot/reconnect | named/remote session 选择尚未产品化；snapshot 仍是 1.5 秒轮询 |
| 显示已有 Terminal 内容 | Alpha 完成 | 官方 control/observe stream、ANSI frame、xterm.js、sequence resync | readonly resize 缺口；多 controller UX 待加强 |
| 可视化 GUI application | Web Alpha 完成 | React Web UI、Workspace/Pane 侧栏、Pane header、响应式页面 | 尚未包装 Electron/Tauri 原生桌面应用 |
| Terminal / Chat 双向切换 | 完成 | 同一 Pane 切换，不创建第二 Pi runtime；agent Pane 默认 Chat | 无关键缺口 |
| 初期只支持 Pi | 完成 | agent 识别、exact session path、JSONL branch 投影 | 更多 agent 不在当前 Alpha 范围 |
| Pi Chat View | Alpha 完成 | user/assistant/thinking/tool/result/image、Markdown/GFM、activity 折叠、working 状态 | 大文件增量读取和少见 custom/compaction 可后置 |
| Chat 中向已有 Pi 发消息 | 代码完成、待最终验收 | composer → `agent.prompt`；空 session 也可首发；stop → `esc` | 尚缺专用 Pane 的一次真实 prompt/stop 写入式冒烟 |
| 生成中实时 token/tool/status | 代码完成、待安装验收 | 独立 Pi companion extension、batch endpoint、实时 store、JSONL 收敛、`session_tree` | 尚未对专用 Pi 进程加载扩展并验证真实事件 |
| 守护进程 + 用户程序两层 | 边界已形成，未拆进程 | `server`、`shared protocol`、Web client 职责已经分开 | 仍是一个 Node/Fastify 进程；独立 daemon、桌面壳、安装/自启未开始 |

## 3. 按 P0–P5 阶段判断

### P0：项目骨架与 Herdr 拓扑 — 完成

- Node.js/TypeScript/Fastify/Vite/React 单 package 已建立。
- 可以发现并连接 Herdr 0.8.2 / protocol 20。
- Workspace 下所有 Tab 的 Pane 已按单行平铺展示，每行绑定准确 Pane ID。

### P1：Terminal View — 功能完成

- control/observe → WebSocket → xterm.js 已走通。
- 默认可输入；支持 resize、远端 wheel scroll、release、sequence gap resync。
- control 冲突时不 takeover，回退只读 observer。

剩余属于 Alpha 修补而不是主链缺失：readonly observer 在后续容器 resize 时没有重建，且 controller 所有权提示仍较简单。

### P2：Pi Chat History — 完成

- 从 Herdr 的 exact Pi session path 只读 JSONL。
- 当前 branch、普通消息、thinking、tool call/result、图片与 Markdown 已可展示。
- Terminal/Chat、默认 Chat、空 session 可发送等交互已经完成。
- 已实现 Codex 风格 `Worked for …`、过程消息折叠、连续工具二级折叠和 working spinner。

### P3：输入与可用闭环 — 代码完成，验收未封板

- Chat prompt、stop/Esc、Terminal 输入、resize、scroll 的代码链都存在。
- 已做构建、页面、真实只读历史和 Terminal 画面验证。
- 没有为了测试干扰用户 Agent，因此缺少一个专用开发 Pane 中的完整写入流程：发送 prompt → 看到运行 → 收到完成回复 → stop/恢复。

工程完成度估计约 **85%**；剩余工作主要是一次小规模真实验收与随手修复，而不是重新设计。

### P4：实时 Chat bridge — 代码完成，尚未部署验收

- `integrations/pi` companion extension 已实现 message、tool、status、settled 和 `/tree` 事件。
- 服务端身份校验、实时状态缓存、WebSocket 广播、与 JSONL 最终收敛已经实现。
- 尚未全局安装，也未对现有 Pi 执行 `/reload`；这是此前为了不擅自改变用户环境而有意保留的步骤。

工程完成度估计约 **70%**：实现已完成，真实 runtime 集成证据尚缺。

### P5：真实反馈修补与产品化 — 尚未系统开始

已经根据用户实际反馈修复了不少 UI 问题，但计划中的系统性 P5 尚未开始，包括：

- 大 transcript byte-offset 增量读取；
- 多浏览器 controller lease/ownership UI；
- Herdr `events.subscribe` 替代 topology polling；
- named/remote session；
- 独立 daemon + desktop shell；
- 安装、升级、自启动、日志与正式发布；
- Windows/WSL 与更多 agent。

## 4. 当前已经可以做什么

当前 Alpha 已经可以：

1. 启动一个监听 `127.0.0.1:3030` 的本机服务；
2. 读取已有 Herdr Workspace/Tab/Pane；
3. 在侧栏精确选择 Pane；
4. 显示并操作真实 Terminal；
5. 对 Pi Pane 默认进入 Chat；
6. 显示已有 Pi 对话、Markdown、thinking、工具调用和运行状态；
7. 在没有初始 JSONL 的新 Pi 中提供可用 composer；
8. 通过 Herdr 把 prompt/stop 定向回原 Pane；
9. 在没有 companion extension 时使用 JSONL 最终一致模式。

因此“连接已有 session + GUI + Terminal/Chat”这三个最初核心能力都已经具备。

## 5. 离 Alpha 封板最近的工作

建议只做一个精简真实流程，不扩大测试矩阵：

1. 在专用 Herdr + Pi Pane 中用 `pi -e ./integrations/pi` 临时加载 companion extension，不先改全局配置。
2. 发送一个会触发单次工具调用的真实 prompt，检查 `working → message/tool → settled → JSONL 收敛`。
3. 验证一次 stop/Esc、一次 Terminal 输入/resize/scroll。
4. 修复过程中实际出现的阻断问题；若无阻断，就把 P3、P4 标记完成并发布 Alpha milestone。

这一步不需要手写大量合成数据，也不需要新增完整 E2E 测试框架。预期是半天到一天量级，取决于真实事件字段是否与当前 Pi 0.84.4 完全一致。

## 6. Alpha 之后的路线选择

Alpha 封板后应先决定产品方向，再继续扩张：

### 路线 A：先实际使用 Web Alpha（推荐）

- 使用一段时间，优先处理真实阻断；
- 完善 controller ownership、readonly resize 和大 session 性能；
- 等交互稳定后再包装桌面应用。

### 路线 B：立即进入桌面化

- 用 Electron 主进程复用现有 Node host；
- 把当前 Fastify/server 提取为真正的 host daemon；
- desktop renderer 继续复用 React UI；
- 增加 daemon discovery、生命周期、安装升级和日志。

路线 B 会明显扩大工程范围，因此它属于完整产品的下一阶段，不影响当前 Pi-only Web Alpha 的成立。

## 7. 当前主要风险

1. **实时 bridge 未实际加载**：代码正确性已经过类型/构建检查，但尚未取得真实 Pi runtime 事件证据。
2. **多客户端 controller 排他**：Herzi Pane 选择是 browser-local，但同一 terminal 的 input/resize controller 只有一个；当前失败方只读，缺少更明确的所有权 UI。
3. **只读 resize**：observer 建立后的浏览器 resize 没有重建远端 viewport。
4. **轮询与大文件**：topology 和 JSONL 都优先用了简单轮询/重读，适合 Alpha，但大规模使用前需要增量化。
5. **尚非桌面成品**：没有独立 daemon、安装器、自动启动、原生窗口或远程主机管理。

这些风险不否定核心可行性，也不阻止当前 Alpha 使用；它们决定的是从 Alpha 到稳定产品的后续投入。
