# ADR 0051: 闭合 Codex 审阅结果与幂等回写

- 状态：Accepted
- 日期：2026-08-31
- 里程碑：M2-P0F

## 背景

P0E 解决了如何把疑难 Entry 成批交给当前 Codex 对话，但不能信任任意编辑后的 JSON 直接修改
数据库。结果必须精确绑定工作包、拒绝开放字段和过期 revision，并在进程中断后安全重放。

## 决策

结果文件采用 `struinfo.m2-p0f.codex-review-result.v1`。每个 packet item 必须恰有一个同序决定：

- `annotate`：给出完整 content keywords、一个 type 和 1–3 个 domains；
- `accept`：接受当前确定性结果，不改 Entry；
- `manual_review`：留给以后人工处理；
- `deferred`：明确延期。

文件必须是 canonical UTF-8 JSON，packet ID/SHA、Entry revision/ID 和 adjudication version 全部
精确匹配。占位动作、缺项、重复/意外项、未知字段、非法枚举和过期状态均 fail-closed。

`annotate` 复用既有 AI-origin Entry 标注领域函数，但不调用 Provider；它先以一个 packet 的 Entry
revision 原子写入，再把原异常精确转换为 `accepted`，最后只重建与这些 Entry 相接的可替换
Association projection。状态转换支持 exact identity/version 和“Entry 已因本结果形成下一 revision”
的受控 stale exception，因此任一步中断后重复执行可完成剩余步骤；相同 revision 不会再次追加。
人工/AI pair override 和正式知识关系不被覆盖。

## 结果

- Codex 结构化判断可通过 `ingest review-apply --packet <id>` 成批落库；
- 终端报告只有动作/写入/联系计数，不回显正文或结果内容；
- P0F 没有获得修改 body、拆分、隐私、评分、来源证据或正式知识关系的权限；
- 本阶段没有迁移、Provider、依赖或浏览器自动化。
