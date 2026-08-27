# StruInfo 当前项目状态与实现清单

- 状态：M1J 正式知识关系语义、维护说明与来源核验已完成；活动工作区保持无数据
- 实现基线：M1I-1A/B 至 M1J 无数据开发候选
- 最近核对：2026-08-27
- 需求边界：[产品需求](product-requirements.md)
- 交付顺序：[分阶段计划](roadmap.md)
- 架构边界：[知识核心架构](knowledge-core-architecture.md)

## 0. 当前无数据开发基线

2026-08-24，活动工作区的既有文档、条目、标签、联系、历史兼容行、Blob、偏好和导出已完整移入项目目录外的恢复归档。当前数据库保留迁移与表结构，但全部业务表为空；外部数据根保留固定目录结构，但不含用户文件。运行配置、工作区 ID 和主项目不变，没有创建替代工作区。

所有实际审核统一在项目开发完成后开始。开发完成前，所有者内容/体验审核、真实 Provider 质量与费用审核、正式门禁、部署和发布审核均保持未签发，且不得阻塞无关产品开发。开发期间：

- 不导入、恢复、抓取或生成任何真实资料；
- 不把旧周报、个人条目、偏好或数据库副本放回仓库、应用目录或活动数据根；
- 单元、集成和浏览器测试只使用合成且无个人含义的数据，并在结束后清理；
- 只用空状态和合成测试判断页面、接口、迁移、启动、隔离与错误显示是否正确；
- 只有当前公开产品路径可复现的 `PRODUCT_BLOCKER` 可以阻断下一增量。

历史文档中的实测数字仅记录已经完成的开发证据，不代表当前活动数据库仍含这些资料。

## 1. 如何阅读本项目状态

本文是“当前代码到底能做什么”的实现真值表。产品需求描述长期目标，路线图描述交付顺序，
ADR 记录已经接受的决策；当历史文档中的旧 M1C 示例与当前代码冲突时，以 ADR 0008、
ADR 0009、ADR 0010、ADR 0011、ADR 0012、ADR 0013、ADR 0014、ADR 0015、ADR 0016、ADR 0017、ADR 0018、ADR 0019、ADR 0020、ADR 0021、ADR 0022、ADR 0023、ADR 0024、ADR 0025、ADR 0026、ADR 0027、ADR 0028、ADR 0029、ADR 0030、ADR 0031、ADR 0032、ADR 0033、ADR 0034、ADR 0035、ADR 0036、ADR 0037、ADR 0038、ADR 0039、ADR 0040、ADR 0041、ADR 0042 和本文列出的活动入口为准。

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
  → 用户选择尚未物化的 Snapshot，以人工 Fragment/标量区间分组、确定性规则或已接受 AI 提案生成当前 InformationEntry
  → 已物化后仍可由所有者编辑完整分组、预览标签/沿袭/关系影响并原子替换当前 Entry 结构
  → 可选：订阅变化后按已启用的单订阅开关直接复用确定性物化与可恢复分流
  → 编辑有用/有趣评分与内容/类型/领域标签
  → 聚合当前 Document 标签
  → 重建可解释的 Entry 关联，并人工增强/削弱/屏蔽/恢复
  → 可选：对明确选中的两个公开 Entry 生成 AI 联系提案，人工接受后写入现有图谱边界
  → 按精确/包含/近似文字、字段范围、结构、时间、隐私和一至两跳关联查询 Entry
  → 可选：以当前选中结果为锚点，按外部探索策略显式生成页外直接联系候选
  → 显式隐私范围内另行查询完整隐私文档并从外部 Blob 打开全文
  → 以最高匹配 Entry 为中心读取有界正式关系图，并编辑/隐藏/创建关系
  → 从查询或图谱节点返回精确 Snapshot/Fragment
```

`Fragment` 是不可变证据位置；`InformationEntry` 是当前普通浏览、标注、联系和查询的主单元。
普通 Entry 只保存一个当前成品态和乐观并发版本，不再保存每次中间编辑副本。
历史 `KnowledgeItem` 等深层语义对象仍存在于数据库兼容层，但当前应用不公开其旧写入、读取或搜索入口。当前“正式知识”产品入口以 Entry 及其自动/用户关系组成可编辑图谱。

## 3. 七个产品页面

| 页面     | 当前已实现                                                                                                                                                                                                                                                                                                                                           | 当前明确未实现                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 总览     | 当前工作区、来源文档、Fragment、Entry、已标注 Entry 与文档标签的真实统计；五步人工/确定性主线；最近 ProcessingRun 的真实阶段、进度、步骤、提案数及可取消状态；Git、RSS/Atom、JSON API、网页和插件订阅检查使用同一真实 import 任务轨道；已配置拆分/标签/联系 Provider 的诚实状态                                                                      | 不虚构未执行任务；无运行时明确显示暂无任务，无 Provider 时明确显示未配置              |
| 导入     | 手动 Markdown 文本、固定 Git 文件，或单份/最多 20 份显式批次本地 `.md`/`.markdown`/`.txt`/`.html`/`.htm`/`.pdf` 文件；精确 GitHub Markdown、公开 RSS/Atom、声明式 JSON API、最多八页显式同源网页及运行环境已安装插件订阅；外部编辑、手动/间隔检查、能力发现与默认关闭的变化后确定性拆分/分流；远端记录/页面逐份入库，精确原始响应字节保留在外部 Blob | DOCX/ODT、OCR、复杂 PDF 版面/表格/图片还原、目录扫描/监视、开放网页发现、插件安装市场 |
| 拆分     | 选择尚未生成 Entry 的 Snapshot；保存一份拆分前全文工作副本并确认成新的派生 Snapshot；查看全文与精确 Fragment；保存并预览版本化本地 section/短段合并规则；在既有边界或 Fragment 内 Unicode 标量边界合并/拆开连续分组并改标题后一次物化；对已物化文档预览影响并原子重组当前 Entry；可选 OpenAI 首次分组提案、人工接受/拒绝                             | 来源重排、任意脚本/解析器规则、自动/AI 结构替换、私密内容外发                         |
| 标签     | 查看来源标题路径与整篇/拆分模式；编辑 Entry 正文、内容/类型/领域三维标签；有用/有趣两个 1–5 评分；确定性关键词候选；大小写归一和用户确认别名；文档标签聚合与人工编辑；外部快捷标签、排除词和 URL 域名设置；可解释 PreferenceProfile、自动路由控制/审计及真实所有者工作队列；可选 OpenAI 标签提案、人工接受/拒绝                                      | 自动中英文翻译判定、无确认的语义合并、私密内容外发、旧处理意图/判断原因/手工联系      |
| 联系     | 依据正文词项及内容/类型/领域标签重建关联投影；编辑外部版本化权重和阈值；显示分项分数与来源；逐对增强、削弱、屏蔽或恢复；这些投影也是正式图谱的自动相似边来源                                                                                                                                                                                         | AI 联系提案不在本页生成；多跳知识图编辑仍未实现                                       |
| 查询     | 标题/正文/标签的精确、包含和近似词法匹配及可见分数；内容标签、来源、Snapshot、类型、领域、主副领域、整篇/拆分、发布时间/采集时间过滤；公开/包含隐私/只看隐私；一至两跳关联；查询绑定游标、解释和精确证据；独立完整隐私文档结果通道；用户显式启动的本地页外探索候选；公开结果的可选 AI 证据综合                                                       | 中文分词、`pg_trgm`、向量/Embedding、RAG 和在线混合搜索仍未实现                       |
| 正式知识 | 简单搜索选择最高匹配 Entry；候选改选；有界中心关系图与等价列表；自动/用户编辑/用户创建/AI 辅助来源；八类关系语义、名称、方向、说明、未核验/已核对来源/需复核状态；双端精确来源；隐藏、恢复、创建；selected-pair AI 联系提案；三种隐私范围                                                                                                            | 全库无限画布、知识树/集合/时间线、复杂本体、自动事实核查与自动接受                    |

查询页之后的“正式知识”页面已按 ADR 0010/0011/0014/0042 接通。可见 AssociationProjection 直接成为带来源标记的自动 `similarity / calculated` 边；用户编辑或创建关系时保存闭合语义、名称、方向、维护说明和来源核验状态，并可分别打开两端精确来源。`source_checked` 只表示用户核对过来源，不表示客观事实已获证明。选择两个公开 Entry 后可生成待审核 AI 联系提案；只有人工接受才通过同一 override/CAS 边界写入，AI 边仍默认未核验。隐藏、恢复和结构纠错保留这些字段，投影重建不会覆盖用户决定。

## 4. 当前数据表示与存储

| 数据         | 当前表示                                                                                                                                                                        | 存储位置与更新方式                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 原始资料     | `Resource`、不可变 `Snapshot`、原始/规范化 Blob 身份                                                                                                                            | 元数据在 PostgreSQL；字节在包体外内容寻址 Blob 根；相同命令幂等                    |
| 文档结构     | `DocumentNode`、`Fragment`、媒体引用                                                                                                                                            | PostgreSQL；跟随 Snapshot 不可变，可返回精确来源位置                               |
| 当前 Entry   | 稳定 Entry ID、来源/Snapshot、顺序、标题路径、正文及哈希、整篇/拆分、隐私、Fragment 输入及可选精确标量区间、三维标签、两项评分、当前结构标记与 successor/predecessor lineage    | PostgreSQL 当前成品态；普通修订推进版本；结构替换保留旧 Entry 行并切换唯一当前分区 |
| 当前文档标签 | Snapshot 级标签及 Entry 覆盖/全文出现证据                                                                                                                                       | PostgreSQL 当前成品态；可确定性重算或人工覆盖                                      |
| Entry 联系   | 可重建分项投影 + 当前人工 override；自动 `similarity / calculated` 与用户编辑/创建/AI 关系的语义、名称、方向、说明和来源核验状态                                                | PostgreSQL；投影可替换，人工图谱控制不被重建覆盖                                   |
| 处理任务     | 当前 ProcessingRun、订阅 import 检查、三类 AI 提案、Entry 自动路由 header/逐条 claim，以及成功 claim 派生的所有者工作项                                                         | PostgreSQL 当前任务态；claim 固定路由事实，工作项单独保存待处理/完成/跳过状态      |
| 个人偏好     | 快捷标签、自动提取开关、URL 域名开关、排除词、别名、联系/探索/Entry 偏好策略、AutomationPolicy，以及 Git/RSS/JSON API/网页/插件信源配置、外部配置或凭据变量引用、分流开关和游标 | 外部数据根 `preferences/`；不进入 Git 或应用包体                                   |
| 个人数据包   | 61 张当前工作区表、引用 Blob 字节和当前偏好；Entry v5、Association v4 与 Processing v7 section                                                                                  | 外部数据根 `exports/`；恢复只接受同工作区的空目标；旧 Bundle 仍可读                |

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
- Provider-neutral ProcessingRun/提案信封，以及 typed split/tags/association payload；
- Entry 自动路由执行、成功 claim 派生的所有者工作队列；
- 外部版本化信源订阅服务和精确公开 GitHub Markdown reader；
- 插件兼容的 SourceConnector Registry、远程文档闭合结果和幂等多文档 Evidence 入库准备器；
- Workspace/个人数据包传输。

活动 HTTP 面只有健康检查和 [`m1c-local-http-api.md`](m1c-local-http-api.md) 中列出的当前路由。
请求不能选择 `workspaceId`；工作区和外部数据根由包体外配置注入。

### 5.2 必要支持模块

- 外部运行配置、数据根路径隔离和 PostgreSQL 连接；
- 二十四份前向迁移及独立迁移进程；
- 本地内容寻址 Blob、偏好文件和导出文件存储；
- 健康检查、结构化日志、生命周期与优雅关闭；
- API、scheduler、worker 和 `all` 运行角色、非重叠订阅轮询及共享队列基础；
- React/Vite Web 外壳、同源本地 API 客户端、单元/集成/E2E 与制品审计。

队列和多运行角色目前是基础设施能力；精确 GitHub Markdown、公开 RSS/Atom、声明式 JSON API、受限网页和实际安装 connector 已接通，但不能由此推导开放爬虫或通用自动采集。ProcessingRun 是独立的持久任务状态边界；订阅检查使用 import 阶段，公开 split、tags 与 selected-pair association 提案都可以显式启动、接受或拒绝。

M1I-1A/B 至 M1I-5 已完成外部信源底座、三类内建远端 reader 和已安装连接器产品接线。M1J 又在现有 Entry 图谱上完成关系语义、维护说明、来源核验和 Association v4 传输；下一公开产品增量是 M1K 分词、向量与 RAG。

## 6. 兼容保留而非活动产品能力

- 迁移 `000003`、`000004`、`000006`、`000007` 及其既有 Curation/Knowledge 数据表；
- `struinfo.m1c-domain.v1` 个人数据包分区中的旧行；
- 对历史迁移和旧数据可读性的窄测试；
- Test-owned PostgreSQL TM2 档案。它不在当前产品脚本、类型检查、lint、构建或制品中；
- `m1c_*` 文件/类型名中的传输命名残留；它们承载当前本地 API 或兼容包，不代表旧工作流仍然活动；
- Markdown 解析器中的 `intake_target` 结构角色；它只用于识别可物化 section，不再创建准入决定。

旧 Manual Curation 命令/读模型、正式 Knowledge 写入/当前读取、旧 Knowledge 检索及其
PostgreSQL adapter、HTTP、Web 页面和样式已由 ADR 0009 删除。代码删除没有删除用户数据库中的历史行。

## 7. 未完成清单

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

### 7.28 已知产品缺口

- 拆分页尚不能重排来源、执行任意脚本/自定义解析器规则，或自动/批量重组多个已物化文档；
- 导入已支持手动 Markdown、固定 Git Markdown，以及单份或显式多文件批次的 Markdown、纯文本、HTML 或带文字层 PDF；尚无 Office、OCR、复杂版面/图片还原、持久后台上传、目录扫描或目录监视；
- OpenAI 目前为用户明确选择的公开 Snapshot、公开 Entry 和公开 Entry 对生成拆分、标签和联系提案，并可显式综合当前公开 Query 证据；私密内容外发、自动接受和第二 Provider 仍未规划；
- 近似词法匹配和公开证据综合已实现；尚无语义/向量搜索、在线检索或通用聊天/RAG；
- 精确 GitHub Markdown、公开 RSS/Atom、声明式 JSON API、受限同源网页和已安装受信任连接器的手动/间隔检查、变化检测和可选确定性拆分/分流已实现；尚无开放式爬虫、目录订阅、交互式认证信源、日历时区调度、任意工作流编排或自动内容修改；
- 知识树、集合、时间线、冲突维护、报告/推送和复杂事实关系类型尚未实现；当前图谱只提供有界 Entry 邻域；
- 历史 Curation/Knowledge 表尚未通过数据退役迁移移除；在确认不再需要兼容前继续保留；
- 当前完整加载式 Entry 查询尚未做 SQL query pushdown；无数据审核期间没有优化依据。

### 7.29 发布与部署缺口

- 当前产品是本机回环、单用户工作台，不是公共 API；
- 公网认证、CSRF 完整边界、TLS、多用户授权和云部署未完成；
- Docker/Linux/生产等价 PostgreSQL 与运行权限认证未签发；
- 生产备份/灾难恢复、跨工作区克隆、非空目标合并和删除/保留策略未完成；
- 项目尚未选择分发许可证，不能发布为开源发行版。

以上未完成项只有在进入相应产品边界或出现当前可达 `PRODUCT_BLOCKER` 时才阻断；测试工具自证、
未来环境强化和不可达边缘情况继续按开发总则记入延期强化，不拖住当前主线。

## 8. 当前验证快照

M1G-5A/5B、M1H-1A/B、M1H-2A/B、M1H-3A/B、M1H-4A/B 与 M1H-5A/B 在冻结的 M1G-4D 基线上完成以下验证：

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
- M1J 新增迁移 `000024`、八类闭合关系语义、500 code-point 维护说明、来源核验状态、双端来源操作和 Association v4 向后升级；没有第二套图谱表、真实知识 fixture、Provider 扩权或旧 Knowledge runtime；
- 完整 `corepack pnpm run verify` 退出码为 0：128 个单元测试文件、828 项单元测试、2 个集成测试文件、4 项集成测试全部通过，Web 构建转换 78 个模块，制品审计覆盖 982 个候选文件；
- M1G-4D 聚焦 Chrome 回归验证迟到旧列表不会覆盖新列表、精确运行详情真正经独立端点读取，并在 320、390、768、1024、1440 CSS 像素下没有整页水平溢出；
- 当前合成 Playwright 回归 11/11 通过；M1H-1 两项推进动作在自动化策略面板中可见、默认关闭；M1H-2 在 390 CSS 像素下完成已物化结构的标量拆分、影响预览和原子应用；M1H-4 完成规则保存、预览与应用；M1H-5 完成两文件顺序导入、单项失败原身份重试及当前项完成后停止，并在 320、390、768、1024、1440 CSS 像素下无整页水平溢出；
- M1G-5A 新增迁移 `000019` 与 Processing v6；M1G-5B 只扩展外部订阅字段和既有服务编排；M1H-1 新增迁移 `000020` 与 Processing v7；M1H-2 新增迁移 `000021` 与 Entry v4；M1H-3 新增迁移 `000022` 与 Entry v5。没有新依赖、Provider 调用或真实数据；活动工作区保持无数据，手工五步主线现在同时支持拆分前全文修订和物化后结构纠错。

这些结果证明当前代码基线可构建、可测试且没有把测试/个人资源装入应用制品；它们不替代尚未执行的所有者体验或生产部署认证。

## 9. 开发完成后的统一审核与下一开发触发条件

截至 2026-08-25，所有者已明确要求：实际审核内容在项目开发完成后统一开始。所有者内容与体验、真实 Provider 质量/费用、正式 PostgreSQL/容器门、部署和发布审核在此之前均保持“未签发/延期”，不得被描述为通过，也不得在没有当前可达产品缺陷时阻断开发。正常单元、集成、构建和合成浏览器验证仍属于开发质量门，不属于被推迟的实际审核。

活动数据库和外部数据根继续保持空状态。不得为了展示或验收恢复旧周报、个人条目、偏好或任何其他真实资料；开发验证只使用合成、无个人含义、执行后清理的 fixture。恢复归档或引入新材料必须再次取得所有者明确授权。

M1E-4A/4B 已补齐直接人工拆分，M1E-5A/5B 已接通本地 Markdown、纯文本、HTML 和 PDF；M1F 已完成词法查询、关联比较和公开证据综合；M1G/M1H 已完成可解释偏好、可恢复路由、所有者队列、确定性推进动作、结构纠错、全文派生、拆分规则和多文件队列；M1I 已完成连接器/远程文档入库底座、RSS/Atom、声明式 JSON API、受限同源网页与已安装连接器接线；M1J 已完成正式知识关系语义、维护说明与来源核验。其他自动业务动作仍未授权。下一开发任务是 M1K 分词、向量与 RAG；开发完成前不恢复真实资料来制造审核任务。
