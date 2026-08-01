# StruInfo

StruInfo 是一个处于开发前准备阶段的 AI 原生在线个人信息枢纽。它计划持续获取用户关注的信息，保存可核验的来源，由 AI 完成筛选、总结、结构化和关联，再通过查询、知识树、时间线、日报/周报及外部项目接口提供服务。

当前已进入技术提案阶段，但技术栈尚未接受，也不会提前建立实现脚手架。
产品侧先验证一条纵向闭环：

> 已知信源定时采集 → 保存快照 → AI 加工 → 可追溯日报 → 一键入库 → 查询与推送

## 当前文档

- [当前产品需求](docs/product-requirements.md)
- [当前分阶段计划](docs/roadmap.md)
- [开发大纲与架构提案](docs/development-outline.md)
- [真实样本采集模板](docs/sample-intake-template.md)
- [历史需求归档](docs/archive/product-requirements-v0.1.md)

## 工程治理

- [开发规范](docs/development-standards.md)
- [开源与第三方依赖策略](docs/open-source-policy.md)
- [贡献与审查流程](CONTRIBUTING.md)
- [决策日志](docs/decision-log.md)
- [ADR 流程](docs/adr/README.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)

项目已有候选技术栈，但尚未通过 ADR 正式接受，也尚未选择发布许可证。
在完成确认与技术探针前，不以空脚手架预设结论。

## 当前最重要的下一步

评审开发大纲，确认 Windows 数据库环境、AI 数据外发边界和主后端语言。
通过技术探针后接受基础 ADR，再建立源码脚手架。
