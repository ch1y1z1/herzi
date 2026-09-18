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

---

# 审查结果（独立 Reviewer，2026-09-18）

审查对象：`4b549a1..04ed530`（3 个 commit：`c06e4c4` / `0cc3bea` / `04ed530`），共 22 个文件、+4349/−29。

## 结论：**需修复后合入**

一条契约/方案明列的完成标准未达成（`docs/tool-call-detail-ui-plan.md` §10 第 2 条要求「缺 details、解析失败、结果被截断、**调用失败**四种情况都有合理降级」，当前视图完全不看 `isError`），另有一条投影体积上限缺口（可选路径可让数十 MB 进入浏览器）。两条都可用很小的改动修掉，且不涉及架构或协议语义变更。

其余重点项（白名单不可绕过、降级链、只读性、外链策略、范围、既有折叠行/分组/`Worked for` 不变）核查通过；Worker 记录的那次 `1 failed | 176 passed` 未复现（详见 §核查 6）。

---

## Findings

```
[严重程度: medium]
位置：src/web/components/ChatView.tsx:1442（ToolDetail，无 isError 分支）
      src/web/toolViews/CodeView.tsx:108-113（write 分支只读 args.content）
      src/web/toolViews/TodoView.tsx:16、src/web/toolViews/QuestionView.tsx:20-23
触发条件：工具调用失败（`item.isError === true`）且该工具命中一个专属视图，且视图所需数据来自 `args`/`display` 而不是 `result`。
影响：失败原因在展开区不可见或语义错误，属「展示与事实不一致」+ 信息丢失：
      - `write` 失败（如权限/路径错误）：CodeView 显示 `args.content`，`result`（错误文本）在整张卡片里没有任何入口；折叠行只剩下一个错误状态图标（ChatView.tsx:1497 的 `isError` 分支，配 `tool-error`）而没有任何错误文本。用户看得到「失败了」，看不到「为什么」。
      - `todo` / `ask_user_question` 失败：TodoView/QuestionView 由 args+display 驱动，错误结果同样丢失。
      - `read` 失败：`toolResultText(item.result)` 拿到的是错误文本，被当成文件内容加行号渲染，顶部标注「读取内容 · 1 行」。
      - `web_fetch` / `web_search` 失败：错误文本被当网页 Markdown/正文渲染，并配「复制正文」「N 字符」。
      - `edit` 失败通常没有 `details.diff`，会走 fallback，基本安全（仅当 Pi 在失败时仍给 diff 才会盖掉错误文本，未验证）。
证据：`grep -n isError src/web/components/ChatView.tsx` 的命中行（105/1218/1232/1237/1246/1329/1415/1424/1456）全部在折叠行/状态图标/ToolResultData 标签处，`ToolDetail`（1442-1447）与 `src/web/toolViews/**` 无任何 isError 判断；`GenericToolDetail`（1449-1462）是唯一会显示 `result` 的地方。错误频次见方案 §4.1（bash 217/5192、edit 27/481、read 8/980、write 2/263）。未做浏览器渲染复现（不可授权），结论为代码依据。
建议方向：在 `ToolDetail` 里 `if (item.isError) return fallback;`（最小改动，直接满足「调用失败 → 既有 Arguments/Error 降级」）；或各视图在 `item.isError` 时把 `fallback` 追加在结构化视图之后，保证错误原文永远可达。
```

```
[严重程度: medium]
位置：src/server/pi-session-reader.ts:575、684-688（diff 只有行数上限）
      src/server/pi-session-reader.ts:766-771（boundedStringArray 不逐项裁剪长度）
      integrations/pi/extensions/herzi-bridge.ts:667、695-698、818-823（手抄副本同样）
触发条件：session JSONL（或实时事件）里 `details` 是病态/被构造的值：① `edit.details.diff` ≤2000 行但单行很长；② `ask_user_question.details.answers[].selected` 是 ≤64 个超长字符串。
影响：投影本意是「体积可控」，实际仍可把数十 MB 的 `display` 下发到浏览器（`display` 是 `result` 之外新增的下行通道，原 `result` 不会有这份体积）。
证据：用真实源码切片（`stripTypeScriptTypes` 后执行 `projectToolDisplay`）实测：
      - 2000 行 × 20 万字符的 `details.diff` → `parsePiDisplayDiff` 返回 2000 行，`JSON.stringify(display)` = 400,080,029 B（行数上限通过，字节无上限）。
      - `answers:[{kind:"multi",selected:[64 × 50 万字符]}]` → 投影结果 = 32,000,248 B（`boundedString` 对 `selected` 未生效；同一用例里 `answer`/`notes` 被裁到 1000+ 字符，投影仅 1071 B，两处行为不一致）。
      - 方案 §8 把「diff 体积」列为风险，缓解措施写的是「服务端投影前做体积上限」；实现只做了行数上限。
建议方向：① 按累计字符/字节上限截断 diff（超限即 `truncated: true`）并对单行文本做上限；② `boundedStringArray` 复用 `boundedString`（逐项裁剪）或整份拒绝；③ bridge 手抄副本同步（parity 测试目前不覆盖体积边界，可加一组）。
```

```
[严重程度: low]
位置：src/web/toolViews/index.ts:38-53（`TOOL_VIEWS[toolName]` 普通对象索引）
      src/web/toolViews/TodoView.tsx:21（`TODO_ACTIONS[change.action] ?? change.action`）
      src/web/toolCatalog.ts:137、522（既有 `TODO_ACTIONS`/`TOOL_DESCRIBERS` 同一写法）
触发条件：`toolName` 为 `constructor` / `__proto__` / `toString` 等 Object.prototype 成员；或 `todo` 的 `action`（可由 `details.action` 投影而来）为同类字符串。toolName 在服务端不校验、原样透传（`src/server/pi-session-reader.ts:505`、`src/server/pi-realtime.ts:172` 只校验是字符串），畸形/被构造的 session 文件即可触发。
影响：`toolViewFor` 返回的不是 `undefined` 而是继承来的成员，于是「未知工具走 fallback」的前提被绕过：
      - `toString` → React 把 `Object.prototype.toString` 当函数组件，展开区渲染成 `[object Undefined]`（静默错值，而不是 Arguments/Result）；
      - `constructor` / `__proto__` → React 直接抛错。`src/web` 中不存在任何 ErrorBoundary（`grep -rnE "ErrorBoundary|componentDidCatch" src/web` 无命中，exit=1），客户端运行时会让整个 ChatView 渲染失败。
      - `TODO_ACTIONS["constructor"]` 返回函数，作为 React child 会报「Functions are not valid as a React child」。
证据：`node` 实测索引语义：`TOOL_VIEWS["constructor"] === Object`、`["__proto__"] === Object.prototype`、`["toString"]` 为函数；再用 `react-dom/server` 渲染最小化组件得到：`toString => "[object Undefined]"`、`constructor => 抛 "Objects are not valid as a React child (found: object with keys {item})"`、`__proto__ => 抛同类错误`。同时用真实 `projectToolDisplay` 确认 `details:{action:"constructor"}` 会被投影成 `{todo:{action:"constructor"}}`（新路径可达）。
说明：同类写法在 toolCatalog 早已存在（既有代码问题），本条只针对本批新增的 `toolViewFor`；影响面是新的（新增了「渲染期抛错」这一后果）。触发需要十分反常的工具名，故定级 low。
建议方向：`Object.hasOwn(TOOL_VIEWS, name)` 守卫，或改用 `Map`/`Object.create(null)`；`TODO_ACTIONS`/`TOOL_DESCRIBERS` 同样处理（可另开一个小任务，不阻塞本批）。
```

```
[严重程度: low]
位置：src/web/toolViews/toolText.ts:144-145、155-176、222-224（parseGrepText / looksLikePath）
触发条件：① ffgrep 结果行带 `\r`（文件本身是 CRLF 时，匹配行内容末尾就带 CRLF；或工具本身输出 CRLF）；② 结果里的文件头行以「数字 + `:`」开头（例如仓库根目录存在 `12:foo.ts` 这样的文件名）。
影响：① 整份结果解析失败 → 整个 ffgrep 展开区退回既有 `Arguments/Result` JSON（是降级，不是错值：`^\d+:(.*)$` 与 `looksLikePath` 都因尾部 `\r` 失败）；② 该头行被当作匹配行，显示成「第 12 行、内容 foo.ts」，文件分组错位（错值）。
证据：用真实 `toolText.ts`（Node 直接 import 该模块）实测：`parseGrepText('src/a.ts\r\n12: hit\r\n13- ctx\r') === undefined`；`parseGrepText('12:foo.ts\n1: hit')` → 一个匿名文件组、2 条匹配（原意是 1 个头行 + 1 条匹配）；`node -e` 确认 `/^(\d+):(.*)$/.test('12: hit\r') === false` 且 `looksLikePath('src/a.ts\r') === false`（`\r` 属 `\s`）。
说明：② 需要极反常的文件名，① 更现实但仍只是退回 JSON，故 low。
建议方向：解析前对每行去掉单个尾部 `\r`（等价于按 CRLF 归一化）；文件头判定改为「不以 `数字:`/`数字-` 开头的行优先当路径」，或先探测文件头集合再匹配。
```

```
[严重程度: info]
位置：src/server/pi-session-reader.ts:783-784（注释）与 806-831（实现），bridge 同源副本
类别：Worker 记录/代码注释不准确（不是产品缺陷）
触发条件：`details.answers` 里混有「是对象但没有任何可识别字段」的条目，例如 `[{answer:"A"},{unknown:1}]`。
影响：注释写「An answer entry whose shape is not recognised makes the whole list unusable」，Worker 决策 #7 也写「条目形状不认识 → 不投影 answers」，但实现只在条目**不是对象**时才整份放弃（`if (!isRecord(entry)) return undefined;`），无法识别的对象条目会被 `continue` 跳过，其余照常投影。实测 `[{answer:"A"},{unknown:1}]` → `answers:[{"answer":"A"}]`。行为本身是安全的（被丢掉的条目不含任何信息），只是注释/记录与代码不一致，容易让后来者据此写出错误假设。
建议方向：把注释与任务记录改成实际语义（「非对象条目 → 整份放弃；无字段的对象条目 → 跳过」），或反过来按注释实现。
```

```
[严重程度: info]
位置：src/web/toolViews/toolText.ts:236-260（parseWebSearchText）、src/web/toolViews/WebSearchView.tsx:30、33-39
触发条件：web_search 结果里只有部分条目匹配 `^\d+\.\s+\*\*`（方案实测命中率 98%）。
影响：不匹配的条目行被归入 preamble（仍会显示，正文不丢），但顶部「N 条结果」会少计；同时 `<li>` 由 `<ol>` 重新从 1 编号，与原文编号可能不一致（例如原文 2 条、只切出第 2 条，界面显示「1 条结果」且该条被标为第 1 条）。
证据：`parseWebSearchText('1. plain\n2. **bold**')` → `{preamble:"1. plain", entries:["**bold**"]}`（preamble 与 entries 都渲染，但计数为 1）。
说明：这是方案 §5.4.3 明示的切分规则（切不出条目才整体 Markdown 渲染），本条只记录「计数/编号可能与原文不一致」，不主张改规则。
建议方向：可选——计数改用「原文中形如 `^\d+\.\s` 的行数」，或对不匹配的条目行不再计入 preamble 而原样编号保留。
```

---

## 七个重点逐项核查

**1. 白名单是否真的白名单 —— 通过（未发现内容绕过）**

- `projectToolDisplay` 只在 `toolName` 命中时逐字段读取，输出的 `display` 是新建对象字面量，没有任何把 `details` 展开/透传的写法；`display` 的键只能是 `diff/truncation/readRange/matchCount/question/todo`（`src/server/pi-session-reader.test.ts` 的「projects an edit diff …」用例亦按 `Object.keys` 断言 display 只有 `diff` 一个键）。用真实源码实测：`details` 带 `patch`/`fullOutputPath`/`unknownField`/`extra` 时只投影 `diff`。
- 特殊键：`JSON.parse`（`src/server/pi-session-reader.ts:121`）不会把 `__proto__` 变成原型（实测 `hasOwnProperty` 为真、原型仍是 `Object.prototype`、`record.diff === undefined`），所以「用 `__proto__` 把非白名单字段塞进投影」在 JSONL 路径上不可行；深层嵌套形状会让 `parsePiDisplayDiff`/`projectTruncation` 判形状失败而整体不投影（实测 `{diff:{deeply:{…}}}` → `undefined`）。
- 超长字段：`boundedString` 1000 字符裁剪 + `…`（实测 5000 字符 action → 投影 1068 B）；`answers` 非数组或 >64 项 → 不投影 answers（实测 `{answers:{0:{…}}}` → `{question:{answers:[],cancelled:true}}`）。**但** `selected` 与 diff 的字节上限不完整，见 Finding 2。
- `result` 语义未变：`toolResultValue`（含 `herzi-tool-result` 图片包装、sha256）整段未出现在本批 diff 中；`GenericToolDetail` 调用 `ToolResultData` 的参数与旧代码逐项等价（`toolName`/`label`/`value`），图片预览路径不变。

**2. 解析器会不会输出错值 —— 基本通过（错误形状都是回退）**

- `parsePiDisplayDiff` all-or-nothing 实测符合注释：`+92 x / -8 y /  91 ctx /    ...` 正确解析（`...` 的多种空格写法都归 `skip`，而 ` 5 ...` 这种带行号的真实内容行不会被误判成 `skip`）；`@@`、缺行号、空串、非字符串一律 `undefined`。
- `parseReadRangeSummary` 只认「Showing lines」一种形状（含 `(50KB limit)`），`[4 more lines in file…]` 明确返回 `undefined`，全部符合契约「不猜」。
- `read` 行号：`readStartLine` 优先 `args.offset`，非法（字符串/0/非整数）时完全不显示行号；无 offset 时用服务端 `readRange.from`，再退回 1——符合契约。
- 服务端解析 range 与前端剥离 marker 的两份正则**当前逐字节相同**（脚本比对取出的两个正则字面量结果 `REGEX LITERALS IDENTICAL`）；第二形状只由前端剥离并原样显示，服务端有意不产出 range。没有自动断言两者同步（Worker 已自述为风险 3），我复核后确认当前无不一致。
- `ffgrep` 边界：文件头分组、`:`/`-`、文件头前的裸匹配、`[N matches…]` note、散文整体放弃都正确（`12:foo.ts` 与 CRLF 两个边界见 Finding 4）。

**3. 实时与历史一致性 —— 结构一致，覆盖有缺口**

- 两份实现当前在 11 组形状上逐一对拍相等（`bridge projection parity`）。我另外核对了语义等价性：两边都是同一套「按工具名分支 + 显式形状校验 + `Object.keys(display).length > 0`」；`toolResultText` 的差异（服务端吃 `message.content`、bridge 吃 `event.result.content`）与两边的输入形状匹配。
- 实时字段不会被服务端剥掉：`src/server/pi-realtime.ts:58-59` 直接把 `event.tool` 整个存入 map，`isRealtimeEvent`（169-179）只校验 `toolCallId`/`toolName` 是字符串，`display` 原样下发；前端 `mergeRealtime`（ChatView.tsx:2243-2260）用 `part.display ?? liveTool.display`，运行中与落地后都能用。
- 未覆盖（与 Worker 自述一致，我确认无法在本批验证）：Pi 运行时 `tool_execution_end` 事件的真实形状（`result.details` 位置）；`toolResultText` 对混合内容数组的真实形状；bridge 手抄副本未来漂移没有自动守卫（只有纯函数 parity 测试）。

**4. 前端安全与只读性 —— 通过**

- `ask_user_question` 视图无任何回答入口（`QuestionView` 不渲染 `button`；`ChatView.test.tsx` 有 `detail.querySelector("button")` 为 null 的断言）；本批只新增「复制」「展开/收起」按钮。
- Markdown/外链没有新开通道：`MarkdownText`（common.tsx:48-58）用 `markdownShared`，与助手正文（ChatView.tsx:1187）同一份；`markdownShared.components.a = MarkdownLink`（默认 `target=_blank` + 固定 `noopener noreferrer`，调用方显式传入的其它 rel token 仍保留）。全仓无 `dangerouslySetInnerHTML`、无 `rehype-raw`（grep 无命中）。
- diff/输出/匹配列表等一律以 React 文本子节点渲染（`{line.text}` 等），不拼 HTML。
- 新增攻击面核对：无新 endpoint、无宿主文件读取（`fullOutputPath` 明确不投影）、无外网请求、无新依赖（`package.json`/`package-lock.json` 无 diff）。

**5. 范围与既有行为不变 —— 通过**

- `git diff --name-only 4b549a1..04ed530` 的 22 个文件全部落在任务契约 §3 的 write set 内；`docs/**`、`src/server/index.ts`、依赖文件、其它组件均未被改动。
- `toolCatalog.ts` 只有两处 `export` 关键字（`TODO_ACTIONS`、`webHost`），无行为差异；折叠行/分组/`Worked for` 未改：ChatView 的改动只在 `.tool-detail` 内部与 `mergeRealtime` 的 display 通道，`ToolRowSummary`、`groupConsecutiveTools`、`ActivityGroup`、`Worked for` 结构均在 diff 外。
- `styles.css` 为纯新增（0 行删除 / 265 行非空新增），且 `.tool-view pre { max-height: none }` 只作用于 `.tool-view` 内，`GenericToolDetail` 的 fallback `<pre>`（可能承载 200KB 原文）仍保留原有的有界滚动。
- `isError` 语义本身未改（只改展示，见 Finding 1）。

**6. 不稳定测试 —— 未复现**

见下「命令与结果」：聚焦命令 34 次（26 次正常顺序 + 8 次 `--sequence.shuffle`）+ 全量 `npm test` 6 次，均 177/177、251/251 通过，未出现任何 failure。可疑共享状态排查：
- `src/web/toolViews/views.test.tsx:80` 的 `vi.stubGlobal("navigator", …)` 会整对象替换 `navigator`，是全批最可能的跨用例泄漏源；Worker 已在 `afterEach` 里加了 `vi.unstubAllGlobals()`（views.test.tsx:20-25），现在不会跨用例存活。
- `ChatView.test.tsx` 里另有既有的 `vi.stubGlobal`（fetch/crypto/...）与 `Date.now()`，均为既有模式、且断言不依赖绝对时间。
- 新增产品代码里没有模块级可变状态：`toolText.ts` 全是纯函数，服务端/bridge 的投影函数也是纯函数；唯一的计时器是 `common.tsx:74` 的 1500ms 文案复位，不影响断言；没有 `Math.random()`。
- vitest 每个 test file 独立环境，跨文件全局泄漏本就不会发生，因此 Worker 那次失败更可能发生在 `views.test.tsx` 文件内部（已被 afterEach 加固覆盖）。结论：**未能复现，也无法定位那次断言**；现有加固覆盖了最可能的原因，残留不确定性记录在此。

**7. 降级路径 —— 六种里五种通过，`调用失败` 未实现**

未注册工具（`views.test.tsx` + `ChatView.test.tsx` 断言即便带 `display` 也走 JSON）、缺 `display`、解析失败、空结果（CodeView 空 `result`、OutputView 无输出文案）、图片结果（`toolResultText` 对 `images` 非空返回 `undefined` → fallback）、超长结果（视图内折叠 + 明确行数，不内部滚动）均通过；**调用失败**未处理（Finding 1）。

---

## 运行过的命令与结果

| # | 命令 | 结果 | 说明 |
| --- | --- | --- | --- |
| 1 | `npm ci` | **PASS** | worktree 内无 `node_modules`，按锁文件安装 EXIT=0；`git status -- package.json package-lock.json` 无 diff |
| 2 | `npx vitest run src/web/toolViews src/web/toolCatalog.test.ts src/web/components/ChatView.test.tsx src/server/pi-session-reader.test.ts` | **PASS** | 26 次运行全部 `5 files / 177 tests passed` |
| 3 | 同 #2 + `--sequence.shuffle` | **PASS** | 8 次全部 177/177 |
| 4 | `npm test` | **PASS** | 6 次全部 `17 files / 251 tests passed` |
| 5 | `npm run typecheck` | **PASS** | `tsc --noEmit` 无输出 |
| 6 | `npm run build` | **PASS** | `build:server` + `build:web` 成功；仅既有 chunk >500 kB 提示 |
| 7 | `git diff --name-only 4b549a1..04ed530`（范围核对） | **PASS** | 22 个文件全部在 write set 内 |
| 8 | 只读核查脚本（Node `stripTypeScriptTypes` 切片执行真实 `projectToolDisplay`/`parsePiDisplayDiff`/`parseReadRangeSummary`；直接 import `toolText.ts`；`node -e` 索引语义；`react-dom/server` 最小渲染） | **PASS** | 用于 Findings 2/3/4/6 与 §核查 1/2 的可证伪证据；未写任何仓库文件 |
| 9 | `npm run dev` | **NOT RUN** | 契约禁止（端口与集成态冲突） |
| 10 | 真实浏览器验收 | **NOT RUN** | 本批不要求也不授权 |
| 11 | 真实 Pane / 真实 session 验收 | **NOT RUN** | 不授权；**也未读取任何真实 Pi session / JSONL** |

测试数据全部为合成值；本文件未写入任何真实会话内容。

## 复核了但未列为 finding 的项（记录以免误判为遗漏）

- `parseGrepText('src/a.ts\n3: needle')` 之类的裸匹配、`fffind` 的路径列表、`>64` 数组拒绝、`answers` 为空时显示「未记录到回答」等，均为方案明示行为或无损降级；其中「`>64` 时投影出 `answers: []` 且视图逐题显示『没有回答』」（`ask_user_question` 实际只有 1–4 题，仅当 Pi 未来给出更多答案条目才可达）措辞上略有断言色彩，暂不单列。
- `TOOL_VIEWS` 之外，`describeToolCall`（toolCatalog.ts:188-189）对 `TOOL_META`/`TOOL_DESCRIBERS` 的同类原型链查找属既有代码，未纳入本批责权。
- `web_fetch` 大正文展开时一次性渲染完整 Markdown（Worker 风险 4）与真实观感未在浏览器核对，均为已记录项，不重复列为 finding。
- 未发现越界修改、未发现新增依赖、未发现服务端外网代理、未发现 `docs/` 被改写。

## 交接

- 结论：**需修复后合入**。建议 Integrator 把 Finding 1 与 Finding 2 退回 Worker（都在 write set 内，改动小），Finding 3/4 可一并处理或另开一批；Finding 5/6 为记录修正，不阻塞。
- 本 worktree 只提交了本文件，未 merge / rebase / push，未改 `main`，未修改任何产品代码。
- 真实浏览器与真实 Pane 验收仍未完成（不授权），合入前如需该层验收应由具备授权的环境执行。

