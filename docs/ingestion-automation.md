# 订阅与新资料自动处理

本功能接通已有 Git、RSS/Atom、JSON API、受限网页及插件订阅，以及普通手动导入。
正常路径是“保存原文 → AI 拆分 → 标签 → 有限联系”，一次保存策略后不必逐篇确认。
默认关闭；历史文档和私有材料不会自动纳入。
内部模型未配置时可以保存关闭或暂停的策略；开始自动处理前必须配置并重新核验。

## 启用前准备

先按既有流程应用迁移 000035 并运行 `deploy/postgresql/apply-runtime-grants.sql`。
模型沿用外部 `OPENAI_API_KEY` / `OPENAI_API_KEY_FILE` 与 `STRUIINFO_OPENAI_MODEL`。
策略和队列保存在外部工作区数据库，密钥不进入数据库、个人数据包或 Git。

单进程使用 all 角色即可。分角色部署中，scheduler 继续采集订阅，worker 处理队列，api 提供人工操作。
worker 每分钟检查一次队列；不必保持浏览器开启。

现有收件箱仍配置订阅地址、检查间隔和手动导入。
“设置 → AI 接入”提供策略、预算、单文档任务与阶段明细；收件箱提供处理队列、重试和接管。HTTP / MCP 与界面共用同一应用层。

## 保存处理策略

所有者入口：`POST /api/v1/ingestion/commands`。
先调用 `{"operation":"subscriptions_list","input":{}}` 获取公开信源 ID，
再调用 `{"operation":"ingestion_status","input":{}}` 读取策略当前 revision。

以下是合成示例；subscriptionIds 要换为选中的实际 ID，model 要与实例外部配置一致，
expectedRevision 使用刚读取的值。确认范围和预算后将 enabled 设为 true：

```json
{
  "operation": "ingestion_policy_save",
  "input": {
    "expectedRevision": 0,
    "settings": {
      "enabled": false,
      "paused": false,
      "subscriptionIds": ["00000000-0000-4000-8000-000000000003"],
      "manualUploads": true,
      "model": "synthetic-model",
      "maxEntries": 12,
      "maxRelations": 4,
      "maxModelCalls": 24,
      "maxDocumentsPerDay": 10
    }
  }
}
```

manualUploads 指启用后经普通手动导入入口保存的新文档；不包含历史批处理工具。
订阅配置的 enabled / 检查间隔决定是否定时采集；策略的 enabled 决定是否自动处理，两者独立。

策略只登记启用后首次创建的公开 Snapshot；更早的材料、重复内容、仅新增 Git 观察记录不会被追溯补处理。
选入策略的新文档由 AI 完成首次拆分，旧的“导入后自动分流”不会抢先物化同一 Snapshot。
原文与入队记录在同一事务提交，模型调用发生在提交后。

maxDocumentsPerDay 按 UTC 日限制新启动文档数，失败重试沿用原额度。
maxModelCalls 是每篇任务的总尝试额度；恢复不会重置，每阶段仍最多 3 次。
它们不是精确 token、金额或每日实际消费上限。重试和中断后的调用可能落在后续日期。
超额的新文档保留在 pending，下一 UTC 日可继续。

## 查看、暂停、重试与接管

`ingestion_status` 支持可选的 limit（1–100，默认 50）、status 筛选及 nextCursor → after 分页。
条目包含原文 snapshotId、冻结策略和授权人、队列 version、taskId、失败原因以及任务阶段和调用次数。
读取不调用模型。summary 汇总各状态数量、当日新启动文档数与已记录模型尝试；这些数值来自数据库，不是估计成本。状态含义：

| 状态       | 含义                             |
| ---------- | -------------------------------- |
| pending    | 已保存原文，等待额度或处理       |
| running    | 已创建可恢复的处理任务           |
| attention  | 处理失败或单独暂停任务，需要操作 |
| paused     | 已暂停这篇文档                   |
| completed  | 已完成处理                       |
| taken_over | 自动处理权已交回人工             |

例如 `{"operation":"ingestion_status","input":{"status":"attention","limit":50}}` 只查看异常。

全局暂停：读取最新策略，完整保存同一 settings 并设 paused=true。
新材料继续采集和入队，后续模型阶段停止；恢复设 paused=false。
关闭 enabled 不再登记新的自动文档，已有自动任务在阶段边界停止。
未进入此队列的订阅资料仍遵循原有“导入后自动分流”设置；需要继续收件但暂不处理时，使用 paused=true。
范围移除、模型变化、预算收紧也会阻止旧任务继续越过授权范围；已受阻的任务转入 attention，核对并恢复授权后需显式 retry。它们不会一直占住待处理队列。

单篇操作：

```json
{
  "operation": "ingestion_item_control",
  "input": {
    "snapshotId": "00000000-0000-4000-8000-000000000002",
    "expectedVersion": 1,
    "action": "pause"
  }
}
```

action 为 pause、retry 或 take_over。使用最新队列 version。
retry 用于失败、单篇暂停或中断恢复，沿用同一 taskId 和已保存提案，不重复写入成功阶段。
take_over 先停止该文档的自动处理权，然后取消剩余任务；可回到资料库手动整理。
已完成的条目与联系保留。版本冲突和冻结预算耗尽不会因 retry 自动放宽，
需核对原因后手工处理；更换模型也不能续跑旧模型任务。

正常服务重启后，启用策略下未完成的队列会继续；单独暂停/接管和异常任务不会自行重试。
恢复个人数据包后，策略被强制暂停并增加版本，核对模型、范围、队列和预算后再显式恢复。

## MCP 与外部 Agent

沿用 [Agent 接入说明](agent-interface.md) 的独立令牌。
新增工具为 subscriptions_list、ingestion_status、ingestion_policy_save、ingestion_item_control。
后两项需要新增的独立 `automate` grant；原有 process 只允许显式单文档模型任务。
例如外部 Agent 的 `read,automate` 可查看并管理这套策略，但不因此取得普通标签写入或所有者权限。

来源正文与模型结果不能改变策略或授权。日报、周报、月报、自动翻译和私有材料外发仍未接入。
