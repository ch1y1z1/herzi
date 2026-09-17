# Chat 过程展示增强方案（thinking / tool call 语义化）

> 日期：2026-09-17（UTC+08:00）
> 状态：方案完成，待决策后实施
> 目标：让 `Worked for` 组内不再只是「Thinking / Ran N tools」，而是能读出「改了哪几个文件、跑了什么命令、搜了什么、抓了哪个站点」
> 参考实现：Memoh（commit `1aaef83`，AGPL-3.0，仅借鉴设计）；调研见 [`agent-activity-rendering-reference.md`](./agent-activity-rendering-reference.md)
> 本轮边界：只输出设计，不改代码

## 1. 现状（已核实，含代码位置）

| 位置 | 现在的行为 |
| --- | --- |
| `ChatView.tsx:1437` `shortPreview()` | 把文本压成单行、折空白、截 92 字、去尾标点加 `…` |
| `ChatView.tsx:1444` `toolPreview()` | 只按固定优先级 `path→file→command→cmd→query→q→url→pattern→description` 取**第一个**命中的字符串值，再经 `shortPreview` |
| `ChatView.tsx:986` `ReasoningPart` | `Thinking` + `shortPreview(text)`；展开后是纯文本 `reasoning-detail` |
| `ChatView.tsx:1000` `ToolFallback` / `:1120` `ActivityItemRow` | 工具行 = 工具名 + `toolPreview(args)` + 状态图标；展开后是 Arguments/Result 两个 JSON 块 |
| `ChatView.tsx:1040` `ActivityGroup` | `Worked for Xs`，**折叠行不带任何预览**；`Ran N tools` 折叠行带工具名列表 |
| `styles.css:808` `.activity-preview` | 单行 `nowrap` + `ellipsis`，颜色 `#a0a49c`，12px |
| 展开状态 | 原生 `<details>`，无持久化 |

结论：现在**有预览但无语义**——`env -i PATH=... node ... | tail -5` 和 `npm test` 在行上看起来是同一种东西；「改了 3 个文件」这种信息完全没有。

## 2. 参考实现的要点

Memoh 把「工具目录」和「汇总」放在同一个模块（`tool-call-registry.ts`，1115 行），关键设计：

1. **两层分类**：
   - `ToolBucket`（粗，决定阶段动词）：`browse / edit / run / message / schedule / media / agent / other`；
   - `SummaryFragment`（细，决定计数细节）：`fileOperations / searches / commands / messages / schedules / media / agents / steps`。
   - 注释明确解释为什么两层：**`browse` 把读取和搜索混在一起，会让"研究了 8 个文件操作"在 6 次是网络搜索时失真**；且文件类**按调用次数而非唯一文件数**计数（一次 patch 可能动多个文件、重复读同一路径也算操作）。
2. **每工具一条展示描述** `getToolDisplay()`：`icon`（lucide）+ `actionKey`（i18n 词条）+ `target`（截断目标）+ `fullTarget`（tooltip 全文）+ `detail`（展开组件）+ `defaultOpen` + `diffAdd/diffRemove` + `hideAction`。
3. **组头两段式**：动词（`运行中`/`已运行`，随该段是否仍在流式变时态）+ 计数细节（`3 条命令、4 次搜索`）；**只有动词参与 shimmer**；段结束时右侧显示 diff 合计 `+128 −34`。
4. **单个工具不套动词**：因为它自己的标签（`Run ls /tmp`）已经足够具体，再加动词会重复。
5. **具体目标就在行上**：`web_search` 显示 `"query"`；`web_fetch` 显示 `hostname`；`read` 显示文件名（区分图片/PDF/区间读）；`exec` 显示 `description` 或命令首行（80 字），并在有 description 时隐藏动词避免"运行 运行测试"。
6. 另有 per-reasoning 的「已思考 N 秒」、流式 `now-line`、以及按稳定块 id 持久化的展开状态。

## 3. Herzi 的真实工具分布（本机两个 session，664 次调用）

设计必须基于真实数据，以下是实测（只统计工具名与参数键，不含正文）：

| 工具 | 调用数 | 参数键 | 语义归类 |
| --- | ---: | --- | --- |
| `bash` | 251 | `command`, `timeout` | run / commands |
| `todo` | **167** | `action`, `status`, `id`, `subject` … | 计划（多数是状态变更） |
| `web_fetch` | 84 | `url`, `maxChars`, `forceBrowser` | browse / searches |
| `read` | 65 | `path`, `offset`, `limit` | browse / fileOperations |
| `edit` | 33 | `path`, `edits[]` | edit / fileOperations + diff |
| `ffgrep` | 25 | `pattern`, `path`, `context` … | browse / searches |
| `write` | 17 | `path`, `content` | edit / fileOperations + diff |
| `web_search` | 13 | `query`, `limit`, `includeContent` | browse / searches |
| `ask_user_question` | 5 | `questions[]` | 询问 |
| `fffind` | 4 | `pattern`, `path` | browse / searches |

两个直接后果：

1. **`todo` 占 25% 的调用量，且绝大多数是状态变更**。若原样计入「N 步」，组头会被 `todo` 淹没，所以必须单独处理（见 §5 决策 D2）。
2. **diff 是可以本地算出来的**：`edit` 的参数是 `{path, edits:[{oldText,newText}]}`，`write` 是 `{path, content}`，不需要服务端改动就能得到 `+N −M`。

## 4. 设计

### 4.1 新增模块：工具目录（`src/web/toolCatalog.ts`）

纯函数、无 React 依赖、可单测。每工具一条定义：

```ts
interface ToolDisplay {
  icon: LucideIcon;
  action: string;          // 行上的动作词，如 "运行"、"读取"、"搜索"
  target: string;          // 截断后的目标（行上显示）
  fullTarget?: string;     // tooltip / 展开里的完整值
  bucket: ToolBucket;      // 决定阶段动词
  fragment: SummaryFragment | null;  // null = 不计入汇总
  diff?: { add: number; remove: number };
  variant?: string;        // 例如 read 的 image/pdf/range
}
```

初始映射（依据 §3 的真实参数键）：

| 工具 | 动作 | target | bucket | fragment | diff |
| --- | --- | --- | --- | --- | --- |
| `bash` | 运行命令 | `command` 首行（80 字） | run | commands | – |
| `read` | 读取 | `basename(path)`；`.png/.jpg/.webp` → 图片、`.pdf` → 文档、带 offset/limit → 区间 | browse | fileOperations | – |
| `write` | 新建 | `basename(path)` | edit | fileOperations | `+content 行数` |
| `edit` | 编辑 | `basename(path)` | edit | fileOperations | `+newText −oldText` 累计 |
| `ffgrep` | 内容搜索 | `"pattern"`（有 path 时附 `@ brief path`） | browse | searches | – |
| `fffind` | 查找文件 | `"pattern"` | browse | searches | – |
| `web_search` | 网络搜索 | `"query"` | browse | searches | – |
| `web_fetch` | 抓取网页 | `hostname(url)` | browse | searches | – |
| `ask_user_question` | 询问 | 第一个问题的标题（60 字） | other | steps | – |
| `todo` | 更新计划 | `subject` 或动作 | other | **null（默认不计）** | – |
| 未知工具 | 工具名原名 | 沿用现有 `toolPreview()` 的兜底 | other | steps | – |

**兜底原则**：目录未收录的工具（未来新增、MCP 工具、subagent 工具）必须仍然能渲染，只是退化为「工具名 + 现有预览 + steps 计数」。不因为没收录就不显示。

### 4.2 汇总（`summarizeToolRun(items)`）

输入：一个组内的工具项数组；输出：

```ts
{
  bucket: ToolBucket,            // 出现次数最多者；并列时按固定顺序；全是 todo/unknown 时 'other'
  counts: Array<{fragment, count}>,   // 按固定顺序：fileOperations → searches → commands → steps
  diff: { add: number, remove: number },
  running: boolean,
}
```

规则：

- **计数顺序固定**，与出现顺序无关，避免同一段过程不同回合顺序跳变；
- **`running`**：组内仍有未完成工具时，动词用进行时（`运行中`），且**不显示 diff 合计**（避免与行上的增量重复）；
- **计数粒度**（决策 D1）：`fileOperations` 默认按**唯一路径**计数（`edit`/`write` 的 path 去重），`searches`/`commands` 按**调用次数**计数。理由：「改了几个文件」是字面需求，而「搜索了几次」才对应重复查询。
  > 与 Memoh 不同：Memoh 文件类也按调用计数并为此写了理由（一次 patch 可能动多个文件）。我们的 `edit` 一次只动一个文件，所以按唯一文件计数更贴近用户预期；若采纳 Memoh 口径，改一行即可。

### 4.3 组头文案（保留单一 `Worked for` 组）

用户已明确要求保留单一 `Worked for` 组，因此**不改分组规则**，只改组头与组内行：

```
▸ 🕐 已运行 2 条命令、4 次搜索、3 次文件操作        +128 −34
```

- 动词由 bucket 决定：run→`运行中/已运行`、edit→`修改中/已修改`、browse→`探索中/已探索`、other→`处理中/已处理`；
- 无工具（只有 thinking）时退回 `Worked for Xs`（保留现有总时长语义）；
- 右侧 diff 合计仅在有编辑且已完成时显示；
- 折叠行**仍然保持单行**，超长时省略号截断；tooltip 给完整文案。

`Ran N tools`（组内连续工具的二级折叠）同理改为同一套汇总文案，避免内外两套说法。

### 4.4 组内行

```
🔧 运行命令   npm test -- src/web/components/ChatView.test.tsx
🔧 读取       ChatView.tsx                        ▸
🔧 编辑       toolCatalog.ts                      +42 −7
🔧 网络搜索   "herdr worktree api"
🔧 抓取网页   herdr.dev
```

- 动作词与目标分列显示，目标用等宽字体（命令、路径、pattern 属于代码类内容），比现在的整行灰色右对齐更易扫读；
- `target` 超长截断，`fullTarget` 放 `title` 属性（tooltip）；
- 状态图标沿用现在（完成 ✓ / 失败 ⚠ / 运行中 spinner）；
- 展开后仍显示完整 Arguments / Result（现有 `ToolData` / `ToolResultData` 不变），编辑类额外使用现有 diff 渲染。

### 4.5 thinking 行

```
🧠 已思考 12s       本轮我核对了 29 个 turn 的 part 分布……
```

- 文案：进行中 `思考中`；有跨度且 ≥1s `已思考 Ns`；无法确定跨度时退回现在的 `Thinking`（**不编造时长**）；
- 时长来源（决策 D3）：
  - **方案 1（推荐）**：在 `PiSessionReader` 投影时用相邻 entry 时间戳计算——单条 reasoning 的区间 = 本消息 `createdAt` 到下一消息 `createdAt`。历史回合直接有值，无需客户端计时；同一消息内多条 reasoning 无法区分，退回无时长。
  - 方案 2：像 Memoh 那样在流式期间客户端测量，历史回合依赖服务端。成本更高。
- 预览文案沿用 `shortPreview`（保持单行），是否改为多行由决策 D4 决定。

### 4.6 展开状态持久化（建议一并做）

现状问题：`DisplayMessage.id` 是 `turn:${lastMessage.id}`，同一 turn 里新增一条 assistant 消息就会改变 id → React 视为新组件 → 原生 `<details>` 的 `open` 状态丢失。用户流式期间展开的组会在 turn 结束时弹回收起。

方案：新增一个 session 级 Map（上限 LRU），键为 `(paneId + 工具/思考项稳定标识)`，值为展开状态；组与行都通过受控的 `open` 读写它。标识用现有稳定 id（`toolCallId`、reasoning 的 `messageId+索引`）。

### 4.7 流式实时预览（可选，最后做）

折叠状态下在组头下方显示一行最新进展（最新 reasoning 的一行 / 正在运行的工具名），节流采样；`prefers-reduced-motion` 下关闭动画。当前 `PiRealtimeStore` 已提供 `running` 状态与最新消息，可实现，但价值低于前面几项，建议放最后或不做。

## 5. 待决策项

| 编号 | 决策 | 推荐 |
| --- | --- | --- |
| D1 | 文件类计数：唯一路径 vs 调用次数 | **唯一路径**（"改了 3 个文件"） |
| D2 | `todo` 是否计入汇总 | **不计入**（167 次里多数是状态变更，会淹没组头）；行仍然显示 |
| D3 | thinking 时长来源 | **服务端用相邻 entry 时间戳近似** |
| D4 | thinking 预览是否改多行 | 先维持单行（本次方案不包含） |
| D5 | 是否做展开状态持久化与 live peek | 持久化**建议做**；live peek 可延后 |
| D6 | 实施方式 | 单 Agent（改动集中在 `ChatView.tsx` + 新模块 + 样式，无法有效并行） |

## 6. 分阶段实施

### P0：工具目录 + 单行语义化（核心）

- 新增 `src/web/toolCatalog.ts` + 单测（表驱动：每个工具给真实参数，断言 action/target/bucket/fragment/diff）；
- `ChatView.tsx` 的 `ToolFallback` 与 `ActivityItemRow` 工具分支改用目录；
- 样式：动作词 + 目标两列、等宽目标、超长 tooltip；
- 验收：真实 session 里 `bash`/`read`/`edit`/`web_search`/`web_fetch`/`ffgrep` 六类行都能读出"做了什么、对什么做"；未知工具仍能渲染。

### P1：组头汇总 + diff

- 实现 `summarizeToolRun()`，替换 `Worked for Xs` / `Ran N tools` 的折叠行文案；
- 编辑类行的 `+N −M`，组头 diff 合计（仅完成态）；
- 验收：一个"改了 3 个文件、跑了 5 条命令、搜了 4 次"的真实 turn 组头能正确显示该句；构造用例覆盖 bucket 并列、仅有 thinking、以及全 unknown 工具三种退化。

### P2：thinking 时长

- `PiSessionReader` 增加可选 `durationMs`（对 reasoning part）；不足时前端不显示时长；
- 验收：历史回合能显示 `已思考 Ns`，同一消息内多条 reasoning 正常退化。

### P3（可选）：展开状态持久化 + live peek

- 稳定键 + session 级 LRU 存储；live peek 视收益决定。

## 7. 测试与验证

- **单测**：目录映射（表驱动）、汇总函数（顺序、并列、退化）、diff 计算（`edit` 多段 edits、`write` content、无 newText）；
- **组件测试**：组头文案与 diff 合计、行渲染与 tooltip、未知工具兜底；
- **数据驱动测试**：用一份 synthetic snapshot 覆盖真实工具组合（含 `todo` 噪声），断言组头不会被 `todo` 淹没；
- **人工验收**：在真实 Pane 里跑一个多工具任务，对照文案是否与事实一致（不允许把未发生的操作写进摘要）。

## 8. 风险与约束

1. **不得虚报**：摘要只能来自真实参数（路径数、命令数、抓取主机名）。无法判定时用中性词（`N 步`），不猜"改了 X 个文件"。
2. **工具名会演进**：目录必须允许未收录工具降级渲染；工具名或参数键变化只影响该行，不影响分组。
3. **AGPL 约束**：Memoh 的设计可以借鉴，源码与文案文件不可复制；本方案的所有词表与实现均为自行设计。
4. **`todo` 噪声**：若不计入汇总，需在文档中说明，避免后续误以为是漏统计。
5. **中文硬编码**：Herzi 现有界面为中文硬编码，本方案沿用，不引入 i18n 框架。
6. **性能**：目录与汇总都是纯函数、只作用于当前可见 turn；diff 行数在参数上直接计算，不做全文件读取。

## 9. 完成标准

- 组内每一行都能回答"做了什么、对什么做"；
- 组头能回答"这一轮大致做了什么、规模多大、净改动多少"；
- 真实数据里 `todo` 不淹没摘要；
- 未收录工具、缺参数、失败调用三种退化都显示合理；
- 自动测试覆盖上述行为，且不引入对真实 Pane 的依赖。
