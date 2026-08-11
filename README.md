# StruInfo

StruInfo 是一个来源可追溯、AI 可增强的个人知识摄取与维护系统。它保存指定信源或手工资料的原始证据，通过同一套手工、确定性规则或 AI 提案命令拆分、比较、关联和重组版本化知识，并通过网页提供审核、接管、浏览和带出处检索。没有 AI 供应商时，知识编辑、关系维护、结构化搜索、导入和导出仍然完整可用。

长期形态仍是在线个人信息枢纽；日报/周报、QQbot、公共外部 API 和云端部署是知识核心稳定后的交互与运行层，不是首个产品闭环。

基础技术架构已于 2026-08-08 通过 M0-P 评审，非浏览器、非容器的 M0-S 工程地基已于 2026-08-10 完成并由 ADR 正式接受。
这不表示已经生产就绪；浏览器与容器制品、真实 PostgreSQL、项目发布许可证和真实使用场景仍有独立后续门。
首个信源已确定为[阮一峰科技周刊](https://github.com/ruanyf/weekly)。产品侧先验证：

> 固定周刊语料 → 保存来源与文档结构 → 独立分类与准入 → 手工/确定性拆分、连接和重组 → 版本化知识变更 → 无 AI 网页搜索、纠错与导出 → 可选 AI 增强

## 当前文档

- [当前产品需求](docs/product-requirements.md)
- [当前分阶段计划](docs/roadmap.md)
- [开发大纲与架构提案](docs/development-outline.md)
- [知识核心与个人数据边界](docs/knowledge-core-architecture.md)
- [包体外运行配置与数据根](docs/runtime-configuration.md)
- [工作区 Bundle 合同](docs/workspace-bundle-contract.md)
- [候选应用制品边界](docs/application-artifact-boundary.md)
- [确定性 Markdown 结构合同](docs/deterministic-markdown-structure-contract.md)
- [阶段 0 首批语料与行为冻结](docs/stage-0-corpus-freeze.md)
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

完整本地质量门使用 `corepack pnpm run verify`，其中包含格式、Lint、类型、测试、构建和候选应用制品审计。

## 当前最重要的下一步

第 398–407 期周刊已固定到同一上游提交，并形成 345 个内容单元、图片引用和证据定位清单。版本化关系知识模型与无 AI 操作合同已经接受；切片 0 的包体外配置、数据区域、本地 Blob、候选包内容清单和合成工作区 Bundle/秘密排除合同已经完成。`Workspace → Resource → Snapshot → DocumentNode/Fragment → MediaAsset` 的来源证据迁移与闭合纯逻辑边界已经通过固定候选 TM1。[`C-SLICE-A-MARKDOWN-r1`](docs/deterministic-markdown-structure-contract.md) 已冻结下一增量的纯 CommonMark 解析、周刊 profile、规范定位、ID 无关结构哈希和 Evidence 装配边界；实现通过后再冻结与内容分类相互独立的人工准入决定。偏好校准继续作为后续输入，不阻塞知识数据库核心。
AI 拆分、关系建议、语义检索和偏好学习随后接入同一套提案与正式命令边界。
真实 PostgreSQL 执行、浏览器运行时和容器制品仍处于各自具名准入门之后；当前 TM1 结论不代表这些门已经通过。
