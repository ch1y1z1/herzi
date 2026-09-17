# 开发者 Agent 使用说明

> 面向：向主控 Agent 提需求、与 Worker/Reviewer 交互并决定最终合并的开发者
> 完整流程：[`agent-collaboration-workflow.md`](./agent-collaboration-workflow.md)

## 1. 最简单的使用方式

普通任务直接描述需求即可，不需要每次声明“你是主控 Agent”。当前与你直接沟通的 Agent 默认可以承担 Integrator。

```text
请修复 Chat 中链接没有高亮的问题，并让链接默认在新 tab 打开。
```

主控会先判断任务是否需要并行：

- 简单、同一文件或强依赖任务：单 Agent 完成；
- 目标独立、修改范围分离：建议并行并先提交方案。

如果你不希望并行，可以直接说：

```text
这次不要创建 Worker 或 worktree，由你单独完成。
```

## 2. 推荐的两阶段授权

### 第一步：只看规划

```text
请作为主控 Agent 处理以下需求：

<需求正文>

先判断是否值得并行，并给出：
1. 任务拆分；
2. 每个 Worker 的修改范围；
3. worktree 数量；
4. 拟发送给 Worker 的 prompt；
5. 集成与验证方案。

暂时不要创建 worktree 或发送 prompt，等我确认。
```

你应看到一份简短规划，而不是 Agent 立即执行。

### 第二步：授权创建与派发

```text
确认方案。授权你创建一个 integration worktree 和两个 Worker worktree，
写入规划基线，并向两个 Worker 发送 prompt。

不得操作真实业务 Pane，不得合入或推送 main。
发送 prompt 并确认 Worker 进入 working 后就停止等待；
Worker 完成后我会手动通知你。
```

这项授权允许：

- 创建约定数量的 worktree；
- 启动 Worker；
- 发送已经确认的 prompt；
- 后续接收、review、集成和自动验证。

它不允许：

- 合入或推送 `main`；
- force remove 或删除 branch；
- 扩大任务范围；
- 操作无关的真实 Agent Pane；
- 访问私人 transcript、token 或数据库。

## 3. 一次性预授权

如果你不需要先检查拆分：

```text
请作为主控 Agent 处理以下需求：<需求>。

如果适合并行，授权创建最多 2 个 Worker worktree 并发送 prompt；
由你负责后续集成和验证。
不得操作真实业务 Pane；合入或推送 main 前必须再次询问我。
```

主控仍应在执行前说明实际采用的拆分，但不需要等待第二次确认。

## 4. 如何识别不同 Workspace

常见 Herdr label：

| Label | 含义 |
| --- | --- |
| `agent-integration-<batch>` | 候选集成区，不是 Worker |
| `worker-<task>` | 实现任务的 Worker |
| `reviewer-<batch>` | 独立 Code Review candidate |

主控交付派发结果时应列出：

- workspace ID；
- pane ID；
- branch；
- agent name；
- 当前 `working` 状态。

你可以在 Herdr 中直接切换到对应 Workspace/Pane。

## 5. 如何与 Worker 互动

主控发送 prompt 并确认 `working` 后不会持续等待。你可以直接在 Worker Pane 中：

- 回答问题；
- 澄清验收条件；
- 要求补充局部测试；
- 查看 Worker 的完成摘要；
- 要求它继续在原任务范围内修改。

Worker 遇到决策点时应直接向你提问，不需要主控代传。

如果你的新要求会扩大文件范围或与另一个 Worker 冲突，请先暂停 Worker，再通知主控重新规划：

```text
请先停止扩大实现范围。我需要主控重新判断任务拆分。
```

## 6. 如何通知 Worker 已完成

Worker 完成后，向主控发送：

```text
herzi_links 已完成，请接收并进行阶段性集成。
```

或者多个一起完成：

```text
所有 Worker 都已完成，请开始接收、review 和集成。
```

主控随后会检查：

- Worker 是否 `idle` / `done`；
- worktree 是否 clean；
- commit 和 changed files；
- 是否越过修改范围；
- 测试记录是否真实；
- 是否需要独立 Reviewer。

通知完成不等于授权进入 `main`。

## 7. 如何要求独立 Code Review

对于大改动或高风险路径：

```text
确认创建一个独立 review worktree。

请基于当前 integration branch 加上 <Worker commit> 构建 review candidate，
启动一个只读 Code Review Agent。

Reviewer 可以运行自动测试，但不得修改产品代码、不得运行 npm run dev、
不得操作真实业务 Pane。发送 prompt 并确认进入 working 后停止等待，
完成后我会手动通知你。
```

Reviewer 可以直接向你提问。完成后通知主控：

```text
herzi_reviewer 已完成，请读取 findings 并给出处置建议。
```

主控会把 findings 分类为：

- 接受并退回原 Worker 修复；
- false positive，并说明理由；
- 延后处理，需要你明确接受；
- blocking，未修复前不集成。

## 8. 如何授权 Browser Use

Web 页面实际交互优先使用 browser-use。

```text
授权 Worker A 在完成代码后使用 browser-use 进行实际 Web 测试。

限制：
- 只能使用分配给它的独占测试环境和 synthetic 数据；
- 只能操作自己创建的 browser tab；
- 使用后台 CDP，不激活或切换我的可见 tab；
- 不得访问其他 tab、真实 transcript 或业务 Pane；
- 不得运行 CUA foreground delivery；
- 测试后只停止自己启动的进程并记录结果。
```

如果没有分配隔离端口和 synthetic 数据，Worker 不应直接实测，而应把浏览器验收标记为 `NOT RUN`，交给 Integrator 串行处理。

当前 Herzi 的 `npm run dev` 固定使用 3030/5173，因此不能由多个 Worker 并行启动。

## 9. 如何授权 CUA

CUA 用于 browser-use 无法覆盖的原生窗口、菜单、焦点或系统交互：

```text
授权你使用 CUA 测试指定应用和窗口。

仅允许绑定指定 PID/window ID 的后台操作。
不得控制桌面、切换前台、移动系统鼠标或操作其他窗口。
如果后台操作不足，需要 foreground delivery 时先向我询问。
```

如果你确实允许可见的前台接管，要单独说明：

```text
本次允许 CUA 对指定窗口使用 foreground delivery；
不得操作其他应用，完成后恢复并验证窗口状态。
```

不要把“允许 CUA”理解为自动允许桌面截图、前台切换或任意窗口控制。

## 10. Worker 可以运行哪些命令

默认允许：

```bash
npm ci
npm test -- <target-test>
npm run typecheck
npm run build
```

默认不允许：

```bash
npm run dev
```

原因不是命令危险，而是当前固定端口会使多个 worktree 冲突或连接到错误后端。需要实际运行时，由主控分配独占测试环境。

Worker 必须把结果写成：

- `PASS`：真实运行通过；
- `FAIL`：真实运行失败；
- `NOT RUN`：没有执行；
- 未查证：没有足够信息确认。

## 11. 如何批准最终进入 main

主控完成集成、review 和验证后会给出：

- integration branch / HEAD；
- 集成的 Worker commits；
- 自动验证结果；
- 真实验收结果或 `NOT RUN`；
- findings 处置；
- 已知限制。

如果接受：

```text
批准将 integration branch 合入 main。
合入后重新核实状态，但暂不 push。
```

如果同时允许推送：

```text
批准合入 main，并在确认本地验证通过后 push origin/main。
```

如果不接受：

```text
暂不批准合入 main。请先处理以下问题：
1. ...
2. ...
```

“批准合入”和“批准 push”是两个独立权限；不写 push 就不会默认推送。

## 12. 如何停止或放弃批次

暂停 Worker：

```text
暂停 herzi_delivery，不要继续修改；保留当前 worktree 和未提交状态，等待我决定。
```

放弃某个 Worker 结果：

```text
不要集成 herzi_delivery 的 commit；保留 branch/worktree，不要删除，先说明当前状态。
```

清理前先要求盘点：

```text
请列出本批次所有 workspace、branch、commit、dirty 状态和是否已进入 main，
暂时不要删除。
```

确认后再授权：

```text
授权清理已经进入 main 且 worktree clean 的本批次 Worker/Review worktree。
不要 force remove；不要删除 branch。
```

## 13. 主控不会默认做什么

除非你明确授权，主控不会：

- 自动等待和轮询 Worker 完成；
- 操作真实业务 Pane；
- 访问私人 transcript 或项目外文件；
- 启动多个冲突的 dev server；
- 使用 GUI foreground control；
- 自动回复外部 GitHub 用户；
- force remove、删除 branch 或覆盖未提交改动；
- 合入或推送 `main`。

## 14. 推荐日常话术

### 普通单任务

```text
请处理以下需求：<需求>。
先检查现状；如果不值得并行就直接单 Agent 完成。
```

### 并行但先审方案

```text
请作为主控 Agent 规划这个需求。
先给出拆分、范围、Worker prompt 和验证方案，不要执行，等我确认。
```

### 授权派发

```text
确认方案。授权创建约定的 integration/Worker worktree 并发送 prompt。
确认进入 working 后停止等待；完成后我通知你。不得进入 main。
```

### 通知完成

```text
<agent name> 已完成，请接收并检查。
```

### 要求 Review

```text
先不要正式集成。创建独立 review candidate，派只读 Reviewer；
确认 working 后停止等待，完成后我通知你。
```

### 最终批准

```text
批准合入 main，但不要 push。
```

## 15. 常见问题

### 我需要每次说“你是主控 Agent”吗？

不需要。直接与你沟通的 Agent 默认可以担任主控。只有需要强调“先规划、不执行”时才建议明确写出。

### 我可以同时和 Worker、Reviewer 聊吗？

可以。它们遇到决策点也应该直接问你。影响任务边界的决定要通知主控，以免 integration 仍按旧计划执行。

### 为什么主控不自动等 Worker？

这样你可以自由进入 Worker Pane 交互，不会让主控会话长期占用等待。完成事件由你手动通知，流程更可控。

### integration workspace 是什么？

它是组合 Worker commit、运行完整测试和准备最终候选的隔离区，不是额外实现任务的 Worker。

### review workspace 为什么单独存在？

它允许 Reviewer 看见完整候选代码，同时保持正式 integration branch 不受未经审查的 Worker commit 影响。

### Worker 能启动 `npm run dev` 吗？

当前默认不能。先解决 per-worktree 端口和 synthetic 数据隔离，或由主控为单个 Worker 分配独占环境。

### Worker/Reviewer 完成后会自动合并吗？

不会。Worker commit 先由主控接收；高风险改动先 review；integration 通过后仍需你批准 `main`。

## 16. 全局规则（`~/.pi/agent/AGENTS.md`）

以下四节位于开发者的全局 Pi 上下文文件，适用于这台机器上的所有 Pi 会话，与本仓库规则并行生效。改这里会影响所有项目，改仓库 `AGENTS.md` 只影响本仓库。

| 章节 | 要点 |
| --- | --- |
| 全局要求（1–4 条） | 始终中文回答；不经许可不访问工作目录之外的私人文件；需求含糊先询问；禁止模糊措辞（未查证就写"未查证"） |
| 输出节奏（多步任务） | 开工前一句话说明打算；过程中主动给**中文**阶段性文字且不停下等确认；不逐个工具报账；收尾说清结果、验证与限制；用户明确要求时以用户要求为准 |
| 提问方式 | 需要拍板时**优先给选择题**（2–4 个，写清取舍）；不写"其他/自定义"占位；**调用 `ask_user_question` 前必须先用正文交代背景、术语、决策范围与影响、选项在比什么** |
| 隐私与外部访问 | 与"全局要求"第 2 条一致：确需访问项目外文件时先征求同意 |

约定来源与变更记录：

- 2026-09-17 加入「输出节奏」（参考 Memoh 的工作区指令，见 [`agent-activity-rendering-reference.md`](./agent-activity-rendering-reference.md) §5），并同日把第 2 条明确为"永远用中文"。
- 2026-09-17 加入「提问方式」（选择题优先），随后补充"提问前先铺垫必要信息"。
- 生效范围：新会话自动读取；已运行中的 Pi 会话需 `/reload` 或重启。
