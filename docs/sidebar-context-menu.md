# 侧栏 Workspace / Tab 右键菜单

## 需求与最终范围

2026-09-04 增加左侧 Herdr 资源导航的右键菜单。用户随后明确更正：不存在 `copy tab`，不得实现或近似为 Tab 克隆。

- Workspace 行：`新建 Tab`、`重命名`、`复制路径`、`关闭 Workspace`。
- Pane 行：`重命名`、`复制路径`、`关闭 Tab`。当前侧栏按 Pane 平铺，但每行显示所属 Tab 名，因此这里的菜单目标是该 Pane 所属的准确 Tab ID；同一 Tab 有多个 Pane 时，多个可见行会操作同一个 Tab。

## Herdr 接口映射

| UI 动作 | Herdr protocol 20 方法 | 参数 |
| --- | --- | --- |
| 新建 Tab | `tab.create` | `workspace_id`、`focus: true` |
| 重命名 Workspace | `workspace.rename` | `workspace_id`、`label` |
| 关闭 Workspace | `workspace.close` | `workspace_id` |
| 重命名 Tab | `tab.rename` | `tab_id`、`label` |
| 关闭 Tab | `tab.close` | `tab_id` |

Herzi server 在执行成功后主动 `session.snapshot`，让已有 WebSocket 状态流立即更新。`tab.create` 返回的 `root_pane.pane_id` 会在新 snapshot 出现后成为 Herzi 当前选中 Pane，避免 HTTP 与 WebSocket 到达顺序造成选择回退。

`复制路径` 不调用 Herdr mutation：

- Workspace 使用其 `activeTabId` 对应 Tab 的可用 Pane cwd；不存在活动 Tab 时回退到 focused/首个 Tab。
- Pane 行使用该 Pane 的 `foreground_cwd ?? cwd`（服务快照已归一为 `PaneSummary.cwd`），没有路径时禁用菜单项。
- 优先使用浏览器 Clipboard API，旧浏览器回退到临时 textarea + `execCommand("copy")`。

## 交互规则

- 菜单使用 fixed portal，按指针位置出现并约束在窗口可见范围内。
- 点击菜单外、滚动、窗口 resize/blur 或按 Escape 会关闭菜单。
- Rename 初版使用浏览器输入对话框；服务端拒绝空名称。
- 关闭 Workspace/Tab 会终止其 Pane 中运行的进程，因此提交前显示包含影响范围的确认对话框。
- 操作成功或失败在侧栏底部显示短暂反馈。

## 调研依据

- 本项目归档的 [`herdr-api-schema.json`](./herdr-api-schema.json) 是当前 Herdr 0.8.2 / socket protocol 20 的实现基线。
- Herdr 官方源码的 client context menu 使用稳定 Workspace/Tab ID 执行动作；Tab 原生菜单包含 New tab、Rename、Close。Herzi 同样始终把右键命中的稳定 ID发送到后端，不使用可变化的侧栏序号。
- 官方资料：[Keyboard](https://herdr.dev/docs/keyboard/)、[CLI reference](https://herdr.dev/docs/cli-reference/)、[GitHub repository](https://github.com/herdrdev/herdr)。访问日期：2026-09-04。

## 验证与边界

- `npm run build` 通过：TypeScript、server tsup bundle、Vite production bundle 均成功；只有既有的 bundle size warning。
- 当前开发线程 `HERDR_ENV` 未设置。遵循 Herdr skill，本轮没有操作或读取真实 Herdr session，也没有执行新建、重命名、关闭等冒烟操作。
- Close 仍属于真实破坏性 Herdr 操作；需在专用测试 Workspace/Tab 中做一次人工验收，不应拿用户正在运行的 Agent 验证。
- 本轮没有引入右键菜单组件库，也没有增加大规模 UI 测试框架；菜单规模较小，采用 React state + portal 保持 Alpha 依赖和实现简单。
