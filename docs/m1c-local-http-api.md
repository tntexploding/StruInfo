# M1C 本地产品 HTTP 接口

- 状态：已实现，供 M1C/M1D 本机网页与纵向验证使用
- 最近更新：2026-08-22
- 稳定性：本地产品接口；不是公共或第三方集成 API

## 1. 边界

本地 HTTP 层只把已经接受的 Evidence、Curation、Knowledge、InformationEntry、确定性
检索和 Workspace Bundle 用例接到本机网页。它不建立通用 API 平台、账户体系、Webhook、
WebSocket 或后台任务协议。

当前工作区由包体外运行配置中的 `STRUIINFO_WORKSPACE_ID` 选择。请求中不接收
`workspaceId`；服务端为所有领域上下文和导入实体注入当前工作区。切换资料集需要停止
当前进程、替换包体外配置/数据根并重新打开，既不修改代码，也不把个人资料写入 Git。

Markdown 正文作为 JSON 字符串提交，服务端把原始字节写入当前工作区的外部 Blob 根，
PostgreSQL 只保存来源、摘要、定位和结构关系。接口不接受服务器文件路径，也不会把正文
写入仓库、安装目录或日志。

## 2. 路由

所有产品路由位于 `/api/v1`，响应使用 `application/json` 和 `Cache-Control: no-store`。

| 方法   | 路由                                                    | 用途                                                                            |
| ------ | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/workspace`                                     | 当前工作区身份与已启用能力                                                      |
| `GET`  | `/api/v1/evidence`                                      | 最近 200 个 Snapshot 摘要                                                       |
| `GET`  | `/api/v1/evidence/snapshots/:snapshotId`                | Snapshot、规范正文、Fragment 定位与选中文本；隐私正文要求 `includePrivate=true` |
| `GET`  | `/api/v1/curation`                                      | 当前词表、审核目标、分类、准入决定和分维度评级                                  |
| `GET`  | `/api/v1/preferences/review`                            | 当前外部工作区的个人审核快捷标记与自动标签筛选                                  |
| `PUT`  | `/api/v1/preferences/review`                            | 整体保存当前外部工作区的个人审核快捷标记与自动标签筛选                          |
| `POST` | `/api/v1/imports/markdown`                              | Markdown/来源/Blob/结构原子导入                                                 |
| `POST` | `/api/v1/curation/terms`                                | 创建或修订分类词条                                                              |
| `POST` | `/api/v1/curation/apply`                                | 对 Snapshot/Fragment 提交分类、准入或评级操作                                   |
| `POST` | `/api/v1/knowledge/change-sets`                         | 提交人工知识项和关系变更集                                                      |
| `POST` | `/api/v1/search`                                        | 当前知识的确定性文本、来源、状态与一跳关系检索                                  |
| `POST` | `/api/v1/entries/materialize`                           | 从用户明确选择的 Snapshot 幂等生成 Entry；批量界面逐份复用该命令                |
| `GET`  | `/api/v1/entries`                                       | 按 Snapshot 读取当前 Entry                                                      |
| `PUT`  | `/api/v1/entries/:entryId`                              | 追加 Entry 修订                                                                 |
| `POST` | `/api/v1/entries/search`                                | 组合正文、关键词、来源、时间、文档、隐私与有限关联路径检索                      |
| `POST` | `/api/v1/entries/associations/rebuild`                  | 按当前 Entry 和版本化策略重建可替换关联投影                                     |
| `GET`  | `/api/v1/entries/:entryId/associations`                 | 读取当前可见关联、分项得分和人工 override                                       |
| `PUT`  | `/api/v1/entries/:entryId/associations/:relatedEntryId` | 追加增强、削弱、屏蔽或恢复修订                                                  |
| `GET`  | `/api/v1/entry-documents`                               | 读取 Document、Entry 数量与当前标签投影                                         |
| `POST` | `/api/v1/entry-documents/:snapshotId/tags/aggregate`    | 确定性聚合当前文档标签                                                          |
| `PUT`  | `/api/v1/entry-documents/:snapshotId/tags`              | 追加人工文档标签修订                                                            |
| `POST` | `/api/v1/workspace-bundles/export`                      | 将当前领域状态写入外部 `exports/`                                               |
| `POST` | `/api/v1/workspace-bundles/restore`                     | 按安全文件名恢复同 ID 的空工作区                                                |

健康检查继续使用 `/health/live` 和 `/health/ready`。API/`all` 角色装配产品路由；
scheduler/worker 角色只装配健康路由。

API 角色同时从 `apps/web/dist` 提供构建后的单页应用，浏览器默认使用同源产品路由；
刷新任意非 API 前端路径会回退到 `index.html`。开发时仍可用外部
`VITE_STRUIINFO_API_BASE_URL` 指向另一个回环监听器，但该配置不是个人资料、工作区
身份或知识内容的载体。

## 3. 写命令信封

Curation 与 Knowledge 写请求使用同一个轻量 HTTP 信封：

```json
{
  "commandIdempotencyKey": "synthetic-command-001",
  "request": {}
}
```

`request` 保持对应领域合同的原有闭合形状。服务端注入：

```json
{
  "effectiveWorkspaceId": "<configured-workspace-id>",
  "commandIdempotencyKey": "<HTTP-envelope-key>",
  "authority": "manual_user"
}
```

重复提交相同键和相同语义返回原领域的 `replayed`/`existing`；同键异内容返回冲突，
不产生部分副作用。

## 4. Markdown 导入示例

下面的值全部是合成示例。`manual_text` 不需要 Git 扩展字段：

```json
{
  "commandIdempotencyKey": "synthetic-import-001",
  "resource": {
    "resourceId": "11111111-1111-4111-8111-111111111111",
    "resourceKind": "manual_text",
    "sourceKey": "manual:synthetic-note",
    "isPrivate": true
  },
  "snapshot": {
    "snapshotId": "22222222-2222-4222-8222-222222222222",
    "resourceId": "11111111-1111-4111-8111-111111111111",
    "capturedAt": "2040-01-02T03:04:05Z",
    "mediaType": "text/markdown"
  },
  "gitObservations": [],
  "profile": "commonmark-v1",
  "sourceText": "# Synthetic note\n\nSynthetic body.\n"
}
```

Git 文件另外提供同一 `resourceId` 的 `gitResource` 和至少一项 `gitObservations`。
浏览器不需要生成 Blob ID、Structure ID、Node ID 或 Fragment ID；确定性导入器生成并在
receipt 中返回这些身份。

`resource.isPrivate=true` 表示这是显式隐私文档。导入器仍执行通常的结构化拆解，但同时
把完整原始字节和完整规范化正文写入当前工作区的外部内容寻址 Blob 根。它们不会进入
Git、应用包或 HTTP 日志。这个标记会传播到由该文档直接或间接生成的知识修订；涉及
隐私知识端点的关系也属于隐私查询范围。首版不提供隐式解除隐私的编辑捷径。

## 5. 人工审核示例

创建分类词条：

```json
{
  "commandIdempotencyKey": "synthetic-term-001",
  "request": {
    "termId": "33333333-3333-4333-8333-333333333333",
    "expectedRevision": 0,
    "value": {
      "displayName": "Synthetic topic",
      "lifecycle": "active"
    }
  }
}
```

对一个 Fragment 作准入决定：

```json
{
  "commandIdempotencyKey": "synthetic-curation-001",
  "request": {
    "target": {
      "kind": "fragment",
      "fragmentId": "44444444-4444-4444-8444-444444444444"
    },
    "expectedTargetVersion": 0,
    "operations": [
      {
        "kind": "set_intake_decision",
        "action": "full",
        "reasonCodes": ["worth_exploring"]
      }
    ]
  }
}
```

`GET /api/v1/curation` 提供后续修改所需的当前 `currentVersion`、修订号和当前状态。
Evidence Snapshot 详情中的每个 Fragment 同时返回其持久化 DocumentNode 的
`nodeKind`。网页以 `nodeKind=section` 重建 profile 声明的审核队列；`document` 和叶子
Fragment 仍可作为证据或知识来源选择，但不计入当前来源的待审核总数。队列身份来自
数据库，不依赖首次导入响应，因此重启、重开页面和 Bundle 空库恢复后保持一致。

## 6. 个人审核偏好

`GET /api/v1/preferences/review` 返回当前工作区的快捷栏与自动标签筛选：

```json
{
  "status": "ok",
  "workspaceId": "11111111-1111-4111-8111-111111111111",
  "quickTags": ["synthetic-tool", "synthetic-reference"],
  "automaticKeywords": {
    "enabled": true,
    "includeLinkDomains": false,
    "excludedKeywords": ["synthetic-advertisement"]
  },
  "vocabulary": {
    "aliases": [{"source": "Synthetic Toolkit", "canonical": "Synthetic Tool"}],
    "links": [
      {
        "left": "Synthetic Tool",
        "right": "合成工具",
        "kind": "translation"
      }
    ],
    "knowledgeKinds": [{"keyword": "Synthetic Cover", "knowledgeKind": "work"}]
  }
}
```

`PUT /api/v1/preferences/review` 接受上述 `quickTags + automaticKeywords + vocabulary` 配置。快捷标记
最多 24 项，精确排除词最多 64 项；每项在
NFC 和首尾空白处理后为 1–120 个 Unicode code point，且不得重复。调用方不能提供
`workspaceId` 或文件路径。服务把列表写入外部数据根
`preferences/<workspaceId>.review-preferences.json`；该 UI 偏好不进入领域 Bundle。
旧客户端只提交 `quickTags` 时使用安全的自动标签默认值；链接目标、路径和文件名在提取器
中默认排除，只有显式开启 `includeLinkDomains` 才允许 URL host 成为候选。
`vocabulary` 最多保存 128 条无环别名、128 条无向翻译/相关提示和 64 条
`KnowledgeKind` 偏好；它们是外部工作区处理规则，不是正式知识关系。显式词条合并另行
调用既有 Curation 命令迁移当前指派并退役来源词条。
选择某个快捷标记仍通过既有 Curation 命令形成词表指派；删除快捷入口不会修改已审核条目。
该偏好路由属于非核心 UI 配置边界：读取失败时网页必须显示非持久化状态，但仍允许本次
页面会话维护快捷标记和自动筛选，并通过原有 Curation 命令提交手工分类。会话回退不进入
领域数据库、Bundle、Git 或包体。

## 7. 知识变更与搜索

知识变更仍使用
[`C-SLICE-B-KNOWLEDGE-r3`](manual-knowledge-core-contract.md) 的
`authorization + operations` 形状。网页可以使用已获准 Fragment 的决定修订进行
`eligible_target` 写入，或通过明确的 `manual_edit` 入口作最高权限人工修订。所有知识
项、关系、出处和 revision 身份由领域核心原子处理。

最小无文本浏览请求：

```json
{
  "filters": {
    "knowledgeKinds": [],
    "epistemicRoles": [],
    "reviewStates": [],
    "source": {"kind": "any"},
    "relation": {"kind": "any"}
  },
  "page": {"limit": 25}
}
```

默认请求只返回普通知识。需要同时查询隐私知识、涉及隐私端点的关系及完整隐私文档时，
调用方必须使用显式信封：

```json
{
  "includePrivate": true,
  "request": {
    "filters": {
      "knowledgeKinds": [],
      "epistemicRoles": [],
      "reviewStates": [],
      "source": {"kind": "any"},
      "relation": {"kind": "any"}
    },
    "page": {"limit": 25}
  }
}
```

`includePrivate` 必须是本次请求中的布尔值；网页对应控件的固定文案是“查询隐私文档”。
普通范围和隐私范围使用不同的查询摘要，游标不能跨范围复用。成功响应中的知识结果仍在
`items`，完整隐私文档则单独位于 `privateDocuments`，并有独立的
`privateDocumentTotalCount`。读取其中一个完整文档时必须调用：

```text
GET /api/v1/evidence/snapshots/:snapshotId?includePrivate=true
```

服务端会返回完整规范化正文和全部 Fragment；未显式选择时同一路由返回 `403`。Evidence
摘要列表可以显示“隐私”元数据以便用户选择范围，但默认搜索、关系邻域和全文读取不会
泄露其内容。该开关是本机产品的显式可见性边界，不等同于加密、多用户授权或操作系统
访问控制。

搜索响应直接保留 `querySha256`、`matchRank`、`textMatches`、`sourceMatches`、
`relationMatches`、`totalCount` 和 `nextCursor`，网页不得把出处或匹配原因压扁成不透明
字符串。需要显示原文时，以 `sourceMatches[].snapshotId` 调用 Evidence Snapshot 路由，
并以 `sourceMatches[].fragmentId` 直接选中对应摘录；不得默认跳到 Snapshot 的第一个
Fragment。

## 8. Workspace Bundle

导出不接收路径或工作区身份：

```json
{}
```

成功响应返回服务端生成的直接文件名、最终字节数、SHA-256、Blob 引用数和逐表行数。
恢复请求只回传这个文件名：

```json
{
  "fileName": "11111111-1111-4111-8111-111111111111-20400102030405000-22222222-2222-4222-8222-222222222222.workspace-bundle.json"
}
```

服务端仍以包体外配置选择的工作区为权威，并拒绝 Bundle 中不同的 `workspaceId`、非空
目标、缺失/损坏 Blob 或越过 `exports/` 的路径。Bundle 不包含 Blob 正文字节；详见
[工作区 Bundle 合同](workspace-bundle-contract.md)。

## 9. HTTP 状态

领域结果体始终保留原有 `status`/`issue`：

- 创建导入和 Bundle 导出：`201`；相等重放、成功命令/查询和 Bundle 恢复：`200`；
- 隐私正文未显式选择：`403`；
- 资源不存在：`404`；陈旧修订或幂等冲突：`409`；
- 请求或领域验证拒绝：`422`；
- 数据库、Blob 或读模型不可用：`503`。

HTTP 状态只是本地交互提示，不替代领域 receipt、issue code 或持久幂等语义。

## 10. 当前限制

- JSON body 上限为 2 MiB；Markdown 领域上限仍为 1 MiB；
- 首版 Evidence 列表固定最多返回最近 200 个 Snapshot；
- Evidence 详情返回规范 Markdown 正文及全部 Fragment，适合首批周刊规模；
- 显式隐私搜索当前在这 200 个 Snapshot 摘要内匹配完整规范化正文；超出该规模后再按真实需求加入独立分页或查询下推；
- 当前检索仍是 PostgreSQL 一致只读事务中的工作区完整加载，不是 SQL query pushdown；
- Bundle 请求不接受服务器路径：导出没有路径参数，恢复只接受外部 `exports/` 下的直接文件名；
- Bundle 当前以 M1C 领域、M1D Entry/文档标签和 M1D 关联三个闭合分区携带 48 张工作区表及 Blob 身份；旧的 36 表单分区和 45 表双分区 Bundle 仍可恢复，并把缺失状态解释为空。它只恢复同一 `workspaceId` 的空目标；Blob 字节归档、跨工作区克隆和非空目标合并不在当前范围；
- M1C 只允许本机回环使用。公网监听、认证、TLS、限流和公共协议版本属于部署门。

这些限制不会阻止第一次无 AI 产品闭环；真实数据证明需要后再加入分页、查询下推、
索引或公共 API 设计。
