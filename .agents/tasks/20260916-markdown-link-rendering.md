# Markdown 链接渲染

- 状态：规划完成，待用户授权创建 Worker worktree。
- 目标：让 Chat 中 Markdown 链接具有默认高亮、hover/focus 高亮，并默认在新浏览器 tab 打开。
- 修改范围：`src/web/markdownPlugins.ts`、`src/web/styles.css`、一个新的 Markdown link renderer 及其前端测试；不修改 `ChatView.tsx`。
- 验收条件：assistant 正文和 activity 内嵌 Markdown 共用行为；链接具有可辨识颜色/下划线、键盘 focus 样式；anchor 使用 `target="_blank"` 与 `rel="noopener noreferrer"`；测试通过。
- Base：当前 HEAD 为 `0097dc4ded77c32460bee63b95c9652c61ff86d2`，但协作规则和本任务文件尚未提交；创建 worktree 前需先建立用户批准的 committed baseline。

## 过程与决策

- 当前两处 Markdown 都使用 `markdownShared`，适合在共享配置中增加 anchor renderer，无需分别修改两个渲染点。
- `styles.css` 当前没有 `.markdown-body a` 规则，因此链接继承普通文本外观。
- `MarkdownTextPrimitive` 支持传入 React Markdown `components`，可统一覆盖 `a`。
- 该任务与消息投递任务可以并行，只要后者不修改 `markdownPlugins.ts` 或 `styles.css`。

## 验证与交接

规划阶段未修改产品代码、未运行测试。
