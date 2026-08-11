# StruInfo 工作区 Bundle 合同

- 状态：切片 0 已实现的 v1 信封与合成往返合同
- 最近更新：2026-08-11
- 对应决策：[ADR 0002](adr/0002-postgresql-persistence-and-durable-work.md)、
  [ADR 0005](adr/0005-versioned-knowledge-core-and-ai-optional-operations.md)、
  [ADR 0006](adr/0006-external-configuration-and-personal-data-isolation.md)
- 信封 Schema：[`workspace-bundle.v1.schema.json`](../packages/contracts/json-schema/workspace-bundle.v1.schema.json)

## 1. 当前合同解决什么

工作区 bundle v1 是个人工作区元数据的可移植、版本化字节信封。
它先固定导出/导入共同需要的编码、预算、分区版本、Blob 引用和秘密排除边界，不在知识表尚未建立时虚构 vocabulary、source、knowledge 或 view 的最终字段。

信封包含：

| 字段             | 约束                                                          |
| ---------------- | ------------------------------------------------------------- |
| `format`         | 固定为 `struinfo.workspace-bundle`                            |
| `version`        | 当前固定为 `1`；未知版本拒绝导入                              |
| `workspaceId`    | 稳定、非路径型工作区标识                                      |
| `exportedAt`     | 规范 UTC ISO 时间戳                                           |
| `secretHandling` | 固定为 `excluded`                                             |
| `sections`       | 按 `type + version` 排序且唯一的模块数据分区                  |
| `blobReferences` | 按摘要排序且唯一的 SHA-256 身份；不包含文件路径或 base64 字节 |

当前默认完整信封上限为 16 MiB。
大型正文、快照和媒体继续使用 Blob 引用，不能通过 bundle 反复嵌套 base64。

## 2. 分区 Codec

每个正式模块为自己的分区注册明确的 `type + version` codec。
Writer 只调用已注册 codec，把模块状态转换为普通 JSON 数据；Reader 在返回任何导入值前使用相同版本 codec 重新验证。

- 未注册的分区或版本拒绝导入和导出；
- 同一 `type + version` 在一个 bundle 中只能出现一次；
- codec 必须使用闭合 schema，拒绝未知字段和错误引用；
- codec 负责其领域含义和秘密字段映射，bundle 内核不替代领域校验；
- 增加正式 vocabulary、source、evidence、knowledge 或 view 分区时，同一变更必须提交 schema、codec、迁移映射和往返测试。

信封 JSON Schema 只描述公共信封。
`payload` 的具体 schema 由所注册分区合同拥有；这不是允许任意 JSON 直接成为 PostgreSQL 规范事实。

## 3. 规范字节编码

当前 writer 输出一种确定性 UTF-8 JSON：

- 对象键递归按字典序排列；
- 不写额外空白，并以一个 LF 结束；
- 只接受有限数字、普通 record、稠密普通 array 和 JSON 原语；
- 拒绝 Proxy、accessor、symbol、自定义 prototype、共享字节视图、稀疏数组、循环和危险属性名；
- Reader 先复制输入的精确可见字节范围，执行 fatal UTF-8 和 JSON 解析，再重新编码并逐字节比较。

因此重复成员、不同键顺序、额外空白、BOM 或其他非规范表示即使能被 `JSON.parse` 接受，也不会被当前公开 Reader 接受。
Writer 先生成完整包络并测量最终字节数；只有不超过预算的完整结果才返回。

## 4. 秘密排除

普通 bundle 只能保存秘密引用，例如 `credentialReference`，不能保存秘密值。
正式分区 codec 必须从数据库或运行状态中显式选择可移植字段，不得序列化整个内部对象。

内核在导出和导入两侧额外拒绝：

- 密码、API key、access/refresh token、private key、数据库 URL、authorization、cookie 或 credential value 等秘密属性；
- URL userinfo 和常见秘密查询参数；
- Bearer 凭据和私钥文本块。

该检查是高置信事故防护，不是通用 DLP。
秘密可能被隐藏在任意备注文本中，因此领域 codec、授权、导出选项和人工审查仍是主要边界。

## 5. 当前未实现的部分

合成 codec 测试已经证明个人类别、信源、保存查询和 credential reference 可以往返，而内部数据库密码和模型 key 不进入字节。
当前尚未实现：

- PostgreSQL 工作区读取与事务一致性快照；
- vocabulary、source、evidence、knowledge、curation、view 和 audit 的正式分区 codec；
- Blob 字节打包、引用完整性遍历和跨工作区授权；
- `exports/` 下的命名、原子落盘、下载与导入应用用例；
- 完整备份、恢复、迁移与垃圾回收联动。

这些能力随对应知识模块实现，不改变 v1 信封的秘密排除和规范编码规则；若确需破坏信封语义，必须发布新格式版本。
