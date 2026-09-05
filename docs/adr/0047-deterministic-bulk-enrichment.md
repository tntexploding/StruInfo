# ADR 0047: 可恢复的确定性批量标签与增量联系

- 状态：Accepted
- 日期：2026-08-30
- 里程碑：M2-P0B

## 背景

M2-P0A 已把最多 500 个 Snapshot 冻结为可恢复计划，并按 Snapshot 原子生成当前 Entry。它没有
把“Entry 已形成”冒充“完整入库”：确定性标签、联系投影和不能自动裁决的项目仍缺少批量边界。
开发周期由 Codex 操作本地程序，不应为了这些规则再次逐条打开浏览器，也不应强制配置模型 API。

M2-P0B 的目标是让同一成功批次继续完成本地规则标签和增量联系，同时把规则不能处理的 Entry
显式放入小型异常队列。它仍不宣称已经用真实资料证明 15,000 Entry / 4–6 小时端到端目标。

## 决策

### 只接续已成功的 P0A 批次

P0B 只接受 P0A 状态为 `succeeded` 的批次。旧批次第一次读取或执行 P0B 时，系统按原有
Snapshot 顺序懒创建一条 enrichment item；不会复制正文、标题、Blob 或 Snapshot。每次执行窗口
继续创建真实 `ProcessingRun`，并冻结当前确定性标签规则、用户确认别名/排除词和联系权重的
规范 SHA-256。

`run` 只启动尚未执行的 enrichment；`resume` 继续有限窗口剩余项；`retry` 只重置 failed 或被
中断的 running 项。成功项不重做。执行器替换和乐观版本冲突保持显式失败，不允许旧执行器结算。

### 每个 Snapshot 原子追加规则标签

执行器重新读取同一隐私范围的当前 Entry，并核对 Snapshot 的 Entry 数与隐私事实。它复用标签页
已经公开的本地确定性提取器、排除词和确认别名。一个 Snapshot 内需要修改的 Entry revision 由
同一 PostgreSQL 事务整体写入；任一 revision 过期时，该 Snapshot 不产生部分标签结果。

规则标签具有固定 origin/version，不覆盖人工、AI 或导入标签。重试发现相同规则版本的既有标签
时按已完成结果计数，不重复追加。以下情况不是伪成功标签，而是 typed 异常：

- `automatic_tagging_disabled`；
- `no_deterministic_tags`；
- `keyword_capacity_reached`。

异常只保存 Entry/revision 身份和代码，供 Codex 后续聚类处理；不保存正文、提示或任意错误文本。

### 只重算与本批 Entry 相接的联系

标签写入后，执行器在当前隐私范围加载可见 Entry，并只为本窗口的 source Entry 生成候选。候选仍
使用既有内容/类型/领域权重、阈值、每条最多 12 个候选和稳定排序。Repository 只删除并替换至少
一个端点属于 source 集合的可重建 projection；不触碰其他历史 pair。

pair-specific override、正式知识关系、人工增强/削弱/屏蔽及其说明/核验状态存放在独立表中，增量
重建不得修改。联系失败时已提交的规则标签保持可重放，enrichment item 以稳定错误失败；retry 会
识别既有同版本标签，再次执行联系而不重复写标签。

### Maintenance CLI 和可移植状态

现有入口增加：

```text
ingest enrich --batch <uuid> [--max-items 1..500]
ingest enrich-resume --batch <uuid> [--max-items 1..500]
ingest enrich-retry --batch <uuid> [--max-items 1..500]
ingest enrich-status --batch <uuid>
ingest enrich-report --batch <uuid>
```

状态/报告只返回批次、Snapshot/Entry revision 身份、规则摘要、计数、状态和闭合异常/错误码。迁移
`000027` 增加 enrichment item 与 exception 两张 typed 表。Processing Bundle 升为 v9/18 表，
v1–v8 缺失的 P0B 状态恢复为空；完整个人数据包因此覆盖 65 张当前工作区表。runtime 只获得这两
张表需要的 typed DML，不获得 DDL、Provider、网络或正文复制能力。

### 性能证据不冒充端到端验收

仓库工具 `tools/run_m2_p0b_performance.ts` 只使用合成、无个人含义的 15,000 Entry / 500 Snapshot
工作负载，分别测量确定性标签和增量联系核心。2026-08-30 在 Node 24.19.0 / Windows x64 的一次
运行（workload SHA-256 `14cff09adda2b8bcd4c404dc759b5e676a5fd6c708790a967ebe9c249fcdbee6`）
生成 60,000 个候选与 141,000 条 projection，核心耗时约 1.24 秒。

该结果只说明内存规则核心不是预计的小时级瓶颈。它不包含 PostgreSQL、Blob、事务、恢复、Codex
操作、异常复核或真实资料分布，不能证明 15,000 Entry / 4–6 小时端到端目标。真实测量只能在
所有者明确授权材料和目标环境后执行，资料与报告仍不得进入 Git。

## 结果

- 一个 Codex 会话可用少量命令完成 P0A Entry 后的确定性标签和增量联系；
- Snapshot 标签写入原子化，联系只重建受本窗口影响的 pair，用户 override 完整保留；
- 规则不能处理的 Entry 进入可恢复、可汇总的 typed 异常队列，不被静默当作成功；
- 无 Provider、无新第三方依赖、无浏览器逐条保存、无真实 fixture；
- Provider 微批次、批次审核 UI、异常聚类/批量裁决及真实 15,000 Entry 端到端验收仍是后续边界。
