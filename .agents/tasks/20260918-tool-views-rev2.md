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
