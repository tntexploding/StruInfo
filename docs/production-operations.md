# StruInfo 生产运行与维护

- 状态：`v0.1.0` 已发布；所有者确认私人云端 Docker 实例已上线；P5A–D 工程边界已完成，实际生产记录继续外置
- 最近更新：2026-09-05（维护基线、升级与实际运行交接）
- 决策：[ADR 0045](adr/0045-operational-production-baseline.md)、[ADR 0046](adr/0046-codex-operated-bulk-ingestion.md)、[ADR 0053](adr/0053-real-scale-capacity-classification-and-query-follow-up.md)、[ADR 0062](adr/0062-production-release-identity-and-live-deployment-baseline.md)、[ADR 0063](adr/0063-backup-recoverability-and-retention-preview.md)、[ADR 0064](adr/0064-operational-health-capacity-and-alerting.md)、[ADR 0065](adr/0065-production-flow-release-regression.md)

本轮维护阶段的执行清单与结果见[维护交接](maintenance-handoff.md)。当前维护版本为 `v0.2.0`；
后文 `v0.1.0` 数字属于历史发行证据。常规运行保持 `all` 单实例，维护写操作与备份/恢复
使用停写窗口；不要把角色启动脚本的存在解释为已支持多个独立进程并发修改同一偏好文件。

## 1. 适用范围

本手册面向一个所有者、一个外部 PostgreSQL 18 数据库和一个持久外部数据根。它覆盖构建、
迁移、队列 schema、runtime 权限、预检、启动、健康、备份、空库恢复和前向升级。

它不宣称已经完成公共 HTTP 服务、多用户隔离、云编排、自动保留策略、跨 workspace 克隆或
非空合并。项目代码采用 MIT License；第三方材料继续遵循各自许可证和声明。

本地与云端部署都按私人服务处理：Compose 默认只发布宿主回环地址，远程访问应使用带 HTTPS
和单用户认证的宿主反向代理、VPN 或 SSH 隧道，不直接开放应用端口。GitHub、RSS/Atom、声明式 API、受限网页、
受信任连接器和显式 OpenAI 能力是受控公网出站，不是公网入站；未配置的能力不得自行联网。

## 2. 外部状态

操作员在仓库和镜像之外准备：

- PostgreSQL 18 数据库，以及已有的 `struinfo_tm2_migrator`、`struinfo_tm2_runtime` 角色；
- 只含非秘密值的 runtime 配置文件，可从
  `deploy/runtime.container.env.example` 复制到外部位置；
- runtime 与 migrator 两个独立、只读、单行数据库 URL secret 文件；
- 一个持久绝对数据根，容器内固定挂载为 `/var/lib/struinfo`。

数据库 URL 必须使用一个明确的 DNS 名称或 IP 地址。容器中的 `localhost` / `127.0.0.1`
只指向应用容器本身；外置 PostgreSQL 应使用容器可达的主机名、私网地址或编排服务名。
当前驱动边界固定 `ssl=false`，因此仅适用于同机或受信任私网。跨不可信网络部署必须先在
外层提供 TLS 隧道/代理，或另行接受 PostgreSQL TLS 配置边界。

普通应用只能读取 runtime secret。迁移和队列准备只在显式组合
`compose.maintenance.yaml` 时获得 migrator secret。OpenAI key 如需启用，可通过
`OPENAI_API_KEY` 或 `OPENAI_API_KEY_FILE` 注入；两者不得同时提供。

## 3. 首次部署和升级顺序

Dockerfile 已把 Node 24 bookworm-slim 固定到不可变多架构 digest。首次依赖安装可由受控构建主机访问包注册表并执行仓库供应链策略；随后的源码构建和生产依赖组装均关闭网络，只从同一构建阶段已经验证的共享冻结锁文件与本地 pnpm store 裁剪精确版本。离线 deploy 仅信任这份刚验证的锁文件，不解析新版本，并排除应用未使用的可选平台适配包；运行容器不需要访问包注册表。先构建镜像并解析配置：

```powershell
docker compose -f compose.production.yaml build
docker compose -f compose.production.yaml config --quiet
docker compose -f compose.production.yaml -f compose.maintenance.yaml --profile maintenance config --quiet
```

把以下变量指向外部绝对路径：

```text
STRUIINFO_RUNTIME_CONFIG_FILE
STRUIINFO_DATA_ROOT
STRUIINFO_RUNTIME_DATABASE_URL_SECRET_FILE
STRUIINFO_MIGRATION_DATABASE_URL_SECRET_FILE
```

目标 Linux 上应预先创建数据根，并保证容器用户 `10001:10001` 可以读写该目录；runtime
配置和 secret 文件只需该用户可读。不要用仓库目录、镜像层或临时容器文件系统替代持久数据根。

随后按固定顺序执行：

```powershell
docker compose -f compose.production.yaml -f compose.maintenance.yaml --profile maintenance run --rm migrate
docker compose -f compose.production.yaml -f compose.maintenance.yaml --profile maintenance run --rm prepare-queue
```

数据库所有者再用 `psql` 应用
`deploy/postgresql/apply-runtime-grants.sql`。该脚本故意不创建角色、不设置密码，也不属于普通
应用容器。然后运行：

```powershell
docker compose -f compose.production.yaml --profile maintenance run --rm preflight
docker compose -f compose.production.yaml up -d app
docker compose -f compose.production.yaml ps
```

升级时先停止应用写入并完成备份，再重复“迁移 → 队列准备 → grant → preflight → 启动”。
迁移只前进，不自动向后执行 DDL。

## 4. 本机非容器命令

同一边界也可在仓库内运行。先设置 `STRUIINFO_CONFIG_PATH`，再通过直接变量或互斥的文件变量
提供秘密：

```powershell
$env:STRUIINFO_MIGRATION_DATABASE_URL_FILE = 'D:\external\secrets\migrator.url'
corepack pnpm run db:migrate
corepack pnpm run db:prepare-queue

$env:DATABASE_URL_FILE = 'D:\external\secrets\runtime.url'
corepack pnpm maintenance preflight
corepack pnpm maintenance backup
corepack pnpm run start:all
```

`start:all` 直接从 TypeScript 源码启动，适合本地调试。执行 `corepack pnpm run build` 后，
可用 `corepack pnpm run start:all:built` 从与容器相同的编译产物启动。需要拆分角色时使用
`start:api`、`start:scheduler` 和 `start:worker`。前台进程按 `Ctrl+C` 触发优雅关闭。
这些启动脚本和本手册都不要求把 URL 或个人路径提交到 Git。

### 4.1 M2-P0A–P0G Codex 批量入库

这组命令只把尚未拥有当前 Entry 结构的 Snapshot 按确定性 section 规则批量物化。先以唯一、稳定的操作键冻结计划：

```powershell
corepack pnpm maintenance ingest plan --key m2-p0a-20400101 --scope public_only --limit 500
```

命令返回 `batchId` 后，分窗口执行并检查状态：

```powershell
corepack pnpm maintenance ingest run --batch <batchId> --max-items 100
corepack pnpm maintenance ingest status --batch <batchId>
corepack pnpm maintenance ingest report --batch <batchId>
```

需要停止时执行 `ingest pause`；当前 Snapshot 事务结算后批次进入 paused。继续 pending 项用 `resume`，只重置 failed/中断项用 `retry`：

```powershell
corepack pnpm maintenance ingest pause --batch <batchId>
corepack pnpm maintenance ingest resume --batch <batchId> --max-items 100
corepack pnpm maintenance ingest retry --batch <batchId> --max-items 100
```

`scope` 只接受 `public_only`、`include_private` 或 `private_only`。计划最多 500 个 Snapshot、50,000 个 Entry；报告只输出身份、计数、状态和稳定错误码。它不执行标签、联系、Provider 调用或正文导出。若计划后同一 Snapshot 已从其他入口生成 Entry，该分片以结构冲突失败，不会覆盖既有结构。

P0A 批次成功后，P0B 在同一批次上执行本地确定性标签和增量联系。每次最多处理一个有界窗口；失败后可继续未完成项，或只重试失败项：

```powershell
corepack pnpm maintenance ingest enrich --batch <batchId> --max-items 100
corepack pnpm maintenance ingest enrich-status --batch <batchId>
corepack pnpm maintenance ingest enrich-report --batch <batchId>
corepack pnpm maintenance ingest enrich-resume --batch <batchId> --max-items 100
corepack pnpm maintenance ingest enrich-retry --batch <batchId> --max-items 100
```

标签以一个 Snapshot 为原子修订分片；内容关键词和唯一高置信度类型/领域分类在同一 Entry revision
写入。规则关闭、无确定性候选、关键词容量已满或分类仍不确定会进入只含身份和稳定代码的异常队列。
联系只重建至少一个端点属于当前批次窗口的可重建 projection，pair override 与正式知识关系不被
覆盖。这里不调用 Provider，也不输出正文。

部署新的确定性规则后，已经 succeeded 的旧批次不会自动重写。显式刷新一个批次，并以有限窗口
继续处理：

```powershell
corepack pnpm maintenance ingest enrich-refresh --batch <batchId> --max-items 100
corepack pnpm maintenance ingest enrich-resume --batch <batchId> --max-items 100
corepack pnpm maintenance ingest enrich-status --batch <batchId>
```

refresh 只重置规则摘要已经变化的成功项，并先删除这些项对应的旧异常和当前裁决；人工/AI/导入
分类、pair override、Evidence 和不受影响的成功项保持不变。没有规则摘要变化时命令不应伪造新工作。

P0B 全部成功后，先查看异常汇总，再按 closed code、状态和 current/stale 范围抽取最多 100 个稳定样本：

```powershell
corepack pnpm maintenance ingest exceptions-summary --batch <batchId>
corepack pnpm maintenance ingest exceptions-sample --batch <batchId> --code no_deterministic_tags --status pending --scope current --limit 20
```

样本只返回 Snapshot/Entry/revision 身份、隐私事实、异常代码和当前状态。需要阅读内容时，使用现有 Query/Tags 页面按 Entry ID 查看；maintenance 不输出正文。确认整组后，把汇总中刚观察到的 current pending 数作为 `expected-count`：

```powershell
corepack pnpm maintenance ingest exceptions-adjudicate --batch <batchId> --code no_deterministic_tags --from pending --to accepted --expected-count <count>
```

`to` 可选 `accepted`、`manual_review`、`deferred` 或用于重新打开的 `pending`。实际数量、原状态或 Entry revision 已改变时命令返回 `stale` 且整组不写入；过期异常只能查看，不能被批量裁决。裁决状态不修改 Entry、标签、联系、图谱或 AI 提案。

当前开发周期需要 Codex 阅读疑难内容时，不再逐条打开浏览器。普通 P0E 异常仍按 1–20 条导出到
外部数据根 `exports/codex-work/`，同时创建一个默认无效的结果模板：

```powershell
corepack pnpm maintenance ingest review-export --batch <batchId> --code no_deterministic_tags --limit 20
```

M2-P2E 对四类残余分类异常提供最多 100 条的分组工作包。建议先处理只缺一个维度的组，再处理需要
完整判断的组：

```powershell
corepack pnpm maintenance ingest review-export --batch <batchId> --code classification_type_missing
corepack pnpm maintenance ingest review-export --batch <batchId> --code classification_domain_missing
corepack pnpm maintenance ingest review-export --batch <batchId> --code classification_tied
corepack pnpm maintenance ingest review-export --batch <batchId> --code classification_no_signal
```

这四个命令默认 `--limit 100`；也可显式降低。结果模板已经带入现有内容关键词、类型和领域，
只需把 `action` 改为 `annotate` 并替换缺失维度的 `replace_me`。若选择 `accept`、
`manual_review` 或 `deferred`，必须删除该项的 `annotation`。

默认只处理公开 Entry。只有本次确实需要在本机审阅隐私内容时才显式追加
`--include-private true`。终端只打印 packet ID、文件名、摘要和数量，不打印正文。Codex 编辑
`<packetId>.codex-result.json` 后，用 packet ID 回写：

```powershell
corepack pnpm maintenance ingest review-apply --packet <packetId>
```

每项动作只接受 `annotate`、`accept`、`manual_review` 或 `deferred`。模板中的 `replace_me`、缺项、
额外字段、过期 Entry/adjudication revision 或内容摘要不匹配都会整包拒绝。`annotate` 写入完整三维
标签、关闭对应异常并只重建涉及这些 Entry 的可替换联系；重复执行同一结果不会追加重复 revision。
结果成功回写后可以人工删除对应两个临时文件，数据库与完整个人数据备份不依赖它们。

M2-P2G 应先预览，再执行有限窗口补全。v4 只接受明确体裁和事实资料信号；普通链接资源卡会保留给
Codex/人工复核，不以覆盖率为由自动赋型。预览只输出计数、类型/原因分布和最多 50 个稳定 Entry ID
样本，不输出正文、标题或来源：

```powershell
corepack pnpm maintenance ingest type-completion-preview --batch <batchId> --scope public_only --sample-limit 20
```

`nextAction=apply_type_completion` 表示当前规则能够安全补一部分空类型。先人工检查分布和样本，再在
已停写且备份成功后执行：

```powershell
corepack pnpm maintenance ingest type-completion-apply --batch <batchId> --max-items 100 --sample-limit 20
```

该命令根据批次当前状态自动选择 run/resume/retry/refresh，只补空类型，不覆盖已有人工、AI、导入
或先前规则结果。`continue_apply` 表示继续下一有限窗口；`export_codex_review` 表示高置信度规则已经
用尽，应改用上面的 P2E 分类工作包；`none` 才表示当前类型补全链闭合。不要通过反复运行把未解决项
强制写为 `other`。apply 严格继承批次原隐私范围；预览私密范围也必须由当前操作显式选择。

#### M2-P4R 类型学习恢复参考（当前冻结）

> **状态：已冻结，当前不要执行。** 实际标注未通过泛化质量验收，类型学习问题已重新排入
> `M2-P4R`。以下命令只保留为将来恢复工作的操作参考；当前不要继续 export/apply/activate。
> 已经生成的结果模板应保持不可导入，不得据此激活模型或补写 Entry。

如果所有者以后明确恢复 `M2-P4R`，类型学习仍是独立于 Entry 正式写入的校准流程。恢复后的单轮只使用
公开范围和一个最多 100 项的工作包；`apply` 只把明确接受的判断保存为外部 Profile 可信样本并训练
影子候选，不修改 Entry。不要在同一轮中直接串联 `activate` 或类型补全写入。

P4E 的工作包仍保持最多 100 项，但每类训练最多 64 条时会优先保留既有模型的错误、无信号、低分和
低 margin 样本，再补 Snapshot 多样性。正文只在本地有界提取词项、相邻短语和字符 trigram；单一
Snapshot 中出现的偶然词不会形成模型权重。

恢复后先确认 maintenance 环境可用，再导出一个新包：

```powershell
corepack pnpm maintenance preflight
corepack pnpm maintenance type-learning export --include-private false --limit 100
```

命令只在外部数据根 `exports/codex-work/` 创建 packet 和默认无效的 result 模板。packet 中的
`targetTypeKeyword` 用于提示当前类别支持缺口或模型候选，不是答案，不能照抄为可信判断。逐项阅读
`titlePath`、`body` 和 `contentKeywords`，按材料的主要表达目的选择一种类型，而不是按主题选择：

| 类型值                      | 判断口径                                         |
| --------------------------- | ------------------------------------------------ |
| `factual_material`          | 以数据、事实记录、资料汇总或客观报道为主要内容   |
| `knowledge_explanation`     | 解释概念、原理、机制或已有知识                   |
| `operating_guideline`       | 给出教程、步骤、用法、操作方法或明确规范         |
| `investigation_analysis`    | 基于材料调查现象、事件、产品或问题并展开分析     |
| `argument`                  | 主要提出观点、评价、论证、结论或主张             |
| `personal_experience`       | 主要记录第一人称经历、体验、回顾或感受           |
| `interactive_collaboration` | 主要是问答、讨论、协作过程或互动记录             |
| `public_communication`      | 主要是公告、采访、演讲、发布说明或面向公众的传播 |
| `literary_creation`         | 主要是小说、诗歌、散文或其他文学创作             |

主题交叉时只选主要表达目的；正文过短、上下文不足、多个类型同等成立或无法稳定复述理由时使用 `reject`。
`other` 不是可学习标签，也不得为了完成数量而强行选择最接近的类型。Codex 确认的项目使用以下精确结构，
并保留三个 identity 字段原值：

```json
{
  "entryId": "原样保留",
  "entryRevision": 1,
  "entryRevisionId": "原样保留",
  "action": "trust",
  "typeKeyword": "knowledge_explanation",
  "authority": "codex_accepted"
}
```

无法确认的项目必须删除模板中的 `typeKeyword` 和 `authority`，只保留：

```json
{
  "entryId": "原样保留",
  "entryRevision": 1,
  "entryRevisionId": "原样保留",
  "action": "reject"
}
```

所有项处理完成且没有 `replace_me` 后，用导出报告中的 packet ID 导入结果：

```powershell
corepack pnpm maintenance type-learning apply --packet <packetId>
```

检查返回的 `evaluation`，确认 `crossValidationFoldCount=3`、`targetPrecisionBasisPoints=9200`，再看
`supportedClassCount`、全局和逐类 precision/coverage、每类可信样本与 Snapshot 数，以及 `projection`
的总体 coverage、类别数和最大单类占比。`confusionMatrix` 统计每个预期类型到预测类型或
`unassigned` 的数量；`misclassifications` 最多列出 64 个误判 Entry/revision/Snapshot 身份、分数和
margin，不含正文，可直接作为下一轮复核重点。`activationEligible=false` 表示继续导出下一轮类别均衡
或困难样本，不是失败；后一次 export 会根据刚保存的支持缺口和当前模型不确定性重新取样。`stale`
表示 Profile 或 Entry revision 已变化，应丢弃旧包并重新导出，不能手改 revision 或摘要绕过。

只有候选明确返回 `activationEligible=true`、分布符合预期并经所有者决定后，才单独执行：

```powershell
corepack pnpm maintenance type-learning activate --expected-revision <profileRevision>
```

激活仍不会改写现有 Entry；它只允许后续确定性分类在强规则未解决时使用该模型。正式补全必须另行
预览并通过既有 P2G 原子 writer 执行。packet、result、Profile、备份和真实正文都只保留在外部数据根，
不得复制进 Git、测试夹具、日志或应用制品。

P0G 提供推荐的统一入口。它每次最多推进 1–500 项，严格按 P0A → P0B → P0C 顺序运行，并
返回下一动作而不是在一个进程内无限循环：

```powershell
corepack pnpm maintenance ingest pipeline-start --key m2-p0g-20400101 --scope public_only --limit 500 --max-items 100
corepack pnpm maintenance ingest pipeline-advance --batch <batchId> --max-items 100
corepack pnpm maintenance ingest pipeline-status --batch <batchId>
```

`nextAction=advance` 表示继续执行下一窗口，`wait` 表示当前阶段仍在运行或等待显式恢复，
`export_review_packet` 表示用上述 P0E 命令处理疑难项，`none` 才表示当前批次闭合完成。P0G 只是
现有服务的薄编排，不替代各阶段的 pause/resume/retry，也不表示真实语料质量或生产 SLO 已通过。

无真实资料的核心吞吐工具可直接运行：

```powershell
corepack pnpm exec tsx tools/run_m2_p0b_performance.ts
```

该工具只测内存中的确定性标签与增量联系规则；不包含 PostgreSQL、Blob、事务、恢复、Codex 操作或异常复核，因此不能作为 15,000 Entry / 4–6 小时端到端验收。

M2-P0D 提供不接触现有数据库或所有者资料的一次性 PostgreSQL 18 完整链演练。需要 Docker
Desktop/daemon 可用并能使用固定 `postgres:18.6` 镜像。快速 smoke 与标准 15,000 Entry
工作负载分别为：

```powershell
corepack pnpm run performance:m2-p0d -- --smoke
corepack pnpm run performance:m2-p0d -- --full
```

工具创建随机命名的 disposable 容器、随机本地端口和临时外部数据根，执行 30 份迁移、queue
准备、runtime grant、合成 Evidence 导入、P0A/P0B 故障恢复及 P0C 裁决，然后独立核对数据库
计数，并对当前读取快路径与完整路径执行同一合成数据上的结果对照。报告 v4 保留读取返回行数、耗时和采样 RSS，并增加增量索引恢复、单项更新、向量复用、失败重试、并发/隐私保护和完整修复的实际装载量与合成 Provider 输入数量。附加验证耗时单独记录，计数之后的扰动只作用于合成当前态。
成功或失败都必须移除容器和临时数据根；报告不得包含 URL、密码、正文或宿主个人路径。
标准记录结果为 500 Snapshot / 15,000 Entry，约 15 分 20 秒。该命令不属于普通 `verify`，
也不得连接已有 PostgreSQL 实例或作为生产 SLO。

日常索引维护见[交付与操作记录](incremental-index-maintenance.md)。没有模型时刷新仍可完成文字索引；有模型时失败窗口保留文字结果和已提交进度。“读取状态”只观察数据库；页面关闭后不会继续发起下一批，重新打开后需要显式刷新。完整修复会重新生成全部公开向量，可能产生调用费用。

### 4.2 M2-P1/P2 真实规模升级顺序

M2-P1/P2 代码不会自动读取或改变现有外部工作区。升级已有批量入库结果时按以下顺序操作：

1. 停止写入；用 migration credential 执行 `db:migrate`，确认 `000029` 与 `000030` 已应用；
2. 重新应用 `deploy/postgresql/apply-runtime-grants.sql`，随后用 runtime credential 执行 preflight；
3. 保持停写，立即用新版本执行 `maintenance -- backup`，确认返回文件名、SHA-256、Blob 和行数；
4. 如需使用个人分类规则，先通过受支持的外部偏好边界保存并复核 Profile；对目标 batch 运行 `type-completion-preview`，检查分布与稳定样本后再以 `type-completion-apply` 有界推进；
5. 若补全结果返回 `export_codex_review`，按异常 code 使用 P2E 工作包处理剩余项，并用 P2F 标签页纠正少量误判；
6. 启动应用，在“查询”页的“搜索索引”执行“刷新变化项”；每批最多 32 项，可在本批后暂停并继续。配置了 Embedding 时只生成必要的公开向量；只有需要修复派生内容损坏时才打开“完整重建与修复”；
7. 复核文档总数、类型/领域覆盖率、主次领域数量、四类分类异常和查询延迟，最后在停写状态再生成一次正式 post-backup。

旧版入库前备份仍是恢复点；在第 3 步的新备份真实成功前，不得把容量代码通过描述成已经获得
post-backup。索引不完整时查询会回退完整加载，因此可用性优先于速度，但必须在第 5 步后重新测量。

容器中可复用已挂载 runtime secret 和数据根的 `preflight` 服务并覆盖命令，例如：

```powershell
docker compose -f compose.production.yaml --profile maintenance run --rm preflight node dist/entrypoints/maintenance.js ingest status --batch <batchId>
```

## 5. 健康与日志

- `/health/live`：进程存活；
- `/health/ready`：有界数据库 readiness；容器 healthcheck 使用该端点；
- 标准输出：现有 newline-delimited 结构化日志；不要把 URL、secret 或文档正文加入操作日志；
- 停止：向容器发送正常停止信号，Compose 给应用 30 秒优雅关闭窗口。

readiness 失败时不要自动运行迁移或扩大 runtime 权限。先查看迁移、queue schema、数据库角色、
外部数据根和只读挂载是否按本手册配置。

M2-P5C 增加一个适合宿主 scheduler/monitor 调用的脱敏状态命令：

```powershell
docker compose -f compose.production.yaml --profile maintenance run --rm preflight node dist/entrypoints/maintenance.js status
```

默认在最新备份超过 168 小时、外部数据根可用空间低于 10%、ProcessingRun 连续运行超过 60 分钟，
或发现数据库/索引/失败任务/观测异常时返回 `attention` 并退出 1。需要不同阈值时只在外部调度配置中
显式传入 `--max-backup-age-hours`、`--minimum-free-percent` 和 `--max-running-age-minutes`。报告不含
路径、URL、secret 或正文。当前应用不内置远程通知；外部系统应把非零退出和稳定 alert code 转发到
所有者选择的告警渠道。

## 6. 云端 HTTP 反向代理

`compose.production.yaml` 必须继续把应用映射为
`127.0.0.1:${STRUIINFO_HTTP_PORT}:3000`。公网只开放宿主代理的 `80/443`；不要开放应用端口、
PostgreSQL 端口或数据根。`deploy/reverse-proxy/Caddyfile.example` 提供 Caddy 示例：公共侧使用
HTTPS 和 Basic Auth，内部以普通 HTTP 转发到回环应用。认证覆盖 Web、API 和健康路径；宿主监控可直接读取回环健康端点。

上线前先完成域名 A/AAAA 记录。用交互式命令生成密码哈希，避免把明文密码写入 shell 历史：

```bash
caddy hash-password
```

把示例复制到仓库外的宿主配置，替换域名、ACME 邮箱、用户名、密码哈希和回环端口。配置文件只允许管理员读取。然后验证并重载：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

主机防火墙只开放必要的管理端口以及 `80/443`。先从宿主确认
`http://127.0.0.1:${STRUIINFO_HTTP_PORT}/health/ready`，再从远端确认未认证请求被拒绝、认证后的
首页/API 可用、证书链有效且响应带 HSTS。应用层已经发送 CSP、禁止嵌入、权限策略、
`nosniff` 和 `no-referrer`；HSTS 由终止 TLS 的代理发送。

此边界是单所有者认证，不是多用户账户系统。若需要 OAuth、公开 API、按用户授权或共享访问，必须先增加独立产品边界。

## 7. 备份与恢复

为形成清晰的一致性点，先停止应用写入，再执行：

```powershell
docker compose -f compose.production.yaml --profile maintenance run --rm backup
```

命令在外部数据根 `backups/` 下生成版本化 `*.personal-data.json`，当前闭合预算为 1 GiB / 3200 万
canonical JSON value。生产 Compose 为 app 提供 3 GiB 容器内存和 2 GiB Node heap，为 backup 和
restore 提供 6 GiB 容器内存和 4 GiB Node heap；preflight 等普通维护任务仍保持 1 GiB 配额。
不要删除或绕过这些生产规模资源档位，否则百万级 JSON value 的传输或万级 Entry 的公开索引
重建可能在闭合操作完成前因 JavaScript heap 不足退出。命令只输出文件名、字节数、
SHA-256、Blob 数和表行数。内容包括当前完整工作区数据库分区、引用 Blob 字节和外部偏好；
不包括运行配置、secret 或可重建的 pg-boss 内部队列表。

M2-P5B 提供三个只读动作。它们不要求数据库当前 ready，但仍读取同一外部 runtime config 中的
workspace ID 和数据根。先列出当前格式备份：

```powershell
docker compose -f compose.production.yaml --profile maintenance run --rm backup node dist/entrypoints/maintenance.js backup list --limit 20
```

选择一个安全文件名后完整校验。输出的 SHA-256、导出时间、Blob 数、表行数和
`personalDataIncluded` 应记入仓库外的运维记录；命令不会恢复或改写任何状态：

```powershell
$backupFile = 'backup-name.personal-data.json'
docker compose -f compose.production.yaml --profile maintenance run --rm backup node dist/entrypoints/maintenance.js backup verify --file $backupFile
```

决定保留数量前先预览。下面只显示结果，不删除文件；`keepLatest` 没有仓库默认值，应由所有者按容量、
异地副本和恢复目标决定：

```powershell
$keepLatest = 14
docker compose -f compose.production.yaml --profile maintenance run --rm backup node dist/entrypoints/maintenance.js backup retention-preview --keep-latest $keepLatest
```

预览最多回显 100 个拟移除文件名；`truncated=true` 时不能把显示出的子集当作完整清单。应用没有
prune/delete 命令。确认最近备份可读且至少一个独立副本存在后，才可在外部运维流程中删除精确文件；
不要用目录通配符删除，也不要处理预览未包含的其他 workspace、旧格式或无关文件。

恢复目标必须已经执行全部迁移和队列准备，workspace ID 必须相同，业务工作区必须为空。
设置安全文件名后运行：

```powershell
$env:STRUIINFO_RESTORE_FILE = 'backup-name.personal-data.json'
docker compose -f compose.production.yaml --profile maintenance run --rm restore
```

恢复成功后重新运行 preflight，再启动应用。任何非空目标、损坏文件、缺失 Blob 或身份不匹配
都会失败而不应被覆盖。需要回滚升级时，优先修复前向兼容问题；必须恢复时，创建干净数据库
和数据根、应用同版本 schema 后恢复备份，再切换外部配置。不要在原非空工作区上强制回滚。

一次受控恢复演练使用相同正式入口，不复制 restore 逻辑：

1. 在停写状态创建新备份，执行 `backup list` 与 `backup verify`，记录版本、时间、SHA-256、Blob 数和表行数；
2. 把该文件复制到独立、受控的恢复位置，并准备隔离的空 PostgreSQL 18 数据库和空数据根；workspace ID 必须相同；
3. 对隔离目标依次执行全部迁移、queue 准备、runtime grant 和 preflight；
4. 将已验证文件放入隔离目标的 `backups/`，执行现有 `restore --file`；
5. 再次 preflight，启动隔离应用并检查 live/ready；随后创建并 verify 一份恢复后备份；
6. 原备份与恢复后备份的 Blob 数、表行数及关键页面计数应一致。导出时间不同会导致文件 SHA-256 不同，不能要求两份导出字节相同；
7. 在仓库外记录结果并清理隔离资源。失败时保留原生产实例和原备份，不在非空生产 workspace 上重试覆盖。

仓库中的合成测试和历史本地 Docker 演练只证明代码路径；云端具体文件名、摘要、策略和演练结论必须
来自该主机的外部运维记录。

## 8. 云端上线与持续复核

所有者已确认私人云端 Docker 实例投入使用。下面的检查项现在用于持续复核、升级和恢复准备，
不再表示服务尚未部署。这一历史确认不替代实际主机证据。本次 v0.2.0 收尾已独立核验本机 Docker 私人实例，
结果见[维护交接](maintenance-handoff.md)；其他主机及未检查项目仍不能据此填写为通过。

- 在目标容器宿主使用已核对的维护版本源码或镜像，记录不可变 commit、image digest、基础镜像材料和漏洞扫描；
- 复用本地已通过的 PostgreSQL 18.6 合成演练顺序，在云端 disposable 空库复核迁移、队列准备、grant、preflight、backup、空库 restore 和重启；
- 保持应用端口只绑定回环，按第 6 节配置 HTTPS、认证反向代理和宿主防火墙；
- 确认订阅/抓取/Provider 仅按显式配置出站，并决定备份保留、监控告警和资源预算；
- 确认是否以空工作区启动或恢复一份所有者明确指定的备份；代码部署不得隐式复制本地个人数据；
- 按 MIT License、第三方声明、依赖许可证和 SBOM 完成发行制品复核。

这些事项必须如实记录，但除非出现当前可达的产品阻断，不应重新演变为无休止的测试框架
强化循环。

2026-08-27 的本地发布演练已完成上述数据库操作链：Docker Desktop 上的官方 PostgreSQL
18.6 disposable 空库通过 25 份迁移、首次 pg-boss schema 准备、runtime grant、preflight、
回环健康、合成写入、完整个人数据备份、同 workspace 空库恢复和停止/重启。该结果用于缩短
云端操作。2026-08-28 的 `struinfo:0.1.0` 本地最终镜像 ID 为
`sha256:de269bec525745961f4fd5f3344391f6168a5ae00c5a80fdd29e031c8af96c6f`，Trivy 0.66.0
报告 HIGH 0、CRITICAL 0；这仍不表示云主机自身镜像、宿主防火墙、备份保留或告警已经完成。

## 9. M2-P5 生产收口结果

M2-P5A 已固定公开发行、当前开发和已上线实例的不同身份。M2-P5B 已提供备份盘点、完整只读校验、
无删除保留预览和受控恢复演练步骤。M2-P5C 已提供健康、容量、失败任务、搜索投影和备份年龄状态，
M2-P5D 已把一次性 PostgreSQL 18 合成回归贯穿到查询与知识读取。公共 `v0.1.0` 的源码树是
`6f02768158a9030b1332ea8dab4c1249dd66a68d`；后续 M2 开发线不是该发行版本，也不能仅凭 Git
推导云端正在运行的 commit 或镜像。

发行候选的开发回归顺序为：

1. `corepack pnpm run verify`；
2. `corepack pnpm run test:e2e`；
3. `corepack pnpm run performance:m2-p0d -- --smoke`；
4. 需要标准规模证据时再执行 `corepack pnpm run performance:m2-p0d -- --full`。

2026-09-03 的本地标准回归使用 PostgreSQL 18.6 完成 500 Snapshot / 15,000 Entry、30 份迁移
exact no-op 重放、两次受控故障恢复、15,000 个当前搜索投影、13,500 个词法匹配和 13 节点/12 边
知识图，总耗时约 18 分 9 秒；报告确认一次性容器与临时数据根已经清理。该数字是开发机器上的合成
证据，不是云端 SLO。

真实域名/IP、镜像 digest、证书、认证、防火墙、secret、数据库、数据根、个人数据、备份文件名和
告警目标都不得写回本手册或 Git。生产检查结果只记录脱敏状态、时间、版本身份和必要摘要。完成
上述开发回归不会自动创建发行、升级私人实例或恢复数据；这些动作必须由所有者明确启动。

## 10. v0.2.0 有限维护交接

2026-09-05，所有者授权本机 Docker 实例的真实备份、隔离空库恢复和升级。
恢复前后 Blob 数与表行数一致；恢复副本又通过命名查询重启、来源复核和引用导出。
正式实例已应用至迁移 000031，运行 v0.2.0 并通过健康、查询与精确来源只读检查。
本次未调用 Provider；演练写入只发生在隔离副本，内容与实际身份始终在仓库外。

镜像的基础系统扫描保留失败状态，已核对的不可达项见 [DH-013](deferred-hardening-memo.md#dh-013-base-image-scanner-findings-outside-the-current-runtime-path)。
不能将历史零告警结果或当前产品回归通过描述为本次镜像扫描通过。
巡检、备份调度、同机副本与离线限制以维护交接及外部运维记录为准。
