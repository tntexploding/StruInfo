# ADR 0057：高覆盖确定性类型补全

- 状态：Accepted
- 日期：2026-09-01
- 决策者：Project owner / Main Agent

## 背景

M2-P2F 的只读真实规模评测显示，14,910 条公开当前 Entry 中仍有 10,715 条缺少类型。P2E 能让
Codex 以 100 条工作包复核，P2F 也能逐条纠错，但把所有缺失项直接交给人工或 Codex 仍然过重。
现有 v2 规则的强体裁词在正文中只得到 3 分，而接受门槛是 6 分；大量短篇工具、项目和资源介绍
也没有可复用的结构信号。这是规则覆盖缺口，不应靠强制填入 `other` 或降低全部分类门槛解决。

## 决策

1. M2-P2G-A 将确定性分类规则升级为 v3。明确的教程、分析、解释、公告、观点、经历、访谈和
   文学体裁词在正文中即可达到最低门槛；较弱的泛化词仍不足以单独赋型。
2. 短于 2,400 Unicode code point、同时包含公开链接和工具/项目/软件/资源语义的 Entry 可判为
   `factual_material`。显式教程、分析、公告、观点、经历、访谈或文学信号会削弱该资源卡候选，
   防止“只要有链接就算资料”。分类器继续永不自动写入 `other`。
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

## 实施后只读评测

在所有者已运行的本地 PostgreSQL 18.6 私人部署上，对 10,715 条公开且当前类型为空的 Entry 进行
一次内存只读评估；没有调用 adjudication ensure、Entry revision 或 enrichment writer，也没有输出
正文、标识或来源。使用默认 Profile v0 时，v3 可为 6,028 条给出高置信度类型，覆盖缺失集合的
56.26%；若随后获授权应用，总覆盖预计由 4,195 / 14,910（28.14%）提升到
10,223 / 14,910（约 68.56%）。

候选分布为：`factual_material` 5,717、`knowledge_explanation` 79、`operating_guideline` 48、
`investigation_analysis` 57、`argument` 51、`personal_experience` 20、`interactive_collaboration` 10、
`public_communication` 36、`literary_creation` 10。剩余 4,687 条中，3,968 条无信号、628 条低于
门槛、89 条平局、2 条领先幅度不足。该结果是应用前容量与抽样计划依据，不是已写入状态或精度
验收；资源卡占比高，因此正式 apply 前仍应使用 preview 稳定样本做人工抽查。
