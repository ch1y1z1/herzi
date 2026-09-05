# Herzi UI 调研与设计方向

> 日期：2026-09-03  
> 输入：用户提供的 Moshi Desktop Chat View 截图，以及公开组件库文档  
> 状态：推荐方案已形成；实际视觉细节在首个页面实现后迭代

## 1. 截图中的关键设计语言

用户提供的参考图不是传统“网页聊天机器人”，更接近原生桌面 coding workspace。最值得保留的是信息结构，而不是逐像素复制。

### 1.1 页面骨架

- 左侧约 280–340 px 的固定工作区导航。
- 中间是当前 pane 的唯一主视图。
- 主区顶部是 pane/session header，右上是 `Term / Chat` segmented control。
- 切换到 Herdr 已识别 agent 的 Pane 时默认显示 Chat；没有 agent 的普通终端默认显示 Term。用户仍可在当前 Pane 手动切换，且不会被状态刷新覆盖。
- Chat 内容独立滚动，composer 固定在底部。
- 右侧有一条窄工具 rail，可承载文件、diff、上下文等功能，但不属于 Herzi MVP。

### 1.2 Workspace 导航

- `WORKSPACES` 是一级概念，支持折叠。
- 每个 workspace 下把所有 Tab 的 Pane 平铺为单层列表，选中项有浅蓝背景。
- 行内只放最重要的状态：名称、agent icon、working/unread dot；不把完整 cwd/status 文本塞进树中。
- 左下角是当前 host/connection 与设置入口。

Herzi 的数据模型保留 Herdr 的真实层级，但侧栏不逐层渲染 Tab：

~~~text
Workspace（可折叠）
├── Pane（来自 Tab A）
├── Pane（来自 Tab B）
└── Pane（同样可来自 Tab B 的 split）
~~~

每一行严格对应一个 Pane ID，点击后主视图选择该 Pane。行内文字使用其所属 Herdr Tab 的 label；普通 Pane 使用 Terminal 图标，Pi 使用 `π` 标识，其他 agent 使用通用 agent 图标。同一 Tab 有多个 Pane 时允许 label 重复，由左侧环境图标区分，完整 pane title 与 ID 保留在 tooltip 中。这样默认的一 Tab/一 Pane 仍是一行，多 Pane 也不会重新引入第二层分组。

### 1.3 主区与模式切换

- `Terminal / Chat` 是同一 pane 的显示模式，不是导航到另一条 session。
- toggle 固定在 pane header 右侧；切换不创建、不 resume、不重启 Pi。
- 每个 pane 可以记住自己的最后使用模式。
- 没有准确 Pi transcript 时，Chat 选项置灰并通过 tooltip 说明；Terminal 始终可选。

### 1.4 Chat 信息层级

参考图刻意避免了大量彩色气泡：

- assistant 正文是页面级内容，基本无背景气泡，适合长代码、表格和技术说明。
- user 消息可以用很轻的浅色块或右侧窄气泡，但不应占满宽度。
- thinking 是弱化、斜体、可折叠的一行摘要。
- tool call 是带边框的横向卡片：icon、工具名、关键参数/路径、计数与状态；默认只展开当前运行或出错项。
- composer 是底部大圆角面板，发送与 stop 共用状态按钮。

这比通用社交聊天气泡更适合 coding agent。

## 2. 推荐 UI 栈

### 2.1 基础组件：shadcn/ui

推荐使用 **shadcn/ui + Tailwind CSS 4** 作为全局 UI 基础，而不是 MUI、Ant Design 或自建完整 design system。

适用组件：

- Sidebar、Collapsible、Scroll Area：Workspace/Tab/Pane 树；
- Toggle Group：`Terminal / Chat` segmented control；
- Tooltip、Dropdown Menu、Context Menu：pane 操作与能力说明；
- Dialog、Sheet：设置与移动端 sidebar；
- Button、Textarea、Badge、Separator、Skeleton：基础状态；
- CSS variables：统一 light/dark token。

选择理由：

- 组件源码进入项目，可以把外观改成参考图的原生桌面风格；
- 不会被 Material/企业后台视觉规范绑住；
- 与 Tailwind、assistant-ui 和 AI Elements 的生态一致；
- Sidebar 已内建 group、submenu、active、badge、collapsible 和 rail 等所需结构。

MUI 虽然完整，但官方定位是 Material Design，实现参考图需要覆盖较多默认视觉；Ant Design 更偏企业管理界面。它们适合快速做普通后台，不是本项目的首选外观基础。

### 2.2 Chat primitives：assistant-ui + External Store Runtime

推荐使用 **assistant-ui** 负责 Chat thread、message parts、composer、scroll、reasoning 和 tool fallback，但不让它拥有 Herzi 的 session 数据。

关键原因是其 `ExternalStoreRuntime` 明确面向“消息和持久化由应用自己拥有”的场景：Herzi 继续从 Pi JSONL/WebSocket 维护消息，adapter 只把 `HerziChatMessage` 转成 assistant-ui 的 message parts。

~~~text
Pi JSONL / live events
        ↓
Herzi chat store（权威）
        ↓ convert
assistant-ui ExternalStoreRuntime
        ↓
Thread / Message / Tool / Composer UI
~~~

这适合当前架构：

- 不要求改用 Vercel AI SDK 作为后端；
- 官方推荐 Next.js 或 Vite；
- UI 能力根据 callback 开启，不支持 edit/reload/branch action 时就不提供相应 callback；
- 可自定义 user/assistant message、ToolFallback、ToolGroup 和每个 tool 的 renderer；
- 后续 Pi live extension 可以逐步增加 streaming 状态，而不重写 Chat 页面。

第一版只使用：

- Thread/Conversation 滚动区；
- UserMessage、AssistantMessage；
- Composer；
- Markdown；
- Reasoning；
- ToolFallback/ToolGroup。

暂不使用 assistant cloud、模型 SDK、generative UI、attachments、voice、message editing 等功能。

#### 为什么它特别适合 Herzi

1. **状态所有权匹配**：Herzi 的消息来自 Pi JSONL、Herdr status 和可选 live extension，并不是由前端调用模型生成。External Store Runtime 允许传入自有 `messages`、`isRunning`、`onNew`、`onCancel` 和 `convertMessage`，不会要求改用它的后端。
2. **能力按 callback 开启**：Herzi 不提供 edit/reload/branch callback，相应动作就不会自动出现；这比先展示无效按钮再逐个禁用更合适。
3. **消息不是纯字符串**：其 message parts 原生区分 text、reasoning、tool-call、file/data 等内容，能把 Pi 的结构保留下来。
4. **样式可控**：assistant-ui 提供 primitives 和 shadcn registry，不是一个不可修改的完整聊天 iframe；可以做成参考图中“assistant 全宽正文、thinking 弱化、tool card 紧凑”的样式。
5. **现成功能集中在正确位置**：Thread 负责滚动，Composer 负责输入，Message parts 负责分发，Tool UI 负责状态，不需要 Herzi 重复实现一套相互耦合的 Chat 状态机。
6. **Vite 与许可合适**：官方推荐 Next.js 或 Vite；核心为 MIT，可以随项目分发和修改。

#### 现成的工具调用 UI

assistant-ui 确实有工具调用组件，不只是一个普通气泡：

- `ToolFallback`：未注册专用 renderer 时的通用卡片；可展示工具名、参数、结果、错误、cancel 和 approval 状态，并支持折叠。
- `ToolGroup` / grouped parts：把连续工具调用合并成紧凑区域，避免长会话被卡片淹没。
- Tool UI renderer：按工具名注册 React 组件，renderer 可以读取实时 args、result 和 status。
- `externalTool()`：工具在其他系统执行、assistant-ui 只负责渲染的模式，概念上符合 Pi/Herdr；Herzi 也可以更简单地直接把 tool-call part 交给 renderer。
- `onAddToolResult` 与 `toolCallId`：External Store 可以把结果更新到对应调用。
- Reasoning primitives：thinking/reasoning 可以单独折叠或和 tool steps 分组。

Herzi 第一版的映射关系建议为：

~~~text
Pi assistant content.toolCall
        ↓ toolCallId / toolName / arguments
assistant-ui tool-call part
        ↓
ToolFallback 或 read/edit/bash 专用 renderer

Pi toolResult
        ↓ 相同 toolCallId
更新 result / error / complete 状态
~~~

需要注意：UI 库不会自动理解 Pi JSONL。Herzi 仍需做一个小型 converter。没有 live extension 时，主要显示已完成的 tool call/result；加入 live extension 后再更新 running/streaming 状态。

External Store Runtime 的内建 client tool invocation tracker 默认不启用，这一点对 Herzi 是优点：Pi 已经在原 pane 中执行工具，浏览器只能渲染，绝不能再次执行同一个 tool。

#### 为什么不使用 assistant-ui 的 Pi adapter

assistant-ui 现在另有 `@assistant-ui/react-pi`。它的 Node 入口 `createPiNodeClient` 通过 Pi SDK 在进程内驱动 `AgentSession`，由 supervisor 拥有 thread，适合“应用创建和管理 Pi”的产品。

Herzi 的目标是连接 Herdr 中**已经运行**的 Pi，因此不能使用该 Node adapter 接管同一 session。首版只使用 `@assistant-ui/react` 的 External Store Runtime：

- Pi/PTY ownership 仍归 Herdr 中的原进程；
- Herzi 读取 JSONL/事件并转换消息；
- assistant-ui 只做显示、composer callback 和前端状态。

`@assistant-ui/react-pi` 当前版本仍很早，且其 ownership 模式与 MVP 不同，因此不能因为名字匹配就直接采用。

#### 采用它的代价

- 需要维护一个 `HerziChatMessage → ThreadMessageLike` converter。
- assistant-ui 发展较快，部分旧的 components API 已被 grouped parts/toolkit 取代；实现时应锁定 npm 版本，不追随 latest 自动升级。
- Pi branch/compaction 与通用 Chat thread 并非完全同构；首版只映射当前可见消息，不让 UI runtime 替 Herzi 决定 session 语义。
- 如果 P2 的真实 session 接入在半天内仍需要大量绕过 runtime，应该退回 shadcn + 自有 message list，而不是继续堆 adapter。

### 2.3 Terminal：xterm.js，不使用“伪终端输出卡片”

原始 Terminal View 必须使用 **xterm.js 6**。它是浏览器终端模拟器，能处理光标、alternate screen、ANSI sequence、宽字符和交互输入。

AI Elements 中名为 Terminal 的组件主要用于在 Chat 中展示命令输出，不是完整的交互式终端模拟器，不能替代 xterm.js。两者可以并存：

- 主 Terminal View：xterm.js；
- Chat 中某个 bash tool 的折叠输出：普通 Tool card/Code block。

### 2.4 Markdown、代码和 diff

- Markdown：优先使用 `@assistant-ui/react-markdown` + `remark-gfm`，统一接入 message part。
- 代码高亮：初期使用 Markdown renderer 自带能力；需要更好体验时引入 Shiki。
- diff：首版只用 fenced code/文本展示。只有 Pi 数据能稳定提供结构化 patch 且用户确实需要行级 diff 时，再评估 `@pierre/diffs`。
- 图标：`lucide-react`，避免混用多套 icon 风格。

这符合“功能优先”：不为可能出现的 diff/文件预览提前引入体积和数据转换工作。

### 2.5 AI Elements：作为组件参考，不整 wholesale 接入

Vercel AI Elements 提供 Message、Conversation、Prompt Input、Reasoning、Tool、Plan、Task、Code Block 等组件，视觉和参考图很接近，而且组件源码会进入项目，Apache-2.0 许可清晰。

但其官方前置条件与示例明显偏向 Next.js + AI SDK + React 19 + Tailwind 4；Tool 组件也直接使用 AI SDK 的 `ToolUIPart`。Herzi 是 Vite + 自有 WebSocket + Pi JSONL，直接整体接入会引入不必要的数据类型与 runtime 依赖。

因此建议：

- 第一版使用 assistant-ui 的 external-store 路线；
- 把 AI Elements 当成交互与视觉参考；
- 如果某个独立组件明显更好，例如 Tool/Reasoning/PromptInput，可依据 Apache-2.0 单独引入源码并改成 Herzi 类型；
- 不同时维护两套完整 Chat runtime。

## 3. 推荐页面结构

~~~text
┌──────────────────────────────────────────────────────────────┐
│ Sidebar           │ Pane title / agent / cwd       Term Chat │
│                    ├───────────────────────────────────────────┤
│ WORKSPACES         │                                           │
│ ▾ workspace-a      │       TerminalView (xterm.js)             │
│   π tab-main       │                    or                     │
│   ▣ tab-main       │       ChatView (assistant-ui)              │
│   ▣ tab-review     │                                           │
│ ▸ workspace-b      │                                           │
│                    ├───────────────────────────────────────────┤
│ host · connected   │ Composer / Stop                            │
└──────────────────────────────────────────────────────────────┘
~~~

### 3.1 Sidebar

- 宽度首版固定为 300 px；之后再加拖拽 resize。
- Workspace 使用 Collapsible；内部把各 Tab 的 Pane 平铺为单层列表。
- 每行只显示所属 Tab label，不显示第二行；左侧图标表达 Pi、其他 agent 或 Terminal，完整 Pane 信息通过 tooltip 提供。
- 点击行直接选择该 Pane ID；同一 Tab 有多个 Pane 时，每个 Pane 都有独立行和选中态。
- working 使用蓝色动点，blocked 使用琥珀色，disconnected 使用灰色；避免满屏 badge。
- 选中状态用浅蓝/灰蓝背景，与截图一致。
- 底部显示当前 host、Herdr 连接状态和 settings；MVP 只有 localhost，也保留这个位置以便未来远程 host。

### 3.2 Pane Header

左侧：

- pane icon 与标题；
- 第二行显示 Pi/model（能可靠取得时）、cwd basename 与 working 状态；
- 不具备 token/context 数据时不显示虚构进度百分比。

右侧：

- `Terminal / Chat` segmented toggle；
- 可选全屏按钮；
- 更多菜单放 rename、copy pane id、open original terminal 等低频动作。

### 3.3 Chat View

建议统一的 UI block 模型：

| Pi 内容 | UI |
| --- | --- |
| user text | 轻量 user message block |
| assistant text | 无大气泡的 Markdown 文档流 |
| thinking | 默认折叠的 muted reasoning row |
| tool call running | 带 spinner/蓝点的 tool card |
| tool success | 紧凑一行 + check，可展开 input/output |
| tool error | 红色状态与默认展开错误摘要 |
| unknown tool | 通用 ToolFallback，显示名称与 JSON/文本 |
| compaction/branch | 首版弱化为系统 marker，复杂交互后置 |

工具专用 renderer 按真实需求渐进添加：

- `read`：文件路径、行范围、展开内容；
- `write/edit`：文件路径与简要变更，结构化 diff 后置；
- `bash`：命令、exit status、折叠输出；
- web/search/fetch：域名、URL、结果计数；
- 其他：ToolFallback。

### 3.4 Composer

- 固定在 Chat 主区底部，不跟历史滚走。
- 圆角面板、自动增高 textarea、Enter 发送、Shift+Enter 换行。
- working 时发送按钮变为 stop；是否允许 follow-up 由 Herdr/Pi capability 决定。
- 首版不做 attachment、voice、model picker；这些不属于已有 pane 的基础连接目标。

## 4. 视觉 token 建议

- 字体：系统 sans；代码/路径使用系统 monospace。
- 正文 14–15 px，metadata 12 px，pane title 14 px medium。
- 4/8 px spacing grid；header 60–64 px；sidebar row 32–36 px。
- border 使用低对比中性灰；主 accent 使用克制的蓝色。
- tool card radius 10–12 px；composer radius 20–24 px；不让所有文本都进入卡片。
- 首版优先 light theme，但所有颜色从 CSS variables 读取，dark theme 后续可以低成本加入。
- 动画只用于折叠、working indicator 和模式切换，避免持续 shimmer 干扰阅读。

## 5. 组件库比较

| 方案 | 优点 | 不足 | 结论 |
| --- | --- | --- | --- |
| shadcn/ui | 源码可控、样式自由、Sidebar/Toggle 等齐全 | 需要自己组合产品页面 | 采用，作为基础 UI |
| assistant-ui | Vite、external store、Chat primitives、tool/branch/streaming | 增加一层 message adapter/runtime | 采用，但只用所需子集 |
| AI Elements | coding/AI 组件丰富，Tool/Reasoning/Plan 很贴近目标 | 默认绑定 Next/AI SDK 类型和范式 | 视觉参考，按需单组件引入 |
| CopilotKit | CopilotChat、AG-UI、tool rendering、reasoning、HITL 和 generative UI 完整 | 更像全栈 agent frontend/runtime，会扩大 Herzi 协议和后端范围 | 不用于 MVP |
| LlamaIndex Chat UI | shadcn 风格、ChatSection/Message/Input 可组合 | 示例/handler 以 AI SDK `useChat` 为中心，外部 Pi 状态适配不如 External Store 明确 | 不采用 |
| Chatscope Chat UI Kit | MessageList、MessageInput、Conversation、Sidebar 等普通聊天组件成熟 | 面向通用人际聊天，没有一等 reasoning/tool-call/result 语义 | 不采用 |
| NLUX | React/原生 JS、LLM adapter 接入简单 | 更偏完整 AiChat/LLM adapter，coding tool UI 生态弱于 assistant-ui | 不采用 |
| MUI | 组件最完整、成熟 | Material 视觉较强，定制到截图风格成本高 | 不采用 |
| Ant Design | Layout/Menu/Segmented 开箱即用 | 企业后台风格明显，Chat primitives 弱 | 不采用 |
| 全部自研 | 数据模型最直接 | composer、scroll、stream、tool 状态会逐步重复造轮子 | 不作为默认方案 |

## 6. 风险与快速验证

主要风险只有一个：assistant-ui adapter 是否能自然表达 Pi 的 message/tool parts，而不迫使 Herzi 改变数据模型。

解决方式不是建设大型测试，而是在 P2 开始时用半天完成一个真实 session 的最小接入：

1. 把已读取的 user/assistant/tool 三类消息转换给 External Store Runtime。
2. 验证 Thread、滚动、Markdown、ToolFallback 和 Composer callback。
3. 如果半天内出现明显模型冲突，立即退回 shadcn + 自有 message list；基础 UI 和数据层均不受影响。

## 7. 最终推荐

第一版采用：

**React 19 + Vite + Tailwind CSS 4 + shadcn/ui + assistant-ui External Store Runtime + xterm.js + lucide-react。**

其边界是：

- shadcn/ui 管应用壳、sidebar、toggle、dialog、tooltip；
- assistant-ui 管 Chat thread/message/composer/tool rendering；
- xterm.js 独占真实 Terminal View；
- Herzi 自己的 store 与 adapter 永远拥有 Herdr/Pi 数据；
- AI Elements 只作为 Tool/Reasoning/Prompt Input 的视觉与源码参考。

这套组合能够较快做出参考图的结构和质感，同时不会把后端改造成另一个 AI SDK runtime。

## 8. 一手来源

所有链接访问日期均为 2026-09-03。

- shadcn/ui Sidebar：<https://ui.shadcn.com/docs/components/base/sidebar>
- shadcn/ui 官方仓库与 MIT 许可：<https://github.com/shadcn-ui/ui>
- assistant-ui 安装（支持 Vite、shadcn registry）：<https://www.assistant-ui.com/docs/installation>
- assistant-ui External Store Runtime：<https://www.assistant-ui.com/docs/runtimes/custom/external-store>
- assistant-ui Message primitives：<https://www.assistant-ui.com/docs/primitives/message>
- assistant-ui Tool UI：<https://www.assistant-ui.com/docs/tools/tool-ui>
- assistant-ui ToolFallback：<https://www.assistant-ui.com/docs/ui/tool-fallback>
- assistant-ui render-only external tools：<https://www.assistant-ui.com/docs/tools/defining-tools>
- assistant-ui 官方仓库与 MIT 许可：<https://github.com/assistant-ui/assistant-ui>
- assistant-ui Pi adapter 的 ownership 说明：<https://www.npmjs.com/package/@assistant-ui/react-pi>
- AI Elements 介绍与前置条件：<https://elements.ai-sdk.dev/docs>
- AI Elements Message：<https://elements.ai-sdk.dev/components/message>
- AI Elements Tool：<https://elements.ai-sdk.dev/components/tool>
- AI Elements Reasoning：<https://elements.ai-sdk.dev/components/reasoning>
- AI Elements Prompt Input：<https://elements.ai-sdk.dev/components/prompt-input>
- AI Elements IDE 示例：<https://elements.ai-sdk.dev/examples/ide>
- AI Elements Apache-2.0 许可：<https://github.com/vercel/ai-elements/blob/main/LICENSE>
- xterm.js 6 文档：<https://xtermjs.org/docs/>
- xterm.js 官方仓库与 MIT 许可：<https://github.com/xtermjs/xterm.js/>
- Material UI 定位：<https://mui.com/material-ui/getting-started/>
- Ant Design Layout：<https://ant.design/components/layout/>
- CopilotKit Generative UI：<https://docs.copilotkit.ai/concepts/generative-ui-overview>
- LlamaIndex Chat UI：<https://ui.llamaindex.ai/>
- Chatscope Chat UI Kit：<https://chatscope.io/docs/>
- NLUX 官方仓库：<https://github.com/nlkitai/nlux>
