# StruInfo 生产运行与维护

- 状态：M1M 单机生产操作边界已实现；真实环境演练未签发
- 最近更新：2026-08-27
- 决策：[ADR 0045](adr/0045-operational-production-baseline.md)

## 1. 适用范围

本手册面向一个所有者、一个外部 PostgreSQL 18 数据库和一个持久外部数据根。它覆盖构建、
迁移、队列 schema、runtime 权限、预检、启动、健康、备份、空库恢复和前向升级。

它不宣称已经完成公网 TLS/认证、多用户隔离、云编排、自动保留策略、跨 workspace 克隆、
非空合并或公开发行。仓库仍为 `UNLICENSED`，不得把下面的可运行边界解释为分发许可。

## 2. 外部状态

操作员在仓库和镜像之外准备：

- PostgreSQL 18 数据库，以及已有的 `struinfo_tm2_migrator`、`struinfo_tm2_runtime` 角色；
- 只含非秘密值的 runtime 配置文件，可从
  `deploy/runtime.container.env.example` 复制到外部位置；
- runtime 与 migrator 两个独立、只读、单行数据库 URL secret 文件；
- 一个持久绝对数据根，容器内固定挂载为 `/var/lib/struinfo`。

普通应用只能读取 runtime secret。迁移和队列准备只在显式组合
`compose.maintenance.yaml` 时获得 migrator secret。OpenAI key 如需启用，可通过
`OPENAI_API_KEY` 或 `OPENAI_API_KEY_FILE` 注入；两者不得同时提供。

## 3. 首次部署和升级顺序

先构建镜像并解析配置：

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

启动脚本和本手册都不要求把 URL 或个人路径提交到 Git。

## 5. 健康与日志

- `/health/live`：进程存活；
- `/health/ready`：有界数据库 readiness；容器 healthcheck 使用该端点；
- 标准输出：现有 newline-delimited 结构化日志；不要把 URL、secret 或文档正文加入操作日志；
- 停止：向容器发送正常停止信号，Compose 给应用 30 秒优雅关闭窗口。

readiness 失败时不要自动运行迁移或扩大 runtime 权限。先查看迁移、queue schema、数据库角色、
外部数据根和只读挂载是否按本手册配置。

## 6. 备份与恢复

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

## 7. 上线前仍需完成

- 在目标 Linux/容器宿主上构建镜像，记录不可变 digest、基础镜像材料和漏洞扫描；
- 用真实但非个人的 disposable PostgreSQL 18 演练迁移、grant、backup、空库 restore 和重启；
- 根据实际部署决定 TLS、认证、反向代理、备份保留、监控告警和资源预算；
- 公开或分发前选择许可证并完成发布审查。

这些事项必须如实记录，但除非出现当前可达的产品阻断，不应重新演变为无休止的测试框架
强化循环。
