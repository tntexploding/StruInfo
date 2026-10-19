# 首次安装

推荐用 Docker Compose 运行一个应用实例，连接 PostgreSQL 18。以下路径和名称是示例，请换成自己的位置。安装不需要模型密钥。

## 1. 准备数据库

在受信任网络内准备 PostgreSQL 18。用数据库管理员创建两个独立登录角色和一个数据库：

```sql
CREATE ROLE struinfo_tm2_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE struinfo_tm2_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE DATABASE struinfo OWNER struinfo_tm2_migrator;
```

通过 `psql` 的 `\password struinfo_tm2_migrator` 和 `\password struinfo_tm2_runtime` 分别设置密码，避免把密码保存在 SQL 文件或终端历史中。迁移账号拥有应用数据库；应用运行账号只获得后续授权脚本授予的权限。

数据库要能从应用容器访问。在 Docker Desktop 上，宿主机数据库通常使用 `host.docker.internal`；Linux 请使用已配置的容器网络名称或私网地址。容器中的 `localhost` 指向容器自身。当前数据库驱动使用受信任网络连接；跨不可信网络需要外层 TLS 隧道。

## 2. 准备仓库外目录

创建互相分离的配置、密钥和数据目录，例如：

```text
/srv/struinfo/config/runtime.env
/srv/struinfo/secrets/runtime-database-url.txt
/srv/struinfo/secrets/migration-database-url.txt
/srv/struinfo/data/
```

Windows 可以放在 `D:\StruInfo\` 下。不要放进代码目录或容器镜像。

把 `deploy/runtime.container.env.example` 复制为外部的 `runtime.env`，将 `STRUIINFO_WORKSPACE_ID` 换成新生成的小写 UUID。这个 UUID 是工作区身份，后续恢复备份仍要使用它。保留容器内 `STRUIINFO_DATA_ROOT=/var/lib/struinfo` 和 `STRUIINFO_HOST=0.0.0.0`。

两个 secret 文件分别只保存一行对应账号的 PostgreSQL URL：

```text
postgresql://struinfo_tm2_runtime:<经过URL编码的密码>@<数据库主机>:5432/struinfo
postgresql://struinfo_tm2_migrator:<经过URL编码的密码>@<数据库主机>:5432/struinfo
```

Linux 数据目录需允许容器的 `10001:10001` 用户读写；配置和 secret 文件需允许该用户读取。密钥文件不应向其他用户开放。

## 3. 构建并初始化

克隆仓库后，在 shell 中设置下面四个变量，值都指向刚准备的外部绝对路径。PowerShell 使用 `$env:变量名 = '路径'`，bash 使用 `export 变量名='路径'`。

```text
STRUIINFO_RUNTIME_CONFIG_FILE
STRUIINFO_DATA_ROOT
STRUIINFO_RUNTIME_DATABASE_URL_SECRET_FILE
STRUIINFO_MIGRATION_DATABASE_URL_SECRET_FILE
```

可额外设置 `STRUIINFO_HTTP_PORT=32100` 更换访问端口；默认是 3000。然后执行：

```bash
docker compose -f compose.production.yaml config --quiet
docker compose -f compose.production.yaml build
docker compose -f compose.production.yaml -f compose.maintenance.yaml --profile maintenance run --rm migrate
docker compose -f compose.production.yaml -f compose.maintenance.yaml --profile maintenance run --rm prepare-queue
```

用数据库所有者或管理员连接 **struinfo 数据库**，执行 `deploy/postgresql/apply-runtime-grants.sql`。这一步只授予应用权限，不创建角色或密码。随后：

```bash
docker compose -f compose.production.yaml --profile maintenance run --rm preflight
docker compose -f compose.production.yaml up -d app
docker compose -f compose.production.yaml ps
```

打开 <http://127.0.0.1:3000>，或你选定的端口。总览应显示服务就绪。点击文档入口，手动放入一份文件即可开始使用。

## 4. 可选配置

- **订阅**：在文档入口添加来源，检查来源介绍和待审正文，再决定接受方式。
- **AI**：按[运行配置](runtime-configuration.md)添加模型名及密钥文件，再重启应用。在设置中调整许可、并发、重试和价格时段。Docker 需通过自己的外部 override 挂载模型密钥并传入相应 `_FILE` 环境变量。
- **外部 Agent**：按 [MCP 接口](agent-interface.md)设置独立令牌和最小授权。
- **Windows 启动器**：按[实例控制](windows-instance-control.md)配置开始、停止和状态入口。
- **远程访问**：在应用外配置带认证的 HTTPS 反向代理、VPN 或 SSH 隧道，保持应用端口私有。

## 常见问题

| 现象                     | 处理                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| 端口无法监听             | 检查占用和系统保留端口，修改 `STRUIINFO_HTTP_PORT` 后重建应用容器 |
| 数据库连接失败           | 检查容器可达的主机名、数据库角色、secret 文件及数据库网络规则     |
| preflight 失败           | 依次确认迁移、prepare-queue、runtime grants 都已执行              |
| 页面能打开，AI 不工作    | 到设置检查模型配置和许可，再到总览看价格等待、预算或失败原因      |
| 工作台有文章，搜索没有   | 检查文章是否完成整理并确认入库；公开文档草稿不会进入查询          |
| 历史补收没有找到全部文章 | 查看来源的公开目录和探测状态，必要时提供该站点的往期目录地址      |

启动失败时先查看 `docker compose -f compose.production.yaml logs --tail 100 app`。不要在问题报告中附上密钥、数据库连接串或真实文档正文。升级、备份和空库恢复见[运行维护手册](production-operations.md)。
