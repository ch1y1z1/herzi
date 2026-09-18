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

---

# 第二轮复核结果（独立 Reviewer，2026-09-18）

复核对象：候选 `90d76e9`（= `04ed530` + `c318d86` + `981c27a` + 第一轮记录），本轮实际 HEAD `14329dc`（仅在其上多了本复核契约）。
本 worktree 是复核用副本；**没有重写** `.agents/tasks/20260917-tool-call-detail-ui-review.md`，只写本文件。

## 结论：**可合入**

第一轮六条 findings：F1（失败调用降级）与 F2（投影体积上限）的原始缺口**已闭合**；F3 本批新增查找点 + 开发者授权扩范围的既有表查找均已加守卫；F4① 已修、② 为开发者已接受的固有歧义；F5 注释已与实现一致；F6 的编号/计数已修。

回归面与越界核对通过；第一轮遗留的那次未复现 flaky 在本轮 19 次聚焦运行 + 3 轮全量中**仍未复现**。

本轮只新增 1 条 `low`（F6 修复引入的 React key 冲突，可达但需畸形结果）与 3 条 `info`（记录/覆盖缺口）。按项目「findings 先处置再集成」规则，**请开发者在集成前对 F6-low 明确接受或随手修掉**；三条 info 不阻塞。

---

## Findings

```
[严重程度: low]
位置：src/web/toolViews/WebSearchView.tsx:41
触发条件：`web_search` 结果文本里出现两个相同编号的条目行（同一 N 的 `^N\.\s+\*\*` 顶层行），例如
          结果被拼接/回显或工具输出异常时出现 `1. **A**` 与 `1. **B**`。
影响：产品代码问题（本批 F6 修复新引入）。`key={entry.number}` 在编号重复时不再是唯一 key，
      React 会报「Encountered two children with the same key」并在列表更新时用不稳定的身份做协调；
      渲染结果本身仍是两条（编号都显示为原文的 1，这一点是忠于原文的）。修前用的是 `key={index}`，无此问题。
证据：用真实 `parseWebSearchText` 实测 `parseWebSearchText("1. **A**\n1. **B**")` → `entries:[{number:1},{number:1}]`（见 /tmp 只读脚本输出）；
      再用 react-dom/client + jsdom 渲染同样 key 的 `<li>`，捕获到 `console.error`：
      「Encountered two children with the same key, `%s`. Keys should be unique …」。
      `value={entry.number}` 在 `0` 时会被 HTML 规范忽略（`0. **X**` 显示为 1），属同一处次要边界。
建议方向：key 改为唯一值（如 `${entry.number}:${index}`），`value` 只在正整数时输出；编号保真本身保留。
```

```
[严重程度: info]
位置：src/server/pi-session-reader.ts:821（answers 长度上限）与 837-862（逐项 selected 上限）
类别：产品代码（残留上界缺口，非本轮发现的原始缺陷）
触发条件：构造 `ask_user_question` 的 `details.answers` 为 64 个条目、每条 `selected` 为 64 个超长字符串。
影响：F2 的逐项上限成立（每个字符串 ≤1001 字符、selected 数组 ≤64），但整个 `question` 投影仍是
      嵌套相乘：实测 64 × (64 × 5000 字符输入) → `JSON.stringify(display)` = **4,309,136 B（约 4.3 MB）**，
      是 diff 上限（约 202 KB）的 20 倍。仍是有限上界、比修前的 32 MB 小得多，且真实 `ask_user_question`
      只有 1–4 题，实际上不可达；但方案 §8「服务端投影前做体积上限」对 `display` 整体仍没有累计预算。
证据：/tmp 只读脚本（`stripTypeScriptTypes` 执行真实 `projectToolDisplay`）输出：
      `question worst-case -> bytes 4309136`、`answers 64`、`selectedPerEntry 64`；
      同一脚本确认 diff 2000 行 × 20 万字符 → 99 行 / 202,176 B / `truncated:true`，
      `boundedStringArray` 64 × 50 万字符 → 64,257 B（每项 1001 含 `…`）。
建议方向：给整份 `display` 加一个累计字符预算（与 diff 的三重上限同一模式），或在 `projectQuestionAnswers`
          里对 answers × selected 做总量裁剪；可选，不阻塞。
```

```
[严重程度: info]
位置：.agents/tasks/20260917-tool-call-detail-ui.md「修复后的验证（本轮实测，HEAD 含全部修复）」表 #1、#3
类别：记录不准确（不是产品缺陷）
触发条件：读任务记录与最终 HEAD 对账。
影响：表里写「5 files / 186 tests」「17 files / 260 tests」，但 `90d76e9` 实际是 **189 / 263**。
      原因是该表在 `c318d86` 之后写成，随后 `981c27a` 又给 `src/web/toolCatalog.test.ts` 加了 3 个用例；
      表头「HEAD 含全部修复」因此与末次 commit 不符。数字保守（少算而非多报），不掩盖失败。
证据：`git diff c318d86^..c318d86 -- '*.test.ts*' | grep -c '^+.*\bit('` = 9（177+9=186）；
      `git diff 981c27a^..981c27a -- '*.test.ts*' | grep -c '^+.*\bit('` = 3（186+3=189）；
      本轮实测 5 files/189 与 17 files/263（命令见下表）。另：任务记录「扩范围返修」一节也未补这两组数字。
建议方向：把该表更新为 189/263，或注明「186 为 `c318d86` 时的数字，`981c27a` 后为 189」。
```

```
[严重程度: info]
位置：src/server/pi-session-reader.test.ts:1032-1043（bridge parity 新增的两个用例）
类别：测试覆盖缺口（手抄副本漂移守卫不完整）
触发条件：未来只改 `herzi-bridge.ts` 或只改 `pi-session-reader.ts` 的 **总量** 上限常量。
影响：parity 用例用「20 行 × 5 万字符」的 diff 与「1 条 selected 5 万字符」的 answers。
      前者只触发单行裁剪（20 行 → 总计约 4 万字符 < 20 万，且远小于 2000 行），
      所以若两边的 `CHAT_DIFF_MAX_CHARS` 或 `CHAT_DIFF_MAX_LINES` 发生漂移，parity 测试**不会**发现；
      `DISPLAY_STRING_MAX`、单行上限与数组上限则会因输出不同而被发现。当前两边常量逐项相等（2_000 / 200_000 / 2_000）。
证据：对比 `src/server/pi-session-reader.ts:575-583` 与 `integrations/pi/extensions/herzi-bridge.ts:667-671`（数值一致）；
      把两个实现归一化后 `diff`，除命名/入参形状外算法一致；parity 用例规模见上。
建议方向：parity 再加一组 >2000 行且 >20 万字符的用例，让两个总量常量也被对拍；可选，不阻塞。
```

---

## §4 逐项核查

### 1. F1 失败调用降级 —— 闭合（校验点全过）

- `ToolDetail`（`src/web/components/ChatView.tsx:1442-1451`）第 1450 行 `if (item.isError || !View) return fallback;`：`isError` 为真时**无条件**走 `GenericToolDetail`（1454），不看 `View` 是否命中。
- 两条入口都经过它：`ToolFallback`（1213）在 1250 行渲染 `<ToolDetail>`，`ToolItemRow`（1410，activity 行）在 1430 行渲染同一个 `<ToolDetail>`。`ToolFallback` 在 1232 行按 `isError === undefined ? {} : { isError }` 透传，`toActivityItem`（2116-2124）同样透传，`mergeRealtime`（2263）在实时落地分支用 `liveTool.isError`（bridge 侧 `integrations/pi/extensions/herzi-bridge.ts:483` 恒为 `boolean`）。
- 反向核对（是否仍存在「失败但 `isError` 没传到位」的路）：
  - JSONL 路径：`src/server/pi-session-reader.ts:196` 用 `Boolean(message.isError)`，并在 510 行随 `result` 一起写入；只要 Pi 写了 `isError` 就一定带到位。**推断**：若 Pi 运行时在某个失败结果上漏写 `isError`，仍会渲染结构化视图；本轮无法用真实 session 验证（不授权读 JSONL），也未在 Pi 包中找到会漏写的路径，故仅记录为未验证假设，不作为 finding。
  - `mergeRealtime`：`part.result !== undefined` 时保留 JSONL 的 `isError`（权威），`result` 缺失时用实时值，两条分支都不会把 `true` 变成 `undefined`。
  - `toActivityItem` / `partToolDisplay` 均未改动。
- `isError` 语义未动：折叠行红色状态（1415）、`tool-error` 类（1237/1415）、状态图标（1502）都不在本次 diff 内；本批只改了 `ToolDetail` 一个分支。
- 信息损失反向核对：错误时 `GenericToolDetail` 输出 `Arguments` + `Error`（1461 行按 `isError` 选标签），错误原文可见；新测试 `ChatView.test.tsx:1336` 断言 `section label` 为 `["Arguments","Error"]`、错误文本在 DOM 内且无 `.code-view`。

### 2. F2 投影体积上限 —— 主缺口闭合，残留见 info

- 三个上限（`pi-session-reader.ts:575/581/583`）交互正确：任一触发都置 `truncated: true`；2000 行以内、单行 ≤2000、合计 ≤20 万字符的正常 diff 不被误标（脚本实测 `"+1 a\n-2 b\n 91 ctx\n   ..."` → `truncated:false`）。
- `lines` 永不为空：单行最大 2001 字符 < 20 万预算，首行必入；超限时 `break` 前已把该行计入并标 `truncated`（脚本实测首行 30 万字符 → 1 行 / `truncated:true`）。
- 是否会「丢掉首个改动」：仅当字符预算在首个改动行之前被前面的超长上下文行耗尽，且此时 `truncated:true` + DiffView 的「diff 过长，仅显示前 N 行」提示会显示（**推断**：真实 diff p90 ≈ 4 KB，不可达）。
- `boundedStringArray`（`pi-session-reader.ts:791-798`）改为逐项 `boundedString`：64 × 50 万字符 → 64,257 B，每项带 `…` 标记，`selected` 语义不失真；64 项上界成立。
- bridge 手抄副本已同步：常量逐项相等（`herzi-bridge.ts:667-671`），算法归一化对比一致（只差命名与入参形状），parity 用例新增 2 组；覆盖缺口见 info 第 4 条。
- 遍历 `ChatToolDisplay` 全部字段（脚本枚举实际键路径）：`diff.*` / `truncation.*` / `readRange.*` / `matchCount.*` / `question.{answers,cancelled,globalNote}` / `todo.*`，无未在白名单内的键。可放大 payload 的路径只剩 `question.answers[].selected` 的嵌套相乘，见 info 第 2 条。

### 3. F3 原型链查找 —— 闭合（含授权扩范围）

- `toolViewFor`（`src/web/toolViews/index.ts:45`）改为 `Object.hasOwn(TOOL_VIEWS, toolName)`；`tableLookup`（`toolCatalog.ts:115-117`）守卫 `TOOL_META` / `TOOL_DESCRIBERS`（214-215）；`todoActionLabel`（169）守卫 `TODO_ACTIONS`，`TodoView` 复用它（`TodoView.tsx:19/43-45`）。
- `TODO_ACTIONS` 已收回导出：`grep -rn TODO_ACTIONS src/ integrations/` 只剩定义与 `todoActionLabel` 内部使用，无其他 import。
- 其它普通对象索引扫描：`FRAGMENT_UNITS[fragment]`、`TODO_GROUP_TITLES[status]`、`TODO_COUNT_LABELS[status]`、`DELIVERY_LABELS[state]` 的键都来自内部常量/联合类型，不由 session 数据驱动；`toolText.ts` 无表查找。未发现同类新问题。
- 真实键零行为变化：对 12 个工具名 × 10 组 args 对比 `04ed530` 与 `90d76e9` 的 `describeToolCall`，**0 处差异**；`summarizeToolRun` 输出完全相同；`todoActionLabel("update")` = `TODO_ACTIONS["update"]` = 「更新计划」；对 `constructor`/`toString`/`__proto__`/`valueOf`/`hasOwnProperty` 现在返回 `undefined`（旧实现返回继承成员）。

### 4. F4 ffgrep 边界

- ①：`toolText.ts:170` 只剥离**一个**尾部 `\r`（`endsWith("\r") ? slice(0,-1)`）。实测：CRLF 与混合换行都解析出 1 文件 / 1 匹配 + 1 上下文；纯 LF 结果不变；行中间 `\r` 不被吞（`"12: a\rb"` → 整份 `undefined`，安全回退而非错值）；两个尾部 `\r` 只去一个，剩余一个使解析失败（同样回退）。
- ②：开发者已接受，未重复报告；代码注释（`toolText.ts:151-157`）与测试（`toolText.test.ts`「documents the one file name…」）已把该行为文档化。

### 5. F5 注释与记录一致性 —— 闭合

- 服务端 `projectQuestion` 注释（`pi-session-reader.ts:809-818`）已改为「非对象条目 → 整份放弃；无字段的对象条目 → 跳过」，与实测一致：`[1,2]` → `undefined`；`[{answer:"A"},{unknown:1}]` → `{answers:[{answer:"A"}]}`；`[{unknown:1}]` → `undefined`（不是空列表）。
- bridge 那份**没有**同类注释（原注释只在服务端），其内部注释「Nothing recognised means no answers were projected at all」与新语义一致，无漂移。
- 任务记录第 7 条已同步改写，与实现一致；唯一不符的是同文件「修复后的验证」表的测试数（见 info 第 3 条）。

### 6. F6 web_search 编号与计数 —— 编号已修，新引入 key 冲突

- `<li value={entry.number}>`（`WebSearchView.tsx:41`）保留了原文编号；`partial`（`toolText.ts:283`）为真时文案改为「切分出 N 条结果（其余文字保留在原文中）」。
- `partial` 可能误报：前导区若本就有形如 `1. ` 的正文，`partial` 也会为真（实测 `"Intro:\n1. do this first\n2. **Real**…"` → `partial:true`）。但该文案只是限定「切分出 N 条」并说明其余文字仍在原文中，**不宣称前导区是结果**，且前导区确实由 `MarkdownText` 原样渲染，所以文案与实际渲染一致，不列为 finding。
- `partial` 漏报：实测编号有跳号（`3.`/`4.`）时 `preamble` 为空、`partial:false`，计数 N 正确（不需要限定语）。
- 新增的 `key={entry.number}` 在编号重复时冲突 → 见 low finding。

### 7. 回归面 —— 通过

- 范围：`git diff --name-only 4b549a1..90d76e9` = **24 个文件**，全部落在契约 §3 write set（含 `src/web/toolViews/**`、`styles.css`、ChatView、协议、服务端、bridge、任务记录）内，另加开发者授权的 `src/web/toolCatalog.test.ts` 与第一轮记录 `.agents/tasks/20260917-tool-call-detail-ui-review.md`；无 `docs/**`、无依赖文件、无其它组件。
- 折叠行 / 分组 / `Worked for` 未改：`04ed530..90d76e9` 中 `ChatView.tsx` 只有 `ToolDetail` 一处 hunk；`toolCatalog.ts` 只新增 `tableLookup`/`todoActionLabel` 并收回 `TODO_ACTIONS` 导出；`describeToolCall`/`summarizeToolRun` 对真实键零差异（见 §4.3）。
- 六态降级（未注册工具、缺 display、解析失败、空结果、图片结果、超长结果、**调用失败**）：前六项沿用第一轮结论，代码未动；调用失败新增 `ChatView.test.tsx:1336` 覆盖（`write` + `read` 两个最坏用例）。
- 只读性与外链：`QuestionView` 无 `button`；`toolViews` 内只有复制/展开/收起按钮；`grep dangerouslySetInnerHTML|rehype-raw src/web` 无命中；`MarkdownText`（`common.tsx:48-58`）复用 `markdownShared`，外链仍走既有 `markdownLink.tsx`。
- 样式：`styles.css` 本轮 0 行改动（相对 `04ed530`）；相对 base 为 315 增 / 0 删，`.tool-view pre { max-height: none }` 仍只作用于 `.tool-view` 内，`GenericToolDetail` 的 `.tool-detail pre` 保留 320px 上界。

### 8. 稳定性 —— 未复现（19 次聚焦 + 3 轮全量）

- 聚焦命令运行 12 次 + `--sequence.shuffle` 4 次，全部 `5 files / 189 tests`；加基线 1 次共 13 次。`npm test` 3 次全部 `17 files / 263 tests`。**没有**任何 `1 failed` 或疑似共享状态。
- `views.test.tsx:20-25` 的 `afterEach` 已含 `vi.unstubAllGlobals()` + `cleanup()`（由 `c318d86` 加入），覆盖第一轮判断的最可能泄漏源；新增产品代码仍无模块级可变状态、无随机数、无依赖绝对时间的断言。残留不确定性同第一轮：无法定位那次失败的具体断言。

### 9. 越界核对 —— 通过

见 §7；`90d76e9` 内只有一份 review 记录（本轮记录在本契约文件中，随本 commit 追加）。

---

## 运行过的命令与结果

| # | 命令 | 结果 | 说明 |
| --- | --- | --- | --- |
| 1 | `npm ci` | **PASS** | worktree 无 `node_modules`，按锁文件安装；`git diff -- package.json package-lock.json` 为空 |
| 2 | `npx vitest run src/web/toolViews src/web/toolCatalog.test.ts src/web/components/ChatView.test.tsx src/server/pi-session-reader.test.ts` | **PASS** | 13 次全部 `5 files / 189 tests passed`（含首次基线） |
| 3 | 同 #2 + `--sequence.shuffle` | **PASS** | 4 次全部 189/189 |
| 4 | `npm test` | **PASS** | 3 次全部 `17 files / 263 tests passed` |
| 5 | `npm run typecheck` | **PASS** | `tsc --noEmit` 无输出，exit 0 |
| 6 | `npm run build` | **PASS** | `build:server` + `build:web` 成功；仅既有 chunk >500 kB 提示 |
| 7 | `git diff --name-only 4b549a1..90d76e9`（范围核对） | **PASS** | 24 个文件，全部在 write set + 授权扩范围 + review 记录内 |
| 8 | 只读核查脚本（Node `stripTypeScriptTypes` 执行真实 `projectToolDisplay`/`parsePiDisplayDiff`；`node` 直接 import 真实 `toolText.ts`；`react-dom/client` + jsdom 渲染重复 key；双版本 `toolCatalog` 对拍） | **PASS** | 用于 §4.1-4.6 与四条 finding 的可证伪证据；全部写在 `/tmp`，未写仓库文件 |
| 9 | 与 `04ed530` 的实现双版本对拍（`git show 04ed530:src/web/toolCatalog.ts` → `/tmp`） | **PASS** | `describeToolCall` 0 差异、`summarizeToolRun` 相同 |
| 10 | `npm run dev` | **NOT RUN** | 契约禁止（端口与集成态冲突） |
| 11 | 真实浏览器验收 | **NOT RUN** | 本批不要求也不授权 |
| 12 | 真实 Pane / 真实 session 验收 | **NOT RUN** | 不授权；**未读取任何真实 Pi session / JSONL**，未操作任何业务 Pane |

测试数据全部为合成值；本文件未写入任何真实会话或文件内容。

## 复核了但未列为 finding 的项

- F1 的「Pi 在某些失败结果上可能漏写 `isError`」属无法验证的运行时假设（见 §4.1），不作为 finding。
- `DiffView` 的「diff 过长，仅显示前 N 行」在字符串预算提前截断时 N 会小于 2000，措辞仍准确（确实只显示了前 N 行），未列 finding。
- `value={0}` 被 HTML 忽略的边界已并入 F6-low 的建议，未单列。
- 第一轮已接受或已记录的项（`#4②`、`web_fetch` 大正文一次渲染、bridge 手抄副本的整体维护风险）未重复报告。

## 交接

- 结论：**可合入**；F6-low 请开发者明确接受或安排修复后再集成（项目规则要求 findings 先处置），三条 info 不阻塞。
- 本 worktree 只提交本文件，未 merge / rebase / push，未修改任何产品代码，未改 `main`，未重写第一轮记录。
- 真实浏览器与真实 Pane 验收仍未完成（不授权），如需该层验收应由具备授权的环境执行。
