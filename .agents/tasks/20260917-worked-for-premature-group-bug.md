# Bug 分析：`Worked for` 组在回答未结束时提前出现，并伴随闪烁

- 日期：2026-09-17
- 状态：根因已定位（代码层面可解释），修复未实施
- 现象：turn 还在进行中，就出现了 `Worked for` 组；且界面闪烁

## 1. 判定"是否还在运行"的现有链路（事实）

前端只有一个布尔量控制分组（`ChatView.tsx:459`）：

```ts
const running = realtime ? realtime.status !== "idle" : chat.running;
const displayMessages = useMemo(() => groupAssistantTurns(messages, running), [messages, running]);
```

而 `groupAssistantTurns` 对**最新一个 turn** 的判定（`ChatView.tsx:1262-1293`）：

```ts
const isLatestTurn = index === messages.length;
const turnRunning =
  assistantMessages.some((item) => item.status?.type === "running") ||
  (running && isLatestTurn);
```

`combineAssistantTurn` 随后**二值**决定是否折叠：`running === false` 就立刻把整轮收进 `Worked for`。

三个状态来源：

| 来源 | 取值 | 说明 |
| --- | --- | --- |
| `chat.running` | `pane.agentStatus === "working"`（`src/server/index.ts:316`） | **`blocked` / `done` / `idle` / `unknown` 全部为 false** |
| `realtime.status` | 由 bridge 事件维护 | `agent_start`→`working`，`agent_settled`→`idle`，`ui_prompt_start/end` 与 `herdr:blocked`→`waiting`（`herzi-bridge.ts:334-373`、`:188-191`） |
| 单条消息的 `status` | live 消息在 `message_end` 前是 `{type:"running"}`，之后变 `complete`（`herzi-bridge.ts:483-496`） | 持久化消息由 `statusFromStopReason()` 生成，**默认返回 `complete`**（`pi-session-reader.ts:332-344`，`stopReason` 缺失也走 default） |

## 2. 根因（按可能性排序）

### R1（主因）`running` 出现假阴性时，整轮立刻折叠

`combineAssistantTurn` 是**二值**的：只要 `running` 为 false、且当前没有"正在运行"的消息，整轮马上变成 `Worked for`。而 `running` 有多个假阴性来源：

1. **`blocked` 被当成"不在运行"**：`chat.running` 只认 `working`。agent 正在等用户回答（`ask_user_question`）时 Herdr 报告 `blocked`，此时若 `realtime` 缺失（见下条），`running=false` → 组立刻出现。可是"等用户回答"显然不是"回答结束"。
2. **`realtime` 缺失时回落到 Herdr 状态**：`realtime` 只有在收到过该 Pane 的 bridge 事件后才存在。若该 Pane 的 pi 进程没有加载/重载 bridge（例如扩展在进程启动后才安装、或尚未 `/reload`），`realtime` 为 `undefined`，于是完全依赖 `chat.running`，就继承了第 1 条的 `blocked` 问题，也继承了 1.5 秒轮询的滞后。
3. **bridge 存在但状态是初值 `idle`**：`PiRealtimeStore` 为新 runtime 建状态时 `status: "idle"`（`pi-realtime.ts:127`），`session` 事件也会把状态置回 `idle`（`:42`）。若 Herzi 重启、或 bridge 重连后先到的批次里没有 `status` 事件，`realtime.status` 会停在 `idle`，直到下一次 `agent_start`。期间 `running=false` → 组出现。
4. **消息级信号有"空窗"**：live 消息在 `message_end` 时被标记 `complete`，下一条 assistant 消息要等到 `message_start` 才有 `{type:"running"}`。中间那段（模型思考/工具执行间隙）唯一依赖 `running` 这个全局量。持久化消息更是**永远不会**是 `running`（`statusFromStopReason` 默认 `complete`），所以"消息级"这条兜底对已落盘的内容不起作用。

### R2 闪烁：状态在 true/false 之间来回跳

同一次运行里 `running` 可以多次翻转（例如 Herdr 在 `working` 与 `blocked` 之间切换、轮询先后到达、bridge 状态被 `session` 事件重置）。每次翻转都会让整轮在"折叠"和"展开"之间重建一次 —— 这就是可见的闪烁。

### R3 闪烁：turn 的 React key 不稳定

`DisplayMessage.id` 是 `turn:${lastMessage.id}`（`ChatView.tsx:1350`）——**turn 里每新增一条 assistant 消息，id 就变一次**，React 视为新组件，整棵子树重新挂载。后果有两个：

- 视觉上闪一下（DOM 重建）；
- 用户展开的 `<details>` 状态被重置。

1.5 秒轮询每次都会重建消息数组，因此只要 turn 还在增长，这个重挂载就会反复发生。

### R4 次要：live 与持久化副本可能同时存在

`mergeRealtime` 用 `${role}:${createdAt}` 去重（`ChatView.tsx:1468`）。live 消息的 `createdAt` 取自 Pi 消息的 `timestamp`，**取不到时回退成 `Date.now()`**（`herzi-bridge.ts:470-473`），此时与 JSONL 中的值不一致 → 两份副本同时进入列表；等 realtime 状态被清（`session`/`branch` 事件）或 `messageMap` 被裁剪后又消失 → 表现也是内容闪动或短时重复。

## 3. 修复方向（供选择）

| 编号 | 修复 | 触及文件 | 说明 |
| --- | --- | --- | --- |
| **F-A** | 把"是否在运行"改成**单调**判定：一轮一旦被观察到在运行，就保持展开，直到收到明确的结束信号（`agent_settled` / `status: idle` **且** 无 running 消息 **且** Pane 非 `blocked`）。不确定时按"仍在运行"处理（fail-open，宁可晚折叠） | `ChatView.tsx` | 直接消除 R1/R2 的可见症状 |
| **F-B** | `blocked` 视为未结束：服务端 `running: pane.agentStatus === "working" \|\| pane.agentStatus === "blocked"`，或把 agentStatus 原样下发由前端判定 | `src/server/index.ts`（+ 测试） | 1 行语义修正，独立于其他改动 |
| **F-C** | turn 的 key 改为**稳定标识**（例如该轮第一条 assistant 消息 id），使追加消息不再重挂载 | `ChatView.tsx` | 同时修掉 R3 与"展开状态丢失"，与《工具展示增强》里的展开状态持久化互补 |
| **F-D** | bridge 在 `timestamp` 缺失时不要用 `Date.now()` 兜底（宁可不发该 live 消息，等 JSONL 落盘），或前端按 id 去重 | `integrations/pi/extensions/herzi-bridge.ts`、`ChatView.tsx` | 消除 R4 的重复副本 |

建议顺序：**F-B → F-A → F-C**（F-D 视是否复现再定）。F-A 需要在 `ChatView` 里引入一个小的"turn 生命周期"状态（记录已见过的 running 与已收到的 settle），因此最好与《工具展示增强》里的展开状态模块一起设计，避免两套状态并存。

## 4. 与当前工作流的关系

F-A、F-C（以及 F-D 的前端部分）都改 `src/web/components/ChatView.tsx`；F-B 改 `src/server/index.ts`；F-D 的 bridge 部分改 `integrations/pi/extensions/herzi-bridge.ts`。

当前有 Worker `herzi_tools`（`w14:p1`）正在改 `ChatView.tsx` / `styles.css` / `protocol.ts` / `pi-session-reader.ts`。**因此本 bug 的修复必须排在它集成之后**，否则同一文件并发修改会直接冲突。

## 5. 待确认

1. 是否采纳上述修复范围（F-B + F-A + F-C，F-D 待定）？
2. 复现条件是否与推断一致？需要用户提供一次"组提前出现"时的 Pane 与时间点，我可以核对当时的 Pane 是否 `blocked`、以及该 Pane 是否有 bridge 事件（`realtime` 是否存在）——这能确认 R1 的第 1/2/3 条中真正生效的是哪一条。
3. 是否接受"宁可晚折叠"的取舍（F-A 的 fail-open 语义）：极端情况下（bridge 完全缺失且进程被杀）该轮可能一直保持展开。
