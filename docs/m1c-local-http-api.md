# 当前本地产品 HTTP 接口

- 状态：M1E-2 活动接口
- 最近核对：2026-08-23
- 稳定性：本机产品接口；不是公共或第三方集成 API
- 实现真值：[当前项目状态与实现清单](current-project-state.md)

> 文件名保留 `m1c` 只是兼容命名。旧 Manual Curation、正式 Knowledge 写入/读取和旧 Knowledge 检索路由已从当前运行时删除。

## 1. 接口边界

本地 HTTP 层只连接当前可运行的 Evidence、InformationEntry、Document 标签、Entry 联系、正式 Entry 图谱、个人偏好和个人数据包用例。它不提供账户、多用户授权、Webhook、WebSocket、后台 AI 任务或公共扩展 API。

当前工作区由包体外运行配置中的 `STRUIINFO_WORKSPACE_ID` 选择。请求不能提交或切换 `workspaceId`；服务端把固定工作区注入所有领域操作。切换资料集需要停止当前进程、替换外部配置或数据根并重新启动。

Markdown 正文作为 JSON 字符串提交。原始和规范化字节写入外部内容寻址 Blob 根，PostgreSQL 只保存身份、摘要、定位和结构关系。接口不接受服务器文件路径，也不会把正文写入 Git、安装目录或日志。

所有产品路由位于 `/api/v1`，响应使用 `application/json`、`Cache-Control: no-store` 和 `X-Content-Type-Options: nosniff`。健康检查位于 `/health/live` 与 `/health/ready`。

## 2. 当前活动路由

| 方法   | 路由                                                     | 当前用途                                                                         |
| ------ | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/workspace`                                      | 返回固定工作区身份及实际启用的能力                                               |
| `GET`  | `/api/v1/evidence`                                       | 列出当前 Evidence Snapshot 摘要                                                  |
| `GET`  | `/api/v1/evidence/snapshots/:snapshotId`                 | 返回 Snapshot、完整规范正文、结构和 Fragment；隐私内容要求 `includePrivate=true` |
| `GET`  | `/api/v1/preferences/review`                             | 读取外部工作区的快捷标签、自动关键词开关/过滤和别名偏好                          |
| `PUT`  | `/api/v1/preferences/review`                             | 整体保存当前偏好文件                                                             |
| `POST` | `/api/v1/imports/markdown`                               | 原子导入 Markdown、来源、Blob、结构和 Fragment                                   |
| `POST` | `/api/v1/entries/materialize`                            | 从一个用户选择的 Snapshot 幂等生成 section Entry                                 |
| `PUT`  | `/api/v1/entries/:entryId`                               | 以期望版本更新当前 Entry 成品态                                                  |
| `POST` | `/api/v1/entries/search`                                 | 组合文本、标签、来源、时间、隐私和有限关联路径查询 Entry                         |
| `POST` | `/api/v1/entries/associations/rebuild`                   | 按当前 Entry 与固定策略重建可替换关联投影                                        |
| `GET`  | `/api/v1/entries/:entryId/associations`                  | 读取一个 Entry 的可见联系、分项得分和人工控制                                    |
| `PUT`  | `/api/v1/entries/:entryId/associations/:relatedEntryId`  | 追加增强、削弱、屏蔽或恢复控制                                                   |
| `POST` | `/api/v1/knowledge-graph/view`                           | 选择最高匹配或指定中心，并读取隐私过滤后的有界 Entry 图谱                        |
| `PUT`  | `/api/v1/knowledge-graph/edges/:entryId/:relatedEntryId` | 修改、隐藏、恢复自动边，或创建用户关系                                           |
| `GET`  | `/api/v1/entry-documents`                                | 读取 Document、Entry 数量和当前文档标签                                          |
| `POST` | `/api/v1/entry-documents/:snapshotId/tags/aggregate`     | 从当前 Entry 确定性聚合文档标签                                                  |
| `PUT`  | `/api/v1/entry-documents/:snapshotId/tags`               | 保存人工文档标签当前态                                                           |
| `POST` | `/api/v1/workspace-bundles/export`                       | 将当前工作区个人数据写入外部 `exports/`                                          |
| `POST` | `/api/v1/workspace-bundles/restore`                      | 从安全文件名恢复同 ID 的空工作区                                                 |

API/`all` 运行角色装配产品路由并提供 `apps/web/dist` 的同源单页应用。scheduler/worker 角色只提供健康路由；它们的存在不表示自动采集或 AI 作业已经实现。

## 3. 五步主线如何调用接口

### 3.1 导入

`POST /imports/markdown` 接收：

- `commandIdempotencyKey`；
- `sourceText`；
- 带服务端固定工作区覆盖的 `resource`、`snapshot` 和 `gitObservations`；
- 可选 `gitResource`、`profile` 与 `documentBaseUri`。

Web 页面负责把来源别名、链接、日期、Git 身份、隐私标记和正文前置文字映射到这些字段。相同命令可重放；同键异内容返回冲突。

### 3.2 拆分

`POST /entries/materialize` 当前只接受 `snapshotId`、可选的 `chunkMode: "split"` 和 `includePrivate`。服务端读取已经导入的 CommonMark 结构，把 section 节点确定性转换为 Entry。当前没有自定义范围、全文保存修改或 AI 拆分接口。

### 3.3 标签

`PUT /entries/:entryId` 使用 `expectedRevision` 防止覆盖并提交：

- Entry 正文；
- 内容关键词；
- 类型关键词和可选自定义类型；
- 主/副领域关键词和可选自定义领域；
- 可选的有用程度与有趣程度 1–5 评分；
- 隐私 Entry 的当次 `includePrivate`。

文档级标签通过 aggregate 接口确定性重算，或通过 tags 接口人工覆盖。快捷标签、排除词、域名策略和已确认别名由 preferences 接口写入外部偏好文件，不进入数据库迁移、Git 或应用包。

### 3.4 联系

rebuild 接口读取当前可见 Entry，按正文词项及内容/类型/领域维度生成可解释投影。逐对 PUT 只接受当前 override 版本、`includePrivate` 和 `enhance`、`weaken`、`block`、`restore` 之一。它是未来知识图谱的自动 `similarity` 边来源，但不等于经过人工核验的事实性语义断言。

### 3.5 查询

`POST /entries/search` 当前支持：

- 规范化文本子串；
- 内容关键词、来源 key、Snapshot；
- 类型、自定义类型、领域、自定义领域及主/副领域范围；
- 整篇/拆分模式；
- 发布或采集时间范围；
- `includePrivate` 与 `onlyPrivate`；`onlyPrivate=true` 必须同时显式启用 `includePrivate`；
- 指定 Entry 的一至两跳联系范围和最低分；
- `limit` 1–100 与查询绑定排他游标 `after`。

结果返回稳定分页、匹配原因、关联路径和 Entry 对应的精确 Fragment/Snapshot 证据。当前实现是完整加载后的确定性查询，不是 SQL query pushdown、模糊检索、向量检索、RAG 或答案生成。

### 3.6 正式知识

`POST /knowledge-graph/view` 接受可选 `query` 或 `centerEntryId`、隐私范围、1–12 个候选和 1–24 个可见邻居。未指定中心时，服务端复用确定性 Entry 匹配，把最高结果作为中心，同时返回可改选候选。隐私过滤先于中心选择、遍历、计数和返回。

`PUT /knowledge-graph/edges/:entryId/:relatedEntryId` 使用 `expectedRevision` 和当前态 CAS，支持 `edit`、`block`、`restore`。`edit` 可保存 1–80 字符关系名以及双向、低 ID 指向高 ID 或高 ID 指向低 ID；无自动投影的 Entry 对会形成用户创建关系。自动边、用户编辑边和用户创建边分别标明来源。自动 `similarity` 表示确定性导航相似度，不是经核验的事实断言。

## 4. 隐私语义

默认 Evidence 详情、Entry、标签、联系和查询都不披露隐私内容。隐私访问必须由当前请求显式传入 `includePrivate=true`；查询的“只看隐私”还要求 `onlyPrivate=true`。隐私参与发生在计数、候选、联系遍历、排序和分页之前。

完整隐私文档目前可以通过 Evidence Snapshot 详情单独打开，但 `/entries/search` 只返回 Entry。把完整隐私文档作为独立查询结果通道仍是未完成功能，不能从现有 `onlyPrivate` 选项推导为已实现。这个边界是本地显示控制，不是加密或多用户授权。

## 5. 个人数据包

export 接口生成当前四分区 Bundle，包含 45 张当前工作区表、被引用的 Blob 字节和当前偏好文件。restore 只接受导出目录中的安全文件名、同一 `workspaceId` 和空目标工作区；恢复在一个原子操作中完成。旧的一至三分区 Bundle 保持可读，缺失的后来分区恢复为空状态。

Bundle、Blob、偏好、导入资料和备份始终位于外部数据根，不进入 Git 或应用安装树。

## 6. 结果与错误

- `200`：读取、更新、重放、重建或恢复成功；
- `201`：首次导入、首次物化或导出成功；
- `400`：请求形状或字段无效；
- `403`：隐私内容缺少当次显式授权；
- `404`：当前范围内找不到对象，隐私对象在未授权范围也按不可见处理；
- `409`：期望版本过期、幂等键冲突或恢复目标非空；
- `422`：结构可读但业务条件不成立或游标无效；
- `503`：repository、Blob、偏好或传输边界失败。

错误响应只返回稳定 code/path，不回显正文、密码、URL 凭据、数据库 driver message 或本机个人路径。

## 7. 当前限制

- JSON 请求体上限为 2 MiB，Markdown 导入上限为 1 MiB；
- Evidence 列表当前最多返回最近 200 个 Snapshot；
- 接口仅面向回环单用户产品，没有公开认证或 CSRF 完整边界；
- 没有文件上传、多格式解析、抓取、订阅、AI、模糊/向量搜索或在线检索接口；
- 当前正式知识只实现 Entry 中心关系图谱；不恢复 `/curation`、旧 `/knowledge` 写入/读取或旧 `/search` 路由，也不把历史 Knowledge 表当作当前产品入口。
