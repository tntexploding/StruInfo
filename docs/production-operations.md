# 运行与维护

适用范围：单所有者、单个 all 进程、PostgreSQL 18 和外部数据目录。
当前源码版本为 v0.5.0。首次部署见[安装指南](getting-started.md)。
应用和维护命令显式使用同一个 STRUIINFO_IMAGE。
维护 Compose 的旧默认版本待修正，升级时填写目标版本。

## 外部配置

准备以下变量对应的文件或目录：

```text
STRUIINFO_RUNTIME_CONFIG_FILE
STRUIINFO_DATA_ROOT
STRUIINFO_RUNTIME_DATABASE_URL_SECRET_FILE
STRUIINFO_MIGRATION_DATABASE_URL_SECRET_FILE
```

容器用户 10001:10001 需要读写数据目录，并读取配置与密钥文件。
应用使用 runtime 凭据。迁移和队列准备使用独立的 migrator 凭据。
两种凭据保存于仓库外。运行配置见[runtime-configuration.md](runtime-configuration.md)。

## 升级

先停写并完成可验证的备份，保留旧镜像和配置。
在 PowerShell 中选择版本，随后检查 Compose：

```powershell
$env:STRUIINFO_IMAGE = 'struinfo:0.5.0'
docker compose -f compose.production.yaml config --quiet
docker compose -f compose.production.yaml -f compose.maintenance.yaml --profile maintenance config --quiet
docker compose -f compose.production.yaml -f compose.maintenance.yaml --profile maintenance run --rm migrate
docker compose -f compose.production.yaml -f compose.maintenance.yaml --profile maintenance run --rm prepare-queue
```

数据库所有者使用 psql 执行 deploy/postgresql/apply-runtime-grants.sql。
随后运行：

```powershell
docker compose -f compose.production.yaml --profile maintenance run --rm preflight
docker compose -f compose.production.yaml up -d app
docker compose -f compose.production.yaml ps
```

迁移失败时保留现场，处理原因后再继续。
迁移文件保留原字节，修正通过后续迁移完成。
应用账号权限见[数据库迁移](database-migrations-and-roles.md)。

## 备份与恢复

停止应用写入后备份：

```powershell
docker compose -f compose.production.yaml --profile maintenance run --rm backup
```

备份位于外部数据根的 backups/，包含工作区内容、引用原文和偏好。
运行配置和密钥单独备份。维护命令支持 backup list、backup verify 和保留预览。
输出文件名、摘要、Blob 数和表行数，用于核对。

恢复前准备同 workspace ID 的空数据库与空数据根。
执行迁移、队列准备和权限授权。
将已验证文件放入目标 backups/：

```powershell
$env:STRUIINFO_RESTORE_FILE = 'backup-name.personal-data.json'
docker compose -f compose.production.yaml --profile maintenance run --rm restore
docker compose -f compose.production.yaml --profile maintenance run --rm preflight
```

恢复完成后检查内容与引用，再启动应用。
恢复会暂停自动策略和活动任务，由所有者重新启用。
保留原备份和旧实例，直到恢复核验完成。
数据包格式见[备份内容](workspace-bundle-contract.md)。

## 非容器启动

设置外部 STRUIINFO_CONFIG_PATH 和数据库凭据后运行：

```text
corepack pnpm run start:all
corepack pnpm run start:all:built
```

第二个命令使用已构建产物。日常 Windows 启停见[实例控制](windows-instance-control.md)。

## 健康与访问

使用 /health/live、/health/ready 查看存活与就绪状态。
故障日志保留时间、任务身份和错误码，凭据与正文保持脱敏。
Compose 默认绑定回环地址。远程访问通过受控代理、HTTPS、VPN 或 SSH 隧道。
模型和来源配置在个人工作区管理，升级保留原有许可与范围。
