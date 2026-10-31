# AI 与外部 Agent

内部模型执行文档任务。外部 Agent 通过 HTTP 或 MCP 调用同一应用用例。
总览显示任务与 AI 总控，设置页管理模型和执行范围。

## 配置

凭据放在仓库外，通过环境变量或只读密钥文件提供。

| 配置                                               | 用途                       |
| -------------------------------------------------- | -------------------------- |
| STRUIINFO_AGENT_ID                                 | 外部 Agent 的固定身份      |
| STRUIINFO_AGENT_TOKEN / STRUIINFO_AGENT_TOKEN_FILE | 独立随机令牌，选择一种方式 |
| STRUIINFO_AGENT_GRANTS                             | 逗号分隔的授权，默认 read  |
| DEEPSEEK_API_KEY / DEEPSEEK_API_KEY_FILE           | DeepSeek 密钥              |
| STRUIINFO_DEEPSEEK_MODEL                           | DeepSeek 模型              |
| OPENAI_API_KEY / OPENAI_API_KEY_FILE               | OpenAI 密钥                |
| STRUIINFO_OPENAI_MODEL                             | OpenAI 模型                |

模型供应商选择一组配置。具体字段见[运行配置](runtime-configuration.md)。
部署时执行当前全部迁移与运行账号授权。

| 授权      | 范围                     |
| --------- | ------------------------ |
| read      | 读取公开资料、来源和任务 |
| capture   | 导入和采集公开资料       |
| structure | 提交外部拆分结果         |
| annotate  | 提交外部标注与联系       |
| process   | 使用项目模型             |
| automate  | 管理获准的自动处理范围   |

外部身份只控制自己发起的任务，所有者可管理全部任务。
私密材料保持本地。配置写入和模型请求分别校验授权。

## 连接

HTTP 使用 POST /api/v1/agent/commands，携带 Authorization: Bearer 令牌。

```json
{"operation": "processing_standard", "input": {"stage": "split"}}
```

本机所有者使用 /api/v1/ai-tasks/commands、/api/v1/ingestion/commands 等入口。
实例访问控制由部署层提供。

MCP 入口为 apps/server/dist/entrypoints/mcp.js。
设置外部 STRUIINFO_AGENT_URL 与令牌，远端连接使用 HTTPS。
本地开发可运行 pnpm start:mcp，构建后可运行 pnpm start:mcp:built。
已部署容器可用：

```text
docker exec -i <应用容器名> node dist/entrypoints/mcp.js
```

stdio 用于协议传输。客户端保存自己的连接配置，数据库凭据留在服务端。

## 常用操作

- document_read、document_sections：读取文档和来源范围。
- entries_search、entry_read、relations_read：查询条目及联系。
- task_start、tasks_list、task_read、task_control：创建、读取和控制任务。
- entry_annotations_read、entry_annotations_save：读取与保存结构化标注。
- document_publish：按预期条目修订确认发布。
- topics_list、topics_preview、topic_save：读取候选与管理主题。
- web_search、research_answer、web_capture：联网检索、回答和显式保存。
- report_preview、reports_list、report_read、report_export：报告预览、读取和导出。

操作字段以服务返回的工具 schema 为准。
写入使用当前版本，重试复用 requestKey。
外部拆分先读取 document_sections，提交完整有序的原文分组。

## 文档任务

kind=document 使用 snapshotId、模型和单篇额度创建任务。
当前流程为审核、拆分、标注、确认发布；主题与重点联系单独启动。
kind=intake 只审核接收，完成后结束。
kind=split、tags、relation 接收外部 Agent 的处理结果。
人工修改优先，冲突保留待处理。
旧文档任务保留读取与取消，新的处理需显式创建当前流程任务。

详细操作：[自动处理](ingestion-automation.md)、[拆分方案](source-splitting.md)、
[结构化标注](structured-annotations.md)、[主题与联系](content-topics.md)、
[联网与报告](network-research-and-reports.md)。
