# Herzi Agent 协作流程

> 状态：当前项目规范
> 适用范围：单 Agent 开发，以及 2–4 个 Agent 的轻量并行开发
> 规则源：[`../AGENTS.md`](../AGENTS.md)
> 设计依据：[`agent-organization-design.md`](./agent-organization-design.md)

## 1. 目标

本流程解决四个问题：

1. 多个 Agent 不在同一 checkout 中相互覆盖。
2. Worker 的任务范围、验证结果和未决问题可以被主控准确接收。
3. 大改动在进入正式 integration branch 前可以由独立 Reviewer 检查。
4. `main` 的最终控制权始终属于开发者。

本流程不建设调度平台，不使用复杂状态机。并行不划算时，直接退回单 Agent。

## 2. 角色

### 开发者

- 提出需求并决定产品方向。
- 批准创建 worktree、发送 Worker prompt 和真实 GUI/Agent 操作。
- 可以直接进入 Worker 或 Reviewer Pane 沟通。
- Worker/Reviewer 完成后手动通知主控。
- 最终批准或拒绝合入、推送 `main`。

### Integrator（主控 Agent）

- 判断是否值得并行。
- 提交简短拆分方案和拟发送的 Worker prompt。
- 创建 integration/worker/review worktree。
- 发送 prompt 后只确认 Agent 进入 `working`，不持续等待。
- 接收完成通知后检查 commit、范围、记录和验证。
- 集成合格的 Worker commit，运行组合验证。
- 汇总结果，等待开发者批准 `main`。

### Worker

- 在独立 Herdr worktree 中完成一个明确目标。
- 只修改约定范围。
- 在 `.agents/tasks/<task-id>.md` 记录过程、决策和验证。
- 遇到问题或决策点时直接向开发者提问并等待。
- 完成后提交 commit，留在 Pane 等待开发者通知主控。
- 不合并其他 Worker，不合入或推送 `main`。

### Reviewer（可选）

- 用于协议、并发、持久化、安全、隐私、大 diff 或开发者指定的改动。
- **Agent 种类默认与 Worker 一致（当前为 `pi`）**：换用其它 agent 或模型必须先获得开发者同意；混用会让审查环境、工具集与验证口径不一致，findings 的可复现性下降。
- 在独立 review candidate 中检查组合结果。
- 默认只读产品代码，只允许写 review 记录。
- Findings 必须包含严重程度、`path:line`、触发条件、影响、证据和建议方向。
- 不直接修复；问题原则上退回原 Worker。

## 3. Worktree 拓扑

典型并行批次：

```text
main workspace
  └─ 开发者当前工作区；不得被 Worker 或 Integrator擅自整理

integration worktree
  └─ 本批次候选集成分支
       ├─ cherry-pick Worker A
       ├─ cherry-pick Worker B
       └─ 运行组合验证

worker worktree A
  └─ 独立任务、独立 branch、独立 Agent Pane

worker worktree B
  └─ 独立任务、独立 branch、独立 Agent Pane

review worktree（按需）
  └─ integration 当前状态 + 待审 Worker commit
```

Herdr 是 worktree 生命周期的优先管理层。当前版本约束见 [`herdr-worktree.md`](./herdr-worktree.md)：

- worktree 是带 Git provenance 的 Herdr workspace；
- create/remove 是异步操作，必须核实结果；
- linked worktree 不能作为新 worktree 的 source，必须从父仓库 workspace 创建；
- remove checkout 不会删除 branch；
- 脏 checkout 不得自动 force remove。

## 4. 文件化记录

所有过程必须有项目文件记录，但不要求全部位于 `docs/`。

| 内容 | 位置 |
| --- | --- |
| 长期架构、研究、功能说明、ADR、项目状态 | `docs/` |
| 并行任务执行记录 | `.agents/tasks/<task-id>.md` |
| 批次协调记录 | integration branch 的 `.agents/tasks/<batch-id>.md` |
| 独立 review findings | review branch 的 `.agents/tasks/<review-id>.md` |
| 代码局部不变量 | 测试或必要的简短注释；影响实现的结论仍写任务记录或 docs |

Worker 不同时修改共享持续日志。`docs/README.md`、`docs/development-log.md`、`docs/research-log.md` 等由 Integrator 在集成阶段统一更新。

最小任务记录只需：

```markdown
# 任务名称

- 目标：
- 修改范围：
- 验收条件：
- Base / branch / worktree：

## 过程与决策

## 验证与交接
```

## 5. 完整流程

### 阶段 A：判断是否并行

Integrator 先检查：

- 目标是否能独立描述；
- 修改文件是否基本不重叠；
- 共享接口是否稳定；
- 每项是否能单独验证；
- 并行节省是否大于协调成本。

任一关键条件不满足时，建议单 Agent 串行完成。

### 阶段 B：只提交规划

Integrator 提交一个简短方案：

- Worker 数量；
- 每个 Worker 的目标和修改范围；
- 需要创建的 Herdr worktree；
- 拟发送 prompt；
- Worker 局部验证；
- Integrator 组合验证；
- 是否建议独立 Reviewer。

此时不创建 worktree，不发送 prompt。

### 阶段 C：开发者授权

开发者明确授权后，Integrator 才能：

- 创建约定的 integration/worker worktree；
- 写入规划基线；
- 启动 Worker；
- 发送已经确认的 prompt。

该授权不自动包含：

- 扩大任务范围；
- 操作真实业务 Pane；
- destructive Git 或 force remove；
- 合入或推送 `main`。

### 阶段 D：建立规划基线

1. 检查当前 branch、HEAD 和 `git status`。
2. 不处理开发者已有未提交改动。
3. 从一个明确的 committed SHA 创建 integration worktree。
4. 在 integration branch 写入本批次需要的规则和任务记录，提交 planning baseline。
5. 从同一 planning baseline 创建 Worker worktree。

如果未提交改动必须进入任务 base，先由开发者决定如何提交或隔离，Integrator 不自动 stash/commit。

### 阶段 E：启动 Worker

1. 在每个 Worker root pane 启动一个有唯一名称的 Agent。
2. Prompt 必须包含：
   - 目标和验收条件；
   - 允许与禁止修改范围；
   - 验证命令；
   - 文件记录要求；
   - 不得 merge/rebase/push；
   - 遇到决策点直接问开发者；
   - 完成后留在 Pane。
3. 发送 prompt 后，通过 Herdr 状态确认 Worker 已进入 `working`。
4. 记录 workspace、pane、branch、agent name 和状态。
5. 立即把控制交还开发者，不等待完成、不轮询输出。

### 阶段 F：开发者与 Worker 交互

开发者可以直接：

- 打开 Worker Pane 查看进度；
- 回答 Worker 的问题；
- 收窄或补充需求；
- 要求 Worker 在自己的范围内追加验证。

如果需求变化导致修改范围扩大、与另一 Worker 冲突或改变架构，Worker 必须暂停，由开发者通知 Integrator 重新拆分。

### 阶段 G：Worker 完成通知

Worker 完成时应：

- 状态进入 `idle` 或 `done`；
- worktree clean；
- 有一个或少量清晰 commit；
- 任务记录列出命令及 `PASS` / `FAIL` / `NOT RUN`；
- 说明剩余风险和真实验收边界。

开发者手动通知 Integrator，例如：“`herzi_links` 已完成，请接收并集成。”

### 阶段 H：Integrator 接收交付

Integrator 依次检查：

1. Agent 状态和最近交付说明。
2. Worker worktree 是否 clean。
3. 从 planning baseline 到 HEAD 的 commit。
4. changed files 是否越过任务范围。
5. 任务记录是否与实际 diff、测试相符。
6. 是否存在未回答的产品决策。
7. 是否需要独立 Code Review。

不合格时退回 Worker，不把不明确结果直接拼进 integration branch。

### 阶段 I：独立 Code Review（按需）

对于高风险或较大改动：

1. 暂停正式 integration。
2. 从当前 integration HEAD 创建独立 review worktree。
3. 只在 review branch 中 cherry-pick 待审 Worker commit，形成 candidate。
4. 创建 review 任务记录。
5. 启动只读 Reviewer；确认 `working` 后停止等待。
6. 开发者可以直接与 Reviewer 交互，完成后手动通知 Integrator。
7. Integrator逐项裁决 findings：
   - accepted：退回原 Worker 修复；
   - false positive：记录理由；
   - deferred：必须有开发者明确接受；
   - blocking：修复并复审后才能集成。

Reviewer 不在正式 integration branch 上边审边改，避免审查证据和候选代码同时变化。

### 阶段 J：正式集成

Reviewer 通过或无需 Reviewer 时：

1. 按依赖顺序 cherry-pick Worker commit 到 integration branch。
2. 纯文本冲突可由 Integrator 在理解意图后解决。
3. 行为、接口或需求冲突退回 Worker，不自行猜测。
4. 每个 Worker 集成后运行相关目标测试。
5. 所有 Worker 集成后运行完整基线。

### 阶段 K：验证

Worker 可以运行：

```bash
npm ci                         # worktree 无 node_modules 时
npm test -- <target-test>
npm run typecheck
npm run build                  # 变更需要时
```

Integrator 在组合态默认运行：

```bash
npm run typecheck
npm test
npm run build
```

当前 Worker 默认不能运行 `npm run dev`：server/Vite 固定使用 3030/5173，多个 worktree 会冲突或连接错误后端。

所有结果必须标记：

- `PASS`：真实运行并通过；
- `FAIL`：真实运行但失败；
- `NOT RUN`：未执行；
- 未查证：没有足够证据下结论。

### 阶段 L：Browser Use / CUA 实测（按需）

工具不能替代测试环境隔离。

- Web 页面优先 browser-use，通过 CDP 后台测试。
- CUA 只用于 CDP 无法覆盖的原生窗口、菜单、焦点或系统交互。
- foreground delivery 需要开发者单独授权。
- 同一时间只给一个 Agent 本地 GUI 测试租约。
- 必须使用分配端口、Agent 自己拥有的进程、自己创建的 tab/window 和 synthetic 数据。
- 不得访问其他 tab、真实 transcript 或业务 Pane。
- 只停止自己记录的 PID，不按名称批量杀进程。

当前项目没有 per-worktree dev ports 和 synthetic Chat fixture，因此默认由 Integrator 在集成后串行实测。真实 prompt 链路需要开发者另行授权专用 synthetic Agent Pane。

### 阶段 M：提交开发者批准

Integrator 给出：

- integration branch 和 HEAD；
- 集成的 Worker commit；
- 主要行为变化；
- 自动验证结果；
- review findings 及处置；
- 真实验收的 `PASS` / `NOT RUN`；
- 已知限制和回滚方式。

在开发者明确批准前：

- 不合入 `main`；
- 不推送 `main`；
- 不删除 Worker/review worktree；
- 不删除 branch。

### 阶段 N：合入与清理

获得批准后：

1. 合入 `main`。
2. 在 `main` 再核实必要检查或 commit 可达性。
3. 确认所有 Worker commit 已进入主线。
4. 通过 Herdr 清理 worktree。
5. 脏 worktree 不 force remove。
6. branch 是否删除单独决定。
7. 保留任务、review 和批次记录。

## 6. 状态约定

不使用中央 task board。一次批次只需要理解以下状态：

```text
规划中
  -> 已授权
  -> Worker working
  -> Worker 已完成（等待开发者通知）
  -> 接收/Review
  -> 已集成
  -> 已验证
  -> 等待 main 批准
  -> 已合入/已清理
```

`blocked` 表示正在等待开发者决策或外部条件。状态记录在各自任务文件和 Herdr Agent 状态中。

## 7. 停止与回退条件

立即暂停并询问开发者：

- 发现非本任务或意外文件变化；
- Worker 需要修改另一 Worker 的范围；
- 需求有多种合理解释；
- 需要新 production dependency、公开协议或 schema 变化；
- 需要真实 transcript、token、数据库或项目外私人文件；
- 需要 force、删除、覆盖、GUI foreground 或真实 Agent prompt；
- Reviewer 发现 blocking issue；
- integration 准备进入 `main`。

不得使用 `git reset --hard`、`git checkout --`、自动 stash 或 force remove 来“恢复流程”。

## 8. 当前流程的轻量原则

- 小任务不并行。
- 普通任务不启动 Reviewer。
- 不因流程而复制文档。
- 不自动等待 Worker；由开发者掌握交互节奏。
- 不把测试通过写成真实运行验收完成。
- 没有真实问题就不增加角色、状态或自动化。
