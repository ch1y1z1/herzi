# 开源项目 Agent 组织方式调研报告

> 调研日期：2026-09-16（UTC+08:00）
> 状态：完成初版
> 研究对象：`egoist/waku`、`stablyai/orca`、`pingdotgg/t3code`、`openai/codex`
> 研究范围：这些仓库如何组织**负责维护和开发仓库的 coding agent**，不是产品内部的多 Agent runtime/provider 架构
> 配套方案：[`agent-organization-design.md`](./agent-organization-design.md)

## 1. 摘要

四个项目没有采用同一种“万能 Agent 配置”，但共同呈现出六个稳定模式：

1. **单一事实源。** 根 `AGENTS.md` 保存所有 Agent 都应该知道的稳定规则；Claude 通过 `CLAUDE.md` 导入或链接该文件，避免维护两份相互漂移的规则。
2. **按作用域分层。** 根文件只放跨仓库约束；局部高风险目录使用嵌套 `AGENTS.md`；长流程和偶发流程放到按需加载的 Skill；架构原理和操作细节放在普通文档。
3. **把事故经验变成可执行约束。** 最有价值的规则不是通用代码风格，而是“启动第二个 watcher 会发生什么”“为什么不能把超时当作进程死亡”“测试必须观察 DOM 而不是读回 store”这类从真实缺陷中提炼的边界。
4. **隔离并行工作。** Orca 和 T3 Code 都把一个任务放进独立 worktree，并隔离进程、状态目录、端口和测试数据；并行安全不只等于“文件不冲突”。
5. **Agent 指令不是强制机制。** 格式、代码质量、生成文件一致性、最大文件行数、平台兼容等可以机械验证的要求，最终都下沉到 lint、测试、CI 或脚本；`AGENTS.md` 负责告诉 Agent 为什么和何时运行这些门禁。
6. **主 Agent/集成者承担最后整合。** T3 Code 明确限制 subagent 启动自己的 dev server，集成后的真实客户端验证只由 primary agent 做一次；Codex 的 review Skill 用多个只读 reviewer 并行找问题，再由主 Agent 汇总全部 findings。

对 Herzi 最值得直接采用的不是复制某个大文件，而是建立如下分层：

```text
稳定宪法（根 AGENTS.md）
  -> 子系统局部规则（少量嵌套 AGENTS.md）
  -> 按需流程（skills/playbooks）
  -> 任务契约与交接记录（docs 中每任务独立文件）
  -> worktree/状态/端口隔离
  -> 单集成者 + 自动门禁
```

## 2. 调研方法与证据标准

### 2.1 取样

本报告重点检查：

- 根 `AGENTS.md` 与 `CLAUDE.md`；
- 嵌套 `AGENTS.md`；
- 仓库内 Skill、worktree 配置和开发环境配置；
- `CONTRIBUTING.md`、PR 模板、`CODEOWNERS`；
- 与并行工作、测试隔离和集成门禁直接相关的公开文档；
- `AGENTS.md` 的文件历史，确认它们是持续维护的工程资产，而不是一次性提示词。

### 2.2 版本固定

为避免默认分支后续变化导致报告无法复核，本报告将主要源码证据固定到调研时的 HEAD：

| 项目 | 默认分支 | 本次固定提交 |
| --- | --- | --- |
| Waku | `main` | `ae49e6ed5a0495c3c6e03f3961e4e4b4b30f9336` |
| Orca | `main` | `c33a446190bdfa21286a373e097c50a2b3e0a4d4` |
| T3 Code | `main` | `f8500f11271622ed82df7f6c1d7f73eddb4f43e6` |
| Codex | `main` | `ffae979216bfbe94070bd21868d1695277105a63` |

HEAD 由 `git ls-remote <repo> HEAD` 获取；仓库文件树由 GitHub Trees API 读取；正文来自固定提交的 `raw.githubusercontent.com`。

### 2.3 事实、推断和限制

- 标为“仓库事实”的内容可在固定提交中直接核实。
- 标为“分析”的内容是本报告根据文件结构和规则作出的解释，不代表上游维护者的正式自述。
- Waku/Orca/T3 Code/Codex 的产品运行方式只在它影响开发 Agent 工作流时讨论。
- 本轮曾尝试把 OpenHands 作为第五个固定版本样本，但固定 HEAD 时 GitHub SSL 连接超时；因此不把未完整固定的结果纳入主要比较，避免把半核实材料写成事实。
- GitHub 网页显示的 star、PR 数等易变指标不用于架构结论。

## 3. 通用基础：`AGENTS.md` 的实际作用

### 3.1 它是“行为上下文”，不是权限系统

`AGENTS.md` 官方说明把它定义为面向 Agent 的 README：标准 Markdown、没有强制字段、可以在子目录继续放置文件，离目标代码更近的规则优先。它适合放项目结构、构建测试、代码规范和安全注意事项。

但这类文本仍然只是模型上下文。Anthropic 官方文档也明确区分：`CLAUDE.md` 用来影响行为，真正必须阻止的动作应由 permissions、sandbox 或 hook 强制。由此可得：

- “不要直接改生成文件”可以写进 `AGENTS.md`；
- “生成文件发生漂移时 CI 必须失败”应由脚本或 CI 实现；
- “不得读取某目录”若是安全边界，不能只依赖提示词。

### 3.2 不同 Agent 的发现规则并不完全相同

- **Codex：**从项目根到启动目录逐层读取 `AGENTS.override.md` / `AGENTS.md`；更近的文件后加载，默认总大小上限为 32 KiB。若从仓库根启动，深层文件不会自动进入初始链，任务编排仍应显式提醒 Agent 阅读目标目录规则。
- **Claude Code：**原生读取 `CLAUDE.md`，不直接读取 `AGENTS.md`；官方推荐在 `CLAUDE.md` 中写 `@AGENTS.md`，或使用符号链接。Claude 会在读取子目录文件时按需加载更深层 `CLAUDE.md`。
- **GitHub Copilot：**官方支持仓库任意位置的 `AGENTS.md`，最接近目标文件的规则优先；同时另有 `.github/copilot-instructions.md` 和 path-specific instructions。
- **当前 Pi/本项目 harness：**本次会话已加载项目根 `AGENTS.md`。这是当前环境事实，不应据此假定所有其他 Agent 都采用完全相同的发现算法。

因此，跨 Agent 仓库应把根 `AGENTS.md` 作为唯一通用事实源，同时用很薄的工具适配文件接入，而不是复制整份规则。

## 4. Waku：精简根规则 + 强产品约束 + 人工贡献政策

仓库：<https://github.com/egoist/waku>

### 4.1 文件组织

固定提交中与 Agent 协作最直接的文件：

```text
AGENTS.md                       # 约 103 行，通用开发规则
CLAUDE.md                       # 符号链接，目标为 AGENTS.md
.claude/launch.json             # Claude 开发启动项，仅包含 website 启动配置
CONTRIBUTING.md                 # 面向贡献者的完整流程和 AI 政策
.github/pull_request_template.md
.github/workflows/
docs/performance.md             # AGENTS.md 指向的专项性能说明
```

Waku 没有大量嵌套 `AGENTS.md`，也没有在仓库中声明复杂的开发 Agent DAG。它选择把少量、高价值、跨仓库适用的规则集中在根文件。

### 4.2 根 `AGENTS.md` 的结构

Waku 的规则围绕四类问题组织：

1. **开发运行时所有权**
   - 默认假设 `bun ./scripts/dev.ts` 已在运行并拥有 `Waku Debug.app`；
   - 禁止再启动第二个 watcher、手动 bundle、手动退出/重启 app；
   - 修改后等待 watcher 成功重建，再验证刚重启的 Debug app；
   - 除非用户要求，不做视觉测试。
2. **性能是产品约束**
   - UI thread 不允许文件系统遍历、网络、子进程、阻塞锁和同步 IPC；
   - render/row builder 只能读取内存状态；
   - 重工作移到 background executor，并用 generation 防止过期结果覆盖新状态；
   - 长列表虚拟化，按当前可见范围控制每帧成本；
   - 修改 streaming event pump 等路径前必须阅读 `docs/performance.md`。
3. **可访问性是产品约束**
   - 鼠标可达控制必须可由键盘操作；
   - 尊重 reduce-motion；
   - 不能只用颜色、hover 或 motion 传递意义；
   - 保证焦点、对比度和命中区域。
4. **参考项目的选择规则**
   - coding-agent 产品行为参考 T3 Code；
   - GPUI 实现参考 Zed；
   - 明确规定什么时候值得查参考、什么时候不应为了局部修复“参考漫游”；
   - 用户截图和明确反馈高于既有一致性。

这份文件的特点不是全面描述仓库，而是预先阻止代价最大的错误：重复启动运行时、阻塞 UI 线程、破坏可访问性、选错参考实现、只构建不做真实行为验证。

### 4.3 `CONTRIBUTING.md` 与 Agent 规则的分工

Waku 把外部协作者流程放在 `CONTRIBUTING.md`，包括：

- 开发依赖和平台要求；
- watcher 的正确启动/停止方式；
- macOS/Linux/Windows bundle；
- 变更前 issue 讨论；
- 完整 baseline checks；
- wire type 变化后的代码生成；
- PR 内容和视觉证据；
- AI 使用披露政策。

其中 AI policy 要求披露工具和参与范围、提交者必须理解全部改动、PR 描述和评论必须由人本人写。这说明 Waku 把“Agent 如何工作”和“人如何对外承担责任”分开治理。

### 4.4 质量门禁

Waku 要求先运行相关 focused checks，再运行完整 baseline，包括 Rust fmt/check/test、协议生成一致性和 JS client checks。协议类型变更必须重新生成并提交浏览器端生成文件。可见变化还必须等待 watcher 重建并验证实际 app；编译成功不等于用户行为验证成功。

### 4.5 规则如何演进

`AGENTS.md` 历史显示 2026 年 7 月至 9 月持续更新，性能、spinner cadence、Cua Driver 等产品变化会同步进入 Agent 指令。它被当作代码旁的活文档维护，而不是项目初始化后不再触碰的模板。

### 4.6 优点、代价与适用场景

**优点：**

- 文件短，关键约束显著，启动上下文成本可控；
- 把运行时所有权和 UI 性能写得非常具体；
- Claude 通过符号链接与 `AGENTS.md` 共用事实源；
- 文本规则与真实 watcher、测试和生成检查配合。

**代价：**

- 缺少显式的并行任务协议、worktree 交接格式和集成者职责；
- 符号链接对 Windows 和部分工具链的可移植性低于普通 `CLAUDE.md` 导入文件；
- 规则主要依赖根文件，项目继续增大时可能需要局部作用域。

**适合借鉴：**小到中型仓库、单一产品架构、最重要风险集中且维护者希望 Agent 上下文保持精简的项目。

## 5. Orca：根宪法 + 局部事故手册 + 版本匹配 Skill + worktree 编排

仓库：<https://github.com/stablyai/orca>

### 5.1 文件组织

固定提交中的关键结构：

```text
AGENTS.md                         # 约 120 行，但信息密度高
CLAUDE.md                         # 普通文件，内容为 @AGENTS.md
src/main/daemon/AGENTS.md         # daemon endpoint 所有权不变量
tests/AGENTS.md                   # 自动测试不得抢前台
tests/e2e/AGENTS.md               # E2E build mode 与断言规则
skills/
  orchestration/SKILL.md          # 多 Agent 协调发现入口
  orca-cli/SKILL.md               # worktree、terminal、handoff 等入口
  orca-per-workspace-env/SKILL.md # 每 workspace 环境配方
  computer-use/SKILL.md
  orca-emulator*/SKILL.md
  linear-tickets/SKILL.md
.github/CONTRIBUTING.md
.github/pull_request_template.md
.github/CODEOWNERS
orca.yaml                         # 仓库环境 setup：pnpm install
config/scripts/                   # 大量机械质量门禁和生成/校验脚本
```

这是四个样本中“作用域分层”和“并行编排”最完整的实现。

### 5.2 根 `AGENTS.md` 是跨系统宪法

根文件不尝试解释每个模块，而是覆盖所有变更都必须考虑的横切边界：

- UI 必须遵守 `docs/STYLEGUIDE.md`，并由 changed-lines gate、lint 等机械检查；
- Agent 启动的 Electron 测试必须后台运行，不可抢焦点或显示窗口；
- 新实现前先搜索并复用现有实现；
- 禁止模糊模块名、禁止随意 type assertion、禁止增加 max-lines 例外；
- 明确 typecheck/test/lint/design-system 命令；
- 所有平台、SSH、folder workspace、远程 wire、不同 Git 版本和多 git provider 都是默认场景；
- subprocess、Windows shell/EDR、WSL、glibc、native dependency 等高风险边界都有专项文档入口；
- 搜索 Git history 时禁止无界 `--all` × tree 扇出；
- Agent status 必须由 execution host 的单一 store 拥有；
- 读取 Agent TUI 状态的规则必须基于脱敏的真实 PTY transcript，不可凭记忆实现。

它采用“规则 + 为什么 + 指向专项参考文档”的结构。根文件负责告诉 Agent何时必须停下来读更多资料，详细知识不全部塞进启动上下文。

### 5.3 嵌套 `AGENTS.md` 存放局部、高损失不变量

三个嵌套文件展示了很清晰的准入标准：只有局部且容易反复踩坑的规则才进入子目录。

- `src/main/daemon/AGENTS.md`：描述 canonical socket path 的所有权协议，强调“任何 actor 都不能删除不是自己创建的名字”；列出 timeout/EPERM 不能推断死亡、先 `link`、再 double-probe/rename、不得 sweeper 等事故经验。
- `tests/AGENTS.md`：自动运行不能抢用户桌面前台；说明 background/headless/headful 的窗口策略和统一 launcher。
- `tests/e2e/AGENTS.md`：E2E 必须以 `--mode e2e` 构建；纯 store 逻辑优先 unit test；E2E 可以用 store 做 setup，但最终断言必须针对用户可见 DOM。

这些文件不是一般风格指南，而是局部“事故手册”。规则紧贴所有权代码和测试目录，降低无关任务的上下文噪音。

### 5.4 Skill 层负责按需操作流程

Orca 的 `skills/` 包含 orchestration、CLI、per-workspace environment、emulator、computer use 等技能。尤其值得注意的是：仓库中的 Skill 多为**发现 stub**，不内嵌可能快速过期的完整命令手册，而要求先运行：

```text
orca skills get <skill-name>
```

由当前正在运行的二进制返回版本匹配的指南。这样避免“仓库里的 Skill 与本机 CLI 版本不一致”。如果命令不支持，规则要求报告准确错误并停止，不能猜测另一套命令。

`orchestration` Skill 的触发范围直接包含：

- threaded messages；
- blocking ask/reply；
- task dispatch；
- `worker_done` / escalation waits；
- task DAG；
- decision gates；
- coordinator loops；
- 跨 Agent 分解工作。

单纯完整 handoff 或普通 worktree/terminal 操作则由 `orca-cli` Skill 负责。这把“有监督的编排”和“把所有权完整交给另一 Agent”分成两种模式。

### 5.5 worktree-native 并行模型

Orca 官方 Worktrees 文档明确：每个任务使用独立 Git worktree、独立 branch、独立文件和独立 Agent terminal。任务生命周期是：

```text
Create -> Work -> Review -> Ship -> Archive/Delete
```

它进一步处理了并行开发常被忽略的环境问题：

- 创建过程异步运行，可观察、取消、失败重试；
- 可从 base ref、其他 branch、具体 SHA 或 remote branch 创建；
- 大型可重建目录可共享；
- gitignored 文件可通过 `.worktreeinclude` 复制为每 worktree 独立副本；
- worktree 与 project/host/task link 绑定；
- 删除前检查未合并 branch，并提供 review；
- local、SSH、remote host 均属于同一模型。

这不是单纯调用 `git worktree add`，而是给 worktree 建立完整的状态和生命周期所有权。

### 5.6 PR 与机械门禁

Orca 的 PR 模板要求：

- ELI5、What Changed、Why；
- linked issue、visual proof、testing；
- AI disclosure；
- Agent review；
- security、跨平台、SSH/remote、mobile、兼容性、性能检查；
- 小而聚焦、自审、完整 lint/typecheck/test/build。

`package.json` 中还有 design-system gate、max-lines ratchet、`ts-nocheck` ratchet、runtime Electron import ratchet、generated catalog verification、platform build和大量 E2E/benchmark。规则中的“不得新增坏模式”有脚本兜底。

### 5.7 优点、代价与适用场景

**优点：**

- 指令、局部不变量、Skill、文档、自动门禁的层次清楚；
- 对 worktree 并行、远程主机和多 Agent 协调有一等支持；
- “版本匹配 Skill”很好地解决 CLI 演进导致的文档漂移；
- 把历史事故提炼成精确、不容猜测的协议规则。

**代价：**

- 根 `AGENTS.md` 信息密度很高，新 Agent 仍需较强的检索和判断能力；
- 体系依赖 Orca CLI/runtime，本身不是只复制几个 Markdown 就能获得；
- 大量 ratchet、平台矩阵和参考文档有持续维护成本；
- 对 Herzi 当前规模直接全量照搬会过度设计。

**适合借鉴：**多平台桌面应用、远程执行、多个 Agent provider、复杂并行 worktree 和高并发维护场景。

## 6. T3 Code：产品原则 + 安全边界 + worktree 状态隔离 + 主 Agent 集成验证

仓库：<https://github.com/pingdotgg/t3code>

### 6.1 文件组织

固定提交中的关键结构：

```text
AGENTS.md                       # 约 168 行
CLAUDE.md                       # 普通文件，内容为 @AGENTS.md
.agents/skills/
  test-t3-app/SKILL.md
  test-t3-mobile/SKILL.md
  ios-debugger-agent/SKILL.md
  ios-simulator-browser/SKILL.md
.claude/skills                  # 符号链接到 ../.agents/skills
.codex/config.toml              # Codex 项目配置
t3.json                         # worktree 创建时 setup 脚本
.github/pull_request_template.md
docs/internals/
docs/operations/
docs/user/
.repos/                         # 只读参考仓库
```

T3 Code 同样采用“通用规则单一事实源 + 工具适配 + 共享 Skill”。`.claude/skills` 链到 `.agents/skills`，说明 Skill 内容也避免按 Agent 品牌复制。

### 6.2 根文件先定义产品价值和共同语言

T3 Code 的 `AGENTS.md` 开头不是命令，而是四项不可妥协的产品原则：

- open at the core；
- performance without compromise；
- remote ready；
- web/desktop/mobile multi-surface。

随后定义 `agent`、`provider`、`client`、`environment`、`project`、`thread`、`turn` 等词汇。这个顺序让 Agent 在做局部实现前先知道“优化目标”和“项目语言”，减少同词不同义。

### 6.3 “三种自伤方式”把安全规则放到最高显著位置

T3 Code 特别强调：

1. 不得按名称/路径模式 `pkill`，因为自身 Agent 和其他 dev server 可能都匹配；只停止自己捕获的 PID，或确认端口 owner 和 cwd 后处理。
2. 不得对真实 `~/.t3/userdata` 启动服务、读写或清理；真实数据只能安全复制到隔离环境。
3. 不得在 dev 中设置会把 localhost 烘焙进 bundle 的 URL 环境变量，否则远程模式静默失效。

这类规则具备三个特点：具体、可检查、解释了真实损害。它们比“注意安全”有效得多。

### 6.4 系统性覆盖矩阵

“Hit every surface”要求每次前端变更检查：

- entry points；
- web/desktop/mobile clients；
- 所有 provider adapters；
- wire contracts；
- reverse states；
- local/remote/relay/tunnel connection modes；
- docs。

它不是要求所有变更都修改全部表面，而是要求明确判断每一项适用或不适用。这种显式矩阵很适合阻止 Agent 只修自己看到的单一路径。

### 6.5 worktree 环境隔离

T3 Code 在 `t3.json` 中为新 worktree 自动运行 setup：安装依赖、链接 worktree 所需 `.env`、预热 dependency cache，并分别提供 POSIX 与 Windows 命令。

根规则和 `test-t3-app` Skill 进一步要求：

- worktree dev state 默认落在本 worktree 的 `.t3`；
- worktree-local state 高于外部 `T3CODE_HOME`，避免误连共享真实状态；
- 端口由 worktree path 稳定派生，但必须读取实际启动输出；
- dev process、浏览器、base dir、认证状态跨 turn 保留；
- 测试循环结束前不要因为一次回复完成就停服务；
- 测试数据通过 SQLite `VACUUM INTO` 一致性快照复制，不能对活动 DB 直接 `cp`；
- pairing token、真实数据和测试环境都有明确所有权。

这说明并行 worktree 的核心不只是 Git 文件隔离，而是**状态、端口、认证、数据和进程的隔离**。

### 6.6 主 Agent 与 subagent 的边界

验证章节明确：

- 使用“能证明变更有效的最小验证”；
- 不运行全仓 checks，完整套件交给 CI，除非维护者要求；
- 用户可见前端变化在获得许可后做一次真实客户端集成验证；
- 该集成验证由 primary agent 在整合后做一次；
- subagent 不启动自己的 dev server。

这是并行开发中的重要约束：worker 负责 focused proof，集成者负责集成态 proof，避免每个 Agent 各自启动昂贵且会争抢端口/状态的完整环境。

### 6.7 文档和工作产物政策

T3 Code 与 Herzi 当前政策明显不同：

- 不提交 implementation plans、research notes 或 Agent scratch files；
- 活跃工作放 GitHub issue/project item；
- merged PR 是实施记录；
- `docs/internals` 只记录跨组件决策、难以从代码发现的约束和实现陷阱；
- 若代码本身足以回答，不另写文档。

该政策适合高吞吐、成熟 PR 流程，但不能原样移植到 Herzi，因为 Herzi 已明确要求所有过程落盘到 `docs/`。可以借鉴的是“避免多份重复记录”和“文档只保留高价值信息”，而不是取消过程文档。

### 6.8 优点、代价与适用场景

**优点：**

- 产品原则、术语、安全规则和架构边界在一个入口中对齐；
- worktree 创建即完成环境隔离，适合大量并发任务；
- 明确 primary/subagent 验证职责，减少并行环境争用；
- 共享 Skill 同时服务 Claude/Codex 等 Agent。

**代价：**

- 根文件已接近 Claude 官方建议的单文件 200 行上限；
- 很多约束依赖 T3 自有 `vp`、`t3.json` 和应用状态模型；
- “不提交过程文档”与 Herzi 的治理要求冲突；
- 根文件同时含产品、运行、测试、PR、文档和架构，继续增长时需要进一步拆分。

**适合借鉴：**多 surface、多 provider、远程模式、并行 worktree 数量较多且真实状态昂贵的项目。

## 7. OpenAI Codex：大型根规则 + 少量局部覆盖 + 专业化 review Skills

仓库：<https://github.com/openai/codex>

### 7.1 文件组织

固定提交中的关键结构：

```text
AGENTS.md                                  # 约 319 行
codex-rs/tui/src/bottom_pane/AGENTS.md    # 局部状态机文档同步规则
.codex/skills/
  code-review/SKILL.md                     # review orchestrator
  code-review-context/SKILL.md
  code-review-testing/SKILL.md
  code-review-change-size/SKILL.md
  code-review-breaking-changes/SKILL.md
  babysit-pr/SKILL.md
  codex-pr-body/SKILL.md
  remote-tests/SKILL.md
  test-tui/SKILL.md
  ...
.codex/environments/environment.toml       # 生成的开发环境动作
.worktreeinclude                           # worktree 复制 user.bazelrc
.github/CODEOWNERS
```

Codex 的根文件是四个样本里最长的，覆盖 Rust 习惯、模块大小、测试、TUI、snapshot、app-server API、Python 和跨平台等大量规则。

### 7.2 根规则强调可审查的变更形状

值得借鉴的部分包括：

- 模块目标小于 500 LoC，约 800 LoC 后优先新建模块；
- 非机械变更总 diff 原则上不超过 800 行，复杂逻辑尽量低于 500 行；
- 改动过大时先找最小可独立落地阶段；
- 避免扩大 `codex-core`，新概念先考虑更合适的 crate；
- integration surface 变化要检查 app-server API、事件、CLI 参数、配置和 session resume；
- Agent 核心逻辑变化必须有 integration test；
- UI 变化必须有 snapshot coverage；
- 先跑目标 crate 测试，共享核心变化再征得用户同意运行完整套件。

这些规则直接优化了 Agent 产出的可审查性，而不仅是最终正确性。

### 7.3 局部 `AGENTS.md` 只补充窄规则

`codex-rs/tui/src/bottom_pane/AGENTS.md` 只要求：修改 paste-burst/chat-composer 状态机时同步模块文档，并检查文档只描述实际存在的 Enter/newline 和 `disable_paste_burst` 行为。

这验证了“根文件完整，局部文件只写差异”的做法；子目录文件不重复根规则。

### 7.4 review 被拆成可并行的专业 Skills

Codex 的 `code-review` Skill 本身只负责编排：

- 找出所有 `code-review-*` Skill；
- 每个维度启动一个 subagent；
- 使用高 reasoning；
- 返回每个 subagent 的全部问题；
- 每条 finding 必须有具体文件和行号；
- 未经要求不在 GitHub 留评论。

专业 reviewer 分别检查：

- 模型可见 context 的边界和大小；
- 测试策略；
- breaking changes；
- 变更规模和拆分机会。

这是一种适合并行化的工作：多个 reviewer 只读同一 diff，几乎没有写冲突；主 Agent 汇总和裁决。

### 7.5 PR babysitter 是长期状态机，而不是一次命令

`babysit-pr` Skill 对持续 watch、CI failure 分类、flaky retry budget、review comment 权限、commit/push 后继续 watch、严格停止条件和 GitHub mutation policy 都有明确状态机。它体现：

- 长任务必须定义终止条件；
- 绿灯是中间状态，不必然是任务终止；
- 自动修复、对外评论、resolve thread 的权限不同；
- human-authored comment 默认不自动回复；
- 每次写操作后重新读取权威状态。

这种形式比在根 `AGENTS.md` 写一句“关注 PR”可靠得多，适合做按需 Skill。

### 7.6 优点、代价与适用场景

**优点：**

- 规则细致，覆盖代码、测试、API、UI 和 review；
- review 维度天然并行，输出格式严格；
- 局部状态机规则紧贴代码；
- 通过 Skill 描述长期流程、权限和停止条件。

**代价：**

- 根 `AGENTS.md` 约 22 KiB/319 行，启动上下文成本高；
- 一些 review 规则同时存在于根文件和 Skills，存在重复和漂移风险；
- 大型 Rust/Bazel 仓库的细节不适合小型 TypeScript 项目照搬；
- review 多 subagent 模式需要足够的任务风险和预算才划算。

**适合借鉴：**大型核心基础设施仓库、API 兼容要求高、review 专业维度清晰、CI 成本较高的项目。

## 8. 横向比较

| 维度 | Waku | Orca | T3 Code | Codex |
| --- | --- | --- | --- | --- |
| 根规则规模 | 精简 | 中等、密集 | 中等、产品导向 | 大型、详尽 |
| 单一事实源 | `CLAUDE.md` 符号链接 | `CLAUDE.md` 导入 | `CLAUDE.md` 导入 | 原生 Codex 配置为主 |
| 嵌套规则 | 未发现 | daemon/tests/e2e | 主仓库未发现，vendored refs 除外 | bottom pane 一处 |
| Skill | 少量产品资源 | orchestration/CLI/env/GUI | 测试和移动端技能 | review/PR/TUI/remote 等 |
| 并行模型 | 未显式规定 | task DAG + coordinator + worktree | worktree 隔离，primary 做集成验证 | reviewer subagents 并行 |
| 环境隔离 | 单 watcher 所有权 | worktree/host/runtime 生命周期 | worktree 状态、端口、DB、认证隔离 | `.worktreeinclude` + environment action |
| 文档策略 | root rule 指向专项 docs | 大量 reference docs | 限制过程文档，PR/issue 作记录 | 根规则和模块 docs 较重 |
| 机械门禁 | baseline checks/生成检查 | 大量 lint ratchet/平台 E2E | focused checks + CI full suite | just/Bazel/test/snapshot/size rules |
| 最强实践 | 约束聚焦 | 分层与完整编排 | 状态隔离和主从验证 | 专业化并行 review |
| 主要风险 | 缺少并行协议 | 体系过重 | 根文件继续膨胀 | 上下文和重复规则过大 |

## 9. 可迁移原则

### 9.1 应直接采用

1. `AGENTS.md` 作为跨 Agent 唯一事实源。
2. `CLAUDE.md` 使用 `@AGENTS.md` 普通文件导入，优先于符号链接以兼容 Windows。
3. 根规则只保存稳定、跨任务、高损失约束。
4. 子目录规则只保存局部差异和事故不变量，不复制根规则。
5. 长步骤、低频操作和状态机放 Skill/playbook。
6. 并行实现必须使用独立 worktree，并隔离运行状态、端口和测试数据。
7. worker 做 focused proof，集成者做集成态 full proof。
8. reviewer 尽量只读，使用文件/行号和严重级别输出 findings。
9. 自动化可检查的规则最终由测试、lint 或 CI 强制。
10. 规则应随事故和 review 反馈演进；同类错误第二次出现时考虑写入规则或门禁。

### 9.2 不能直接照搬

1. Orca 的完整 task DAG/runtime 协议依赖其 CLI，Herzi 当前不需要同等复杂度。
2. T3 Code 的“不提交过程文档”与 Herzi 的硬性文档要求冲突。
3. Codex 的 319 行根规则不适合作为 Herzi 起点；当前项目应控制启动上下文。
4. Waku 的单 watcher 规则是 GPUI app 的特定事实，Herzi 应改写为自己的 server/Vite/Herdr 所有权规则。
5. worktree 共享 `node_modules`、`.env` 或活动数据库都不能作为默认做法；是否共享取决于工具链和数据所有权。

## 10. 对 Herzi 的直接启示

Herzi 当前根 `AGENTS.md` 只有“所有过程写入 `docs/`”一项原则，优点是清晰，缺点是并发时所有 Agent 容易同时编辑 `docs/README.md`、`research-log.md` 或 `development-log.md`，形成热点冲突。

结合四个项目，Herzi 下一步不应单纯把根文件扩写成百科全书，而应：

- 保留现有文档硬要求；
- 让 worker 写各自独立的任务记录，只有集成者更新中心索引和持续日志；
- 用根 `AGENTS.md` 定义角色、worktree、安全、验证和交接的稳定规则；
- 把 Herdr worktree 创建/清理、真实 UI 验证、发布等长流程放在 docs playbook 或 Skill；
- 对 `src/server`、`src/web`、`integrations` 只在出现真实局部不变量后增设嵌套文件；
- 日常 2–4 个 Agent 使用“单集成者 + 1–3 worker/reviewer”，禁止 worker 互相合并；
- 把 `npm run typecheck`、`npm test`、`npm run build` 作为集成基线，并逐步加入机械文档/生成检查。

完整落地方案见 [`agent-organization-design.md`](./agent-organization-design.md)。

## 11. 主要来源

### 11.1 通用规范

- AGENTS.md 官方说明：<https://agents.md/>
- OpenAI Codex `AGENTS.md` 发现与优先级：<https://developers.openai.com/codex/guides/agents-md>
- Claude Code memory、`CLAUDE.md`、`@AGENTS.md` 导入、rules 与 Skill 分层：<https://docs.anthropic.com/en/docs/claude-code/memory>
- GitHub Copilot repository instructions：<https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot>

### 11.2 Waku（固定提交）

- [`AGENTS.md`](https://github.com/egoist/waku/blob/ae49e6ed5a0495c3c6e03f3961e4e4b4b30f9336/AGENTS.md)
- [`CLAUDE.md`](https://github.com/egoist/waku/blob/ae49e6ed5a0495c3c6e03f3961e4e4b4b30f9336/CLAUDE.md)
- [`CONTRIBUTING.md`](https://github.com/egoist/waku/blob/ae49e6ed5a0495c3c6e03f3961e4e4b4b30f9336/CONTRIBUTING.md)
- [PR template](https://github.com/egoist/waku/blob/ae49e6ed5a0495c3c6e03f3961e4e4b4b30f9336/.github/pull_request_template.md)
- [`AGENTS.md` history](https://github.com/egoist/waku/commits/main/AGENTS.md)

### 11.3 Orca（固定提交）

- [`AGENTS.md`](https://github.com/stablyai/orca/blob/c33a446190bdfa21286a373e097c50a2b3e0a4d4/AGENTS.md)
- [`src/main/daemon/AGENTS.md`](https://github.com/stablyai/orca/blob/c33a446190bdfa21286a373e097c50a2b3e0a4d4/src/main/daemon/AGENTS.md)
- [`tests/AGENTS.md`](https://github.com/stablyai/orca/blob/c33a446190bdfa21286a373e097c50a2b3e0a4d4/tests/AGENTS.md)
- [`tests/e2e/AGENTS.md`](https://github.com/stablyai/orca/blob/c33a446190bdfa21286a373e097c50a2b3e0a4d4/tests/e2e/AGENTS.md)
- [`skills/orchestration/SKILL.md`](https://github.com/stablyai/orca/blob/c33a446190bdfa21286a373e097c50a2b3e0a4d4/skills/orchestration/SKILL.md)
- [`skills/orca-cli/SKILL.md`](https://github.com/stablyai/orca/blob/c33a446190bdfa21286a373e097c50a2b3e0a4d4/skills/orca-cli/SKILL.md)
- [`skills/orca-per-workspace-env/SKILL.md`](https://github.com/stablyai/orca/blob/c33a446190bdfa21286a373e097c50a2b3e0a4d4/skills/orca-per-workspace-env/SKILL.md)
- [Worktrees documentation](https://www.onorca.dev/docs/model/worktrees)
- [Contributor guide](https://github.com/stablyai/orca/blob/c33a446190bdfa21286a373e097c50a2b3e0a4d4/.github/CONTRIBUTING.md)
- [PR template](https://github.com/stablyai/orca/blob/c33a446190bdfa21286a373e097c50a2b3e0a4d4/.github/pull_request_template.md)

### 11.4 T3 Code（固定提交）

- [`AGENTS.md`](https://github.com/pingdotgg/t3code/blob/f8500f11271622ed82df7f6c1d7f73eddb4f43e6/AGENTS.md)
- [`CLAUDE.md`](https://github.com/pingdotgg/t3code/blob/f8500f11271622ed82df7f6c1d7f73eddb4f43e6/CLAUDE.md)
- [`t3.json`](https://github.com/pingdotgg/t3code/blob/f8500f11271622ed82df7f6c1d7f73eddb4f43e6/t3.json)
- [`test-t3-app/SKILL.md`](https://github.com/pingdotgg/t3code/blob/f8500f11271622ed82df7f6c1d7f73eddb4f43e6/.agents/skills/test-t3-app/SKILL.md)
- [`AGENTS.md` history](https://github.com/pingdotgg/t3code/commits/main/AGENTS.md)

### 11.5 OpenAI Codex（固定提交）

- [`AGENTS.md`](https://github.com/openai/codex/blob/ffae979216bfbe94070bd21868d1695277105a63/AGENTS.md)
- [`bottom_pane/AGENTS.md`](https://github.com/openai/codex/blob/ffae979216bfbe94070bd21868d1695277105a63/codex-rs/tui/src/bottom_pane/AGENTS.md)
- [`code-review/SKILL.md`](https://github.com/openai/codex/blob/ffae979216bfbe94070bd21868d1695277105a63/.codex/skills/code-review/SKILL.md)
- [`code-review-context/SKILL.md`](https://github.com/openai/codex/blob/ffae979216bfbe94070bd21868d1695277105a63/.codex/skills/code-review-context/SKILL.md)
- [`code-review-testing/SKILL.md`](https://github.com/openai/codex/blob/ffae979216bfbe94070bd21868d1695277105a63/.codex/skills/code-review-testing/SKILL.md)
- [`code-review-change-size/SKILL.md`](https://github.com/openai/codex/blob/ffae979216bfbe94070bd21868d1695277105a63/.codex/skills/code-review-change-size/SKILL.md)
- [`babysit-pr/SKILL.md`](https://github.com/openai/codex/blob/ffae979216bfbe94070bd21868d1695277105a63/.codex/skills/babysit-pr/SKILL.md)
- [`.worktreeinclude`](https://github.com/openai/codex/blob/ffae979216bfbe94070bd21868d1695277105a63/.worktreeinclude)
