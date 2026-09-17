# 独立复审：压缩分界 + todo 状态条（含上一轮回归修复）

- 状态：待 Reviewer 执行
- 角色：**独立 Reviewer**（与实现者、与修复者均非同一 Agent）
- Candidate：`b201c43` = 当前 `main`（`25a72ab`）+ 合并 `agent-20260917-compaction-fix`
- 待审范围：相对 `25a72ab` 的全部改动（即被撤回的那版功能 + 本轮的顺序修复与自查记录）
- 设计依据：`docs/chat-compaction-todo-askuser-plan.md` §2 / §4 / §8
- 修复者自查记录：`.agents/tasks/20260917-compaction-fix.md`（**可以读，但不得作为结论依据**）
- 事故记录：`.agents/tasks/20260917-compaction-todo-batch.md`

## 背景

这版功能**上上次曾被合入 main 并被撤回**：原因是未经开发者批准就合入，且存在回归——`Worked for` 组渲染到了正文下方（正确应为组在正文之前）。开发者随后要求：先由新 Worker 做系统性自查 + 修复，再由**独立 Reviewer** 复审。

修复者声称：
- 已修 B1（组插入位置），并新增 DOM 顺序断言；
- 该断言在 `9af9eac`（旧实现）上失败、在 `dc8282c`（回归前基线）上通过；
- 无分界情形的 11 个形状与 `dc8282c` 逐字段一致；
- 自查覆盖顺序 / 分段 / 分界位置 / todo 条 / 回归对照 / 降级诚实性六类。

**这些claim都不采信，请自行验证。** 尤其注意：修复者的测试是它自己写的，可能存在"把测试写成迁就实现"。

## 复审重点（按优先级）

1. **顺序正确性（最高优先）**：独立构造完成态 turn，验证 DOM 顺序恒为
   `… → 组 → 正文`、有分界时为 `组 → 横线 → 组 → 正文`；
   特别检查：正文在中间、末尾、多段正文、只有一段正文、无正文只有工具、图片在末尾等形状。
   不要复用修复者的 landmark 辅助函数；请用你自己的方式取 DOM 顺序。
2. **分界语义**：分界是否真的把组切断；分界前后各自的"最后输出"判定是否独立；分界在 turn 开头/结尾/连续多条时是否产生空组或吞掉正文；`firstKeptEntryId` 缺失/不在分支上时行为。
3. **回归对照**：与 `dc8282c`（回归前已批准状态）逐项对照**无分界、无 todo** 的既有行为（组位置、组内容、时长、空 turn、运行中不折叠等）。命令建议：`git show dc8282c:<path>` 或临时 worktree。
4. **todo 条**：计数与分组、`activeForm`、tombstone 不显示、未知 status、`blockedBy` 指向不存在 id、`truncated` 降级、空/无快照不占位；是否影响布局或遮挡 composer。
5. **诚实性**：所有近似/降级是否写清（借用 `createdAt` 当排序锚点、每段共用整轮时长、`at: 0` 共享展开状态等）；有没有把"未验证"写成"已验证"。
6. **测试质量**：新增断言是否真能抓住回归（至少挑 2 条做反向验证：改坏实现后该测试必须失败）；是否存在只断言类名计数而不看相对顺序的弱断言。
7. **越界与风险**：改动是否只落在契约 write set；`protocol.ts` 是否只做了新增；有无影响 realtime、轮询去重、Pane 切换的副作用。

## 权限与交付

- **只读产品代码**：不得修改 `src/**`、`docs/**`、其它任务记录。
- 只允许写入本文件（`.agents/tasks/20260917-compaction-review.md`）并提交。
- 可以：`npm ci`、目标测试、`npm run typecheck`、`npm test`、`npm run build`、用 `git show`/临时 worktree 对照基线、写临时脚本（放 `/tmp`，用完删除，不得留在仓库）。
- 不得：运行 `npm run dev`、操作真实 Pi/Herdr 业务 Pane、merge/rebase/push。
- 机器上已装好依赖（`npm ci` 已在本候选树跑过；`typecheck` / `157 tests` / `build` 均 PASS，可作为对照，但请独立复跑关键项）。

## 输出格式

逐条 findings，按严重程度排序，每条必须包含：

```
Severity: P0/P1/P2/P3
File: path:line
Finding: 可观察的问题
Why: 触发条件与影响
Evidence: 复现命令或 DOM 断言（不要只写"看起来"）
Suggested direction: 修复方向
```

若某重点项未发现问题，明确写「已核对无问题」并给出核对方式。最后列出：`NOT RUN` 项、剩余风险、以及你对"是否可以把候选合入 main"的独立判断（可以合 / 有阻断 / 需要条件）。
