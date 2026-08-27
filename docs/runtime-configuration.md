# StruInfo 运行配置与数据根

- 状态：外部工作区选择、严格 secret 文件注入及 M1M 维护运行已实现
- 最近更新：2026-08-27
- 对应决策：[ADR 0006](adr/0006-external-configuration-and-personal-data-isolation.md)

## 1. 边界

普通 `api`、`scheduler`、`worker` 和 `all` 进程启动前必须同时获得：

1. 由进程环境提供的 `STRUIINFO_CONFIG_PATH`，指向包体外的 UTF-8 dotenv 配置文件；
2. 由进程环境提供的 `DATABASE_URL`，或互斥的 `DATABASE_URL_FILE`；
3. 由外部配置文件提供、可被同名进程环境覆盖的 `STRUIINFO_DATA_ROOT`；
4. 由外部配置文件提供、可被同名进程环境覆盖的 `STRUIINFO_WORKSPACE_ID`。

活动配置文件、工作区选择、数据根和数据库都不是仓库输入或构建资源。`STRUIINFO_WORKSPACE_ID` 只是指向外部工作区的稳定选择器，不承载知识或偏好。配置文件只保存非秘密的运行参数；知识、词表、偏好、信源、策略和保存查询属于工作区数据库数据，快照、媒体、导出和备份属于外部数据根。它们都不得写进代码常量、迁移 seed、测试 fixture 或正式包体。

仓库不提供个人数据的相对路径回退。`.gitignore` 只是事故防护，不能把仓库内的 ignored 目录变成合法数据根。

## 2. 替换、重读与工作区切换

同一份应用构建必须能够通过包体外状态打开不同工作区，不得要求修改源码、重新构建、重新打包或把个人文件复制到仓库。这里有三个彼此分离的动作：

1. **运行配置重读**：重新读取 `STRUIINFO_CONFIG_PATH` 及秘密注入，选择数据库连接、数据根和进程级参数；
2. **工作区打开/切换**：使用稳定 `workspace_id` 选择同一数据库中的工作区，或在更换数据库/数据根后重新打开目标工作区；工作区身份不得硬编码为代码常量或本机路径；
3. **工作区 Bundle 导入/恢复**：把外部、版本化 Bundle 作为数据验证后写入工作区；Bundle 不是可执行配置、源码模块或可以直接修改的在线数据库文件。

M1C 首版不要求后台文件监视或无中断热切换。允许采用明确的“关闭当前 composition root → 更换外部配置/工作区选择 → 重新启动或重新打开”的流程，但必须遵守：

- 在激活前完整读取并验证候选配置、规范路径、秘密引用和目标工作区；
- 先成功构造候选数据库、Blob 和 repository adapters，再让请求进入新工作区；
- 任一步失败都返回可见错误，不把旧配置与新数据库/数据根混合；仍在运行的旧实例继续保持原状态，或安全停止；
- 监听地址、数据库连接和数据根等进程级变化首版通过受控重启生效，不做部分原地突变；
- 同一构建至少要用两个完全合成、包体外的工作区配置证明可切换、可重读且数据不串用。

工作区内的知识、词表、信源、提示覆盖和保存查询仍由 PostgreSQL 与领域 Bundle 管理；轻量 UI 偏好可以使用数据根中的独立、版本化个人配置文件。两者都不得为了“方便切换”塞入 dotenv、TypeScript、前端资源或迁移 seed。

## 3. 闭合配置项

外部配置文件只接受以下字段；任何其他字段都会使进程启动失败：

| 字段                               | 必需 | 默认值      | 说明                                     |
| ---------------------------------- | ---- | ----------- | ---------------------------------------- |
| `STRUIINFO_DATA_ROOT`              | 是   | 无          | 已存在的绝对目录；启动后保存规范真实路径 |
| `STRUIINFO_WORKSPACE_ID`           | 是   | 无          | 小写规范 UUID；选择本次运行打开的工作区  |
| `STRUIINFO_HOST`                   | 否   | `127.0.0.1` | API 监听地址                             |
| `STRUIINFO_PORT`                   | 否   | `3000`      | API 端口，范围 1–65535                   |
| `STRUIINFO_HEALTH_HOST`            | 否   | `127.0.0.1` | scheduler/worker 健康检查监听地址        |
| `STRUIINFO_HEALTH_PORT`            | 否   | 按角色确定  | scheduler 默认 3001，worker 默认 3002    |
| `STRUIINFO_SHUTDOWN_TIMEOUT_MS`    | 否   | `10000`     | 关闭预算，范围 1000–60000 毫秒           |
| `STRUIINFO_LOG_LEVEL`              | 否   | `info`      | `debug`、`info`、`warn` 或 `error`       |
| `STRUIINFO_OPENAI_MODEL`           | 否   | 无          | Responses 模型；启用公开 AI 提案/综合    |
| `STRUIINFO_OPENAI_EMBEDDING_MODEL` | 否   | 无          | Embedding 模型；启用公共语义/混合检索    |

同名进程环境变量会覆盖文件中的非秘密运行参数，便于容器和托管环境注入。`STRUIINFO_CONFIG_PATH`、`DATABASE_URL`、迁移专用的 `STRUIINFO_MIGRATION_DATABASE_URL` 和 `OPENAI_API_KEY` 只能由进程环境/秘密机制提供，写入配置文件会被拒绝。M1M 为后三者增加互斥的 `DATABASE_URL_FILE`、`STRUIINFO_MIGRATION_DATABASE_URL_FILE` 和 `OPENAI_API_KEY_FILE`：文件路径必须绝对，目标为至多 16 KiB 的普通文件，内容为严格 UTF-8 的单行非空值；直接值与对应文件变量同时存在会失败。`OPENAI_API_KEY` 必须与至少一个 OpenAI 模型同时存在；Responses 与 Embedding 模型可以分别配置，缺少 Embedding 模型时词法查询仍完整可用且不会宣告语义检索 capability。

数据库 URL 只接受一个明确的 DNS 名称、IPv4 或 IPv6 地址，不接受 Unix socket、多个 host、
query/fragment 覆盖或含糊的 authority。这样既支持本机 `localhost`，也支持容器可达的服务名、
`host.docker.internal` 或私网地址。当前 node-postgres 投影固定 `ssl=false`，因此仅用于同机或
受信任私网；跨不可信网络时必须在部署层提供 TLS，不能把明文数据库连接当作公网边界。

配置文件上限为 64 KiB，必须是现存普通文件和有效 UTF-8。错误信息只报告字段或合同问题，不回显数据库地址、未知字段名、配置内容或个人路径。

## 4. 路径规则

启动时会解析文件系统的规范绝对路径并跟随 symlink/junction。配置文件和数据根必须：

- 位于 Git 工作树、源码目录和安装包目录之外；
- 分别使用互不包含的目录树；
- 已经存在，且分别是普通文件和目录；
- 不把文件系统根目录本身用作数据根。

这会拒绝 `..`、目录链接或 Windows junction 绕过。容器部署仍须由部署配置把数据根挂载到外部持久卷或对象存储端口；应用不能仅凭路径判断一个目录是否真的持久化。

## 5. 外部数据根布局

普通运行角色在取得规范数据根后创建或验证五个固定区域。区域名由程序内部生成，调用方不能提供文件路径或目录片段；已有区域必须是位于数据根内的普通目录，文件、symlink 和 Windows junction 都会使启动或存储操作失败。

| 相对目录       | 当前用途                                   | 当前实现状态                                |
| -------------- | ------------------------------------------ | ------------------------------------------- |
| `blobs/`       | 不可变原始响应、大文本、图片和未来媒体字节 | 本地内容寻址适配器已实现                    |
| `uploads/`     | 未来上传暂存；暂存内容不是已准入证据       | 只保留独立区域，尚无公开 reader/writer      |
| `exports/`     | 版本化工作区领域 Bundle                    | M1C v1 规范文件落盘与同 ID 空库恢复已实现   |
| `backups/`     | 完整个人数据备份与空工作区恢复工件         | M1M 维护命令已实现；自动保留/异地复制未实现 |
| `preferences/` | 工作区个人 UI 偏好                         | 审核快捷标记与自动标签筛选 v1 JSON 已实现   |

本地 Blob 使用 `blobs/sha256/<前两位>/<次两位>/<完整摘要>` 布局。写入边界先把普通、非共享的 `Uint8Array` 精确可见范围复制到自有内存，再从该副本计算 SHA-256、字节长度和身份；默认单 Blob 上限为 64 MiB。调用方只能提交字节或经验证的 `{algorithm, digest, byteLength}` 身份，不能提交目标路径。

发布采用同目录临时文件和原子硬链接；相同内容幂等去重，已有或读取中的字节必须重新通过长度与摘要校验，损坏会作为可见错误返回。当前端口只负责不可变字节，不授予工作区访问权，也不是 HTTP/WS 接口；逻辑 Blob 记录、工作区所有权、引用、保留和删除授权由后续数据库与应用层实现。

当前 64 MiB 是适配器安全默认值，尚未成为外部运行配置项。工作区 Bundle 已具有 16 MiB 默认预算的 v1 规范 JSON reader/writer、`exports/` 文件落盘和同 ID 空库恢复用例；M1M 的 `maintenance backup/restore` 复用完整个人数据包，把 61 表、引用 Blob 和偏好写入 `backups/`，并只恢复到同 workspace 空数据库。自动保留、异地复制与非空合并仍未实现；详见[工作区 Bundle 合同](workspace-bundle-contract.md)和[生产运行与维护](production-operations.md)。

审核快捷栏、自动标签筛选和轻量词表整理规则使用
`preferences/<workspaceId>.review-preferences.json`。文件格式为
`struinfo.review-preferences` v1，保存最多 24 个个人快捷标记，以及自动标签启用状态、
URL 域名准入开关、最多 64 个精确排除词、最多 128 条别名、128 条翻译/相关提示和
64 条“词条 → KnowledgeKind”规则；整个 UTF-8 JSON 文件上限为 512 KiB。旧的仅含快捷标记或自动筛选的 v1 文件按空词表规则读取。
旧的仅含快捷标记的 v1 文件仍按“自动标签开启、
链接域名关闭、空排除列表”读取；文件缺失使用相同安全默认值。网页通过本地 API 整体替换
该配置。它不包含知识正文，不进入 Git、安装包或领域 Bundle，
也不会作为数据库迁移 seed。删除快捷标记只改变快捷入口，不删除已经创建的
`VocabularyTerm` 或既有审核结果。切换数据根或 `workspaceId` 后，应用在受控重开时读取
对应文件。显式合并词条仍通过版本化 Curation 命令迁移当前分类并退役来源词条；个人配置
只保存规范化、翻译/相关提示和知识类型偏好，不伪装成领域关系或删除历史。

## 6. Windows 本地示例

假设源码位于 `D:\work\StruInfo`，可以把活动配置和数据分别放在另一个明确的外部目录树：

```text
C:\StruInfoExample\Config\runtime.env
C:\StruInfoExample\Data\
```

`C:\StruInfoExample\Config\runtime.env` 的最小内容：

```dotenv
STRUIINFO_DATA_ROOT=C:\StruInfoExample\Data
STRUIINFO_WORKSPACE_ID=11111111-1111-4111-8111-111111111111
STRUIINFO_HOST=127.0.0.1
STRUIINFO_LOG_LEVEL=info
```

启动普通进程前由当前终端或秘密管理器注入：

```powershell
$env:STRUIINFO_CONFIG_PATH = 'C:\StruInfoExample\Config\runtime.env'
$env:DATABASE_URL_FILE = 'C:\StruInfoExample\Secrets\runtime-database-url.txt'
```

以上地址是占位符，不得把替换后的实际值保存回仓库文档或示例。

## 7. Linux 与容器示例

Linux 可以把只读活动配置放在 `/etc/struinfo/runtime.env`，把持久数据卷挂载到 `/var/lib/struinfo`，并通过 systemd credentials、容器 secret 或同等级机制注入数据库地址：

```dotenv
STRUIINFO_DATA_ROOT=/var/lib/struinfo
STRUIINFO_WORKSPACE_ID=11111111-1111-4111-8111-111111111111
STRUIINFO_HOST=127.0.0.1
STRUIINFO_LOG_LEVEL=info
```

应用安装目录（例如 `/opt/struinfo`）、配置目录和数据目录必须分离。M1M 的 `Dockerfile` 与两份 Compose 清单已经实现该挂载、非 root、只读根和 runtime/migrator secret 隔离；目标 Linux 镜像 digest、漏洞扫描和真实环境演练仍需通过上线审核。
容器中的 `localhost` 指向容器本身。外置 PostgreSQL 的 URL 必须使用容器可达的单一地址；
数据根应由宿主预先创建并允许容器用户 `10001:10001` 读写，配置与 secret 文件则保持只读。

## 8. 数据库迁移

迁移保持独立权限边界。`corepack pnpm run db:migrate` 只读取 `STRUIINFO_MIGRATION_DATABASE_URL` 或其互斥文件变量，不会把普通运行时的 `DATABASE_URL` 当作回退，也不通过普通进程隐式执行 DDL。迁移后以同一 migrator secret 运行 `corepack pnpm run db:prepare-queue`，再由数据库所有者应用 runtime grant；精确顺序见[生产运行与维护](production-operations.md)。这些高权限进程不读个人数据根。
