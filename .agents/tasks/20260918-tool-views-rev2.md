# 任务契约：工具调用展示 Rev.2（固定高度滚动 + shiki 高亮 + Chat 正文代码块）

- 日期：2026-09-18
- 设计依据：[`docs/tool-call-detail-ui-plan.md`](../../docs/tool-call-detail-ui-plan.md) §11（Rev.2，**含 Memoh 一手核对结论，先读**）+ §5.4（原视图规格）
- Base / branch / worktree：
  - Base（main）：`b5b49a7` — `docs: add the Rev.2 presentation revision (fixed-height scroll, shiki, Memoh visuals)`
  - Branch：`agent-20260918-tool-views-rev2`
  - Worktree：`/Users/chiyizi/.herdr/worktrees/herzi/agent-20260918-tool-views-rev2`
  - Herdr：workspace `w1C` / pane `w1C:p1`

## 1. 目标

开发者认为现有工具详情展示「非常不好，而且不美观」：默认折叠 200 行、点「展开全部」后一次性渲染几千行，两个极端都不好，而且代码没有语法高亮。本批把展示形态改成：**固定 16 行高的滚动窗口（原生滚动，不做虚拟化）+ shiki 按需高亮 + 一批 Memoh 视觉细节**，并把 Chat 正文的 fenced code block 一并接入同一个高亮内核。

## 2. 已确认决策（2026-09-18，开发者逐项确认）

| 编号 | 决策 | 结果 |
| --- | --- | --- |
| R1 | 内容区高度 | **16 行**可视，超出靠滚动 |
| R2 | 虚拟滚动 | **不做**。学 Memoh：仅限高 + 原生滚动条（DOM 里仍是全部行） |
| R3 | 「展开全部 / 收起」按钮 | **全部去掉**（工具详情 + Markdown 类视图） |
| R4 | 代码高亮 | **shiki 按需加载**；开发者已批准新增 production dependency（仅 `shiki`） |
| R5 | 视觉采纳（来自 Memoh） | ① diff 整行背景带 + 左边缘实心指示条；② 行号 gutter 列；③ 命令 `$` 前缀 + 错误红色 |
| R6 | Markdown 类（`web_fetch` 正文 / `web_search` 结果） | 同一个 16 行窗口 + 原生滚动，去掉展开按钮 |
| R7 | Chat 正文 fenced code block | **一并接入同一个 shiki 高亮内核**（现在正文代码块是纯文本） |
| R8 | 字号与容器皮肤 | **不改**（保留现有字号与配色；R5 只改那三项） |

## 3. Write set（允许修改）

- `package.json`、`package-lock.json`（**仅**新增 `shiki`，不得升级/新增其它依赖）
- `src/web/toolViews/**`（含测试；可新增高亮模块与共享滚动容器）
- `src/web/styles.css`
- `src/web/components/ChatView.tsx`（仅 fenced code block 渲染接入；不得改动折叠行、分组、`Worked for`、投递状态、todo 条等其它逻辑）
- `src/web/markdownPlugins.ts`（若 code renderer 需要从这里传）
- `src/web/**` 中新增的高亮模块与测试
- `.agents/tasks/20260918-tool-views-rev2.md`（本文件，追加过程记录）

**不得改动**：`src/server/**`、`src/shared/**`、`integrations/**`（本轮是纯前端；协议与投影不变）。若认为必须改，先停下来问开发者。

## 4. 实现要求

### 4.1 共享滚动容器（R1/R2/R3/R6）

- 在 `src/web/toolViews/` 内新增一个共享组件（命名自定，例如 `ScrollBox`），所有内容型视图（`CodeView`、`DiffView`、`OutputView`、`WebFetchView`、`WebSearchView`、`MatchListView`）都使用它。
- 高度 = **恰好 16 行**：容器高度与行高**引用同一个 CSS 变量**（例如 `--tool-view-line-height`），避免出现 15 或 17 行。行高沿用现有主题（当前 `.tool-detail` 为 10.5px / 1.55），**不要改字号**（R8）。
- `overflow-y: auto`；滚动条样式保持可用与可见（不要隐藏滚动条）。
- **删除所有「还有 N 行未显示 · 展开全部」「收起」按钮**及其 `expanded` 状态；行数信息改用中性文案（如「共 65 行 · 可滚动查看」）。
- 容器内不嵌套第二层滚动容器。

### 4.2 shiki 高亮（R4）

- 依赖：`npm install shiki`（写进 `package.json` 的 `dependencies`）。
- 接入方式：`shiki/core` + `createHighlighterCore` + **JS 引擎**（`createJavaScriptRegexEngine`，避免引入 wasm 静态资源与额外构建配置）+ 按需 `import()` 语言与主题。
- 新增模块（例如 `src/web/highlight.ts`）：至少导出
  - `languageForPath(path: string): string`（按扩展名；未知 → `text`）
  - `languageForFence(info: string): string`（按 ```lang 的 info，未知 → `text`）
  - 一个把代码转成**逐行结构**的异步函数，每行含 shiki token 渲染结果（HTML 或 token 数组），供 `CodeView` / `DiffView` 按行渲染（R5 的 gutter 与背景带需要行级结构）。
- **降级**：高亮未就绪、语言不支持、加载失败 → 渲染纯文本行，且**行高与字号保持一致**（不得出现加载前后的跳动或 spinner）。
- 语言覆盖按体积控制：`ts`、`tsx`、`js`、`jsx`、`json`、`md`、`py`、`sh`、`bash`、`css`、`html`、`yaml`、`go`、`rs`，其余走 `text`。
- 主题：与现有 Chat fenced code block 的深色配色协调（自行核对 `styles.css` 中现有 fenced code 样式后选择最接近的 shiki 内置主题），并在记录里写明选用的主题名。
- 缓存：高亮结果按 `(code, lang, theme)` 记忆化，并设上限（例如 LRU 64 条），避免长会话内存膨胀。

### 4.3 视觉细节（R5）

1. **diff 行背景带 + 左指示条**：新增行浅绿底、删除行浅红底，删除/新增行左侧 3px 实心指示条；上下文行无底色。行号 gutter（旧文件行号用于 remove，新文件行号用于 add/context）。
2. **行号 gutter 列**：固定宽度、右对齐、`user-select: none`（复制内容时不带行号）；`CodeView` 与 `DiffView` 都用。
3. **命令 `$` 前缀 + 错误红色**：`OutputView` 的命令行显示 `$ <command>`（`$` 用 muted 色）；stderr / 错误结果用红色，不再与普通输出同色。
4. **Markdown 类视图**（`web_fetch` 正文、`web_search` 结果）也用 4.1 的滚动容器；正文仍是 Markdown 渲染，不虚拟化、不改字号。

### 4.4 Chat 正文代码块（R7）

- 让 Chat 正文的 ``` fenced code block 走同一高亮内核（语言取自 fence info；未知 → 纯文本）。
- 行内 code、LaTeX、表格、链接策略、`Worked for` 分组、投递状态、todo 条**均不得改变**。
- 若实现需要自定义 markdown components，放在与现有 markdown 配置一致的位置，不要复制第二套插件配置。

## 5. 明确不做

- 虚拟滚动 / 窗口化渲染（R2）。
- 字号、字体、整体配色体系的调整（R8）。
- 服务端投影、协议字段、`result` 语义（本轮零服务端改动）。
- P3（`bash` 完整输出 / 宿主文件读取）。
- 真实浏览器与真实 Pane 验收（未授权）。

## 6. 硬约束

- **不虚报**：行数、语言、是否高亮都必须来自真实数据；推断不出就用 `text`/纯文本。
- **降级优先**：任何解析或加载失败都必须回到纯文本，而不是空白或错色。
- **现有行为不变**：折叠行文案、分组规则、`Worked for`、投递状态、todo 条、图片预览、LaTeX 渲染。
- **不复制第三方代码/文案/样式**：Memoh 是 AGPL-3.0（只借鉴设计）；shiki 为 MIT（正常依赖使用）。
- **不做破坏性 Git**（不 merge / rebase / push）、不改 `main`。
- **不运行 `npm run dev`**（端口与集成态冲突）。
- **不操作真实 Pi/Herdr 业务 Pane**。
- 遇到歧义、范围扩大、依赖变更或协议语义变化 → **停下来直接问开发者**。

## 7. 验证要求（全部实测并记录）

```bash
npm install shiki            # 仅此一个新增依赖
npx vitest run src/web/toolViews src/web/components/ChatView.test.tsx
npm run typecheck
npm test
npm run build
```

- 测试必须覆盖：语言推断（路径与 fence info、未知 → `text`）、逐行结构转换、高亮未就绪时的纯文本降级、16 行容器与行高使用同一变量、展开按钮已被移除（断言不存在该类按钮）、diff 行 kind → 背景/指示条类名映射、命令 `$` 前缀、错误红色。
- `npm run build` 需记录**变更前后主 chunk 体积对比**（`dist/web/assets/index-*.js` 与 `ChatView-*.js`），写进任务记录。
- 结果标记 `PASS` / `FAIL` / `NOT RUN`，写明实际命令。
- **不得**声称完成真实浏览器或真实 Pane 验收。

## 8. 记录要求

在本文件追加「过程与决策」「验证与交接」两节：包括 shiki 版本与主题名、bundle 体积前后对比、任何偏离与理由、剩余风险与未验证项。完成后保持 worktree clean，提交 1–3 个清晰 commit，留在 Pane 等开发者通知 Integrator。

## 9. 过程与决策

### 9.1 依赖与主题（R4）

- 新增依赖：`shiki@4.4.3`（`^4.4.3`）——`package.json` / `package-lock.json` 全场唯一变化，无其它新增/升级；核对方式：`git diff package.json`（只多一行）与 `git diff --stat package-lock.json`（+194 行）。
- 接入方式：`shiki/core` 的 `createHighlighterCore` + `shiki/engine/javascript` 的 `createJavaScriptRegexEngine({ forgiving: true })`，无 wasm 静态资源、无额外构建配置。
- **主题用了两个**（契约要求记录主题名）：
  - 工具详情视图（浅色面板 `#f1f2ed`）：**`github-light`**。
  - Chat 正文 fenced code block（深色 `#20231f`）：**`github-dark-default`**，其默认前景 `#e6edf3` 与现有 `#e7e8e2` 最接近。
  - 为什么不是一个：R8 明确不改容器皮肤/配色体系，工具视图在浅色面板上不能铺深色代码底；契约 §4.2 的缓存键本来就写作 `(code, lang, theme)`，说明主题是按面（surface）取的。两个主题同属 GitHub 家族，观感协调。
  - 主题自带的背景色一律**不使用**：浅色面板与 `#20231f` 代码底保持现状。
- **字体色规则**：token 颜色等于主题前景色时丢弃该颜色，让文字继承现有样式（视图 `#5e635a`，Chat 代码块 `#e7e8e2`），即“只叠加语法强调色”。这是 R8（不改字号与正文配色）在实现层最直接的做法，也让 diff 新增/删除行的绿/红文字色在未着色 token 上保留。
- 语言覆盖为契约列出的 13 个 shiki 语言（ts/tsx/js/jsx/json/md/py/sh+bash/css/html/yaml/go/rs，`sh` 与 `bash` 同为 `shellscript`），其余一律 `text`；`languageForPath` / `languageForFence` / `highlightLines` 的实现要求逐条落地，另外处理了两个真实边界：`.env` 这类点文件不算扩展名；fence info 的 `tsx{1,3}`、`ts title=...` 只取语言部分。
- 查找用 `Object.hasOwn`（与 `toolCatalog` 一致），```` ```constructor ```` 之类的 fence 不会命中原型链。

### 9.2 高亮内核（新增 `src/web/highlight.ts` + `src/web/highlightReact.tsx`）

- 逐行结构：`highlightLines(lines, lang, theme)` 接收**调用方自己的行数组**（不重新切行），返回同样长度的 token 行；调用方按行渲染，因此高亮前后行数、行高、滚动位置都一致，不需要 spinner，也不会跳动。
- 降级：语言不在支持集、语言/主题/内核加载失败、tokenizer 抛错、空输入，全部返回 `undefined` → 纯文本。宿主 `HighlightedText` 还会校验“token 拼接 == 该行真实文本”，不一致就退回纯文本，避免渲染出与真实内容不符的文字。
- 缓存：`(code, lang, theme)` 为键的 LRU 64 条（`null` 表示“已确认无法高亮”，避免每帧重试），另有 in-flight 去重。`resetHighlightCache` / `resetHighlighter` 仅测试使用。
- CRLF：行尾 `
` 视为行终止符（shiki 切分时也会丢掉它），两侧用同一个 `codeLineText` 规范化，CRLF 文件不会因文本不一致而整体丢失高亮。
- diff 高亮是**尽力而为**：diff 不是一段连续代码，所以按行内容整段 tokenize（行数一一对应），跨行结构（多行字符串/注释）的颜色不保证准确；但这只影响颜色，不影响文字。已写进代码注释。
- 内核与引擎本身也按需 `import()`：没有任何代码需要高亮时，`shiki/core`、引擎、语言、主题一个都不下载。

### 9.3 滚动窗口（R1/R2/R3/R6）

- 新增 `src/web/toolViews/ScrollBox.tsx`，六个内容视图（`CodeView`/`DiffView`/`OutputView`/`WebFetchView`/`WebSearchView`/`MatchListView`）全部改用；`bash` 的命令块与输出块各用一个（同级，不嵌套）。
- CSS：`.tool-view-scroll` 定义 `--tool-view-line-height: calc(10.5px * 1.55)`，自身用 `max-height: calc(16 * var(--tool-view-line-height))` + `overflow-y: auto`；`.code-body`/`.diff-body`/`.match-line-*`/`.path-list` 的行高全部引用同一变量，`.code-line` 用同一变量做 `min-height`。容器**无 padding / border**（全局 `box-sizing: border-box`，否则会吃掉 16 行）；滚动条不隐藏。
- **与契约字面的一处偏离（已获开发者确认）**：契约 §4.1/§11 写“高度 = 恰好 16 行”，R2 写“仅限高”，Memoh 实际实现是 `max-h-*`。我原本给出 `height`（固定 16 行）与 `max-height`（最多 16 行）两案，开发者选择 **`max-height`（限高）**：短内容（`edit` diff 实测中位 147 字符）不会浮在 260px 空盒子里，超出时正好 16 行可滚动。`styles.test.ts` 同时断言 16 与行高引用同一变量，且 `16 == SCROLL_WINDOW_LINES`。
  - **表述更正（审查 F2，见 §11.2）**：准确说法是“**窗口高 16 个代码行**”，不是“每个视图可见 16 行”。这一处的“超出时正好 16 行”只对行高均匀的视图（`read`/`write`、`bash`）成立；`edit`（含 skip 行）约 14–15 行、多文件 `ffgrep` 约 9–10 行、Markdown 类约 12–13 行（上限 16）。
- `bash` 输出**打开即在底部**（开发者确认）：`ScrollBox followTail` 用 `ResizeObserver` 兜住“挂载时还在闭合的 `<details>` 里、scrollHeight 为 0”的情况；用户主动向上滚动后不再被拉回，滚回底部恢复跟随。
- R3：`ExpandButton` 整体删除（含 `common.tsx` 导出），所有 `expanded` 状态与「展开全部/收起」按钮删除；行数文案改中性：`共 N 行`，超出窗口时补 `· 可滚动查看`（`lineCountNote`）。相关地，`toolText.ts` 的 `tailLines`/`LineSlice` 与对应测试一并删除——它们只为旧的“尾部 20 行 + 展开”存在，留着就是死代码。
- **不改动项（有意保留）**：通用降级详情 `.tool-detail pre` 仍是 `max-height: 320px`。R1/§4.1 限定的是列出的六个内容视图，通用 Arguments/Result 不在其中；若也要 16 行，请单独指示。→ **已被 §11.1.2 取代**：审查 F4 + 开发者裁决要求通用详情也进同一个窗口，320px 与 `<pre>` 自身的滚动已删除。

### 9.4 视觉（R5）与 Chat 正文（R7）

- diff：新增/删除行整行底色（沿用 `#e8f0e2` / `#f6e8e7`）+ 左侧 3px 实心指示条，用 `box-shadow: inset 3px 0 0` 而不是 `border-left`，避免该行 gutter 列相对上下文行右移 3px；上下文行无底色（没有 `.diff-line-context` 规则）。旧/新文件行号沿用服务端投影的 `lineNumber`（既有行为，未改）。
- gutter 列改为固定 `flex: 0 0 3.4em` + 右对齐 + `user-select: none`。
- `bash` 命令行显示 `$ <command>`，`$` 为独立 muted 元素且 `user-select: none`。
- **错误红色的落点（已获开发者确认）**：`ChatView.tsx:1450` 的既有不变量是 `if (item.isError || !View) return fallback;`，即失败的调用根本不进专属视图。因此做了两步：① 视图内按 `item.isError` 渲染 `.output-error`（真实失败调用走不到，但视图契约完整且有测试）；② `styles.css` 增加 `.tool-error .tool-detail pre { color: #c2635d }`，让真实失败调用的 Error 正文可见变红（代价：该详情里的 Arguments 段也一起变红，开发者已知悉并接受）。
  - **已修订（审查 F1，见 §11.1.1）**：② 的写法在 activity 分组场景会泄漏到组内**成功**调用（分组级 `tool-error` 是共同祖先），现已改为把红色绑在失败结果自己的 section 上（`.tool-result-error pre`），Arguments 段也不再变红。
- **stderr 无法单独染色**：真实 `bash` 结果文本里没有 stderr 标记（设计文档 §4.2 实测 `exit code` 命中率 0%），所以只按 `isError` 上色，不做文本猜测。
- 行内 code、LaTeX、表格、链接策略、`Worked for` 分组、投递状态、todo 条**未改动**。
- R7 的接入点在 `src/web/markdownPlugins.ts`：给 `markdownShared.components` 加 `SyntaxHighlighter: ShikiCodeBlock`（assistant-ui 官方的 fenced block 钩子，行内 code 不经过该钩子，天然不受影响）。因此 **`src/web/components/ChatView.tsx` 一行未改**，也没有第二套 markdown 配置。
- **解释（记录在案）**：R7 只说“接入同一高亮内核”。Chat 正文代码块因此**只加高亮、不加高度窗口**——`.markdown-body pre` 的深色底、padding、横向滚动保持原样（Memoh 的 CodeBlock 有 `max-h-48`，但 R8 与 §4.4 都要求 Chat 正文除高亮外不变）。如果希望 Chat 里的代码块也限高，请单独指示。

### 9.5 写入范围

- 实际改动：`package.json`、`package-lock.json`、`src/web/styles.css`、`src/web/markdownPlugins.ts`、`src/web/highlight.ts`(新)、`src/web/highlightReact.tsx`(新)、`src/web/highlight.test.ts`(新)、`src/web/styles.test.ts`(新)、`src/web/toolViews/**`（含 6 个视图、`common.tsx`、`toolText.ts`、`ScrollBox.tsx`(新) 与测试）。
- `src/server/**`、`src/shared/**`、`integrations/**`、`src/web/components/ChatView.tsx` 均未改动（本轮零服务端、零协议变化）。
- 未运行 `npm run dev`，未做任何 Git 破坏性操作，未接触真实 Pane / 真实会话数据。

## 10. 验证与交接

### 10.1 命令与结果（全部在 worktree 实测）

| 命令 | 结果 |
| --- | --- |
| `npm ci` | PASS（exit 0；缺 node_modules，按锁文件安装） |
| `npm install shiki` | PASS（新增 `shiki@4.4.3`，`package.json` 只多一行） |
| `npx vitest run src/web/toolViews src/web/components/ChatView.test.tsx` | **PASS** — 4 files / 140 tests |
| `npm run typecheck` | **PASS**（无输出） |
| `npm test` | **PASS** — 20 files / 298 tests（首跑曾出现 1 次既有 flake，见 §11.1 F5；修复后连跑 6 次全 PASS） |
| `npm run build` | **PASS**（`rm -rf dist` 后构建；typecheck + server + web 全过） |

新增/更新的测试按契约 §7 逐条对应：

| 契约要求 | 位置 |
| --- | --- |
| 语言推断（路径 / fence info / 未知 → `text`） | `highlight.test.ts`（含大小写、查询串、点文件、`Object.prototype` 名） |
| 逐行结构转换 | `highlight.test.ts`（token 拼接 == 原行；两个主题颜色不同而文本相同） |
| 高亮未就绪的纯文本降级 | `views.test.tsx`（首次渲染即为纯文本、无 inline color，随后出现 token 颜色且行数不变）；不支持语言恒为纯文本；`highlight.test.ts` 覆盖 `text`/未知/空输入/CRLF |
| 16 行容器与行高同一变量 | `styles.test.ts`（`--tool-view-line-height` 定义、`max-height: calc(16 * var(...))`、4 处行高引用；并断言 `16 == SCROLL_WINDOW_LINES`）。**仅为源码层断言**：jsdom 不解析自定义属性与级联，没有任何测试量过渲染高度；实际可见内容行数见 §11.2 |
| 展开按钮已移除 | `views.test.tsx` `expandControls()` 在 Code/Diff/Output/WebFetch 断言为空；`ChatView.test.tsx` 断言整页无该按钮；`styles.test.ts` 断言无 `.tool-view-expand` |
| diff 行 kind → 背景/指示条类名映射 | `views.test.tsx`（四种 kind 的 className 精确列表）+ `styles.test.ts`（add/remove 有底色与 `inset 3px 0 0`，无 `.diff-line-context` 规则） |
| 命令 `$` 前缀 | `views.test.tsx`（`.output-prompt` == `"$ "`、命令文本不变）+ `styles.test.ts`（muted + `user-select: none`） |
| 错误红色 | `views.test.tsx`（`.output-body pre.output-error`）+ `styles.test.ts`（`#c2635d`，且特异性高于 `.tool-detail pre` 的灰） |
| Chat 正文代码块接入同一内核（R7） | `ChatView.test.tsx`：fenced block 渲染出 `.code-block-line`、文本与 fence 内容一致、随后出现 token 颜色；行内 code 无 block 行**（端到端，真实内核）** |
| 尾部跟随 | `scrollBox.test.tsx`（打开即在底部、用户上滚后不被拉走、回到底部恢复跟随；用 stub 的 `ResizeObserver` 驱动） |

### 10.2 bundle 体积对比（同一方法：`rm -rf dist && npm run build`）

| 产物 | 变更前 | 变更后 | 差值 |
| --- | --- | --- | --- |
| `index-*.js` | 544.87 kB（gzip 151.47） | 544.87 kB（gzip 151.47） | **+3 B**（实质不变） |
| `ChatView-*.js` | 771.73 kB（gzip 230.27） | 776.00 kB（gzip 232.08） | **+4.17 kB**（gzip +1.81 kB） |
| `index-*.css` | 65.79 kB（gzip 17.30） | 66.31 kB（gzip 17.45） | **+0.51 kB** |
| 新增 `core-*.js` | — | 93.56 kB（gzip 29.48） | 按需 |
| 新增 `engine-javascript-*.js` | — | 57.63 kB（gzip 20.18） | 按需 |
| 新增语言 chunk（13 个） | — | 2.81 kB（json）～181.07 kB（typescript）（gzip 0.77～16.62） | 按需 |
| 新增主题 chunk（2 个） | — | 11.18 kB（github-light）/ 14.43 kB（github-dark-default） | 按需 |

首屏（`index` + `ChatView` + CSS）只多了约 4.7 kB：`shiki` 的内核、引擎、语言、主题全部在按需 chunk 里，只有真正要显示高亮代码时才下载（本地服务，且此后由浏览器缓存）。首次高亮的实际下载量约为 core + engine + 1 个语言 + 1 个主题。

### 10.3 未验证项与剩余风险

- **未做真实浏览器验收，也未做真实 Pane 验收**（未授权）。所有结论来自 jsdom 测试、typecheck、build 与源码阅读，页面观感（滚动条是否明显、浅色主题配色是否好看、`max-height` 下短内容的高度）**未在真实浏览器中确认**。
- **计算样式未实测**：`styles.test.ts` 是对 `styles.css` 源码的断言（jsdom 不解析自定义属性与级联）。也就是说“16 行”在实现与源码层面被锁住，但没有一行代码真的测量过渲染出来的高度。**建议 Integrator 在授权的 synthetic 环境里打开一个 read 工具详情，目视确认约 16 行、且滚动条可见。**
- **尾部跟随只测了逻辑**：`ResizeObserver` 在 jsdom 里不存在，测试用 stub 驱动；真实浏览器里 `<details>` 展开触发观察者回调这一环未实测。若真实环境不生效，表现为 bash 输出窗口停在顶部（不跳动、不报错）。
- **Markdown 类视图的高度单位是代码行**：`web_fetch`/`web_search` 的容器高按 16 × 代码行高（16.275px），而其中 Markdown 自身行距是 12px/1.5（R8 不改），所以可见的 Markdown 行数略少于 16。这是“容器高度与行高引用同一变量”的直接结果，已在验收时说明。
- diff 的跨行结构（多行字符串/注释）高亮不保证准确，只影响颜色；`ffgrep`/`fffind`/`bash` 输出不做语法高亮（输出不是源码），因此 `bash` 的红色只表示调用失败，不表示 stderr。
- 每类高亮降级都不显示 spinner；若 `shiki` chunk 加载失败（例如网络被拦截），界面就是纯文本，没有任何提示——这是契约要求的降级形态，但如果希望有一次性可见提示，需要另外决策。
- 未做的事（与契约 §5 一致）：虚拟滚动、字号/配色体系调整、服务端投影改动、P3 宿主文件读取、真实浏览器/Pane 验收。


## 11. 独立审查后的修复（2026-09-18，第二轮）

审查记录：`review-20260918-tool-views-rev2:.agents/tasks/20260918-tool-views-rev2-review.md`（结论「需修复后合入」，8 条）。开发者逐条裁决，本节只记录按裁决执行的结果。

### 11.1 逐条处置

| 编号 | 裁决 | 处置 |
| --- | --- | --- |
| F1 | 必修：红色限定到失败项自身 | **已改**（见 11.1.1） |
| F2 | 不改布局：表述改为「窗口高 16 行」 | **已改表述**（见 11.2）。UI 里本来没有任何「16 行」文案（行数文案是 `共 N 行 · 可滚动查看`），所以 ① 无 UI 改动，只改了代码注释与常量名：`SCROLL_BOX_LINES` → `SCROLL_WINDOW_LINES`，`ScrollBox` 头部注释与 `lineCountNote` 注释改为「窗口高 16 个代码行」并说明各视图可见行数更少 |
| F4 | 通用降级详情纳入同一滚动窗口 | **已改**（见 11.1.2） |
| F5 | 收窄 `promptCalls()` 匹配 | **已改**：`/\/prompt(?:[?#]|$)/`，并注明这是既有 flaky 的修复（见 11.1.3） |
| F7 | 不改代码，记为已知项 | **不改代码**，已补入 11.4 已知限制（含审查实测数字） |
| F6 | 不改代码；记录更正由 Integrator 做 | **不改代码**；§10.2 的数字更正留给 Integrator：正确事实是「首次高亮会下载 **2 个**主题（github-light 11.18 kB + github-dark-default 14.43 kB，同属 GitHub 家族）」以及「语言 chunk 实测 **15 个**（13 个语言中 css、javascript 各多一个 59/66 B 的 re-export 壳）」 |
| F3 | 记录补「仅源码层断言」 | **已补**：§10.1 表格该行已加注；§11.5 再次列出 |
| F8 | 记录/文档层面，Integrator 处理 | **未改**（`docs/` 不在本轮允许范围），仅在此记明 R7/R8 见本文件 §2 |

#### 11.1.1 F1：红色绑定到失败结果自身

- 我选的方案：在 `GenericToolDetail` 把 `isError` 传给 `ToolResultData`，由后者在 **Result section 自己**上打 `tool-result-error`（成功时只有 `tool-result`），CSS 规则改为 `.tool-result-error pre { color: #c2635d }`。
- 为什么不是裁决里举例的 `.tool-error .tool-result pre`：`.tool-error` 也挂在 **activity 分组**上（`ChatView.tsx:1338`，只要组内有一个失败就加），而分组的 `.tool-detail` 子树里包含所有**成功**子行。所以以 `.tool-error` 为祖先的写法（无论后面接 `.tool-result` 还是 `.tool-detail pre`）都会继续把成功兄弟的结果染红 —— 换汤不换药。把状态放在失败项自己的节点上，不依赖任何祖先，既满足「限定到失败项自身」，也不会在将来新增容器形态时静默失效。
- 顺带收窄：Arguments 段回到灰色，只有错误正文是红的（原先的记录代价「Arguments 也一起变红」已消失）。
- 分组 summary 的红图标**未改**（`.tool-error .tool-state` 原样保留）。
- 可证伪：把 CSS 规则改回 `.tool-error .tool-detail pre` → `styles.test.ts`「keys the error red on the failing result, not on an ancestor (F1)」FAIL（`stylesheet has no rule for .tool-result-error pre`）；把 `tool-result-error` 类去掉 → `ChatView.test.tsx` 同名用例 FAIL（`expected [] to have a length of 1 but got +0`）。两次实验后均已还原（md5 校验一致）。

#### 11.1.2 F4：通用降级详情进同一个窗口

- `ChatView.tsx` 的 `ToolData` / `ToolResultData` 现在各把一个 `ScrollBox` 包在 `<pre>` 外，section 加上 `tool-data` / `tool-result` 类（后者也是 F1 的钩子）。
- 同时删掉 `.tool-detail pre { max-height: 320px; overflow: auto }` 的两条声明（并删掉随之失效的 `.tool-view pre { max-height: none; overflow: visible }`）：现在整个面板里**没有任何 `<pre>` 自己是滚动容器**，限高只由 `.tool-view-scroll` 一处负责。`.tool-view-scroll` 自带 `--tool-view-line-height` 定义，不依赖 `.tool-view` 祖先，所以失败/未知/解析失败的路径同样拿到 16 行窗口。
- 注意：这超出了原契约「ChatView.tsx 仅 fenced code block 接入」的限制，是 F1+F4 裁决直接要求的改动（两处都在通用详情渲染函数里），已在 §11.6 记为范围说明。
- 可证伪：把两个 `ScrollBox` 去掉 → `ChatView.test.tsx`「bounds the generic Arguments/Result detail with the shared window (F4)」FAIL（`expected [] to have a length of 2 but got +0`）；`styles.test.ts`「is bounded by the shared window, not by a scrolling `<pre>`」会在 CSS 回退时 FAIL。已还原（md5 一致）。
- 成功路径未受影响：六个已注册视图的窗口与 `bash`/`diff` 等既有断言全部照旧通过（§11.3）。

#### 11.1.3 F5：既有 flaky 的修复

- `promptCalls()` 原来用 `String(url).includes("/prompt")`，把 `/api/prompt-delivery/events`（300ms 后的 trace 上传）也算成一次 prompt 调用；负载高时它落进「No automatic retry」的 30ms 等待窗口，测试就误报。
- 改为 `/\/prompt(?:[?#]|$)/u`（只匹配 prompt 端点本身）。这是既有测试缺陷，与 Rev.2 产品代码无关；修复后 `npm test` 连跑 6 次全 PASS（§11.3）。

### 11.2 F2：窗口高 16 行，不是「可见 16 行」

表述统一为「**窗口高 16 个代码行**」（`16 × --tool-view-line-height = 16 × 16.275px = 260.4px`）。各视图实际可见的**内容行数**因为自身行高/间距不同而不同，量级如下（CSS 算术，非渲染实测）：

| 视图 | 可见内容行数（量级） | 依据 |
| --- | --- | --- |
| `read` / `write`（CodeView） | **16** | `.code-line` 的 `min-height` 就是变量、行间无 gap → 唯一精确的情形 |
| `bash`（OutputView 输出块） | **16**（长行折行时更少） | `<pre>` 走 `.tool-detail pre { line-height: 1.55 }`，数值上恰好 = 10.5 × 1.55；`white-space: pre-wrap` 下长行折行会占更多高度 |
| `edit`（DiffView，含 skip 行） | **约 14–15** | 每个 `⋯ 略过的上下文` 行 = 16.275 + 2×1px 虚线边框 + 2×2px margin ≈ 22.3px，3 个 skip 行多花约 18px |
| `ffgrep`（MatchListView 匹配块，多文件） | **约 9–10** | 文件头 `.match-file-path` 未设行高，继承 `.chat-message { line-height: 1.68 }`（10.5px → 17.64px）；`.match-body { gap: 7px }`、`.match-file { gap: 1px }`。按设计文档 §5.4.2 的真实形状（4 个文件）估算：文件头 4×17.64 + gap 3×7 + 文件内 4×1 ≈ 95.6px，余下 164.8px ÷ 16.275 ≈ 10 行 |
| `fffind`（路径列表） | **约 15** | `.path-list` 行高 = 变量（16.275px）+ `gap: 1px` → 17.275px/行，260.4 ÷ 17.275 ≈ 15.1 |
| `web_fetch` / `web_search`（Markdown） | **≤ 16，实际约 12–13** | `.tool-view .markdown-body` 是 12px，行距继承 `.chat-message`/`.activity-message` 的 `1.68`（≈20.2px/行）；再叠加段落间距、标题、代码块，实际更少 |
| 通用 Arguments/Result 详情（F4 之后） | Argument/Result 各自约 16 行 | `<pre>` 走 `.tool-detail pre` 的 1.55（同上，数值等于变量） |

**第二处独立行高来源**：`.tool-detail pre { line-height: 1.55 }` 与 `--tool-view-line-height: calc(10.5px * 1.55)` 是两处独立字面量，数值上相等所以现在也是 16 行，但改一处另一处不会跟随。审查建议把它也改成 `var(--tool-view-line-height)`；开发者这次的裁决是「不改布局 + 记录说明」，因此本轮**保持原样**并在此记录。将来若要统一，这是一行改动且**零视觉变化**（10.5px × 1.55 与变量值完全相等），前提是变量得提升到 `.tool-detail` 一级（否则不在滚动窗口内的 `<pre>` 拿不到变量）。

**`可滚动查看` 文案的边界**：提示阈值是「行数 > 窗口高（16 行）」。像多文件 `ffgrep` 这种「行数少但行高大」的正文会滚动却不显示提示——属于保守（宁可少提示，不误报可滚动），已在 `lineCountNote` 注释里写明。

### 11.3 验证（全部实测，第二轮）

| 命令 | 结果 |
| --- | --- |
| `npx vitest run src/web/toolViews src/web/components/ChatView.test.tsx` | **PASS** — 5 files / 142 tests；连跑 3 次全 PASS |
| `npm run typecheck` | **PASS**（无输出） |
| `npm test` | **PASS** — 20 files / **303 tests**；连跑 **6 次全 PASS**（F5 要求 ≥5 次） |
| `npm run build` | **PASS**（`rm -rf dist` 后构建，typecheck + server + web 全过） |
| F1 可证伪实验 | 回退 CSS 规则 → 目标用例 **FAIL**；回退 `tool-result-error` 类 → 目标用例 **FAIL**；两次均已还原（md5 一致，随后全绿） |
| F4 可证伪实验 | 去掉两个 `ScrollBox` → 目标用例 **FAIL**（`got +0`）；已还原 |

新增测试（+5）：`styles.test.ts` 2 条（错误红绑定到结果自身而不是祖先、通用详情由窗口限高且窗口自包含）+ `ChatView.test.tsx` 2 条（通用详情进窗口、错误分组里只标记失败项自己的结果）+ F1 CSS 断言并入原有错误红用例。

build 体积（第二轮交付 vs 第一轮交付 `91519de`，同法 `rm -rf dist && npm run build`）：

| 产物 | 第一轮 | 第二轮 | 差值 |
| --- | --- | --- | --- |
| `index-*.js` | 544877 B | 544877 B | 0 |
| `ChatView-*.js` | 776005 B | 776159 B | **+154 B** |
| `index-*.css` | 66317 B | 66232 B | **−85 B** |

按需 chunk（shiki 内核/引擎/语言/主题）与本轮无关，未变化；F6 的记录更正见 11.1。

### 11.4 已知限制（本轮新增/补记）

- **F7（开发者决定记为已知项，不改代码）**：`highlightLines` 里的 `codeToTokens` 在主线程同步执行且没有大小上限（LRU 只按 64 **条**、不按字节）。审查在 Node 25 + shiki 4.4.3 + JS 引擎下的实测：100 行 46ms、500 行 126ms、**2000 行约 400ms**、**8000 行约 1.45s**（约 0.18ms/行；首行数字含内核/引擎/主题冷启动约 410ms），缓存命中 0.0–0.6ms。触发面是 Chat 正文或 `web_fetch` 正文里的超长 fenced code block（模型输出与网页正文都没有上限；`read` 的结果本身由 Pi 截断）。若将来要收敛，最小改法是加行数阈值（超过就直接返回 `undefined` 走纯文本，符合既有降级语义）。
- **记录更正留给 Integrator（F6）**：见 11.1 表格最后两行的「记录更正」栏。
- **F3 未改变**：`styles.test.ts` 是读源码的断言，不能证明渲染高度（§10.1 已加注）。

### 11.5 未验证项（与第一轮相同，未因修复而改变）

- **仍未做真实浏览器与真实 Pane 验收**（未授权）：F1（红色是否只落在失败项）、F2（各视图实际可见行数、子像素取整）、F4（通用详情的滚动条观感）都只有 DOM/CSS 源码层与算术证据，**没有一处真实渲染测量**。
- jsdom 不做级联与布局：F1 的「红色不再泄漏」在 jsdom 里无法用计算样式验证（审查已实测确认 jsdom 连 `.tool-error .tool-detail pre` 都不生效），所以本轮用「错误标记只出现在失败项的结果 section（DOM 断言）+ 规则不再以祖先为键（CSS 断言）」两条替代证据；两者都能被回退实验证伪（11.3），但仍不等于真实浏览器里的颜色验证。
- `bash` 尾部跟随仍只测了逻辑（`ResizeObserver` 由 stub 驱动），真实 `<details>` 展开触发观察器这一环未实测。

### 11.6 范围说明

- 本轮改动：`src/web/components/ChatView.tsx`（仅 `GenericToolDetail` / `ToolData` / `ToolResultData` 三处，F1+F4 裁决要求的通用详情渲染）、`src/web/components/ChatView.test.tsx`、`src/web/styles.css`、`src/web/toolViews/ScrollBox.tsx`（注释与常量改名）、`src/web/toolViews/common.tsx`（注释）、`src/web/styles.test.ts`、本文件。
- 其余一切未动：无新增依赖、无 `src/server/**`、`src/shared/**`、`integrations/**`、`docs/**` 改动，未运行 `npm run dev`，未做任何 Git 破坏性操作。
- `ChatView.tsx` 的折叠行、分组规则、`Worked for`、投递状态、todo 条逻辑仍然一行未改（改动只在通用工具详情的渲染分支内）。

## 12. 第二轮定向复审后的修复（2026-09-18，第三轮）

复审记录：`review-20260918-tool-views-rev2-r2:.agents/tasks/20260918-tool-views-rev2-review-r2.md`（结论「需修复后合入」，唯一阻塞项 N1）。开发者裁决：修 N1、把 N5 的断言升级为能锁级联的形式、改 N2 的 3 处注释；N3/N4/N6 不动。

### 12.1 N1：红色被 `.tool-detail pre` 覆盖（回归，已修）

**根因**：我上一轮把规则写成 `.tool-result-error pre`，特异性 (0,1,1)，与 `.tool-detail pre` 的 (0,1,1) **相同**，而灰色规则在文件里更靠后 → 后出现者胜 → 失败正文实际是灰色。修复前 `.tool-error .tool-detail pre` 是 (0,2,1)，红色确实生效（代价是泄漏）——所以这是「泄漏没了，红色也没了」。**这是我上一轮的实现错误，不是裁决错误。**

**选的方案 (b)：把选择器改成 `.tool-detail .tool-result-error pre`（特异性 0,2,1）。**

理由（三案比较）：

| 方案 | 为什么没选 |
| --- | --- |
| (a) 把红色规则移到 `.tool-detail pre` 之后 | 能修好，但胜出**依赖源码顺序**——正是这次出问题的机制。将来任何重排/格式化/新增规则都可能让它静默复发，而且红色规则会离开它旁边的 `.tool-error .tool-state` 错误色块，语义上被拆散 |
| (c) 在 `.tool-result-error` 段上设 `color` 让 `<pre>` 继承 | 不可行：`.tool-detail pre` 显式设了 `color: #5e635a`，显式值不吃继承；要让它生效就得把 `.tool-detail pre` 改成 `color: inherit`，那会连带改变 Arguments 段、各视图与 Markdown 代码块的灰色来源 → 属于改配色（R8 不允许），且需要再确认没有其它显式覆盖 |
| **(b) 提高特异性** | 用**特异性**而不是顺序保证胜出：`.tool-detail` 是所有通用详情的必然祖先（`ChatView.tsx` 的 `ToolFallback` 与 `ToolItemRow` 都用 `<div className="tool-detail">` 包住 `ToolDetail`，全仓只有这两处调用），所以不会失去匹配；选择器里仍然只有「失败结果 section」这一个错误状态，不含任何分组级的 error 祖先，因此不会重新泄漏 |

**证据（可证伪，已实测）**

1. 实验 1：把选择器降回 `.tool-result-error pre`（同特异性、位置仍在灰色规则之前）→ `npx vitest run src/web/styles.test.ts` **FAIL**：`expected '#5e635a' to be '#c2635d'`（新断言直接把 N1 的后果抓出来）。还原后 md5 `a6efdf4c4fe592e85d43c65b635325ce` 一致。
2. 实验 2：改回祖先键控的旧写法 `.tool-error .tool-detail pre` → **FAIL 4 条**，其中 `leaves a successful sibling in a failed group gray` → `expected '#c2635d' to be '#5e635a'`、`leaves the Arguments section gray` 同（F1 泄漏形态被抓住）。已还原。
3. 发行 CSS 静态证据（`grep -o` + 按 CSS 规范（特异性、然后顺序）解析，脚本 `/tmp/rev2-n1-static.mjs`）：

   缺陷态（临时回退后构建，`index-DiLH9O1W.css`，与上一轮交付的 CSS 哈希一致）：
   ```
   offset  20348  spec (0,1,1)  .tool-detail pre{color:#5e635a;…}
   generic failed result <pre> — competing rules: 1
   WINNER: .tool-detail pre -> #5e635a        ← 灰色，N1 复现
   ```
   修复态（当前 `dist/web/assets/index-WzzfKINp.css`）：
   ```
   offset  19782  spec (0,2,1)  .tool-detail .tool-result-error pre{color:#c2635d}
   offset  20361  spec (0,1,1)  .tool-detail pre{color:#5e635a;…}
   offset  22239  spec (0,2,1)  .output-body pre.output-error{color:#c2635d}
   generic failed result <pre> — competing rules: 2
   WINNER: .tool-detail .tool-result-error pre -> #c2635d     ← 红色，且红色规则仍然在灰色规则之前
   ```
   （`.output-body pre.output-error` 需要 `.output-body` 祖先，通用结果 `<pre>` 没有，故不参与竞争；它是 `bash` 视图路径的红色，另有一条用例覆盖。）
4. DOM 层不变：`tool-result-error` 仍然只加在 `isError` 的 Result section 上（上一轮新增的 ChatView 用例照旧通过）。

### 12.2 N5：测试从「规则存在」升级为「谁在级联中胜出」（已改）

`styles.test.ts` 现在自带一个**小型级联解析器**（不新增依赖，约 150 行测试代码）：把真实 `styles.css` 解析成有序规则 → 按宿主元素/`.class` 子集匹配一条「祖先→目标」链（支持后代与 `>` 组合符）→ 按 **特异性优先、源码顺序次之** 选胜者 → 返回胜者声明的 `color`。配套改动：

- `cssRule()` / `hasRule()` / `anySelectorIncludes()` 改为按**规范化后的完整选择器列表**比较（`a,\nb` 与 `a, b` 等价），行为不变。
- 新增 4 条**按结果断言**的用例（不是断言规则文本）：
  | 路径（`ChatView.tsx` 真实渲染的 class 链） | 期望胜出色 |
  | --- | --- |
  | 失败调用的 Result `<pre>`（行自带 `tool-error`） | `#c2635d` |
  | 失败调用的 `bash` 视图输出 `<pre class="output-text output-error">` | `#c2635d` |
  | **同一失败分组内成功兄弟**的 Result `<pre>`（分组带 `tool-error`、子行不带） | `#5e635a` |
  | 失败调用的 Arguments `<pre>` | `#5e635a` |
- 另加一条 **guard 用例**：枚举「目标元素是 `<pre>`」的全部规则，断言集合恰为 `{.markdown-body pre, .tool-detail .tool-result-error pre, .tool-detail pre, .output-body pre.output-error}`，并断言每条选择器的每个复合选择器都落在解析器建模的子集（元素名/类）内。这样将来新增任何能给 `<pre>` 上色的规则都会在这里变成 diff，解析器不会「看不见」它。
- 另加一条**机制断言**：`.tool-detail pre` 是 (0,1,1)、`.tool-detail .tool-result-error pre` 是 (0,2,1) 且后者严格更高——即红色不依赖源码顺序取胜。
- 可证伪性：§12.1 的实验 1/2 就是在这套断言上失败的（实验 1 有 3 条 FAIL，含决定性的 `resolvedColor` 断言）；上一轮那套「只断言规则存在」的写法在缺陷态是全绿的，这正是 N1 逃逸的原因。

### 12.3 N2：3 处注释的表述（已改）

| 位置 | 改法 |
| --- | --- |
| `src/web/styles.css`（`.tool-view-scroll` 上方） | 「a body taller than the window shows exactly 16 of those lines」→「the window is 16 **code lines** tall — not 15, not 17 — and the content it shows depends on each view's own row heights（含 `edit` ~14–15 / `ffgrep` ~9–10 / Markdown ~12–13 的指引）」；顺带把「lines wrap, so no horizontal scrollbar…」改成如实说明 Markdown 代码块保留自己的横向滚动（N3 的边界，非阻塞） |
| `src/web/styles.test.ts` | 「of the 16 visible lines」→「of the window's 16 code lines」 |
| `src/web/toolViews/WebFetchView.tsx` | 「the shared `ScrollBox` (16 lines visible, native scroll)」→「a window 16 code lines tall, native scroll」+ 明确 Markdown 自身行距导致可见行数少于 16 |

`docs/tool-call-detail-ui-plan.md` 的两处（:437、:446）按裁决留给 Integrator，本轮未改。

### 12.4 本轮明确没动的（按裁决）

- **N3**（`.markdown-body pre` 的横向滚动）：有意保留，只在注释里写明。
- **N4**（`ChatAttachments` 5s 超时）：既有、base 同样复现，不在本批范围。
- **N6**（`lineCountNote` 阈值保守）：已知取舍，注释与 §11.2 已记录。

### 12.5 验证（第三轮，全部实测）

| 命令 | 结果 |
| --- | --- |
| `npx vitest run src/web/toolViews src/web/components/ChatView.test.tsx` | **PASS** — 4 files / 142 tests |
| `npm run typecheck` | **PASS**（无输出） |
| `npm test` | **PASS** — 20 files / **309 tests**（较上轮 +6：级联解析器的 5 条 + 机制断言 1 条）；连跑 3 次全 PASS |
| `npm run build` | **PASS**（`rm -rf dist` 后构建；typecheck + server + web 全过） |
| N1 可证伪实验 ×2 | 均 **FAIL（预期）**，随后还原并校验 md5 一致（见 §12.1） |
| 发行 CSS 静态解析（缺陷态/修复态） | **PASS**（缺陷态 WINNER=灰；修复态 WINNER=红，见 §12.1 第 3 条） |

体积（第三轮 vs 第二轮交付 `bf6c04c`）：`index-*.js` 544877 B → 544877 B（不变）；`ChatView-*.js` 776159 B → 776159 B（不变）；`index-*.css` 66232 B → **66245 B（+13 B）**——只来自选择器多出的 `.tool-detail `（注释不进产物）。无新增依赖。

### 12.6 未验证与限制（本轮）

- **仍未做真实浏览器与真实 Pane 验收**（未授权）。N1 的修复结论由三部分支撑：① 按 CSS 规范的级联解析（自建解析器 + `/tmp` 脚本两处独立实现，结论一致）；② 发行 CSS 的规则文本、偏移与特异性；③ jsdom DOM 层断言（错误类只落在失败项）。**这三者都不是真实浏览器的计算样式测量**，仍属静态推断；审查已实测确认 jsdom 忽略特异性，因此 jsdom 只能作旁证。
- 自建解析器只建模元素名/类与后代/`>` 组合符（guard 用例保证 `<pre>` 相关规则不越界）；`@media` 条件被忽略（当前唯一的 `@media` 块只改布局、不含 `<pre>` 颜色，已人工核对）。
- 其它限制同 §11.5（F7 的同步 tokenize 上限、尾部跟随的观察器环节、jsdom 不做布局）。
