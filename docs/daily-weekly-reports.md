# 报告

在数据库页面的报告区配置选材与生成方式。
支持日报、周报、月报和专题报告，可使用模型总结或生成资料集合。
填写时间范围、时区、主题、来源和条目数量，预览后创建报告。

## 选材与编辑

报告使用已确认的公开内容，保存选材版本与引用。
拒收、撤回、私密和未发布内容受可见性检查限制。
同一事件可合并来源，不同事实分别整理。
摘要保留来源，日期缺失或内容过期会提示。
人工修改单独保存，原始模型草稿保留。
核对后可下载 Markdown，或通过浏览器打印 PDF。

## 任务

生成按阶段保存进度。失败后可从允许恢复的阶段继续。
每次模型请求检查许可、并发、价格时段和额度。
价格等待可在允许时段恢复，取消后保持取消状态。
数据包恢复后由所有者重新启用任务。

定时生成、站内发布和通知见[联网与报告](network-research-and-reports.md)。
外部推送渠道尚未配置。

## 接口

所有者使用 POST /api/v1/reports/commands，请求包含 operation 和 input。
常用操作为 report_preview、report_create、report_generate、report_cancel、
report_edit、reports_list、report_read 和 report_export。
创建使用 requestKey，修改使用 expectedVersion。
外部 Agent 开放已授权的预览、读取和导出。
完整字段以接口 schema 为准。
