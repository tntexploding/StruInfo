# ADR 0048: 批量入库异常汇总、抽样与裁决

- 状态：Accepted
- 日期：2026-08-30
- 里程碑：M2-P0C

## 背景

M2-P0A 已把 Snapshot 批量、可恢复地物化为 Entry；M2-P0B 接续确定性标签和增量联系，并把
本地规则不能安全处理的情况记录为 typed exception。若异常仍只能逐条打开浏览器处理，15,000
条目开发周期的主要交互成本并未消失。

当前阶段由 Codex 通过维护命令操作，不要求 Provider API，也不需要为了少量批次控制再建立一套
浏览器页面。P0C 需要把异常压缩成可读汇总、提供稳定抽样，并允许对同类异常作可恢复的批量决定，
同时不能让过期 Entry revision 或数量漂移被悄悄接受。

## 决策

### 裁决只描述异常处理状态

每条 P0B exception 懒创建一条当前裁决记录，状态闭合为：

- `pending`：尚未决定；
- `accepted`：所有者接受当前规则结果，不再要求本批次补充处理；
- `manual_review`：需要回到既有查询/标签界面查看对应 Entry；
- `deferred`：明确留待后续批次处理。

裁决不修改 Entry 正文、评分、标签、Document 标签、Association projection、pair override、正式图谱
或 Provider proposal。任何状态都可通过显式命令再次转换，包括回到 `pending`；不保存重复的决定
历史或内容副本。

### 当前与过期异常严格分开

读取时用 exception 冻结的 Entry revision/revision ID 与当前结构 Entry 比较。汇总同时报告总数、
当前数、过期数和每个异常代码下的四种当前裁决状态。`reviewComplete` 只表示当前 revision 没有
`pending` 异常；过期异常保持单独可见，不能被解释为当前 Entry 仍有相同问题。

批量裁决只锁定并更新仍是当前 Entry revision、异常代码和原状态都精确匹配的行。调用方必须提交
刚刚观察到的 `expectedCount`；实际数量不同则整个命令返回 `stale`，不进行部分更新。过期异常永远
不进入批量更新。

### 抽样稳定且不返回正文

抽样可按异常代码、裁决状态和 `current / stale / all` 范围过滤，最多返回 50 项。顺序由 batch ID、
异常代码与 Entry ID 的 SHA-256 稳定派生；相同批次和条件得到相同样本。结果只含批次序号、
Snapshot/Entry/revision 身份、隐私事实、异常代码、当前性和裁决版本，不含标题、正文、来源 URL、
Blob、提示或 Provider 输出。需要查看内容时继续使用现有 Query/Tags 产品入口。

### Maintenance CLI 和可移植状态

现有维护入口增加：

```text
ingest exceptions-summary --batch <uuid>
ingest exceptions-sample --batch <uuid> [--code <code>] [--status <status>] [--scope current|stale|all] [--limit 1..50]
ingest exceptions-adjudicate --batch <uuid> --code <code> --from <status> --to <status> --expected-count 1..50000
```

P0C 只接受 P0B 所有 enrichment item 已成功的批次。迁移 `000028` 增加一张当前裁决表；Processing
Bundle 升为 v10/19 表，并把 v1–v9 缺失的裁决状态恢复为空。完整个人数据包因此覆盖 66 张当前
工作区表。runtime 只获得该表需要的 typed SELECT/INSERT/UPDATE，不获得内容读取、DDL、Provider
或网络权限。

## 结果

- Codex 可以先看异常分组，再检查少量稳定样本，最后用一个带数量保护的命令裁决整组；
- 当前异常与已经修改过的 Entry 严格分开，数量或 revision 漂移不会产生部分批量写入；
- 所有决定可显式修改或回到 pending，不建立重复历史副本；
- 无新第三方依赖、无 Provider、无浏览器逐条保存、无真实 fixture；
- P0C 不证明 15,000 Entry / 4–6 小时端到端目标，也不实现自动 AI 微批次。下一性能证据必须覆盖
  PostgreSQL、Blob、事务、恢复和异常控制，或在所有者明确授权的实际环境中执行。
