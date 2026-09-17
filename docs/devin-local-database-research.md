# Devin 本地数据库读取方案调研

> 日期：2026-09-16（Asia/Shanghai）
> 状态：调研完成，建议仅作为实验性历史增强，尚未实施
> 目标：评估能否从 Herdr 中已有 Devin CLI Pane 的本地数据库回填 Chat 历史
> 隐私边界：未读取用户真实 Devin 配置、数据库、会话正文或 Pane；所有本机验证均使用当前工作区内的隔离临时 HOME/XDG 和空白 synthetic database，命令结束后已删除临时文件

## 1. 执行结论

**技术上可行，但不应直接替代 hooks journal，也不应在未验证 schema 的情况下成为默认 transcript authority。**

当前公开 Devin CLI 分发包确实使用本地 SQLite session database。针对公开 stable 包 `v3000.10.27` 的隔离实验确认：

- macOS/Linux 默认文件为 `~/.local/share/devin/cli/sessions.db`；设置 `XDG_DATA_HOME` 时为 `$XDG_DATA_HOME/devin/cli/sessions.db`。
- 数据库包含 `sessions`、`message_nodes`、`prompt_history`、`tool_call_state`、`subagent_heads`、`rendered_commits`、`app_state` 等表。
- `message_nodes` 是带 `parent_node_id` 的 message forest，不是可直接按行号展示的平面 transcript。
- 当前空库包含 17 个内部 migration；官方没有公开 schema、message JSON 或兼容性承诺。
- CLI changelog 明确提到 SQLite、session database corruption、较新 CLI 写入的数据库与旧 CLI 不兼容，证明该文件是产品运行状态，不是稳定的第三方 API。
- 公共二进制包含 WAL、busy timeout、`sessions.db-wal`、`sessions.db-shm` 等实现线索；隔离执行 `devin list` 后关闭进程得到的空库则是 `journal_mode=delete`。因此实现必须按“运行时可能使用 WAL”处理，不能假定固定 journal mode。

推荐优先级：

1. **Herdr + 官方 hooks + Herzi journal**：继续作为实时状态、prompt/tool lifecycle 和 turn-final 的主链。
2. **SQLite Backup API 快照 importer**：只作为 feature flag 下的旧历史 bootstrap，以及经验证后的 idle/done reconciliation。
3. **ATIF `--export`**：对 Herzi 新建且启动时可加参数的 session，仍是优先于内部 DB schema 的官方导出通道。
4. **直接持续读取 live DB**：不作为首版方案；只有完成锁、性能、升级和 message forest 语义验证后才能考虑。

数据库读取最有价值的是补齐“companion 安装前的旧历史”。它**不能自动解决** token streaming、thinking streaming、Chat 内 approval/question 或安全写回；这些能力仍取决于 hooks、Herdr 或 ACP。

## 2. 证据等级

| 结论 | 证据 | 等级 |
| --- | --- | --- |
| CLI 使用 SQLite session database | 官方 stable changelog直接称为 local/session database；公开二进制包含 SQLite migration、SQL 和错误类型 | 高 |
| 当前 macOS/Linux 默认路径 | 在隔离 HOME/XDG 中运行校验过 checksum 的官方 `v3000.10.27` 二进制并执行只读 `devin list` | 高，但不是公开路径契约 |
| 当前表、列、migration | 查询隔离环境中新建的空库 | 高，仅限该版本 |
| message forest 与 parent 链 | 当前 schema + 二进制 SQL/诊断字符串 | 中高，仅限内部实现 |
| `chat_message` 可完整恢复所有可见 UI | 尚无含真实 turn 的 synthetic fixture，未验证分支、compaction、tool 与 subagent 投影 | 未查证 |
| live session 一定使用 WAL | 二进制有 WAL 相关设置和 sidecar 文件名，但关闭后的空库是 DELETE mode | 未查证，必须动态探测 |
| Windows 默认 DB path | 数据目录文档和二进制命名可推断 `%APPDATA%` 路径，但未在 Windows 实机验证 | 低，不能写死 |
| schema 对第三方稳定 | 官方没有承诺，migration/changelog反而说明会变化 | 否 |

## 3. 隔离验证结果

### 3.1 验证对象

官方 current manifest：

- version：`3000.10.27`
- artifact：`devin-3000.10.27-aarch64-apple-darwin.tar.gz`
- manifest SHA-256：`d25e50086b3f84286b6ca1a69f890331436ef9b757c937fa18f716fbef384edd`

验证步骤：

1. 从官方 static host 下载公开 artifact。
2. 按 manifest 校验 SHA-256。
3. 只解压 `bin/devin` 到项目内临时目录。
4. 将 `HOME`、`XDG_DATA_HOME`、`XDG_CONFIG_HOME`、`XDG_CACHE_HOME` 指向隔离临时目录。
5. 执行 `devin list`，结果为 `No previous sessions found.`。
6. 只读查询新建的空库 schema。
7. 删除临时目录。

没有调用用户 credential，没有登录，没有创建云 session，没有打开用户目录中的 Devin 文件。

### 3.2 路径

默认 XDG 变量未设置时，隔离实验生成：

```text
<isolated-HOME>/.local/share/devin/cli/sessions.db
```

显式设置 XDG 时生成：

```text
<XDG_DATA_HOME>/devin/cli/sessions.db
```

官方 troubleshooting 对 log data directory 也公开为：

```text
~/.local/share/devin/cli/logs/
```

路径与实验一致。不过 session DB path 本身没有出现在公开命令参考中，因此产品实现应使用可诊断 locator，不把它视为永久接口。

公共二进制还出现 `CHISEL_SESSION_DB`。这是内部环境变量，没有公开文档或兼容承诺；Herzi 不应把它作为正式接入契约。

### 3.3 当前 schema 摘要

`v3000.10.27` 空库表：

| 表 | 观察到的用途 | 关键字段 |
| --- | --- | --- |
| `sessions` | session metadata 与当前主链入口 | `id`, `working_directory`, `model`, `agent_mode`, `last_activity_at`, `title`, `main_chain_id`, `workspace_dirs`, `hidden`, `metadata` |
| `message_nodes` | message forest 节点 | `session_id`, `node_id`, `parent_node_id`, `chat_message`, `created_at`, `metadata` |
| `prompt_history` | prompt history | `content`, `timestamp`, `session_id`, `is_shell` |
| `tool_call_state` | tool call/update JSON 状态 | `session_id`, `tool_call_id`, `tool_call_json`, `tool_call_update_json` |
| `subagent_heads` | subagent chain head | `session_id`, `agent_id`, `chain_node_id`, `updated_at` |
| `rendered_commits` | 内部渲染结果 | `session_id`, `sequence_number`, `rendered_html`, `created_at` |
| `app_state` | schema/app state | `key`, `value` |
| `refinery_schema_history` | migration history | version/name/checksum 等 |

空库 migration 为 `V1 initial_schema` 到 `V17 subagent_heads`，中间已有 message forest、node metadata、shell context、workspace dirs、tool state、hidden session、session JSON metadata 等迁移。这说明 schema 正在演进，不能只检查“表存在”后继续解析。

`PRAGMA user_version` 在该空库中为 `0`；兼容版本放在 `app_state.schema_compat_version`，当前空库值为 `0`。所以不能依赖常见的 `user_version` 做唯一版本门禁。

### 3.4 数据语义仍待验证

当前证据足以确认存储轮廓，但不足以安全实现 transcript parser：

- `sessions.main_chain_id` 如何精确选择当前可见 branch，尚未用有分支的 fixture 验证。
- `message_nodes.chat_message` 和 `metadata` 的 JSON variant、tool/result/image/reasoning 表示尚未形成版本化 fixture。
- compaction 前后哪些节点应显示、哪些仅用于模型上下文，尚未验证。
- revert/fork 后不可达节点是否应隐藏，尚未验证。
- foreground/background subagent 应如何投影，尚未验证。
- `tool_call_state` 是仅恢复 UI 状态还是可提供可靠 live tool lifecycle，尚未验证。
- 数据何时 commit：message/tool 是否 turn 中持续写入，还是主要在 turn end 保存，尚未验证。

因此，直接执行类似 `SELECT * FROM message_nodes ORDER BY node_id` 并渲染会有较高概率展示错误 branch、内部消息或重复内容。

## 4. 官方支持程度

Devin 官方公开支持的历史/控制接口是：

- `devin --continue`、`devin --resume <session-id>`；
- `devin --export [PATH]` 导出 ATIF；
- lifecycle hooks；
- `devin acp` 的 session/load/resume 与结构化更新；
- Devin Cloud API 的云 session/messages。

本轮没有找到官方的：

- local session database path contract；
- SQLite schema 文档；
- `chat_message` JSON schema；
- 第三方只读并发访问保证；
- migration 向后兼容窗口；
- 文件 watcher/transcript API。

stable changelog 中与数据库直接相关的事实包括：

- “Reduced the risk of local session database corruption with upstream SQLite fixes.”
- “Opening a session database that was written by a newer CLI now shows a clear please update message.”
- ACP persistence 在 dedicated database thread 上运行。

这些信息支持“数据库存在且很重要”，但不构成“第三方读取受支持”。

## 5. 方案比较

### 5.1 直接打开 live DB，`mode=ro`

方法：

```text
file:<path>?mode=ro
BEGIN
parameterized SELECT ...
COMMIT
```

优点：

- 延迟最低；
- SQLite 自己读取主库与 WAL，可得到一致 read transaction；
- 无需复制大库；
- 正常情况下 reader 与 WAL writer 可并发。

风险：

- 仍会参与 SQLite locking/WAL-index；短读通常不阻塞 writer，但长读会延迟 checkpoint。
- 只读 WAL 打开需要已有 `-wal/-shm`、目录可写，或使用 immutable；行为受运行态和权限影响。
- 某些打开方式可能创建/更新 `-shm`，无法做到严格的“源目录零写入副作用”。
- schema migration/CLI upgrade 与 reader 竞态需要处理 `SQLITE_BUSY/LOCKED/SCHEMA`。
- parser 仍绑定内部 schema。

结论：**不用于首版默认链路。**如果以后启用，只允许短事务、低频 polling、严格 timeout，且不能持有跨请求 connection/transaction。

### 5.2 对 live DB 使用 `immutable=1`

优点：看似最“只读”，SQLite 不加锁、不做 change detection。

实际风险：SQLite 官方明确说明，若文件会被其他进程改变却声明 immutable，可能返回错误结果或 `SQLITE_CORRUPT`。它也不适合跟随 live WAL。

结论：**禁止。**`immutable=1` 只能用于已完成的一致快照，不能用于 Devin 正在写的源库。

### 5.3 只 `cp sessions.db`

风险：若运行时使用 WAL，已 commit 的数据可能只在 `sessions.db-wal` 中。SQLite 官方说明 WAL 是数据库持久状态的一部分，把主库与 WAL 分离可能丢失已提交事务，甚至造成损坏。

结论：**禁止。**复制主库不是一致性快照。

### 5.4 手工复制 `sessions.db`、`-wal`、`-shm`

风险：三个文件在复制间隙仍可变化，逐文件 `cp` 不能保证同一时间点；`-shm` 还是派生的 wal-index，不是跨进程/跨主机备份格式。

结论：**不推荐。**不能靠“把三个文件都复制”替代 SQLite snapshot API。

### 5.5 SQLite Online Backup API 到 Herzi 自有快照

流程：

1. 用 SQLite 正常只读连接打开源库。
2. 以 Online Backup API 分页复制到 Herzi 私有临时文件。
3. 对 `BUSY/LOCKED` 做短 backoff 和总 deadline。
4. 完成后原子 rename 为快照。
5. 对快照使用 `mode=ro&immutable=1` 解析。
6. 解析后立即删除，或按显式 retention 保存。

优点：

- SQLite 官方定义的一致 snapshot；
- 正确纳入 WAL 中已提交数据；
- 分页 backup 仅在短时间持有 source read lock；
- 后续 parser 不再接触 live source；
- parser crash 或错误 query 不影响 Devin 源库。

代价：

- 仍需短暂打开 source；
- 大库复制有 I/O 成本；
- 需要原生 SQLite binding/CLI，当前项目依赖中没有 SQLite；
- 仍然无法解决内部 schema 兼容。

结论：**如果要试数据库方案，这是唯一推荐的读取形态。**

### 5.6 `VACUUM INTO` 或 SQLite CLI `.backup`

二者都比文件 `cp` 安全，但作为产品实现存在问题：

- 依赖 host 上 SQLite CLI 版本和可用性；
- subprocess error、path quoting、timeout 与跨平台处理更复杂；
- `VACUUM INTO` 成本高于增量 backup，且不适合高频执行。

结论：可用于 P0 手工验证，不作为跨平台生产首选。生产实现优先使用应用内 SQLite Online Backup API。

### 5.7 快照 + `devin acp`/内部环境变量解码

理论上可把快照交给同版本 Devin 二进制，避免自写 parser。但这依赖未公开的 `CHISEL_SESSION_DB`，启动额外 ACP process 还可能读取 CLI credential、连接服务、执行 hooks 或写入快照。

结论：**不推荐作为产品链路。**复杂度和副作用都高于受限 parser，仍没有稳定契约。

### 5.8 hooks、ATIF 与 ACP

| 方案 | 已有 Pane | 旧历史 | 实时粒度 | 稳定性 | 推荐角色 |
| --- | --- | --- | --- | --- | --- |
| Hooks journal | 是 | 安装前无 | tool lifecycle + turn-final | 官方 hook contract | 主链 |
| DB snapshot parser | 是 | 可能完整 | 取决于 commit 时机，未验证 | 内部 schema | 实验性 bootstrap |
| ATIF export | 仅启动时启用 | 从 export 开始 | turn-end | 官方命令，但 schema仍需 fixture | Herzi 新建 session 增强 |
| ACP | 不是旁观已有 TUI | 可 load | token/tool/interaction | 官方协议 | future runtime-owned |

## 6. 推荐接入架构

### 6.1 数据 authority

```text
status authority         = Herdr
runtime identity         = Herdr exact Devin session id
live event authority     = official Devin hooks -> Herzi journal
old-history bootstrap    = optional DB snapshot importer (experimental)
new managed-session dump = optional ATIF
interaction authority    = existing Terminal/PTY
```

数据库 importer 不取代 adapter 或 journal，而是新增一个 `DevinHistorySource`：

```ts
interface DevinHistorySource {
  kind: "hook-journal" | "sqlite-snapshot" | "atif";
  consistency: "authoritative" | "reconciled" | "derived" | "experimental";
  read(sessionId: string): Promise<HistoryFragment>;
}
```

合并优先级：

1. DB snapshot 只提供 bootstrap baseline，并保留 native node id/source metadata。
2. hook journal 提供 attach 后的实时事件和最终回复。
3. 可稳定匹配时由 ATIF/DB persisted node 收敛 derived hook block。
4. 无法证明同一 turn/node 时不按文本相似度静默覆盖；允许并列 diagnostic。

### 6.2 Snapshot importer

建议组件：

```text
DevinDbLocator
  -> DevinDbCompatibilityProbe
  -> SqliteSnapshotter
  -> DevinDbReader
  -> DevinDbProjector
  -> HistoryReconciler
```

职责：

- `DevinDbLocator`：只在 agent host 的已知 data dir 查找，不接受 browser 传任意 path。
- `CompatibilityProbe`：检查 Devin CLI version、migration version/name/checksum、表/列和 `app_state`。
- `SqliteSnapshotter`：Online Backup API，bounded deadline，目标文件 `0600`。
- `DevinDbReader`：仅参数化 SELECT；快照连接 `immutable=1`、`query_only=ON`、`trusted_schema=OFF`。
- `DevinDbProjector`：重建当前 main chain，解析 allowlisted JSON variant，未知即降级。
- `HistoryReconciler`：按 native id 合并，不用正文 hash 作为唯一 identity。

### 6.3 触发策略

首版试验建议：

- Pane 获得 exact session id 后执行一次 bootstrap。
- 仅在 Herdr 状态为 `idle/done` 时做低频 reconciliation。
- `working/blocked` 期间依赖 hooks，不持续 snapshot。
- Devin CLI version/schema fingerprint 变化时停止 importer，继续 Terminal + hooks。
- 同一个失败 fingerprint 做 backoff，不在每次 HTTP poll 重试。

经过 P0 证明 live backup 不影响运行后，才可缩短 reconciliation 周期。

## 7. Compatibility gate

不能只写 `if tableExists("message_nodes")`。建议 fingerprint 至少包含：

```text
Devin CLI exact version
refinery_schema_history: ordered (version, name, checksum)
app_state.schema_compat_version
required table columns + affinity + nullability
required indexes/uniqueness relevant to traversal
observed JSON variant set from synthetic fixtures
```

策略：

- fingerprint 在 allowlist：正常读取。
- 仅增加未知 nullable column：可通过测试后加入兼容范围，不自动乐观接受。
- migration checksum、required column 或 JSON discriminant 不符：fail closed。
- 新版 DB 被旧 reader 发现：显示 `db-history-unsupported-version`，不能尝试猜测。
- parser 遇到未知 node/content：保留 opaque placeholder 和诊断，不丢整段、不执行数据。

## 8. 安全与隐私

Session database 可能包含：

- 用户 prompt 和 Devin reply；
- tool input/output、shell command、错误信息；
- 工作目录、文件路径、repo metadata；
- 图片或大段内容；
- subagent 与 permission 状态；
- 可能出现在工具输出中的 credential/secret。

最低要求：

1. 默认不开启 DB importer，需 feature flag/显式用户确认。
2. 只在 agent 所在 host 读取，不通过 browser 提供数据库下载接口。
3. 不允许前端指定数据库 path、SQL、session id 原值。
4. 使用 exact Herdr session identity 参数化查询；不按 cwd/mtime 猜 session。
5. 源连接只读、短事务、deadline、busy timeout；禁止写 PRAGMA、checkpoint、migration、VACUUM 源库。
6. 快照目录 `0700`、文件 `0600`；临时文件 crash cleanup；默认解析后删除。
7. 普通日志只记录 hash、version、migration fingerprint、耗时、行数、错误码，不记录正文或绝对路径。
8. JSON、HTML、path 和 tool payload 全部按不可信数据处理，不执行、不拼 shell。
9. 每 session/节点/JSON/图片设置硬上限；超限生成 truncation notice。
10. 提供“禁用并清除 Herzi import cache”，但绝不删除 Devin 源库。

## 9. P0-DB 验证计划

必须使用专用、无敏感内容的 synthetic Devin session，并在用户授权后执行。

### 9.1 数据语义 fixture

依次生成并对照 Terminal、hooks、DB snapshot、ATIF（可用时）：

1. 单轮 user/assistant。
2. 多轮 conversation。
3. tool success / tool error。
4. permission allow / deny。
5. working 中 cancel。
6. resume 后继续。
7. `/fork`、`/steps`、`/revert`。
8. compaction 前后。
9. foreground/background subagent。
10. image/file mention。
11. session rename/archive/delete 的数据库行为。

对每个 fixture 记录脱敏 shape，不保存真实业务正文。

### 9.2 并发与锁

- Devin working 且高频写入时执行 Online Backup。
- 统计 backup latency、`BUSY/LOCKED`、Devin turn latency、WAL size。
- 验证 reader 不触发 checkpoint，不长期阻塞 writer。
- process crash/kill 后带残留 WAL 的快照恢复。
- source DB 暂时不存在、被 rename、CLI 正在 migration 时 fail closed。

### 9.3 版本与升级

至少选择两个相邻 stable 版本：

- 旧版创建 session，新版 migration 后读取；
- 新版 DB 用旧 allowlist 必须拒绝；
- migration checksum/字段变化能被 doctor 精确报告；
- CLI 更新期间 importer 自动暂停。

### 9.4 出口条件

只有全部满足才能把 DB importer 从 research flag 提升为可选功能：

- main chain 与可见 Terminal/ATIF 一致；
- 不泄漏 unreachable/reverted/hidden/internal message；
- tool、compaction、subagent 至少有明确可解释映射；
- backup 对 Devin 无可感知卡顿或锁故障；
- schema mismatch 100% fail closed；
- Pi 和 hooks-only Devin 无回归。

## 10. 对现有实施计划的影响

不建议推翻原“adapter + hooks journal”方案，只新增一个受控分支：

- P0 增加 `P0-DB` synthetic 验证。
- P1/P2 的通用 capability 增加 history source/coverage，而不是把 DB 细节泄漏给 UI。
- P3/P4 仍先实现 hook journal；它是运行中事件的稳定来源。
- DB importer 作为新的可选 P6a，早于或并行于 ATIF P6b，但必须单独 feature flag。
- 如果 P0-DB 验证通过，Devin `history` 可从 `since-integration` 提升为 `best-effort-local-complete`；在证明完整前不能声明 `complete`。

建议 capability：

```ts
interface AgentHistoryCapability {
  coverage: "none" | "since-integration" | "best-effort-local-complete" | "complete";
  source: "journal" | "sqlite-snapshot" | "atif" | "native-transcript";
  support: "public" | "experimental-internal";
}
```

UI 对 DB history 应显示“实验性本地历史；CLI 更新后可能暂时停用”，而不是把它伪装成公开稳定 transcript。

## 11. 最终建议

### 推荐

- 保留 hooks journal 主架构。
- 将 DB 方案限定为“历史 bootstrap research flag”。
- 使用 SQLite Online Backup API，不直接 tail/cp/immutable-open live DB。
- 以 exact session id 查询并重建 message forest。
- 以 exact CLI version + migration checksum + schema/JSON fixture 做 allowlist。
- 任何未知情况 fail closed，自动退回 hooks + Terminal。

### 不推荐

- 把 `sessions.db` 当公开 API。
- 直接持续查询 live DB 作为实时流。
- 对 live DB 使用 `immutable=1`。
- 只复制主库，或手工依次复制 WAL/SHM。
- 根据 cwd、mtime 或最新 session 猜身份。
- 用 `prompt_history` 代替 transcript。
- 使用未公开 `CHISEL_SESSION_DB` 作为生产依赖。
- 向 DB 写入、做 migration、checkpoint、修改 session 或清理 Devin 数据。

## 12. 来源

访问日期均为 2026-09-16。

### Devin 官方

- CLI commands：<https://docs.devin.ai/cli/reference/commands>
- Stable changelog：<https://docs.devin.ai/cli/changelog/stable>
- Troubleshooting/data log path：<https://docs.devin.ai/cli/troubleshooting>
- Lifecycle hooks：<https://docs.devin.ai/cli/extensibility/hooks/lifecycle-hooks>
- Current manifest：<https://static.devin.ai/cli/current/manifest.json>
- 验证 artifact：<https://static.devin.ai/cli/3000.10.27/devin-3000.10.27-aarch64-apple-darwin.tar.gz>

### SQLite 官方

- Write-Ahead Logging：<https://www.sqlite.org/wal.html>
- Online Backup API：<https://www.sqlite.org/backup.html>
- URI filenames（`mode=ro`、`immutable`）：<https://www.sqlite.org/uri.html>
- PRAGMA reference：<https://www.sqlite.org/pragma.html>

## 13. 证据限制

- Devin CLI 是闭源分发。二进制 strings/schema 观察可证明当前 artifact 的实现事实，但不是上游兼容承诺。
- 空白 synthetic DB 没有 conversation rows，因此消息 JSON、active branch、compaction、tool 和 subagent 投影仍未验证。
- 没有在当前用户的 Devin 安装、真实 session 或真实 WAL 上运行任何命令。
- 没有验证 Windows path、locking 和 native SQLite binding。
- 没有安装新的 Node dependency，也没有修改产品代码。
