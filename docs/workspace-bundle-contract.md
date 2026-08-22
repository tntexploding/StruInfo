# StruInfo 工作区 Bundle 合同

- 状态：v1 信封与 M1C/M1D 三分区、48 表导出/空工作区恢复已实现
- 最近更新：2026-08-22
- 对应决策：[ADR 0002](adr/0002-postgresql-persistence-and-durable-work.md)、
  [ADR 0005](adr/0005-versioned-knowledge-core-and-ai-optional-operations.md)、
  [ADR 0006](adr/0006-external-configuration-and-personal-data-isolation.md)、
  [ADR 0007](adr/0007-information-entry-first-document-processing.md)
- 信封 Schema：[`workspace-bundle.v1.schema.json`](../packages/contracts/json-schema/workspace-bundle.v1.schema.json)

## 1. 当前合同解决什么

工作区 Bundle v1 是个人工作区领域状态的可移植、版本化字节信封。
它固定导出/导入共同需要的编码、预算、分区版本、Blob 引用和秘密排除边界；
M1C 为 Evidence、Curation 与 Knowledge 注册一个闭合领域分区，M1D 分别为 Entry/Document
标签和 AssociationProjection/人工 override 注册两个闭合分区。三个分区在同一数据库
快照中导出并在同一事务中恢复。

信封包含：

| 字段             | 约束                                                          |
| ---------------- | ------------------------------------------------------------- |
| `format`         | 固定为 `struinfo.workspace-bundle`                            |
| `version`        | 当前固定为 `1`；未知版本拒绝导入                              |
| `workspaceId`    | 稳定、非路径型工作区标识                                      |
| `exportedAt`     | 规范 UTC ISO 时间戳                                           |
| `secretHandling` | 固定为 `excluded`                                             |
| `sections`       | 按 `type + version` 排序且唯一的模块数据分区                  |
| `blobReferences` | 按摘要排序且唯一的 SHA-256 身份；不包含文件路径或 base64 字节 |

当前默认完整信封上限为 16 MiB。
大型正文、快照和媒体继续使用 Blob 引用，不能通过 bundle 反复嵌套 base64。
M1C 领域、M1D Entry 和 M1D Association 分区各允许最多 1,000,000 个规范 JSON value，以容纳十期首批语料；
通用规范 JSON 编码器的默认 100,000-value 边界不变，其他调用者不会被静默放宽。

## 2. 分区 Codec

每个正式模块为自己的分区注册明确的 `type + version` codec。
Writer 只调用已注册 codec，把模块状态转换为普通 JSON 数据；Reader 在返回任何导入值前使用相同版本 codec 重新验证。

- 未注册的分区或版本拒绝导入和导出；
- 同一 `type + version` 在一个 bundle 中只能出现一次；
- codec 必须使用闭合 schema，拒绝未知字段和错误引用；
- codec 负责其领域含义和秘密字段映射，bundle 内核不替代领域校验；
- 增加正式 vocabulary、source、evidence、knowledge 或 view 分区时，同一变更必须提交 schema、codec、迁移映射和往返测试。

信封 JSON Schema 只描述公共信封。
`payload` 的具体 schema 由所注册分区合同拥有；这不是允许任意 JSON 直接成为 PostgreSQL 规范事实。

当前正式分区为：

| Type                       | Version | Payload schema                | 当前范围                                                                     |
| -------------------------- | ------: | ----------------------------- | ---------------------------------------------------------------------------- |
| `struinfo.m1c-domain`      |     `1` | `struinfo.m1c-domain.v1`      | Evidence、Curation、Knowledge 与命令历史，共 36 张表                         |
| `struinfo.m1d-entry`       |     `1` | `struinfo.m1d-entry.v1`       | Entry、不可变修订、Fragment 输入、三维关键词/沿袭和 Document 标签，共 9 张表 |
| `struinfo.m1d-association` |     `1` | `struinfo.m1d-association.v1` | 可重建关联投影、当前人工 override 与追加式 override 修订，共 3 张表          |

每个分区以固定依赖顺序显式列出允许的表、列和普通 JSON scalar 行；未知表、未知列、
非规范工作区身份或非 scalar 数据一律拒绝。分区不序列化内部 repository 对象、SQL、
配置、凭据或任意扩展 JSON。M1D 分区的 Entry 正文属于显式完整工作区导出的一部分，
因此 Bundle 文件与数据库一样可能包含隐私 Entry 内容；它必须留在用户拥有的外部数据区，
且不改变普通检索仍需显式隐私 opt-in 的规则。完整原始/规范化文档字节仍只由 Blob 引用承载。

`000006` 只为既有三张表增加隐私事实，因此表数仍为 36。当前 codec 会携带
`resource.is_private`、`knowledge_revision.is_private` 和
`knowledge_relation_revision.is_private`，从而在恢复后保留默认隐藏与传播结果。

## 3. 规范字节编码

当前 writer 输出一种确定性 UTF-8 JSON：

- 对象键递归按字典序排列；
- 不写额外空白，并以一个 LF 结束；
- 只接受有限数字、普通 record、稠密普通 array 和 JSON 原语；
- 拒绝 Proxy、accessor、symbol、自定义 prototype、共享字节视图、稀疏数组、循环和危险属性名；
- Reader 先复制输入的精确可见字节范围，执行 fatal UTF-8 和 JSON 解析，再重新编码并逐字节比较。

因此重复成员、不同键顺序、额外空白、BOM 或其他非规范表示即使能被 `JSON.parse` 接受，也不会被当前公开 Reader 接受。
Writer 先生成完整包络并测量最终字节数；只有不超过预算的完整结果才返回。

## 4. 秘密排除

普通 bundle 只能保存秘密引用，例如 `credentialReference`，不能保存秘密值。
正式分区 codec 必须从数据库或运行状态中显式选择可移植字段，不得序列化整个内部对象。

内核在导出和导入两侧额外拒绝：

- 密码、API key、access/refresh token、private key、数据库 URL、authorization、cookie 或 credential value 等秘密属性；
- URL userinfo 和常见秘密查询参数；
- Bearer 凭据和私钥文本块。

该检查是高置信事故防护，不是通用 DLP。
秘密可能被隐藏在任意备注文本中，因此领域 codec、授权、导出选项和人工审查仍是主要边界。

## 5. 数据交换与工作区切换边界

Bundle 是包体外、用户拥有的可移植数据文件，不是仓库资源、构建输入、可执行配置、JavaScript/TypeScript 模块或在线数据库文件。真实 Bundle 不得进入 Git、测试 fixture、安装包或镜像；tracked 测试只能使用合成且无个人价值的字节。

应用不得直接把 Bundle 挂载为可变工作区。Reader 完整验证信封和全部领域分区、同一
`workspaceId` 及全部 Blob 引用后，workspace-transfer repository 在一个事务中把精确状态恢复到
尚不存在该工作区的数据库；所有可延迟外键在提交时统一核验。恢复不接受非空目标，
也不执行覆盖或合并。失败的导入不得半途切换当前工作区，也不得让 PostgreSQL 状态
引用数据根中不存在或摘要不符的字节。

Reader 继续接受只含 `struinfo.m1c-domain.v1` 的既有 Bundle，并把缺失的 Entry 与 Association
分区都解释为空；也接受 M1D-2 的双分区 Bundle，并只把缺失的 3 张关联表解释为空。
Writer 只生成新的三分区形式；未知或重复分区仍然拒绝。

用户可以通过以下任一方式更换资料集，而无需修改代码或重新构建：

- 受控关闭当前工作区后，用包体外配置打开另一个已有 `workspaceId`；
- 把外部 Bundle 导入新的或明确选择的工作区，成功后再打开它；
- 从同版本备份恢复 PostgreSQL 与 Blob 后，按稳定 `workspaceId` 重新打开。

首版允许进程重启或 composition root 重新创建，不要求监视文件并实时热替换。工作区切换和 Bundle 导入必须是显式用户动作；复制或替换一个文件不能绕过 schema、权限、引用和事务校验。

## 6. M1C/M1D 已实现的传输路径

当前传输路径已实现：

- 在 `REPEATABLE READ READ ONLY` 事务中读取当前 48 张工作区表；
- 由 `struinfo.m1c-domain.v1`、`struinfo.m1d-entry.v1` 和
  `struinfo.m1d-association.v1` codec 分别逐表、逐列闭合验证并规范排序；
- 遍历 `evidence_blob` 得到精确 SHA-256 Blob manifest，并在导出与恢复两侧读取和核验；
- 在外部数据根 `exports/` 下以临时文件、flush、原子 rename 写入安全文件名；
- 只向同一稳定 `workspaceId` 的空目标执行一次事务恢复，保留已有命令 receipt、修订和幂等身份；
- 通过本机 HTTP 与资料工作区提供“导出当前工作区”和“按 Bundle 文件名恢复”操作。

M1C-EXPAND 对固定 398–407 期生成约 3.76 MiB 的旧单分区 Bundle。M1D-2 收尾在所选外部
工作区应用 `000008`/`000009`，从 issue 398 生成 34 个 Entry 和一个 Document 标签修订，
随后生成 4,373,218-byte 的双分区 Bundle，引用同样 10 个外部 Blob。

M1D-5 由用户显式选择其余九份 Snapshot，最终得到 345 个 Entry 和 598 个关联投影。当前
三分区 Bundle 为 5,281,365 bytes、10 个 Blob 引用、9,385 行和 48 张表；一次性空数据库
恢复后，10 个 Document、345 项 Entry 搜索、精确 Fragment 身份和关联结果一致。仅在
可丢弃数据库中创建的 enhance/restore 人工 override 以 1 个当前行和 2 个追加修订完成
导出/恢复；相同 Bundle 向非空目标重放返回 `workspace_not_empty`，恢复后的 345 个 Entry
保持不变。原始 Markdown、Blob 字节、临时数据库和 Bundle 文件均位于仓库之外。

## 7. 当前明确限制

该路径是可运行核心恢复，不是完整灾难恢复或跨工作区克隆：

- Bundle 只携带 Blob 身份，不携带正文或媒体字节；操作者必须单独备份并提供同一内容寻址 Blob 根；
- 隐私文档的完整原始/规范化备份同样只通过 Blob 身份引用；仅保存 Bundle 而未保存对应外部 Blob 根，不能恢复其全文；
- 只恢复同一 `workspaceId`，不重映射 UUID，也不克隆成另一工作区；
- 只接受空目标，不合并、覆盖或部分更新已有工作区；
- 当前三个分区覆盖 `000001`–`000010` 已实现的 Evidence、Curation、Knowledge、隐私可见性、Entry、Document 标签、关联投影、人工 override 和命令历史；不虚构 preference、policy、saved view、job、outbox 或 AI 运行表；
- 用户快捷标记、自动标签开关与筛选仍是外部 `preferences/` 中的个人 UI 配置，不属于领域 Bundle；
- 不替代 PostgreSQL 集群备份、Blob 保留/垃圾回收、加密归档、增量备份、跨版本升级或发布恢复演练。

后续只有真实恢复需求证明必要时，才增加 Blob archive、跨工作区克隆、合并策略或新
领域分区；破坏信封语义的变化必须发布新格式版本。
