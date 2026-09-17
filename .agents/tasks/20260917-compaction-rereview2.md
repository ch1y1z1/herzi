# 第三轮（聚焦）复审：F-A/F-B/F-D/F-E 小补丁

- 状态：待 Reviewer 执行
- 角色：**同一位独立 Reviewer**（`herzi_reviewer2`）
- Candidate：`3721dd6` = 上轮候选 `2c546ee`（含 `f9f5c5a` 第二轮记录）+ 小补丁 `0795d9f` / `ef8d890`
- 上轮记录：`.agents/tasks/20260917-compaction-rereview.md`（**不要重写它**）
- 上轮结论：可合入、无阻断；新 findings 全为 P3（F-A/F-B/F-C/F-D/F-E），开发者选择"先打小补丁再合"

## 本轮范围（聚焦，只复核这 4 条 + 回归）

实现者自述的补丁内容（**不采信**，逐条独立验证）：

| 编号 | 声称的修法 |
| --- | --- |
| F-D | `useChatFooterInset` 的 dependency effect 由 `useEffect` 改为 `useLayoutEffect` |
| F-A | 新增断言：**观察 `.chat-footer` 的那个 observer 必须同时观察 `.chat-viewport`**（不是"存在某个观察 viewport 的 observer"） |
| F-B | 新增 teardown 断言：unmount/`cleanup()` 后所有观察过 `.chat-footer` 的 observer 都已 `disconnect()` |
| F-E | 样式表断言改为 `path.join(import.meta.dirname, "../styles.css")`，不再依赖 `process.cwd()` |

请独立核对：

1. **F-D 是否真的改成 layout timing**（读代码确认，不是读注释）；并判断**是否存在能证伪它的测试**——若 jsdom 无法区分 `useLayoutEffect` 与 `useEffect`，请明确写"该点只能代码审阅确认，浏览器可见性 NOT RUN"，并说明**如果实现者写了假测试你要指出来**。
2. **F-A 的断言是否真的绑在"观察 footer 的那个 observer"上**：用你自己的变异（删掉 `observer.observe(viewport)`）确认它失败；并确认它不会因为 assistant-ui 自己也观察 viewport 而假通过。
3. **F-B 的断言能否抓住 teardown 回归**：变异（`return () => undefined;`）后必须失败；同时确认该断言不会把 assistant-ui 的 observer 误判成本组件的。
4. **F-E 是否真的与 cwd 解耦**：请在**非仓库根 cwd** 下运行该用例（例如把工作目录切到 `/tmp` 用配置指向候选树，或等价方式）确认仍能读到被测树的 `styles.css`；并确认它读的是**被测树**的 CSS（用变异改 CSS 应能被抓住）。
5. **回归**：独立复跑 `typecheck` / `npm test` / `npm run build`（Integrator 实测 166 tests PASS，不许采信）；至少抽样复跑你前两轮的顺序/分段/`dc8282c` 对照断言；确认本轮补丁没有改动 F1 的测量语义（下界、变量名、CSS 契约）。
6. **越界**：本轮补丁只应落在 `ChatView.tsx`、`ChatView.test.tsx`、任务记录；请确认。

## 权限与交付

- **只读产品代码**；只允许写本文件（`.agents/tasks/20260917-compaction-rereview2.md`）并提交。
- 可以：目标测试、`npm run typecheck`、`npm test`、`npm run build`、`git show`/临时树对照、在 `/tmp` 写临时脚本（用完删除，不得留在仓库）。
- 不得：运行 `npm run dev`、操作真实 Pane、merge/rebase/push。
- 上一轮你已用 `/tmp/rr` 做过临时树与变异，可以复用同样的做法（若目录已清理请重建）。

## 输出

- 逐条给出 F-A/F-B/F-D/F-E 的结论：`已闭合` / `未闭合` / `有条件闭合`，每条附 `path:line` 与证据（变异结果或命令输出）。
- 单列 `NOT RUN` 与剩余风险。
- 最后给出独立判断：**现在能否合入 `main`**（可以合 / 有阻断 / 需要条件）。
