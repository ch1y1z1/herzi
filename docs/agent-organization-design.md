# Herzi Agent 组织架构设计方案（精简版）

> 日期：2026-09-16（UTC+08:00）
> 状态：最小规则层已实施，待选择真实任务试运行
> 配套调研：[`agent-organization-open-source-report.md`](./agent-organization-open-source-report.md)
> 实施范围：已更新 `AGENTS.md`、新增 `CLAUDE.md` 和 `.agents/tasks/`；未创建 Herdr worktree，未新增脚本或 CI

## 1. 修订结论

初版加入了四种常设角色、复杂状态机、task board、多套模板、指标和 P0–P5，超出当前 2–4 个 Agent 的需要。本版全部删除，只保留六项核心规则：

1. 根 `AGENTS.md` 是唯一通用规则源。
2. `CLAUDE.md` 只包含 `@AGENTS.md`。
3. 每个并行任务使用独立 Herdr worktree。
4. 一个批次只有一个 Integrator；其他 Agent 是 Worker，高风险任务可加 Reviewer。
5. Worker 跑局部检查，Integrator 在合并态跑完整检查。
6. integration branch 必须由用户批准后才能合入 `main`。

已确认前提：跨 Agent、日常 2–4 个 Agent、Herdr 管理 worktree、本地集成优先、单 Integrator、用户最终批准、所有过程必须有项目文件记录；长期文档继续放在 `docs/`，短期并行任务记录可以放在其他合适位置。

## 2. 来源与适用性

| 设计 | 开源项目中的类似实践 | 性质 |
| --- | --- | --- |
| 根 `AGENTS.md` | Waku、Orca、T3 Code、Codex 均采用 | 直接类似 |
| `CLAUDE.md` 薄导入 | Orca、T3 Code 使用 `@AGENTS.md`；Waku 使用 symlink | 直接类似 |
| 每任务独立 worktree | Orca 明确每任务独立 worktree/branch/files/terminal；T3 Code 隔离状态和端口 | 直接类似 |
| 单 Integrator | Orca 有 coordinator loop；T3 Code 由 primary agent 做集成验证；Codex 主 Agent 汇总 reviewer | 局部借鉴 + 用户决策 |
| 局部/集成两级验证 | Waku、T3 Code、Codex 都有相近规则 | 直接类似 |
| 用户批准 `main` | 本轮用户明确选择 | 用户决策 |
| 每任务独立文件记录 | 用于满足 Herzi 的过程留痕要求并避免共享日志冲突 | Herzi 推导 |

这不是复刻某个项目的完整制度。Orca 的 orchestration 是最接近的参考，但公开文件不能证明其维护团队每个 PR 都遵循同一角色模型。

## 3. 最小文件结构

已实施的最小结构：

```text
AGENTS.md
CLAUDE.md                  # 仅 @AGENTS.md

.agents/
  tasks/
    README.md
    <task-id>.md           # 并行任务的短期执行记录

docs/
  README.md
  agent-organization-open-source-report.md
  agent-organization-design.md
```

不创建 `.agents/skills/`、task board、多套模板、调度服务或状态数据库。

### 并行任务记录

多个 Worker 不应同时追加 `docs/README.md`、`research-log.md` 或 `development-log.md`。每个 Worker 只维护自己的 `.agents/tasks/<task-id>.md`：

```markdown
# 任务名称

- 目标：
- 修改范围：
- 验收条件：
- Base / branch / worktree：

## 过程与决策

## 验证与交接
```

普通单 Agent 任务继续使用现有 feature doc 或持续日志，不强制新建 task file。共享索引和持续日志由 Integrator 在合并后统一更新。长期有效的任务结论应整理到 `docs/`，`.agents/tasks/` 不替代架构或产品文档。

## 4. 角色

### Integrator

每批次一个，负责：

- 判断任务是否值得并行；
- 划定互不重叠的修改范围；
- 从同一已提交 base 创建 integration/worker worktree；
- 接收并检查 Worker commit；
- 按依赖顺序集成；
- 运行完整检查并更新共享文档；
- 请求用户批准是否合入 `main`。

来源：综合 Orca coordinator、T3 Code primary agent 和 Codex review orchestrator；具体权限由“单 Integrator”用户决策确定。

### Worker

每个 Worker 只负责一个独立目标：

- 在自己的 Herdr worktree 中工作；
- 只修改约定范围；
- 更新自己的任务记录；
- 运行相关局部检查；
- 提交清晰 commit；
- 报告 commit、验证结果和剩余问题。

Worker 不直接合入 `main`，也不合并其他 Worker 分支。

来源：独立 worktree 直接借鉴 Orca/T3 Code；单一集成入口来自用户决策。

### Reviewer（可选）

只在协议、session identity、并发、持久化、安全、隐私或较大 diff 中使用。Reviewer 默认只输出带文件和行号的问题，不直接改代码。普通任务不增加 Reviewer。

来源：借鉴 Codex 的专业 reviewer subagent 模式。

## 5. 是否并行

同时满足以下条件才并行：

- 目标可以独立描述；
- 修改文件基本不重叠；
- 共享接口已经确定；
- 每项可以单独验证；
- 节省的时间高于协调成本。

适合并行：稳定共享类型后的 server/web 实现、独立组件与测试、实现与不阻塞它的调研、集成后的只读 review。

必须串行：两个 Agent 修改同一协议或路由、API 尚未确定、任务本身很小、只有一个不可分割的真实运行环境。

不确定时默认串行。

## 6. 工作流程

### 6.1 准备

Integrator：

1. 检查 `git status`；不自动处理用户未提交改动。
2. 固定本批次 exact base SHA。
3. 为每个 Worker 写一份短任务记录，明确目标、范围和验收条件。
4. 从同一 base 创建一个 integration worktree 和所需 worker worktree。

若未提交改动必须进入 base，先询问用户如何处理。

### 6.2 Worker 执行

Worker：

1. 确认 cwd、branch、base 和任务文件。
2. 阅读根 `AGENTS.md` 及相关 feature doc。
3. 在约定范围内实现并记录关键决策。
4. 运行局部检查并提交 commit。
5. 完成后留在自己的 Pane，由用户手动通知 Integrator继续集成。
6. 向 Integrator 报告：
   - commit SHA；
   - 完成内容；
   - 运行命令及 `PASS` / `FAIL` / `NOT RUN`；
   - 风险和未验证项。

Integrator 发送 prompt 后只确认 Worker 进入 `working`，不持续等待。用户可以在此期间直接与 Worker 交互；Worker 遇到问题或决策点时直接向用户提问并等待。不使用复杂 handoff 模板。

### 6.3 集成

Integrator：

1. 检查 Worker diff 是否越界。
2. 按依赖顺序 cherry-pick 到 integration branch。
3. 纯文本冲突可在理解双方意图后解决；行为或接口冲突退回相关 Worker。
4. 完成集成态验证。
5. 更新 `docs/README.md`、相关 feature doc 或持续日志。
6. 向用户报告变更、验证、限制和 integration branch。
7. 等待用户批准；批准前不合入或推送 `main`。

### 6.4 清理

用户批准且变更进入主线后，才清理 Worker worktree。优先使用 Herdr；脏 worktree 不 force；删除 checkout 与删除 branch 分开确认。

## 7. Herdr 约束

现有 [`herdr-worktree.md`](./herdr-worktree.md) 已确认本机 Herdr 0.8.2：

- worktree 是带 Git provenance 的 workspace；
- `create/remove` 是异步操作；
- remove 不删除 branch；
- 脏 checkout 需要显式 force；
- 部分新版参数在 0.8.2 不存在。

因此创建后必须确认成功；不另建 worktree 状态库；raw `git worktree` 只用于只读诊断或经用户批准的故障恢复。

## 8. 验证

### Worker

按变更运行最小有效检查：相关 Vitest、`npm run typecheck`、文档链接检查或必要构建。worktree 不包含被 Git 忽略的 `node_modules`；缺少依赖时可按锁文件执行 `npm ci`，不改变依赖版本。

Worker 默认不运行 `npm run dev`。当前 server 固定使用 3030，Vite 固定使用 5173 且 proxy 指向 3030，多个 worktree 同时启动会发生端口冲突或连接到错误后端。需要视觉/交互验证时，由 Integrator 在集成态串行启动一个开发环境；如果未来需要 Worker 并行启动，则先把 server port、Vite port、proxy 和 redirect 全部改为显式的 per-worktree 配置。

所有结果明确标记 `PASS`、`FAIL` 或 `NOT RUN`，不能用自动测试冒充真实 Herdr/Pi/浏览器验收。

### Integrator

合并态默认运行：

```bash
npm run typecheck
npm test
npm run build
```

不能运行的项目必须说明原因，不能只引用 Worker 的独立结果。

### 真实验收

控制真实 Herdr Pane、Agent session、浏览器或 GUI 前先获得用户授权；使用专用 synthetic session，不读取私人会话正文。

Worker 可以在用户明确授权后使用 browser-use 或 CUA，但工具授权不能替代运行环境隔离：

- Web 页面交互优先用 browser-use，通过 CDP 后台测试；不激活或接管用户可见 tab。
- CUA 只用于浏览器 CDP 无法覆盖的原生窗口、菜单、焦点或系统级交互；默认仅后台窗口操作，foreground delivery 需要额外明确授权。
- 本地浏览器、应用窗口和 dev server 都是共享资源，同一时间只给一个 Worker 测试租约；多个 Worker 不得并发争用。
- 测试必须使用分配的端口、Worker 自己启动并拥有的进程、自己创建的 tab/window 和 synthetic 数据；不得读取用户其他 tab、真实会话或操作业务 Pane。
- Worker 完成后只停止自己记录的进程并清理自己创建的 tab/window；不能按名称批量杀进程。

当前 Herzi 尚未支持 per-worktree dev ports，且页面连接真实 Herdr 数据，因此默认仍由 Integrator 在集成后串行做实际浏览器验证。若要把实际测试下放给 Worker，应先提供端口隔离和 synthetic fixture/session；browser-use 或 CUA 本身不会解决这两个前置问题。

## 9. 必须询问用户的情况

只保留六类 decision gate：

1. 需求有多种合理解释。
2. 修改架构、公开协议、数据 schema 或 production dependency。
3. 访问仓库外私人文件、真实 transcript、token 或数据库。
4. destructive Git、force remove、删除 branch/worktree 或覆盖已有改动。
5. 控制 GUI、真实 Agent Pane、安装全局 integration 或发送真实 prompt。
6. integration branch 准备合入或推送 `main`。

其他正常代码阅读、范围内修改和无副作用测试不重复询问。

## 10. 根 `AGENTS.md` 目标

实施时把根文件控制在约 60–100 行，只增加必要规则：

1. 关键过程和结论写入 `docs/`。
2. 开始前检查工作区，不覆盖非本任务改动。
3. 发现意外变化立即停止并询问。
4. 不访问仓库外私人文件或真实会话数据。
5. 并行任务使用独立 Herdr worktree。
6. Worker 只修改约定范围并更新独立任务记录。
7. 一个批次只有一个 Integrator。
8. Worker 局部验证，Integrator 完整验证。
9. 未验证内容明确标记。
10. 未经用户批准不得合入或推送 `main`。

详细产品架构继续留在已有 docs，不复制到 `AGENTS.md`。

## 11. 实施方式

只分两步：

### 第一步：最小落地（已完成）

- 已更新根 `AGENTS.md`；
- 已新增仅含 `@AGENTS.md` 的 `CLAUDE.md`；
- 已建立 `.agents/tasks/` 文件记录位置；
- 已更新 `docs/README.md`；
- 未新增嵌套规则、Skill、脚本或 CI。

### 第二步：一次试运行（待选择真实任务）

选择一个能拆成两个独立范围的真实需求：1 个 Integrator、2 个 Worker、每 Worker 一份短记录。集成后运行完整检查并由用户批准。

试运行只复盘三件事：

1. 是否发生文件范围冲突？
2. Worker 的 commit 和验证信息是否足够？
3. 哪条规则没有实际价值？

没有真实问题就不增加新机制。

## 12. 最终模型

```text
用户
  └─ Integrator
       ├─ Worker A（独立 Herdr worktree）
       ├─ Worker B（独立 Herdr worktree）
       └─ Reviewer（仅高风险任务，可选）

Worker commits
  -> Integrator 本地集成
  -> typecheck + test + build
  -> 用户批准
  -> main
```

完成标准：不共用 checkout、不越过修改范围、集成态检查真实运行、并行文档不冲突、`main` 始终由用户决定，且协调成本低于并行节省的时间。若试运行不满足最后一项，应减少并行，而不是增加管理层。

## 13. 用户与主控 Agent 的沟通方式

“主控 Agent”即本方案中的 Integrator。用户不需要在每次普通需求中重复声明角色；直接描述需求即可，由当前 Agent 先判断单 Agent 是否足够。需要并行时，推荐两阶段确认：

### 阶段一：只分析，不执行

用户可以说：

```text
请作为主控 Agent 处理以下需求：……
先判断是否值得并行，并给出任务拆分、每个 Worker 的修改范围、worktree 数量、拟发送 prompt 和验证方案。
暂时不要创建 worktree 或发送 prompt，等我确认。
```

主控 Agent 应返回一个简短方案；若任务不值得并行，应明确建议单 Agent 完成，而不是为了使用流程强行拆分。

### 阶段二：授权执行

确认方案后，用户可以说：

```text
确认方案。授权你按上述拆分创建 Herdr worktree，并向 Worker 发送上述 prompt。
完成后由你集成和验证，但不要合入或推送 main；先把结果交给我确认。
```

这项授权允许创建约定的 worktree 和发送约定的 Worker prompt，不等于授权：

- 修改拆分之外的范围；
- force remove 或删除 branch；
- 操作无关的真实 Agent Pane；
- 合入或推送 `main`。

完成集成后，主控 Agent再次提交变更、验证和限制，由用户单独批准是否进入 `main`。

如果用户已经信任拆分，也可以在首条需求中一次性授权“若适合并行，可创建最多 N 个 Herdr worktree 并发送 prompt”，但仍建议保留 `main` 的最终单独批准门。

> 本节是最早的沟通协议草案。实际试运行后扩展出的完整批次流程（规划、授权、worktree、派发、开发者直接交互、独立 review、集成、验证、批准、清理）以 [`agent-collaboration-workflow.md`](./agent-collaboration-workflow.md) 为准，面向开发者的操作说明和话术见 [`developer-agent-guide.md`](./developer-agent-guide.md)。
