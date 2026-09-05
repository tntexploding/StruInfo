# ADR 0052: 统一批量入库推进与完成报告

- 状态：Accepted
- 日期：2026-08-31
- 里程碑：M2-P0G

## 背景

P0A–P0F 已分别具备物化、确定性 enrichment、异常复核、Codex 工作包和结果回写，但操作方仍需
记住多个状态和 run/resume/retry 组合。需要一个薄编排层减少操作错误，同时保持每个既有阶段的
事务、恢复和权限边界。

## 决策

新增 `pipeline-start`、`pipeline-advance` 和 `pipeline-status`。状态机严格按以下顺序运行：

1. P0A Snapshot→Entry；
2. P0B 确定性标签与增量联系；
3. P0C/P0E/P0F 当前异常复核；
4. 当前 pending 为零后报告 complete。

一次 advance 只执行调用者给定的 1–500 项窗口，不在进程内无界循环。它根据持久状态选择
run/resume/retry；running/pause-requested 返回 wait，有限窗口返回 advance，疑难项返回
export_review_packet。失败保持非零 maintenance 退出语义。P0G 不创建第二套批次表，也不绕过
P0A/P0B/P0C 的 repository、规则摘要、CAS 或隐私边界。

## 结果

- 当前 Codex 开发周期获得一个清楚、可恢复的主入口和明确下一动作；
- `complete` 只表示物化/enrichment 成功且当前异常均已作出闭合处置，不代表真实资料质量、
  Provider 自动化或生产 SLO；
- 没有后台任务、自动接受、真实数据、迁移、依赖或 UI 前置条件；
- 未来 API 并发微批次可复用这些领域边界，但不得把 Provider 变成当前开发周期的依赖。
