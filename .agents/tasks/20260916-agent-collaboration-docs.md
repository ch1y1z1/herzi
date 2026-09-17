# 编写 Agent 协作流程与开发者指南

- 目标：把已经确认并实际试运行的 Agent 协作方式整理为一份项目流程和一份开发者使用说明。
- 修改范围：`docs/agent-collaboration-workflow.md`、`docs/developer-agent-guide.md`、`docs/README.md`、本任务记录。
- 验收条件：流程与当前 `AGENTS.md`、精简设计和实际 Herdr 批次一致；开发者有可直接复用的话术；链接和 Markdown 结构检查通过。
- Base / branch / worktree：当前 `main` 工作区；保留已有未提交文档和规则改动，不操作运行中的 Reviewer worktree。

## 过程与决策

- 协作流程面向项目维护者，说明角色、状态转换、worktree 拓扑、验证、review、批准和清理。
- 开发者指南面向提出需求和控制 Agent 的人员，提供最短路径、授权边界、直接与 Worker 交互方式和提示词模板。
- 保持轻量：不重新引入 task board、复杂状态机、常设 Researcher 或强制多模板。
- 如实描述当前限制：Worker 默认不能运行 `npm run dev`；实际浏览器/CUA 测试需要测试租约、隔离端口和 synthetic 数据；主控发送 prompt 后只确认 `working`，由开发者手动通知完成。
- 当前独立 Reviewer `herzi_reviewer` 正在工作，本任务不读取、轮询、打断或修改其 worktree。

## 验证与交接

- `git diff --check`（`docs/README.md` 及三份新增文件）：PASS。
- 本地 Markdown 链接检查：PASS。
- 标题层级检查：PASS，三份文件均无跳级。
- 已更新 `docs/README.md` 索引与 2026-09-16 当前结论。
- 本轮只写文档，未修改产品代码、构建配置或运行中的 worktree；未运行 `npm run typecheck`、`npm test`、`npm run build`，因为无代码改动。
- 未读取、轮询、打断或修改正在工作的 Reviewer `herzi_reviewer`（`w0:p1`）。
- 两份文档如实描述了当前限制：Worker 默认禁用 `npm run dev`、browser-use/CUA 需要测试租约与 synthetic 数据、主控发送 prompt 后只确认 `working` 并由开发者手动通知完成。
