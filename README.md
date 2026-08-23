# StruInfo

StruInfo 是一个来源可追溯、AI 可增强但不依赖 AI 的个人资料整理与知识维护工作台。当前可运行产品以 `InformationEntry` 为普通文档单元：保存原始证据后，用户按“导入 → 拆分 → 标签 → 联系 → 查询”处理资料，并能从结果返回精确来源。

M1E-2 已把正式知识实现为 Entry 节点、自动相似联系与用户关系共同组成的可编辑图谱。简单搜索选择最高匹配 Entry 为中心，用户可改名、定向、隐藏、恢复或创建关系，并随时返回精确来源。AI 提案、在线信源、报告和外部项目接口仍未实现。

## 当前可运行基线

- 一个模块化 TypeScript 单体，同一构建可按 API、scheduler、worker 或 `all` 角色启动；
- PostgreSQL 18 保存 Evidence、当前 Entry、Document 标签、Entry 联系和兼容历史数据；
- 外部内容寻址 Blob 根保存原始/规范化资料字节；
- 外部 `preferences/` 保存快捷标签、自动提取设置、排除词、URL 规则和确认别名；
- React/Vite 网页提供“总览、导入、拆分、标签、联系、查询、正式知识”七个活动页面；
- 正式知识页提供最高匹配中心、候选改选、有界关系图/等价列表、关系来源与用户编辑；
- 个人数据包导出/恢复 45 张当前工作区表、引用 Blob 字节和当前偏好；
- 固定 398–407 期已形成 10 个 Snapshot、2,639 个 Fragment、345 个 Entry 和 598 个历史验证期关联投影。

当前无 AI 主线支持：

1. 手工 Markdown 或固定 Git Markdown 导入；
2. CommonMark/周刊结构解析和 section Entry 物化；
3. 内容、类型、领域三维标签及有用/有趣两个五档评价；
4. 文档标签聚合与人工覆盖；
5. 可解释的确定性 Entry 联系及逐对增强、削弱、屏蔽、恢复；
6. 文本、标签、来源、时间、隐私和一至两跳联系查询；
7. Entry 中心正式关系图谱、自动/用户关系编辑与隐私范围；
8. 精确 Snapshot/Fragment 来源回看和包体外个人数据传输。

旧 Manual Curation、正式 Knowledge 写入/当前读取和旧 Knowledge 检索运行时已由 ADR 0009 删除。对应迁移、历史表和个人数据包旧分区只为用户数据兼容保留。

## 当前文档

- [当前项目状态与实现清单](docs/current-project-state.md)
- [当前产品需求](docs/product-requirements.md)
- [当前分阶段计划](docs/roadmap.md)
- [开发大纲与目标架构](docs/development-outline.md)
- [知识核心与个人数据边界](docs/knowledge-core-architecture.md)
- [当前本地产品 HTTP 接口](docs/m1c-local-http-api.md)
- [包体外运行配置与数据根](docs/runtime-configuration.md)
- [个人数据包合同](docs/workspace-bundle-contract.md)
- [候选应用制品边界](docs/application-artifact-boundary.md)
- [文档条目处理准则](docs/document-entry-processing-guidelines.md)
- [决策日志](docs/decision-log.md)与 [ADR](docs/adr/README.md)

详细的历史合同和验收证据仍保存在 `docs/`，但不能从旧合同推导当前运行时仍公开相应能力。判断现状时以[当前项目状态与实现清单](docs/current-project-state.md)为准。

## 工程治理

- [开发规范](docs/development-standards.md)
- [延期强化备忘](docs/deferred-hardening-memo.md)
- [开源与第三方依赖策略](docs/open-source-policy.md)
- [贡献与审查流程](CONTRIBUTING.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)

仓库和应用包只保存协议、迁移、代码与合成示例。实际资料、知识、偏好、词表、提示覆盖、快照、媒体、导出、备份和运行配置全部位于包体外；切换工作区不需要修改代码或把“记忆文件”加入 Git。

完整本地质量门使用：

```powershell
corepack pnpm run verify
```

## 当前最重要的下一步

M1E-2 的最小纵向链已经完成。下一步以实际使用 345 个 Entry 的知识图谱为准：优先修复可达的中心选择、关系编辑、来源回看或携带性问题，再决定 M1E-3 是否需要知识树、集合、时间线或其他明确功能。

完整隐私文档查询结果、手工拆分、更多导入格式和联系策略编辑也可按真实反馈作为小增量。AI、RAG、向量、自动采集、容器/公网认证和发布门继续后置，除非当前产品路径出现可复现阻断。
