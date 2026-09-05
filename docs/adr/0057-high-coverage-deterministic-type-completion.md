# ADR 0057：高置信度确定性类型补全

- 状态：Accepted
- 日期：2026-09-01
- 决策者：Project owner / Main Agent

## 背景

M2-P2F 的只读真实规模评测显示，14,910 条公开当前 Entry 中仍有 10,715 条缺少类型。P2E 能让
Codex 以 100 条工作包复核，P2F 也能逐条纠错，但把所有缺失项直接交给人工或 Codex 仍然过重。
现有 v2 规则的强体裁词在正文中只得到 3 分，而接受门槛是 6 分。这是规则覆盖缺口，不应靠强制
填入 `other`、把普通链接资源卡当作事实资料或降低全部分类门槛解决。

## 决策

1. M2-P2G-A 将确定性分类规则升级为 v4。明确的教程、分析、解释、公告、观点、经历、访谈和
   文学体裁词在正文中即可达到最低门槛；较弱的泛化词仍不足以单独赋型。
2. `factual_material` 只接受数据集、统计数据、资料汇总、事实记录等明确资料信号。普通工具、项目、
   软件、网站或仓库介绍即使含有链接也保持未判定；分类器继续永不自动写入 `other`。
3. M2-P2G-B 提供维护命令 `type-completion-preview`。它只分析当前、pending、缺类型且符合本次
   隐私范围的异常，按 Entry ID 分块 hydration，返回规则/Profile 版本、可补全/未解决计数、类型与
   原因分布以及稳定抽样。报告只含标识、分数和代码，不回显正文或来源。
4. M2-P2G-C 的 `type-completion-apply` 不建立第二套写入协议。它根据现有 enrichment 批次状态选择
   run/resume/retry/refresh，以 1–500 Snapshot 的有界窗口复用原子 Entry revision、规则摘要、失败
   恢复和增量 Association 重建。已有人工、AI、导入或先前确定的类型不被覆盖。
5. M2-P2G-D 将仍无法安全判断的 pending 项明确导向 P2E `review-export`；少量误判或遗漏继续用
   P2F 类型纠错工作台处理。已经进入 accepted/manual_review/deferred 的人工决定不会被 P2G 重开。
6. 本增量不增加迁移、依赖、Provider、后台循环、第二套分类表或真实资料 fixture。代码落地阶段
   只允许只读真实规模评估；是否对所有者外部工作区执行 apply 由所有者另行明确授权。

## 结果与边界

- 预览的 `nextAction=apply_type_completion` 表示存在高置信度候选；应用窗口未结束时返回
  `continue_apply`；只剩疑难项时返回 `export_codex_review`；完全闭合时才返回 `none`。
- P2G 提高可解释的自动覆盖，但不声称类型是真值。外部个人 Profile、P2E Codex 复核和 P2F 手工
  修订仍是覆盖规则语义、跨语言别名和个别误判的正式路径。
- 隐私范围沿用 `public_only / include_private / private_only`；默认预览公开 Entry，应用严格继承目标
  enrichment 批次的既有范围，不能借命令扩大私密读取。
- 真实 apply 前必须先完成停写备份；代码通过不能替代所有者资料上的抽样质量检查和 post-backup。

## 实施后只读评测与 v4 修正

在所有者已运行的本地 PostgreSQL 18.6 私人部署上，对 10,715 条公开且当前类型为空的 Entry 进行
一次内存只读评估；没有调用 adjudication ensure、Entry revision 或 enrichment writer，也没有输出
正文、标识或来源。最初 v3 的通用链接资源卡规则可覆盖 6,028 条，但其中 5,717 条被判为
`factual_material`；在 4,195 条已有类型上回放时，该类别精确一致率只有 19.49%。因此 v3 未执行
apply，通用资源卡分支被判定为核心质量缺陷并在 v4 删除。

默认 Profile v0 下，v4 可为 353 条给出类型，覆盖缺失集合的 3.29%；若随后获授权应用，总覆盖预计
由 4,195 / 14,910（28.14%）提升到 4,548 / 14,910（30.50%）。候选分布为：
`knowledge_explanation` 118、`investigation_analysis` 57、`argument` 51、`operating_guideline` 48、
`public_communication` 36、`personal_experience` 20、`interactive_collaboration` 10、
`literary_creation` 10、`factual_material` 3。剩余 10,362 条中，8,917 条无信号、1,392 条低于
门槛、52 条平局、1 条领先幅度不足。

v4 在已有类型上的选择性精确一致率为 90.92%；`factual_material` 从 19.49% 提升到 88.24%。按
各类别既有标签精确率投影，353 个新候选约为 88.94%。既有标签并非完全独立金标，因此这些数字是
真实资料回放证据而不是最终人工真值；它们足以证明 v4 应保留高精度、低覆盖的失败闭合行为。
