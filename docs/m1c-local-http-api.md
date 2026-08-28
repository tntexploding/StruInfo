# 当前本地产品 HTTP 接口

- 状态：M1K 活动接口
- 最近核对：2026-08-27
- 稳定性：本机产品接口；不是公共或第三方集成 API
- 实现真值：[当前项目状态与实现清单](current-project-state.md)

> 文件名保留 `m1c` 只是兼容命名。旧 Manual Curation、正式 Knowledge 写入/读取和旧 Knowledge 检索路由已从当前运行时删除。

## 1. 接口边界

本地 HTTP 层只连接当前可运行的 Evidence、InformationEntry、拆分前全文工作副本/派生 Snapshot、确定性/人工首次物化、Document 标签、Entry 联系、正式 Entry 图谱、确定性探索、精确 GitHub Markdown 信源订阅、Provider-neutral ProcessingRun、所有者控制的 Entry 路由执行、默认关闭的确定性标签/联系投影动作、可选 OpenAI Snapshot 拆分/Entry 标签/selected-pair 联系提案与公开 Query 证据综合、个人偏好和个人数据包用例。它不提供账户、多用户授权、Webhook、WebSocket、任意 URL 抓取、通用 AI 执行、自动接受、任意工作流或公共扩展 API。

当前工作区由包体外运行配置中的 `STRUIINFO_WORKSPACE_ID` 选择。请求不能提交或切换 `workspaceId`；服务端把固定工作区注入所有领域操作。切换资料集需要停止当前进程、替换外部配置或数据根并重新启动。

手动/Git Markdown 以 `sourceText` JSON 字符串提交；浏览器选择的本地 Markdown/文本/HTML/PDF 文件以 canonical `sourceBase64` 字符串逐份提交。两者恰好出现一个。原始和规范化字节写入外部内容寻址 Blob 根，PostgreSQL 只保存身份、摘要、定位和结构关系。接口不接受服务器文件路径，也不会把正文写入 Git、安装目录或日志。

所有产品路由位于 `/api/v1`，响应使用 `application/json`、`Cache-Control: no-store` 和 `X-Content-Type-Options: nosniff`。健康检查位于 `/health/live` 与 `/health/ready`。

## 2. 当前活动路由

| 方法   | 路由                                                                                  | 当前用途                                                                              |
| ------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/workspace`                                                                   | 返回固定工作区身份及实际启用的能力                                                    |
| `GET`  | `/api/v1/evidence`                                                                    | 列出当前 Evidence Snapshot 摘要                                                       |
| `GET`  | `/api/v1/evidence/snapshots/:snapshotId`                                              | 返回 Snapshot、完整规范正文、结构和 Fragment；隐私内容要求 `includePrivate=true`      |
| `GET`  | `/api/v1/evidence/snapshots/:snapshotId/working-copy`                                 | 读取原始全文及唯一当前草稿/已确认派生版本；隐私内容要求当次 opt-in                    |
| `PUT`  | `/api/v1/evidence/snapshots/:snapshotId/working-copy`                                 | 以期望修订保存唯一拆分前全文草稿；不修改原始 Evidence                                 |
| `POST` | `/api/v1/evidence/snapshots/:snapshotId/working-copy/restore`                         | 删除未确认草稿并恢复显示原始全文                                                      |
| `POST` | `/api/v1/evidence/snapshots/:snapshotId/working-copy/commit`                          | 确认草稿并通过既有 Evidence 边界生成不可变派生 Snapshot                               |
| `GET`  | `/api/v1/preferences/review`                                                          | 读取外部工作区的快捷标签、自动关键词开关/过滤、别名、联系和探索策略                   |
| `PUT`  | `/api/v1/preferences/review`                                                          | 整体保存当前偏好文件；未提交的版本化策略保持现值                                      |
| `GET`  | `/api/v1/source-subscriptions`                                                        | 读取外部版本化信源订阅、运行状态、成功游标和实际安装连接器 capability                 |
| `PUT`  | `/api/v1/source-subscriptions`                                                        | 以期望修订整体替换订阅配置；运行状态与游标由服务端维护                                |
| `POST` | `/api/v1/source-subscriptions/:subscriptionId/run`                                    | 使用 `requestKey` 检查订阅；变化时导入，并可按默认关闭开关确定性物化/分流             |
| `POST` | `/api/v1/imports/markdown`                                                            | 原子导入手动/Git Markdown 或本地 UTF-8 Markdown/文本文件、来源、Blob、结构和 Fragment |
| `POST` | `/api/v1/entries/materialize`                                                         | 从一个用户选择的空 Snapshot 按 section 规则原子生成 Entry                             |
| `POST` | `/api/v1/entries/materialize/manual`                                                  | 从标题和完整有序 Fragment 标量区间原子生成人工 Entry 结构                             |
| `GET`  | `/api/v1/entries/split-rules/profile`                                                 | 读取外部工作区当前版本化本地拆分规则                                                  |
| `PUT`  | `/api/v1/entries/split-rules/profile`                                                 | 以期望 revision 保存 section/相邻短段合并规则                                         |
| `POST` | `/api/v1/entries/split-rules/trial`                                                   | 对一个精确 Snapshot 只读预览规则分组，不写 Entry                                      |
| `POST` | `/api/v1/entries/split-rules/apply`                                                   | 以当前保存规则 revision 重新计算并原子物化空 Snapshot                                 |
| `POST` | `/api/v1/entries/restructure/preview`                                                 | 对已物化 Snapshot 的完整新分组生成只读影响预览                                        |
| `POST` | `/api/v1/entries/restructure/apply`                                                   | 以预览摘要和显式确认原子替换当前 Entry 结构                                           |
| `GET`  | `/api/v1/evidence/snapshots/:snapshotId/split-proposals`                              | 列出一个 Snapshot 的有界拆分提案                                                      |
| `POST` | `/api/v1/evidence/snapshots/:snapshotId/split-proposals/start`                        | 用户显式请求一个公开 Snapshot 的 OpenAI 拆分提案                                      |
| `POST` | `/api/v1/evidence/snapshots/:snapshotId/split-proposals/:proposalId/accept`           | 接受提案并从本地 Fragment 物化 Entry                                                  |
| `POST` | `/api/v1/evidence/snapshots/:snapshotId/split-proposals/:proposalId/reject`           | 拒绝提案且不创建 Entry                                                                |
| `PUT`  | `/api/v1/entries/:entryId`                                                            | 以期望版本更新当前 Entry 成品态                                                       |
| `POST` | `/api/v1/entries/search`                                                              | 查询 Entry，并在显式隐私范围下返回独立完整私密文档通道                                |
| `GET`  | `/api/v1/entries/search/index`                                                        | 读取当前工作区可重建词项/向量索引状态                                                 |
| `POST` | `/api/v1/entries/search/index/rebuild`                                                | 显式原子重建当前公共 Entry 的词项和可选向量投影                                       |
| `POST` | `/api/v1/entries/search/index/evaluate`                                               | 用有界显式 expected-set 计算语义/混合 Recall@K 与 MRR                                 |
| `POST` | `/api/v1/entries/search/synthesize`                                                   | 显式综合当前公开确定性 Query 证据；答案只属于本次页面会话                             |
| `POST` | `/api/v1/entries/exploration/candidates`                                              | 从选定 Entry 的当前可见直接联系生成独立页外探索候选                                   |
| `PUT`  | `/api/v1/entries/exploration/policy`                                                  | 以期望修订保存外部探索开关、页额份额和三类候选开关                                    |
| `GET`  | `/api/v1/entries/automation/policy`                                                   | 读取当前 AutomationPolicy 及其绑定 Profile 摘要                                       |
| `PUT`  | `/api/v1/entries/automation/policy`                                                   | 以期望修订保存启停、暂停、阈值、预算和两个默认关闭的推进动作                          |
| `POST` | `/api/v1/entries/automation/trial`                                                    | 对草稿策略执行只读路由试算并应用显式人工接管                                          |
| `POST` | `/api/v1/entries/automation/runs`                                                     | 用幂等键和精确修订账本显式启动一次持久路由执行                                        |
| `GET`  | `/api/v1/entries/automation/runs?limit=`                                              | 列出最近 1–20 个 typed 自动路由运行及 claims                                          |
| `GET`  | `/api/v1/entries/automation/runs/:runId`                                              | 读取一个精确自动路由运行及 claims                                                     |
| `GET`  | `/api/v1/entries/automation/work-queue?includePrivate=`                               | 读取成功 claim 派生的隐私过滤所有者工作队列                                           |
| `PUT`  | `/api/v1/entries/automation/work-queue/:runId/:claimOrdinal`                          | 以期望版本完成、跳过或重新打开一个工作项                                              |
| `POST` | `/api/v1/entries/automation/work-queue/:runId/:claimOrdinal/action`                   | 以动作期望版本续跑或安全撤销获授权的确定性推进动作                                    |
| `GET`  | `/api/v1/entries/:entryId/tag-proposals`                                              | 列出一个 Entry 的有界 tags 提案                                                       |
| `POST` | `/api/v1/entries/:entryId/tag-proposals/start`                                        | 用户显式请求一个公开 Entry 的 OpenAI 标签提案                                         |
| `POST` | `/api/v1/entries/:entryId/tag-proposals/:proposalId/accept`                           | 接受提案并通过现有 Entry revision 保存标签                                            |
| `POST` | `/api/v1/entries/:entryId/tag-proposals/:proposalId/reject`                           | 拒绝提案且不修改 Entry                                                                |
| `PUT`  | `/api/v1/entries/associations/policy`                                                 | 以期望修订保存外部联系权重/阈值并返回当前策略                                         |
| `POST` | `/api/v1/entries/associations/rebuild`                                                | 按当前 Entry 与当前外部策略重建可替换关联投影                                         |
| `GET`  | `/api/v1/entries/:entryId/associations`                                               | 读取一个 Entry 的可见联系、分项得分和人工控制                                         |
| `PUT`  | `/api/v1/entries/:entryId/associations/:relatedEntryId`                               | 追加增强、削弱、屏蔽或恢复控制                                                        |
| `POST` | `/api/v1/knowledge-graph/view`                                                        | 选择最高匹配或指定中心，并读取隐私过滤后的有界 Entry 图谱                             |
| `PUT`  | `/api/v1/knowledge-graph/edges/:entryId/:relatedEntryId`                              | 修改、隐藏、恢复自动边，或创建用户关系                                                |
| `GET`  | `/api/v1/knowledge-graph/edges/:entryId/:relatedEntryId/proposals`                    | 列出当前 Entry 对的有界 AI 联系提案                                                   |
| `POST` | `/api/v1/knowledge-graph/edges/:entryId/:relatedEntryId/proposals/start`              | 用户显式请求两个公开 Entry 的 OpenAI 联系提案                                         |
| `POST` | `/api/v1/knowledge-graph/edges/:entryId/:relatedEntryId/proposals/:proposalId/accept` | 人工接受提案并通过现有 graph edge command 保存                                        |
| `POST` | `/api/v1/knowledge-graph/edges/:entryId/:relatedEntryId/proposals/:proposalId/reject` | 拒绝提案且不修改图谱                                                                  |
| `GET`  | `/api/v1/entry-documents`                                                             | 读取 Document、Entry 数量和当前文档标签                                               |
| `POST` | `/api/v1/entry-documents/:snapshotId/tags/aggregate`                                  | 从当前 Entry 确定性聚合文档标签                                                       |
| `PUT`  | `/api/v1/entry-documents/:snapshotId/tags`                                            | 保存人工文档标签当前态                                                                |
| `GET`  | `/api/v1/processing-runs?limit=`                                                      | 列出最近 1–100 个真实 ProcessingRun 及有界提案信封                                    |
| `POST` | `/api/v1/processing-runs/:runId/cancel`                                               | 以 `expectedVersion` 取消 queued/running 任务                                         |
| `POST` | `/api/v1/workspace-bundles/export`                                                    | 将当前工作区个人数据写入外部 `exports/`                                               |
| `POST` | `/api/v1/workspace-bundles/restore`                                                   | 从安全文件名恢复同 ID 的空工作区                                                      |

API/`all` 运行角色装配产品路由并提供 `apps/web/dist` 的同源单页应用。`scheduler`/`all` 角色还运行顺序且非重叠的到期订阅检查；worker 只提供健康路由。订阅能力只代表精确 GitHub Markdown、公开 RSS/Atom、声明式 JSON API、受限同源网页和实际安装的受信任连接器，不表示通用自动采集或开放爬虫。ProcessingRun 读取/取消是独立任务状态边界；OpenAI split、tags、selected-pair association 与 Query synthesis 只在 API/`all` 且配置完整时装配。确定性探索始终是本地无 Provider 读路径。

## 3. 五步主线如何调用接口

### 3.1 导入

`POST /imports/markdown` 接收：

- `commandIdempotencyKey`；
- `sourceText` 或 `sourceBase64`，恰好一个；`sourceBase64` 只允许搭配 `resourceKind: "uploaded_file"`；
- 带服务端固定工作区覆盖的 `resource`、`snapshot` 和 `gitObservations`；
- 可选 `gitResource`、`profile` 与 `documentBaseUri`。

Web 页面负责把来源别名、链接、日期、Git 身份、隐私标记和正文前置文字映射到这些字段。本地文件默认使用基础文件名加 SHA-256 作为 portable source key，不提交目录路径；无前置文字时 Base64 解码后的字节保持原样。相同命令可重放；同键异内容返回冲突。M1H-5 批次队列仍按顺序逐份调用同一 `/imports/document`，没有批次请求体；失败项重试同一请求身份，成功后只统一刷新页面列表。

三个 `/source-subscriptions` 操作管理闭合的 `github_markdown`、`rss_atom`、`json_api`、`web` 和 `plugin` union。GET 返回 revision、可编辑字段、服务端维护的 last-attempt/last-success/run/cursor，以及当前实际安装连接器 capability；PUT 接受 `{expectedRevision, subscriptions}`，每项必须完整给出稳定 UUID、标签、enabled、类型配置、profile、sourceAlias、isPrivate、默认关闭的 `routeAfterImport` 和 15–10080 分钟间隔，不能伪造运行字段。Web 配置只含一个公开 HTTPS `pageUrl` 和最多七个 root-relative 同源路径；plugin 配置只含 `plugin.*` connector ID 与 opaque `configurationRef`。POST 只接受 `{requestKey}`；即使 enabled 为 false 也可手动运行。

每次运行先建立 import 阶段 ProcessingRun，再由所选 reader 返回 unchanged 或有界 changed documents。变化文档调用同一个 Evidence import；相同内容只推进 connector cursor，不重复生成 Snapshot。`routeAfterImport=false` 时在导入后结束；明确开启后，服务端继续复用确定性 section Entry 物化和现有可恢复自动路由，返回 automation run ID 与各 Snapshot 的 Entry 数。若 AutomationPolicy 另外显式启用 M1H 推进动作，确定性标签和可替换联系投影也必须完成后才能推进成功 cursor；失败保留旧 cursor以便幂等重试。`source_subscriptions` capability 本身不允许开放 URL 抓取、链接发现、仓库目录扫描、代码执行、AI 调用、图谱修改或提案接受；插件也没有数据库或游标写端口。

### 3.2 拆分

四个 `/evidence/snapshots/:snapshotId/working-copy` 操作只面向尚未拥有 Entry 的来源 Snapshot。GET 返回原始全文、当前全文、状态和 revision；PUT 接受 `{expectedRevision, includePrivate, text}`，只保存一份当前 UTF-8 草稿；restore 删除未确认草稿；commit 只确认已保存且版本匹配的草稿。确认后服务端用确定性身份和既有 CommonMark Evidence 导入创建新的不可变 `manual_text` Resource/Snapshot，继承来源 privacy/publication/capturedAt，并返回派生 Snapshot ID。原始 Blob/Snapshot/Fragment 不变，页面切换到派生 Snapshot 后继续使用以下既有拆分接口。草稿最大 1 MiB，不保存编辑历史；私密来源每次都要求 `includePrivate=true`。

`POST /entries/materialize` 接受 `snapshotId`、可选的 `chunkMode: "split"` 和 `includePrivate`。服务端读取已经导入的 CommonMark 结构，把 section 节点确定性转换为 Entry，并只在 Snapshot 尚无 Entry 时原子提交。

`POST /entries/materialize/manual` 接受：

- `snapshotId`；
- 明确布尔值 `includePrivate`；
- 非空 `groups`，每组包含 1–200 Unicode scalar 的 `titlePath` 和非空 `fragments`；每个输入显式给出 canonical `fragmentId` 以及半开 Unicode 标量区间 `startCodePoint` / `endCodePoint`。

所有区间展平后必须按来源顺序完整分割第一结构的全部 section Fragment：从零开始、相邻区间相接并在各 Fragment 标量长度处结束，不得缺失、重叠或重排。客户端不提交正文；服务端从本地 Fragment 区间重建每组正文，同一 Fragment 的相邻片段直接连接，不同 Fragment 之间保留两个换行，并记录 `struinfo.entry-split.manual-range.v1`。成功返回 `created` 或稳定重放 `existing` 及生成的当前 Entry。无效覆盖返回 `422/manual_split_invalid`；确定性、人工或已接受 AI 路径已先生成结构时返回 `409/split_structure_already_materialized`，已有 Entry 不变。

`POST /entries/restructure/preview` 面向已经存在当前 Entry 结构的 Snapshot。请求提交 `snapshotId`、明确的 `includePrivate`，以及可选的完整 `groups`；省略分组时服务端返回从当前精确 Fragment/标量区间重建的草稿。预览冻结当前 Entry、关系 override 和 Document 标签版本，并列出身份复用、successor lineage、标签/评分冲突、关系迁移、折叠与阻断冲突，但不写数据。

`POST /entries/restructure/apply` 重新提交同一完整 `groups`、预览返回的 `planSha256`，以及 `acknowledgeAnnotationChanges` / `acknowledgeRelationshipChanges`。服务端在工作区锁事务内重新验证摘要和版本，一次切换当前结构、写 successor/lineage、重算 Document 标签、迁移有资格的人工/AI 图关系并按当次隐私范围重建可替换联系投影。Snapshot/Fragment 不变，旧 Entry 不删除，只退出普通当前读取范围。过期预览、未确认影响、关系冲突或隐私范围不足分别返回 `stale_entry_restructure_preview`、`entry_restructure_annotation_ack_required`、`entry_restructure_relationship_ack_required`、`entry_restructure_relationship_conflict` 或 `entry_restructure_private_relationship_scope_required`；整笔事务失败时不留下部分结构。

四个 `/evidence/snapshots/:snapshotId/split-proposals` 路由提供列表、显式启动、接受和拒绝。start 只允许用户当前选择的公开、尚未物化 Entry 的 Snapshot；Provider 只收到按结构顺序排列的 section Fragment ordinal 与正文，不收到任何本地标识。响应是连续、不重叠、完整覆盖的闭合分组；界面用本地精确 Fragment 审阅。accept 从本地 Fragment 重建标题/正文并调用同一空 Snapshot Entry 物化边界，reject 不创建 Entry。私密 Snapshot 在 Blob 读取和 fetch 前拒绝。当前人工首次物化和后续结构纠错都支持 Fragment 内 Unicode 标量边界；AI 提案仍只处理尚未物化的公开 Snapshot，并以完整 Fragment 分组。来源重排和可替换拆分规则仍未实现。

### 3.3 标签

`PUT /entries/:entryId` 使用 `expectedRevision` 防止覆盖并提交：

- Entry 正文；
- 内容关键词；
- 类型关键词和可选自定义类型；
- 主/副领域关键词和可选自定义领域；
- 可选的有用程度与有趣程度 1–5 评分；
- 隐私 Entry 的当次 `includePrivate`。

文档级标签通过 aggregate 接口确定性重算，或通过 tags 接口人工覆盖。快捷标签、排除词、域名策略、已确认别名、联系策略和探索策略由 preferences 边界写入外部偏好文件，不进入数据库迁移、Git 或应用包。旧客户端不传 `associationPolicy` 或 `explorationPolicy` 时分别保留现值。

M1G-4C 的六个 `/entries/automation/*` 操作把外部 AutomationPolicy、M1G-4A 只读试算和 M1G-4B typed execution 接入同一 Tags 次级控制面。策略 PUT 必须提供 `expectedRevision` 并绑定当前 Profile revision；启用/禁用和暂停/恢复都是显式新修订。trial 接受草稿策略、当次隐私范围、可选 Entry 修订账本和人工接管 ID，只返回路由、原因和计数。run start 只接受已保存且 ready 的精确修订、幂等键和同一账本；列表/详情只返回运行、修订、route/reason/status 和时间，不返回正文、来源 Blob、请求摘要或幂等键。M1G-4D 明确规定列表只是摘要导航：Web 必须在用户选择后调用精确详情操作，独立显示未结算/补偿 claim，并用分离的请求代次阻止迟到列表或详情覆盖更新状态。

M1G-4 路由本身只记录控制与审计事实。M1H-1 仅在保存策略的 `advanceActions` 显式开启时，为 completed `advance_candidate` 创建并执行确定性标签和/或可替换联系投影；它不改评分、图谱、查询或 AI 提案。`manual_review` 与 `defer_candidate` 不获得动作，后者也不隐藏或删除内容。私密 Entry 只有在当前 trial/run 显式 `includePrivate=true` 时参与，且整个过程保持本地、无 Provider。

M1G-5A 的两个 work-queue 操作在上述审计之外提供独立所有者状态。GET 最多返回 100 条当前可见 Entry 工作项，标明 claim 路由/原因、pending/completed/dismissed、Entry 是否已换修订，以及可选 M1H action 状态和计数；PUT 接受 `{expectedVersion, state, includePrivate}`。更新工作项不更新 Entry 或 claim。未显式包含隐私时，隐私工作项按不存在处理。

M1H action POST 接受 `{expectedVersion, operation: "apply" | "undo", includePrivate}`。`apply` 从 pending 或 tags_applied 继续；`undo` 只在 Entry 仍处于该动作结果修订时删除本次 rule-origin 标签并重建投影。过期版本或人工后续编辑返回冲突，不覆盖人工状态。联系重建只替换计算投影，不覆盖逐对人工 override 或正式知识图谱关系。

### 3.4 联系

`PUT /entries/associations/policy` 接受 `expectedRevision`、三项和为 100 的整数权重，以及 0–10000 的阈值。成功保存到外部个人偏好后，Web 会立即调用 rebuild；候选上限和逐对人工调整幅度仍是固定算法常量。rebuild 读取当前可见 Entry，按正文词项及内容/类型/领域维度生成可解释投影，不覆盖人工 override 或正式图谱关系。逐对 PUT 只接受当前 override 版本、`includePrivate` 和 `enhance`、`weaken`、`block`、`restore` 之一。自动 `similarity` 边不等于经过人工核验的事实性语义断言。

### 3.5 查询

`POST /entries/search` 当前支持：

- 非空 `text` 可显式选择 `textMode: exact | substring | fuzzy`，并用 `textFields` 选择 `title`、`body`、`tags` 中的一至三项；省略时保持全部字段的 substring 行为；
- 内容关键词、来源 key、Snapshot；
- 类型、自定义类型、领域、自定义领域及主/副领域范围；
- 整篇/拆分模式；
- 发布或采集时间范围；
- `includePrivate` 与 `onlyPrivate`；`onlyPrivate=true` 必须同时显式启用 `includePrivate`；
- 指定 Entry 的一至两跳联系范围和最低分；
- `limit` 1–100 与查询绑定排他游标 `after`。
- `retrievalMode: lexical | semantic | hybrid`；省略时保持原词法语义。

结果返回稳定 Entry 分页、匹配原因、0–10000 整数词法/向量/最终检索分、关联路径和精确 Fragment/Snapshot 证据。词法模式保持原 query digest/cursor 兼容；语义和混合模式把检索模式及最终分绑定进同一 schema v2 cursor。响应还包含 `privateDocuments: { totalCount, items }`；默认及未勾选隐私时该通道为空，显式 `includePrivate=true` 后才按词法语义从外部 Blob 匹配完整规范正文、来源 key/URI 或私密 Entry 标签，并返回独立文档摘要与全文入口。私密范围不得使用语义/混合模式。

`GET /entries/search/index` 返回 tokenizer/index 版本、公共 Entry 数、当前/嵌入/过期投影数、posting 数和当前模型 readiness。`POST /entries/search/index/rebuild` 在 workspace lock 下整体替换公共派生索引；没有 embedding 模型时仍生成词项投影。`POST /entries/search/index/evaluate` 只接受最多 20 个合成或所有者明确提供的小型 case、每项显式 query 和 expected Entry IDs、`k` 1–20，并返回 0–10000 的 Recall@K/MRR；它不保存输入或结果。

`POST /entries/exploration/candidates` 接受一个当前可见 `anchorEntryId`、当前页排除 ID、当前页结果数和显式隐私范围。服务端先读取已保存的外部探索策略；关闭或 0% 时返回空结果，否则把页数乘以 0–50% 份额向上取整并限制最多 12 条。候选只来自锚点当前可见的直接 Association，按隐私先行排除当前页、blocked、过期和不可见端点，再按邻域扩展、跨领域连接、偶然发现三个启用桶稳定轮转。该结果不插入普通分页，不改变 query digest、排序、总数或游标，也不写搜索历史、行为画像、Entry、联系或图谱。

`POST /entries/search/synthesize` 是 Query 的次级显式操作，只接收同一公开查询及页面请求身份。服务端按请求的词法/语义/混合模式重新检索，最多打包前 8 条公开 Entry 的有界本地证据；私密范围在 Blob、Embedding 和综合 Provider 前拒绝。返回答案、claim 证据句柄、模型/Prompt 版本和局限，但不保存答案，也不赋予模型自主检索或写权限。

### 3.6 正式知识

`POST /knowledge-graph/view` 接受可选 `query` 或 `centerEntryId`、隐私范围、1–12 个候选和 1–24 个可见邻居。未指定中心时，服务端复用确定性 Entry 匹配，把最高结果作为中心，同时返回可改选候选。隐私过滤先于中心选择、遍历、计数和返回。

`PUT /knowledge-graph/edges/:entryId/:relatedEntryId` 使用 `expectedRevision` 和当前态 CAS，支持 `edit`、`block`、`restore`。`edit` 保存 1–80 字符关系名、方向、`semanticKind`、`verificationStatus` 和最多 500 code point 的 `note`。语义闭合为 `similarity / related / supports / contradicts / part_of / causes / example_of / custom`；持久核验状态闭合为 `unreviewed / source_checked / needs_review`。无自动投影的 Entry 对会形成用户创建关系。读取结果中的纯自动边为 `similarity / calculated`；它表示确定性导航相似度，不是经核验的事实断言。知识页可分别打开两端精确来源，`source_checked` 也只表示用户已回看来源，不证明客观事实为真。

四个 `/knowledge-graph/edges/:entryId/:relatedEntryId/proposals` 路由只处理用户已经选中的 Entry 对。start 接受 `{requestKey}`；服务端先固定两端 current revision 和 pair override revision，任一端隐私时在 fetch 前拒绝。Provider 只接收该对标题、正文和三维标签，返回有界关系名、方向和说明。reject 不改图谱；accept 使用提案冻结的版本调用同一 graph edge command/CAS，成功边来源为 `ai_assisted`，后续人工编辑仍转为用户编辑来源。

### 3.7 处理任务与 OpenAI 拆分/标签/联系提案

`GET /processing-runs?limit=N` 返回最近任务、真实阶段/步骤/进度、状态、版本和有界提案信封；不会返回 idempotency key、正文、Prompt、凭据或原始 Provider 错误。`POST /processing-runs/:runId/cancel` 只接受 `{expectedVersion}`，queued/running 可取消，终态、过期版本和缺失任务返回稳定冲突/不存在结果。

`processing_runs` capability 只表示读取/取消可用。只有 `OPENAI_API_KEY` 与 `STRUIINFO_OPENAI_MODEL` 同时有效时，工作区才分别发布 `ai_split`、`ai_tags`、`ai_associations` 与 `ai_query_synthesis`；通用 `ai` 仍缺席，四项能力互不解锁。

`POST /entries/:entryId/tag-proposals/start` 接受 `{requestKey}`，只把一个公开 Entry 的标题路径和正文交给 Provider。响应先落为真实 ProcessingRun，再保存闭合的内容关键词、类型、领域、说明、模型和 Prompt 版本。私密 Entry 在 fetch 前返回拒绝；API key、Blob、其他 Entry、偏好和数据库信息不会进入请求或响应。

接受接口先核对提案所基于的 Entry revision，再通过现有 Entry 修订命令保存 AI 来源标签；它保留正文、两项评分、隐私和 Fragment 输入。拒绝只终结提案。拆分/标签 Provider 不能直接写 Entry；联系 Provider 也不能直接写 override 或图谱。三种提案都必须由用户接受，并在版本或结构过期时拒绝覆盖。

启用方法：在外部运行配置文件加入 `STRUIINFO_OPENAI_MODEL=<已选模型名>`，并只在启动服务的进程环境中设置 `OPENAI_API_KEY`。不要把 key 写进配置文件、Git、个人数据包或启动脚本。修改后重启服务；任一项缺失时应用会保持无 AI 模式。Responses API 请求由服务端直接发出，浏览器不会接触密钥。

## 4. 隐私语义

默认 Evidence 详情、Entry、标签、联系和查询都不披露隐私内容。隐私访问必须由当前请求显式传入 `includePrivate=true`；查询的“只看隐私”还要求 `onlyPrivate=true`。隐私参与发生在计数、候选、联系遍历、排序和分页之前。

`/entries/search` 在 Entry 结果之外返回独立完整隐私文档通道。服务端只有在当前请求显式启用隐私时才读取对应外部 Blob；全文仍通过带 `includePrivate=true` 的 Evidence Snapshot 详情打开，不复制到普通 Entry 结果或数据库索引。这个边界是本地显示控制，不是加密或多用户授权。

## 5. 个人数据包

export 接口生成当前五分区 Bundle，包含 61 张当前工作区表、被引用的 Blob 字节和含版本化联系、探索、Entry 偏好、AutomationPolicy 与信源串联开关的当前偏好文件。Entry v5 section 在可选精确 Fragment 标量区间和 `is_current_structure` 之外携带拆分前工作副本；v1–v4 Entry section 恢复时把既有 Entry 解释为当前结构并补空工作副本。Processing v7 section 携带十张既有任务/提案表、两张 typed 自动路由执行表、一张所有者工作队列表和一张确定性动作表；restore 只接受导出目录中的安全文件名、同一 `workspaceId` 和空目标工作区，并在一个原子操作中完成。旧的一至四分区 Bundle 以及 Processing v1–v6 保持可读，缺失的新表和偏好字段恢复为空/关闭状态。

Bundle、Blob、偏好、导入资料和备份始终位于外部数据根，不进入 Git 或应用安装树。

## 6. 结果与错误

- `200`：读取、更新、重放、重建或恢复成功；
- `201`：首次导入、首次物化或导出成功；
- `400`：请求形状或字段无效；
- `403`：隐私内容缺少当次显式授权；
- `404`：当前范围内找不到对象，隐私对象在未授权范围也按不可见处理；
- `409`：期望版本过期、幂等键冲突或恢复目标非空；
- `422`：结构可读但业务条件不成立或游标无效；
- `502`：已启用 Provider 返回失败或不符合闭合提案协议；
- `503`：repository、Blob、偏好或传输边界失败。

错误响应只返回稳定 code/path，不回显正文、密码、URL 凭据、数据库 driver message 或本机个人路径。

## 7. 当前限制

- JSON 请求体上限为 2 MiB，Markdown 导入上限为 1 MiB；
- Evidence 列表当前最多返回最近 200 个 Snapshot；
- 接口仅面向回环单用户产品，没有公开认证或 CSRF 完整边界；
- 没有 multipart/服务器路径上传、专用批次写接口、Office/OCR、目录扫描/监视、通用抓取/订阅、自动接受、语义/向量搜索或在线检索接口；多文件能力只是 Web 会话内对既有逐文件接口的显式编排；OpenAI 目前只提供用户选中公开 Snapshot 的 split、公开 Entry 的 tags、用户选中公开 Entry 对的 association 提案，以及当前公开 Query 结果的会话内证据综合；
- 当前正式知识只实现 Entry 中心关系图谱；不恢复 `/curation`、旧 `/knowledge` 写入/读取或旧 `/search` 路由，也不把历史 Knowledge 表当作当前产品入口。
