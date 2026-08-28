# ADR 0034: 拆分前派生全文编辑

- 状态：Accepted
- 日期：2026-08-26
- 里程碑：M1H-3A / M1H-3B

## 背景

导入后的 Snapshot、DocumentStructure 与 Fragment 是可复核的原始证据，不能被页面编辑覆盖；但所有既有拆分入口只能读取这份不可变结构，用户无法在拆分前清理标题、噪声或排版。此前路线图明确把“拆分前保存全文修改”留作独立边界。

项目只需要快速、清晰地保留原始版本和最终使用版本，不需要保存每次输入、撤销或自动保存形成的草稿历史。

## 决策

### M1H-3A：唯一当前工作副本

每个原始 Snapshot 最多有一行 `information_document_working_copy`：

- `editing` 状态保存一份当前 UTF-8 文本、内容摘要和乐观并发 revision；再次保存原位更新，不追加历史；
- “恢复原文”删除尚未确认的工作副本；
- 私密来源只有在当前请求明确 `includePrivate` 时才能读取或编辑；
- 已经生成 Entry 的 Snapshot 不能再进入拆分前编辑，后续结构调整继续使用 M1H-2；
- Web 编辑器绑定当前 Snapshot 与隐私作用域；切换文档或隐私范围后，迟到的保存、恢复或确认响应不得覆盖当前页面；
- Snapshot、Fragment、原始 Blob 和既有 Entry 不被修改。

### M1H-3B：确认形成派生证据

确认工作副本时，服务端使用固定身份和现有 CommonMark Evidence 导入边界创建一个新的不可变 `manual_text` Resource/Snapshot：

- 新 Snapshot 的原始字节就是用户确认的工作副本文本；
- privacy 与 publication 元数据继承来源 Snapshot；
- 工作副本行转为 `committed`，清除可变正文，仅保留来源 Snapshot、最终摘要和派生 Resource/Snapshot 关系；
- 页面自动选中派生 Snapshot，后续确定性、人工范围、人工分组或 AI 提案仍使用现有拆分入口；
- 原始 Snapshot 始终保留，可单独查看，但不会被伪装成已修改版本。

确认是显式操作，不自动生成 Entry。失败可用相同 revision 与确定性身份安全重试。

## 存储与可移植性

迁移 `000022` 增加一张工作副本表。Entry Bundle 升级为 v5 并携带该表；v1-v4 恢复时补为空表。派生 Evidence 行及 Blob 字节继续由既有 Domain 与 Personal Data Bundle 携带。用户正文、草稿、Blob、数据库和偏好仍位于外部数据根，不进入 Git 或应用包。

## 非目标

- 不修改或删除原始证据；
- 不保存逐键、撤销栈或多版草稿历史；
- 不支持已经生成 Entry 后再改全文；
- 不引入协同编辑、富文本、Office 回写、自动接受 AI 修改或第二套知识存储；
- 不改变 M1H-2 的后生成结构重组语义。
