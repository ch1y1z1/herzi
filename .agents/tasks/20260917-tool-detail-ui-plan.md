# 任务记录：工具调用专属展示方案（设计）

- 日期：2026-09-17
- 类型：设计（未实施，未改产品代码）
- 交付：`docs/tool-call-detail-ui-plan.md`（方案正文）+ `docs/README.md` 索引与结论条目

## 需求

用户要求为工具调用增加 UI 展示（edit、search、fetch 等），参考 Moshi Desktop 与 Memoh，输出一份方案设计。

## 已向用户确认的决策

1. 覆盖范围：高频三件套（`bash`/`read`/`edit`+`write`）**加** search 与 fetch（`ffgrep`/`fffind`/`web_search`/`web_fetch`）；另要求补充调研 Memoh 的适配清单。
2. 允许只读真实 Pi session JSONL 做**结构统计**（不允许输出/记录正文）。
3. 视觉：延续现有紧凑折叠行，只替换展开区。
4. 数据边界：允许服务端按需读取宿主文件（用于「展开全部」），不允许服务端代理外网。

## Agent 决定（2026-09-17，用户追问「决定为哪些 toolcall 做适配 ui」后给出）

判据：实测调用量 + 是否有可靠结构化数据 + 展开后是否真的比 JSON 好读。

- **第一层必做（8 个工具名 / 6 类视图）**：`bash`、`read`、`edit`+`write`、`ffgrep`+`fffind`、`web_search`、`web_fetch`。
- **第二层建议一并做**：`todo`（只展示本次调用的变更，不重复 composer 上方的全量状态条）、`ask_user_question`（只读问答卡片，不做回答入口）——两者的 `details` 均 100% 可用，成本接近零。
- **不做**：`bg_delegate` / `bg_result`（各 1 次、扩展私有 schema）、未来 MCP/未知工具 → 通用降级（工具名 + target + Arguments/Result + 长文本折叠与复制）。
- **不照搬 Memoh 的 50 个清单**：其中大半是 Memoh 自身产品的 agent 能力（邮件/日程/媒体/GUI/浏览器/远程会话/spawn agent），Herzi 作为 Pi 会话 viewer 为不存在的工具写视图无收益；只采纳其原则。

展示细节、ASCII 形态与逐工具降级链见 `docs/tool-call-detail-ui-plan.md` §5.4。

## 调研方法（可复现）

在 `/tmp` 下的三个临时脚本（未入库），只读 `~/.pi/agent/sessions/**/*.jsonl`：

- `herzi-toolstruct.mjs`：按 `toolName` 聚合 `details` 键名与次数、`content` 形状、文本行数分布、预定义形状正则命中率。
- `herzi-format.mjs`：逐行形状命中率（区分首行/后续行）。
- `herzi-ffgrep.mjs` / `herzi-probe.mjs`：`ffgrep` 行形状细分与 `edit.details.diff` 结构统计。

所有输出仅含键名、计数、比例与**脱敏骨架**（字母→`a`、数字→`9`），无正文；未把样例内容写入任何仓库文件。

Pi 侧参考来自本机 `@earendil-works/pi-coding-agent` 的 `dist/core/tools/renderers/*`、`dist/core/tools/edit-diff.js`、`docs/session-format.md`（MIT）。Memoh 侧为 `memohai/Memoh` commit `1aaef83` 的 `tool-call-registry.ts`（临时拉取到 `/tmp/memoh-registry.ts`，AGPL-3.0，只读）。

## 关键核对结果

- `edit.details.diff/patch/firstChangedLine`：454/481 次可用；格式为 `+行号 内容` / `-行号 内容` / 空格=上下文，**无 `@@` hunk 头**。
- `ffgrep.details.totalMatched/totalFiles`：112/112；文本为「文件路径头 + `行号: 内容`/`行号- 内容`」（后者的语义为**推断**，见方案 §8/§9）。
- `todo.details.tasks` 1019/1019、`ask_user_question.details.answers` 71/71（数据完备，列为 P2 候选）。
- `read.details.truncation` 15/980、`bash.details.truncation` 31/5192：基本不可用，需 args 推导 + 尾部摘要解析。
- `bash` 文本中 **0%** 命中 `exit code`：不显示退出码。
- 服务端已在读 `message.details`（`src/server/pi-session-reader.ts:180`，用于 `todo`），证明 `details` 确实落进 JSONL。

## 未完成 / 未决

- 方案未获实施授权，未排期。
- §9 的四项实施前核对未做（`ffgrep` 的 `:`/`-` 语义、`edit.details.patch` 用途、`fullOutputPath` 的工作目录归属、`write` 的 2 次 details 样本）。
- `isError` 是否对齐 Memoh 的「错误不提升为行状态」未决策。
- 未做浏览器视觉验证（本任务未改代码）。
