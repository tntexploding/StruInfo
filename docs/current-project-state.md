# StruInfo 当前项目状态与实现清单

- 状态：v0.2.0 维护基线；五项近期路线图完成，现有私人 Docker 实例已升级；常规功能开发暂停
- 实现基线：M1I-1A/B 至 M1M + 首版 UI/发行基线 + M2-P0A–P0G + M2-P1A–D + M2-P2A–G + M2-P3A–C + 冻结的 M2-P4A–E + M2-P5A–D
- 最近核对：2026-09-05（五项联合审查完成；维护基线 v0.2.0）
- 当前阶段：常规功能开发暂停，转入使用与必要维护；[维护交接](maintenance-handoff.md)记录本次有限收尾
- 需求边界：[产品需求](product-requirements.md)
- 交付顺序：[分阶段计划](roadmap.md)
- 架构边界：[知识核心架构](knowledge-core-architecture.md)

## 0. 当前数据与发行基线

2026-08-24，既有文档、条目、标签、联系、历史兼容行、Blob、偏好和导出曾完整移入项目目录外的恢复归档，以建立无数据开发基线。首版曾由所有者使用外部资料完成直接审核；当前 M2 开发基线再次保持无真实资料，批量能力只以合成数据验证，不从恢复归档导入或复制内容。

现在必须同时保持两条不混淆的边界：

- 真实资料只存在于所有者选择的外部 PostgreSQL、数据根、偏好、导出和备份中；
- Git、公开源码发行、容器镜像和自动化测试继续保持无个人数据；
- 不把周报、个人条目、偏好、数据库副本、Blob、运行配置或 secret 放入仓库或镜像；
- 单元、集成和浏览器回归仍只使用合成且无个人含义的数据，并在结束后清理；
- 只有当前公开产品路径可复现的 `PRODUCT_BLOCKER` 可以阻断下一增量。

历史文档中的实测数字只记录当次开发证据；当前外部工作区的内容以所有者实际部署为准，不能从 Git 或发行制品推导。

M2-P5A 进一步固定三种不互相替代的身份：公开 `v0.1.0` 的提交/tree、包含后续 M2 增量的当前开发线，以及所有者确认已投入使用的私人云端 Docker 实例。该历史阶段没有登录目标主机，不能用该记录证明其他实例的 commit、镜像 digest、网络或数据状态。本次有限收尾已定位并独立核验所有者指定的本机 Docker 实例；升级、备份恢复及维护结果见[维护交接](maintenance-handoff.md)，实际身份继续只在外部运维记录中保存。

M2-P5B 已补齐当前 workspace 备份盘点、完整只读 package 校验和 keep-latest 保留预览。应用不会自动删除备份；真实云端备份身份、保留数量与恢复演练结果仍由外部运维记录证明。

M2-P5C/D 又补齐可外部调度的脱敏运行状态报告，以及贯穿导入、拆分、标签、联系、查询和知识读取的 disposable PostgreSQL 18 发行回归。当前开发候选仍不是云端运行身份；固定提交、镜像验证和升级必须在所有者明确的发行操作中完成。

### 0.1 2026-09-05 代码核对结论

本次核对以提交 `89d7c32a7f0d41066a1e018c2c269aa37523e9f4` 和其上的当前工作树为对象。
覆盖运行时接线、HTTP 路由、维护命令、主要领域服务、PostgreSQL 读取实现、Web 状态及代表性测试。
这是代码与入口核对，没有读取外部真实资料、调用真实 Provider 或登录云端。

当前定位是**单用户、证据可追溯的 Entry 摄取、维护和检索工作台**。
无 AI 主链、可选公开证据 AI、受限来源订阅、确定性自动处理、批量维护和备份工具都已有实现。
下一阶段应降低已有能力的使用成本；继续增加 Provider、连接器或泛化学习不是默认优先项。

| 能力面         | 当前可达入口与代码证据                                                                                                                                                                                                 | 必须保留的限制                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档进入       | [本地文件校验](../apps/web/src/workspaces/local_file_import.ts)、[HTML/PDF 投影](../apps/server/src/modules/evidence/documents/document_projection.ts)及导入页                                                         | 六种扩展名；单文件最多 1 MiB、显式批次最多 20 份；PDF 只读取文字层；上传队列仅在当前页面会话存在                                               |
| 持续采集       | [运行时接线](../apps/server/src/composition/start_role_runtime.ts)中的 Git reader、RSS/Atom、JSON API、受限 Web 和受信任插件注入                                                                                       | 精确配置、默认关闭间隔检查；固定 Git 文件不会自动发现下一期；网页最多八个同源指定页面；插件注入不等于自带第三方插件或插件市场                  |
| Entry 与结构   | [Entry 仓储](../apps/server/src/modules/entries/information_entry_repository.ts)、[结构重组](../apps/server/src/modules/entries/information_entry_restructuring.ts)及拆分/标签页                                       | 普通编辑为当前态加并发版本；原始证据不变；首次物化、派生全文及已有结构替换是不同的显式操作                                                     |
| 查询与图谱     | [检索服务](../apps/server/src/modules/entries/information_entry_retrieval.ts)、[图谱核心](../apps/server/src/modules/entries/information_entry_knowledge_graph.ts)及查询/知识页                                        | 词法完整可用；语义/混合要求公开范围、模型配置和完整当前索引；图谱默认 12、最多 24 个可见直接邻居，另返回可恢复的隐藏关系                       |
| AI             | [三类提案接线](../apps/server/src/composition/start_role_runtime.ts)、[查询综合](../apps/server/src/modules/entries/information_entry_query_synthesis.ts)                                                              | 拆分、标签、选定条目对联系需人工接受；综合重新读取同一查询范围前八条公开证据，不等于当前页或全库回答；答案仅属会话                             |
| 偏好与自动处理 | [策略与任务 HTTP](../apps/server/src/transport/m1c_api_controller.ts)、[确定性推进动作](../apps/server/src/modules/processing/entry_automation_action_service.ts)及标签页                                              | 显式策略允许路由、确定性标签及可替换联系投影；不授权 AI 自动接受、正文改写、用户图关系修改、忽略或删除                                         |
| 批量处理       | [maintenance 命令](../apps/server/src/operations/m1m_maintenance.ts)、[统一推进服务](../apps/server/src/modules/processing/bulk_ingestion_pipeline_service.ts)                                                         | 面向已入库 Snapshot，单批最多 500 Snapshot / 50,000 计划 Entry；分类复核包最多 100 项、其他包最多 20 项；不是后台大文件上传或通用 Web 批处理器 |
| 运行与迁移     | [个人数据传输](../apps/server/src/workspace_transfer/m1c_workspace_transfer.ts)、[运行状态报告](../apps/server/src/operations/m2_p5c_operational_status.ts)、[认证代理示例](../deploy/reverse-proxy/Caddyfile.example) | 数据包支持同 workspace 空目标恢复；备份保留仅预览；认证依赖私人部署的宿主代理；没有内建多用户权限、非空合并或异地灾备编排                      |

**本次读取候选单独记录：**空条件 Entry 浏览已新增数据库计数/分页，索引状态已新增聚合读取，联系与知识页已新增按端点读取邻域；Web 同时有图谱交互与文案调整。
对应入口是 `loadCurrentEntryBrowsePage`、`loadSearchIndexMetrics`、`loadAssociationSnapshotForEntries` 和 `readInformationEntryKnowledgeGraph`。
这些改动在盘点开始前已存在、当时尚未提交，现纳入第一、二项集成提交；不能视为公开发行或云端已部署，也不能再作为“从零实现”的后续任务。
复杂过滤、fuzzy、Association 查询等仍可能完整加载，局部优化不代表全语义 SQL 下推。

**冻结实验：**maintenance 仍保留类型学习 export/apply/activate 的代码入口，但 M2-P4R 的冻结是明确的产品与操作边界，不代表这些命令已经从代码删除，也不代表泛化质量已通过。

**本轮验证：**在最初代码盘点后，已按所有者选定顺序完成第 1 项本地候选收口。
完整 `verify` 通过 1,017 项单元测试、4 项集成测试及构建/产物/部署源码检查；14 项真实 Chrome 浏览器回归通过。
PostgreSQL 18.6 合成 smoke 执行全部 30 个迁移，并通过 45 次分页、48 次图谱和 60 次复杂查询的完整对象等价比较，记录读取行数、耗时和采样 RSS。
同时修复图谱迟到请求、来源栏焦点/关闭/重试、200% 字号状态栏及运行编号展示；结果、测量限制和环境说明见[当前候选收口记录](current-candidate-closure.md)。
测试只使用合成内容，没有运行真实 Provider、标准规模 `--full`、镜像或云端检查。以上为第 1 项独立历史记录；最新结果见下述集成审查。

**第 2 项已实现：**[ADR 0066](adr/0066-resumable-incremental-search-index-maintenance.md) 为查询页增加公开 Entry“刷新变化项”。每批最多 32 项，复用未变化的有界输入/向量，已提交投影即恢复检查点；支持本批后暂停、重新打开后继续和失败重试，数据库提交拒绝过期或隐私已收窄的结果。完整重建作为显式修复保留，无模型时词项路径完整可用。新增恢复验证已在一次性 PostgreSQL 18.6 与真实 Chrome 合成场景通过；具体测量、检查结果及未验证环境见[交付记录](incremental-index-maintenance.md)。没有新增迁移、依赖、后台调度或数据包部分；以上为第二项阶段记录。

**第一、二项集成通过并提交：**修复人工关系保存失败后接受 AI 提案未刷新图谱的问题，新增对应浏览器回归；查询与增量刷新组合验证确认结果、精确来源、浏览页和游标完整相等。修复后完整 `verify` 通过 1,026 项单元、4 项集成及构建/产物检查，17 项 Chrome 回归与 PostgreSQL 18.6 合成 smoke 通过；没有新增迁移、依赖或未解决的产品阻断。详见[集成审查](incremental-index-maintenance.md#集成审查)。本轮交付为本地提交，未发布或部署。

**第 3 项已实现：**[ADR 0067](adr/0067-saved-entry-queries-and-reading-context.md) 增加外部版本化命名查询和选中位置。查询页支持保存、更新、重命名、删除与重新执行；来源/图谱返回保留当前条件，非首页条目单独读取当前版本。隐私范围须在重新打开时明确选择，旧数据包补空，新包携带该字段。没有保存结果正文、cursor、比较或 AI 答案，也没有新增迁移或依赖。验证与使用方式见[交付记录](saved-query-context.md)。

**第 4 项已实现：**[ADR 0068](adr/0068-version-bound-relation-source-review.md) 增加“知识 → 来源复核”日常维护列表、双端精确来源和保存后继续。迁移 `000031` 绑定核验时两端 Entry revision，当前版本变化或旧记录无绑定时显示需要复核；新 Association Bundle v5 携带这两个字段，旧包补空。分页前过滤隐私、退役和隐藏关系，保存同时检查端点与 override 版本，投影重建不覆盖人工维护。具体使用与验证见[交付记录](relation-source-review.md)。当前仍为本地开发状态，没有发布或部署。

**第 5 项已实现：**[ADR 0069](adr/0069-cited-entry-markdown-export.md) 增加“查询 → 资料清单与导出”，可跨页手动选择最多 20 条，核对版本和隐私后生成带精确引用的 Markdown 并下载。来源原文与当前条目摘录分离，已有关系保留方向、来源和有效复核状态；版本或预览变化明确拒绝，文件只进入外部 `exports/`。没有新增迁移、依赖、Provider 或领域数据写入，见[交付记录](cited-entry-export.md)。

**第 3–5 项联合审查通过：**已修复查询切换期间旧结果仍可操作、重新查询后页码错位，以及数据包恢复回滚可能覆盖并发偏好保存的问题。全仓 verify、29 项 Chrome 回归和 PostgreSQL 18.6 合成检查通过，当前包版本文档已统一；范围、证据及限制见[联合审查记录](query-review-export-integration.md)。

下一开发顺序和各项退出条件见[路线图：下一开发顺序](roadmap.md#下一开发顺序2026-09-05-代码核对)。

## 1. 如何阅读本项目状态

本文是“当前代码到底能做什么”的实现真值表。产品需求描述长期目标，路线图描述交付顺序，
ADR 记录已经接受的决策；当历史文档中的旧 M1C 示例与当前代码冲突时，以 ADR 0008、
ADR 0009、ADR 0010、ADR 0011、ADR 0012、ADR 0013、ADR 0014、ADR 0015、ADR 0016、ADR 0017、ADR 0018、ADR 0019、ADR 0020、ADR 0021、ADR 0022、ADR 0023、ADR 0024、ADR 0025、ADR 0026、ADR 0027、ADR 0028、ADR 0029、ADR 0030、ADR 0031、ADR 0032、ADR 0033、ADR 0034、ADR 0035、ADR 0036、ADR 0037、ADR 0038、ADR 0039、ADR 0040、ADR 0041、ADR 0042、ADR 0043、ADR 0044、ADR 0045、ADR 0046、ADR 0047、ADR 0048、ADR 0049、ADR 0050、ADR 0051、ADR 0052、ADR 0053、ADR 0054、ADR 0055、ADR 0056、ADR 0057、ADR 0058、ADR 0059、ADR 0060、ADR 0061、ADR 0062、ADR 0063、ADR 0064、ADR 0065、ADR 0066、ADR 0067、ADR 0068、ADR 0069 和本文列出的活动入口为准。

状态只使用三种含义：

- **已实现**：当前产品入口可以调用，且代码、测试和构建仍在活动质量门中；
- **兼容保留**：为了读取既有数据库或个人数据包而保留，但当前产品没有对应写入/操作入口；
- **未实现**：只有需求、设计或诚实占位，不得在 UI、文档或验收中描述为可用。

## 2. 当前可运行主链

```text
包体外配置 + 外部数据根
  → 手动 Markdown / 固定 Git 文件 / 单份或显式批次本地 .md、.markdown、.txt、.html、.htm、.pdf 文件
  → 或从外部配置的 GitHub Markdown、RSS/Atom、JSON API、受限网页或已安装连接器手动/到期检查变化
  → 外部内容寻址 Blob + PostgreSQL Resource/Snapshot
  → DocumentNode/Fragment 结构与精确证据
  → 可选：Codex 通过 maintenance 批次冻结最多 500 个尚未物化的 Snapshot，并逐 Snapshot 可恢复生成 Entry
  → 可选：同一成功批次按 Snapshot 原子追加确定性内容关键词并补齐唯一高置信度类型/领域，只增量重建与本批 Entry 相接的联系，并汇总规则异常
  → 可选：Codex 汇总异常；将当前疑难项成批导出到外部审阅工作包，闭合回写完整标签、接受、转人工或延期
  → 可选：用统一有限窗口命令按物化 → enrichment → 复核顺序推进，并根据持久状态恢复
  → 用户选择尚未物化的 Snapshot，以人工 Fragment/标量区间分组、确定性规则或已接受 AI 提案生成当前 InformationEntry
  → 已物化后仍可由所有者编辑完整分组、预览标签/沿袭/关系影响并原子替换当前 Entry 结构
  → 可选：订阅变化后按已启用的单订阅开关直接复用确定性物化与可恢复分流
  → 编辑有用/有趣评分与内容/类型/领域标签
  → 聚合当前 Document 标签
  → 重建可解释的 Entry 关联，并人工增强/削弱/屏蔽/恢复
  → 可选：对明确选中的两个公开 Entry 生成 AI 联系提案，人工接受后写入现有图谱边界
  → 显式重建绑定当前 Entry revision 的本地词项和可选公共向量派生索引
  → 按词法/语义/混合模式、字段范围、结构、时间、隐私和一至两跳关联查询 Entry
  → 可选：对本地召回的前八条公开证据进行会话内 RAG 综合并返回精确出处
  → 可选：以当前选中结果为锚点，按外部探索策略显式生成页外直接联系候选
  → 显式隐私范围内另行查询完整隐私文档并从外部 Blob 打开全文
  → 以最高匹配 Entry 为中心读取有界正式关系图，并编辑/隐藏/创建关系
  → 从查询或图谱节点返回精确 Snapshot/Fragment
```

`Fragment` 是不可变证据位置；`InformationEntry` 是当前普通浏览、标注、联系和查询的主单元。
普通 Entry 只保存一个当前成品态和乐观并发版本，不再保存每次中间编辑副本。
历史 `KnowledgeItem` 等深层语义对象仍存在于数据库兼容层，但当前应用不公开其旧写入、读取或搜索入口。当前“正式知识”产品入口以 Entry 及其自动/用户关系组成可编辑图谱。

## 3. 七个产品页面

| 页面     | 当前已实现                                                                                                                                                                                                                                                                                                                                           | 当前明确未实现                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 总览     | 当前工作区、来源文档、Fragment、Entry、已标注 Entry 与文档标签的真实统计；五步人工/确定性主线；最近 ProcessingRun 的真实阶段、进度、步骤、提案数及可取消状态；Git、RSS/Atom、JSON API、网页和插件订阅检查使用同一真实 import 任务轨道；已配置拆分/标签/联系 Provider 的诚实状态                                                                      | 不虚构未执行任务；无运行时明确显示暂无任务，无 Provider 时明确显示未配置                    |
| 导入     | 手动 Markdown 文本、固定 Git 文件，或单份/最多 20 份显式批次本地 `.md`/`.markdown`/`.txt`/`.html`/`.htm`/`.pdf` 文件；精确 GitHub Markdown、公开 RSS/Atom、声明式 JSON API、最多八页显式同源网页及运行环境已安装插件订阅；外部编辑、手动/间隔检查、能力发现与默认关闭的变化后确定性拆分/分流；远端记录/页面逐份入库，精确原始响应字节保留在外部 Blob | DOCX/ODT、OCR、复杂 PDF 版面/表格/图片还原、目录扫描/监视、开放网页发现、插件安装市场       |
| 拆分     | 选择尚未生成 Entry 的 Snapshot；保存一份拆分前全文工作副本并确认成新的派生 Snapshot；查看全文与精确 Fragment；保存并预览版本化本地 section/短段合并规则；在既有边界或 Fragment 内 Unicode 标量边界合并/拆开连续分组并改标题后一次物化；对已物化文档预览影响并原子重组当前 Entry；可选 OpenAI 首次分组提案、人工接受/拒绝                             | 来源重排、任意脚本/解析器规则、自动/AI 结构替换、私密内容外发                               |
| 标签     | 查看来源标题路径与整篇/拆分模式；编辑 Entry 正文、内容/类型/领域三维标签；有用/有趣两个 1–5 评分；确定性关键词候选；大小写归一和用户确认别名；文档标签聚合与人工编辑；外部快捷标签、排除词和 URL 域名设置；可解释 PreferenceProfile、自动路由控制/审计及真实所有者工作队列；可选 OpenAI 标签提案、人工接受/拒绝                                      | 自动中英文翻译判定、无确认的语义合并、私密内容外发、旧处理意图/判断原因/手工联系            |
| 联系     | 依据正文词项及内容/类型/领域标签重建关联投影；编辑外部版本化权重和阈值；显示分项分数与来源；逐对增强、削弱、屏蔽或恢复；这些投影也是正式图谱的自动相似边来源                                                                                                                                                                                         | AI 联系提案不在本页生成；多跳知识图编辑仍未实现                                             |
| 查询     | 标题/正文/标签的精确、包含和近似词法匹配；本地 Unicode 词项索引；可选公共 Entry 向量及词法/语义/混合召回、检索分、索引状态/显式重建和 Recall@K/MRR 评估；内容标签、来源、Snapshot、类型、领域、主副领域、整篇/拆分、时间和一至两跳过滤；三种隐私范围；绑定游标、解释、精确证据、独立完整隐私文档通道、本地探索与公开证据 RAG                         | 字典型中文分词、`pg_trgm`、第二向量 Provider、私密向量/RAG、Provider 自主检索和在线 Web RAG |
| 正式知识 | 简单搜索选择最高匹配 Entry；候选改选；有界中心关系图与等价列表；自动/用户编辑/用户创建/AI 辅助来源；八类关系语义、名称、方向、说明、未核验/已核对来源/需复核状态；双端精确来源；隐藏、恢复、创建；selected-pair AI 联系提案；三种隐私范围                                                                                                            | 全库无限画布、知识树/集合/时间线、复杂本体、自动事实核查与自动接受                          |

查询页之后的“正式知识”页面已按 ADR 0010/0011/0014/0042 接通。可见 AssociationProjection 直接成为带来源标记的自动 `similarity / calculated` 边；用户编辑或创建关系时保存闭合语义、名称、方向、维护说明和来源核验状态，并可分别打开两端精确来源。`source_checked` 只表示用户核对过来源，不表示客观事实已获证明。选择两个公开 Entry 后可生成待审核 AI 联系提案；只有人工接受才通过同一 override/CAS 边界写入，AI 边仍默认未核验。隐藏和恢复保留核验版本；ADR 0068 为核验绑定两端 Entry revision，结构纠错形成的新关系保留说明与原状态但不继承核验版本。旧无绑定或端点修订后的关系显示需要复核，投影重建不会覆盖用户决定。

## 4. 当前数据表示与存储

| 数据             | 当前表示                                                                                                                                                                        | 存储位置与更新方式                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 原始资料         | `Resource`、不可变 `Snapshot`、原始/规范化 Blob 身份                                                                                                                            | 元数据在 PostgreSQL；字节在包体外内容寻址 Blob 根；相同命令幂等                       |
| 文档结构         | `DocumentNode`、`Fragment`、媒体引用                                                                                                                                            | PostgreSQL；跟随 Snapshot 不可变，可返回精确来源位置                                  |
| 当前 Entry       | 稳定 Entry ID、来源/Snapshot、顺序、标题路径、正文及哈希、整篇/拆分、隐私、Fragment 输入及可选精确标量区间、三维标签、两项评分、当前结构标记与 successor/predecessor lineage    | PostgreSQL 当前成品态；普通修订推进版本；结构替换保留旧 Entry 行并切换唯一当前分区    |
| 当前文档标签     | Snapshot 级标签及 Entry 覆盖/全文出现证据                                                                                                                                       | PostgreSQL 当前成品态；可确定性重算或人工覆盖                                         |
| Entry 联系       | 可重建分项投影 + 当前人工 override；自动 `similarity / calculated` 与用户编辑/创建/AI 关系的语义、名称、方向、说明和来源核验状态                                                | PostgreSQL；投影可替换，人工图谱控制不被重建覆盖                                      |
| 检索派生索引     | 当前 Entry revision、投影摘要、tokenizer/model 身份、三字段词项 posting 和可选向量                                                                                              | PostgreSQL 两张派生表；可整库原子重建，不进入个人数据包，私密 Entry 不进入外部向量    |
| 处理任务         | 当前 ProcessingRun、订阅 import 检查、三类 AI 提案、Entry 自动路由 header/逐条 claim、所有者工作项，以及 M2-P0A/P0B/P0C 批量物化、enrichment、typed exception 和当前裁决状态    | PostgreSQL 当前任务态；批次只存身份、计数、规则摘要、状态和稳定代码，不保存来源正文   |
| Codex 审阅工作包 | 精确绑定当前 Entry/adjudication revision 的有界 packet 与默认无效结果模板；完成结果只允许闭合动作和完整三维标签                                                                 | 外部数据根 `exports/codex-work/`；可含正文，不进入 Git/镜像/日志/应用制品或数据库新表 |
| 个人偏好         | 快捷标签、自动提取开关、URL 域名开关、排除词、别名、联系/探索/Entry 偏好策略、AutomationPolicy，以及 Git/RSS/JSON API/网页/插件信源配置、外部配置或凭据变量引用、分流开关和游标 | 外部数据根 `preferences/`；不进入 Git 或应用包体                                      |
| 个人数据包       | 66 张当前工作区表、引用 Blob 字节和当前偏好；Entry v5、Association v5 与 Processing v10 section                                                                                 | 外部数据根 `exports/`；恢复只接受同工作区的空目标；旧 Bundle 仍可读                   |

隐私文档在导入时保存完整原始和规范化字节。默认 Entry、联系、查询和完整文档通道都排除
隐私；只有当次显式选择才扩大范围。查询 API 在 Entry 分页之外返回独立的完整隐私文档结果，
只给出来源、命中原因和短摘录，用户再次操作时才从外部 Blob 打开完整规范正文。

M1I-1A/B 已增加内建读取器和受信任插件适配器共享的 SourceConnector Registry，以及 remote_document 的幂等多文档 Evidence 入库底座。M1I-2/3 分别接入公开 RSS/Atom 与声明式 JSON API。M1I-4 又接入最多八个用户明确同源页面的服务端正文抽取；M1I-5 公开实际安装 connector capability，并只保存 opaque 外部配置引用。所有连接器都只交付有界文档；调度、隐私、成功游标、Evidence 和自动路由仍由主程序拥有。

## 5. 当前活动代码边界

### 5.1 服务端领域与仓储

活动产品 repository 只有：

- Evidence 写入；
- Evidence/Snapshot/Fragment 读取；
- InformationEntry 当前态；
- InformationEntry 当前结构替换、历史 lineage 与原子影响迁移；
- InformationDocumentTag 当前态；
- InformationEntryAssociation 投影、当前人工控制与正式图谱组合读写；
- InformationEntry 当前 revision 绑定的可重建词项/向量索引与召回评估；
- Provider-neutral ProcessingRun/提案信封，以及 typed split/tags/association payload；
- Entry 自动路由执行、成功 claim 派生的所有者工作队列；
- M2-P0A 可恢复批量 Snapshot→Entry 计划、逐 Snapshot 事务分片和 maintenance 控制；
- M2-P0B 可恢复确定性标签、typed 异常队列、增量联系替换和 maintenance 控制；
- M2-P0C 当前/过期异常汇总、稳定无正文抽样、精确数量保护的可恢复批量裁决和 maintenance 控制；
- M2-P0E 外部 Codex 审阅 packet/结果模板、稳定恢复身份和显式隐私 opt-in；
- M2-P0F 闭合结果校验、幂等 Entry revision、exact 裁决及只触及回写 Entry 的增量联系；
- M2-P0G 按 P0A→P0B→P0C 顺序推进的有界统一状态机和下一动作报告；
- 外部版本化信源订阅服务和精确公开 GitHub Markdown reader；
- 插件兼容的 SourceConnector Registry、远程文档闭合结果和幂等多文档 Evidence 入库准备器；
- Workspace/个人数据包传输。

活动 HTTP 面只有健康检查和 [`m1c-local-http-api.md`](m1c-local-http-api.md) 中列出的当前路由。
请求不能选择 `workspaceId`；工作区和外部数据根由包体外配置注入。

### 5.2 必要支持模块

- 外部运行配置、数据根路径隔离和 PostgreSQL 连接；
- 三十份前向迁移及独立迁移进程；
- 本地内容寻址 Blob、偏好、导出与备份文件存储；
- 健康检查、结构化日志、生命周期与优雅关闭；
- API、scheduler、worker 和 `all` 运行角色、非重叠订阅轮询及共享队列基础；
- React/Vite Web 外壳、同源本地 API 客户端、单元/集成/E2E 与制品审计；
- 非 root 容器、runtime/migrator secret 隔离、迁移/队列准备、runtime grant、维护预检与完整个人数据备份/空库恢复命令。

队列和多运行角色目前是基础设施能力；精确 GitHub Markdown、公开 RSS/Atom、声明式 JSON API、受限网页和实际安装 connector 已接通，但不能由此推导开放爬虫或通用自动采集。ProcessingRun 是独立的持久任务状态边界；订阅检查使用 import 阶段，公开 split、tags 与 selected-pair association 提案都可以显式启动、接受或拒绝。

M1I-1A/B 至 M1I-5 已完成外部信源底座、三类内建远端 reader 和已安装连接器产品接线。M1J 又在现有 Entry 图谱上完成关系语义、维护说明、来源核验和 Association v4 传输；M1K 已完成可重建词项/向量索引、三种 Query、召回评估与公开证据 RAG；M1L 已完成无数据性能基准、关联读取索引和搜索请求重复读取优化；M1M 已完成单机生产运行代码边界。下一步是所有者授权后的统一实际审核，不再预设横向产品增量。

## 6. 兼容保留而非活动产品能力

- 迁移 `000003`、`000004`、`000006`、`000007` 及其既有 Curation/Knowledge 数据表；
- `struinfo.m1c-domain.v1` 个人数据包分区中的旧行；
- 对历史迁移和旧数据可读性的窄测试；
- Test-owned PostgreSQL TM2 档案。它不在当前产品脚本、类型检查、lint、构建或制品中；
- `m1c_*` 文件/类型名中的传输命名残留；它们承载当前本地 API 或兼容包，不代表旧工作流仍然活动；
- Markdown 解析器中的 `intake_target` 结构角色；它只用于识别可物化 section，不再创建准入决定。

旧 Manual Curation 命令/读模型、正式 Knowledge 写入/当前读取、旧 Knowledge 检索及其
PostgreSQL adapter、HTTP、Web 页面和样式已由 ADR 0009 删除。代码删除没有删除用户数据库中的历史行。

## 7. 实现记录与剩余缺口

### 7.1 已完成主线：M1E-2 正式知识图谱

M1E-2 已复用 AssociationProjection/override 作为自动边，并通过前向迁移 `000012` 只补充用户关系来源、名称和方向。服务端在隐私过滤后选择最高匹配 Entry、组合有界直接邻域，并用同一 current-version/CAS 边界支持编辑、隐藏、恢复和纯用户关系。Web 已用真实图谱/列表、候选改选、节点/边详情、关系来源和精确来源替换占位；Association Bundle v3 让这些用户关系随个人数据包往返，旧 v1/v2 自动升级为空图谱元数据。

自动相似边仍只是可解释导航，不被描述为事实断言。直接使用增量已接通独立完整隐私文档结果，以及外部版本化联系权重/阈值的保存和自动重建；人工 override 与正式图谱关系不会被策略保存覆盖。旧 Knowledge API、高级编辑器、向量、图数据库和全库画布均未恢复。ADR 0012 的 M1E-3A 已接入 Provider-neutral ProcessingRun、提案信封、总览读取/取消和个人数据包携带；ADR 0013 的 M1E-3B 增加公开 Entry 标签提案；ADR 0014 的 M1E-3C 增加 selected-pair 联系提案；ADR 0015 的 M1E-3D 增加 selected-Snapshot 拆分提案。三者均需人工接受，并复用既有领域写边界。

### 7.2 已完成基础：M1E-3A Provider-neutral 任务与提案

前向迁移 `000013` 增加当前 ProcessingRun、类型化提案信封和精确 Fragment 输入。服务端提供幂等创建、闭合进度转换、提案追加、期望版本取消和最近任务读取；公开 API 开放列表与取消，总览只显示真实记录。个人数据包新增兼容分区并携带这三张表。该中性任务边界承载 M1E-3B/C/D，而不是让模型直接写 Entry 或图谱。

### 7.3 已完成纵向链：M1E-3B OpenAI Entry 标签提案

ADR 0013 只选择 OpenAI Responses API 与 `tags` 一种闭合提案。前向迁移 `000014` 增加提案头、内容关键词和领域关键词三张类型化表，不保存任意 JSON。运行时仅在环境变量 `OPENAI_API_KEY` 与外部配置 `STRUIINFO_OPENAI_MODEL` 同时存在时发布 `ai_tags` capability；没有配置时应用照常启动。用户在标签页对一个公开 Entry 显式发起请求，Provider 返回有界的内容/类型/领域标签及简短说明；私密 Entry 在调用前拒绝，模型不能读取 Blob 或其他 Entry。

公开 API 提供按 Entry 列表、启动、接受和拒绝。接受使用现有 `reviseEntry` 并保留正文、评分、隐私与 Fragment 输入；并发版本变化会得到稳定过期结果。Processing Bundle v2 携带六张处理表，旧 v1 自动补为空标签提案状态。Provider 没有专用数据库写入口，也不能绕过人工接受。

### 7.4 已完成纵向链：M1E-3C OpenAI Entry 联系提案

ADR 0014 只扩展同一 OpenAI Responses API 与 `association` 闭合提案。前向迁移 `000015` 新增一张 typed payload 表，并把图谱 override 来源扩展为 `ai`。用户必须先在正式知识页明确选中两个公开 Entry；任一端隐私时在网络前拒绝。Provider 只接收该对当前标题、正文和三维标签，返回短关系名、方向和说明。

提案冻结两个 Entry 修订和当前 override 修订。拒绝不改图谱；接受调用既有图谱边写入/CAS，显示为 `AI 生成 · 待审核` 的提案在提交后成为 `ai_assisted` 边，后续人工编辑转换为用户编辑来源。Processing Bundle v3 携带七张处理表，旧 v1/v2 自动补为空联系提案状态。无 Provider 时人工图谱和确定性联系不受影响。

### 7.5 已完成纵向链：M1E-3D OpenAI Snapshot 拆分提案

ADR 0015 只扩展同一 OpenAI Responses API 与 `split` 闭合提案。前向迁移 `000016` 新增三张 typed split payload 表。用户必须先在拆分页明确选择一个公开、尚未生成 Entry 的 Snapshot；私密 Snapshot 在 Blob 读取和网络调用前拒绝。Provider 只接收按结构顺序排列的 section Fragment ordinal 与正文，不接收任何 workspace、Snapshot 或 Fragment 标识。

提案必须连续、不重叠并完整覆盖 1–64 个输入 Fragment。界面逐组展示本地精确 Fragment，并标明外部 AI 来源；拒绝不创建 Entry，接受从本地 Fragment 重建标题/正文并复用既有空 Snapshot Entry 物化和 workspace lock。确定性物化已先完成时返回稳定过期结果，不覆盖现有结构。Processing Bundle v4 携带十张处理表，旧 v1/v2/v3 自动补为空拆分提案状态。无 Provider 时确定性拆分与其他人工主线不受影响。

### 7.6 已完成主线：M1E-4A 人工 Fragment 分组

ADR 0016 在现有 Split 页面和 Entry 表上补齐无 Provider 的直接人工路径。用户选择尚未生成 Entry 的 Snapshot 后，可以查看规范全文和每个精确 `section` Fragment，在原有边界把相邻 Fragment 合并成一条、把合并组重新拆开并修改标题。请求只提交标题和 Fragment ID；服务端从本地证据重建正文，完整覆盖、来源顺序和隐私事实不能由客户端改写。

确定性、人工和已接受 AI 拆分现在都调用同一个 `materializeEntriesIfSnapshotEmpty` 原子边界；任一路径先提交后，其余路径返回 `split_structure_already_materialized`，不会叠加第二套 Entry。人工规则版本为 `struinfo.entry-split.manual-group.v1`。本切片没有迁移、依赖或 Bundle 变化，也不会覆盖已经拥有标签、联系或图谱关系的 Entry 结构。

### 7.7 已完成主线：M1E-4B Fragment 内人工边界

ADR 0017 把同一人工工作台扩展到不可变 Fragment 内的 Unicode 标量边界。用户在只读来源片段中放置光标并明确执行拆分；请求只提交标题、Fragment ID 和半开区间 `[startCodePoint, endCodePoint)`。服务端要求全部有序 section Fragment 被连续、无缝、无重叠地完整覆盖，并从本地原文重建正文。

前向迁移 `000017` 增加可选一对一子表 `information_entry_fragment_range`。只有范围化人工 Entry 写入区间行；旧 Entry、确定性 Entry 和 AI 分组 Entry 没有区间行，继续精确表示完整 Fragment。Entry Bundle 升级为 v3/8 表，该阶段个人数据包扩至 56 张表；M1G-4B 后的当前总数为 58，v1/v2 Entry 恢复时仍补空区间表。人工规则版本为 `struinfo.entry-split.manual-range.v1`，空 Snapshot 原子赢家与隐私边界保持不变。

### 7.8 已完成主线：M1E-5A 本地文本文件导入

ADR 0018 在既有导入表单和 `POST /api/v1/imports/markdown` 上增加第三种来源。用户可以选择或拖入一份 `.md`、`.markdown` 或 `.txt` 文件；浏览器先检查文件名、1 MiB 上限、严格 UTF-8、空文本和 NUL，再以 canonical Base64 发送字节。服务端只允许 `uploaded_file` 使用 Base64，并在任何 Evidence 写入前完成闭合解码，随后复用既有 Blob、Snapshot、CommonMark 结构和 Fragment 原子导入。

未填写前置文字时，外部 Blob 中的 Snapshot 原始字节与所选文件完全一致；填写前置文字时，页面明确把它作为组合后的新 Snapshot。默认来源身份为基础文件名加 SHA-256，不发送本机目录路径。隐私、别名、规范链接、发布日期和拆分页保持原有边界。一次表单失败后会复用同一 command/resource/snapshot/capturedAt 身份，避免重试自行制造幂等冲突。本增量没有迁移、新依赖、仓库内用户文件或真实 fixture。

### 7.9 已完成主线：M1E-5B 本地 HTML/PDF 文字层导入

ADR 0019 把单份 `.html`、`.htm` 和带文字层的 `.pdf` 接入同一导入表单。浏览器保持 1 MiB 原始字节上限并发送 canonical Base64；服务端在任何 Evidence 写入前完成格式投影。HTML 只读取标题、正文语义块、列表、引用、预格式文本、表格行、链接和图片替代文字，跳过脚本、样式、表单、嵌入内容和隐藏内容，也不请求任何外链。PDF 按页读取现有文字层并生成明确页标题，不执行 OCR。

HTML/PDF 的 Snapshot 原始 Blob 始终是所选文件的完整字节；进入 CommonMark/Fragment 的是单独 UTF-8 文本投影，规范文本哈希描述该投影。可选前置文字只加入投影，不改写原始文件。隐私、幂等、来源身份、Split 队列和个人数据包继续复用现有边界。本增量没有数据库迁移或真实 fixture；新增 `parse5`、`pdfjs-dist` 和其 `entities` 依赖，PDF.js 的未使用原生 Canvas 可选依赖被安装策略排除。

### 7.10 已完成主线：M1F-1 可解释词法查询

ADR 0020 在既有完整加载式 Entry 查询上加入 `exact`、`substring` 和 `fuzzy` 三种显式文字模式，并允许独立选择标题、正文和标签范围。标签包含内容、类型和领域三个维度；省略新字段时保持旧有“全部字段包含文字”行为。近似模式只用规范化 Unicode 字符与双字符片段计算本地词法分，不调用 AI，也不表示语义相同。

结果返回模式和 0–10000 的整数词法分；排序与游标 schema v2 绑定该分数和规范字段集合。隐私仍先于匹配、计数、遍历、排序和分页；只有当次明确包含隐私时，独立完整隐私文档通道才以相同模式匹配来源、全文或其私密 Entry 标签。该增量没有迁移、依赖、索引、Provider 调用、搜索服务或真实资料。

### 7.11 已完成主线：M1F-2 查询联想与结果比较

ADR 0021 把服务端已经支持的一至两跳 Association 过滤接入普通查询页：当前选中的可见 Entry 可以直接成为起点，用户可以开关联想、替换起点，并继续在精确筛选中调整跳数和最低分。界面明确这是本地可解释联系遍历，不是 AI 推荐或语义等价。

同一语义查询范围内可以选择最多两条结果并列查看来源、修订、隐私、词法命中、拆分方式、有用/有趣评分、类型、领域、关键词、正文和精确来源。比较不合并评分、不判断胜负、不生成摘要或新联系。它可以跨当前查询的 cursor 页保留，但任一查询条件、Association 或隐私范围改变后立即不再显示；状态不进入偏好、数据库或个人数据包。本增量没有修改服务端协议、迁移、依赖或真实资料。

### 7.12 已完成主线：M1F-3 证据约束的 AI 综合查询

ADR 0022 的次级动作现已在代码、HTTP、capability 和 Query 页面接通。它只在用户完成一个非空公开 Query 后显式运行；服务端复用同一确定性搜索，按稳定顺序取前 8 条当前 Entry，并把有界标题、正文摘录和三维公开标签交给既有 OpenAI Responses API 边界。AI 不参与筛选、排序、Association 遍历或网络检索。

返回结果包含答案、`supported / partial / insufficient` 证据状态、claim 及其 `E01`–`E08` 本地证据引用和限制说明。应用把引用映射回 Entry 修订与精确来源；答案只在当前页面会话内，不写入数据库、Processing、偏好、个人数据包、Entry 或图谱。包含隐私和只看隐私范围在 Provider 前拒绝；Provider 未配置时 UI 诚实显示不可用且本地查询保持完整。

### 7.13 已完成主线：M1G-1 确定性 Entry 探索策略

ADR 0023 在普通查询结果之后增加一个独立探索区。用户先选择当前可见 Entry，再明确点击生成；服务端只查看该锚点的当前可见直接 Association，并排除当前页、屏蔽、过期和隐私范围外条目。普通查询的匹配、排序、总数、分页和游标完全不变，探索也不会在输入、换页或切换筛选时自动运行。

首版只返回现有数据可以证明的三类原因：同领域或人工联系等剩余直接邻域归为“邻域扩展”，首要领域不同归为“跨领域连接”，来自另一 Snapshot 且只有正文词项依据、没有内容关键词相似度的归为“偶然发现”。各类内部按联系强度和 Entry ID 稳定排序，再按固定顺序轮转，最多返回当前页配置份额且上限 12 条。候选显示理由、联系强度、本地依据、同/跨文档、隐私状态和精确来源，不称为事实关系、AI 推荐或语义等价。

`ExplorationPolicy` 默认关闭，独立保存启用状态、0–50% 份额和三个类型开关，并使用期望修订防止覆盖。它位于外部个人偏好文件并由个人数据包携带；旧偏好和旧个人数据包加载关闭的默认策略。候选生成只读，不写 Entry、联系、图谱、ProcessingRun、搜索历史或行为画像，也不调用 Provider。本增量没有新增迁移、依赖或真实资料。

### 7.14 已完成主线：M1G-2 版本化 Git 信源订阅

ADR 0024 在导入页增加外部版本化订阅编辑器。首版只接受一个精确公开 GitHub repository/ref 下的 `.md` 或 `.markdown` 文件，保存标签、来源别名、解析 profile、隐私、15 分钟至 7 天间隔和默认关闭的 scheduled 开关。配置使用期望修订，手动检查不依赖 scheduled 开启；旧偏好和旧个人数据包读取空订阅默认值。

服务端 reader 从闭合配置构造 GitHub commit/content 请求，不接受任意抓取 URL，不克隆或执行仓库。每次检查建立真实 import 阶段 ProcessingRun；首次或字节变化时调用既有 Markdown Evidence import，相同内容的新提交只推进 cursor，重试保持幂等。scheduler/all 角色顺序执行到期订阅且不重叠；失败保留最后成功 cursor。Import 显示保存、手动检查、变化/无变化和稳定失败，Overview 仍只从 ProcessingRun 显示真实任务。

在 M1G-2 当时，本增量没有迁移、依赖、自动 Entry 物化、自动标签/联系、AI 接受或真实资料，RSS/API/网页仍是后续边界。M1I-1A/B 随后增加共同连接器与远程文档入库底座，M1I-2 接通公开 RSS/Atom，M1I-3 接通声明式 JSON API，M1I-4 接通用户明确列出的同源网页，M1I-5 接通已安装受信任连接器的 capability 与外部配置引用；仓库目录发现、认证私有仓库、日历时区和长期调度运行审核仍需后续边界。

### 7.15 已完成：M1G-3 可解释 Entry PreferenceProfile

ADR 0025 已把下一纵向切片收敛为默认关闭的外部 `EntryPreferenceProfile`：从显式人工有用/有趣评分和当前内容/类型/领域标签生成可解释候选，用户接受后才保存规则，并可对当前可见 Entry 做只读试运行。两个评分维度保持独立，规则不会覆盖人工标注或改变普通 Query。

M1G-3A 已加入闭合 Profile decoder、默认空状态、最多 64 条有序规则、外部 workspace 偏好文件持久化和旧个人数据包兼容。Profile 具有修订号，现有偏好写入会保留它。

M1G-3B 已加入纯本地建议和试运行核心：只统计显式 1–5 评分，按有用/有趣及内容/类型/领域独立计算；样本不足或正负差小于 2 不产生候选，建议权重为正负样本差的绝对值并封顶 5。候选先按隐私范围过滤，最多返回 64 条；试运行最多返回 100 个 Entry 的匹配规则及两个独立净值。格式错误、Profile 修订过期和显式 Entry 修订账本变化分别返回可见状态。核心不写业务状态，也没有新增数据库表、依赖、真实资料或 Provider 调用。

M1G-3C 已加入 Profile 读取、期望修订保存、候选生成和只读试运行四个窄公共操作，并在 Tags 普通逐条标注之后提供次级面板。用户可以增删改、启停和显式保存规则；候选展示正/中/负计数和有界 Entry 身份，接受只进入未保存草稿；试运行可直接评估草稿，最多显示 100 条 Entry 的人工评分、匹配规则及两个独立净值。公开范围仍是默认值，包含隐私必须在当前面板单独勾选且全部在本地执行。只有保存按钮写外部个人偏好；候选、证据和试运行不写 Entry、查询、联系、图谱或 Processing，也不调用 Provider。

M1G-3D 已将外部偏好写入改为按 workspace 串行的原子读改写，Profile、快捷标签/别名、联系权重、探索策略和来源订阅配置/游标都在最新兄弟字段上更新；期望修订检查也在同一原子操作内完成。标签页不再回写缓存的联系策略副本。应用层和 Profile 面板使用递增请求标识，隐私范围、草稿、保存或重读变化后到达的旧响应不会覆盖当前状态。公开范围默认、隐私范围显式且全部本地；旧偏好/旧包兼容、320/390/768/1024/1440px 浏览器布局和应用制品隔离均有合成回归。M1G-3 整体完成；自动分流、自动拆分/标签/联系、AI 接受和行为学习继续明确排除。

### 7.16 已完成：M1G-4A Entry AutomationPolicy 与只读分流试运行

ADR 0026 已增加与 PreferenceProfile 分离的外部 `EntryAutomationPolicy`。它具有独立修订、默认关闭、暂停状态、绑定 Profile 修订、最少匹配规则数、两项独立推进/延后阈值、单/双维度一致要求、每次运行总量及两类候选预算，以及未来执行器失败时暂停的闭合策略。旧偏好文件和旧个人数据包读取 revision 0 的关闭默认值；当前偏好写入、导出和恢复会保留它。该状态不进入 PostgreSQL、Git 或应用包体。

纯领域试运行复用现有 Profile 评估和 Entry 修订账本，在隐私过滤后按稳定 Entry ID 计算 `推进候选 / 人工审核 / 延后候选`。人工接管优先，正负维度冲突、证据不足和预算溢出都回到人工审核并给出明确原因；延后不等于忽略、删除或隐藏 Entry。结果同时标明策略关闭、暂停、Profile 关闭、Profile 修订不匹配或就绪。

M1G-4A 始终返回 `dryRunOnly`，没有 HTTP/UI 执行命令，不创建 ProcessingRun，也不自动拆分、写标签、建联系、改图谱或接受 AI 提案。它只为后续执行提供稳定输入。

### 7.17 已完成：M1G-4B 可恢复 Entry 自动路由执行

[ADR 0027](adr/0027-recoverable-entry-automation-routing-execution.md) 和迁移 `000018` 增加一个 typed 自动路由 run header 与逐 Entry claim 表。执行服务以 workspace + idempotency key 派生稳定 ProcessingRun，冻结请求/计划摘要、策略/Profile 修订、隐私范围，以及每个 Entry 的当前 revision、revisionId、路由和原因。相同请求可重放，不同请求复用命令键会冲突。

执行开始前及提交前都会重新计算计划并核对外部策略、Profile 和当前 Entry 状态；PostgreSQL 提交还在 workspace 锁内再次核对 Entry revision/revisionId。若重校验或执行失败，只在策略仍是授权该运行的精确修订时将其推进一版并暂停，同时把开放 claim 标为 compensated；无法确认持久化恢复时返回 `recoveryPending`，不会伪报成功或覆盖所有者已保存的新策略。

本阶段执行的是“路由事实的持久化”，不是未定义的下游动作。completed claim 不会改写 Entry、标签、联系、图谱、查询或 AI 提案；延后仍不等于忽略、删除或隐藏。Processing Bundle 升为 v5/12 表，v1–v4 恢复时补空执行状态，完整个人数据包覆盖 58 张表。M1G-4C/4D 已在这一执行边界之上提供所有者控制和精确审计，而没有扩大 claim 权限。

### 7.18 已完成：M1G-4C Entry 自动路由所有者控制面

[ADR 0028](adr/0028-owner-controlled-entry-automation-routing.md) 为既有策略、试算和执行服务增加六个 workspace-fixed 本地操作：读取/保存策略、只读试算、显式启动、最近运行列表和精确运行读取。保存通过外部偏好原子更新并同时核对策略与 PreferenceProfile 修订；启用、禁用、暂停和恢复都会形成明确的新策略修订。启动请求绑定保存后的就绪策略、Profile 修订、试算 Entry 修订账本、隐私范围和人工接管项，然后只调用 M1G-4B 的幂等执行服务。

Tags 页面在 PreferenceProfile 次级面板之后提供独立自动路由面板。所有者可调整阈值、单/双维度要求和三项预算，明确勾选本次是否包含隐私，先查看每条路由/原因，再把任意条目切换为人工接管；只有已保存、无脏草稿且 activation 为 ready 的当前试算可以启动。最近运行和逐条 claim 状态可重载查看，迟到加载/试算响应不会覆盖当前草稿。

本控制面仍不执行具体自动业务动作。`推进候选 / 人工审核 / 延后候选` 只被可靠记录，不会改写 Entry 正文、评分、关键词、联系、正式知识图谱、查询或 AI 提案。M1G-4D 在此基础上补齐精确审计和控制完整性；未来若要把某一路由转换成具体下游修改，必须单独定义和接受。

### 7.19 已完成：M1G-4D Entry 自动路由控制完整性

[ADR 0029](adr/0029-entry-automation-control-integrity.md) 把最近运行明确降为导航摘要，并让 Tags 页面真正调用 M1G-4C 已提供的精确运行读取。选择一条运行后，页面独立展示运行版本、策略/Profile 修订、隐私范围、错误代码以及每条 claim 的完成、补偿或未结算状态；详情读取失败不会清空最近运行，并可单独重试。未结算状态不会被推断成成功，页面继续明确路由记录不会改写业务内容。

策略读取/保存、试算、运行执行、最近列表和精确详情现在各自使用独立的最新请求代次。新列表或详情会使被取代的旧响应失效；运行开始会使旧策略/列表/详情响应失效，再读取提交后的真实状态。脏草稿、保存中和执行中不能通过通用重读意外覆盖。运行摘要、精确审计、错误与恢复说明在 320、390、768、1024 和 1440 CSS 像素下保持可读，宽表只在自己的键盘可聚焦容器内滚动。

M1G-4D 没有新增 API、迁移、依赖、Provider、Bundle 分区或自动业务写入。M1G-4A–D 至此完成“独立策略 → 只读试算 → typed 可恢复路由事实 → 所有者控制 → 精确审计与异步隔离”。

### 7.20 已完成：M1G-5A Entry 自动路由所有者工作队列

[ADR 0030](adr/0030-entry-automation-owner-work-queue.md) 与迁移 `000019` 把成功运行中每条 completed claim 投影为独立所有者工作项。claim 继续保存不可变的 Entry 修订、路由和原因；工作项只保存 `pending / completed / dismissed`、乐观版本和时间。成功执行在同一事务创建工作项，迁移也会为既有成功 claim 回填，失败或补偿 claim 不会进入队列。

公开服务按当前 Entry 和当次隐私范围组合工作项。Entry 后续已修改时仍显示工作项并标记为过期；隐私 Entry 默认不可见。Tags 页面可打开对应当前 Entry、标记完成、跳过或重新打开。所有这些操作只改变工作项，不修改 Entry、标签、联系、正式图谱、Query、AI 提案或原 claim。

Processing Bundle 升为 v6/13 表；旧 v1–v5 恢复为空工作队列。完整个人数据包现覆盖 59 张工作区表、引用 Blob 字节和外部偏好，没有新增依赖或 Provider。

### 7.21 已完成：M1G-5B 订阅变化后的确定性拆分与分流

[ADR 0031](adr/0031-subscription-deterministic-entry-routing-chain.md) 为每个外部 Git 信源订阅增加默认关闭的 `routeAfterImport`。所有者在导入页明确启用后，一次变化检查会按顺序复用现有 Evidence 导入、确定性 section Entry 物化、M1G-4 可恢复分流和 M1G-5A 工作队列；关闭时仍只导入 Snapshot。

资料身份不包含该开关，启停不会复制 Resource/Snapshot。串联接受 Snapshot 已经存在的第一个 Entry 结构，自动化幂等键绑定 subscription ID 与 source SHA-256。只有导入、物化和分流全部成功后才写入成功游标；策略/Profile 未就绪或任一步失败时保留旧游标，下一次检查复用既有幂等边界重试。

该串联完全本地，不调用 Provider，也不自动写标签、联系、图谱或接受 AI 提案。私密订阅仅在所有者已配置该订阅并明确开启串联时参与本地拆分/分流，普通读取仍遵守显式隐私范围。

### 7.22 已完成：M1H-1A/B 确定性标签与联系投影动作

[ADR 0032](adr/0032-deterministic-entry-tag-and-association-actions.md) 在外部 AutomationPolicy 中增加两个默认关闭的推进动作。仅当路由事实为 completed `advance_candidate` 且所有者显式开启时，M1H-1A 才用服务端本地词法规则追加缺失内容标签；规则遵守自动提取开关、排除词和已确认别名，不删除或替换人工、AI 与导入标签，也不调用 Provider。

M1H-1B 可在标签阶段后按当前外部联系策略重建可替换 Association 投影。逐对人工 override、用户/AI 辅助图谱关系和 blocked 决定位于独立控制层，不会被重建覆盖。私密 Entry 必须由当前运行或订阅明确包含且全部在本地处理。

迁移 `000020` 为每个被授权的推进 claim 保存一条 typed action，而不是保存 Entry 正文副本。状态支持失败后从标签完成点续跑；安全撤销只删除带本次精确规则来源的标签，并且仅在 Entry 仍处于该动作结果修订时执行，随后重新生成投影。人工后续修改会得到 stale，而不是被自动化覆盖。Processing Bundle v7 携带第 14 张 Processing 表，旧 v1–v6 补空动作状态；完整个人数据包现覆盖 60 张表。

### 7.23 已完成：M1H-2A/B 已物化 Entry 结构重组

[ADR 0033](adr/0033-post-materialization-entry-restructuring.md) 让拆分页在文档已经拥有 Entry 后继续载入精确 Fragment/标量区间分组。M1H-2A 只生成影响预览：新旧条数、稳定身份复用、successor/predecessor lineage、标签/评分冲突，以及人工或 AI 辅助图关系的迁移、折叠与冲突；修改草稿会立即使旧预览失效。

M1H-2B 只接受同一预览摘要和显式确认，在工作区锁内一次完成当前结构切换、后继写入、lineage、Document 标签重算、关系迁移和可见隐私范围内的 Association 投影重建。原始 Snapshot/Fragment 不变，退出当前结构的 Entry 不删除，普通查询/标签/联系/图谱/自动化只读取 `is_current_structure=true`。迁移 `000021` 增加该当前结构事实；Entry Bundle v4 携带它并把 v1–v3 历史包升级为当前行。表总数仍为 60，没有新依赖、Provider 或真实数据。

### 7.24 已完成：M1H-3A/B 拆分前派生全文编辑

[ADR 0034](adr/0034-pre-split-derived-document-editing.md) 在拆分页加入一份可恢复的当前全文工作副本。M1H-3A 只允许尚未生成 Entry 的来源 Snapshot 保存一份 UTF-8 草稿；重复保存原位更新同一行，恢复原文删除草稿，不产生逐键历史，也不改写原始 Blob、Snapshot 或 Fragment。私密全文仍要求当前请求明确 opt-in。

M1H-3B 由所有者显式确认已保存草稿，并通过既有 Evidence/CommonMark 导入边界生成新的不可变派生 Resource/Snapshot。页面随后选择该派生 Snapshot，确定性、人工 Fragment/标量范围和 AI 提案继续使用原有拆分入口。迁移 `000022` 增加唯一当前工作副本表；Entry Bundle v5 携带该表并把 v1–v4 恢复为空工作副本。完整个人数据包现覆盖 61 张表，没有新 Provider、依赖、第二套知识存储或真实数据。

### 7.25 已完成：M1H-4A/B 版本化可配置 Entry 拆分规则

[ADR 0035](adr/0035-versioned-configurable-entry-split-rules.md) 为普通本地首次拆分增加外部 `EntrySplitRuleProfile`。M1H-4A 提供 revision 0 的兼容默认规则、闭合参数、按来源顺序合并相邻短 section 的纯确定性计划和只读预览。规则与个人偏好一起位于外部数据根并随完整个人数据包携带；旧偏好/旧包自动补默认值。

M1H-4B 在拆分页加入规则读取、编辑、显式保存、当前文档预览和应用。只有保存后的精确 revision 可以物化；服务端重新读取 Evidence 并调用既有空 Snapshot 原子边界。已有 Entry、未确认全文工作副本或未显式开启的私密文档不会被该操作覆盖。没有新增迁移、表、依赖、Provider、真实材料、脚本规则或来源重排。

### 7.26 已完成：M1H-5A/B 显式本地多文件导入队列

[ADR 0036](adr/0036-explicit-local-multi-file-import-queue.md) 在导入页增加“单份文件 / 多份批次”。M1H-5A 只接收所有者明确选择或拖入的最多 20 份既有支持格式；每份独立复用文件名/大小/UTF-8/PDF 标识校验、1 MiB 上限、隐私、幂等身份、Evidence 写入和外部 Blob。批次不读取目录路径，也不把一个来源别名或链接套给所有文件。

M1H-5B 提供会话内准备/就绪/写入/成功/失败/停止状态、逐文件结果、总进度、失败重试和“当前项完成后停止后续项”。失败重试复用冻结请求及原 command/Resource/Snapshot 身份；成功后统一刷新材料列表，不反复打开证据侧栏。队列不持久化，不进入 ProcessingRun 或个人数据包；没有迁移、新路由、依赖、后台上传、自动拆分/标签/联系或 Provider。

### 7.27 已完成：M1I-1A/B 至 M1I-5 外部信源纵向切片

[ADR 0037](adr/0037-plugin-compatible-source-acquisition-foundation.md) 增加内建/受信任插件共用的有界 `SourceConnector` Registry 与 `remote_document` 幂等批量入库；[ADR 0038](adr/0038-public-rss-atom-source-subscriptions.md) 将公开 RSS/Atom 完整接入外部偏好、既有版本化 API、scheduler、ProcessingRun 和导入页。

Feed adapter 只接受无凭据 HTTPS，连接前拒绝本地/私有地址，不跟随跳转，并限制 20 秒、1 MiB 和最多 20 条。RSS 2.0/Atom 正文使用服务端 HTML/文本 → Markdown 投影；原始 Feed 字节留在外部 Blob，每个新增或修订条目形成独立 Snapshot。ETag、Last-Modified、Feed 摘要和条目 token 共同构成成功 cursor；失败不推进。条目链接不被抓取，旧无 `kind` 的 Git 偏好继续可读。

[ADR 0039](adr/0039-declarative-json-api-source-subscriptions.md) 接入公开 HTTPS GET JSON API。用户用受限点分路径声明记录数组、ID、标题、正文及可选原文地址、时间和版本；独立分页与增量 cursor 最多完整读取 5 页、32 条、每页 1 MiB。可选 Bearer 认证只保存环境变量名，秘密值不进入偏好、数据库、Git、日志或响应。每条变化记录成为独立 Snapshot，整批成功后才推进 cursor；不执行脚本、JSONPath 或记录链接抓取。

[ADR 0040](adr/0040-constrained-web-source-subscriptions.md) 接入受限网页读取。每个订阅只允许一个公开 HTTPS 首页和最多七个显式同源路径；服务端逐页提取 `article`、`main` 或正文区域，排除脚本、样式和隐藏内容，不执行页面、不发现链接、不跟随重定向。每页限制 20 秒和 1 MiB，原始 HTML 进入外部 Blob，Markdown 投影进入既有 Evidence 主线，只有变化页面产生新 Snapshot。

[ADR 0041](adr/0041-installed-source-connector-product-wiring.md) 把真实已安装连接器的声明能力公开到 API 和导入页。主程序只保存稳定 `plugin.*` connector ID 与 opaque 外部配置引用；连接器代码和秘密配置不进入偏好或个人数据包。未安装的历史配置仍可见但不可运行，运行时适配器仍只能返回有界文档，持久化、隐私、游标与后续分流由主程序拥有。

### 7.28 已完成：M1L 性能评估与按证据优化

[ADR 0044](adr/0044-evidence-driven-local-performance.md) 提供仓库自有的 `corepack pnpm run performance:m1l`。标准工作负载只用合成 Markdown、Entry、向量与 `example.invalid` 连接器结果，固定覆盖导入、拆分、词项/联系投影、词法/语义/混合/两跳查询、正式知识邻域和订阅批次，并输出运行时、workload hash 与中位数/P95 等闭合 JSON；它不写数据库、Blob、偏好或仓库报告。

同机标准基线确认两跳 Association 查询会为每个访问节点重建全部映射。现在一次请求只构建一个只读邻接索引；800 个 Entry、8,040 条投影的相同 workload hash 下，中位耗时由 184.565 ms 降到 4.196 ms。HTTP lexical 查询也只读取一次 Entry/Association snapshot，semantic/hybrid 不再由 API 重复加载检索服务已经读取的数据。所有优化保持公开结果、隐私、排序、过期投影、override 和 cursor 语义，不引入迁移、依赖、持久缓存或新服务。

### 7.29 已完成：M1M 单机生产运行与维护边界

[ADR 0045](adr/0045-operational-production-baseline.md) 增加多阶段非 root Dockerfile、普通 runtime 与高权限 maintenance 分离的 Compose、严格的 `*_FILE` secret 注入、独立 pg-boss schema 准备、runtime grant、维护 preflight/backup/restore 和完整[生产运行手册](production-operations.md)。普通应用清单不接触 migrator secret，容器复用现有 health、结构化日志与优雅关闭。

备份复用完整个人数据包；当前 writer 把 66 张工作区表、引用 Blob 和偏好写入外部 `backups/`，恢复仍只允许同 workspace 空数据库。静态 verifier 已纳入根 `verify`，Compose 语法和 pnpm production deploy 独立验证。2026-08-27 的 M1M 演练当时在本地 Docker Desktop 与 disposable PostgreSQL 18.6 上，用纯合成数据完成 25 份迁移、首次 pg-boss schema 准备、runtime grant、preflight、回环 HTTP 健康、完整备份、同 workspace 空库恢复、数据/Blob 对照和重启；它不冒充目标云服务器镜像或网络验收。

上线前代码复查关闭了三个可达启动缺口：根脚本现在可按 `api`、`scheduler`、`worker` 或
`all` 从 server tsconfig 正确启动，也可从编译产物启动；部署静态门会阻止这些脚本再次缺失；
PostgreSQL URL 从仅允许容器自身 localhost 修正为闭合的单 DNS/IP host，因此外置数据库和
容器服务发现可用，同时继续拒绝多个 host、socket 与 query/fragment 覆盖。当前 `ssl=false`
只用于同机或受信任私网，公网 TLS 仍属于目标部署审核。该演练还关闭了两个真实启动缺口：
node-postgres 的多语句结果现在安全投影最终结果，使首次队列 schema 创建可完成；PDF.js 改为仅在显式 PDF 导入时按需加载，并使用只覆盖文字层提取的本地兼容边界，普通 API/worker/maintenance 启动不再依赖可选原生 Canvas。

### 7.30 已知产品缺口

- 拆分页尚不能重排来源、执行任意脚本/自定义解析器规则，或自动/批量重组多个已物化文档；
- 导入已支持手动 Markdown、固定 Git Markdown，以及单份或显式多文件批次的 Markdown、纯文本、HTML 或带文字层 PDF；尚无 Office、OCR、复杂版面/图片还原、持久后台上传、目录扫描或目录监视；
- OpenAI 目前为用户明确选择的公开 Snapshot、公开 Entry 和公开 Entry 对生成拆分、标签和联系提案，并可显式综合当前公开 Query 证据；私密内容外发、自动接受和第二 Provider 仍未规划；
- 近似词法、可选语义/混合检索及公开证据 RAG 已实现；尚无私密向量、Provider 自主检索、在线 Web RAG 或通用聊天代理；
- 精确 GitHub Markdown、公开 RSS/Atom、声明式 JSON API、受限同源网页和已安装受信任连接器的手动/间隔检查、变化检测和可选确定性拆分/分流已实现；尚无开放式爬虫、目录订阅、交互式认证信源、日历时区调度、任意工作流编排或自动内容修改；
- 命名查询与选中身份可跨会话重新打开；版本绑定的集中来源复核和显式所选 Entry 的引用式 Markdown 导出已实现。自动历史、持久结果快照、知识树、集合、时间线、通用冲突维护和报告/推送尚未实现；当前图谱仍为有界 Entry 邻域，普通备份与资料清单分别承担恢复和复用职责；
- 历史 Curation/Knowledge 表尚未通过数据退役迁移移除；在确认不再需要兼容前继续保留；
- 公开 exact/substring Entry 查询已用完整、当前且未触及 4,096 posting 截断上限的投影做 SQL 候选缩小和选择性 hydration；fuzzy、隐私、Association 遍历、索引不完整或存在截断风险时仍完整加载。尚未做全语义 SQL pushdown，也没有证据支持引入另一套查询或缓存基础设施。

- 空条件浏览、索引状态和图谱邻域的定向读取已完成候选收口及集成验证；[集成记录](incremental-index-maintenance.md#集成审查)与[第 1 项测量](current-candidate-closure.md)各保留自己的样本身份，本文更早的历史耗时不能当作这些改动之后的结果。
- 语义索引仍要求全部当前公开 Entry 与当前模型匹配；Entry 修改、结构替换或模型变化后可能返回 `semantic_search_index_not_ready`。查询页现可显式按最多 32 项窗口刷新变化项，以已提交投影为检查点暂停、继续或重试；输入未变时复用相容向量。`rebuild()` 保留为完整修复，普通词法路径仍完整可用；没有新增后台自动刷新或调度权限。

### 7.31 发布与部署边界

- 当前产品是私人单用户工作台，不是公共 API；Docker 应用端口始终只发布到宿主回环；
- 云端浏览器访问由宿主的 HTTPS 反向代理转发到回环 HTTP，并在代理层保护所有页面和 API；不得把容器 3000 端口、PostgreSQL 或数据根直接暴露到公网；
- 显式订阅、受限网页抓取、连接器和 Provider 是受控公网出站，与上述私人入站边界分离；
- Node 24 bookworm-slim 已固定不可变 digest；本地 Docker/PostgreSQL 18.6 合成演练、依赖审计、浏览器安全响应头和运行镜像瘦身已纳入 `v0.1.0` 发行门；所有者确认私人云端 Docker 服务已上线，目标主机的实际域名、镜像、证书、认证、防火墙、备份保留和监控继续由外部运维记录与后续生产复核证明；
- 完整个人数据备份与同 workspace 空库恢复命令已实现；定期保留、异地灾难恢复、跨工作区克隆、非空目标合并和删除策略未完成；
- 项目代码采用 MIT License；发行包与镜像必须携带项目许可证、第三方声明、依赖许可证和 SBOM。

### 7.32 已完成增量：M2-P0A–P0G Codex 批量完整入库链

- maintenance CLI 可以按幂等键和隐私范围冻结最多 500 个尚未拥有当前 Entry 结构的 Snapshot；单批计划最多 50,000 个 Entry；
- 执行始终以一个 Snapshot 为一个原子事务分片，成功分片不会因后续失败或重试而重写；每次执行窗口继续使用真实 ProcessingRun 记录；
- 批次支持状态、逐项报告、请求暂停、恢复和只重试失败/中断项；报告只含 UUID、计数、状态和稳定错误码，不输出正文、路径、URL 或 secret；
- 成功 P0A 批次可继续执行本地确定性标签：规则、排除词、确认别名和联系权重被摘要绑定；一个 Snapshot 内的 Entry revision 一次原子写入，重试不重复追加同版本规则标签；
- 联系只删除并替换至少一个端点属于本窗口 Entry 的可重建 projection；人工/AI pair override、正式知识关系和其他历史 pair 不被重建覆盖；
- 规则关闭、无可提取标签或容量已满进入只含 Entry revision 身份和闭合代码的异常队列；不复制正文或 Provider 数据；
- P0C 把异常按代码与当前裁决状态汇总，提供最多 50 项的稳定无正文抽样；批量转换必须提交精确 `expectedCount`，只更新仍匹配当前 Entry revision 的行，过期异常保持可见但不可批量裁决；
- `pending`、`accepted`、`manual_review` 和 `deferred` 只描述异常复核状态，可显式再次修改或回到 pending，不直接写 Entry、标签、联系或 Provider 状态；
- `000026`/`000027`/`000028` 共新增五张 typed 控制表；Processing Bundle v10/19 表携带它们并把 v1–v9 缺失状态升级为空；
- P0D 使用 disposable PostgreSQL 18.6 将固定 500 Snapshot / 15,000 Entry 工作负载跑过当前 28 份迁移、Blob/Evidence、P0A、P0B 与 P0C；受控 P0A/P0B 失败均可恢复和幂等重放，P0C 错误数量先 stale 后按精确数量接受；
- 记录运行持久化 15,000 Entry、54,000 规则关键词、123,000 条 projection 和 1,500 条已接受异常，总耗时约 919.6 秒（15 分 20 秒，16.311 Entry/s），结束后容器与临时外部数据根均移除；这证明合成开发路径远低于 4–6 小时预算，不代表真实语料或生产 SLO。
- P0E 将当前 pending 异常以 1–20 项的确定性 packet 输出到外部 `exports/codex-work/`，保留标题、正文和现有标签供当前 Codex 对话成批判断；默认排除隐私，显式 opt-in 也只在本机外部数据根工作；
- P0F 严格校验 canonical packet/result、精确 revision/version 和 closed action；`annotate` 原子追加完整标签 revision，exact 关闭异常并增量重建联系，重放不产生重复 revision；
- P0G 用 `pipeline-start/advance/status` 薄编排既有 P0A、P0B、P0C 服务，一次只推进调用者给出的 1–500 项窗口，并明确返回 `advance / wait / export_review_packet / none`；
- P0E–P0G 没有增加迁移、依赖、Provider、浏览器逐条执行器或第二套批次表；`complete` 只表示当前批次工程状态闭合。

### 7.33 已完成：M2-P1A–D 首次真实规模入库收口

- 完整个人数据包的统一默认预算为 1 GiB / 3200 万 canonical JSON value，覆盖已观察到的约 425.6 万个 Domain value；编码、解码、本地文件存取和四个数据库 section 使用同一上限；
- Evidence Snapshot 公共读取以 `capturedAt + snapshotId` 稳定 cursor 分页，每页最多 200 条并返回总数/后续 cursor；Web 导入、拆分、标签和总览会自动续页，不再把 200 当成工作区总数；
- P0B 规则版本现在同时产生内容关键词和唯一高置信度类型/领域分类。既有非规则分类保持原值，歧义/无唯一赢家不猜测并记录 `classification_incomplete`；
- `ingest enrich-refresh` 只重置旧规则摘要的成功项，先移除对应旧异常和裁决，再通过原 Snapshot 原子 revision 与增量联系边界重算；迁移 `000029` 只扩充闭合异常代码；
- 公开 exact/substring 查询可使用完整、当前且未触及 4,096 posting 截断上限的 term posting 先筛 Entry ID，再选择性读取候选；原纯查询继续负责所有字段、筛选、排序、计数与 cursor。fuzzy、隐私、Association、空查询、索引不完整或存在截断风险时完整回退；
- 2026-08-31 已在所有者授权的本地 Docker 私人部署完成操作收口：应用 `000029`、重授 runtime grant，并保留刷新前及刷新后两个独立校验的正式个人数据包；最终包约 305.9 MB、804 个 Blob 引用、489,871 行；
- 一个 397 Snapshot / 14,565 Entry 的既有成功批次已 refresh，397/397 成功、0 失败；10,066 条 Entry 产生新修订，新增 46,378 个标签并增量重建 99,057 条联系投影；全工作区 14,910 条 Entry 均有内容关键词，其中 3,768 条有类型、8,951 条有领域，12,613 条不唯一的分类保持 `classification_incomplete`；
- 文档公共分页以三页完整返回 407/407。公开索引以 3 GiB 容器 / 2 GiB heap 在约 491 秒内构建 14,910 个当前投影和 2,984,177 条 posting；backup/restore 因更大闭合状态固定为 6 GiB / 4 GiB；
- 三次实测中 `docker` exact/substring 查询约为 1.0–1.3 秒，无匹配 substring 约为 2.1–2.4 秒；空条件全量浏览仍约 10.2–14.5 秒，属于下一轮列表/查询下推性能边界，不影响本次非空 P1D 候选目标。

### 7.34 已完成：M2-P2A–D 分类体系强化

- 批量分类异常不再把所有未完成结果压成一个原因：旧 `classification_incomplete` 继续可读，新结果区分无信号、只缺类型、只缺领域以及平局/低置信度，现有汇总和抽样接口可直接按原因统计；
- 确定性分类器升级为字段感知 v2：标题、已有内容关键词和正文分别计分，标题与关键词权重更高；最低分和领先幅度同时成立才接受主分类，弱信号、平局和低领先幅度继续拒绝猜测；
- 领域输出允许一个主领域加最多两个达到门槛的次领域，仍使用现有有序领域关键词表示，因此没有引入第二套分类结构；
- 外部个人分类 Profile 支持别名、类型映射、领域映射和噪声排除，使用闭合 schema、版本和数量边界；它只保存在外部偏好文件并随完整个人数据包迁移，不进入 Git、数据库、日志或制品；
- 迁移 `000030` 只扩展既有批处理异常代码 CHECK。规则和 Profile 内容都进入 enrichment 摘要，已有成功批次只有在所有者显式执行 refresh 时才重算；
- 随后的显式真实 refresh 已测得 11,794 个当前分类异常：缺类型 7,528、缺领域 1,069、平局/低置信度 1,868、无信号 1,329。该结果确认 P2E 有必要；后续实际操作又确认最大类别需要一个可见的 P2F 类型覆盖与纠错入口。

### 7.35 已完成：M2-P2E 残余分类批量复核

- 继续使用 P0E/P0F 的外部 packet/result 与 exact apply，不增加第二套 Codex 协议；
- 显式选择四类 classification exception 时，工作包默认且最多包含 100 条；其他异常仍保持 20 条；
- 分类结果模板保留 invalid-by-default action，同时预填已有内容关键词、类型和领域，只把缺失维度留为 `replace_me`；
- 导出器优先通过 Entry ID 选择性 hydration；100 条 packet 的 decoder、领域 exact decision 和 PostgreSQL adapter 上限已对齐；
- packet/result 字节上限、显式隐私 opt-in、revision/version stale rejection、完整标签 revision 与增量 Association 重建保持不变；
- 本轮代码与测试仅使用合成资料，没有再次读取或修改真实工作区。查询性能仍是独立后续边界。

### 7.36 已完成：M2-P2F 类型覆盖与快速纠错

- 标签页新增独立的“类型覆盖与纠错”模式，显示当前范围的总数、已分类数、缺失数和十类分布；默认处理缺失类型，也可按既有类型抽查误判；
- 专用本地 API 使用稳定 cursor，每页最多返回 20 条。PostgreSQL 在只读可重复读事务内完成统计和页选择，只 hydration 当前页，不为覆盖率 UI 加载全部 Entry 正文；
- 保存继续走既有 Entry CAS 修订，完整保留正文、内容关键词、领域、评分、Fragment 和隐私事实；单 Entry 修订前后也优先按 ID 读取；
- 隐私条目默认从统计和队列排除，只有当次明确勾选才加入；每次前端读取都有取消信号和请求代次，旧响应不能覆盖新筛选；
- 本增量没有 migration、新依赖、Provider、后台自动改写或第二套分类结构；P2E 仍负责大批 Codex 复核，P2F 负责可见覆盖率与少量人工纠错；
- 代码与自动化测试只使用合成资料。实现完成后又对所有者现有本地 Docker 工作区执行一次明确只读评测：14,910 条公开当前 Entry 中 4,195 条已有类型、10,715 条缺失，当前类型覆盖率为 28.14%；工作区没有私密 Entry，因此真实隐私行仍只由合成回归证明；
- 同一只读评测中，缺失队列首屏只 hydration 20 条 Entry、20 条 Fragment input、64 条内容关键词和 17 条领域行，而全量读取相应为 14,910、14,910、47,784 和 11,222 行；六段产品等价 SQL 的一次本地 PostgreSQL 18.6 代表性测量合计约 39.8 ms。该结果证明页内读取边界生效，不作为远程部署 SLA；评测没有写入正文、标签、偏好或数据库状态。

### 7.37 已完成：M2-P2G 高置信度确定性类型补全

- 分类器升级为 v4：明确体裁词在正文中即可达到接受门槛；`factual_material` 只接受数据集、统计数据、资料汇总和事实记录等强信号；普通工具/项目/软件/网站/仓库介绍即使含链接也不自动赋型；
- 泛化“软件”等弱词、链接资源卡、平局和低领先幅度仍不猜测，`other` 仍只允许人工/Codex 明确选择；
- `ingest type-completion-preview` 按批次、隐私范围和最多 50 条稳定样本给出可补全、未解决、过期、已有类型及受人工决定保护的计数；maintenance 报告不返回正文、标题或来源；
- `ingest type-completion-apply` 根据持久化批次状态选择 run/resume/retry/refresh，并复用现有每 Snapshot 原子 revision、规则摘要、失败恢复及增量联系重建；已有类型和非 pending 裁决不被覆盖；
- apply 未结束时要求继续有限窗口；剩余不确定项进入 P2E 100 条 Codex 工作包，少量纠错继续由 P2F UI 完成；
- 本增量没有迁移、依赖、Provider、后台循环或第二套写入；实现阶段没有对所有者外部数据执行 apply，真实写入仍需另行授权、停写备份和抽样复核。
- 实现后对现有本地 PostgreSQL 18.6 进行了不输出内容的只读回放：v3 的通用资源卡规则在已有标签上的 `factual_material` 精确一致率只有 19.49%，因此从未 apply 并升级为 v4。v4 在 10,715 个缺类型公开 Entry 中只补全 353 个（3.29%），预计总覆盖由 28.14% 提升到 30.50%；已有类型上的选择性精确一致率为 90.92%，`factual_material` 为 88.24%。其余 10,362 个保持未判定并导向 P2E/P2F；本次没有写数据库。

### 7.38 已完成：M2-P3A–C 分类覆盖工程

- 确定性分类器升级为 v5：每个类型和领域类别分别配置最低分与领先幅度，减少资料、经历、互动和公告等高噪类别的弱信号误判；
- 外部分类 Profile 升级为 v2 并向后读取 v1。每维可容纳 4,096 条映射，大规模规则使用精确内容关键词索引，正文映射仍限 256；别名和排除词只编译一次，规则摘要预算同步扩大但仍有 8 MiB 上限；
- 新的纯本地邻居上下文按内容关键词倒排，只接受低 fan-out、至少 15% 相似、4 个参考和 85% 共识；公开/隐私先分离，类型排除同 Snapshot，诊断返回证据来源、数量和共识；
- 初次 enrichment 会用同一 revision 中刚生成的确定性关键词查询邻居；补全预览读取同一当前快照。两者都复用原 P0B 写入，不增加迁移、Provider、后台任务或第二套状态；
- 新增只读聚合评测工具。真实 14,910 条公开 Entry 回放中，已有类型选择性一致率 92.16%，邻居类型子集 91.38%；缺类型可预测 355 条，预计总覆盖 30.52%。缺领域可补 242 条，预计覆盖由 71.39% 升至 73.01%，邻居领域至少一项重叠率 97.87%；没有执行 apply，临时评测文件已删除。

### 7.39 已冻结：M2-P4A–E 可信样本类型学习工程（泛化未解决）

- 分类 Profile 升级为 v3，并继续向后读取 v1/v2。外部状态保存有界可信样本、候选模型和激活模型；个人数据包无需新增数据库 section 即可携带；
- 主动抽样先补每类可信样本和 Snapshot 缺口，再按模型分歧、低领先幅度、预测类别与结构特征轮转；默认排除隐私，当前命令必须显式包含隐私；
- maintenance 新增 type-learning export/apply/activate：工作包与结果位于外部 codex-work，逐项绑定 Entry revision 和 Profile revision；结果导入只形成 codex_accepted 样本并训练候选，不修改 Entry；
- 稀疏模型使用内容关键词、标题 token、chunk、长度、有限结构/语气信号，以及正文前 4,096 code point 内有界抽取的词项、相邻短语和字符 trigram。特征至少需要 2 个样本和 2 个 Snapshot 支持，并在 4 个正 Snapshot 前缩减权重；
- 每个支持类别至少需要 8 个可信样本和 6 个 Snapshot；零/少样本类别禁用，权重使用有界的正负 Snapshot 观测率差。每类最多 64 个训练样本时优先保留错误、无信号、低 margin 和低分样本，再补 Snapshot 多样性；
- 影子评估使用类别均衡的三折 Snapshot 交叉验证，每个样本恰好形成一次 out-of-fold 结果。`minimumScore` 和 `minimumMargin` 直接按每类 92% precision 目标校准；评估同时返回稀疏混淆矩阵和最多 64 个不含正文的误判 Entry/revision/Snapshot 身份；
- 激活门同时要求至少 4 个支持类别、验证 precision/coverage、逐类支持量，以及当前全部缺类型 Entry 的覆盖与分布稳定；单类不得占模型赋型结果超过 50%；
- 激活仍为独立显式命令，并在写入激活状态前重训和比对当前全量投射。旧 feature-v1/activation-v2 模型保持可读但不会执行；确定性规则优先、激活模型其次、邻居最后；
- 实际类型补全继续复用 P0B/P2G 的原子 revision 和增量联系。没有 migration、新依赖、Provider/API、后台任务或第二套 writer，也没有接触或修改所有者真实数据。
- 2026-09-02 的开发期实际标注结论是：当前系统仍不能可靠胜任跨材料泛化标注。合成测试、交叉验证和投射保护证明了工程边界与失败保护，但不能替代真实泛化质量；因此不得把 M2-P4A–E 记作已解决的产品能力。
- 实现冻结在提交 `411ade704351cb0fe07accec1801874be318d6fe`。当前不继续导出、导入或激活类型学习结果，不用候选模型补写 Entry；已经生成但未完成的外部结果模板继续保持不可导入状态。
- 泛化问题重新排入 `M2-P4R`，当前不启动，也不阻塞其他产品开发。重新启动前必须先由所有者明确授权，并冻结独立于训练样本的代表性人工评测集与可接受的逐类质量口径。

### 7.40 已完成：M2-P5A 生产发行身份与上线状态基线

- 公开 `v0.1.0` 固定为提交 `3100567265b70e32c1d903b165d3d2248815a968`、tree `6f02768158a9030b1332ea8dab4c1249dd66a68d`；当前开发历史中存在同 tree 的发行等价提交；
- M2-P5A 的输入提交为 `86066009193c98bc65088827faa0cbf5204c41a4`、tree `e6aba30c16104f5f69c507926d44a531e7f4e2cb`，它包含后续 M2 工作，不是新的公开版本；
- 所有者确认私人云服务器上的 Docker 实例已经投入使用。本次只记录该事实，没有独立访问主机，不把未知的部署细节标记为已验证；
- 真实域名/IP、镜像 digest、证书、认证、防火墙、secret、数据库、数据根、个人资料、备份清单和告警目标全部保持在 Git 之外；
- M2-P5B–D 已接续完成备份恢复工具、运行状态可见性与五步主线发行回归。

### 7.41 已完成：M2-P5B 备份可恢复性与保留预览

- maintenance 新增当前 workspace 的备份目录读取：只认当前 `personal-data` 文件名、直接普通文件和规范导出时间，按新到旧最多返回 100 项，不暴露外部根绝对路径；
- 指定备份的只读 verify 复用正式 restore 解码，完整检查 Domain/Entry/Association/Processing、Blob reference、内嵌 Blob 摘要、偏好与 workspace 身份，并返回文件 SHA-256、导出时间、Blob 数和表行数；
- 当前自包含个人数据包校验不写数据库、Blob 或偏好；旧 Bundle 只有在外部 Blob 仍可读取时才算可恢复；
- keep-latest 保留预览返回总数、保留数、拟移除数和最多 100 个候选文件名，超过时显式截断；本阶段没有 prune/delete 命令；
- list/verify/retention-preview 不要求数据库 ready，可在数据库故障时检查恢复材料；创建备份和恢复仍保持现有数据库与空 workspace 门；
- 代码与测试不读取生产备份或个人资料。云端实际摘要、保留选择和恢复演练结果继续存于 Git 外，不由本实现自动判定通过。

### 7.42 已完成：M2-P5C 运行健康、容量与告警

- `maintenance status` 返回数据库/领域计数、搜索投影完整性、失败/停滞 Processing、外部数据根容量和最新备份年龄；
- 阈值由当次命令显式给出或使用 168 小时/10%/60 分钟缺省值，报告使用稳定告警码和 ready/attention 状态；
- observer 彼此隔离，报告不含 URL、secret、绝对路径、正文、标签值或偏好内容；外部宿主负责调度和通知；
- 没有 migration、依赖、HTTP/UI、常驻守护进程或任何产品状态写入。

### 7.43 已完成：M2-P5D 五步主线发行回归

- disposable PostgreSQL 18 回归在批量 Evidence/拆分/标签/联系/裁决之后重建当前搜索投影；
- 同一链实际执行词法查询、精确 Fragment 来源返回、有界 Entry 知识图和 P5C 数据库观测；
- smoke 已验证 4 Snapshot / 32 Entry；标准回归又实际完成 500 Snapshot / 15,000 Entry、15,000 个当前搜索投影、13,500 个词法匹配和 13 节点/12 边知识图，总耗时约 18 分 9 秒；
- 该证据不读取现有数据库或真实资料，也不自动创建 commit、镜像、tag、release 或云端升级。

以上未完成项只有在进入相应产品边界或出现当前可达 `PRODUCT_BLOCKER` 时才阻断；测试工具自证、
未来环境强化和不可达边缘情况继续按开发总则记入延期强化，不拖住当前主线。

## 8. 当前验证快照

当前 M2-P0A–P0G、M2-P1A–D、M2-P2A–G、M2-P3A–C、冻结的 M2-P4A–E 与 M2-P5A–D 开发候选完成以下验证：

- AutomationPolicy decoder、纯分流核心、外部偏好文件、typed execution service/PostgreSQL adapter、迁移和完整个人数据包边界均有合成测试；
- 回归覆盖默认关闭、策略/Profile/Entry 过期、独立正负阈值、预算、人工接管、显式隐私范围、请求重放/冲突、运行中重校验、claim 完成/补偿、策略暂停失败后的待恢复重试、旧包升级及兄弟偏好字段保留；
- M1G-4A/B/C/D 的策略核心、执行服务、PostgreSQL repository、公开服务、Web 客户端、精确运行审计和面板状态回归继续保留；
- M1G-5A 新增迁移、队列服务/PostgreSQL adapter、公开 API/Web 客户端和 Tags 工作队列合成回归；M1G-5B 新增订阅偏好兼容及 changed-source → materialize → route 的完整合成链路回归；
- M1H-1 新增确定性标签规则、typed action 状态、PostgreSQL 事务、精确规则来源撤销、联系重建、订阅动作串联、公开 API/Web 操作和 Processing v7 升级回归；
- M1H-2 新增结构计划、`000021`、原子 PostgreSQL adapter、预览/应用 API、拆分页工作台、Entry v4 升级及旧包兼容回归；
- M1H-3 新增全文工作副本领域边界、`000022`、PostgreSQL adapter、四个本地 API 操作、拆分页编辑器、Entry v5 升级及 v1–v4 兼容回归；
- M1H-4 新增闭合规则 decoder、确定性分组计划、外部偏好原子写入、个人数据包、四个本地 API、拆分页操作与浏览器纵向回归；
- M1H-5 复用单文件导入协议，增加会话批次、逐文件状态、稳定失败重试、停止后续项及合成浏览器回归；没有迁移、数据库队列表或新依赖；
- M1I-1A/B 至 M1I-5 新增连接器闭合结果、Registry、多文档幂等 Evidence 准备器、`remote_document` 迁移、Git 兼容、RSS/Atom、JSON API 与受限 Web adapter、条件请求/声明式映射、分页与增量游标、已安装 capability 发现、opaque 外部配置引用、批量订阅服务、外部偏好 union、API 与导入页合成回归；没有真实 Feed、API、网页、插件配置或网络测试资料；
- M1J 新增迁移 `000024`、八类闭合关系语义、500 code-point 维护说明、来源核验状态、双端来源操作和 Association v4 向后升级；M1K 新增迁移 `000025`、可重建词项/向量投影、可选 OpenAI Embedding、三种 Query 和公开证据 RAG；M1L 新增可重复合成性能工具、单次关联读取索引与 HTTP 搜索去重；M1M 新增外部 secret 文件、维护/队列入口、容器与 grant 源码和 deployment verifier；没有第二套图谱/搜索服务、真实知识 fixture、私密外发、迁移或新依赖；
- M2-P5B 合成回归覆盖当前 workspace 备份过滤、规范时间排序、目录结果上限、无删除 keep-latest 预览、完整个人数据包只读验证、文件摘要/计数报告、无数据库 restore 写入，以及三个读取命令跳过数据库 readiness；
- M2-P5C 合成回归覆盖正常状态、全部阈值告警、observer 独立失败、脱敏报告、只读 PostgreSQL 事务和文件系统容量换算；M2-P5D 的 PostgreSQL 18 smoke 又实际执行数据库 observer；
- M2-P5D smoke 与标准 15,000 Entry 回归均贯穿 Evidence、P0A/P0B/P0C、搜索投影、词法查询、精确来源、知识图和运行状态；标准回归验证 30 份迁移重放 no-op、15,000 个当前搜索投影和完整清理，总耗时约 18 分 9 秒；
- 完整 `corepack pnpm run verify` 退出码为 0：165 个单元测试文件、1010 项单元测试、2 个集成测试文件、4 项集成测试全部通过，Web 构建转换 81 个模块，制品审计覆盖 1,142 个候选文件，部署静态门通过；
- M2-P1A–D 的合成回归继续覆盖超过 425.6 万 canonical JSON value 的个人数据包、407 份 Snapshot 的稳定完整分页、唯一高置信度类型/领域补齐及歧义异常、既有成功批次显式 refresh、词法索引完整性检查、候选 Entry 选择性读取和所有规定的完整回退；同一冻结实现随后按上节记录的真实规模完成迁移、双恢复点、refresh、索引重建、分页与查询耗时核验，真实正文与个人配置仍未进入 Git、日志或测试制品；
- M2-P2A–D 的合成回归覆盖字段权重、阈值与领先幅度、无信号/单维缺失/平局诊断、主领域与最多两个次领域、外部别名/映射/排除词、旧偏好与旧个人数据包缺省升级、Profile 往返以及迁移 `000030` 的闭合代码；真实覆盖率尚未声明，必须由后续显式 refresh 测量；
- M2-P3A–C 的合成回归覆盖按类别阈值、v1→v2 Profile 升级、精确/正文映射容量、邻居数量/共识/fan-out、同 Snapshot 类型隔离、公开/隐私隔离、可解释诊断、首次 enrichment 关键词与原子 writer 复用；只读真实回放只输出聚合数字且没有修改数据库；
- M2-P4A–E 的合成回归覆盖可信 revision 样本、类别/Snapshot 缺口抽样、正文短语/字符 n-gram、跨 Snapshot 稀有特征抑制、困难样本优先的 64 条上限、类别均衡三折 Snapshot 交叉验证、92% score/margin 校准、混淆矩阵与误判身份、全量投射覆盖与单类坍缩门、激活前漂移重算、Profile v3 往返、旧模型可读不可执行、Codex packet/result 绑定和显式激活；这些结果只证明实现与保护边界，实际泛化质量未通过所有者验收，当前实现已冻结并重新排队；
- M2-P0A 以合成测试覆盖批次计划、单 Snapshot 原子物化、提交后中断的 exact-existing 恢复、ProcessingRun 已先取消/失败时的 retry、计划漂移失败、有限窗口失败退出、CLI 解码/脱敏报告、PostgreSQL 查询边界、`000026` 静态语义和 Processing v7→v8 升级；
- M2-P0B 以合成测试覆盖 Snapshot 原子标签修订、首次 claim 前退出后的持久 attempt 恢复、孤立 running attempt 收束、规则异常、增量联系 source 范围、override 隔离、CLI 解码/脱敏报告、`000027` 静态语义和 Processing v8→v9 升级；
- M2-P0C 以合成测试覆盖当前/过期 revision 分离、分组计数、稳定抽样、精确数量冲突、批量接受与回退、CLI 脱敏输出、`000028` 静态语义、PostgreSQL current-revision 锁定和 Processing v9→v10 升级；它没有运行真实资料或 Provider；
- M2-P0D 用标准库、当前产品边界和 disposable PostgreSQL 18.6 执行 500 Snapshot / 15,000 Entry 合成完整链，证明 28 迁移 exact no-op、P0A Blob 失败恢复、P0B 联系失败恢复、P0C stale guard、数据库精确计数与资源清理；实测同时修复了 `000027` 对退役 revision 表的外键、两处 PostgreSQL status 参数类型推断及同一 client 并发查询；
- M2-P0E 覆盖 packet 确定性、显式隐私范围、过期 revision 拒绝、外部文件边界以及不覆盖已编辑结果；M2-P0F 覆盖 closed decoder、placeholder/缺项/过期拒绝、标签+裁决+联系幂等重放、annotation 写入后的精确当前 Entry revision 围栏及 PostgreSQL exact identity 锁定；M2-P0G 覆盖严格阶段顺序、有限窗口恢复、无执行 status 和闭合下一动作；
- Docker Desktop Linux Engine 27.4.0 使用纯合成、一次性资源完成普通与 maintenance Compose 解析、镜像构建和运行；最终本地候选 `struinfo:0.1.0` / `struinfo:release-candidate` 的镜像 ID 为 `sha256:de269bec525745961f4fd5f3344391f6168a5ae00c5a80fdd29e031c8af96c6f`，以 UID/GID 10001 运行并携带 MIT License、第三方声明和 SBOM；Trivy 0.66.0 对最终镜像报告 HIGH 0、CRITICAL 0；运行容器已移除 npm/Corepack/Yarn，保持只读根、无 Linux capability、`no-new-privileges` 和回环端口；
- disposable PostgreSQL 18.6 演练从空库完成 25 份迁移、首次队列 schema、runtime grant 和 preflight；一份合成 Markdown 经公开 API 形成 1 个 Resource、1 个 Snapshot、3 个 Fragment，备份生成 11,659-byte/13-row/1-Blob 个人数据包，空库恢复后数据库投影、85-byte Blob、精确读取和停止/重启健康结果一致；全部一次性资源在验证后清理，既有 `struinfo-owner-pg18` 未被修改；
- M1G-4D 聚焦 Chrome 回归验证迟到旧列表不会覆盖新列表、精确运行详情真正经独立端点读取，并在 320、390、768、1024、1440 CSS 像素下没有整页水平溢出；
- 当前合成 Playwright 回归 11/11 通过；M1H-1 两项推进动作在自动化策略面板中可见、默认关闭；M1H-2 在 390 CSS 像素下完成已物化结构的标量拆分、影响预览和原子应用；M1H-4 完成规则保存、预览与应用；M1H-5 完成两文件顺序导入、单项失败原身份重试及当前项完成后停止，并在 320、390、768、1024、1440 CSS 像素下无整页水平溢出；发行前还以容器中实际应用只读检查七个页面、拆分/标签展开态、查询连续输入和 390 CSS 像素布局，未发现控制台错误或整页横向溢出；知识图谱的 basis-point 相似度已修正为普通百分比显示；
- M1G-5A 新增迁移 `000019` 与 Processing v6；M1G-5B 只扩展外部订阅字段和既有服务编排；M1H-1 新增迁移 `000020` 与 Processing v7；M1H-2 新增迁移 `000021` 与 Entry v4；M1H-3 新增迁移 `000022` 与 Entry v5。没有新依赖、Provider 调用或真实数据；活动工作区保持无数据，手工五步主线现在同时支持拆分前全文修订和物化后结构纠错。

这些结果证明当前应用代码基线可构建、可测试、可在本地私人容器中迁移/运行/备份/恢复，且没有把测试或个人资源装入应用制品。所有者已经确认私人云端实例投入使用；这项确认仍不替代尚未取得的目标主机镜像扫描、私网/防火墙、备份保留或生产监控证据。

## 9. 首版发行后的审核与下一开发触发条件

截至 2026-08-28，产品开发主线已经完成，所有者已使用外部真实数据进行首轮使用审核，并明确授权首个私人单用户版本发行。该授权不等于真实 Provider 质量/费用、长期运行、备份保留、灾难恢复或公共多用户服务已经通过。

真实资料可以由所有者在外部数据根和数据库中继续使用，但不得进入 Git、公开发行、镜像或 fixture。开发验证继续使用合成、无个人含义、执行后清理的数据；迁移或复制真实资料到云主机仍需所有者明确选择目标和恢复方式。

M1E-4A/4B 已补齐直接人工拆分，M1E-5A/5B 已接通本地 Markdown、纯文本、HTML 和 PDF；M1F 已完成词法查询、关联比较和公开证据综合；M1G/M1H 已完成可解释偏好、可恢复路由、所有者队列、确定性推进动作、结构纠错、全文派生、拆分规则和多文件队列；M1I 已完成连接器/远程文档入库底座、RSS/Atom、声明式 JSON API、受限同源网页与已安装连接器接线；M1J 已完成正式知识关系语义；M1K 已完成词项/向量/RAG；M1L 已完成性能基准与按证据优化；M1M 已完成单机生产运行和维护代码边界。M2-P5A–D 已完成发行身份、备份核验、运行状态可见性和五步主线发行回归。
2026-09-05 按所有者要求，以代码缺口和使用价值重新整理后续顺序：先收口当前候选，再安排增量索引、查询复用、来源复核和引用式资料导出，详见路线图。
上述五项随后全部完成并提交。所有者现明确授权有限收尾及现有私人 Docker 实例的备份、恢复演练、升级和巡检，完成后停止常规功能开发并转入使用。具体执行证据见[维护交接](maintenance-handoff.md)；冻结的 P4R 继续保持不启动。
