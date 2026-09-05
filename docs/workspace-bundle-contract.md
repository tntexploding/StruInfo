# StruInfo 个人数据包（Workspace Bundle v1）合同

- 状态：当前五分区个人数据导出/空工作区恢复已实现
- 最近更新：2026-08-26
- 对应决策：[ADR 0002](adr/0002-postgresql-persistence-and-durable-work.md)、
  [ADR 0006](adr/0006-external-configuration-and-personal-data-isolation.md)、
  [ADR 0007](adr/0007-information-entry-first-document-processing.md)、
  [ADR 0008](adr/0008-current-entry-state-and-portable-personal-data.md)、
  [ADR 0012](adr/0012-provider-neutral-processing-runs-and-proposals.md)、
  [ADR 0013](adr/0013-openai-entry-tag-proposals.md)、
  [ADR 0014](adr/0014-openai-entry-association-proposals.md)、
  [ADR 0015](adr/0015-openai-entry-split-proposals.md)、
  [ADR 0017](adr/0017-manual-within-fragment-entry-boundaries.md)、
  [ADR 0027](adr/0027-recoverable-entry-automation-routing-execution.md)、
  [ADR 0030](adr/0030-entry-automation-owner-work-queue.md)、
  [ADR 0031](adr/0031-subscription-deterministic-entry-routing-chain.md)、
  [ADR 0032](adr/0032-deterministic-entry-advance-actions.md)、
  [ADR 0033](adr/0033-post-materialization-entry-restructuring.md)、
  [ADR 0053](adr/0053-real-scale-capacity-classification-and-query-follow-up.md)
- 信封 Schema：[`workspace-bundle.v1.schema.json`](../packages/contracts/json-schema/workspace-bundle.v1.schema.json)

## 1. 目标

Workspace Bundle v1 现在是“当前已实现的全部工作区个人数据”的便携包，而不再只是数据库行和 Blob 身份清单。一次新导出包含：

- 36 张 Evidence、Curation 与正式 Knowledge 工作区表；
- 9 张当前成品态 Entry / Document 标签、精确 Fragment 区间及全文工作副本表；
- 2 张 Entry 联系投影与当前控制表；
- 19 张处理任务、提案信封、AI 拆分/标签/联系提案、自动路由执行、所有者工作队列、确定性动作及批量入库控制表；
- 所有被 Evidence 引用的原始/规范化 Blob 字节；
- 当前工作区的快捷标签、自动标签筛选、标签别名、Entry Profile、AutomationPolicy、联系/探索策略和信源订阅偏好。

共计 66 张数据库表。运行配置、数据库 URL、密码、API key、访问令牌、外部工作区路径和其他秘密不属于个人数据包，继续由外部配置/秘密机制提供。

真实包文件只能位于用户选择的外部数据根 `exports/`，不得进入 Git、源码目录、安装包、容器镜像或测试 fixture。tracked 测试只能使用合成且无个人价值的数据。

## 2. 信封与预算

| 字段             | 约束                                    |
| ---------------- | --------------------------------------- |
| `format`         | 固定为 `struinfo.workspace-bundle`      |
| `version`        | 固定为 `1`；未知版本拒绝                |
| `workspaceId`    | 稳定工作区 UUID                         |
| `exportedAt`     | 规范 UTC ISO 时间戳                     |
| `secretHandling` | 固定为 `excluded`                       |
| `sections`       | 按 `type + version` 排序且唯一          |
| `blobReferences` | 按 SHA-256 摘要排序且唯一的完整引用清单 |

当前默认完整包上限为 1 GiB、32,000,000 个 canonical JSON value。该上限覆盖首次真实规模入库暴露出的约 425.6 万个 Domain value，同时继续拒绝无界对象图或超大文件。Blob 字节在个人数据分区中恰好保存一份 base64 表示，同时信封继续保留独立 Blob identity 清单用于引用闭包核验。每个字节块必须同时满足声明长度和 SHA-256；导入时不能用路径或文件名替代内容身份。

## 3. 当前分区

| Type                       | Version | Payload schema                | 范围                                                                                                 |
| -------------------------- | ------: | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `struinfo.m1c-domain`      |       1 | `struinfo.m1c-domain.v1`      | Evidence、Curation、正式 Knowledge 与命令历史，36 表                                                 |
| `struinfo.m1d-entry`       |       5 | `struinfo.m1d-entry.v5`       | Entry 当前结构事实、Fragment 输入/可选精确区间、三维标签、lineage、Document 标签与全文工作副本，9 表 |
| `struinfo.m1d-association` |       4 | `struinfo.m1d-association.v4` | 可重建联系投影、当前人工控制与正式图谱关系语义/说明/核验元数据，2 表                                 |
| `struinfo.m1e-processing`  |      10 | `struinfo.m1e-processing.v10` | 处理任务、提案载荷、typed 自动路由、所有者队列、确定性动作、批量物化、enrichment 与异常裁决，19 表   |
| `struinfo.personal-data`   |       1 | `struinfo.personal-data.v1`   | 引用 Blob 的完整字节与当前审核/标签个人偏好                                                          |

每个 codec 都使用闭合 schema，显式列出允许的字段并拒绝未知表、未知列、重复身份、跨工作区引用和错误 scalar。通用信封不会把任意 JSON 直接当作领域事实。

Entry v5、Association v4 和 Processing v10 反映当前成品态。Entry v3 为人工物化增加可选半开 Unicode 标量区间；没有区间行的输入仍表示完整 Fragment。Entry v4 在相同八张表内为每个 Entry 增加 `is_current_structure`；Entry v5 增加第九张 `information_document_working_copy` 表。Association v3 在当前 override 上增加关系来源、名称和方向；Association v4 再增加闭合语义、500 code-point 内维护说明和未核验/已核对来源/需复核状态，并以保守默认值读取 v1–v3。Entry 的 `current_revision` / `current_revision_id` 只作为乐观并发版本令牌，不再指向一张普通编辑历史表。Processing v10 保存 typed 任务、提案、路由、确定性动作、P0A 批量物化、P0B enrichment/exception 和 P0C 当前异常裁决状态，不保存 Entry 正文、API key、提示全文、原始模型响应或任意 JSON。不可变 Snapshot、Fragment 以及正式 Knowledge 修订历史仍由 M1C domain 分区原样保留。

## 4. 规范编码与隐私

Writer 输出确定性 UTF-8 JSON：

- 对象键递归按 unsigned UTF-8 次序排序；
- 紧凑编码并以一个 LF 结束；
- 只接受有限数字、普通 owned record、稠密数组和 JSON 原语；
- 拒绝 accessor、Proxy、symbol、危险键、循环、稀疏数组和共享可变字节视图；
- Reader fatal UTF-8 解码后重新规范编码，并与输入字节逐字节比较。

个人数据包可能包含普通和隐私文档的完整正文，所以文件本身必须按用户个人资料处理。导出不会改变产品内的隐私可见性：默认搜索继续排除隐私 Entry/正式知识/联系，只有当前操作明确选择“包含隐私”或“只看隐私结果”才可显示。

秘密扫描只是一层事故防护，不是加密、DLP 或多用户权限系统。该格式不应宣称静态加密；需要加密归档时应在包文件之外使用用户选择的受信任存储方案。

## 5. 导出

一次导出按以下顺序执行：

1. 在 PostgreSQL `REPEATABLE READ READ ONLY` 快照中读取当前 66 张工作区表；
2. 规范化四个数据库分区并核对同一 `workspaceId`；
3. 从 Evidence 行导出精确 Blob 引用清单，并从外部 Blob store 读取每个引用的字节；
4. 从外部 `preferences/` 读取当前快捷标签、自动筛选和别名；
5. 编码五个分区，核验预算、秘密边界和引用闭包；
6. 在外部 `exports/` 通过临时文件、flush 和原子 rename 写入 `*.personal-data.json`。

若任一数据库、Blob、偏好或文件写入失败，导出不返回成功摘要。

## 6. 导入与恢复

Reader 必须先完整验证信封、全部分区、Blob 字节、SHA-256、工作区一致性和表引用，然后才开始恢复：

1. Blob 按内容寻址写入外部 store；重复写入相同字节是幂等操作；
2. 对带 personal-data 分区的新包，先保存目标工作区偏好；
3. PostgreSQL 在 workspace advisory lock 下，只向不存在的空工作区执行一次事务恢复；
4. 数据库恢复被拒绝或失败时，恢复原偏好；未被数据库引用的内容寻址 Blob 可安全留作孤立字节；
5. 任一步失败都返回可见错误，不切换当前工作区，也不把部分成功描述为完整恢复。

恢复不覆盖、合并或重映射已有工作区。要替换资料集，应显式选择一个空工作区/空数据库，成功后再通过外部配置打开它。

## 7. 兼容读取

Reader 继续接受历史 Bundle：

- 只含 `struinfo.m1c-domain.v1`：Entry 与联系状态按空处理；
- 带 `struinfo.m1d-entry.v1`：只保留旧指针选中的当前 Entry/Document 标签值，补空的 Fragment 区间、当前结构和全文工作副本并转换为 v5；`struinfo.m1d-entry.v2` 原样保留七张当前态表并补空区间；v3 保留精确区间；v4 保留当前结构；旧版本缺失的后续状态均按空/当前兼容值升级；
- 带 `struinfo.m1d-association.v1`、`.v2` 或 `.v3`：保留当前人工控制并转换为 v4；缺失的图谱关系元数据使用保守默认值；
- 缺少 `struinfo.m1e-processing`：处理任务、提案和自动路由状态按空处理；Processing v1 保留任务、提案信封和 Fragment 输入，v2 增加 AI 标签提案，v3 增加 selected-pair 联系提案，v4 增加 AI split 提案，v5 增加自动路由运行与 claim，v6 增加所有者工作队列，v7 增加确定性动作，v8 增加 P0A 批量物化控制，v9 增加 P0B enrichment item 和 typed exception，v10 增加 P0C 当前异常裁决；读取 v1–v9 时缺失的后续表按空处理并转换为 v10；
- 缺少 `struinfo.personal-data.v1`：仍要求外部 Blob store 已存在全部引用字节，且不覆盖当前个人偏好。

新 writer 只生成五分区形式。未知或重复分区、Association 存在但 Entry 缺失、Blob manifest 与 personal-data 字节不一致时一律拒绝。

旧扩展名 `*.workspace-bundle.json` 只作为兼容导入名继续读取；新导出使用 `*.personal-data.json`。

## 8. 当前限制

该功能是当前个人工作区的完整可移植导入导出，不是 PostgreSQL 集群灾难恢复：

- 只覆盖当前产品已经持久化的个人数据；未持久化的 saved view、模型缓存、账号系统或原始供应商响应不会被虚构进包；
- 不包含运行配置、秘密、数据库角色、服务器设置或第三方凭据；
- 不支持非空目标合并、跨工作区 UUID 重写、增量同步或冲突解决；
- Blob/preference 与数据库是两个外部存储介质，采用预验证、内容寻址幂等和失败补偿，而不是宣称跨介质 ACID；
- 不替代数据库备份、加密归档、Blob 垃圾回收或发布恢复演练。

只有直接使用证明需要时，才增加增量导出、跨工作区克隆或合并策略。
