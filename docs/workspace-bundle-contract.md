# 备份内容

个人数据包保存同一工作区的数据库内容、引用 Blob 和个人偏好。
运行配置与密钥由部署方单独保管。队列内部状态和检索缓存按需重建。

当前格式由以下代码定义：

- [总包](../apps/server/src/workspace_transfer/workspace_bundle.ts)。
- [处理记录](../apps/server/src/workspace_transfer/m1e_processing_bundle.ts)。
- [数据库导入导出](../apps/server/src/platform/database/postgresql/postgres_workspace_transfer_repository.ts)。

历史格式通过已有解码器读取。
恢复保留原文、人工决定、确认版本、任务记录和费用。
自动策略与活动任务恢复为暂停状态。

恢复目标为同 workspace ID 的空数据库和空数据根。
迁移、队列准备、授权与预检完成后再恢复。
核对 Blob、表行数和内容引用。操作步骤见[运行维护](production-operations.md)。
