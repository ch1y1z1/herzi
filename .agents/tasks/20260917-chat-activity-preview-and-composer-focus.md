# Chat activity 预览形态与 composer 自动聚焦

- 状态：诊断完成；自动聚焦待实施，预览形态待用户确认设计。
- 目标：
  1. 让 Chat 中 thinking / 工具调用的折叠行按参考产品的方式展示部分文字信息；
  2. 修复在 Terminal 中启动 `pi` 自动切到 Chat 后，输入框未获得焦点的问题。
- 修改范围（预计）：`src/web/components/ChatView.tsx`、`src/web/styles.css`；如改 thinking 渲染还需复用 `markdownShared`。
- Base：`main`（`8982a59`）。

## 问题 1：activity 预览形态

**当前实现（已核实代码）**

- 思考折叠行（`ChatView.tsx` `ReasoningPart`）：`<summary>` 内是 大脑图标 + `Thinking` + `<span class="activity-preview">{shortPreview(text)}</span>` + 箭头。
  - `shortPreview()`：把整段文本的空白折成单个空格、trim、超过 92 字符截断、去掉结尾标点后追加 `…`。
  - 展开后是 `<div class="reasoning-detail">{text}</div>`：**纯文本**（`white-space: pre-wrap`），不走 Markdown。
- 工具调用折叠行（`ToolFallback` / `ActivityItemRow` 的 tool 分支）：工具图标 + 工具名 + `<span class="activity-preview">{toolPreview(args)}</span>` + 状态图标 + 箭头。
  - `toolPreview()`：只在 `path / file / command / cmd / query / q / url / pattern / description` 中取第一个命中的键值，同样经 `shortPreview` 截断到 92 字符。
  - 展开后是 `ToolData("Arguments")` + `ToolResultData`，各自渲染完整 JSON/文本。
- `Worked for` 分组行（`ActivityGroup`）：`Worked for X` + `toolGroupPreview()`（只拼工具名，最多 72 字符）；组内每行仍复用上面的 reasoning/tool 行。
- 样式（`styles.css`）：`.activity-preview` 为 `flex: 1`、`overflow: hidden`、`text-overflow: ellipsis`、`white-space: nowrap`、颜色 `#a0a49c`，字号继承 12px。

**结论**：本项目**已经有单行截断预览**，但形态固定为「单行 + 省略号 + 灰色小字」，且 thinking 展开后不是 Markdown。

**待确认**：参考产品（图二）的形态差异。用户提供的两张截图在本次会话中三次读取均失败（vision 后端返回 "servers are currently overloaded"），因此不能凭截图判断，改为用带 ASCII 预览的选项让用户确认。

## 问题 2：composer 自动聚焦

**根因（已核实代码）**

- `src/web/App.tsx` 用条件渲染切换视图：`mode === "terminal" ? <TerminalView/> : <ChatView key={pane.id}/>`。因此从 Terminal 切到 Chat 时 `ChatView` 是全新挂载。
- `TerminalView` 在挂载时会调用 `terminal.focus()`；`ChatView` 没有对应逻辑。
- `ChatView` 的 `<ComposerPrimitive.Input>`（`ChatView.tsx:785`）没有传 `autoFocus`。
- assistant-ui 的 `ComposerInput` 支持 `autoFocus`（默认 `false`），实现为 `useEffect(() => focus(), [focus])`，聚焦后把光标放到末尾（`node_modules/@assistant-ui/react/src/primitives/composer/ComposerInput.tsx:154,312-321`）。

**结论**：根因是缺少 `autoFocus`，不是事件或时序问题。

**建议修复**：在 `ComposerPrimitive.Input` 上显式启用 `autoFocus`。因为 ChatView 只在切到 Chat 时挂载，这一改动等价于“进入 Chat 视图即聚焦输入框”，不会在 Terminal 使用过程中抢焦点。需要验证的副作用：

- 首次打开页面（默认选中 agent Pane 进入 Chat）也会聚焦——预期行为，但需确认可接受；
- 切换 Pane 重新挂载时会聚焦；
- 输入框在 `isDisabled` 时 assistant-ui 内部不会聚焦（`autoFocus && !isDisabled`），非 Pi Pane 不受影响。

## 过程与决策

- 2026-09-17：用户报告两个问题并附两张截图；截图在本地可读取（1755×640、1599×985 PNG），但 vision 处理连续失败（两次尝试均返回 `servers are currently overloaded`），未据此下结论。
- 首次回复时未向用户说明图像读取失败，而是直接抛出设计选项，属沟通错误；已向用户澄清并停止对形态做推测。用户要求先单独修掉自动聚焦。
- 问题 2 实施：`ChatView.tsx` 的 `ComposerPrimitive.Input` 启用 `autoFocus`，并注明“ChatView 仅在 Chat 视图可见时挂载”这一前提。
- 同时补两条回归测试（`ChatView.test.tsx` 的 `ChatView composer focus`）：挂载后即聚焦；Pane 切换重挂载后仍聚焦。

## 验证与交接

- 目标测试：`npx vitest run src/web/components/ChatView.test.tsx` → PASS（8/8，含 2 条新用例）。
- 可证伪检查：临时移除 `autoFocus` 后重跑，两条新用例 FAIL（`expected <body> to be <textarea name="input">`），已还原；证明测试确实覆盖该行为。
- `npm run typecheck` → PASS。
- `npm test` → PASS（11 files / 62 tests，基线 60）。
- `npm run build` → PASS（仅既有 chunk size warning）。
- `NOT RUN`：真实浏览器中“在 Terminal 启动 pi → 自动切 Chat → 输入框聚焦”的端到端验收；未运行 `npm run dev`，未操作真实 Pane。
- 待确认的副作用：首次打开页面（默认进入 agent Pane 的 Chat）也会自动聚焦。
- 问题 1（activity 预览形态）仍未实施，阻塞于参考截图无法解析：需要用户重新粘贴图片、告知图二来源产品，或用文字描述差异。
- 未 push。
