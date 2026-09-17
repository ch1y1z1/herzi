# 实施精简 Agent 组织方案

- 目标：落实用户认可的精简 Agent 组织方式。
- 修改范围：`AGENTS.md`、`CLAUDE.md`、`.agents/tasks/`、`docs/agent-organization-design.md`、`docs/README.md`。
- 验收条件：统一规则源生效；Claude 只导入 `AGENTS.md`；过程记录可位于项目内合适位置；方案和索引与实施一致；不修改产品代码。
- Base / branch / worktree：当前 `main` 工作区；本轮开始前已存在用户文档改动，全部保留且不回退。

## 过程与决策

- 用户澄清：“所有过程进入 docs”原意是所有过程必须有文件记录，并非所有记录必须位于 `docs/`。
- 选择 `.agents/tasks/` 保存并行任务的短期执行记录；长期架构、研究和项目状态仍保留在 `docs/`。
- 根 `AGENTS.md` 作为跨 Agent 唯一规则源；`CLAUDE.md` 只使用 `@AGENTS.md` 导入。
- 不引入 Skill、task board、状态数据库、脚本或 CI。
- 本轮仅实施最小规则层，不启动多 Agent 试运行，不创建或清理 Herdr worktree。
- 用户进一步确认主控沟通方式：普通需求无需反复声明角色；并行任务推荐“先提交拆分与 Worker prompt、用户确认后再创建 worktree 并发送 prompt”的两阶段授权，合入 `main` 仍单独确认。具体话术已补入设计文档第 13 节。

## 验证与交接

- `git diff --check`（跟踪文件及本轮新增文件）：PASS。
- 本地 Markdown 链接检查：PASS。
- `CLAUDE.md` 精确内容和单行检查：PASS，内容仅为 `@AGENTS.md`。
- `AGENTS.md`、设计文档和任务记录标题层级检查：PASS。
- `AGENTS.md` 为 66 行，符合精简目标。
- 首次 stale-text grep 把 `AGENTS.md` 中有意写入的“**不再要求**所有记录都位于 docs”识别为命中；这是检查表达式的误报，不是文档缺陷，已改用只检查旧状态措辞的查询。
- 未运行 `npm run typecheck`、`npm test` 或 `npm run build`：本轮只修改协作规则和 Markdown，没有修改产品代码或构建配置。
- 未创建、操作或清理 Herdr worktree；真实并行试运行仍是下一阶段。
