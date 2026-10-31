# 数据库迁移与账号

PostgreSQL 18 使用独立的迁移账号和应用账号。
迁移账号执行 DDL，应用账号执行已授权的业务读写。
配置与密码保存在仓库外。

## 入口

- 迁移：pnpm db:migrate。
- 队列准备：pnpm db:prepare-queue。
- 应用授权：deploy/postgresql/apply-runtime-grants.sql。
- 预检：pnpm maintenance preflight。
- SQL 文件：apps/server/migrations/。

迁移入口读取 STRUIINFO_MIGRATION_DATABASE_URL 或对应的 _FILE 变量。
应用入口读取 DATABASE_URL 或 DATABASE_URL_FILE。
各组变量选择一种提供方式。

## 执行

停止业务写入并备份。
按迁移、队列准备、运行账号授权、预检、启动的顺序执行。
容器命令见[运行维护](production-operations.md)。

迁移登记与 SQL 在事务中提交。
已执行迁移保留原字节。校验失败或连接中断时先检查状态。
修正采用后续迁移；恢复采用验证过的备份和空目标工作区。
