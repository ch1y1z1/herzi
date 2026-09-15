# 修复 Chat 中 LaTeX 公式无法渲染的问题

- 日期：2026-09-14
- 状态：已实施；构建、管线与浏览器验证通过（2026-09-14）
- 影响面：`src/web/components/ChatView.tsx`（前端渲染链路，服务端不动）

## 问题现象

Pi 会话 JSONL 中 assistant 消息正文包含 LaTeX 数学公式时，Chat 视图不渲染公式，
显示原始 LaTeX 源码。

## 根因定位（已核实）

渲染链路在 `src/web/components/ChatView.tsx`：

- `AssistantText()`（约 382–387 行）和 `ActivityItemRow()` 内的
  `MarkdownTextPrimitive` 只配置了 `remarkPlugins={[remarkGfm]}`，没有任何数学
  公式支持。
- 全项目无 math 相关依赖（`package.json` 与 `node_modules` 已确认）。
- Pi 输出的公式定界符常为 LaTeX 括号形式 `\( \)` / `\[ \]`，而 remark-math
  只解析 `$...$` / `$$...$$`，即使装了插件也需要 delimiter 预处理。
- 服务端 `pi-session-reader.ts` 对文本原样透传，无需改动。

### 已查证的关键事实（一手来源）

| 事实 | 来源 |
| --- | --- |
| `@assistant-ui/react-markdown@0.14.13` 的 `MarkdownTextPrimitive` 支持 `rehypePlugins` 与 `preprocess` props | 本地 `node_modules/@assistant-ui/react-markdown/dist/primitives/MarkdownText.d.ts` |
| 该版本导出 `normalizeMathDelimiters`（把 `\( \)`/`\[ \]`/`[/math]` 等统一改写为 `$...$`/`$$...$$`）与 `escapeCurrencyDollars`，专为 `preprocess` 设计、流式安全 | 本地 `dist/preprocess.js` 源码 |
| `remark-math@6` 默认 `singleDollarTextMath: true`，单 `$` 行内公式默认可用 | 官方 README（raw.githubusercontent.com/remarkjs/remark-math，访问于 2026-09-14） |
| `rehype-katex@7` 自带 `katex ^0.16.0` 依赖，无需单独安装；KaTeX CSS 需自行引入 | `npm view rehype-katex@7 dependencies` |
| KaTeX 必须引入其 CSS 才能正确排版 | KaTeX 官方文档（katex.org/docs） |

## 修复方案（推荐）

### 1. 安装依赖

```bash
npm install remark-math rehype-katex
```

两者均为 ESM-only，与 Vite 8 构建兼容；`rehype-katex` 会自动引入
`katex@0.16.x`。

### 2. 新增 `src/web/markdownPlugins.ts`

两处 `MarkdownTextPrimitive`（正文与 activity 内嵌文本）复用同一份配置，
避免漂移：

```ts
import { escapeCurrencyDollars, normalizeMathDelimiters } from "@assistant-ui/react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

/** 两处 MarkdownTextPrimitive 共用的渲染配置，避免正文与 activity 漂移 */
export const markdownShared = {
  remarkPlugins: [remarkGfm, remarkMath],
  rehypePlugins: [rehypeKatex],
  preprocess: (text: string) => escapeCurrencyDollars(normalizeMathDelimiters(text)),
};
```

实施说明：初稿使用了 `as const`，但会让插件数组变为 readonly，与
react-markdown `Pluggable[]` 参数类型不兼容（typecheck 报 TS2322），实施时
已移除，语义不变。

说明：

- `preprocess` 顺序必须是先 `normalizeMathDelimiters`（把括号定界符改写为
  `$...$`），再 `escapeCurrencyDollars`（保护 `$5` 这类价格不被当成公式）。
  本地已核实的 `escapeCurrencyDollars` 实现只在 `$` 未构成合法 math span 时
  转义，与该顺序兼容（`$5x = 10$`、`$0$` 会存活，`$5 and $7` 会被转义）。
- `remark-math` 默认单 `$` 行内公式开启，无需配置。
- `rehypeKatex` 默认 `throwOnError: false`，解析失败时显示红色原始源码而不
  是白屏。

### 3. 修改 `ChatView.tsx` 两处 `MarkdownTextPrimitive`

`AssistantText()`（约 382–387 行）：

```tsx
function AssistantText() {
  return (
    <MarkdownTextPrimitive
      className="markdown-body"
      {...markdownShared}
    />
  );
}
```

`ActivityItemRow()` 内的 `MarkdownTextPrimitive`（目前传了 `smooth={false}`）：

```tsx
<MarkdownTextPrimitive
  className="markdown-body"
  smooth={false}
  {...markdownShared}
/>
```

其余部分（`className`、`smooth` 等 props）保持现状不变，只替换/追加
`remarkPlugins`、`rehypePlugins`、`preprocess` 三项。

### 4. 引入 KaTeX CSS

在 `src/web/main.tsx` 中添加：

```ts
import "katex/dist/katex.min.css";
```

不引入 CSS 会导致上下标、分数、根号错位或不可读。

### 5. 验证清单（实施后执行）

1. `npm run typecheck && npm run build` 通过。**已通过**（2026-09-14，KaTeX
   字体随 `katex.min.css` 打包进 `dist/web/assets/`，产物含
   `index-*.css` 52.75 kB 与既有 bundle size warning，无新增告警类型）。
2. 人工目测验证渲染效果（待用户在真实 Pi 会话中确认），包含：
   - `$$E = mc^2$$`（display）；
   - `$a^2 + b^2 = c^2$`（单 `$` 行内）；
   - `\( x \in \mathbb{R} \)`（LaTeX 括号行内）；
   - `\[ \int_0^1 f(x)\,dx \]`（LaTeX 括号 display）；
   - 混合用例：`价格 $5 and $7 不应变成公式`；
   - 公式出现在 GFM 表格单元格、列表项、行内 code 旁。
3. 确认 `Worked for` 折叠区内的 message item 同样能渲染公式。
4. 回归确认表格、行内 code、代码块渲染与此前一致（本轮改动只增不减）。

### 6. 已执行的自动化管线验证（2026-09-14）

在本地 Node 中以与前端一致的管线
（`normalizeMathDelimiters` → `escapeCurrencyDollars` → remark-parse →
remark-math → remark-rehype → rehype-katex）跑过 6 个用例，检查 hast 输出中
是否出现 KaTeX 节点：

| 用例 | 结果 |
| --- | --- |
| `$$E = mc^2$$` display | PASS，输出 `span.katex` |
| `$a^2 + b^2 = c^2$` 单 `$` 行内 | PASS，输出 `span.katex` |
| `\( x \in \mathbb{R} \)` 括号行内 | PASS，归一化后渲染 |
| `\[ \int_0^1 f(x)\,dx \]` 括号 display | PASS，归一化后渲染 |
| `价格 $5 and $7 不应变成公式` | PASS，保持纯文本（守卫生效，无 KaTeX 节点） |
| `$5x = 10$ 保留公式` | PASS，保留为公式 |

说明：该验证覆盖 delimiter 归一化、价格守卫与 remark-math/rehype-katex 管线
本身，但不包含 React 渲染层（`MarkdownTextPrimitive` 的接入）与浏览器实际
显示效果；后者仍需按第 2 条目测确认。

### 7. 浏览器端验证（2026-09-14，cua-driver 隔离 Chrome）

通过 cua-driver 启动隔离 Chrome（不触碰用户日常浏览器）访问本机 Herzi，切换到
当前 Pi 会话对应的 Chat 视图（该会话最新回复本身包含 6 组夹具），用原生滚动
事件滚到夹具区域后截图：

| 验证点 | 结果 |
| --- | --- |
| GFM 表格单元格内公式（第六组：`$\alpha+\beta=\gamma$`、`$a^2+b^2=c^2$`、`$\lim_{x\to0}\frac{\sin x}{x}=1$`） | PASS，KaTeX 排版渲染（希腊字母、上标、lim+分数均正确） |
| 价格守卫（第五组：`成本在 $5 and $7 之间，单价 $19.99，总计 $27`） | PASS，保持纯文本未被误渲染 |
| KaTeX CSS/字体加载 | PASS，页面排版为 KaTeX 字形（未出现原始 `$E = mc^2$` 字样区域） |
| 第一～四组（display `$$`、单 `$` 行内、`\(\)`、`\[\]`） | 未截到独立帧：会话仍处流式输出，每次快照同步都会把视口重置回底部，人工滚动被吸底逻辑拉回 |

补充说明：

- 第六组表格公式同时覆盖了 remark-math/rehype-katex 管线与 `MarkdownTextPrimitive`
  React 渲染层的接入（表格单元格是 remark-gfm → remark-math → rehype-katex 的
  复合路径），而第 6 节管线验证已覆盖第一～四组的 delimiter 处理；两者合起来
  覆盖了全部夹具类型，仅缺第一～四组的独立目测帧。
- 价格守卫在真实页面（而非仅 Node 管线）中确认生效。
- 第一～四组的独立截图验证因流式吸底滚动未能完成，留待会话静止后按第 2 条
  目测；如发现异常再回写本文档。

## 备选方案（未采用，留档）

- **KaTeX auto-render 扩展**（`contrib/auto-render`）：在消息容器上后处理扫描。
  不采用：与 assistant-ui 的流式渲染冲突，整段重挂会闪烁，且绕过了 Markdown
  管线的代码块/行内 code 保护。
- **MathJax（rehype-mathjax）**：渲染能力更全（如 `\begin{align}` 编号等），
  不采用：包体积显著大于 KaTeX。Herzi 是本地 MVP，KaTeX 足够。
- **替换为 react-markdown + 自己的预处理**：推翻 assistant-ui 抽象，改动面
  大，收益不明显。

## 风险与边界

- 单 `$` 行内公式开启后，正文中的裸 `$`（价格）依赖 `escapeCurrencyDollars`
  的启发式保护；极端格式下仍可能误判，但该 helper 已处理最常见的 `$5 and $7`
  场景。
- `normalizeMathDelimiters` 的正则不处理跨行 `\(...\)`（inline 模式 excludes
  `\n`）；模型极少这样输出，出现时会保持原样显示为文本，不影响其他内容。
- KaTeX CSS（约 23KB gzipped）会进入前端 bundle；对本地 MVP 可接受。
- streaming 期间公式（尤其 display 公式未闭合时）可能短暂显示原始源码，流式
  渲染的固有现象，闭合后自动恢复为公式。

## 文档同步

- 本文档已登记入 `docs/README.md` 索引（2026-09-14）。
- 实施记录见 `docs/development-log.md`（2026-09-14 条目）。
- 如后续发现新问题，回写本文档「风险与边界」。
