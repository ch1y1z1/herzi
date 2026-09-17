# Chat 过程展示增强（thinking / tool call 语义化）— Worker 任务契约

- 状态：**已实现并自测通过（2026-09-17），待 Integrator 集成与复验**
- 角色：Worker（单 Agent）
- Base：`a28176e`（`main`，已包含方案文档与 D1–D6 确认结果）
- Branch：`agent-20260917-tool-presentation`
- Worktree：`/Users/chiyizi/.herdr/worktrees/herzi/agent-20260917-tool-presentation`
- 设计依据：`docs/chat-tool-presentation-plan.md`（**先完整读这一份**）

## 目标

把 Chat 中 `Worked for` 组内的 thinking / 工具调用从「工具名 + 92 字截断预览」升级为可读的语义化呈现，使折叠行与组内行能回答「做了什么、对什么做、规模多大、净改动多少」。

保留**单一 `Worked for` 组**，不改分组规则。

## 已确认决策（必须遵守）

| 编号 | 决策 |
| --- | --- |
| D1 | 文件类计数按**唯一路径**去重（`edit` / `write`）；`searches` / `commands` 按调用次数 |
| D2 | `todo` **不计入**汇总计数（组内仍然显示行） |
| D3 | thinking 时长由**服务端**用相邻 entry 时间戳近似；算不出就不显示时长（不编造） |
| D4 | thinking 预览**维持单行**（`shortPreview`） |
| D5 | **做**展开状态持久化；**不做** live peek |
| D6 | 单 Worker，实现 P0 + P1 + P2 + P3（仅持久化部分） |

## 允许修改的文件（write set）

新增：

- `src/web/toolCatalog.ts`（工具目录）+ `src/web/toolCatalog.test.ts`
- 展开状态持久化模块（例如 `src/web/panelOpenState.ts`）+ 对应测试

修改：

- `src/web/components/ChatView.tsx`（组头与工具行改用目录与汇总；接展开状态）
- `src/web/styles.css`（动作词/目标两列、等宽目标、组头 diff 合计等）
- `src/server/pi-session-reader.ts` + 其测试（reasoning 时长）
- `src/shared/protocol.ts`（仅新增可选字段，例如 reasoning part 的 `durationMs`）
- 本任务记录（本文件）

## 禁止

- 不改变分组规则（保留单一 `Worked for` 组），不新增组外重复展示。
- 不新增或修改任何 HTTP/WS 接口行为；`protocol.ts` 只允许**新增可选字段**。
- 不做 live peek、不引入 i18n 框架、不新增 production dependency。
- 不修改 `docs/` 下的既有文档（结论写在任务记录里，由 Integrator 汇总）。
- 不运行 `npm run dev`；不操作真实 Pi/Herdr 业务 Pane；不 merge / rebase / push。

## 验收条件

1. 组内每一行能回答「做了什么、对什么做」：`bash` 显示命令首行、`read` 显示文件名（区分图片/PDF/区间）、`edit`/`write` 显示文件名与 `+N −M`、`web_search` 显示 `"query"`、`web_fetch` 显示 hostname、`ffgrep`/`fffind` 显示 pattern。
2. 组头为两段式：阶段动词（时态随流式变化）+ 固定顺序的计数（文件操作 → 搜索 → 命令 → 步骤），完成后显示 diff 合计；无工具时退回 `Worked for Xs`。
3. `todo` 不出现在汇总计数中，但组内仍有其行。
4. 未收录工具、缺参数、失败调用三种退化都能合理渲染，不出现空行或 `undefined`。
5. thinking 行在有相邻时间戳时显示 `已思考 Ns`；同一消息内多条 reasoning 或无法判定时退回现有 `Thinking`，不编造。
6. 流式期间展开的组/行，在 turn 结束后（组件重挂载）保持展开状态。
7. 未知工具与未来工具不因未收录而消失。

## 必须运行的验证

- 目标单测（目录映射表驱动、汇总函数、diff 计算、退化场景）
- 组件测试（组头文案与 diff 合计、行渲染与 tooltip、未知工具兜底、展开状态持久化）
- `npm ci`（若 worktree 无 `node_modules`）
- `npm run typecheck`
- `npm test`
- `npm run build`

所有结果明确标记 `PASS` / `FAIL` / `NOT RUN`，并记录实际命令。

## 交付要求

- 一个或少量清晰 commit；不要 merge / rebase / push。
- 更新本任务记录：实际改动、关键决策、验证命令与结果、未决问题。
- 真实浏览器视觉验收无法自行完成时标 `NOT RUN`，不声称完成。
- 结束后留在本 Pane，由开发者手动通知 Integrator 进行集成。

## 备注

- 界面文案为中文硬编码，沿用现状。
- Memoh 为 AGPL-3.0：**只能借鉴设计，不得复制其源码或文案**；所有词表与实现自行编写。
- 摘要只能来自真实参数，禁止推测；无法判定时使用中性词（例如 `N 步`）。

---

## 实施记录（Worker，2026-09-17）

状态：已实现，目标单测 / 组件测试 / typecheck / 全量测试 / build 均通过；真实浏览器视觉验收 NOT RUN。

### 一、实际改动（全部在 write set 内）

| 文件 | 改动 |
| --- | --- |
| `src/web/toolCatalog.ts`（新） | 工具目录与汇总纯函数（无 React 依赖）：`describeToolCall()`（action / target / fullTarget / bucket / fragment / diff / variant / dedupeKey）、`summarizeToolRun()`、`toolRunVerb()`、`formatToolCounts()`、`toolRunDiff()`、`editDiff()`、`countLines()`、`argsTarget()` |
| `src/web/toolCatalog.test.ts`（新） | 表驱动 17 例：真实工具映射、read 变体、命令截断与 tooltip、缺参数/未知工具退化、diff 计算、汇总顺序、D1 去重、D2 排除、bucket 表决与并列、运行中隐藏 diff |
| `src/web/panelOpenState.ts`（新） | 展开状态：`createPanelOpenStore()`（LRU 300，按写入时间淘汰）、`panelOpenStore(scope)`（每 pane 一个，跨 remount 存活）、`usePanelOpenState()`（`useSyncExternalStore`）、`PanelOpenScopeContext`、`toolPanelKey` / `groupPanelKey` / `reasoningPanelKey` |
| `src/web/panelOpenState.test.tsx`（新） | 9 例：默认折叠、只在值变化时通知、LRU 淘汰、pane 之间不串状态、键的前缀稳定性、组件重挂载后仍展开 |
| `src/web/components/ChatView.tsx` | 组头改为「阶段动词 + 固定顺序计数 + diff 合计」；工具行改用目录（动作词/目标两列、tooltip、`+N −M`）；thinking 行接服务端时长；组与行改为受控 `<details>` 并接持久化；`ActivityGroupData` 与 tool-group 增加稳定 `id`；`ToolFallback` 与组内行共用 `ToolRowSummary`（保持原有图标尺寸） |
| `src/web/styles.css` | 新增 `.tool-action` / `.tool-target` / `.activity-counts` / `.tool-diff` / `.activity-diff` / `.diff-add` / `.diff-remove`；`.tool-card summary strong` 去掉等宽字体（该位置现在是中文动作词） |
| `src/server/pi-session-reader.ts` | `reasoningDurationsByEntry()` + `attachReasoningDuration()`（D3 近似） |
| `src/shared/protocol.ts` | `ChatPart` 的 reasoning 分支新增可选 `durationMs`（唯一协议改动，未改任何 HTTP/WS 行为） |
| `src/server/pi-session-reader.test.ts` | 5 例：相邻时间戳近似、用户等待时间封顶、分支末尾用本条写入时间、同消息多条 reasoning 退化、无时间戳退化 |
| `src/web/components/ChatView.test.tsx` | 6 例：组头文案与 diff 合计 + 行渲染与 tooltip、二级工具组同一套文案、未知工具/缺参数/失败调用退化、thinking 时长与 `Thinking` 退化、流式 `思考中`、行与组的展开状态跨 turn 结束保持 |

未改动：分组规则（仍是单一 `Worked for` 组）、`docs/` 下既有文档、任何 HTTP/WS 接口、依赖清单。未新增 production dependency。

### 二、关键实现决策

1. **D1 口径（开发者确认）**：只有 `edit` / `write` 设 `dedupeKey = file:<path>` 并按唯一路径去重；`read` 归入 `fileOperations` 但按调用次数计数；`searches` / `commands` 按调用次数。
2. **D2 的解释**：`todo` 的 `fragment = null`，既不进计数，也**不参与阶段动词表决**。理由：D2 的原文是「todo 不计入汇总」，而阶段动词属于汇总；方案 §4.2 的表决规则未排除它，若不排除，真实会话里 todo 会经常把动词压成「已处理」，违背 D2 的意图。此偏差已在此记录，便于复核。
3. **D3 口径（开发者确认）**：`durationMs = min(本条 entry 写入时间, 下一条 entry 起始时间) − 本条 createdAt`，只取真实时间戳，且必须为正；同一消息内有多条 reasoning、或时间戳不可用时不下发该字段（前端退回 `Thinking`）。实时流式回合的 reasoning 来自 realtime 通道，暂不参与（不在 write set 内）。
4. **阶段动词并列顺序**：`edit > run > browse > other`（在同一票数时取更有结果意义的动作）；无任何可计数项（只有 todo）时退回中性的 `已处理`。
5. **组头文案**：有工具行时为两段式「动词 + 计数」+ 完成态的 diff 合计；无工具行时保留原 `Worked for Xs`。总时长不再直接占位，改为挂在组头 `summary` 的 tooltip 上（方案 §4.3 的两段式设计），未新增第二处总时长展示。
6. **`write` 的 diff**：只计 `+content 行数`，remove 恒为 0（方案 §4.1 表），不声称删除了旧内容；`edit` 的多段 `edits[]` 累加，`newText` 为空时显示 `−N`。
7. **`variant` 是目录元数据**：read 的 image/pdf/range 区分通过动作词（`读取图片` / `读取文档`）与目标后缀（`· 第 100–199 行`）呈现，`variant` 本身不直接渲染。
8. **行首图标保持统一 `Wrench`**：按方案 §4.4 的行样式（每行同一图标），未引入 per-tool 图标，`toolCatalog` 因此保持无 React 依赖、可纯函数单测。
9. **未知工具**：动作词 = 工具名原文、目标 = 现有参数预览（`path/file/command/cmd/query/q/url/pattern/description` 优先，否则 JSON），计 1 步；缺参数时目标同样退回参数预览，保证任何行都不会空白或出现 `undefined`。
10. **展开状态键**：工作组 `work:<turn 首条消息 id>`（`DisplayMessage.id` 会随流式增长，故不用它）、工具组 `tools:<首个 toolCallId>`、工具行 `tool:<toolCallId>`、thinking 行 `reasoning:<归一化文本前 64 字>`。thinking 在流式期间拿不到稳定 id（`MessagePartState` 不含 id/index），用文本前缀保证「同一条 reasoning 继续增长时键不变」。

### 三、验证命令与结果

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm ci` | **PASS** | worktree 初始无 `node_modules`；使用锁文件，未修改依赖版本 |
| `npx vitest run src/web/toolCatalog.test.ts` | **PASS** | 17 tests |
| `npx vitest run src/web/panelOpenState.test.tsx` | **PASS** | 9 tests |
| `npx vitest run src/server/pi-session-reader.test.ts` | **PASS** | 8 tests（含 3 个既有用例） |
| `npx vitest run src/web/components/ChatView.test.tsx` | **PASS** | 15 tests（含 9 个既有用例） |
| `npm run typecheck` | **PASS** | `tsc --noEmit` 无输出 |
| `npm test` | **PASS** | 13 files / 100 tests |
| `npm run build` | **PASS** | typecheck + `tsup` server + `vite build`（仅有既存的 chunk 体积提示） |
| 真实浏览器视觉验收 | **NOT RUN** | 按规范未运行 `npm run dev`、未操作真实 Pi/Herdr Pane；两列布局、等宽目标、diff 配色只在 jsdom + CSS 层面检查 |

未运行：任何真实 Pane / session / GUI 验收；未使用合成 snapshot 之外的会话数据（测试数据全部是本任务手写的 fixture）。

### 四、未决问题与限制

1. **视觉验收缺口**：两列对齐、target 截断、diff 颜色与组头右侧对齐只经过组件测试与 CSS 静态阅读，需要 Integrator 在真实浏览器里确认（不做进 summary 也可）。
2. **实时回合的 thinking 时长**：时长只在 transcript 投影（`PiSessionReader`）里计算；正在流式的回合仍显示 `思考中`，回合结束后才可能显示 `已思考 Ns`。若要流式期间就有数字，需要改 realtime 通道（超出本次 write set）。
3. **组头不再直接显示总时长**：按方案 §4.3 的两段式执行，时长移到 tooltip；如果开发者希望总时长继续可见，这是一个一行的改动，但属于产品决策，未自行决定。
4. **thinking 展开键的前缀限制**：文本不足 64 字且继续增长时，键会在跨过 64 字时改变，展开状态可能丢失；完整文本（≥64 字）与 turn 结束后的同一行键一致。
5. **LRU 上限 300（每 pane）**：超出后最早写入的展开项会被淘汰；不做持久化到 localStorage。
6. **`variant` 字段目前没有消费方**，仅作为目录元数据与单测断言使用。

### 五、给 Integrator 的提示

- 本分支只有 1 个待集成 commit，未 merge / rebase / push。
- 合并态建议复跑：`npm run typecheck`、`npm test`、`npm run build`；若同时集成其他 Worker 的 `ChatView.tsx` / `protocol.ts` 改动，冲突点集中在 `ChatView.tsx` 的组头与工具行渲染、以及 `protocol.ts` 的 `ChatPart` 定义（本任务只做可选字段新增）。
- 不要在本任务里改分组规则：`Worked for` 仍是唯一组。
