# StruInfo

StruInfo 是一个处于开发前准备阶段的 AI 原生在线个人信息枢纽。它计划持续获取用户关注的信息，保存可核验的来源，由 AI 完成筛选、总结、结构化和关联，再通过查询、知识树、时间线、日报/周报及外部项目接口提供服务。

基础技术架构已于 2026-08-08 通过 M0-P 评审并由 ADR 正式接受，项目准备进入 M0-S 工程地基阶段。
这不表示已经生产就绪；精确依赖、锁文件、CI、许可证记录和真实场景仍需分别完成。
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

项目已接受 TypeScript 模块化单体与 PostgreSQL/不可变 Blob 的基础方向，但尚未选择发布许可证。
M0-P 探针代码只作为架构证据，不直接复用为生产实现。

## 当前最重要的下一步

建立 M0-S 工程地基：固定精确工具链与依赖、创建最小脚手架和数据库迁移、接入 CI 与统一质量门，并完成首轮依赖许可记录。
同时使用真实主题、信源样本和理想日报冻结第一个产品纵向切片。
