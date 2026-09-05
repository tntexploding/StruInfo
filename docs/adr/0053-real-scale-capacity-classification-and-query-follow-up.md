# ADR 0053: 首次真实规模入库后的容量、分类与查询收口

- 状态：Accepted
- 日期：2026-08-31
- 里程碑：M2-P1A–P1D

## 背景

首次由 Codex 完成开发周期批量入库后，外部工作区暴露了四个规模事实：Domain 分区约有
425.6 万个 canonical JSON value，超过原 100 万上限；文档列表的单次 200 条限制使 407 份
Snapshot 只显示前 200 份；大多数规则处理 Entry 只有内容关键词而缺少类型和领域；公开全量
词法查询约需 7–8 秒。这些是可达产品问题，按开发总则应直接修复，而不是重开旧验收循环。

## 决策

按 P1A、P1B、P1C、P1D 顺序实施：

1. 完整个人数据包仍使用闭合 canonical JSON，但统一将默认预算提高到 1 GiB / 3200 万个
   value。Domain、Entry、Association 和 Processing codec 使用同一 value 上限；读写仍在解析或
   落盘前执行字节、结构、Blob 摘要和引用闭包校验。生产 Compose 为 backup/restore 单独使用
   6 GiB 容器内存和 4 GiB Node heap；公开索引重建所在 app 使用 3 GiB/2 GiB，preflight 等普通
   维护任务仍保持 1 GiB。以上档位属于正式大工作区传输与索引边界。
2. Snapshot 列表改为按 `captured_at DESC, snapshot_id ASC` 的游标分页。服务端每页最多
   200 条并返回 `total`/`next`；Web 客户端自动读取后续页，因此页面和总览可看到全部文档，
   而不是通过提高单次 SQL 上限制造大响应。
3. P0B enrichment 增加纯本地、版本化、确定性的类型/领域分类。只有唯一高置信度规则赢家才
   填补空分类；既有人工、AI 或导入分类永不覆盖，歧义项保留为空并进入
   `classification_incomplete`。`enrich-refresh` 只重置规则摘要已变化的成功项，并先移除这些项的
   旧异常/裁决；迁移 `000029` 只扩展异常代码 CHECK。
4. 公开、非空、无 Association 遍历的 exact/substring 查询先从可重建 term posting 中筛候选，
   再仅加载候选 Entry，并继续由原查询函数完成字段匹配、筛选、排序、计数和 cursor。索引缺失、
   revision 不完整、fuzzy、隐私或 Association 查询全部回退到原完整加载路径，语义不变。

## 结果

- P1A 同时关闭结构预算和容器运行资源两层阻断。首次部署演练中 512 MiB 默认 heap 与 768 MiB
  临时 heap 都在约 425.6 万 value 的 Domain 段闭合处理中耗尽；刷新后的更大状态又越过 2 GiB
  heap，因此正式 backup/restore 固定使用 6 GiB/4 GiB 独立档位。升级后仍必须停写并显式执行
  一次 backup。
- P1B 保留 200 条服务端保护，同时消除 UI 只显示 200 份文档的问题；真实部署以三页完整返回
  407/407。
- P1C 已显式 refresh 一个 397 Snapshot / 14,565 Entry 的成功批次，0 失败；全工作区 14,910 条
  Entry 均有内容关键词，3,768 条有类型、8,951 条有领域，12,613 条不唯一分类保持异常而不猜测。
- P1D 复用既有可重建索引，不引入搜索服务或新依赖；只有全部当前公开 Entry 都有当前且
  未触及 4,096 posting 截断上限的投影时才缩小候选。真实部署在约 491 秒内构建 14,910 个
  当前投影与 2,984,177 条 posting；三次 exact/substring 实测约 1.0–1.3 秒。索引不完整或存在
  截断风险时仍宁可回退也不漏结果。
- 首次公开 API 索引重建在默认约 512 MiB Node heap 下退出，但整体替换事务保持派生表为 0/0；
  因此 app 使用上述生产规模档位后重建成功且容器未重启。空条件全量浏览仍约 10.2–14.5 秒，
  作为后续列表/查询下推边界保留，不属于本次非空候选优化。
- 停写备份在刷新前和刷新后各成功生成并独立核验；最终包约 305.9 MB、804 个 Blob 引用和
  489,871 行。真实内容只留在外部数据根与 PostgreSQL，没有进入 Git、日志或测试制品。
