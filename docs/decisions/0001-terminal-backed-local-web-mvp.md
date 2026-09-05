# ADR-0001：采用 terminal-backed 的本地 Web MVP

- 状态：Accepted
- 日期：2026-09-03
- 决策人：项目发起人与当前研究阶段（产品范围仍可调整）
- 关联：[`feasibility-and-architecture-report.md`](../feasibility-and-architecture-report.md)

## 背景

Herzi 需要连接 Herdr 中已经存在且正在运行的 Pi session，同时提供原始 TUI 与 Chat View。可选路径包括：

1. 保留现有 Herdr/Pi runtime，以 PTY + transcript + extension 构建视觉层；
2. 用 Pi SDK/RPC 再启动一个 runtime 并指向同一 session；
3. 从 ANSI 反向解析聊天语义；
4. fork Herdr，把 agent 语义内建到 Herdr。

关键约束是“已有 session”，而不是仅支持由 GUI 新建的 agent。Pi SDK/RPC 很适合后者，但不能无风险接管前者。

## 决策

MVP 采用 terminal-backed 架构：

- Herdr 是 workspace/tab/pane/PTY 的唯一所有者；现有 Pi 是 agent runtime 的唯一所有者。
- 原始视图消费 Herdr 官方 terminal observe/control 流。
- Chat 历史从 Herdr 上报的 exact Pi session path 只读解析。
- Chat 实时事件由独立 Herzi Pi companion extension 提供，JSONL watcher 负责权威恢复和 reconciliation。
- prompt/stop/input 写回原 Herdr pane。
- Terminal 是 source of truth；语义不确定时降级，禁止按 mtime 猜 session 或从 ANSI 猜 approval。
- 物理部署先为单个本机 Node.js 进程 + loopback Web UI；内部保留 host adapter 与 Web protocol 边界，为未来 daemon/client 拆分做准备。

## 理由

- 能真正连接已有 Herdr session，不创建第二套 runtime。
- 与 Moshi、Orca 的 existing-session 路线一致，并有公开产品/源码证据。
- 原始终端、最终一致历史和实时语义可以分阶段交付。
- 故障时仍能回到同一个 PTY，不丢失控制入口。
- 未来可另外增加 runtime-owned 模式，而不会污染已有 session 的 ownership。

## 后果

正面后果：

- 避免重复工具执行、双写 transcript、并发 resume 与状态分叉。
- Herdr/Pi 保持独立升级；Herzi 主要维护 adapter。
- 单进程 MVP 能自然演进成 host daemon + SSH client。

需要承担的成本：

- Pi JSONL tree/compaction/custom entry parser 与可靠 watcher 不简单。
- 没有 companion extension 时只有最终一致 Chat，无法完整显示生成中 token/current leaf。
- approval/question 等交互必须逐类型建立安全映射，覆盖速度慢于自有 runtime。
- terminal 与 chat 两条数据面需要 sequence、resync 与合并规则。

## 被否决的替代方案

### 同 session 再启动 Pi SDK/RPC

否决用于 existing-session MVP。它会产生第二个 live runtime；公开产品缺陷已经证明这种 ownership 错误会导致多个进程指向同一 transcript。未来仅可用于“由 Herzi 新建并拥有 session”的独立模式。

### 从 ANSI 解析 Chat

否决作为语义来源。终端重绘、主题、alternate screen、窗口宽度和 agent 版本使其不可靠，只能用于原始 Terminal View。

### 修改 Herdr 核心

暂不采用。Herdr 不拥有 Pi 内部消息语义，fork 会扩大上游耦合。若实践证明通用 event relay 有价值，再以上游扩展提案处理。

### 直接复刻 Herdr 内部 terminal 协议

MVP 暂不采用。先包装公开 terminal session CLI；只有 profiling 证明 CLI 子进程是实际瓶颈，才另立 ADR 评估。

## 重新评估触发条件

- Herdr 提供稳定、公开的直接 terminal stream API，替代 CLI wrapper。
- Pi 提供可附着到现有交互式 runtime 的官方结构化 IPC。
- M0 证明 exact session reference 在目标版本上不可靠。
- watcher/extension 的维护成本明显高于可接受范围。
- 产品范围改为只支持“由 Herzi 新建 session”，不再要求连接已有 session。
