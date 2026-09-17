# Worker 任务契约：压缩分界 + todo 状态条的系统性自查与修复

- 状态：已派发
- 角色：Worker（单 Agent，**新 Agent，不是原实现者**）
- Base：`9af9eac`（原实现 commit，位于分支 `agent-20260917-compaction-todo`）
- Branch：`agent-20260917-compaction-fix`
- Worktree：`/Users/chiyizi/.herdr/worktrees/herzi/agent-20260917-compaction-fix`
- 设计依据：`docs/chat-compaction-todo-askuser-plan.md` §2 / §4 / §8
- 原任务契约：`/Users/chiyizi/.herdr/worktrees/herzi/agent-20260917-compaction-todo/.agents/tasks/20260917-compaction-todo.md`（可读，勿改）
- 事故记录：`.agents/tasks/20260917-compaction-todo-batch.md`

## 背景（必读，决定了本任务的性质）

上一版实现（`9af9eac`，就是你现在的 base）**未经开发者批准就被合入 main，随后被发现质量不合格并被撤回**。开发者已确认：本批次必须做**系统性自查 + 修复**，然后由**独立 Reviewer** 复审，再向开发者请求批准。

已知缺陷（已复现）：

**B1 `Worked for` 组渲染到了正文下方。**
- 现象：一个完成 turn `thinking → tool → 最终文本`，渲染顺序变成 `文本 → Worked for 组`，正确顺序应是 `组 → 文本`。
- 证据：探针量到 `activity-group index 347`、`final text index 315`；`body.textContent` 为 `问题 → 这是最终答复 → 已运行1 条命令 Thinking…`。
- 根因：`combineAssistantTurn` 改成「循环结束后 `if (items.length) pushWorkGroup(segment, items)`」，而改动前是在**第一个被吸收的 work part 处**插入组，于是组落到 content 末尾。
- 测试缺口：现有测试**没有**断言「组与正文的相对顺序」，所以 137 个测试全绿也没抓住。

## 任务

### 一、系统性自查（必须逐项做，并把结论写进任务记录）

对 `9af9eac` 引入的全部改动做一次从头到尾的行为审计，至少覆盖：

1. **顺序**：组与正文、组与分界、组与图片、组与工具行的相对顺序；多段（有分界）时的顺序；`groupConsecutiveTools()` 在分段后的行为。
2. **分段**：分界在 turn 开头/中间/结尾；连续多条分界；分界恰好是 turn 最后一条消息；分界与 `activityLimit`（最后一个输出）交叉时的归属是否正确（分界不能把正文吸进组，也不能把 work part 留在组外）。
3. **分界位置**：`firstKeptEntryId` 在分支上 / 不在 / 缺失三种情况；分界消息借用相邻消息 `createdAt` 的排序是否在轮询、realtime 合并、Pane 切换下稳定；一个 turn 里多个分界时 segment id 是否唯一。
4. **todo 条**：快照为 `pending/in_progress/completed` 混合、只有 tombstone、未知 status、`blockedBy` 指向不存在 id、降级（`truncated`）时的渲染；空/无快照不占位；与非 Pi Pane、未识别 Pane 共存时不影响布局。
5. **回归**：无压缩、无 todo 时的原有行为是否与 `dc8282c` 完全一致（**用 `dc8282c` 作对照基线**，而不是凭记忆）。
6. **降级与诚实**：所有近似是否都写清楚（不得把借用时间戳当真实压缩时间、不得按分界切分造时长、不得猜 todo 状态）。

自查结论必须写成「发现 / 证据（命令或 DOM 断言）/ 是否修复」的列表；**没问题也要写"已核对无问题"**，不允许只写结论。

### 二、修复

- 修掉 B1，并修掉自查中发现的所有其它缺陷。
- **必须补上能证伪的测试**，至少包含：
  - **DOM 顺序断言**：`组出现在最终正文之前`（修复前必须失败，请实际验证一次）；
  - 分段/顺序组合：有分界时的顺序是 `组 → 横线 → 组 → 正文`；
  - 分界在 turn 末尾时仍是 `组 → 横线`，不额外造组；
  - 降级路径（快照 truncated、无 todo、无分界）不产生占位或空行。
- 既有 117 个测试以及本批次原有测试必须全部继续通过。

### 三、约束

- write set：`9af9eac` 触动的那些文件（`src/server/pi-session-reader.ts`(+test)、`src/shared/protocol.ts`、`src/shared/todo-tasks.ts`、`src/web/components/ChatView.tsx`(+test)、`src/web/styles.css`），本任务记录，以及你新增的测试文件。**不要改** `toolCatalog.ts` / `panelOpenState.ts` / `turnActivity.ts` / `pane-activity.ts` / `src/server/index.ts` / `pi-realtime.ts` / `integrations/`。
- 可以（也应该）参考 `dc8282c` 的既有行为作为回归基线：`git show dc8282c:src/web/components/ChatView.tsx`。
- 不运行 `npm run dev`；不操作真实 Pi/Herdr 业务 Pane；不 merge / rebase / push；不新增 production dependency；不为让测试变绿而弱化断言。
- **不要合入 main**；你的分支就是候选，后续由独立 Reviewer 复审、再由开发者批准。

## 验证要求

```bash
npm ci            # 若 worktree 无 node_modules
npx vitest run <涉及的目标测试>
npm run typecheck
npm test
npm run build
```

结果明确标记 `PASS` / `FAIL` / `NOT RUN`；对 B1 的顺序断言请给出「修复前失败 / 修复后通过」两次实测输出。

## 交付

- 一个或少量清晰 commit。
- 任务记录中给出：自查清单与逐项结论、每个缺陷的证据与修复方式、两次可证伪验证、未决限制。
- 完成后留在本 Pane；开发者会通知 Integrator 安排独立 Reviewer。
