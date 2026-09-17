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
- 2026-09-17 用户进一步报告：“即使展开了 work 组，assistant 文本也完全不显示”。
- 先用合成数据排查：构造 `user → assistant[thinking, tool, text(MIDTURN), tool, text(FINAL)]`，渲染后展开 work 组并导出 DOM。结果：组内 `.activity-message` 正常渲染 `MIDTURN TEXT`，组外 `FINAL ANSWER` 也正常。**渲染路径与 CSS 均无问题，合成数据无法复现。**
- 静态核查了三个可能丢失点：`pi-session-reader.ts` 的 `convertContent` 对未知 part 返回空数组、`:161` 对空内容整条丢弃、assistant-ui 对空白 text part 丢弃。对照 `pi-ai` 类型定义，Pi 的 content part 只有 `text/thinking/image/toolCall` 四种，与 reader 一致，**不存在漏类型**。
- 经用户授权（方案 A），对当前 Pane 的真实 session JSONL 做**只读、无正文**分析（只统计 entry 类型、part 类型序列与文本长度，不输出任何正文）：
  - 文件 5.9 MB / 1034 行；1028 条 `message`，其中 assistant 448、toolResult 551、user 29。
  - assistant part 序列以 `toolCall`、`thinking,toolCall` 为主；`text` 单独出现 11 次、`thinking,text` 10 次。
  - 14 条 assistant 消息 part 为空，全部是 `stopReason: error/aborted` 且 `content: []`，属正常空消息。
  - text part 长度均为 415–7039 字符，无空白垃圾。
  - 按 reader + `combineAssistantTurn` 的规则复算当前分支：466 条消息、29 个 turn；**组内包含 text 的 turn 只有 1 个**；组内 part 合计 `tool-call 555 / reasoning 272 / text 1`。
- **结论（已定位，不是渲染 bug）**：真实 Pi 数据里 assistant 文本几乎总是 turn 的最后一段（单独的 `assistant` 消息，形如 `thinking+text`），而现有分组规则把“最后一个非空 text/image 之前的一切”收进一个 `Worked for` 组。于是文本被当成“最终输出”留在组外，组内只剩 Thinking / Tool 行——展开组自然看不到任何文本。
- 这是**设计差异而非缺陷**：参考产品（根据此前拿到的部分图像描述：`已思考 5 秒 ▸` / 正文 / `已运行 2 条命令 ▸` / 正文 / `抓取 easytier.cn ▸` / 正文）把文本保留在流中、只折叠过程行；本产品则把过程全部包进一个总组。
- 待用户确认分组模型后再动代码（候选：A 按原序、每段各自折叠；B 保留 `Worked for` 但文本切断分组，形成多段）。

### 结论（用户已确认，2026-09-17）

- 用户澄清需求：保留**一个** `Worked for` 组不变，只是希望组内能看到 agent 在工作阶段陆续吐出的 assistant 文本（作为进度摘要）。
- 用户最终确认：**这不是 Herzi 的代码问题，而是数据侧现象**。
- 精确表述：
  1. 若 agent 真的在 turn 中间输出文本，现有代码**已经**会把它显示在组内（`ActivityItemRow` 的 message 分支，完整 Markdown）。已用真实模块 + 合成数据验证过（组内 `.activity-message` 正常渲染）。
  2. 运行中（`running === true`）根本不创建组，所有 part 按原序内联，中途文本实时可见；只有 turn 完成后才收进组。
  3. 组内看不到文本的原因是真实 Pi 数据里正文几乎只出现在 turn 末尾（29 个 turn 中仅 1 个在末尾正文之前还有正文），于是被当成“最终输出”留在组外。
- 因此：不改分组规则、不改渲染。当前 `Worked for` 组内已具备展示中间文本的能力，缺的是 agent 在过程中输出文本这一行为。
- 可选后续项（均需用户单独决定，未实施）：
  1. 让 agent 侧养成“长任务每完成一阶段先输出一句简短进度摘要”的习惯（属 agent 约定/`AGENTS.md` 层面，不是 Herzi 代码）；
  2. Herzi 侧：把组内 Thinking 行预览改为多行；或在 `Worked for` 折叠行上显示该 turn 最后一段正文的摘要，使折叠时也有摘要可读；
  3. 维持现状。

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
