# Review 任务：工具调用专属展开视图（独立审查）

- 日期：2026-09-18
- 审查对象：`review-20260917-tool-call-detail-ui` 分支（= Worker 交付 `04ed530`，base `4b549a1`）
- 本 worktree：`/Users/chiyizi/.herdr/worktrees/herzi/review-20260917-tool-call-detail-ui`，Herdr workspace `w1A` / pane `w1A:p1`
- 你的**唯一写入范围**：本文件（`.agents/tasks/20260917-tool-call-detail-ui-review.md`）

## 1. 必要阅读（先读完再下结论）

1. `docs/tool-call-detail-ui-plan.md` —— 设计依据（含 §4 实测数据、§5.4 视图规格、§9 已完成的四项核对）
2. `.agents/tasks/20260917-tool-call-detail-ui.md` —— Worker 的任务契约 + Worker 的「过程与决策」「验证与交接」（含「有意偏离」与「不稳定项」两节，请逐条核对是否与代码一致）
3. 交付 diff：`git diff 4b549a1..04ed530 --stat`，以及三个 commit（`c06e4c4`、`0cc3bea`、`04ed530`）

## 2. 规则

- **只读产品代码**：不得修改 `src/**`、`integrations/**`、`docs/**`、任何测试或配置；不得提交除本文件之外的改动。
- **不修 bug**：发现问题只报告，由 Integrator 决定退回 Worker 修复。
- **不 merge / rebase / push**，不改 `main`。
- **不运行 `npm run dev`**（端口与集成态冲突）。可以运行测试与构建（见 §4）。
- **不读取任何真实 Pi session / JSONL**，也不要把真实文件内容写入本文件。测试数据必须保持合成值。
- 保留原 worktree 不动；你只在这个 review worktree 里跑命令。

## 3. 重点审查项（按重要性）

1. **白名单是否真的白名单**：`ChatToolDisplay` 的每个字段是否都经过显式形状校验？能否构造一个畸形或超大的 `details`（深层嵌套、超大数组、`__proto__`、`toString` 之类特殊键、非数组的 `answers`、超出 1000 字符的字段）证明有内容漏进浏览器或造成崩溃/巨型 payload？`display` 是否可能包含 `details` 之外的键（有测试声称按键断言，请核对能否绕过）？`result` 语义是否完全未变（含图片 `herzi-tool-result` 包装路径）？
2. **解析器会不会输出错值**（比回退更糟的情形）：`parsePiDisplayDiff` 的 all-or-nothing 策略、`parseReadRangeSummary`、`read` 尾部 marker 的**服务端解析**与**前端剥离**是两份正则——它们不一致时会怎样？`ffgrep` 分组的边界情形（文件头行本身含 `:`、行号不连续、上下文行号小于匹配行、CRLF、超长行）会不会被误判成匹配行？`read` 行号在 `offset` 非法时的行为是否符合契约（不猜）？
3. **实时与历史一致性**：`integrations/pi/extensions/herzi-bridge.ts` 的手抄投影与 `src/server/pi-session-reader.ts` 是否有真实漂移？parity 测试覆盖了什么、**没**覆盖什么（Worker 自述覆盖不到 Pi 运行时事件形状）？两份实现的维护风险是否被记录下来？
4. **前端安全与只读性**：视图是否真的无任何交互入口（`ask_user_question` 不得有回答按钮）？Markdown/外链渲染是否沿用了既有安全策略（`markdownLink.tsx`）而不是新开 `dangerouslySetInnerHTML`？`web_search` 结果外链、`web_fetch` 正文里是否可能注入？`target="_blank"` 的 `rel` 是否与既有实现一致？
5. **范围与既有行为不变**：是否越出契约 write set（`git diff --name-only 4b549a1..04ed530` 逐项核对）？折叠行文案、分组规则、`Worked for` 结构、`toolCatalog` 既有导出行为是否真的未变（注意 `TODO_ACTIONS` / `webHost` 的 `export` 是否带来行为差异）？`isError` 语义是否未动？
6. **不稳定测试**：Worker 记录了一次未能复现的失败（`1 failed | 176 passed`，随后 32 次通过）。请尝试复现：按 §4 命令**重复运行**（例如连续 10 次以上），若复现请给出完整断言与路径；若未复现，说明你做了多少次、是否观察到任何可疑共享状态（`vi.stubGlobal`、模块级可变状态、时间依赖、`Date.now()`、随机 id）。
7. **降级路径**：未注册工具、缺 `display`、解析失败、空结果、图片结果、超长结果六种情况是否都回退到既有 `Arguments`/`Result` 而不是空白或错值？

## 4. 可运行的验证命令

```bash
npm ci            # 若缺 node_modules；不得修改依赖版本
npx vitest run src/web/toolViews src/web/toolCatalog.test.ts src/web/components/ChatView.test.tsx src/server/pi-session-reader.test.ts
npm run typecheck
npm test
npm run build
```

真实浏览器与真实 Pane 验收**不要求也不授权**，不要声称完成。

## 5. Findings 格式（必须逐条给出）

```
[严重程度: blocking | high | medium | low | info]
位置：<path:line>
触发条件：
影响：
证据：（命令 + 实际输出摘要，或引用代码行）
建议方向：
```

要求：

- 每条必须可证伪：给出复现路径或代码依据；推断要标注「推断」。
- 明确区分「产品代码问题」与「Worker 记录不准确」。
- 不要为了凑数报告风格问题；不要重复 Worker 已自述的偏离（除非你认为该偏离本身错误）。
- 最后给出结论：**可合入 / 需修复后合入 / 不可合入**，以及你运行过的命令与结果（`PASS` / `FAIL` / `NOT RUN`）。

## 6. 交接

完成后把 findings 写入本文件并提交 1 个 commit，保持在 Pane 等待开发者通知 Integrator，不自行合入。若发现需要产品决策的问题，直接在 Pane 里向开发者提问。
