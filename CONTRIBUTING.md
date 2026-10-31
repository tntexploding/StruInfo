# 贡献指南

开发前阅读 AGENTS.md 列出的四份文件。其他资料按任务查阅。

## 开发

使用 Node.js >=24.18.0、Corepack 和 pnpm 11.20.0。

```bash
corepack enable
pnpm install --frozen-lockfile --ignore-scripts
```

从当前需求和相关调用者确定修改范围。
更新对应说明，删除失效段落。历史过程保存在 Git 或归档中。
保留未提交的无关修改和所有者文件。

普通改动只运行相关检查。文档清理检查字数、归档完整性和链接。
测试使用合成数据。界面验收查看实际页面及指定样板。

## 发布

发布前执行：

```bash
pnpm verify
pnpm test:e2e
pnpm test:publication
pnpm performance:m2-p0d -- --smoke
pnpm audit --prod --audit-level low
docker build --tag struinfo:review .
```

检查包含类型、逻辑、构建、制品、浏览器、临时数据库和依赖。
浏览器使用已安装的 Chrome。数据库检查使用临时 Docker 容器。
失败后根据产品缺陷、旧断言或环境问题处理，复测受影响部分。
发布前同步版本、更新说明、许可证和 SBOM。

公开 main 保持独立历史。发布提交接在公开 main 之后，保留内部开发历史隔离。
部署按停写、备份、迁移、队列准备、授权、预检、启动的顺序执行。
具体命令见[运行维护](docs/production-operations.md)。

## 依赖与许可

代码使用 MIT。新增或升级依赖时核对来源、锁定版本、许可证和分发要求。
同步锁文件、THIRD_PARTY_NOTICES.md、许可证材料和 SBOM。
复制第三方代码时记录来源与修改，保留原声明。
详表见[依赖记录](docs/dependencies/README.md)。
