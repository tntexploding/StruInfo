# StruInfo

StruInfo 是一个处于开发前准备阶段的 AI 原生在线个人信息枢纽。它计划持续获取用户关注的信息，保存可核验的来源，由 AI 完成筛选、总结、结构化和关联，再通过查询、知识树、时间线、日报/周报及外部项目接口提供服务。

当前阶段不做技术选型和功能开发，先验证一条纵向闭环：

> 已知信源定时采集 → 保存快照 → AI 加工 → 可追溯日报 → 一键入库 → 查询与推送

## 当前文档

- [当前产品需求](docs/product-requirements.md)
- [当前分阶段计划](docs/roadmap.md)
- [真实样本采集模板](docs/sample-intake-template.md)
- [历史需求归档](docs/archive/product-requirements-v0.1.md)

## 工程治理

- [开发规范](docs/development-standards.md)
- [开源与第三方依赖策略](docs/open-source-policy.md)
- [贡献与审查流程](CONTRIBUTING.md)
- [决策日志](docs/decision-log.md)
- [ADR 流程](docs/adr/README.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)

项目尚未选择技术栈或发布许可证。相关选择将在开发大纲阶段通过决策记录确认，不以空脚手架预设结论。

## 当前最重要的下一步

编写开发大纲，确认运行时、仓库边界、持久化、AI 接口、测试工具和部署策略，并为高影响选择建立 ADR。
