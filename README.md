# StruInfo

自托管的个人文档知识库。接收资料，整理文档，检索内容，生成报告。

[安装](docs/getting-started.md) · [AI 与 MCP](docs/agent-interface.md) · [备份与升级](docs/production-operations.md) · [开发规则](AGENTS.md)

## 使用

| 页面     | 操作                                     |
| -------- | ---------------------------------------- |
| 总览     | 查看统计、任务和消息，控制 AI            |
| 源管理   | 添加来源、手动导入、安排接收、审核资料   |
| 文档阅读 | 阅读原文，修改段落、标签与联系，确认发布 |
| 数据库   | 分类搜索、知识库问答、联网研究、生成报告 |
| 设置     | 调整外观、模型、规则、词表和通知         |

文档经过审核、拆分和标注后确认发布。
主题与重点联系在后台单独处理。
手动操作与 AI 共用接口，原文、草稿和确认版本分别保存。

## 运行

使用 Docker Compose 和 PostgreSQL 18。
配置、密钥、原文、个人偏好与备份保存于仓库外。
首次部署步骤见[安装指南](docs/getting-started.md)。
当前源码版本为 v0.5.0。已有实例升级时显式选择同一版本的应用与维护镜像。

AI、自动接收、联网和定时功能按配置启用。
报告支持站内发布、Markdown 导出和浏览器打印 PDF。
PDF 导入需要文本层。当前运行范围为单所有者、单实例。
界面样式统一及退役代码清理仍有待办，见[项目说明](docs/project.md)。

## 按需说明

- 来源：[接收配置](docs/source-receiving.md)、[往期补收](docs/source-history.md)、[拆分方案](docs/source-splitting.md)。
- 整理：[自动处理](docs/ingestion-automation.md)、[结构化标注](docs/structured-annotations.md)、[主题与联系](docs/content-topics.md)。
- 使用：[系统助手](docs/system-assistant.md)、[联网与报告](docs/network-research-and-reports.md)、[AI 与外部 Agent](docs/agent-interface.md)。
- 运维：[配置](docs/runtime-configuration.md)、[备份与升级](docs/production-operations.md)、[Windows 启停](docs/windows-instance-control.md)。
- 开发：[贡献指南](CONTRIBUTING.md)、[依赖记录](docs/dependencies/README.md)。
- 许可：[MIT](LICENSE)、[第三方声明](THIRD_PARTY_NOTICES.md)。

[历史技术文档](docs/archive/README.md)已归档。
