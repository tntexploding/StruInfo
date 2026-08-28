# StruInfo

StruInfo 是一个来源可追溯、AI 可增强但不依赖 AI 的个人资料整理与知识维护工作台。当前可运行产品以 `InformationEntry` 为普通文档单元：保存原始证据后，用户按“导入 → 拆分 → 标签 → 联系 → 查询”处理资料，并能从词法、语义或混合检索结果返回精确来源。

M1E-2 已把正式知识实现为 Entry 节点、自动相似联系与用户关系共同组成的可编辑图谱。M1J 又补齐八类关系语义、维护说明、来源核验状态和双端精确来源；自动相似边仍明确标为计算结果，不冒充已核验事实。M1E-3A–D 已实现任务状态，以及可选的公开 Snapshot 拆分、公开 Entry 标签和 selected-pair 联系提案；M1I 已接通 GitHub Markdown、RSS/Atom、声明式 JSON API、受限同源网页和已安装受信任连接器。M1K 已加入可重建词项/向量投影、可选语义与混合检索、合成检索评估和基于本地精确来源的 RAG 综合；没有 Embedding Provider 时，原有词法主线仍完整可用。报告和外部项目写接口仍未实现。

## 当前私人发行状态

`v0.1.0` 是面向单一所有者的首个私人部署版本。所有者已经使用包体外资料完成初步产品审核；真实文档、条目、Blob、偏好、导出、备份、数据库和运行配置仍只存在于外部数据根与数据库中，不进入本公开代码仓库、Git 历史或容器镜像。仓库测试继续只使用合成且无个人含义的 fixture。

## 当前可运行基线

- 一个模块化 TypeScript 单体，同一构建可按 API、scheduler、worker 或 `all` 角色启动；
- PostgreSQL 18 保存 Evidence、当前 Entry、Document 标签、Entry 联系和兼容历史数据；
- 外部内容寻址 Blob 根保存原始/规范化资料字节；
- 外部 `preferences/` 保存快捷标签、自动提取设置、排除词、URL 规则、确认别名、自动化策略、信源订阅及 opaque 插件配置引用；
- React/Vite 网页提供“总览、导入、拆分、标签、联系、查询、正式知识”七个活动页面；
- 正式知识页提供最高匹配中心、候选改选、有界关系图/等价列表、关系来源、语义、说明、来源核验、双端来源与用户编辑；
- 可重建检索层保存 Unicode 词项投影和可选标准浮点向量；Query 明示词法/语义/混合模式、索引状态与人工重建，不把派生索引放入个人数据包；
- 个人数据包可导出/恢复当前 61 张工作区表、引用 Blob 字节和当前偏好。

无需 AI 即可运行的主线支持：

1. 手工/批量本地 Markdown、文本、HTML、PDF 导入，以及 GitHub Markdown、RSS/Atom、声明式 JSON API、受限同源网页或已安装受信任连接器订阅；
2. CommonMark/周刊结构解析和 section Entry 物化；
3. 内容、类型、领域三维标签及有用/有趣两个五档评价；
4. 文档标签聚合与人工覆盖；
5. 可解释的确定性 Entry 联系及逐对增强、削弱、屏蔽、恢复；
6. 文本、标签、来源、时间、隐私和一至两跳联系查询；配置可选 Embedding Provider 后可切换语义或混合召回；
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
- [生产运行与维护](docs/production-operations.md)
- [文档条目处理准则](docs/document-entry-processing-guidelines.md)
- [决策日志](docs/decision-log.md)与 [ADR](docs/adr/README.md)

详细的历史合同和验收证据仍保存在 `docs/`，但不能从旧合同推导当前运行时仍公开相应能力。判断现状时以[当前项目状态与实现清单](docs/current-project-state.md)为准。

## 工程治理

- [开发规范](docs/development-standards.md)
- [延期强化备忘](docs/deferred-hardening-memo.md)
- [开源与第三方依赖策略](docs/open-source-policy.md)
- [贡献与审查流程](CONTRIBUTING.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)
- [安全策略](SECURITY.md)
- [版本变更](CHANGELOG.md)

StruInfo 采用 [MIT License](LICENSE)。第三方依赖仍分别遵循
[第三方声明](THIRD_PARTY_NOTICES.md)及随制品保留的原始许可证。

仓库和应用包只保存协议、迁移、代码与合成示例。实际资料、知识、偏好、词表、提示覆盖、快照、媒体、导出、备份和运行配置全部位于包体外；切换工作区不需要修改代码或把“记忆文件”加入 Git。

## 本机快速启动

准备一个仓库外的数据目录、runtime 配置文件和只含单行 PostgreSQL URL 的 secret 文件，
然后在 PowerShell 中设置：

```powershell
$env:STRUIINFO_CONFIG_PATH = 'C:\StruInfoExample\Config\runtime.env'
$env:DATABASE_URL_FILE = 'C:\StruInfoExample\Secrets\runtime-database-url.txt'
corepack pnpm run start:all
```

默认 Web/API 地址为 `http://127.0.0.1:3000`，按 `Ctrl+C` 停止。完整运行配置、迁移和权限
顺序见[生产运行与维护](docs/production-operations.md)。构建后也可用
`corepack pnpm run start:all:built` 启动编译产物。

完整本地质量门使用：

```powershell
corepack pnpm run verify
```

## 发行与云端部署

M1I 外部信源、M1J 正式知识深化、M1K 分词/向量/RAG、M1L 性能优化和 M1M 单机生产运行边界均已进入 `v0.1.0`。本地 Docker/PostgreSQL 18 的迁移、权限、健康、备份、空库恢复和重启演练已经通过。

应用不是公共多用户 API。容器端口必须继续绑定宿主回环；远程访问只能通过已启用 HTTPS 与单用户认证的反向代理、VPN 或 SSH 隧道。云端操作顺序、Caddy 反向代理示例、外部 secret、持久数据根、备份和恢复见[生产运行与维护](docs/production-operations.md)。订阅、网页抓取、连接器和显式 Provider 是受控公网出站，与应用端口公开无关。
