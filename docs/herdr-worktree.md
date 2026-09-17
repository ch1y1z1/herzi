# Herdr 的 Git worktree 能力梳理

> 目的：为 Herzi 后续可能的 worktree 相关功能（侧栏分组、创建/删除入口、状态展示）提供准确的一手依据。
> 调研日期：2026-09-15（UTC+08:00）
> 本机环境：`herdr 0.8.2`（client/server 同版本，socket protocol 20，stable 渠道，server 正在运行）
> 主要来源：本机 `herdr` 二进制帮助与字符串、`herdr api schema`（protocol 20 导出）、`herdr --default-config`、官方文档 <https://herdr.dev/docs/cli-reference/> 与 <https://herdr.dev/docs/socket-api/>。

## 0. 版本前提（重要）

- 本机安装的是 **0.8.2**；官方文档站点描述的是**更新的版本**（文档里出现 `herdr machine add`、`worktree --trust-repository`、`workspace close --group`，这些在 0.8.2 二进制里**不存在**，已用 `strings` 逐项核对：`trust-repository`、`close_group`、`workspace_group_close_required`、`--group` 均为 NO）。
- 本机 `~/.config/herdr/release-notes.json` 记录的是 **0.9.0** 的更新说明（含 worktree 相关变更），可作为"即将具备的能力"参考，但**不能当作本机当前行为**。
- 下文凡标注「0.8.2 实测/导出」的是本机可核实事实；标注「官方文档」的是文档站口径；标注「未查证」的不做推断。

## 1. 概念模型：worktree 就是"带 Git 来源信息的 workspace"

Herdr 没有为 worktree 发明新的运行时容器，而是：

- **一个 Git worktree checkout = 一个普通 Herdr workspace**（有自己的 tab、pane、agent、编号、label）。
- 该 workspace 额外携带 **worktree provenance（来源信息）**：`repo_root` / `repo_key` / `repo_name` / `checkout_path` / `is_linked_worktree`。
- 由 `worktree create` 创建的 workspace 会与**父仓库 workspace 归为同一组**（侧栏称 Space / worktree group），形成"父仓库主 checkout + 缩进的 linked worktree 子项"。

因此：

- 关闭 workspace **不等于**删除 checkout（Herdr 只关运行时状态）。
- 删除 checkout **必须**显式走 `worktree remove`（内部执行 `git worktree remove`）。
- 一个 worktree group 存在"整组关闭"的语义（见 §6）。

## 2. CLI（0.8.2 实测帮助文本）

```text
herdr worktree list   [--workspace ID | --cwd PATH]
herdr worktree create [--workspace ID | --cwd PATH] [--branch NAME] [--base REF] \
                      [--path PATH] [--label TEXT] [--focus] [--no-focus]
herdr worktree open   [--workspace ID | --cwd PATH] (--path PATH | --branch NAME) \
                      [--label TEXT] [--focus] [--no-focus]
herdr worktree remove --workspace ID [--force]
```

最新文档额外支持 `[--trust-repository]`（0.8.2 无）。

### 2.1 共同约定

- **目标定位**（`list`/`create`/`open`）：`--workspace ID` 与 `--cwd PATH` **最多只能给一个**；都不给则使用当前 active workspace。
- 目标必须位于 Git work tree 内，否则报错（二进制错误文案：*"Herdr worktree actions require a path inside a Git work tree"*、*"Herdr worktree actions require a workspace inside a Git work tree"*、*"workspace_id or cwd is required when no workspace is active"*）。
- 无焦点副作用默认：不传 `--focus` 时**不抢焦点**（与 workspace/tab/pane 创建一致），`--no-focus` 只是显式写出默认值。
- CLI 会先把相对 `--cwd` / `--path` 展开为绝对路径再发给服务端；raw socket 只接受绝对路径（官方文档）。

### 2.2 `worktree list`

只读，返回该仓库的 **`git worktree list` 视图** + 来源信息：

```json
{
  "id": "cli:worktree:list",
  "result": {
    "type": "worktree_list",
    "source": {
      "repo_key": "/Users/chiyizi/agent_workspace/herzi/.git",
      "repo_name": "herzi",
      "repo_root": "/Users/chiyizi/agent_workspace/herzi",
      "source_checkout_path": "/Users/chiyizi/agent_workspace/herzi",
      "source_workspace_id": "wW"
    },
    "worktrees": [
      {
        "path": "/Users/chiyizi/agent_workspace/herzi",
        "branch": "main",
        "label": "herzi",
        "is_bare": false,
        "is_detached": false,
        "is_prunable": false,
        "is_linked_worktree": false,
        "open_workspace_id": "wW"
      }
    ]
  }
}
```

字段含义与注意点：

| 字段 | 说明 |
| --- | --- |
| `path` | checkout 绝对路径 |
| `branch` | 分支名；detached 时为 `null` |
| `label` | 显示名（当前 repo 主 checkout 显示为 repo 名 `herzi`） |
| `is_bare` / `is_detached` / `is_prunable` / `is_linked_worktree` | 直接映射 `git worktree list --porcelain` 的状态 |
| `open_workspace_id` | 该 checkout 已经作为 Herdr workspace 打开时的 workspace ID；未打开则**省略**该字段（非 `null`） |

`open_workspace_id` 是判断"这个 checkout 有没有对应 Herdr workspace"的官方依据。

### 2.3 `worktree create`

- 语义：创建 Git worktree checkout → 作为 workspace 打开 → 与父仓库 workspace 分组。
- 分支规则（官方文档）：
  - `--branch NAME` **命中已有本地分支** → 直接 checkout 该分支；
  - 否则从 `--base REF`（缺省 `HEAD`）**新建分支** `NAME`。
- 路径规则（官方文档）：不给 `--path` 时，checkout 落在 `<worktrees.directory>/<repo>/<branch-slug>`。`branch-slug` 的具体转义规则**未查证**。
- `--label` 覆盖 Herdr workspace 的显示名；缺省 label 生成规则**未查证**（`worktree list` 里主 checkout 的 label 是 repo 名）。
- 返回 `worktree_created`，包含 `workspace` / `tab` / `root_pane`（新 workspace 的完整创建结果）与 `worktree`（`WorktreeInfo`）。
- **异步执行**：二进制内含 *"worktree.create is handled asynchronously by the app runtime"*。因此可能出现 `worktree_operation_in_progress` 与 `stale_worktree_operation`。

### 2.4 `worktree open`

- 必须**恰好给一个** `--path` 或 `--branch`（错误码 `exactly one of path or branch is required`）。
- 打开一个**已存在**的 checkout；如果它已经是某个 Herdr workspace，则返回该 workspace 并置 `already_open: true`（不重复创建）。
- 返回 `worktree_opened`，字段同样是 `workspace` / `tab` / `root_pane` / `worktree` + `already_open`。
- 按 `--branch` 匹配时要求唯一：匹配 0 个 → `worktree_not_found`；匹配多个 → `ambiguous_worktree_branch`（错误文案："one match should exist" / "multiple worktrees matched branch"）。

### 2.5 `worktree remove`

- **必须**用 `--workspace ID`，且该 workspace 是 **Herdr 管理的 linked worktree checkout**；否则 `not_linked_worktree`（文案："workspace is not a Herdr-managed worktree checkout" / "workspace is not a linked worktree checkout"）。
- 内部执行 `git worktree remove`，**从不删除分支**。
- checkout 脏（含未跟踪文件）时 Git 拒绝删除：Herdr 返回 `dirty_worktree_requires_force`，文案 *"contains modified or untracked files"* / *"use --force to delete it"*；需要 `--force` 才继续。
- 返回 `worktree_removed`，含 `workspace_id` / `path` / `forced`。
- 同样是**异步**操作（*"worktree.remove is handled asynchronously by the app runtime"*）。

## 3. 数据模型（0.8.2 schema 导出）

```text
WorktreeInfo            path, branch?, label, is_bare, is_detached, is_prunable,
                        is_linked_worktree, open_workspace_id?
WorktreeSourceInfo      repo_key, repo_name, repo_root, source_checkout_path,
                        source_workspace_id?
WorkspaceWorktreeInfo   repo_key, repo_name, repo_root, checkout_path, is_linked_worktree
```

- `WorkspaceInfo` 里 `worktree` 是**可选**字段（`anyOf [WorkspaceWorktreeInfo, null]`）。本机 `herdr workspace list` 输出里所有非 worktree workspace 都**不带**该键，可据此判断 workspace 是否属于 worktree 组。
- 侧栏分组用的 `repo_key` 当前实测为 `<repo_root>/.git`（普通仓库）；bare / worktree-gitdir 场景的取值规则**未查证**。

## 4. 事件与订阅（0.8.2 schema 导出）

worktree 生命周期事件（`events.subscribe` 可订阅）：

| 事件 | 载荷 |
| --- | --- |
| `worktree.created` | `workspace`, `worktree` |
| `worktree.opened` | `workspace`, `worktree`, `already_open` |
| `worktree.removed` | `workspace_id`, `worktree`, `forced`, `workspace?`（被关闭的 workspace 记录） |

官方文档补充的事件序列：

- `worktree.create` → 依次 `workspace.created`、`tab.created`、`pane.created`、`worktree.created`
- `worktree.open` → `worktree.opened`；若真的新建了 Herdr workspace，还会补发 workspace/tab/pane 创建事件
- `worktree.remove` → `worktree.removed`；若 workspace 仍打开，还会发 `workspace.closed`
- 已有 workspace 获得/变更 worktree provenance 时，可能发 `workspace.updated`

对 Herzi 的意义：**不需要轮询** `worktree list` 就能知道组结构变化，但 `git worktree list` 全量发现仍只能靠 `worktree.list`。

## 5. 错误码清单（0.8.2 二进制字符串核实存在）

| 错误码 | 含义（二进制内文案） |
| --- | --- |
| `worktree_list_failed` | `git worktree list failed with status ...` |
| `worktree_not_found` | 按 branch 匹配不到 / path 不存在（`worktree path not found`） |
| `ambiguous_worktree_branch` | 同一 branch 匹配多个 worktree |
| `worktree_open_failed` | 打开失败；也用于 *"worktree cannot be opened"* |
| `worktree_create_failed` | 创建失败 |
| `worktree_remove_failed` | 删除失败 |
| `dirty_worktree_requires_force` | 脏 checkout 需要 `--force` |
| `not_linked_worktree` | 目标 workspace 不是 Herdr 管理的 linked checkout |
| `worktree_operation_in_progress` | 同一 checkout 已有 worktree 操作在进行 |
| `stale_worktree_operation` | 操作被后续操作取代（`... completed after the operation was superseded`） |
| `invalid_params` | `exactly one of path or branch is required`、`branch is required`、`workspace_id or cwd is required when no workspace is active` |
| `confirmation_required` | 关闭 tab 会导致关闭整个 worktree group 时的保护（见 §6） |

## 6. 分组关闭与确认语义

- 官方文档（较新版本）：`workspace close` 只关 Herdr 状态；关闭**主（primary）workspace**而仍有 linked worktree workspace 打开时，必须显式整组关闭（`workspace close --group` / socket `"close_group": true`），否则返回 `workspace_group_close_required`，组保持打开。本机 0.8.2 **没有**这两个入口（已核实）。
- 0.8.2 TUI 已有等价交互（二进制字符串核实）：
  - workspace 右键菜单项：`New worktree`、`Close group`、`Delete worktree checkout...`
  - 确认弹窗：`Close worktree group?`（带 `1 workspace,` 这类计数）、`Delete worktree checkout?`，正文 *"This removes the checkout folder: ... The branch is not deleted. The Herdr workspace will close. Dirty or untracked files will be permanently deleted."*，按钮含 `remove`、`delete anyway`、`cancel`
  - `tab close` 若会连带关闭整个 worktree group，会返回 `confirmation_required`（文案 *"closing this tab would close a worktree group"*）。

## 7. TUI 入口

- 键位（`herdr --default-config` 实测默认值）：
  - `keys.new_worktree = "prefix+shift+g"` — 从选中 workspace 创建 Git worktree
  - `keys.open_worktree = ""`（**默认未绑定**）— 打开已存在的 Git worktree
  - `keys.remove_worktree = ""`（**默认未绑定**，配置后打开确认弹窗）— 删除选中的受管 checkout
- 命令面板/帮助里的动作名（二进制字符串）：`new worktree`、`open worktree`、`delete worktree checkout`、`close group`。
- open-worktree 选择器空态文案：`─ no matching worktrees`。
- 处理中提示：`creating…`、`removing…`（异步操作的 UI 反馈）。
- 右键菜单是这些动作的主要可达路径（`open_worktree` / `remove_worktree` 默认无快捷键）。

## 8. 配置

```toml
[worktrees]
# 新 checkout 的父目录（默认 ~/.herdr/worktrees，实际路径为 <directory>/<repo>/<branch-slug>）
# directory = "~/.herdr/worktrees"

[keys]
# new_worktree = "prefix+shift+g"
# open_worktree = ""
# remove_worktree = ""   # 绑定后打开确认弹窗
```

侧栏分组展示相关（`ui.sidebar.spaces`，0.8.2 默认 `rows = [["state_icon","workspace"],["branch","git_status"]]`）：

- `ui.sidebar.spaces.row_gap` 默认 `0`：**worktree 父项与其缩进子项保持紧贴**，空行只出现在"worktree 组"与"无关顶层 Space"之间。
- 可用 token：`state_icon`、`state_text`、`workspace`、`branch`、`git_status`，以及 workspace metadata 上报的自定义 `$name` token。
- **已知缺陷（0.8.0 报告，本机 0.8.2 未实测复现）**：builtin `branch` token 对 linked worktree 的 workspace 渲染为空（issue #2952），主 checkout 正常；报告者的临时绕法是用脚本通过 `workspace.report_metadata` 上报自定义 `$branch`。

## 9. 与 Herzi 现状的关系

- `docs/herdr-api-schema.json`（protocol 20）已包含 `/schemas/request|success_response|event/$defs/Worktree*` 全部定义，Herzi 无需额外协议探测即可类型化。
- 本机当前工作目录 `/Users/chiyizi/agent_workspace/herzi` 是**普通 checkout**（`git worktree list` 只有一条，`label=herzi`，`open_workspace_id=wW`），因此 `herdr workspace list` 里没有 `worktree` 字段；Herzi 侧栏若要显示 worktree 组，应把 `WorkspaceInfo.worktree` 的有无作为唯一判据，而不是自己跑 `git`。
- 若后续要在 Herzi 里提供创建/删除入口，注意：`herdr worktree create/remove` 是**异步**且**不可抢焦点**语义，UI 需要处理 `worktree_operation_in_progress`、`stale_worktree_operation`、`dirty_worktree_requires_force`（删除脏 checkout 必须二次确认并显式 `--force`）。

## 10. 未查证 / 已知不确定项

1. `--branch` 缺省时（TUI 输入分支名以外）CLI 的默认分支命名规则。
2. `branch-slug` 的具体转义规则（斜杠、Unicode、长度上限）。
3. `--label` 缺省值的生成规则。
4. `repo_key` 在 bare 仓库、`--separate-git-dir` 等场景的取值。
5. 0.8.2 上 issue #2952（linked worktree 的 `branch` token 为空）是否仍然存在。
6. 官方文档提到的 `--trust-repository`、`workspace close --group` / `close_group`、以及 0.9.0 release notes 中"删除后台 worktree workspace 不再改变焦点""Windows 下 agent pane 运行时也能删除"在本机 0.8.2 上的确切行为差异。
7. 第三方 worktree 插件（`ogulcancelik/herdr-plugin-examples/worktree-bootstrap`、`herdr-worktrunk`、`wt-herdr` 等）的功能与可用性未核验；其中 `herdr-plugin-examples/worktree-bootstrap` 在官方文档中被引用为 `plugin install` 示例，但本次抓取该仓库路径返回 404。

## 11. 来源

- 本机一手证据（2026-09-15）：
  - `herdr --help`、`herdr worktree`（无子命令时打印用法）、`herdr --default-config`
  - `herdr api schema --output /tmp/herdr_schema.json`（protocol 20）
  - `herdr worktree list`、`herdr workspace list` 实际 JSON 输出
  - `/Users/chiyizi/.local/bin/herdr` 二进制字符串（错误码、UI 文案、配置键）
  - `~/.config/herdr/release-notes.json`（版本 0.9.0）
- 官方文档（访问日期 2026-09-15）：
  - <https://herdr.dev/docs/cli-reference/>
  - <https://herdr.dev/docs/socket-api/>
  - <https://herdr.dev/docs/config-reference/>
  - <https://herdr.dev/docs/concepts/>
- 第三方/社区：
  - <https://github.com/herdrdev/herdr/issues/2952>（linked worktree 的 `branch` token 为空，0.8.0）
