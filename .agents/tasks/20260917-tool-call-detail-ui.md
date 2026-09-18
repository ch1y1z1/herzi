# 任务契约：工具调用专属展开视图（tool detail views）

- 日期：2026-09-17
- 设计依据：[`docs/tool-call-detail-ui-plan.md`](../../docs/tool-call-detail-ui-plan.md)（**先完整读一遍再动手**）
- Base / branch / worktree：
  - Base（main）：`4b549a1` — `docs: record the tool-call detail UI plan and the four pre-implementation checks`
  - Branch：`agent-20260917-tool-call-detail-ui`
  - Worktree：`/Users/chiyizi/.herdr/worktrees/herzi/agent-20260917-tool-call-detail-ui`
  - Herdr：workspace `w19` / pane `w19:p1`

## 1. 目标

把 Chat 里工具调用的**展开区**从「Arguments / Result 两段裸 JSON」换成按工具类型定制的视图（diff / 代码 / 输出 / 匹配列表 / 结果列表 / 网页摘要 / 任务变更 / 问答）。

**折叠行、分组规则、`Worked for` 层级结构一律不变。** 本任务只改展开区。

## 2. 范围（按顺序推进，每完成一段自测）

### P0：协议 + 服务端投影 + `edit` diff 视图

1. `src/shared/protocol.ts`：新增受限结构（名字可调整，语义不得扩大）：

```ts
export interface ChatDiffLine {
  kind: "add" | "remove" | "context" | "skip";
  lineNumber?: number;   // add/context 用新文件行号，remove 用旧文件行号，skip 无
  text: string;
}

export interface ChatToolDisplay {
  diff?: { lines: ChatDiffLine[]; firstChangedLine?: number; truncated?: boolean };
  truncation?: { truncated: boolean; by?: "lines" | "bytes"; outputLines?: number; totalLines?: number };
  readRange?: { from: number; to: number; total?: number; nextOffset?: number };
  matchCount?: { matched: number; files: number; hasMore?: boolean };
}
```

   tool-call part 增加可选 `display?: ChatToolDisplay`。**`result` 字段语义不变**（仍是原文）。

2. `src/server/pi-session-reader.ts`：投影 `display`（白名单，**不透传整个 `details`**）：
   - `edit` → 解析 `details.diff`（Pi 展示格式，见 §4.1）；
   - `bash` / `read` → `details.truncation`（若存在）；
   - `read` → 解析结果尾部 `[Showing lines A-B of N. Use offset=K to continue.]` 得到 `readRange`；
   - `ffgrep` / `fffind` → `details.totalMatched` / `totalFiles` / `hasMore` 得到 `matchCount`。
3. `integrations/pi/extensions/herzi-bridge.ts`：实时路径产出**同一结构**（否则运行中与完成后显示不一致）。
4. 新增 `src/web/toolViews/`：注册表 + `DiffView`（`edit`）；`toolText.ts` 放纯函数解析器（无 React、无 I/O、可单测）。
5. `ChatView.tsx`：`ToolFallback` 与 `ToolItemRow` 的展开区改为 `toolViewFor(toolName)`；未注册或解析失败 → 现有 `ToolData`/`ToolResultData`。

### P1：`read` 代码视图 + `bash` 输出视图

- `read`：行号（起点 = `args.offset ?? 1`）+ 等宽 + 长文件折叠（默认 200 行）+ 尾部状态行（`已显示 A–B / 共 N 行 · 继续读取 offset=K`）。**注意：实测结果文本不带行号前缀，行号必须由前端按 offset 生成；算不出起点就不要显示行号。**
- `bash`：完整命令（多行）+ 输出（**默认显示尾部 20 行**）+ 截断提示。**不要显示退出码**（实测 0% 文本含 `exit code`，没有就说没有）。

### P2：`ffgrep`/`fffind` 匹配列表 + `web_search` 结果列表 + `web_fetch` 网页摘要

- `ffgrep`：按文件分组（文件路径头 + 命中数），匹配行高亮、上下文行淡化，顶部 `N 处命中 · M 个文件`。解析规则见 §4.1。
- `fffind`：文件路径列表（等宽、可复制）；`hasMore` 时显示「还有更多（第 N 页）」。
- `web_search`：按 `^\d+\.\s+\*\*` 切分为结果条目（标题 + 来源行），顶部 `N 条结果`；切不出条目 → Markdown 渲染原文。
- `web_fetch`：标题（首行 `# `，64% 命中）+ 域名 + 字符数 + Markdown 正文（默认折叠到 40 行 + 展开）；含截断提示时显式标注。

### P2.5：`todo` 变更卡片 + `ask_user_question` 问答卡片

- `todo`：**只显示这一次调用改了什么**（`details.action` / `params` / 受影响任务），**不要**重复 composer 上方那条全量状态条。
- `ask_user_question`：问题 + 选项 + 用户回答 + 是否取消（`details.answers` / `cancelled`）。**只读展示，不做回答入口。**

### 明确不在本批（不要实现）

- **P3 / `bash`「查看完整输出」按钮与任何宿主文件读取**：新增服务端攻击面，单独一批 + 独立安全评审。
- 服务端外网代理、`isError` 语义调整、Moshi 式 host git diff viewer。

## 3. Write set（允许修改）

- `src/shared/protocol.ts`（+ 测试）
- `src/server/pi-session-reader.ts`（+ 测试）
- `integrations/pi/extensions/herzi-bridge.ts`（+ 测试，若有）
- `src/web/toolViews/**`（新目录，含测试）
- `src/web/toolCatalog.ts`（只在需要复用/补充字段时，**不得改变现有折叠行语义**）
- `src/web/components/ChatView.tsx`（+ 测试）
- `src/web/styles.css`
- `.agents/tasks/20260917-tool-call-detail-ui.md`（本文件，追加过程记录）

越界即停工：其他文件一律不动；若认为必须改，先向开发者提问。

## 4. Integrator 已完成的核对结论（**直接采用，不要重新调研，也不要读真实 session**）

1. **`edit.details.diff` 是 Pi 展示格式**（`dist/core/tools/edit-diff.js:272` 的 `generateDiffString`）：每行首字符 `+` / `-` / 空格，后接**右对齐行号**与空格，再是内容；上下文只保留 4 行；被跳过的上下文输出为**空白行号 + `...`**；**没有 `@@` hunk 头**。
   - 实测：460 份样本中 `@@` 出现 0 次；`+` 9928 行、`-` 1783 行、上下文 9367 行；长度 p50 1377 / p90 4192 / max 34503 字符。
   - `details.firstChangedLine` 同时存在，直接用。
   - `details.patch` 是**标准 unified diff**（903 个 `@@`），仅作为回退来源。
2. **`ffgrep` 结果格式**：文件路径头行 + `行号: 内容`（匹配行）+ `行号- 内容`（上下文行）。已由 9 次「未传 `context` 的结果 0 个 `-` 行、9 个全有 `:` 行」证实。
3. **`read` 结果**：文件原文（无行号前缀，实测命中率 1%），截断/续读信息在**尾部** `[Showing lines A-B of N. Use offset=K to continue.]`（命中率 3%）；`details.truncation` 只有 15/980。
4. **`bash`**：无退出码信息（0%）；`details.truncation` 仅 31/5192；文本 p50 717 字符、p90 5412。
5. **`write.details` 实测为空对象**，只能从 `args.content` 推导（新建内容视图，不要假装是 diff）。
6. **`web_search`** 98% 首行匹配 `N. **标题**`；**`web_fetch`** 64% 首行是 `# 标题`，p90 21KB、max 229KB；**`todo`** `details.action/params/tasks` 100% 可用；**`ask_user_question`** `details.answers/cancelled` 100% 可用。

## 5. 硬约束

- **不得虚报**：每条展示都必须能指回 `args` / `result` / `details`；解析不出就不显示该项，退回原文，不猜、不近似。
- **降级是常态**：`read`/`bash` 的 `details` 可用率只有 1.5%/0.6%，`write` 为 0。每个视图都必须有「纯文本也正常」的形态。
- **未知工具永远可渲染**：注册表未收录 → 现有 `ToolData`/`ToolResultData`。
- **不复制第三方代码/文案/样式**：Memoh 是 AGPL-3.0（只借鉴设计）；Pi 是 MIT（可参考行为，本任务按自己的实现写）。
- **不新增 production dependency**。
- **不做破坏性 Git**：不 merge / rebase / push；不改 `main`。
- **不运行 `npm run dev`**（端口与集成态冲突）。
- **不操作真实 Pi/Herdr 业务 Pane**。
- 遇到需求歧义、范围扩大或协议语义变化 → **停下来直接向开发者提问**，不要自行决定。

## 6. 验证要求（全部必须实测并记录）

```bash
npm ci                     # 仅在缺依赖时；不得修改依赖版本
npx vitest run src/web/toolViews src/web/toolCatalog.test.ts src/web/components/ChatView.test.tsx src/server/pi-session-reader.test.ts
npm run typecheck
npm test
npm run build
```

- 测试必须覆盖：每个解析器的**正常输入 + 形状不匹配输入 + 空输入**；`edit` diff 的 `+`/`-`/上下文/`...`/行号对齐；`ffgrep` 的匹配行/上下文行/文件头分组；`read` 尾部摘要的多种写法（含解析失败）；未知工具的注册表回退。
- 结果标记 `PASS` / `FAIL` / `NOT RUN`，写明实际命令。
- **不得**声称完成了真实浏览器或真实 Pane 验收（本批不要求也不授权）。

## 7. 记录要求

在本文件追加「过程与决策」「验证与交接」两节：做了什么、遇到的歧义与如何（向谁）解决、每个命令的 PASS/FAIL、剩余风险与未验证项。完成后保持 worktree clean，提交 1–3 个清晰 commit，留在 Pane 等开发者通知 Integrator。

---

# 过程与决策（Worker，2026-09-18）

状态：P0 → P1 → P2 → P2.5 全部实现；折叠行、分组规则、`Worked for` 层级未改动，只替换展开区。
交付分支 `agent-20260917-tool-call-detail-ui`，commits：

- `c06e4c4` feat(chat): project whitelisted tool display metadata（协议 + 服务端投影 + bridge + 测试）
- `0cc3bea` feat(chat): render per-tool detail views in the expansion area（`src/web/toolViews/**` + ChatView 接线 + 样式 + 测试）

## 做了什么

- **协议（`src/shared/protocol.ts`）**：新增 `ChatDiffLine` / `ChatToolDisplay`；tool-call part 与 `ChatRealtimeTool` 各加可选 `display`。`result` 语义不变（仍是原文，任何降级都回到它）。
- **服务端（`src/server/pi-session-reader.ts`）**：新增 `projectToolDisplay(toolName, details, resultText)`，逐字段形状校验的白名单投影：
  - `edit` ← `details.diff`（Pi 展示格式，整份解析或整体放弃）+ `firstChangedLine`；
  - `read`/`bash` ← `details.truncation`（`truncated`/`truncatedBy`/`outputLines`/`totalLines`）；
  - `read` ← 结果尾部 `[Showing lines A-B of N. Use offset=K to continue.]`；
  - `ffgrep`/`fffind` ← `totalMatched`/`totalFiles`/`hasMore`。
  未投影：`details.patch`、`fullOutputPath`、以及任何未列出的键（有测试断言 display 的键只有白名单键）。
- **实时路径（`integrations/pi/extensions/herzi-bridge.ts`）**：`tool_execution_end` 产出同一结构。
- **前端（新增 `src/web/toolViews/`）**：注册表 `toolViewFor` + 8 个视图覆盖 10 个工具（`read`/`write` 共用 `CodeView`，`ffgrep`/`fffind` 共用 `MatchListView`）：`DiffView`、`CodeView`、`OutputView`、`MatchListView`、`WebSearchView`、`WebFetchView`、`TodoView`、`QuestionView`；`toolText.ts` 放纯解析器（无 React、无 I/O）。未注册或解析失败 → 既有 `ToolData`/`ToolResultData`（作为 `fallback` prop 传入，避免 `ChatView` 循环 import）。
- **样式（`src/web/styles.css`）**：只新增 `.tool-view*` / diff / code / match / question 等类，沿用现有配色变量；展开区里视图内的 `<pre>` 覆盖为不内部滚动（长内容由视图折叠并写明行数）。
- 复用而非复制：`toolCatalog.ts` 仅导出 `webHost`（`web_fetch`）与 `TODO_ACTIONS`（`todo` 动作词），折叠行语义未改。

## 决策与有意偏离（可核对）

1. **`write` 单独一档实现**：契约 §2 的 P0/P1 条目只点名了 `edit`、`read`、`bash`，但方案 §5.4.1 第一层必做含 `edit`+`write`、§1 的「代码」类别也含它 → 用 `CodeView` 显示 `args.content`（行号 + 折叠），**不**伪装成 diff（`details` 实测为空对象）。
2. **`skip` 行不显示「N 行未改动」**：Pi 的展示 diff 只写 `...`，没有计数；由行号差推导只在「跳过区两侧都是上下文行」时成立，靠近变更块时新/旧文件行号计数不一致 → 只渲染 `⋯ 略过的上下文`，不猜数字。
3. **`bash` 不显示耗时**（方案里的 `Took 3.4s`）：`args`/`result`/`details` 都没有时间来源，故不显示。退出码同样不显示（契约 §4：0% 命中）。
4. **`fffind` 不显示页号**：只显示「还有更多结果未显示」。开发者 2026-09-18 明确选择不加 `matchCount.pageIndex`。
5. **`question` / `todo` 两个白名单字段是开发者批准的协议新增**（见下「歧义」）：`question` ← `details.answers` / `cancelled` / `globalNote`（answer 条目投影 `questionIndex`/`question`/`kind`/`answer`/`selected`/`notes`，不投影 `preview`/`error`）；`todo` ← `details.action` + `details.params` 的原始字段（`id`/`subject`/`status`/`activeForm`/`description`/`blockedBy`）。**不投影 `details.tasks`**，避免与 composer 上方状态条重复。
6. **`ask_user_question` 的 `options[].preview` 不渲染**（契约 §2 P2.5 只要求「问题 + 选项 + 用户回答 + 是否取消」）；只渲染 `label` 与 `description`。视图**只读**，无任何回答入口（有测试断言详情区没有 button）。
7. **体积上限**：`details` 里的字符串截断到 1000 字符并追加 `…`；数组超过 64 项整体拒绝（不是截断）；`answers` 不是数组或条目形状不认识 → 不投影 answers（`cancelled`/`globalNote` 仍独立投影）；project 出的 answers 为空 → 视为「没有投影」而不是「用户没回答」。diff 投影上限 2000 行，超出则截断并标 `truncated: true`。
8. **`matchCount` 需要两个计数同时是整数**，否则不显示计数（前端退化为按解析出的行数计）。
9. **`web_fetch` 截断提示出现两次**（meta 行 + 仍在正文里）：不改写原文，正文就是原始 Markdown。
10. **`read` 行号**：起点 = `args.offset`（正整数）→ `readRange.from` → 1；`offset` 存在但不是正整数 → 完全不显示行号（不猜）。尾部 marker 由前端按 Pi 的两种已知形状剥离（服务端也用同一形状解析 range，两份正则必须同步，见「风险」）。
11. **`bash` 输出默认尾部 20 行、`read` 默认 200 行、`web_fetch` 默认 40 行**，折叠都在视图内完成并写明「还有 N 行未显示」，不引入内部滚动条。

## 格式来源（未读取真实 session）

为确认解析目标，读了契约 §4 所引用的同一个已安装 Pi 包内的源码文件：`dist/core/tools/edit-diff.js` 的 `generateDiffString`（展示 diff 的行首标记、右对齐行号、`...` 跳过行）、`read.js` 的两条尾部摘要与 `[N more lines in file...]`、`truncate.d.ts` 的 `TruncationResult` 字段名。**没有**读取任何真实 session/JSONL，**没有**把任何真实文件内容写进代码、测试或文档（测试数据全部为合成值）。

## 歧义与升级

- 唯一停下来问开发者的点：P2.5 需要的数据（`ask_user_question` 的 `details.answers`/`cancelled`、`todo` 的 `details.action`/`params`）不在契约 §2 P0 给出的 `ChatToolDisplay` 草图里，补给它们属于协议字段新增。**开发者答复（2026-09-18）：允许新增 `question` + `todo` 两个白名单字段；不加 `pageIndex`。** 已按此实现，字段仍逐个形状校验，不是 `details` 透传。
- `ask_user_question` / `todo` 的参数与 `details` 形状取自仓库内既有文档 `docs/chat-compaction-todo-askuser-plan.md` §3.1/§4.1（上一批核对过的事实），未重新调研、未读 session。

## 安全边界

- P3 明确未实现：没有「查看完整输出」按钮、没有宿主文件读取、没有新增服务端 endpoint；`bash.details.fullOutputPath` 明确不投影。
- 未新增依赖（`git diff -- package.json package-lock.json` 为空）、无外网代理、未改 `isError` 语义、未改事件校验逻辑（`display` 走同一条 JSON 通道，前端逐字段防御性读取）。

---

# 验证与交接（Worker，2026-09-18）

## 命令与结果

| # | 命令 | 结果 | 说明 |
| --- | --- | --- | --- |
| 1 | `npm ci` | **PASS** | worktree 内无 `node_modules`，按锁文件安装，EXIT=0；`package.json`/`package-lock.json` 无 diff，依赖版本未变 |
| 2 | `npx vitest run src/web/toolViews src/web/toolCatalog.test.ts src/web/components/ChatView.test.tsx src/server/pi-session-reader.test.ts` | **PASS** | 5 files / 177 tests 全通过；连续 32 次运行均通过（另见「不稳定项」） |
| 3 | `npm run typecheck` | **PASS** | `tsc --noEmit` 无输出 |
| 4 | `npm test` | **PASS** | 17 files / 251 tests 全通过；连续 8 次运行均通过 |
| 5 | `npm run build` | **PASS** | `build:server` + `build:web` 成功；仅有既有的 chunk >500 kB 提示（与本批无关） |
| 6 | 真实浏览器验收 | **NOT RUN** | 本批不要求也不授权 |
| 7 | 真实 Pane / session 验收 | **NOT RUN** | 契约禁止读取真实 session；未操作任何业务 Pane |
| 8 | `npm run dev` | **NOT RUN** | 契约禁止（端口与集成态冲突） |

## §6 测试覆盖逐条核对

- **每个解析器「正常输入 / 形状不匹配 / 空输入」**：`toolText.test.ts` 覆盖 `toolResultText`、`resultLines`/`tailLines`、`splitReadResult`、`readStartLine`、`parseGrepText`、`parsePathList`、`parseWebSearchText`、`parseWebFetchText`、`detectTruncationNote`、`truncationSummary`、`parseAskedQuestions`、`todoChange`、`todoStatusLabel`；`pi-session-reader.test.ts` 覆盖 `parsePiDisplayDiff`、`parseReadRangeSummary`、`projectToolDisplay`。
- **`edit` diff 的 `+`/`-`/上下文/`...`/行号对齐**：`parsePiDisplayDiff` 单测（含空内容行与末尾换行、`@@` 与缺行号形状整体放弃）+ `views.test.tsx` + `ChatView.test.tsx`（真实 part → 渲染 `+`/`-`/skip 与行号）。
- **`ffgrep` 匹配行 / 上下文行 / 文件头分组**：`toolText.test.ts`（分组、`:` vs `-`、文件头前的裸匹配、摘要行 note、散文整体放弃）+ `views.test.tsx`（`.match-file-path` / `.match-line-hit` / `.match-line-context`）+ `ChatView.test.tsx`。
- **`read` 尾部摘要多种写法（含解析失败）**：服务端两种 Range 形状（含 `(50KB limit)`）+ `[N more lines in file...]`（不给 range）+ 失败形状；前端剥离两种 marker 与「末行不是已知 marker 时原文不动」。
- **未知工具注册表回退**：`views.test.tsx` 的 `toolViewFor`（含空串、MCP 名）+ `ChatView.test.tsx`（未知工具即便带 `display` 也走 Arguments/Result JSON 回退）。
- 额外补齐：`edit`/`read`/`bash`/`ffgrep`/`fffind`/`web_search`/`web_fetch`/`todo`/`ask_user_question` 的**降级路径**（无 `display`、空结果、图片结果、`offset` 非法）与 **bridge 投影 parity**（11 组形状与服务端逐一对拍相等）。

## 不稳定项（如实记录，未解决）

首次把上述 4 个测试文件一起运行时出现过 **1 个失败**（`Tests 1 failed | 176 passed`）。该次完整输出**未保存**，因此**没有定位到具体断言**。随后同一命令连续 32 次、`npm test` 连续 8 次全部通过，**未能复现**。
已做的加固：`views.test.tsx` 改为在 `afterEach` 中统一 `vi.unstubAllGlobals()`（原先在复制测试末尾内联 unstub，一旦断言失败会把 stub 的 `navigator` 泄漏给后续测试）。
**不能排除**仍存在时序类不稳定 → 提请 Reviewer 留意（建议在合并态多跑几轮 §6 的 vitest 命令）。

## 剩余风险与未验证项

1. `details` 的格式结论来自契约 §4 与 Pi 源码，**未经真实 session 端到端验证**（契约禁止）。若 Pi 改变展示 diff 或尾部摘要格式，解析器会整体放弃并回退原文（有测试），不会显示错值。
2. bridge 里的投影是**手抄副本**（扩展是独立安装包，不能 import 仓库代码）。parity 测试覆盖 11 组形状的纯函数行为，但**未覆盖 Pi 运行时事件真实形状**（无 Pi 环境可跑）。
3. `read` marker 的「服务端解析 range / 前端剥离 marker」是两份正则，靠注释互指与测试各自覆盖；**没有自动断言两者同步**。
4. `web_fetch` 大正文（p90 21 KB / max 229 KB）在「展开全部」时一次渲染完整 Markdown，未做虚拟化；本批不引入新依赖，若真实使用卡顿再评估。
5. 未做：P3（宿主文件读取 / 「查看完整输出」）、服务端外网代理、`isError` 语义调整、Moshi 式 host git diff viewer。
6. 真实观感（字号、行高、深浅底色在现有主题下的可读性）**未在浏览器里看过**，只做了结构与类名断言。

## 交接

- 分支 `agent-20260917-tool-call-detail-ui`，2 个 commit（见上），worktree clean，未 merge / rebase / push。
- 建议 Review 重点：`ChatToolDisplay` 字段白名单是否有越界语义；`parsePiDisplayDiff` 的 all-or-nothing 策略是否过严；`read` 行号与 marker 剥离的一致性；bridge 手抄副本的维护风险；`question`/`todo` 投影是否漏字段。
- 留在 Pane 等开发者通知 Integrator，不自行合入 `main`。
