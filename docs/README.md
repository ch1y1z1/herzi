# Herzi 项目文档

本目录是项目过程与交付文档的唯一归档位置。所有需求、调研、决策、计划、实施、测试和问题记录均应在此维护。

## 文档索引

| 文档 | 状态 | 用途 |
| --- | --- | --- |
| [`feasibility-and-architecture-report.md`](./feasibility-and-architecture-report.md) | 已完成初版 | 需求分析、竞品研究、可行性、推荐架构、安全与风险总报告 |
| [`implementation-plan.md`](./implementation-plan.md) | 已按功能优先修订 | P0–P5 精简路线、技术选型、Pi 插件策略与最小冒烟验证 |
| [`project-status.md`](./project-status.md) | 2026-09-03 盘点 | 对照最初任务书的完成度、当前阶段、剩余工作与 Alpha 后路线 |
| [`ui-research-and-direction.md`](./ui-research-and-direction.md) | 已完成初版 | 参考图拆解、页面结构、UI/Chat/Terminal 组件库比较与推荐 |
| [`herdr-backend-connection-and-focus.md`](./herdr-backend-connection-and-focus.md) | 当前实现说明 | Herzi 如何连接 Herdr、Terminal 尺寸链路、接口选择与多客户端焦点/controller 语义 |
| [`sidebar-context-menu.md`](./sidebar-context-menu.md) | 已实现 | Workspace/Tab 右键菜单、Herdr mutation 映射、路径复制和验证边界 |
| [`chat-activity-ui.md`](./chat-activity-ui.md) | 已实现 | `Worked for` 全过程折叠、thinking/tool 摘要、连续工具分组与运行状态规则 |
| [`pi-realtime-bridge.md`](./pi-realtime-bridge.md) | 代码完成、待安装验收 | Pi companion extension、实时协议、安装方式、降级与限制 |
| [`development-log.md`](./development-log.md) | 持续维护 | 实际代码变更、运行方法、真实冒烟结果、已知限制与后续工作 |
| [`decisions/0001-terminal-backed-local-web-mvp.md`](./decisions/0001-terminal-backed-local-web-mvp.md) | Accepted | terminal-backed、单 runtime 所有权与本地 Web MVP 架构决策 |
| [`research-log.md`](./research-log.md) | 持续维护 | 调研与验证过程流水账、版本、来源、更正和受限项 |
| [`herdr-api-schema.json`](./herdr-api-schema.json) | 基线工件 | Herdr 0.8.2 / socket protocol 20 的本机导出协议 schema |

## 当前结论

- MVP 采用单个本机 Node.js 进程，通过 loopback 提供 Web UI。
- Herdr 继续拥有已有 PTY/Pi；Terminal View 使用官方 observe/control 流。
- Chat View 使用 exact Pi session JSONL 作为持久权威，可选 companion extension 提供实时事件。
- 原始终端始终保留；身份或交互语义不确定时明确降级，不猜测 transcript 或 approval。
- 首个 Alpha 已实现左侧 Herdr Workspace 树、pane header 的 Terminal/Chat 双向切换、默认可输入且支持远端滚动的 xterm.js Terminal、assistant-ui Pi Chat History、Chat composer 与停止。
- 当前以 npm 主 package + 一个无额外依赖的本地 Pi integration package 运行；JSONL history 走 HTTP，Workspace/Terminal/实时 Chat state 走 WebSocket。
- P4 Pi companion extension 代码已经完成；下一步在专用开发 Pane 安装或临时加载扩展，走通 prompt → streaming → tool → settled → JSONL 收敛和 `/tree`。
- 2026-09-03 已修复开发/生产静态目录混用和缺失 JS 被 SPA fallback 返回 HTML 的空白页问题；详细复现与验证见开发记录。
- 2026-09-03 已进一步修复运行中的生产服务无法识别后续构建 hashed asset 的 404；静态文件改为请求时解析，并为本地 MVP 保留旧哈希资源。
- 2026-09-03 Chat 已按 turn 组织 activity：完成后默认折叠为 `Worked for …`，连续工具调用自动归组，运行中显示 `working`/spinner；具体规则见 [`chat-activity-ui.md`](./chat-activity-ui.md)。
- 2026-09-03 已补齐 GFM 表格与行内 code 主题；`Worked for` 展开后使用完整内容高度，不再有内部纵向滚动。
- 2026-09-03 `Worked for` 内的连续工具调用已恢复第二层 `Ran N tools` 折叠；外层仍保持自然高度、无内部滚动。
- 2026-09-03 新选择的 Pane 若已识别 agent，默认进入 Chat；普通 shell Pane 默认进入 Terminal，当前 Pane 仍可手动切换。
- 2026-09-03 直接启动但尚未创建 session JSONL 的 Pi 也会显示可输入的空 Chat；首条消息可正常通过 Herdr 发送，历史文件出现后自动接入。
- 2026-09-03 侧栏改为 Workspace 下按 Pane 平铺：每个 Pane 一行，只显示所属 Herdr Tab 名，并用 `π`、通用 agent 或 Terminal 图标区分环境；点击精确选择对应 Pane ID。
- 2026-09-03 已核清连接与多客户端语义：资源面使用 Herdr raw socket，Terminal 面使用官方 session control/observe stream；Herdr focus 是 session-global，但 Herzi 的 Pane 选择是 browser-local，terminal controller 仍为单所有者。
- 2026-09-03 总进度盘点：项目位于可用 Alpha 收尾和 P3/P4 集成验收关口；Pi-only 本机 Web Alpha 约完成 85–90%，完整 daemon + desktop 产品约完成 45–55%。
- 2026-09-04 修复新启动 Pi 尚无 JSONL 时首条 user message 延迟显示：Chat 发送后立即渲染 optimistic bubble，失败撤回，JSONL/实时消息出现后自动去重收敛。
- 2026-09-04 侧栏状态点改为仅显示需关注状态：Herdr 原生 `working / blocked / done` 分别为黄、红、蓝，`idle / unknown / 默认态` 不显示；Chat 成功载入 `done` Agent 后通过官方 `agent.focus` 标记 seen 并收敛到 `idle`。详见 [`development-log.md`](./development-log.md)。
- 2026-09-04 已增加侧栏右键菜单：Workspace 支持新建 Tab、重命名、复制路径、关闭，Pane 行支持对所属 Tab 重命名、复制路径、关闭；按用户更正不包含 `copy tab`。详见 [`sidebar-context-menu.md`](./sidebar-context-menu.md)。
- 2026-09-05 已按用户授权初始化 Git，并创建 GitHub public repository [`ch1y1z1/herzi`](https://github.com/ch1y1z1/herzi)；发布前敏感信息扫描与完整构建均通过，详情见 [`development-log.md`](./development-log.md)。

## 记录原则

1. 明确区分“已通过一手资料或本地实验核实”“来自二手资料”“推断/建议”和“尚未查证”。
2. 记录访问日期、资料链接、关键版本和本地命令；避免只有结论而没有证据。
3. 代码或设计发生变化时，同步更新对应文档和索引。
4. 不把密钥、令牌、私人会话正文或其他敏感数据写入文档。
