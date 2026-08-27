# ADR 0042: 正式知识关系语义与来源核验

- 状态：Accepted
- 日期：2026-08-27
- 里程碑：M1J

## 背景

M1E-2 已把当前 `InformationEntry` 和可见 Association 组成可编辑的正式知识图谱，
但一条边此前只保存来源、名称和方向。用户可以改名，却无法稳定区分“相似、支持、
冲突、组成”等常用语义，也无法记录维护说明或标明是否已经回看两端原始来源。
恢复旧 M1C `KnowledgeItem/KnowledgeRelation` runtime 会重新制造第二套内容与查询主线，
不符合 Entry-first 的当前产品结构。

## 决策

### 继续使用同一图谱记录

前向迁移 `000024` 只扩展
`information_entry_association_override` 当前行，不新增平行图谱表。每个持久关系在既有
`origin / label / direction` 之外保存：

- `semanticKind`：`similarity`、`related`、`supports`、`contradicts`、`part_of`、
  `causes`、`example_of` 或 `custom`；
- `verificationStatus`：`unreviewed`、`source_checked` 或 `needs_review`；
- `note`：最多 500 个 Unicode code point 的可选维护说明。

已有图谱 override 以保守方式升级：名称为 `similarity` 的边成为 `similarity`，其他边
成为 `custom`；核验状态为 `unreviewed`，说明为空。自动投影仍不需要写 override，读取时
直接显示为 `similarity / calculated`。这一区分防止“算法计算过”被误读为“用户核对过”。

### 来源核验只表示回看证据

正式知识页的关系检查器可分别打开中心 Entry 和另一端 Entry 的精确 Snapshot/Fragment
来源。用户随后可保存“已核对两端来源”或“需要再次复核”。`source_checked` 只表示用户
核对过当前来源对这条记录的支撑情况，不证明陈述客观为真，也不代替冲突调查、时效、
适用范围或来源可靠性判断。

### 人工和 AI 的维护规则

用户创建或编辑关系时同时保存语义、名称、方向、核验状态和说明；隐藏/恢复继续保留
这些元数据。AI selected-pair 提案被人工接受后，使用 `related / unreviewed` 并把已有
有界 proposal summary 保存为说明；AI 不得自行标记 `source_checked`。结构纠错迁移
关系时必须原样携带这些字段，Association 重建仍只能替换计算投影，不能覆盖 override。

### 个人数据与兼容

Association 个人数据包升级为 `struinfo.m1d-association.v4`。v1/v2/v3 继续可读；v3 的
图谱字段按与数据库迁移相同的保守默认值升级。关系说明和核验状态属于用户数据，只能
位于 PostgreSQL、外部个人数据包和当前 UI，不得进入仓库 fixture 或内建词条。

## 非目标

M1J 不实现知识树、集合、时间线、无限画布、复杂本体、自动事实核查、外部网络核验、
自动接受 AI 关系、RAG、向量索引或旧 M1C Knowledge runtime。上述能力需要独立边界；
下一阶段按既定路线进入 M1K 分词、向量与 RAG。

## 验证

使用合成、无个人含义的 Entry/关系验证迁移、纯图谱逻辑、PostgreSQL 映射、结构纠错、
公开 API、AI 接受以及 Association v3→v4 恢复。活动工作区保持无真实数据。
