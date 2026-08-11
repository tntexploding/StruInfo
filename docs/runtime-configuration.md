# StruInfo 运行配置与数据根

- 状态：切片 0 已实现的运行时合同
- 最近更新：2026-08-11
- 对应决策：[ADR 0006](adr/0006-external-configuration-and-personal-data-isolation.md)

## 1. 边界

普通 `api`、`scheduler`、`worker` 和 `all` 进程启动前必须同时获得：

1. 由进程环境提供的 `STRUIINFO_CONFIG_PATH`，指向包体外的 UTF-8 dotenv 配置文件；
2. 由进程环境或秘密注入机制提供的 `DATABASE_URL`；
3. 由外部配置文件提供、可被同名进程环境覆盖的 `STRUIINFO_DATA_ROOT`。

活动配置文件、数据根和数据库都不是仓库输入或构建资源。配置文件只保存非秘密的运行参数；知识、词表、偏好、信源、策略和保存查询属于工作区数据库数据，快照、媒体、导出和备份属于外部数据根。它们都不得写进代码常量、迁移 seed、测试 fixture 或正式包体。

仓库不提供个人数据的相对路径回退。`.gitignore` 只是事故防护，不能把仓库内的 ignored 目录变成合法数据根。

## 2. 闭合配置项

外部配置文件只接受以下字段；任何其他字段都会使进程启动失败：

| 字段                            | 必需 | 默认值      | 说明                                     |
| ------------------------------- | ---- | ----------- | ---------------------------------------- |
| `STRUIINFO_DATA_ROOT`           | 是   | 无          | 已存在的绝对目录；启动后保存规范真实路径 |
| `STRUIINFO_HOST`                | 否   | `127.0.0.1` | API 监听地址                             |
| `STRUIINFO_PORT`                | 否   | `3000`      | API 端口，范围 1–65535                   |
| `STRUIINFO_HEALTH_HOST`         | 否   | `127.0.0.1` | scheduler/worker 健康检查监听地址        |
| `STRUIINFO_HEALTH_PORT`         | 否   | 按角色确定  | scheduler 默认 3001，worker 默认 3002    |
| `STRUIINFO_SHUTDOWN_TIMEOUT_MS` | 否   | `10000`     | 关闭预算，范围 1000–60000 毫秒           |
| `STRUIINFO_LOG_LEVEL`           | 否   | `info`      | `debug`、`info`、`warn` 或 `error`       |

同名进程环境变量会覆盖文件中的非秘密运行参数，便于容器和托管环境注入。`STRUIINFO_CONFIG_PATH`、`DATABASE_URL` 和迁移专用的 `STRUIINFO_MIGRATION_DATABASE_URL` 只能由进程环境/秘密机制提供，写入配置文件会被拒绝。

配置文件上限为 64 KiB，必须是现存普通文件和有效 UTF-8。错误信息只报告字段或合同问题，不回显数据库地址、未知字段名、配置内容或个人路径。

## 3. 路径规则

启动时会解析文件系统的规范绝对路径并跟随 symlink/junction。配置文件和数据根必须：

- 位于 Git 工作树、源码目录和安装包目录之外；
- 分别使用互不包含的目录树；
- 已经存在，且分别是普通文件和目录；
- 不把文件系统根目录本身用作数据根。

这会拒绝 `..`、目录链接或 Windows junction 绕过。容器部署仍须由部署配置把数据根挂载到外部持久卷或对象存储端口；应用不能仅凭路径判断一个目录是否真的持久化。

## 4. 外部数据根布局

普通运行角色在取得规范数据根后创建或验证四个固定区域。区域名由程序内部生成，调用方不能提供文件路径或目录片段；已有区域必须是位于数据根内的普通目录，文件、symlink 和 Windows junction 都会使启动或 Blob 操作失败。

| 相对目录   | 当前用途                                   | 当前实现状态                                 |
| ---------- | ------------------------------------------ | -------------------------------------------- |
| `blobs/`   | 不可变原始响应、大文本、图片和未来媒体字节 | 本地内容寻址适配器已实现                     |
| `uploads/` | 未来上传暂存；暂存内容不是已准入证据       | 只保留独立区域，尚无公开 reader/writer       |
| `exports/` | 未来版本化工作区导出                       | v1 字节信封已实现；文件落盘用例尚未实现      |
| `backups/` | 未来数据库与 Blob 联合备份、清单和恢复工件 | 只保留独立区域，格式、保留和恢复合同尚未定义 |

本地 Blob 使用 `blobs/sha256/<前两位>/<次两位>/<完整摘要>` 布局。写入边界先把普通、非共享的 `Uint8Array` 精确可见范围复制到自有内存，再从该副本计算 SHA-256、字节长度和身份；默认单 Blob 上限为 64 MiB。调用方只能提交字节或经验证的 `{algorithm, digest, byteLength}` 身份，不能提交目标路径。

发布采用同目录临时文件和原子硬链接；相同内容幂等去重，已有或读取中的字节必须重新通过长度与摘要校验，损坏会作为可见错误返回。当前端口只负责不可变字节，不授予工作区访问权，也不是 HTTP/WS 接口；逻辑 Blob 记录、工作区所有权、引用、保留和删除授权由后续数据库与应用层实现。

当前 64 MiB 是适配器安全默认值，尚未成为外部运行配置项。上传和备份的文件格式及恢复流程仍是后续切片。工作区 Bundle 已具有 16 MiB 默认预算的 v1 规范 JSON reader/writer，但还没有 `exports/` 文件命名、原子落盘、数据库一致性快照或完整恢复用例；详见[工作区 Bundle 合同](workspace-bundle-contract.md)。

## 5. Windows 本地示例

假设源码位于 `D:\work\StruInfo`，可以把活动配置和数据分别放在另一个明确的外部目录树：

```text
C:\StruInfoExample\Config\runtime.env
C:\StruInfoExample\Data\
```

`C:\StruInfoExample\Config\runtime.env` 的最小内容：

```dotenv
STRUIINFO_DATA_ROOT=C:\StruInfoExample\Data
STRUIINFO_HOST=127.0.0.1
STRUIINFO_LOG_LEVEL=info
```

启动普通进程前由当前终端或秘密管理器注入：

```powershell
$env:STRUIINFO_CONFIG_PATH = 'C:\StruInfoExample\Config\runtime.env'
$env:DATABASE_URL = 'postgresql://REPLACE_WITH_RUNTIME_CREDENTIALS@127.0.0.1/struinfo'
```

以上地址是占位符，不得把替换后的实际值保存回仓库文档或示例。

## 6. Linux 与容器示例

Linux 可以把只读活动配置放在 `/etc/struinfo/runtime.env`，把持久数据卷挂载到 `/var/lib/struinfo`，并通过 systemd credentials、容器 secret 或同等级机制注入数据库地址：

```dotenv
STRUIINFO_DATA_ROOT=/var/lib/struinfo
STRUIINFO_HOST=127.0.0.1
STRUIINFO_LOG_LEVEL=info
```

应用安装目录（例如 `/opt/struinfo`）、配置目录和数据目录必须分离。容器中的配置与数据必须分别挂载在镜像层之外；镜像构建和容器实测仍需通过既定制品准入门。

## 7. 数据库迁移

迁移保持独立权限边界。`corepack pnpm run db:migrate` 只读取 `STRUIINFO_MIGRATION_DATABASE_URL`，不会把普通运行时的 `DATABASE_URL` 当作回退，也不通过普通进程隐式执行 DDL。迁移进程当前不读个人数据根。
