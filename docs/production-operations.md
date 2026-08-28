# StruInfo 生产运行与维护

- 状态：`v0.1.0` 私人单用户运行边界；本地演练已通过，目标云端待配置
- 最近更新：2026-08-28
- 决策：[ADR 0045](adr/0045-operational-production-baseline.md)

## 1. 适用范围

本手册面向一个所有者、一个外部 PostgreSQL 18 数据库和一个持久外部数据根。它覆盖构建、
迁移、队列 schema、runtime 权限、预检、启动、健康、备份、空库恢复和前向升级。

它不宣称已经完成公共 HTTP 服务、多用户隔离、云编排、自动保留策略、跨 workspace 克隆或
非空合并。项目代码采用 MIT License；第三方材料继续遵循各自许可证和声明。

本地与云端部署都按私人服务处理：Compose 默认只发布宿主回环地址，远程访问应使用带 HTTPS
和单用户认证的宿主反向代理、VPN 或 SSH 隧道，不直接开放应用端口。GitHub、RSS/Atom、声明式 API、受限网页、
受信任连接器和显式 OpenAI 能力是受控公网出站，不是公网入站；未配置的能力不得自行联网。

## 2. 外部状态

操作员在仓库和镜像之外准备：

- PostgreSQL 18 数据库，以及已有的 `struinfo_tm2_migrator`、`struinfo_tm2_runtime` 角色；
- 只含非秘密值的 runtime 配置文件，可从
  `deploy/runtime.container.env.example` 复制到外部位置；
- runtime 与 migrator 两个独立、只读、单行数据库 URL secret 文件；
- 一个持久绝对数据根，容器内固定挂载为 `/var/lib/struinfo`。

数据库 URL 必须使用一个明确的 DNS 名称或 IP 地址。容器中的 `localhost` / `127.0.0.1`
只指向应用容器本身；外置 PostgreSQL 应使用容器可达的主机名、私网地址或编排服务名。
当前驱动边界固定 `ssl=false`，因此仅适用于同机或受信任私网。跨不可信网络部署必须先在
外层提供 TLS 隧道/代理，或另行接受 PostgreSQL TLS 配置边界。

普通应用只能读取 runtime secret。迁移和队列准备只在显式组合
`compose.maintenance.yaml` 时获得 migrator secret。OpenAI key 如需启用，可通过
`OPENAI_API_KEY` 或 `OPENAI_API_KEY_FILE` 注入；两者不得同时提供。

## 3. 首次部署和升级顺序

Dockerfile 已把 Node 24 bookworm-slim 固定到不可变多架构 digest。首次依赖安装可由受控构建主机访问包注册表并执行仓库供应链策略；随后的源码构建和生产依赖组装均关闭网络，只从同一构建阶段已经验证的共享冻结锁文件与本地 pnpm store 裁剪精确版本。离线 deploy 仅信任这份刚验证的锁文件，不解析新版本，并排除应用未使用的可选平台适配包；运行容器不需要访问包注册表。先构建镜像并解析配置：

```powershell
docker compose -f compose.production.yaml build
docker compose -f compose.production.yaml config --quiet
docker compose -f compose.production.yaml -f compose.maintenance.yaml --profile maintenance config --quiet
```

把以下变量指向外部绝对路径：

```text
STRUIINFO_RUNTIME_CONFIG_FILE
STRUIINFO_DATA_ROOT
STRUIINFO_RUNTIME_DATABASE_URL_SECRET_FILE
STRUIINFO_MIGRATION_DATABASE_URL_SECRET_FILE
```

目标 Linux 上应预先创建数据根，并保证容器用户 `10001:10001` 可以读写该目录；runtime
配置和 secret 文件只需该用户可读。不要用仓库目录、镜像层或临时容器文件系统替代持久数据根。

随后按固定顺序执行：

```powershell
docker compose -f compose.production.yaml -f compose.maintenance.yaml --profile maintenance run --rm migrate
docker compose -f compose.production.yaml -f compose.maintenance.yaml --profile maintenance run --rm prepare-queue
```

数据库所有者再用 `psql` 应用
`deploy/postgresql/apply-runtime-grants.sql`。该脚本故意不创建角色、不设置密码，也不属于普通
应用容器。然后运行：

```powershell
docker compose -f compose.production.yaml --profile maintenance run --rm preflight
docker compose -f compose.production.yaml up -d app
docker compose -f compose.production.yaml ps
```

升级时先停止应用写入并完成备份，再重复“迁移 → 队列准备 → grant → preflight → 启动”。
迁移只前进，不自动向后执行 DDL。

## 4. 本机非容器命令

同一边界也可在仓库内运行。先设置 `STRUIINFO_CONFIG_PATH`，再通过直接变量或互斥的文件变量
提供秘密：

```powershell
$env:STRUIINFO_MIGRATION_DATABASE_URL_FILE = 'D:\external\secrets\migrator.url'
corepack pnpm run db:migrate
corepack pnpm run db:prepare-queue

$env:DATABASE_URL_FILE = 'D:\external\secrets\runtime.url'
corepack pnpm run maintenance -- preflight
corepack pnpm run maintenance -- backup
corepack pnpm run start:all
```

`start:all` 直接从 TypeScript 源码启动，适合本地调试。执行 `corepack pnpm run build` 后，
可用 `corepack pnpm run start:all:built` 从与容器相同的编译产物启动。需要拆分角色时使用
`start:api`、`start:scheduler` 和 `start:worker`。前台进程按 `Ctrl+C` 触发优雅关闭。
这些启动脚本和本手册都不要求把 URL 或个人路径提交到 Git。

## 5. 健康与日志

- `/health/live`：进程存活；
- `/health/ready`：有界数据库 readiness；容器 healthcheck 使用该端点；
- 标准输出：现有 newline-delimited 结构化日志；不要把 URL、secret 或文档正文加入操作日志；
- 停止：向容器发送正常停止信号，Compose 给应用 30 秒优雅关闭窗口。

readiness 失败时不要自动运行迁移或扩大 runtime 权限。先查看迁移、queue schema、数据库角色、
外部数据根和只读挂载是否按本手册配置。

## 6. 云端 HTTP 反向代理

`compose.production.yaml` 必须继续把应用映射为
`127.0.0.1:${STRUIINFO_HTTP_PORT}:3000`。公网只开放宿主代理的 `80/443`；不要开放应用端口、
PostgreSQL 端口或数据根。`deploy/reverse-proxy/Caddyfile.example` 提供 Caddy 示例：公共侧使用
HTTPS 和 Basic Auth，内部以普通 HTTP 转发到回环应用。认证覆盖 Web、API 和健康路径；宿主监控可直接读取回环健康端点。

上线前先完成域名 A/AAAA 记录。用交互式命令生成密码哈希，避免把明文密码写入 shell 历史：

```bash
caddy hash-password
```

把示例复制到仓库外的宿主配置，替换域名、ACME 邮箱、用户名、密码哈希和回环端口。配置文件只允许管理员读取。然后验证并重载：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

主机防火墙只开放必要的管理端口以及 `80/443`。先从宿主确认
`http://127.0.0.1:${STRUIINFO_HTTP_PORT}/health/ready`，再从远端确认未认证请求被拒绝、认证后的
首页/API 可用、证书链有效且响应带 HSTS。应用层已经发送 CSP、禁止嵌入、权限策略、
`nosniff` 和 `no-referrer`；HSTS 由终止 TLS 的代理发送。

此边界是单所有者认证，不是多用户账户系统。若需要 OAuth、公开 API、按用户授权或共享访问，必须先增加独立产品边界。

## 7. 备份与恢复

为形成清晰的一致性点，先停止应用写入，再执行：

```powershell
docker compose -f compose.production.yaml --profile maintenance run --rm backup
```

命令在外部数据根 `backups/` 下生成版本化 `*.personal-data.json`，并只输出文件名、字节数、
SHA-256、Blob 数和表行数。内容包括当前完整工作区数据库分区、引用 Blob 字节和外部偏好；
不包括运行配置、secret 或可重建的 pg-boss 内部队列表。

恢复目标必须已经执行全部迁移和队列准备，workspace ID 必须相同，业务工作区必须为空。
设置安全文件名后运行：

```powershell
$env:STRUIINFO_RESTORE_FILE = 'backup-name.personal-data.json'
docker compose -f compose.production.yaml --profile maintenance run --rm restore
```

恢复成功后重新运行 preflight，再启动应用。任何非空目标、损坏文件、缺失 Blob 或身份不匹配
都会失败而不应被覆盖。需要回滚升级时，优先修复前向兼容问题；必须恢复时，创建干净数据库
和数据根、应用同版本 schema 后恢复备份，再切换外部配置。不要在原非空工作区上强制回滚。

## 8. 云端上线检查

- 在目标 Linux/容器宿主拉取固定 `v0.1.0` 源码或镜像，记录不可变 commit、image digest、基础镜像材料和漏洞扫描；
- 复用本地已通过的 PostgreSQL 18.6 合成演练顺序，在云端 disposable 空库复核迁移、队列准备、grant、preflight、backup、空库 restore 和重启；
- 保持应用端口只绑定回环，按第 6 节配置 HTTPS、认证反向代理和宿主防火墙；
- 确认订阅/抓取/Provider 仅按显式配置出站，并决定备份保留、监控告警和资源预算；
- 确认是否以空工作区启动或恢复一份所有者明确指定的备份；代码部署不得隐式复制本地个人数据；
- 按 MIT License、第三方声明、依赖许可证和 SBOM 完成发行制品复核。

这些事项必须如实记录，但除非出现当前可达的产品阻断，不应重新演变为无休止的测试框架
强化循环。

2026-08-27 的本地发布演练已完成上述数据库操作链：Docker Desktop 上的官方 PostgreSQL
18.6 disposable 空库通过 25 份迁移、首次 pg-boss schema 准备、runtime grant、preflight、
回环健康、合成写入、完整个人数据备份、同 workspace 空库恢复和停止/重启。该结果用于缩短
云端操作。2026-08-28 的 `struinfo:0.1.0` 本地最终镜像 ID 为
`sha256:de269bec525745961f4fd5f3344391f6168a5ae00c5a80fdd29e031c8af96c6f`，Trivy 0.66.0
报告 HIGH 0、CRITICAL 0；这仍不表示云主机自身镜像、宿主防火墙、备份保留或告警已经完成。
