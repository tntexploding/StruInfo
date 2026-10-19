# StruInfo

**把订阅和文档整理成可以检索、追溯和复用的个人知识库。**

[![Quality](https://github.com/tntexploding/StruInfo/actions/workflows/quality.yml/badge.svg)](https://github.com/tntexploding/StruInfo/actions/workflows/quality.yml)
[![Security](https://github.com/tntexploding/StruInfo/actions/workflows/maintenance-security.yml/badge.svg)](https://github.com/tntexploding/StruInfo/actions/workflows/maintenance-security.yml)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[安装](docs/getting-started.md) · [AI 与 MCP](docs/agent-interface.md) · [备份与升级](docs/production-operations.md) · [更新说明](docs/releases/v0.4.0.md) · [参与开发](CONTRIBUTING.md)

StruInfo 是自托管的个人文档工作区。订阅来源、上传文档、审核内容，然后在同一处阅读、拆分、打标签和建立联系。整理好的内容可以用于搜索、知识库问答和日报、周报、月报、专题报告。

原文与整理结果分别保存，每个条目都能回到出处。你可以手动整理，也可以配置 AI 完成接收审核到入库的流程。外部 Agent 可以通过 MCP 操作同一套接口。

## 可以做什么

| 你的任务                                         | 在哪里操作              |
| ------------------------------------------------ | ----------------------- |
| 订阅 RSS/Atom，查看来源介绍和待审核文章          | **文档入口**            |
| 上传 Markdown、文本、HTML 或带文本层的 PDF       | **文档入口 → 手动放入** |
| 按来源、时间范围补收往期文章                     | **文档入口 → 补收往期** |
| 阅读原文、检查拆分、调整标签和联系、按需翻译     | **工作台**              |
| 搜索正文和标签、查看联系图、向知识库提问         | **数据阅览**            |
| 生成日报、周报、月报、专题报告或资料摘录         | **报告**                |
| 查看处理进度、等待原因、失败任务，继续或取消任务 | **总览**                |
| 调整外观、处理规则、AI 并发和重试、价格时段      | **设置**                |

界面支持深浅色、可调列宽、记忆展开状态、阅读字体和光效设置。刷新保留当前页面，新打开项目进入总览。

## 从第一篇文档开始

1. 在文档入口添加来源或上传文件，先查看收到的正文。
2. 选择接受、拒绝，或让 AI 审核。不确定的内容会留下原因，等待你决定。
3. 接受的公开文档进入工作台。启用 AI 后，可继续完成拆分、标签、联系和入库；也可手动整理。
4. 检查原文中的分段位置、条目标签和联系。人工修改后点击**确认入库**。
5. 在数据阅览中检索已入库内容，或在报告页选择时间和主题生成报告。

连贯文章默认保持完整，只有独立可读的合集才拆分。AI 可以判断不需要建立联系。处理中的公开文档和未确认修改留在工作台，完成后才供搜索、问答、图谱和新报告使用。隐私文档使用手动处理，查看时需明确选择包含隐私内容。

## 安装与启动

推荐使用 **Docker Compose + PostgreSQL 18**，以 `all` 单实例运行。应用、数据库和持久数据分开保存。

[首次安装指南](docs/getting-started.md)包含数据库角色、配置、迁移和启动步骤。已有实例请按 [v0.4.0 升级说明](docs/releases/v0.4.0.md)先备份再升级。

配置完成后的常用命令：

```bash
# 启动
docker compose -f compose.production.yaml up -d app
# 检查
docker compose -f compose.production.yaml ps
# 查看日志
docker compose -f compose.production.yaml logs --tail 100 app
# 停止
docker compose -f compose.production.yaml stop app
```

默认访问地址是 <http://127.0.0.1:3000>；通过 `STRUIINFO_HTTP_PORT` 可以更换宿主端口。Windows 可使用[独立启动器](docs/windows-instance-control.md)管理已配置的实例。

StruInfo 面向单个所有者。远程使用时，通过带认证的 HTTPS 反向代理、VPN 或 SSH 隧道访问。应用自身不提供多用户登录，端口应保持在回环或受信任私网内。

## AI 怎么使用

AI 默认不配置。安装完成后，按[模型配置说明](docs/runtime-configuration.md#deepseek)设置 DeepSeek 或 OpenAI 的模型与外部密钥文件，再在设置中选择允许的操作。

- **手动触发**：选择文档，执行审核、整理、翻译、问答或报告。
- **自动处理**：为选定来源启用新资料策略，按文档完成审核、拆分、标签、联系和入库。
- **运行限制**：遵守全局允许/拒绝、并发、每篇调用上限、有限重试和价格时段。
- **人工优先**：拒绝、暂缓和手动修改不会被自动任务覆盖。失败任务保留断点；总览显示原因和可用操作。

模型调用可能产生费用。自动处理范围、重试额度和价格时段由你配置；没有模型也能完成导入、手动整理、词法搜索和资料摘录。语义向量检索需要另行配置 Embedding 模型。

外部 Agent 有独立令牌和授权。可以只读，也可以授予导入、拆分、标签和联系写入；不需要让 Agent 操作界面。连接示例和工具列表见 [Agent / MCP 接口](docs/agent-interface.md)。

## 数据与备份

- PostgreSQL 保存文档结构、条目、标签、联系和任务。
- 仓库外的数据目录保存原文、个人偏好、导出和备份。
- 密钥通过环境或独立文件注入，不写入仓库、镜像或前端。
- 备份包含数据库中的工作区数据及引用的原文字节。恢复目标必须是同一工作区的空库。

升级前停写并创建、校验备份。数据库与数据目录需要一起保护，不能只备份镜像。完整命令见[运行与维护](docs/production-operations.md)。

## 使用范围

- 支持 RSS/Atom、公开 GitHub Markdown、声明式 JSON API、受限网页和受信任连接器。往期补收依据来源公开目录，不能保证覆盖网站的全部历史。
- PDF 需要文本层；当前不提供 OCR、音视频转写或付费内容解锁。
- AI 问答和报告提供原文引用，仍需结合来源核对。报告支持 Markdown 下载和浏览器打印 PDF，未内置外部推送渠道。
- 当前运行方式是单所有者、单实例；多租户、集群写入和跨工作区合并不在支持范围。

## 开发与验证

要求 Node.js `>=24.18.0`、Corepack 和 pnpm `11.20.0`：

```bash
git clone https://github.com/tntexploding/StruInfo.git
cd StruInfo
corepack enable
pnpm install --frozen-lockfile --ignore-scripts
pnpm verify
```

`verify` 执行格式、静态检查、类型检查、单元/集成测试、构建和制品检查。另可运行：

```bash
pnpm test:e2e                         # 使用本机已安装的 Chrome
pnpm performance:m2-p0d -- --smoke    # 使用 Docker 创建临时 PostgreSQL
pnpm audit --prod --audit-level low
```

这些检查使用合成数据。真实资料、模型密钥和实例记录保存在仓库外。项目结构和贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 更多说明

- [历史补收](docs/source-history.md)
- [订阅与自动处理](docs/ingestion-automation.md)
- [运行配置](docs/runtime-configuration.md)
- [安装、备份与维护](docs/production-operations.md)
- [架构](docs/knowledge-core-architecture.md) · [实现记录](docs/current-project-state.md) · [路线图](docs/roadmap.md)
- [MIT 许可证](LICENSE) · [第三方声明](THIRD_PARTY_NOTICES.md)
