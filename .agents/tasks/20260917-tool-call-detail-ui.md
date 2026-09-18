# 任务契约：工具调用专属展开视图（tool detail views）

- 日期：2026-09-17
- 设计依据：[`docs/tool-call-detail-ui-plan.md`](../../docs/tool-call-detail-ui-plan.md)（**先完整读一遍再动手**）
- Base / branch / worktree：
  - Base（main）：`4b549a1` — `docs: record the tool-call detail UI plan and the four pre-implementation checks`
  - Branch：`agent-20260917-tool-call-detail-ui`
  - Worktree：`/Users/chiyizi/.herdr/worktrees/herzi/agent-20260917-tool-call-detail-ui`
  - Herdr：workspace `w19` / pane `w19:p1`

## 1. 目标

把 Chat 里工具调用的**展开区**从「Arguments / Result 两段裸 JSON」换成按工具类型定制的视图（diff / 代码 / 输出 / 匹配列表 / 结果列表 / 网页摘要 / 任务变更 / 问答）。

**折叠行、分组规则、`Worked for` 层级结构一律不变。** 本任务只改展开区。

## 2. 范围（按顺序推进，每完成一段自测）

### P0：协议 + 服务端投影 + `edit` diff 视图

1. `src/shared/protocol.ts`：新增受限结构（名字可调整，语义不得扩大）：

```ts
export interface ChatDiffLine {
  kind: "add" | "remove" | "context" | "skip";
  lineNumber?: number;   // add/context 用新文件行号，remove 用旧文件行号，skip 无
  text: string;
}

export interface ChatToolDisplay {
  diff?: { lines: ChatDiffLine[]; firstChangedLine?: number; truncated?: boolean };
  truncation?: { truncated: boolean; by?: "lines" | "bytes"; outputLines?: number; totalLines?: number };
  readRange?: { from: number; to: number; total?: number; nextOffset?: number };
  matchCount?: { matched: number; files: number; hasMore?: boolean };
}
```

   tool-call part 增加可选 `display?: ChatToolDisplay`。**`result` 字段语义不变**（仍是原文）。

2. `src/server/pi-session-reader.ts`：投影 `display`（白名单，**不透传整个 `details`**）：
   - `edit` → 解析 `details.diff`（Pi 展示格式，见 §4.1）；
   - `bash` / `read` → `details.truncation`（若存在）；
   - `read` → 解析结果尾部 `[Showing lines A-B of N. Use offset=K to continue.]` 得到 `readRange`；
   - `ffgrep` / `fffind` → `details.totalMatched` / `totalFiles` / `hasMore` 得到 `matchCount`。
3. `integrations/pi/extensions/herzi-bridge.ts`：实时路径产出**同一结构**（否则运行中与完成后显示不一致）。
4. 新增 `src/web/toolViews/`：注册表 + `DiffView`（`edit`）；`toolText.ts` 放纯函数解析器（无 React、无 I/O、可单测）。
5. `ChatView.tsx`：`ToolFallback` 与 `ToolItemRow` 的展开区改为 `toolViewFor(toolName)`；未注册或解析失败 → 现有 `ToolData`/`ToolResultData`。

### P1：`read` 代码视图 + `bash` 输出视图

- `read`：行号（起点 = `args.offset ?? 1`）+ 等宽 + 长文件折叠（默认 200 行）+ 尾部状态行（`已显示 A–B / 共 N 行 · 继续读取 offset=K`）。**注意：实测结果文本不带行号前缀，行号必须由前端按 offset 生成；算不出起点就不要显示行号。**
- `bash`：完整命令（多行）+ 输出（**默认显示尾部 20 行**）+ 截断提示。**不要显示退出码**（实测 0% 文本含 `exit code`，没有就说没有）。

### P2：`ffgrep`/`fffind` 匹配列表 + `web_search` 结果列表 + `web_fetch` 网页摘要

- `ffgrep`：按文件分组（文件路径头 + 命中数），匹配行高亮、上下文行淡化，顶部 `N 处命中 · M 个文件`。解析规则见 §4.1。
- `fffind`：文件路径列表（等宽、可复制）；`hasMore` 时显示「还有更多（第 N 页）」。
- `web_search`：按 `^\d+\.\s+\*\*` 切分为结果条目（标题 + 来源行），顶部 `N 条结果`；切不出条目 → Markdown 渲染原文。
- `web_fetch`：标题（首行 `# `，64% 命中）+ 域名 + 字符数 + Markdown 正文（默认折叠到 40 行 + 展开）；含截断提示时显式标注。

### P2.5：`todo` 变更卡片 + `ask_user_question` 问答卡片

- `todo`：**只显示这一次调用改了什么**（`details.action` / `params` / 受影响任务），**不要**重复 composer 上方那条全量状态条。
- `ask_user_question`：问题 + 选项 + 用户回答 + 是否取消（`details.answers` / `cancelled`）。**只读展示，不做回答入口。**

### 明确不在本批（不要实现）

- **P3 / `bash`「查看完整输出」按钮与任何宿主文件读取**：新增服务端攻击面，单独一批 + 独立安全评审。
- 服务端外网代理、`isError` 语义调整、Moshi 式 host git diff viewer。

## 3. Write set（允许修改）

- `src/shared/protocol.ts`（+ 测试）
- `src/server/pi-session-reader.ts`（+ 测试）
- `integrations/pi/extensions/herzi-bridge.ts`（+ 测试，若有）
- `src/web/toolViews/**`（新目录，含测试）
- `src/web/toolCatalog.ts`（只在需要复用/补充字段时，**不得改变现有折叠行语义**）
- `src/web/components/ChatView.tsx`（+ 测试）
- `src/web/styles.css`
- `.agents/tasks/20260917-tool-call-detail-ui.md`（本文件，追加过程记录）

越界即停工：其他文件一律不动；若认为必须改，先向开发者提问。

## 4. Integrator 已完成的核对结论（**直接采用，不要重新调研，也不要读真实 session**）

1. **`edit.details.diff` 是 Pi 展示格式**（`dist/core/tools/edit-diff.js:272` 的 `generateDiffString`）：每行首字符 `+` / `-` / 空格，后接**右对齐行号**与空格，再是内容；上下文只保留 4 行；被跳过的上下文输出为**空白行号 + `...`**；**没有 `@@` hunk 头**。
   - 实测：460 份样本中 `@@` 出现 0 次；`+` 9928 行、`-` 1783 行、上下文 9367 行；长度 p50 1377 / p90 4192 / max 34503 字符。
   - `details.firstChangedLine` 同时存在，直接用。
   - `details.patch` 是**标准 unified diff**（903 个 `@@`），仅作为回退来源。
2. **`ffgrep` 结果格式**：文件路径头行 + `行号: 内容`（匹配行）+ `行号- 内容`（上下文行）。已由 9 次「未传 `context` 的结果 0 个 `-` 行、9 个全有 `:` 行」证实。
3. **`read` 结果**：文件原文（无行号前缀，实测命中率 1%），截断/续读信息在**尾部** `[Showing lines A-B of N. Use offset=K to continue.]`（命中率 3%）；`details.truncation` 只有 15/980。
4. **`bash`**：无退出码信息（0%）；`details.truncation` 仅 31/5192；文本 p50 717 字符、p90 5412。
5. **`write.details` 实测为空对象**，只能从 `args.content` 推导（新建内容视图，不要假装是 diff）。
6. **`web_search`** 98% 首行匹配 `N. **标题**`；**`web_fetch`** 64% 首行是 `# 标题`，p90 21KB、max 229KB；**`todo`** `details.action/params/tasks` 100% 可用；**`ask_user_question`** `details.answers/cancelled` 100% 可用。

## 5. 硬约束

- **不得虚报**：每条展示都必须能指回 `args` / `result` / `details`；解析不出就不显示该项，退回原文，不猜、不近似。
- **降级是常态**：`read`/`bash` 的 `details` 可用率只有 1.5%/0.6%，`write` 为 0。每个视图都必须有「纯文本也正常」的形态。
- **未知工具永远可渲染**：注册表未收录 → 现有 `ToolData`/`ToolResultData`。
- **不复制第三方代码/文案/样式**：Memoh 是 AGPL-3.0（只借鉴设计）；Pi 是 MIT（可参考行为，本任务按自己的实现写）。
- **不新增 production dependency**。
- **不做破坏性 Git**：不 merge / rebase / push；不改 `main`。
- **不运行 `npm run dev`**（端口与集成态冲突）。
- **不操作真实 Pi/Herdr 业务 Pane**。
- 遇到需求歧义、范围扩大或协议语义变化 → **停下来直接向开发者提问**，不要自行决定。

## 6. 验证要求（全部必须实测并记录）

```bash
npm ci                     # 仅在缺依赖时；不得修改依赖版本
npx vitest run src/web/toolViews src/web/toolCatalog.test.ts src/web/components/ChatView.test.tsx src/server/pi-session-reader.test.ts
npm run typecheck
npm test
npm run build
```

- 测试必须覆盖：每个解析器的**正常输入 + 形状不匹配输入 + 空输入**；`edit` diff 的 `+`/`-`/上下文/`...`/行号对齐；`ffgrep` 的匹配行/上下文行/文件头分组；`read` 尾部摘要的多种写法（含解析失败）；未知工具的注册表回退。
- 结果标记 `PASS` / `FAIL` / `NOT RUN`，写明实际命令。
- **不得**声称完成了真实浏览器或真实 Pane 验收（本批不要求也不授权）。

## 7. 记录要求

在本文件追加「过程与决策」「验证与交接」两节：做了什么、遇到的歧义与如何（向谁）解决、每个命令的 PASS/FAIL、剩余风险与未验证项。完成后保持 worktree clean，提交 1–3 个清晰 commit，留在 Pane 等开发者通知 Integrator。
