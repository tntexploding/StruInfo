# ADR 0049: Disposable PostgreSQL 批量入库基准与恢复证明

- 状态：Accepted
- 日期：2026-08-30
- 里程碑：M2-P0D

## 背景

M2-P0A/P0B/P0C 已分别完成可恢复 Snapshot→Entry 物化、确定性标签与增量联系、异常汇总与
批量裁决。此前的 15,000 Entry 工具只执行内存规则核心，不能回答 PostgreSQL、Blob、迁移、
事务、失败恢复和持久化结果是否仍能满足开发周期 4–6 小时目标。

活动工作区必须继续保持无真实资料，因此本阶段不能恢复所有者语料。需要一个仓库拥有、可重复、
执行后完全清理的合成 PostgreSQL 18 证据，而不是把真实资料或长期数据库写入 Git、应用数据根
或普通质量门。

## 决策

### 固定的合成、一次性工作负载

`performance:m2-p0d` 使用固定 `postgres:18.6` 镜像、临时外部数据根和随机本地端口。标准模式
生成 500 个合成 Markdown Snapshot，每个 Snapshot 形成 30 个 Entry，共 15,000 Entry；每十个
Entry 有一个确定性无标签异常。工具执行当前全部 28 份迁移、迁移 no-op 重放、pg-boss schema
准备与 runtime grants，然后只通过现有 Evidence、P0A、P0B 和 P0C 产品边界运行。

工具不读取恢复归档、所有者资料、Provider、网络信源或个人配置。成功或失败后都必须删除临时
PostgreSQL 容器和临时外部数据根。普通 `verify` 不依赖 Docker；该命令是显式性能/恢复证据。

### 恢复路径是基准的一部分

工具在 P0A Blob 读取边界注入一次可控失败，要求初次窗口失败、retry 成功且 replay 不重复写入；
在 P0B Association 写边界再注入一次可控失败，要求既有规则标签可重用、retry 成功且 replay
保持完成。P0C 先用错误 expected count 证明整组 stale/no-write，再用精确数量接受全部当前异常。

最后从数据库独立统计 Resource、Snapshot、section Fragment、Entry、当前 Entry version、规则
关键词、联系 projection、异常和裁决数量。任一计数、恢复状态、迁移重放或清理不匹配都使命令
非零退出。

### 实测结果

2026-08-30 在 Windows x64、Node 24.19.0、Docker Desktop 和 `postgres:18.6` 上，固定 workload
SHA-256 为 `0b3badc0012140398257816bb551931f2eb6297dd45c32b0ce67a0028b91616c`。
标准运行得到：

- 500 Resource、500 Snapshot、15,000 section Fragment 和 15,000 当前 Entry；
- 54,000 个规则关键词、123,000 条增量 Association projection；
- 1,500 个当前 typed exception，1,500 个精确数量保护后接受的裁决；
- 28 份迁移首次执行，第二次为 exact no-op；P0A/P0B 的失败、重试与 replay 以及 P0C stale guard
  全部通过；
- 总耗时 `919,633.697 ms`（约 15 分 20 秒），平均 `16.311 Entry/s`；其中 Evidence/Blob 导入
  约 85.6 秒，P0A 约 77.3 秒，P0B 增量联系约 749.4 秒，P0C 约 4.1 秒；
- 结束状态为 `container_and_external_data_removed`。

该结果证明当前合成、一次性 PostgreSQL 完整路径远低于 4–6 小时工程预算，并确认主要耗时在
联系投影而非规则计算。它不是所有者真实语料、长期运行、Provider 或生产 SLO 的替代品。

## 实测修复

首次真实执行发现并关闭四类可达缺陷：

1. `000027` 的异常记录错误引用已由 `000011` 删除的历史 revision 表；现改为引用活动 Entry
   identity，冻结 revision 数值/ID 继续用于 stale 判定；
2. 批次与裁决 UPDATE 中复用的 status 参数缺少显式 `varchar` cast，PostgreSQL 无法唯一推断；
3. 多个 adapter 在同一 `pg` client 上并发发出查询，已改为顺序读取；独立 pool/client 并发保留；
4. 基准持久化检查不再假设已删除的 Entry revision 表或不存在的 Fragment role 列。

这些是实际 PostgreSQL 路径缺陷，必须保留普通单元/迁移回归；它们不是测试框架强化门。

## 结果

- M2-P0D 关闭无真实资料条件下的 disposable PostgreSQL 吞吐、恢复和结果计数证据；
- 当前 Codex 开发周期的 15,000 Entry 核心批量链不再需要浏览器逐条保存，也不要求模型 API；
- 标准基准可显式重跑，smoke 模式用于快速检查，但不会拖慢普通提交质量门；
- 本阶段不增加迁移编号、第三方依赖、Bundle section、后台服务或产品 UI；
- 真实资料分布、人工抽查节奏、长期数据库增长和生产资源容量在所有者后续使用时测量；只有可达
  产品缺陷才阻断主线。
