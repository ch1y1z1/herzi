# 第二轮独立复审：F1/F2 修复后的候选

- 状态：待 Reviewer 执行
- 角色：**同一位独立 Reviewer**（`herzi_reviewer2`）
- Candidate：`2c546ee` = 上轮候选 `b201c43` + F1/F2 修复（`c4dd3ed`、`8fe5b3f`）
- 上轮复审记录：`.agents/tasks/20260917-compaction-review.md`（**你的第一轮结论，本轮不要重写它**）
- 上轮结论：可合入、无阻断、无 P0/P1；F1(P2) + F2(P3) 被要求先修，F3–F9 待开发者接受或另行处理

## 本轮范围（只做这些）

### 1. F1（P2）修复是否成立

修复做法（实现者自述，**不采信**）：

- `src/web/styles.css`：`.chat-viewport` 的 `padding-bottom` 改为 `var(--chat-footer-inset, 176px)`；
- `src/web/components/ChatView.tsx` 新增 `useChatFooterInset(viewport, footer, reserveTodoBar)`：用 `ResizeObserver` 观测 `.chat-footer` 与 `.chat-viewport`，把「viewport 底边 − footer 顶边」写回该 CSS 变量；**量不到高度或没有 ResizeObserver 时**回退 `176px`，当存在可见 todo 任务时回退 `176 + 320px`；`Math.max(measured, 176)` 保证不小于原常量。
- `reserveTodoBar` 取「可见（非 tombstone）todo 任务数 > 0」，即**条存在**就按保守值回退，而不是按"展开"。

请独立核对：

1. 回退路径与测量路径是否都不小于原 176px（**只能更可见，不能更差**）；
2. 是否有"永远量不到 → 永远走保守值"的退化（例如 `observer === null` 时 `measureInset()` 直接返回 null 是否合理；真实浏览器是否总能进入测量路径）；
3. 观测是否覆盖真正会变的场景：footer 变高（todo 条展开/收起）、窗口 resize、窄屏 sidebar 变化、Pane 切换；
4. `reserveTodoBar` 用「条存在」而非「展开」是否会造成可见的副作用（例如无 ResizeObserver 环境下折叠态也留出 496px 空白）；
5. 是否有可证伪的测试锁住回退值（jsdom 无布局，请说明它测的是哪一层：CSS 变量写入、还是组件 wiring）；
6. **真实像素测量不在你的权限内**：Integrator 会在开发者开启 Chrome 调试端口后用 browser-use 补测。本轮你只需判断**机制与测试**是否成立，并把「真实遮挡是否消除」明确标为 `NOT RUN（等待 Integrator 证据）`。

### 2. F2（P3）修复是否成立

- `src/shared/todo-tasks.ts`：`isTodoDetails` 是否已放宽为「`tasks` 是数组」即可；`nextId` 缺失/非数字时是否仍产出快照；
- `src/shared/protocol.ts`：本轮对 `nextId` 的类型改动是否**只放宽/新增**，无既有字段语义变化；
- 测试是否覆盖 `nextId` 为 `undefined` / `"4"` / `null` 三种输入并能产出可渲染快照；
- 是否引入新的静默丢弃路径。

### 3. 回归与反向验证

- 独立复跑：`npm run typecheck`、`npm test`、`npm run build`（Integrator 实测为 164 tests PASS，请自行复核）；
- **至少 2 个新变异**，针对本轮修复：
  - 把 `padding-bottom` 改回固定 `176px` → 应有测试失败；
  - 让 `measureInset()` 永远返回 null（或把 `Math.max(measured, 176)` 去掉）→ 应有测试失败；
  - 把 `isTodoDetails` 的 `nextId` 校验加回 → 应有测试失败。
  若某变异**没有**测试失败，请指出这是测试缺口而非"实现无误"。
- 复核上轮已验证过的行为未被本轮修复破坏：顺序（组在正文之前）、分界分段、与 `dc8282c` 的对照——至少抽样你自己上轮的断言复跑一次。

### 4. 上轮 findings 的现状

逐条给出状态：F1 `已修/未修`、F2 `已修/未修`、F3–F9 `未触及`（并确认没有被本轮修复意外改变）。

## 权限与交付

- **只读产品代码**：不得修改 `src/**`、`docs/**`、其它任务记录。
- 只允许写入本文件（`.agents/tasks/20260917-compaction-rereview.md`）并提交。
- 可以：目标测试、`npm run typecheck`、`npm test`、`npm run build`、`git show` 对照、在 `/tmp` 写临时脚本（用完删除，不得留在仓库）。
- 不得：运行 `npm run dev`、操作真实 Pane、merge/rebase/push；**不要动 3041 端口上正在运行的候选服务**（那是 Integrator 为浏览器测量留的）。

## 输出格式

同第一轮：逐条 findings（Severity / File:line / Finding / Why / Evidence / Suggested direction），每项无问题写「已核对无问题」并给出核对方式；单列 `NOT RUN` 与剩余风险；最后给出你对「**现在**能否合入 main」的独立判断（可以合 / 有阻断 / 需要条件）。
