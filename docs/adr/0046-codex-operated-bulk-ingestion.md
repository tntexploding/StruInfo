# ADR 0046: Codex 操作的可恢复批量入库基础

- 状态：Accepted
- 日期：2026-08-30
- 里程碑：M2-P0A

## 背景

首版已经可以逐文档完成导入、拆分、标签、联系和查询，但浏览器仍主要面向人工逐项操作。
当开发者用单个 Codex 会话整理上万条 Entry 时，逐条打开页面和保存会把主要时间消耗在交互
往返，而不是规则判断。当前开发周期又不应强制配置模型 API：Codex 应操作本地确定性程序、
抽查样本和处理异常，而不是逐条阅读后模拟点击。

M2 的目标是让至少 15,000 条 Entry 的完整入库具备 4–6 小时量级的工程路径。M2-P0A 只建立
可测量、可恢复的批量写入底座；该目标仍需后续合成性能测量和规则阶段证明，不能由本 ADR
直接宣称已经达到。

## 决策

### 批次冻结 Snapshot，而不是复制正文

一次计划最多选择 500 个尚无当前 Entry 的 Snapshot，按捕获时间和 Snapshot ID 稳定排序。
计划只冻结 Snapshot ID、规范内容 SHA-256、隐私事实和预计 Entry 数；正文继续只存在于外部
Blob 与不可变 Fragment 证据中。一个批次最多规划 50,000 条 Entry。

计划使用调用方显式 idempotency key。相同 key 和相同请求返回原批次；同 key 不同请求拒绝，
防止 Codex 重试时意外创建不同工作。

### 一个 Snapshot 是一个事务分片

执行器为每个 Snapshot 重新读取并校验冻结身份，从本地 Blob 重建精确 Fragment 文本，调用
已有确定性 `section` 拆分器，并通过 `materializeEntriesIfSnapshotEmpty` 在一个事务中写入完整
Entry 集。中断最多影响当前 Snapshot；已提交的 Snapshot 不会因后续失败回滚或重写。

若进程在 Entry 提交后、批次结算前中断，重试得到的 exact `existing` 仍算成功。若 Snapshot
已经形成另一套结构，则记录稳定的 `snapshot_structure_conflict`，不覆盖用户结果。

### 独立批次状态与现有 ProcessingRun 尝试记录

迁移 `000026` 新增批次头和逐 Snapshot 项两张 typed 表。批次状态为
`planned/running/pause_requested/paused/succeeded/failed`；项目状态为
`pending/running/succeeded/failed`。每次 run/resume/retry 都创建一条现有 `ProcessingRun`，因此
总览与既有运维轨道仍能观察实际尝试。

暂停在当前 Snapshot 结束后生效。有限执行窗口结束时，未处理项保持 pending 并进入 paused。
retry 只把 failed 或被中断的 running 项恢复为 pending，成功项不重做；旧执行器由 active-run
围栏阻止继续结算。

### 维护 CLI 是 Codex 的第一方控制面

现有 `maintenance` 入口增加：

```text
ingest plan --key <key> [--scope public_only|include_private|private_only] [--limit 1..500]
ingest run --batch <uuid> [--max-items 1..500]
ingest pause --batch <uuid>
ingest resume --batch <uuid> [--max-items 1..500]
ingest retry --batch <uuid> [--max-items 1..500]
ingest status --batch <uuid>
ingest report --batch <uuid>
```

输出只包含批次、Snapshot 身份、计数、状态和稳定错误码，不含正文、标题、URL、Blob 字节、
配置或 secret。失败执行返回非零退出码。Codex 可以据此规划批次、运行、检查异常簇和选择性
重试，而不需要 Provider API 或浏览器自动化。

### 个人数据与运行权限保持闭合

Processing Bundle 升为 v8，新增两张批次表；v1–v7 恢复时补空。完整个人数据包因此覆盖
63 张当前工作区表。runtime 只获得这两张表的既有 SELECT/INSERT 和必要 UPDATE；没有 DDL、
DELETE、Provider、网络或第二份正文权限。

## “完整入库”的本阶段含义

M2-P0A 完成的是“选定 Snapshot 已确定性生成可查询的当前 Entry，或者以稳定错误明确结算”。
它不伪造标签、评分、联系或 AI 判断，也不把尚未实现的自动标签/联系阶段写成成功。后续
M2-P0B 才能在独立规则与异常队列边界上补齐批量标签和增量联系。

## 结果

- 单个 Codex 会话可以用少量稳定命令控制数百文档，而不是逐条点击；
- 每个 Snapshot 独立提交，支持暂停、有限窗口、恢复和仅失败项重试；
- 真实资料、偏好和数据库继续位于 Git/镜像之外；测试只使用合成资料；
- 未增加模型 API、第三方依赖、浏览器任务或自动接受权；
- 15,000 Entry / 4–6 小时仍是后续端到端测量目标，不是未测量的发布声明。
