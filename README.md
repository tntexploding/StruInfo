# StruInfo

StruInfo 是一个来源可追溯、AI 可增强的个人知识摄取与维护系统。它保存指定信源或手工资料的原始证据，通过同一套手工、确定性规则或 AI 提案命令拆分、比较、关联和重组版本化知识，并通过网页提供审核、接管、浏览和带出处检索。没有 AI 供应商时，知识编辑、关系维护、结构化搜索、导入和导出仍然完整可用。

长期形态仍是在线个人信息枢纽；日报/周报、QQbot、公共外部 API 和云端部署是知识核心稳定后的交互与运行层，不是首个产品闭环。

基础技术架构、M0-S 工程地基、来源/Markdown/人工审核/知识/确定性检索领域核心、六份前向迁移、四类 PostgreSQL adapters、本机产品 HTTP 和四个浏览器工作区已经具备。
一份固定周刊已经在真实 PostgreSQL 18 和本机网页上完成代表性纵向验证；随后固定十期均通过正式导入器，并完成最小领域 Bundle 的外部导出与空库恢复。这不表示已经生产就绪，正式环境认证与发布门随后处理。
首个信源已确定为[阮一峰科技周刊](https://github.com/ruanyf/weekly)。产品侧先验证：

> 固定周刊语料 → 保存来源与文档结构 → 独立分类与准入 → 手工/确定性拆分、连接和重组 → 版本化知识变更 → 无 AI 网页搜索、纠错与导出 → 可选 AI 增强

## 当前文档

- [当前产品需求](docs/product-requirements.md)
- [当前分阶段计划](docs/roadmap.md)
- [开发大纲与架构提案](docs/development-outline.md)
- [知识核心与个人数据边界](docs/knowledge-core-architecture.md)
- [包体外运行配置与数据根](docs/runtime-configuration.md)
- [M1C 本地产品 HTTP 接口](docs/m1c-local-http-api.md)
- [工作区 Bundle 合同](docs/workspace-bundle-contract.md)
- [候选应用制品边界](docs/application-artifact-boundary.md)
- [确定性 Markdown 结构合同](docs/deterministic-markdown-structure-contract.md)
- [人工分类与准入合同](docs/manual-curation-contract.md)
- [人工知识核心合同（固定候选 TM1 已通过）](docs/manual-knowledge-core-contract.md)
- [确定性知识检索合同（固定候选 TM1 已通过）](docs/deterministic-knowledge-retrieval-contract.md)
- [PostgreSQL 知识适配与等价性合同](docs/postgresql-knowledge-adapter-contract.md)
- [阶段 0 首批语料与行为冻结](docs/stage-0-corpus-freeze.md)
- [真实样本采集模板](docs/sample-intake-template.md)
- [历史需求归档](docs/archive/product-requirements-v0.1.md)

## 工程治理

- [开发规范](docs/development-standards.md)
- [延期强化备忘](docs/deferred-hardening-memo.md)
- [开源与第三方依赖策略](docs/open-source-policy.md)
- [贡献与审查流程](CONTRIBUTING.md)
- [决策日志](docs/decision-log.md)
- [ADR 流程](docs/adr/README.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)

项目已接受 TypeScript 模块化单体与 PostgreSQL/不可变 Blob 的基础方向，但尚未选择发布许可证。
M0-P 探针代码只作为架构证据，不直接复用为生产实现。

仓库和应用包只保存协议、迁移、代码与合成示例。实际资料、知识、偏好、词表、提示覆盖、快照、媒体、导出、备份和运行配置全部位于包体外；同一构建通过受控更换外部配置或重新打开工作区完成资料集切换，不需要修改代码或把“记忆文件”加入 Git。

完整本地质量门使用 `corepack pnpm run verify`，其中包含格式、Lint、类型、测试、构建和候选应用制品审计。

## 当前最重要的下一步

`M1C-PERSIST`、`M1C-API`、`M1C-WEB`、`M1C-VERTICAL`、`M1C-EXPAND`、`M1C-PRIVATE` 和 `M1C-USE-1`–`6` 均已完成：同一回环监听器提供资料/证据、快速审核、知识维护、搜索/出处四个工作区，工作区与 Blob 根仍由包体外配置选择。固定 `ruanyf/weekly` issue 405 已在真实浏览器和 disposable PostgreSQL 18 上完成代表性审核、知识项/关系、Framework 重组、撤回修订和精确原文回溯；固定 398–407 期又通过正式导入器写入 10 个 Snapshot、2,639 个正式 Fragment。网页从持久化 `DocumentNode.nodeKind` 精确重建 345 个 section 审核单元，并把已审核且准入的条目组成“审核转知识”队列；短条目可直接确认后写入，成功后由来源过滤搜索回读并自动前进，复杂拆分与关系仍进入高级编辑器。

当前 36 张领域表可以导出为包体外 Bundle，并在同一 Workspace ID 的空数据库中恢复；Blob 仍由外部内容寻址数据根单独保管。下一步由维护者直接搜索、修订和关联这些真实知识，只实现使用过程中出现的材料性产品阻碍，不预先建设批处理或偏好模型。正式 TM2 harness、容器/Linux/发布认证、查询下推和索引、复杂知识视图、AI 与偏好学习继续独立排期；未完成的正式门会如实记录，但不阻塞产品主线。
