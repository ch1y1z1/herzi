# Markdown 链接渲染

- 状态：Worker A 实现完成，已本地验证，待 Integrator 集成与浏览器验收。
- 目标：让 Chat 中 Markdown 链接具有默认高亮、hover/focus 高亮，并默认在新浏览器 tab 打开。
- 修改范围：`src/web/markdownPlugins.ts`、`src/web/styles.css`、一个新的 Markdown link renderer 及其前端测试；不修改 `ChatView.tsx`。
- 验收条件：assistant 正文和 activity 内嵌 Markdown 共用行为；链接具有可辨识颜色/下划线、键盘 focus 样式；anchor 使用 `target="_blank"` 与 `rel="noopener noreferrer"`；测试通过。
- Base：`dd8cbe9`（`docs: establish parallel task baseline`），分支 `agent-20260916-markdown-links`，worktree 从该 committed baseline 创建。

## 过程与决策

规划阶段的结论（保留）：

- 当前两处 Markdown 都使用 `markdownShared`，适合在共享配置中增加 anchor renderer，无需分别修改两个渲染点。
- `styles.css` 当前没有 `.markdown-body a` 规则，因此链接继承普通文本外观。
- `MarkdownTextPrimitive` 支持传入 React Markdown `components`，可统一覆盖 `a`。
- 该任务与消息投递任务可以并行，只要后者不修改 `markdownPlugins.ts` 或 `styles.css`。

实施阶段的实际决策：

1. **接线点**：新增 `src/web/markdownLink.tsx`，导出 `MarkdownLink`；在 `markdownPlugins.ts` 的 `markdownShared` 里加 `components: { a: MarkdownLink }`。`markdownShared` 被 `ChatView.tsx` 的两处 `MarkdownTextPrimitive`（assistant 正文、activity 内嵌文本）以 `{...markdownShared}` 展开，因此未改动 `ChatView.tsx` 即覆盖两条路径。已核实 `MarkdownTextPrimitiveProps` 的 `components` 会原样透传给 `react-markdown`（`node_modules/@assistant-ui/react-markdown/dist/primitives/MarkdownText.js` 只替换 `pre`/`code`，其余 `componentsRest` 直接传给 `ReactMarkdown`）。
2. **统一 `target="_blank"`**：所有 Markdown anchor 一律新 tab 打开，包括同页 `#fragment` 与非 http scheme（`mailto:` 等），不做 scheme 分支。理由：验收条件写的是"anchor 使用 `target="_blank"` 与 `rel="noopener noreferrer"`"，没有例外；模型输出中出现同页锚点的概率极低。副作用（已知限制）：同页 `#anchor` 会在新 tab 打开原页面而不是本页跳转。
3. **rel 不被削弱**：`resolveRel` 始终带上 `noopener noreferrer`，合并调用方传入的其它 token，并剔除会与 `noopener` 冲突的 `opener`。调用方显式传入的 `target` 仍被尊重（默认值才是 `_blank`）。
4. **剔除 react-markdown 的 `node`**：react-markdown v10 默认把 hast 节点作为 `node` 传给自定义组件。已实测（临时 scratch 测试，用 `vi.spyOn(console, "error")` 观察）React 19 会静默丢弃对象值和字符串值的未知属性、且不产生警告，因此这一剔除没有可观测差异、也无法被单元测试区分；保留它是为了不把 `node` 透传到 DOM 的语义正确性，不宣称它是必需修复。
5. **样式根因**：Tailwind v4 preflight 会把 `a` 重置为 `color: inherit; text-decoration: inherit`，这是链接看起来与正文一样的直接原因。新增规则用 `.markdown-body a, .markdown-link` 双选择器（前者兜底 `.markdown-body` 下任何 anchor，后者是 `MarkdownLink` 的稳定样式钩子）：默认 `#2f6fb0` 加下划线；hover 变 `#1d4f86` + 背景 `#e9f0f9` + 加粗下划线；`:focus-visible` 在 hover 基础上加 `outline: 2px solid #4f8bc9`（`outline-offset: 1px`）；另加 `overflow-wrap: anywhere` 防止长 URL 溢出。
6. **测试位置**：与 `markdownPlugins.ts` 同目录的 `src/web/markdownLink.test.tsx`（`// @vitest-environment jsdom`，与本仓库既有前端测试写法一致）。

## 变更文件

| 文件 | 变更 |
| --- | --- |
| `src/web/markdownLink.tsx` | 新增。`MarkdownLink` renderer + `resolveRel`；默认 `target="_blank"`、强制安全 `rel`、追加 `markdown-link` class。 |
| `src/web/markdownLink.test.tsx` | 新增。7 项测试：4 项 renderer 行为（默认属性、调用方覆盖合并、剔除 `opener`、标准 props 透传且不透传 `node`）+ 3 项共享配置接线（assistant 正文路径、activity 路径、`markdownShared.components.a === MarkdownLink`）。 |
| `src/web/markdownPlugins.ts` | 增加 `components: { a: MarkdownLink }` 与对应注释。 |
| `src/web/styles.css` | 在 `.markdown-body pre code` 之后新增链接默认/hover/`:focus-visible` 规则。 |

未改动：`ChatView.tsx`、`server`、`shared/protocol`、其他任务文件、`docs/`。

## 验证与交接

环境说明：本 worktree 初始没有 `node_modules`，执行了 `npm ci --prefer-offline`（477 packages）。本机 Node 为 v25.9.0，`package.json` engines 要求 `^22 || ^24 || >=26`，npm 仅给出 `EBADENGINE` 警告；测试与构建均成功。jsdom 不加载 `styles.css`，视觉样式只能由浏览器验收。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 目标测试 | `npx vitest run src/web/markdownLink.test.tsx` | PASS（1 file / 7 tests） |
| 全量测试 | `npm test` | PASS（7 files / 28 tests；基线 21，新增 7） |
| 类型检查 | `npm run typecheck` | PASS |
| 构建 | `npm run build` | PASS（tsup server + vite web，`✓ built in 691ms`） |
| 可证伪检查 | 临时删除 `components: { a: MarkdownLink }` 后重跑目标测试 | 3 项接线测试 FAIL（3 failed / 4 passed），已还原；证明接线测试真的覆盖共享配置 |
| 构建产物核对 | `grep` `dist/web/assets/index-*.css` | PASS：`.markdown-body a,.markdown-link`、`:hover`、`:focus-visible` 三条规则均在产物中，且位置（offset 15084）晚于 preflight 的 `a{color:inherit`（offset 1828），特异性也更高，链接样式会生效 |
| 产物核对 | `grep -c markdown-link dist/web/assets/ChatView-*.js` | PASS（命中 1） |

未运行 / 未验证：

- **NOT RUN：真实浏览器验收**。hover/focus 视觉、键盘 Tab 聚焦、点击确实在新 tab 打开、`rel` 在真实 DOM 上的表现均未在浏览器中确认（jsdom 不应用 `styles.css`，也不产生新 tab）。需 Integrator 或用户在授权环境下做一次浏览器验收。
- **NOT RUN：真实 Pi/Herdr Pane 验收**（本任务不涉及，未操作任何真实 Pane）。
- **未查证**：深色背景（`pre`/code 块内）不会出现 Markdown 链接，因此未做深色分支；若后续出现深底链接需要另行确认对比度。

交接给 Integrator：

- 建议在集成后补一条 `docs/` 说明或索引条目（参照 `docs/latex-rendering-fix.md` 的形式），Worker 范围内未创建 `docs/` 文件。
- 本改动只触碰 `markdownPlugins.ts` 与 `styles.css`；若另一 Worker 也修改 `styles.css` 同区域需按 commit 冲突处理（本任务新增块位于 `.markdown-body pre code` 与 `.reasoning-block` 之间，未改动既有行）。
- 未合并、未 rebase、未 push `main`。
