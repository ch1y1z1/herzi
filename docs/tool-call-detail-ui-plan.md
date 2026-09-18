# 工具调用专属展示方案（bash / read / edit / search / fetch）

> 日期：2026-09-17（UTC+08:00）
> 状态：方案完成，**未获实施授权**；实施前需按 §9 做一次样本核对
> 目标：把工具调用的**展开区**从「Arguments / Result 两段裸 JSON」升级为按工具类型定制的视图（diff / 代码 / 输出 / 匹配列表 / 网页摘要），折叠态保持现有紧凑行
> 参考：Memoh（AGPL-3.0，仅借鉴设计）、Moshi Chat View（闭源，仅公开文档）、Pi 自身工具渲染器（MIT，仅借鉴行为）
> 上一轮相关工作：[`chat-tool-presentation-plan.md`](./chat-tool-presentation-plan.md)（折叠行语义化，已合入 main）

## 1. 背景

上一批（P0–P3）已经解决了**折叠态**：工具行现在是「动作词 + 目标 + `+N −M` + 状态」，由 `src/web/toolCatalog.ts` 的目录驱动；组头是「阶段动词 + 计数 + diff 合计」。

但**展开态**没有变：`ToolFallback` / `ToolItemRow` 展开后仍然是：

```tsx
<ToolData label="Arguments" value={args} />
<ToolResultData label={isError ? "Error" : "Result"} value={result} />
```

即两段格式化 JSON（`formatValue` = 字符串原样 / 其余 `JSON.stringify(value, null, 2)`）。后果：

- `edit` 已经有真实 diff（服务端就有），前端却在展开区显示原始 diff 字符串，没有行级着色；
- `read` 的 65 行文件原文塞在一个 `<pre>` 里，无行号、无高亮，且 `max-height: 320px` 内部滚动；
- `bash` 的 29 行输出与命令混在一起，看不出截断；
- `ffgrep` 的匹配列表就是一大段文本，没有「按文件分组」；
- `web_search` 的编号结果与 `web_fetch` 的整页 Markdown 一样无法扫读。

本方案只做**展开区的按工具定制**，不改分组规则、不改折叠行语义。

## 2. 已确认决策（2026-09-17，用户回答）

| 编号 | 决策 | 确认结果 |
| --- | --- | --- |
| D1 | 覆盖范围 | 第一层必做：`bash`、`read`、`edit`/`write`、`ffgrep`/`fffind`、`web_search`/`web_fetch`；第二层建议一并做：`todo`、`ask_user_question`（`details` 100% 可用）。完整清单与判据见 §5.4 |
| D2 | 真实数据核对 | **允许**：只读本机 Pi session JSONL，仅统计键名/类型/形状命中率，不输出正文、不写入文档原文。**已完成**（§4） |
| D3 | 视觉取向 | **延续现有紧凑行**，只替换展开区；等宽、沿用现有主题变量 |
| D4 | 数据边界 | **允许服务端按需读取宿主文件**（如 `bash` 的 `fullOutputPath`、`read` 的目标文件），用于「展开全部」。**不允许**服务端代理外网请求（`web_fetch` 全文预览不在本批） |

## 3. 外部参考

### 3.1 Memoh：工具适配清单（一手源码核对）

来源：`memohai/Memoh` `main`（commit `1aaef83`），`apps/web/src/pages/home/components/tool-call-registry.ts`（1115 行）。本轮重新拉取核对（临时文件，未入库）。**AGPL-3.0，只读设计，不复制代码或文案。**

`getToolDisplay()` 有 **50 个 `case` 分支**，其中 18 个专属 detail 组件：

| 归类 | 工具 | detail 组件 |
| --- | --- | --- |
| 读 | `read`、`list`、`generate_video` | `ToolCallDetailOutput` |
| 写/改 | `write`、`apply_patch` | `ToolCallDetailApplyPatch`（`defaultOpen: true`，带 `diffAdd/diffRemove`） |
| 改 | `edit` | `ToolCallDetailEdit`（带 `diffAdd/diffRemove`） |
| 运行 | `exec` | `ToolCallDetailExec` |
| 网页 | `web_search` | `ToolCallDetailWebSearch` |
| 网页 | `web_fetch` | `ToolCallDetailWebFetch` |
| 记忆/联系人 | `search_memory`、`get_contacts` | `ToolCallDetailMemory`、`ToolCallDetailContacts` |
| 消息 | `send` | `ToolCallDetailSend` |
| 日程 | `list_schedule` | `ToolCallDetailSchedule` |
| 邮件 | `list_email_accounts`、`list_email`、`read_email` | `ToolCallDetailEmailAccounts/List/Read` |
| 媒体 | `generate_image` | `ToolCallDetailImage` |
| Agent | `spawn_agent`、`send_message`、`list_agents` | `ToolCallDetailSpawn` |
| GUI/浏览器 | `browser_action`、`browser_observe`、`computer_observe`、`computer_action` | `ToolCallDetailBrowser`、`ToolCallDetailComputer` |
| 远程会话 | `browser_remote_session` | `ToolCallDetailRemoteSession` |
| 询问/审批 | `ask_user`、`permission` | 无独立 detail（走 `userInput` / 审批路径） |
| 无 detail（仅行） | `list_execution_locations`、`bg_status`、`list_background`、`get_background_status`、`kill_background`、`wait`、`wait_until`、`react`、`list_sessions`、`search_messages`、`get_messages`、`list_models`、`list_workdirs`、`list_acp_agents`、`get_schedule`、`create_schedule`、`update_schedule`、`delete_schedule`、`send_email`、`speak`、`transcribe_audio`、`use_skill`、`list_skills` | – |

值得注意的几个设计点（本次可直接借鉴，不涉及代码复制）：

1. **只有两处 `defaultOpen: true`**（`write` 的 patch 形态与 `apply_patch`）：展开态默认打开的判据是「用户最需要立刻看到的后果」，而不是「工具重要」。
2. **`diffAdd/diffRemove` 是目录里的一等字段**：`write` 用 `input.changes`/`result.changes`/`block.diff` 三路兜底，并有 `patchFilesFromChanges/patchFilesFromResult/patchFilesFromInput` 三条推导路径——说明它同样面对「details 不一定有」的现实。
3. **有 `hideAction` 语义**：动作词与 target 重复时隐藏动词，避免「运行 运行测试」。
4. **GUI 类不用计数，改用目的地**（`浏览了 example.com` / `浏览了 N 个网站`）。
5. **错误不提升为标题状态**：源码注释明确「工具结果中的错误供 Agent 自行检查，不代表用户任务失败」，原始结果仍交给 detail 组件展示。这一条 Herzi 现在**不一致**（`isError` 会把行标红），需要单独决策。

### 3.2 Moshi：只到产品级描述

`getmoshi.app/docs/chat-view`（访问 2026-09-17）只说明 Chat View 有 `tool cards`：shell 命令、文件读写、任务组、mini diff、结果、失败，「点卡片展开详情」；不披露字段或组件。相关但独立的能力是 **host 端 diff viewer**（`/docs/diff-viewer`：`moshi-hook` 在宿主起一个 loopback 的 git diff Web 应用，展示 staged/unstaged/untracked，side-by-side + 行级高亮）与 **browser preview**。

结论：Moshi 不能提供字段级参考；它的 diff viewer 是「按仓库看改动」的**另一层能力**，与「聊天里展示单次工具结果」不是同一件事，本方案不包含（记为后续可选，见 §8）。

### 3.3 Pi 自身：最贴近、可逐条对照的实现（MIT）

`@earendil-works/pi-coding-agent` 为每个内置工具提供 `renderCall` / `renderResult`，且 **`toolResult` 消息带 `details`** 结构化元数据。已核对到的行为：

| 工具 | 折叠态 | 展开态 | `details` 字段 |
| --- | --- | --- | --- |
| `read` | 只显示调用行，**结果不展开** | 语法高亮 + 前 10 行 + `… (N more lines)`；`truncation` 时追加警告 | `truncation` |
| `grep` | **折叠就显示前 15 行**匹配 | 全部行；`matchLimitReached` / `truncation` / `linesTruncated` 追加 `[Truncated: …]` | `matchLimitReached`、`truncation`、`linesTruncated` |
| `find` | 折叠显示前 20 行 | 全部 | `resultLimitReached`、`truncation` |
| `bash` | 折叠显示**最后 5 个可视行**（`truncateToVisualLines`）+ `… (N earlier lines)` | 全部输出 | `truncation`、`fullOutputPath` |
| `edit` | **参数到达时就本地跑 `computeEditsDiff` 预览 diff**，结果回来用真 diff 替换；错误时 header 变红底 | 真 diff | `diff`、`firstChangedLine` |
| `write` | 摘要 | 内容/补丁 | 主要是 `diff`、`changes` |

`generateDiffString`（`dist/core/tools/edit-diff.js:272`）的实际输出格式（决定前端怎么渲染）：

```
+92 const added = true;
-88 const added = false;
 91 context line
     ...
```

即**每行首字符是 `+` / `-` / 空格，后接行号（右对齐），再是内容**；上下文只保留 4 行；被跳过的上下文输出 `   ...`；**没有 unified diff 的 `@@` hunk 头**。同函数返回 `firstChangedLine`（新文件行号）。

这解释了 §4 的实测：`edit.details.diff` 454 份样本里 `@@` 出现 **0** 次、`+` 9928 行、`-` 1783 行、上下文 9367 行。

同时存在的 `details.patch`（460 份）则是**标准 unified diff**（903 个 `@@`、920 个 `---/+++` 文件头行，见 §9 核对 2）。因此两条路都通：`diff` 已带行号与 4 行上下文，适合直接渲染；`patch` 适合复用通用 unified diff 解析。本方案选定 **`diff` 为主、`patch` 为回退**（少一层解析，且 `firstChangedLine` 可直接用）。

## 4. 真实数据核对（已完成，D2 授权范围内）

方法：只读 `~/.pi/agent/sessions/**/*.jsonl`（207 个文件，约 9,550 次 `toolResult`），按 `toolName` 聚合统计 `details` 键名与出现次数、`content` 形状、文本长度分位、以及预定义形状正则的**命中率**。脚本只输出键名/计数/比例与**脱敏骨架**（字母→`a`、数字→`9`），未输出任何正文，未写入仓库。

### 4.1 调用量与数据可得性

| 工具 | 调用 | 错误 | `details` 可用率 | 文本中位/ p90 字符 | 结论 |
| --- | ---: | ---: | --- | --- | --- |
| `bash` | 5192 | 217 | **5%**（`truncation`/`fullOutputPath` 各 31） | 717 / 5412 | details 基本没有，靠 args + 文本 |
| `todo` | 1019 | 0 | **100%**（`action`/`params`/`tasks`/`nextId`） | 36 / 45 | 结构化完备，可做任务变更卡片 |
| `read` | 980 | 8 | 1.5%（`truncation` 15） | 3627 / 20000 | 靠 args + 尾部摘要行 |
| `web_fetch` | 873 | 0 | 9%（`error` 80） | 5076 / 21785 | 靠文本（Markdown） |
| `edit` | 481 | 27 | **94%**（`diff`/`patch`/`firstChangedLine` 各 454） | 95 / 147 | **可直接渲染真 diff** |
| `web_search` | 425 | 0 | 0.2%（`error` 1） | 1375 / 18637 | 靠文本（编号列表） |
| `write` | 263 | 2 | **0.8%（实际为空对象）** | 81 / 125 | 只能从 args 算，见 §9 核对 4 |
| `ffgrep` | 112 | 0 | **100%**（`totalMatched`/`totalFiles`） | 844 / 6552 | details + 文本双来源 |
| `ask_user_question` | 71 | 0 | **100%**（`answers`/`cancelled`） | 183 / 306 | 可做问答卡片 |
| `fffind` | 32 | 0 | **100%**（`totalMatched`/`totalFiles`/`pageIndex`/`hasMore`） | 311 / 1288 | details + 路径列表 |

`content` **全部**是数组（`[{type:"text"}]`），图片走 `herzi-tool-result` 包装（已实现）。

### 4.2 可解析形状（命中率，实测）

| 工具 | 实测形状 | 命中率 | 可用性判断 |
| --- | --- | --- | --- |
| `web_search` | 首行 `N. **标题**` | **98%** | 可稳定按 `^\d+\.\s+\*\*` 切分为结果条目 |
| `web_fetch` | 首行 `# 标题` | **64%** | 可提取标题；正文按 Markdown 渲染 |
| `web_fetch` | 文本含 `truncat` | 25% | 可显示截断提示 |
| `read` | 尾部 `[Showing lines A-B of N. Use offset=K to continue.]` | 3% | 解析尾部摘要即可，失败则纯文本 |
| `read` | 行首行号前缀（`NNN\|` / `NNN→`） | **1%** | **结果不带行号**，行号由前端按 `offset` 生成 |
| `ffgrep` | **已证实**（§9 核对 1）：`行号: 内容` = 匹配行，`行号- 内容` = 上下文行（103/112 次显式传了 `context`；不传 `context` 的 9 次结果中 0 个 `-` 行、9 个全有 `:` 行） | 6044 / 1328 行 | 可稳定分组并区分匹配/上下文 |
| `ffgrep` | 文件路径头行（`path.ext`） | 201 行 | 可按文件分组 |
| `ffgrep` | `[N matches in ...]` 摘要行 | 22 次 | 可选展示 |
| `fffind` | 纯路径列表行 | 50%（首行形状） | 可做成文件列表 |
| `bash` | 含 `exit code` / `Truncated` | **0% / 2%** | **拿不到退出码**；截断提示几乎不可用 |
| `edit` | 文本首行 `... replaced N block(s) in /path/...` | 94% | 无需解析：diff 来自 `details` |

### 4.3 核对出的两个重要事实

1. **`toolResult.details` 确实落进 JSONL**。不仅文档（`docs/session-format.md` 定义 `details?: any; // Tool-specific metadata`）这么说，本仓库代码也已在用：`src/server/pi-session-reader.ts:180` 读 `message.details` 构建 `todo` 快照。因此**现在 Herzi 是自己丢掉了 `edit.diff` / `read.truncation` 等字段**，只投影了 `content`。
2. **`edit.details.diff` 不是 unified diff**（无 `@@`），前端不能直接用现成的 unified diff 解析器，必须按 §3.3 的格式自己解析，或由服务端顺带产出结构化行数组。

## 5. 设计

### 5.1 总体架构：三条来源 + 一条降级链

```
tool-call
 ├─ A. args 推导        （已有 toolCatalog：动作词、target、+N −M、read 变体）
 ├─ B. details 白名单    （新增：服务端投影受限结构，如 edit diff 行数组）
 └─ C. 结果文本弱解析    （新增：每种工具一个解析器，失败即纯文本）
        ↓
   工具视图注册表（前端）
        ↓
   未注册/解析失败 → 现有 Arguments/Result 两段式（永不空白）
```

硬约束（沿用 `toolCatalog.ts` 的既有原则）：

- **展示只能来自真实数据**：解析不出就不显示该项（例如 `bash` 不显示退出码，因为没有）。
- **降级不是异常路径**：`read` 的 details 只有 1.5%，`write` 只有 0.8%——所以每个视图都必须有「纯文本也能看」的形态。
- **解析器是纯函数**，无 React、无 I/O，可单测。

### 5.2 协议与服务端

#### 5.2.1 `ChatPart` 的 tool-call 增加 `display`

不改 `result` 语义（仍是原文，保证降级与「事实可核对」），新增一个**受限的、由服务端计算**的投影：

```ts
interface ChatToolDisplay {
  /** 服务端已解析的结构化行级 diff（仅 edit/write 且有 details.diff/patch 时）。 */
  diff?: { lines: ChatDiffLine[]; firstChangedLine?: number; truncated?: boolean };
  /** read/bash 的截断元数据（仅 details.truncation 存在时）。 */
  truncation?: { truncated: boolean; by?: "lines" | "bytes"; outputLines?: number; totalLines?: number };
  /** read 尾部摘要解析结果。 */
  readRange?: { from: number; to: number; total?: number; nextOffset?: number };
  /** ffgrep/fffind 的计数（来自 details，已核实 100% 可用）。 */
  matchCount?: { matched: number; files: number; hasMore?: boolean };
}

interface ChatDiffLine {
  kind: "add" | "remove" | "context" | "skip";
  /** 文件内行号（新文件 for add/context，旧文件 for remove），skip 行为空。 */
  lineNumber?: number;
  text: string;
}
```

设计取舍：

- **白名单化，不透传整个 `details`**：`details` 是 `any`，可能含大对象与无关字段；白名单保证体积可控、语义稳定、不会把未预期的内容带到浏览器。
- **diff 在服务端解析成行数组**：前端不必重复实现 §3.3 的格式解析，也避免把 50KB diff 字符串塞进渲染层再解析两次。
- **`result` 保持原样**：任何降级路径都能回到「原文可读」，也让「展示与事实不一致」这类问题永远可对照。

改动点：

| 文件 | 改动 |
| --- | --- |
| `src/shared/protocol.ts` | 新增 `ChatToolDisplay` / `ChatDiffLine`；tool-call part 增加可选 `display` |
| `src/server/pi-session-reader.ts` | `toolResults` 现已在读 `message.details`（仅 todo），扩展为按工具白名单投影 `display`；`toolResultValue()` 不变 |
| `integrations/pi/extensions/herzi-bridge.ts` | 实时路径同步投影（否则运行中的卡片与完成后不一致） |
| `src/server/index.ts` | 新增受控的宿主文件读取（§5.2.2） |

#### 5.2.2 宿主文件读取（D4 已授权）

用途仅限两处：

1. `bash` 的 `details.fullOutputPath`（31/5192 次有）→「查看完整输出」；
2. 已知路径的「展开全部」（`read` 的目标文件）。

约束（必须实现，不是可选项）：

- **仅允许读取服务端自己已知的路径**：路径来自 `details.fullOutputPath` 或该 tool-call 的 `args.path`，不接受客户端传任意路径；
- **归属校验按实测事实设定（§9 核对 3）**：31 个 `fullOutputPath` 样本全是绝对路径、父目录 basename 均为 `T`（macOS `…/T/`，即系统临时目录），**没有一个在 Pane 工作目录内**。所以规则是「规范化（含符号链接解析）后必须位于 `os.tmpdir()` 内 + 文件属主为当前用户 + 体积上限」，而不是「必须位于工作目录内」——后者会 100% 拒绝；
- **文件可能已不存在**：31 个样本中 26 个已被清理；必须返回明确提示，不渲染空面板；存活样本 105KB–690KB，必须有体积上限；
- 体积上限、超限返回 `413` 语义的明确错误，不静默截断；
- 只读、无副作用、不缓存到磁盘；
- 记录（metadata-only）访问日志，便于事后核对。

**不做**：外网代理、目录遍历 API、写文件。

### 5.3 前端结构

新增 `src/web/toolViews/`：

```
toolViews/
  index.ts            # 注册表：toolName → ViewComponent（含 fallback）
  DiffView.tsx        # 行级 diff（+ / − / 上下文 / skip / 行号 / 折叠长段）
  CodeView.tsx        # read：行号 + 等宽 + 长文件折叠
  OutputView.tsx      # bash：命令、输出、截断提示、耗时
  MatchListView.tsx   # ffgrep/fffind：按文件分组，匹配行高亮
  WebSearchView.tsx   # web_search：编号结果卡片列表
  WebFetchView.tsx    # web_fetch：标题 / 域名 / 字符数 / Markdown 正文
  toolText.ts         # 纯函数解析器（与组件分离，便于单测/复用）
```

`ToolItemRow` / `ToolFallback` 的展开区改为：

```tsx
const View = toolViewFor(item.toolName);
<div className="tool-detail">
  <View item={item} />          // 内部自选：结构化视图，或退回 Arguments/Result
</div>
```

**未知工具仍然渲染**：`toolViewFor` 返回 `undefined` 时使用现有 `ToolData`/`ToolResultData`。

### 5.4 适配清单与各工具视图规格

#### 5.4.1 决定

判据只有三条：**实测调用量**（做 1 次的工具不值得写解析器）、**是否有可靠结构化数据**（`details` 或稳定文本形状）、**展开后是否真的比 JSON 好读**。三者缺一就不做专属视图。

**第一层：必做（8 个工具名，6 类视图）**

| 工具 | 调用量 | 专属视图 | 数据来源可用率 |
| --- | ---: | --- | --- |
| `bash` | 5192 | 输出视图 | A + C（details 5%） |
| `read` | 980 | 代码视图 | A + C（details 1.5%） |
| `edit` | 481 | 行级 diff | B 94% |
| `write` | 263 | 新建内容 | A（`content`）；`details` 实测为空对象，不可用 |
| `ffgrep` | 112 | 匹配列表 | B 100% + C |
| `fffind` | 32 | 文件列表 | B 100% + C |
| `web_search` | 425 | 结果列表 | C 98% |
| `web_fetch` | 873 | 网页摘要 | A + C 64% |

**第二层：建议一并做（2 个，`details` 100% 可用、成本几乎为零）**

| 工具 | 调用量 | 专属视图 | 说明 |
| --- | ---: | --- | --- |
| `todo` | 1019 | 本次调用的变更卡片 | 只显示**这一次调用改了什么**（`新增/更新/删除 #3 …`），不重复 composer 上方那条全量状态条 |
| `ask_user_question` | 71 | 问答卡片 | 问题 + 选项 + 用户回答 + 是否取消（`details.answers/cancelled`） |

**不做（走通用降级）**：`bg_delegate` / `bg_result`（各 1 次，扩展私有 schema）、以及未来所有 MCP / 未知工具。它们保留现有「工具名 + 目标 + Arguments/Result」两段式，**只加通用改进**：长文本默认折叠 + `N 行未显示` + 复制。

**为什么不按 Memoh 的 50 个清单做**：它的清单里大半是它自己产品的 agent 能力（邮件、日程、媒体生成、GUI/桌面控制、浏览器、远程会话、spawn agent）。Herzi 是 Pi 会话的 viewer，为不存在的工具写视图没有收益。采纳的是它的**原则**（有结构化 detail 才做专属视图、按 bucket 复用默认组件、`defaultOpen` 只给「后果最需要立刻看到」的工具），不是它的清单。

#### 5.4.2 展开区形态

折叠行一律不变，只替换展开区：

```
edit file.ts  +42 −7                      read file.ts · 第 100–199 行
┌ 首个改动于第 92 行        [复制 diff]   ┌              [复制] [展开全部]
│  +92  const added = true;               │  100  import type { … }
│  -88  const added = false;              │  101  …
│   91  context line                      │  199  }
│  ⋯ 12 行未改动                          │  已显示 100–199 / 共 512 行 · 继续读取 offset=200
└                                         └

运行命令 npm test              Took 3.4s    内容搜索 "summarizeToolRun" @ src/
┌                                 [复制]     ┌  12 处命中 · 4 个文件
│  (输出尾部 20 行)                          │  src/web/toolCatalog.ts
│  Tests  117 passed                         │     42: export function summarizeToolRun(
│  … 省略前 41 行     [查看完整输出]         │     43-   items: readonly ToolRunItem[],
└                                            │  src/web/components/ChatView.tsx
                                             │     1287: const summary = useMemo(…
网络搜索 "herdr worktree api"                └
┌  8 条结果
│  1. **Workspace & worktree**     抓取网页 herdr.dev
│     herdr.dev · 2026-09-14       ┌  Worktree
│  2. **Herdr CLI reference**      │  herdr.dev · 5.1k 字 · 已截断
└                                  │  (Markdown 正文前 40 行)    [展开全部]
                                   └
```

三个刻意的选择：

1. **`bash` 默认显示输出尾部而不是头部**：命令输出的结论在尾部（失败信息、测试统计），头部通常只是启动噪声。这与 Pi TUI 折叠取「最后 5 个可视行」的意图一致，但展开策略按 Chat 场景改为「尾部 20 行 + 可选全部」。
2. **`read` 的行号由前端按 `offset` 生成**：实测结果文本**不带行号前缀**（命中率 1%），行号只能自己算；算不出起点就退回纯文本，不猜。
3. **不显示 `bash` 的退出码**：实测文本中 `exit code` 命中率 **0%**，没有就不显示。同理 `read`/`bash` 的 `details.truncation` 只有 1.5% / 0.6%，截断提示以文本中能解析到的为准。

#### 5.4.3 规格表

| 工具 | 折叠行（不变） | 展开区（新） | 数据来源 | 降级 |
| --- | --- | --- | --- | --- |
| `edit` | `编辑 file.ts  +42 −7` | **行级 diff**：`+`/`−` 着色、行号、4 行上下文、被跳过区显示 `⋯ N 行未改动`；顶部一行 `首个改动在第 N 行`；超长（如 >400 行）折叠中段 | B（`details.diff` 94%） | 无 details → 现有 JSON；或按 `args.edits` 生成「旧 → 新」两栏对照 |
| `write` | `新建 file.ts  +120` | 新建内容视图（行号 + 折叠） | A（`content`）**仅此一条** | 显示 `content` 前 N 行 + 行数；不假装是 diff |
| `read` | `读取 file.ts · 第 100–199 行` | **代码视图**：行号（起点 = `offset ?? 1`）+ 等宽 + 长文件折叠（默认 200 行，尾部 `共 N 行`）；尾部摘要解析成一行状态（`已显示 100–199 / 共 512 行 · 继续读取 offset=200`） | A + C（尾部摘要 3%）+ B（1.5%） | 解析失败 → 纯文本 + 行号 |
| `bash` | `运行命令 npm test` | **输出视图**：命令（多行完整）、输出（**尾部 20 行**）、`Took 3.4s`（可算时）、截断提示；有 `fullOutputPath` 时提供「查看完整输出」（§5.2.2） | A + C | 无耗时/无截断信息就都不显示 |
| `ffgrep` | `内容搜索 "pattern" @ src/` | **匹配列表**：按文件分组（文件路径头 + 命中数），匹配行高亮、上下文行淡化；顶部 `12 处命中 · 4 个文件` | B（100%）+ C | 解析失败 → 纯文本（仍带计数） |
| `fffind` | `查找文件 "pattern"` | **文件列表**：路径列表（等宽、可复制），`hasMore` 时显示「还有更多（第 N 页）」 | B（100%）+ C | 纯文本 |
| `web_search` | `网络搜索 "query"` | **结果列表**：按 `^\d+\.\s+\*\*` 切分，每条 = 标题（外链，沿用 `markdownLink.tsx` 策略）+ 来源行；顶部 `N 条结果` | C（98%） | 切不出条目 → Markdown 渲染原文 |
| `web_fetch` | `抓取网页 herdr.dev` | **网页摘要**：标题（`#` 首行，64%）+ 域名 + 字符数 + Markdown 正文（默认折叠到 40 行，`展开全部`）；含截断提示时显式标注 | A + C | 无标题 → 只显示域名与正文 |
| `todo` | `更新计划 #3 …` | **变更卡片**：本次 action（新增/更新/删除/清空）+ 受影响任务的 subject 与状态变化 | B（100%） | 显示 action + subject 纯文本 |
| `ask_user_question` | `询问 …` | **问答卡片**：问题 + 选项 + 用户回答（+ 取消状态） | B（100%） | 显示问题与回答原文 |

### 5.5 视觉规范（延续现有风格，D3）

- 折叠行**完全不变**，改动只在 `.tool-detail` 内部；
- diff 配色沿用现有 `.diff-add` / `.diff-remove` 的色系，扩展为行级背景色（新增行浅绿、删除行浅红、上下文无底色、`skip` 行虚线灰）；
- 行号列右对齐、`user-select: none`、固定宽度，便于复制正文时不带行号；
- 所有长内容**默认折叠**，不用内部滚动条承载主内容；确需滚动时（如单次 diff 超长）用有界高度并显式提示「N 行未显示」；
- 沿用现有主题变量，不引入新的颜色体系。

### 5.6 交互

| 交互 | 范围 | 说明 |
| --- | --- | --- |
| 复制 | diff 全文、命令、路径、匹配列表、输出 | 用现有剪贴板工具；失败要有提示（沿用现有模式） |
| 展开全部 | `read` / `bash`（有 `fullOutputPath`）/ `web_fetch` | 走 §5.2.2，超限明确报错 |
| 点击链接 | `web_search` 结果、`web_fetch` 内的外链 | 复用 `src/web/markdownLink.tsx` 已确立的外链行为与新 tab 策略 |
| 跳到首个改动 | diff 视图 | 用 `firstChangedLine` |

不做：在 Chat 内直接打开/编辑宿主文件、审批按钮、iframe 预览。

### 5.7 安全与隐私

1. 新增的宿主文件读取是**唯一**新增的攻击面，必须按 §5.2.2 的路径白名单 + 真实路径校验 + 体积上限实现，并有单测覆盖 `../`、绝对路径、符号链接、目录、超大文件、二进制文件；
2. `details.diff` / 输出文本会包含**真实代码内容**——它们本来就在 Chat 数据流里（`result` 已下发），本次不新增暴露面；但**不得**把它们写进服务端日志或文档；
3. 不新增外网请求（`web_fetch` 全文代理已明确排除）；
4. 解析器只做字符串处理，不做 `eval`、不渲染远程 HTML。

## 6. 分阶段实施

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| **P0** | 协议 `display` + 服务端 `edit` diff 解析 + `DiffView` + 注册表骨架（含 fallback） | 真实会话里 `edit` 行展开能看到彩色行级 diff 与行号；无 `details.diff` 时退回原文；未知工具不受影响 |
| **P1** | `read` `CodeView`（行号 + 尾部摘要 + 截断）+ `bash` `OutputView`（命令/输出/耗时/截断） | 真实会话中 read 的区间读取与尾部摘要正确；bash 不显示不存在的退出码 |
| **P2** | `ffgrep`/`fffind` `MatchListView`、`web_search` `WebSearchView`、`web_fetch` `WebFetchView` | 六类工具的真实样本都能读出结构；解析失败率与降级路径可观测 |
| **P3** | `todo` 变更卡片、`ask_user_question` 问答卡片（第二层，数据已具备）；`bash`「查看完整输出」按钮（§5.2.2） | 变更卡片与全量 todo 状态条不重复；宿主文件读取需独立安全评审 |

阶段之间的依赖：P0 建立协议与注册表，P1–P3 只新增视图，互不阻塞。

## 7. 明确不在本批范围（记录，避免误以为遗漏）

- **Moshi 式 host git diff viewer / 浏览器预览**：那是「按仓库看改动 + 起服务预览」的独立能力层，与本批的「单次工具结果展示」不同轴；
- **审批 / 一键回答**：涉及写回与安全语义，不在展示范围（`ask_user_question` 只做**只读**展示，不做回答入口）；
- **服务端外网代理**（`web_fetch` 全文预览）：D4 已排除；
- **`isError` 的语义调整**：Memoh 的做法是「错误不提升为行状态」，Herzi 现在会把行标红。是否对齐需要单独决策，本方案不改。

## 8. 风险与未知

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| `ffgrep` 的 `:`/`-` 语义 | **已证实**（§9 核对 1），不再是风险 | 解析器仍对未知形状回退纯文本 |
| `read` 首行形状未定性 | 44% 首行含 `[path]` 骨架，可能是文件内容本身（如 Markdown 链接），**不据此做解析** | 只解析尾部摘要行（`[Showing lines …]`） |
| Pi 的 `details` schema 无公开兼容承诺 | 属于实现细节（`details?: any`） | 白名单 + 缺字段降级；schema 变化只影响该工具视图 |
| diff 体积 | `edit` p90 147 字符很小，但 `bash`/`web_fetch` 可到 50KB–229KB | 默认折叠 + 明确「未显示 N 行」；服务端投影前做体积上限 |
| 许可 | Memoh AGPL-3.0；Pi MIT（可参考，但仍自行实现） | 只借鉴设计；不复制代码、文案、样式表 |
| 展示与事实不一致 | 最大的产品风险 | 每一条展示都必须能指回 `args` / `result` / `details` 原文；解析失败展示原文而非近似值 |
| `display` 整体缺累计体积预算 | 逐字段上限成立，但 `ask_user_question` 的 `answers` 嵌套相乘理论上界约 4.3 MB（真实数据 1–4 题，不可达） | 已记为已知限制；如需收敛可加整体字节预算 |
| 既有 `toolCatalog` 表查找的原型链风险 | 已修复（`981c27a`，开发者授权扩范围）：病态工具名（`constructor`/`__proto__` 等）此前可让折叠行整行空白，或抛错使整个 `ChatView` 渲染失败 | 已有测试守卫（`Object.hasOwn`） |

## 9. 实施前核对（已于 2026-09-17 完成，只统计、无正文）

方法：关联 `toolCall.arguments` 与 `toolResult`（207 个 session），只输出计数与比例。

| 编号 | 待核对 | 结论 |
| --- | --- | --- |
| 1 | `ffgrep` 的 `行号:` / `行号-` 语义 | **`:` = 匹配行，`-` = 上下文行**。112 次调用中 103 次显式传 `context`（值 0–120）；不传 `context` 的 9 次结果里 **0 个 `-` 行、9 个全有 `:` 行**。6044 个 `-` 行中 5654 个与某个 `:` 行号距离 ≤12（与多数 `context` 取值吻合） |
| 2 | `edit.details.patch` 的格式与用途 | **标准 unified diff**：460 份样本中 903 个 `@@` hunk、920 个 `---/+++` 文件头行；与展示型 `diff` 并存。`patch` 长度 p50 1397 / max 34378；`diff` 长度 p50 1377 / p90 4192 / max 34503 |
| 3 | `bash.details.fullOutputPath` 的路径归属 | 31 份样本全部绝对路径、父目录 basename 均为 `T`；**0 个在 session cwd 内**；26 个文件已被清理，存活 5 个大小 105KB–690KB。→ §5.2.2 策略已按此修正为「系统临时目录 + 属主 + 体积上限」 |
| 4 | `write` 的 `details` 实际形态 | 263 次调用中仅 2 次非空，且均为**空对象** → 确认 `write` 不可用 details，只从 `args.content` 推导 |

核对脚本位于 `/tmp`（`herzi-verify9.mjs` / `herzi-verify9b.mjs`），未入库；输出仅含键名与计数。

## 10. 完成标准

- 第一层的 8 个工具（`bash` / `read` / `edit`+`write` / `ffgrep`+`fffind` / `web_search` / `web_fetch`，共 6 类视图）的展开区都能回答「这次调用实际发生了什么」，而不需要用户读 JSON；第二层（`todo` / `ask_user_question`）若一并实施，同样满足；
- 每类工具在**缺 `details`、解析失败、结果被截断、调用失败**四种情况下都有合理降级；
- 折叠行、分组规则、`Worked for` 结构**完全不变**；
- 自动测试覆盖解析器与降级路径，且不依赖真实 Pane；
- 不在文档、日志中记录真实文件内容。

## 11. 修订 Rev.2（2026-09-18）：固定高度滚动 + shiki 高亮

### 动因

开发者反馈：现设计「非常不好，而且不美观」—— 默认折叠 200 行、点「展开全部」后一次性渲染几千行，两个极端都不好；而且代码没有语法高亮。

### 对 Memoh 的一手核对（commit `1aaef83`，追加核对）

| 方面 | Memoh 实际做法 |
| --- | --- |
| 长内容 | **不做虚拟滚动**：`max-h-72`(288px) / `max-h-96`(384px) / `max-h-48`(192px) + `overflow-y-auto`，DOM 里仍是全部行 |
| 高亮 | `shiki` 3.23（`apps/web/package.json`），统一 `CodeBlock` 内核；高亮未就绪时先渲染纯文本而非 spinner |
| diff | `useShikiHighlighter` 输出**按行**的 `{kind, lineNumber, html}`；行号 gutter + `−/+` 标记 + 整行红/绿背景带 + 左边缘实心指示条（新文件不加指示条） |
| 统一形态 | `PreviewBox`（`max-h-48 bg-muted/30 rounded-sm px-2 py-1 text-xs whitespace-pre-wrap break-all`），把 5 处漂移的 `max-h` 收敛为一处 |
| 文案与颜色 | 命令前缀 `$`；stderr 用 destructive 红；`text-xs`(12px) + `leading-relaxed` |

依赖体积（unpacked，含全部语言）：shiki 602KB、`@shikijs/core` 64KB、highlight.js 5.5MB、prismjs 2MB、refractor 1MB。Herzi 为 localhost 本地服务，首屏体积不敏感。

### 已确认决策（2026-09-18）

| 编号 | 决策 | 结果 |
| --- | --- | --- |
| R1 | 内容区高度 | **16 行**可视，超出靠滚动 |
| R2 | 虚拟滚动 | **不做**（学 Memoh：仅限高 + 原生滚动） |
| R3 | 「展开全部 / 收起」 | **全部去掉**（含 Markdown 类） |
| R4 | 代码高亮 | **shiki 按需加载**（新增 production dependency，开发者已批准） |
| R5 | 视觉采纳 | diff 行背景带 + 左指示条；行号 gutter 列；命令 `$` 前缀 + 错误红色。**不含**字号/容器皮肤变更（保留现有字号与配色） |
| R6 | Markdown 类（`web_fetch` / `web_search`） | 同一个 16 行窗口 + 原生滚动，去掉展开按钮 |

### 设计

- 统一滚动容器（`src/web/toolViews/` 内共享组件）：高度 = 16 × 行高，`overflow-y: auto`；**行高与容器引用同一个 CSS 变量**，保证「16 行」精确而不是近似。行高沿用现有主题，不因本次修订改字号。
- shiki 集成：`shiki/core` + `createHighlighterCore` + JS 引擎（避免 wasm 静态资源）+ 按需语言/主题；语言由 `args.path` 扩展名推断（`read`/`write`/`edit`），无法推断时用纯文本；高亮异步未就绪时渲染纯文本，尺寸不变以避免跳动。
- 语言覆盖按体积控制：ts / tsx / js / jsx / json / md / py / sh / bash / css / html / yaml / go / rs，其余兑底 `text`。
- diff 行背景带 + 左指示条；`edit` 保留「首个改动在第 N 行」。
- `bash`：命令显示为 `$ <command>`（`$` 用 muted 色），stderr 与错误用红色。
- 变更前后均记录 `npm run build` 的体积差异（可核对）。

### 风险

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| Markdown 类仍全量渲染 | 固定高度只是视觉受限，长正文（p90 21KB）仍在 DOM 里 | 文案明确「共 N 行，可滚动查看」；后续如需再评估虚拟化 |
| shiki 异步加载 | 首屏可能短暂显示纯文本 | 加载中与加载后行高一致，避免跳动；不做 spinner |
| 新依赖 | 改变 `package-lock.json`，与之前契约的「不新增依赖」相反 | 开发者已明确批准本次新增；仅新增 `shiki`，不引入其它库 |
| 16 行的精确性 | 行高不一致会出现 15 或 17 行 | 容器与行共用一个行高变量，并有测试断言 |
