# 第二轮独立复核：工具调用专属展开视图（findings 闭合 + 回归）

- 日期：2026-09-18
- 本轮 Candidate：`90d76e9` = Worker 交付 `04ed530` + 返修 `c318d86` + 扩范围修 `981c27a` + 第一轮记录（`8919243` 契约 / `90d76e9` 结果）
- 上轮候选：`04ed530`（第一轮 review 对象）
- 本 worktree：`/Users/chiyizi/.herdr/worktrees/herzi/review-20260917-tool-call-detail-ui-r2`，Herdr workspace `w1B` / pane `w1B:p1`
- 你的**唯一写入范围**：本文件（`.agents/tasks/20260917-tool-call-detail-ui-rereview.md`）
- 第一轮记录：`.agents/tasks/20260917-tool-call-detail-ui-review.md`（已在候选内，**未重写**，请读它的后半「审查结果」）

## 1. 必要阅读（先读完再下结论）

1. `.agents/tasks/20260917-tool-call-detail-ui-review.md` —— 第一轮六条 findings 与七个重点核查
2. `docs/tool-call-detail-ui-plan.md` —— 设计依据（§5.4 视图规格、§8 风险、§10 完成标准）
3. `.agents/tasks/20260917-tool-call-detail-ui.md` —— Worker 记录，重点读「过程与决策」「验证与交接」「Review findings 处置」「扩范围返修：`toolCatalog` 表查找」四节
4. 本轮修复 diff：`git diff 04ed530..90d76e9`（两个 commit：`c318d86`、`981c27a`）

## 2. 流程背景（必须先知道，否则会误判）

- **开发者裁决（2026-09-18）**：六条 findings **全部返修**；`#4②`（文件名为 `12:foo.ts` 的歧义）**由开发者明确接受为固有歧义**；并**扩本批范围**，要求把既有 `toolCatalog` 的表查找（`TOOL_META` / `TOOL_DESCRIBERS` / `TODO_ACTIONS`）一并修掉，因此本轮 diff 里 `src/web/toolCatalog.ts` 与 `src/web/toolCatalog.test.ts` 属**已授权**的范围扩大（原契约 §3 的 write set 未含后者）。
- **流程偏离（已知情并保留）**：`c318d86`、`981c27a` 是**主控代修**，不是原 Worker 自修。请照常按「返修交付」的强度审查——署名不同**不构成**降低验证强度或跳过验证的理由；若你认为代修本身引入了无法归属的责任漏洞，可作为 info 记录。
- 你的结论决定是否进入集成；`main` 未被合入、未被推送。

## 3. 规则

- **只读产品代码**：不得修改 `src/**`、`integrations/**`、`docs/**`、任何测试或配置；不得提交除本文件之外的改动。
- **不修 bug**：发现问题只报告，由开发者/主控决定退回修复。
- **不 merge / rebase / push**，不改 `main`，不碰其它 worktree。
- **不运行 `npm run dev`**（端口与集成态冲突）。可以运行测试与构建。
- **不读取任何真实 Pi session / JSONL**，也不要把真实文件内容写入本文件；测试数据保持合成值。
- 真实浏览器与真实 Pane 验收**不要求也不授权**，不要声称完成。

## 4. 本轮重点（逐条给校验点）

1. **F1 失败调用降级（medium）**
   - `ToolDetail` 是否在 `isError` 时**无条件**走通用详情；两条入口（assistant-ui `ToolFallback` 与 activity 行 `ToolItemRow`）是否都经过它。
   - 反向核对：是否存在「调用失败但 `isError` 没传到位」从而仍渲染结构化视图的路径（例如 `toolResult` 条目缺 `isError`、`mergeRealtime` 的合并分支、`toActivityItem` 的 `isError !== undefined` 判断）。若存在，请给出可达条件与后果。
   - 修法是否改变了 `isError` 语义（折叠行红色状态、`tool-error` 类、`isError` 的其它用途应不变）。
   - 是否出现新的信息损失（修前错误文本被误当内容；修后应为 `Arguments` + `Error` 两段，错误原文可见）。
2. **F2 投影体积上限（medium）**
   - 三个上限（`CHAT_DIFF_MAX_LINES` / `CHAT_DIFF_MAX_LINE_CHARS` / `CHAT_DIFF_MAX_CHARS`）的交互：命中任一时是否都置 `truncated: true`；正常 diff 是否会被误标；`lines` 是否会为空或丢掉首个改动。
   - `boundedStringArray` 逐项裁剪是否让 `selected` 语义失真（裁剪是否留下 `…` 标记）；64 项 × 1000 字符的上界是否真的成立。
   - bridge 手抄副本是否同步（常量、边界行为、parity 用例是否覆盖新边界）。
   - **请自行遍历 `ChatToolDisplay` 每个字段**的取值来源，找任何仍可放大 payload 的路径（含 `question` / `todo` 的新字段）。
3. **F3 原型链表查找（low，已扩范围）**
   - `tableLookup`（`toolCatalog`）、`toolViewFor`（`toolViews/index.ts`）、`todoActionLabel` 三处；`TODO_ACTIONS` 是否确实收回导出、是否还有别处 import 它。
   - 扫描**其它**普通对象索引（含本轮新引入的表/映射）是否仍有同类问题。
   - 对真实键零行为变化：`describeToolCall` 对 10 个真实工具名的输出、`todoActionLabel` 对真实 action 的输出，应与 `04ed530` 一致（可读代码或双 checkout 对比）。
4. **F4 ffgrep 边界（low；①返修，②已接受）**
   - ①：是否只剥离**一个**尾部 `\r`；CRLF 现可解析；LF 结果不受影响；行内其它位置/中间的 `\r` 不被吞。
   - ②：**已被开发者接受为固有歧义，请勿重复报告**；仅当你认为「接受」这一决定本身错误时，单独说明理由。
5. **F5 注释与记录一致性（info）**
   - 服务端与 bridge 两份 answers 投影注释是否与实际语义一致（非对象条目 → 整份放弃；无可识别字段的对象条目 → 跳过）。
   - 任务记录第 7 条与「处置」表是否与实现一致。
6. **F6 web_search 编号与计数（info）**
   - `<li value>` 是否保留原文编号；`partial` 判定是否可能误报（例如前导区本就有形如 `1. ` 的正文）；「切分出 N 条结果（其余文字保留在原文中）」与实际渲染是否一致。
7. **回归面**
   - 折叠行 / 分组 / `Worked for` 结构是否仍未被改（`toolCatalog` 本轮只应新增 `tableLookup` 与 `todoActionLabel`、收回 `TODO_ACTIONS` 导出）。
   - 六态降级：未注册工具、缺 `display`、解析失败、空结果、图片结果、超长结果、**调用失败**。
   - 只读性与外链策略：`ask_user_question` 无回答入口、无 `dangerouslySetInnerHTML`、外链仍走 `markdownLink.tsx`。
8. **稳定性（第一轮遗留）**
   - 第一轮首次运行 4 文件命令时出现过一次未复现的 `1 failed | 176 passed`；候选已加 `afterEach` 统一 `vi.unstubAllGlobals()`。本轮请**重复运行**：4 文件命令 ≥10 次、`npm test` ≥3 轮，如实报告次数与结果；若复现，给出完整断言与路径。
9. **越界核对**
   - `git diff --name-only 4b549a1..90d76e9` 应只包含：契约 write set + `src/web/toolCatalog.test.ts`（开发者授权的扩范围）+ 两份 review 记录。发现其它文件即列为 finding。

## 5. 可运行的验证命令

```bash
npm ci            # 若缺 node_modules；不得修改依赖版本
npx vitest run src/web/toolViews src/web/toolCatalog.test.ts src/web/components/ChatView.test.tsx src/server/pi-session-reader.test.ts
npm run typecheck
npm test
npm run build
```

## 6. Findings 格式（必须逐条给出）

```
[严重程度: blocking | high | medium | low | info]
位置：<path:line>
触发条件：
影响：
证据：（命令 + 实际输出摘要，或引用代码行）
建议方向：
```

要求：每条可证伪；推断要标注「推断」；区分「产品代码问题」与「记录不准确」；不要为凑数报告风格问题；不要重复开发者已接受的 `#4②`。最后给出结论（**可合入 / 需修复后合入 / 不可合入**）与你运行过的全部命令及结果（`PASS` / `FAIL` / `NOT RUN`）。

## 7. 交接

完成后把结论追加到本文件并提交 **1 个 commit**，保持在 Pane 等待开发者通知，不自行合入；若发现需要产品决策的问题，直接在 Pane 里向开发者提问。
