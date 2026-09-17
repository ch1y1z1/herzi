# Agent 过程展示实现参考：Memoh

> 调研日期：2026-09-17（UTC+08:00）
> 目的：为「Chat 中 thinking / 工具调用 / 正文如何共同展示」提供一份可核对的一手实现参考
> 来源：<https://github.com/memohai/Memoh>，`main` 分支 commit `1aaef83`
> 方式：`git clone --depth 1` 到仓库外临时目录后只读阅读代码，未复制任何代码
> 许可：**AGPL-3.0**。因此本文件只记录设计思路与行为，**不得**把其源码逐段移植进 Herzi

## 1. 为什么看它

用户期望的效果是：`Worked for` 这类过程折叠块中能看到 agent 工作阶段陆续产出的正文，而不是只有 Thinking / 工具行。Herzi 现有实现（`ChatView.tsx` 的 `combineAssistantTurn`）把整轮过程合并成一个 `Worked for` 组，正文被判定为「最终输出」后留在组外，组内因此没有正文。Memoh 采取的是另一种模型，值得对照。

## 2. Memoh 的过程展示模型

主要文件（均在 `apps/web/src/pages/home/components/`）：

| 文件 | 作用 |
| --- | --- |
| `message-item.vue`（974 行） | 把一轮 assistant 的块列表编译成渲染节点；过程分组规则就在这里 |
| `thinking-block.vue` | 单个 reasoning 行与展开内容 |
| `tool-call-group.vue` | 连续 `tool` / `reasoning` 组成的进程段（组头 + 卡片体） |
| `process-collapse.ts` | 展开/收起状态，按稳定块签名持久 |
| `reasoning-timing.ts` | 客户端测量 reasoning 时长 |
| `live-peek-line.vue` | 流式期间的一行实时预览 |
| `i18n/locales/{zh,en}.json` | 文案（`chat.process.*`） |

### 2.1 分组规则（核心）

`message-item.vue` 的 `renderNodes`（约 `:884-911`）：

```js
// Consecutive tools and reasoning form one process, regardless of tool kind.
// Text, errors, attachments and completed questions retain their own positions.
if (block.type === 'tool' || block.type === 'reasoning') {
  // 追加到当前进程段
} else {
  run = null            // 文本（及错误、附件、已完成的问答）结束当前段
  nodes.push(block)     // 并按原位置单独渲染
}
```

由此得到的行为：

1. **只有 `tool` 与 `reasoning` 会进入过程折叠段**；
2. **正文永远不会被吞**，它保持原有位置，并且**会切断进程段**——于是自然形成「进程段 → 正文 → 进程段 → 正文」的交替结构；
3. **没有整轮级别的总外壳**（不存在 Herzi 那样一个覆盖全轮的 `Worked for`）；
4. 单条的 reasoning 或单个 tool **不套组头**，直接渲染成一行；
5. 已完成的 `ask_user` 视为内容而非过程，会从工具组中分离出来单独成卡片。

### 2.2 文案与时长

`thinking-block.vue` 的 `label`：

- 流式中：`chat.thinkingInProgress`（中：`正在思考如何处理`）；
- 有服务端持久化时长且 ≥ 1s：`已思考 {seconds} 秒`；
- 其它情况：`思考了几秒`。

源码注释专门解释了这层判断：**不足 1 秒说明 provider 把 reasoning 一次性缓冲返回，测得的区间是交付时间而非思考时间，把它凑成「1 秒」会夸大**。

多工具段的组头是**两段式**（`tool-call-group.vue`）：动词（阶段）+ 计数细节。

- 动词随时态变化：`运行中` / `已运行`、`探索中` / `已探索`、`修改中` / `已修改` …… 仅**动词**参与 shimmer 动画，计数不参与（注释：整行都闪会变成噪声，丢掉「阶段 vs 进度」的对比）；
- 细节是纯计数：`3 条命令`、`4 次搜索`、`12 次文件操作`，按固定顺序拼接；
- 分桶：`browse / edit / run / message / schedule / media / agent / gui / other`；
- GUI 段不用计数，改为显示目的地：`浏览了 example.com` 或 `浏览了 N 个网站`；
- 单个工具不套动词，因为它自己的标签（`Run ls /tmp`）已经足够具体，再加动词会重复。

### 2.3 流式期间的实时预览

`live-peek-line.vue`：

- 折叠状态下在组头下方显示一行 `now-line`，实时展示最新一行输出；
- **按 240ms 节流采样**，不追每个 token（注释：追 token 流会让人疲劳）；
- 只有出现「新的一行」时才重放淡入动画；当前行继续增长不算新行，所以不会每个 token 闪一次；
- 尊重 `prefers-reduced-motion`。

### 2.4 展开状态与重挂载

`process-collapse.ts`：

- 展开状态存在一个 session 级 `Map`（上限 2048，LRU），键是 `(messageId + 后端块 id)` 的稳定签名；
- 动机写在注释里：**一轮结束后组件会被重新抓取并重挂载，如果不持久化，用户流式期间展开的块会在结束时被弹回收起**（"I opened it, then the turn ended and it snapped shut"）；
- 语义是**纯用户驱动**：流式开始不自动展开，turn 结束也不自动收起。

### 2.5 正文渲染与滚动

- 正文用 markstream 的 Markdown 渲染，`mode="chat"`（面向消息流调参：32/48/6ms 批量、不做 live-node 虚拟化上限），流式时启用 typewriter / fade / 批量渲染；
- 正文外层是 prose 排版（`prose prose-sm dark:prose-invert`）；
- **折叠卡片内部明确不加滚动条**（注释：过程体必须跟随主聊天滚动，不能让滚轮被锁在卡片里）；只有单个工具的大块内容（diff、文件内容、命令输出）保留自己的小滚动边界。

## 3. 与 Herzi 现状的对照

| 维度 | Memoh | Herzi 现状 |
| --- | --- | --- |
| 进入折叠组的内容 | 仅 `tool` + `reasoning` | `tool` + `reasoning` + `text` + `image` 全部 |
| 正文位置 | 永远在原位置，且会切断进程段 | 除「最后一个非空 text/image」外全部被吸入组内；最后一段留在组外 |
| 组的外壳 | 每个连续段各自一个，无整轮总外壳 | 整轮只有一个 `Worked for Xs` |
| 时长 | 每个 reasoning 块各自「已思考 N 秒」 | 仅整轮一个总时长 |
| 组头文案 | 动词（时态随流式）+ 计数细节 | `Worked for Xs` / `Ran N tools` + 单行截断预览 |
| 单条 reasoning / 单个 tool | 不套组头，直接一行 | 组内也是一行，但被总组包住 |
| 流式实时预览 | 专门的 `now-line`（240ms 节流） | 无（依赖消息级 working 指示） |
| 展开状态 | 按稳定块 id 持久，turn 结束重挂载不丢 | 原生 `<details>`，重挂载即重置 |
| 卡片内滚动 | 明确不加内部滚动 | 工具详情 `pre` 有 `max-height: 320px` 内部滚动 |

## 4. 对 Herzi 的结论

1. Herzi「组内看不到正文」的根因不是渲染缺陷，而是**分组模型不同**：Memoh 把正文排除在过程组之外并让正文切断分组，所以它的过程组本来也不需要包含正文；Herzi 则把整轮合并成一个组，正文被移到组外，组内自然没有正文可显示。
2. 若要以 Memoh 的方式对齐用户期望，需要改的是**分组规则与组头语义**，而不是渲染层：
   - `combineAssistantTurn` 只合并连续的 `reasoning` / `tool-call` 段，`text` 与 `image` 按原位置保留并切断分组；
   - 去掉（或改为可选）整轮 `Worked for` 总外壳，改成每段各自的组头；
   - 组头由「固定文案 + 工具名列表」改为「阶段动词 + 计数」；
   - reasoning 行增加各自时长（需要服务端时长或客户端测量）；
   - 展开状态改为按稳定块标识持久，避免 turn 结束后重挂载把用户展开的块收起。
3. 许可约束：Memoh 为 **AGPL-3.0**。以上只作为设计参考，Herzi 若实施应自行实现，不复制其源码或文案文件。

## 5. 未决事项

- 是否采纳该模型，以及采纳到什么程度，需用户决定；本文件不含实施授权。
- 若要实现 reasoning 时长：需要确认 Pi 的 session entry 是否提供足够的相邻时间戳（Herzi 已确认 entry 时间戳单调且无重复，可作为近似来源），以及流式期间是否需要在客户端测量。
- 本地参考克隆位于 `/tmp/memoh-ref`（仓库外，未纳入版本控制），仅在需要继续对照时保留。
