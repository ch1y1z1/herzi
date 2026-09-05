# Chat activity 折叠与运行状态

> 日期：2026-09-03  
> 状态：已实现并完成本地浏览器验证

## 需求来源

本轮以用户提供的 Codex macOS 客户端截图为直接交互参考，目标不是逐像素复制，而是复用其中适合 coding-agent Chat 的信息层级：

1. 一个 user prompt 到下一次 user prompt 之间视为一次 turn。
2. turn 完成后显示 `Worked for <duration>`，默认收起最终正文之前的全部 assistant 输出，包括普通消息、thinking、图片和工具调用。
3. 展开后，普通消息完整显示并保留 Markdown；每个 thinking / tool 只在首行展示简短摘要和省略号，仍可继续点开查看完整 reasoning、arguments 和 result。
4. 进行中的连续工具调用合并为 `Ran N tools`，避免多个工具卡片占满屏幕。
5. agent 仍在执行时，在当前消息末尾显示 `working`；存在 Pi waiting 状态时显示 `waiting`，右侧始终使用旋转图标表示尚未 settled。
6. `Worked for` 展开后按内容自然增高，不设置内部最大高度、分页或纵向滚动；滚动统一交给外层 Chat 页面。

## 资料核对与边界

OpenAI 公开的 Responses API 资料说明 response 有 `created_at`，完成后有 `completed_at`，而输出项按数组顺序返回。这支持“用开始/完成时间计算 elapsed，并按原始顺序划分 activity 与正文”的通用数据模型：

- <https://developers.openai.com/api/reference/cli/resources/responses/methods/create>（访问：2026-09-03）

没有找到公开的一手资料解释 Codex macOS 客户端内部如何生成 `Worked for`、如何为多次工具调用命名，或它的确切折叠阈值。因此当前规则是根据用户截图与 Herzi/Pi 数据能力作出的产品实现，不宣称复刻 Codex 私有算法。

## Herzi 的判定规则

### Turn 边界

- 遇到 user message 开始新 turn。
- 其后的连续 assistant messages 合并为同一 display message，直到下一个 user message。
- Pi 的 `toolResult` 已在服务端按 `toolCallId` 合并回相应 tool call，不作为独立可见 message。

### 最终正文与折叠区

- 在完成 turn 中，从后向前寻找最后一个非空 text 或 image part，把它作为“最后输出”边界。
- 边界之前的 text、image、reasoning 与 tool-call 全部收入一个 `data-activity` part，由 assistant-ui 的 data renderer 显示为 `Worked for …`。
- activity 默认使用关闭的原生 `details`，保证首屏只保留摘要；用户展开后可查看逐项记录。
- activity 中的普通文本不做单行截断：展开总折叠区后，以与最终回答一致的 Markdown 样式完整显示；图片也保留在 activity 流中。
- 只有最后一个非空 text/image part 留在 `Worked for` 外部，作为最终回答。
- 如果完成 turn 没有 activity，仍显示只读的 `Worked for …` 行，但不会出现空折叠面板。

### 连续工具调用

- `Worked for` 内部的相邻 tool-call 数量大于 1 时，再合并成默认关闭的第二层 `Ran N tools` 折叠组；展开内层后才显示每个工具的摘要与详情入口。
- 运行态或其他没有进入完成态总 activity 的相邻 tool-call，同样使用 `Ran N tools` 分组。
- 单个 tool-call 保持单行显示，避免为了“分组”增加一次无意义点击。
- 工具摘要优先取 `path/file/command/cmd/query/q/url/pattern/description` 等常见参数；其余参数压成单行 JSON。

### 耗时

- 起点优先使用本 turn 的 user message timestamp；缺失时使用首条 assistant timestamp。
- 持久 JSONL 的 assistant 完成时间使用对应 entry timestamp；Pi message timestamp 继续作为开始时间。
- companion extension 收到 `message_end` 时直接记录 `Date.now()` 为 `completedAt`。
- 显示精度为秒：`<1s`、`18s`、`4m 2s` 或 `1h 3m`。这是 wall-clock elapsed，不代表纯模型推理耗时。

## 实现位置

- `src/shared/protocol.ts`：为 Chat message 增加可选 `completedAt`。
- `src/server/pi-session-reader.ts`：从 Pi JSONL entry timestamp 投影完成时间。
- `integrations/pi/extensions/herzi-bridge.ts`：实时完成消息上报 `completedAt`。
- `src/web/components/ChatView.tsx`：turn 合并、最终输出边界、activity data part、连续工具分组、摘要和 running row。
- `src/web/styles.css`：Codex 风格的轻量单行 activity、默认折叠、展开列表和底部状态条。

## Markdown 主题

- assistant 正文与 activity 中的普通消息共用同一套 `.markdown-body` 主题。
- GFM table 使用完整宽度、独立边框、浅色表头、单元格分隔线、斑马纹和长内容自动换行。
- 行内 code 使用浅绿色底、绿色文字和细边框；fenced code block 继续使用深色主题，不继承行内 code 颜色。
- activity list 不再设置 `max-height` 或 `overflow-y`，展开时一次性展示全部过程内容。

## 验证记录

- `npm run build` 通过：TypeScript、server bundle、Vite production bundle 全部成功。
- 生产服务重启后，Chat API 的历史 assistant message 已返回 `completedAt`。
- 在真实、既有的 Pi session 上只读验证；没有发送 prompt、停止 agent 或修改会话：
  - 已完成会话出现 3 个 `Worked for` 组，三个 `details` 的 `open` 属性初始均为空缺，即默认关闭。
  - 展开第一个组后，可见普通 assistant 消息、Thinking 与 tool；普通消息完整渲染，Thinking/tool 使用单行摘要，详情仍保留在二级展开区域。
  - 在另一条已完成的真实 turn 中确认折叠区内含 3 条普通 assistant 消息：关闭时均不可见，展开后出现在 `Worked for` 内；最终正文仍位于折叠区外并正常渲染 Markdown。
  - 正在工作的 Pane 中，相邻工具显示 `Ran 2 tools` / `Ran 3 tools`；Thinking 和单工具均为一行省略摘要。
  - 消息末尾显示 `working` 和旋转图标，位于 composer 上方。
- Markdown 样式修正后，在既有真实会话中识别并检查 2 个 GFM table 和 16 个段落内 code；表格和行内代码均应用新主题。
- 展开真实 `Worked for` 后，activity list 的 `clientHeight` 与 `scrollHeight` 同为 1303px，计算样式为 `max-height: none`、`overflow-y: visible`，确认没有内部纵向滚动容器。
- 恢复内层工具分组后，在真实完成会话的首个 `Worked for` 内识别到 8 个 `Ran N tools` 组，初始均关闭；展开首组后显示 5 个具体 tool item。外层 activity list 的 `clientHeight` 与 `scrollHeight` 同为 710px，仍无内部滚动。
- 未把验证过程中看到的真实 session 正文写入项目文档。

## 已知限制

- JSONL entry timestamp 是当前 Pi 持久层可获得的最接近完成时刻的数据；它可能包含极小的落盘延迟。
- bridge 尚未全局安装时，运行中消息仍由 JSONL 轮询提供，只有已经写入文件的 activity 才可见；状态仍可来自 Herdr snapshot。
- activity 的自然语言摘要目前是确定性的本地截断，不另发模型请求；这样延迟低、无额外成本，也不会把工具参数发送到第三方。
