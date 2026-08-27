# ADR 0045: 可维护的单机生产运行基线

- 状态：Accepted
- 日期：2026-08-27
- 里程碑：M1M

## 背景

M1I–M1L 已补齐外部信源、正式知识、可替换检索/RAG 和按证据性能优化。上线前最后一个产品
工程边界不是再增加知识能力，而是把现有模块化单体变成可重复启动、检查、备份、恢复和升级
的单机部署。项目仍处于无真实资料开发基线，因此本阶段只交付代码、配置模板、合成验证和
操作说明，不恢复个人数据，也不把正式 Docker/Linux/PostgreSQL 演练伪写成已经通过。

## 决策

### 一个最小运行镜像，两份权限隔离的 Compose 清单

仓库提供多阶段 `Dockerfile`。构建阶段使用固定 Node 24 系列与 pnpm 11.20.0，运行阶段只复制
生产依赖、编译结果、迁移、Web 静态文件及许可证/SBOM 材料，并以非 root 用户运行。
`compose.production.yaml` 只拥有 runtime 数据库凭据，提供应用、预检、备份和恢复；
`compose.maintenance.yaml` 单独持有 migrator 凭据，只运行前向迁移和 pg-boss schema 准备。
普通应用清单不得请求高权限密钥。

runtime 与 migrator URL 都保持闭合的单 host 语法，但 host 可为明确 DNS 名称、IPv4 或 IPv6，
以支持外置 PostgreSQL 和容器服务发现；socket、多个 host、query/fragment 覆盖继续拒绝。
当前 node-postgres 投影固定 `ssl=false`，只适用于同机或受信任私网。公网数据库 TLS 属于
目标部署边界，不能由本机单用户基线暗示已经具备。

容器默认只把 HTTP 端口发布到宿主回环地址，根文件系统只读，移除 Linux capabilities，启用
`no-new-privileges`、资源上限、只读配置挂载和独立持久数据根。公网 TLS、认证和反向代理不是
这个本机单用户基线的一部分。

### 密钥只通过进程或只读文件注入

`DATABASE_URL`、`STRUIINFO_MIGRATION_DATABASE_URL` 和 `OPENAI_API_KEY` 各自支持互斥的
`*_FILE` 变量。文件必须是绝对路径、普通文件、至多 16 KiB、严格 UTF-8 且恰好一条非空
内容；值与路径不会进入正常输出。运行配置示例只包含非秘密参数，秘密、个人数据和配置正文
不进入 Git、镜像或个人数据包。

### 迁移、队列准备、权限和应用启动严格排序

升级顺序固定为：停止写入并备份 → 前向迁移 → 独立准备 pg-boss schema → 由数据库所有者
应用 runtime grant → 运行只读预检 → 启动应用 → 检查 readiness。日常应用仍禁止 DDL；
`deploy/postgresql/apply-runtime-grants.sql` 不创建角色或密码，只把现有固定 runtime 角色收敛
到当前可达的 schema/table/queue DML。它是单用户产品运行权限基线，不是云端多租户安全证明。

### 备份恢复复用完整个人数据包

`maintenance backup` 把当前 61 张工作区表、被引用 Blob 字节和外部偏好写入外部数据根的
`backups/` 区域；`restore --file` 只接受安全文件名，并复用既有“同 workspace、空数据库、
原子恢复”边界。升级备份应在停止应用写入后执行，以便数据库快照、Blob 与偏好形成一个明确
操作点。恢复不会覆盖非空工作区，也不承担跨 workspace 克隆或非空合并。

### 监控与发布边界保持诚实

容器 readiness 复用 `/health/ready`，存活检查复用 `/health/live`，进程继续输出现有结构化
日志并优雅关闭。M1M 增加静态 deployment verifier，并把它纳入 `verify`；Compose 语法和
pnpm production deploy 也作为开发验证执行。

项目代码已由所有者选择 MIT License，运行镜像和候选包必须同时携带项目许可证与第三方
许可证材料。Node 24 bookworm-slim 构建/运行阶段固定到不可变多架构 digest
`sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df`。真实 Linux 镜像扫描和
PostgreSQL 18 权限/恢复演练仍需执行。因此 M1M 表示生产操作代码边界已具备，不表示目标
环境验收已经通过。

## 结果

- 五步主线、数据库模型、Provider 与个人数据格式不变；没有迁移或新依赖；
- 日常运行、维护运行和高权限 schema 操作有独立入口与凭据；
- 备份/恢复成为可执行维护命令，而不是未使用目录；
- 真实部署审核、镜像 digest/扫描、私人网络入口和生产灾难恢复演练留给统一上线审核，
  不反向阻塞与其无关的产品逻辑开发。

## 操作手册

精确命令、顺序、失败处理和回滚方式见
[生产运行与维护](../production-operations.md)。

## 后续实证（2026-08-27）

在本 ADR 接受后，本地 Docker Desktop 与官方 PostgreSQL 18.6 disposable 环境使用纯合成数据
完成全部 25 份迁移、首次 pg-boss schema 准备、runtime grant、preflight、回环 HTTP 健康、
完整个人数据备份、同 workspace 空库恢复、Blob/数据库对照和停止/重启。演练暴露并修复了
node-postgres 多语句结果投影与 PDF.js 启动期可选 Canvas 依赖两个可达缺陷。该后续实证不改变
原决策，也不替代目标云服务器的镜像扫描、私网/防火墙、备份保留和监控验收。
