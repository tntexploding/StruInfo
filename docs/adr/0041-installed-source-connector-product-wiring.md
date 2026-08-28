# ADR 0041: 已安装信源连接器的产品接线

- 状态：Accepted
- 日期：2026-08-27
- 里程碑：M1I-5

## 背景

M1I-1 的 Registry 已允许受信任 adapter 与内建 reader 共用有界结果，但此前
产品没有诚实展示运行环境实际安装了哪些 adapter，也没有可迁移的外部配置引用。
M1I-5 只补这条产品接线，不在 StruInfo 内实现插件市场或任意代码加载器。

## 决策

### 安装与能力发现

连接器由受信任宿主在 runtime composition 时注入 `SourceConnectorPort`。偏好、
HTTP 请求和数据库都不能指定 JavaScript/模块/可执行文件路径，也不能触发动态
import。每个可见 adapter 提供闭合 descriptor：

- 稳定 `connectorId` 与显示名；
- `builtin` 或 `plugin` 来源；
- `internal` 或 `external_reference` 配置方式。内建只使用 internal，插件只使用
  external_reference。

Registry 校验、复制、冻结并稳定排序这些描述。订阅列表 API 和导入页只展示
当前 runtime 的真实 capability；没有插件时明确显示零个，不伪造占位能力。

### 外部配置引用

`sourceSubscriptions` 新增 `plugin`：

- 仅接受 `plugin.*` 形式的已安装连接器 ID；
- 保存一个有界、opaque 的 `configurationRef`；
- 保存既有显示名、来源别名、隐私、启停、检查间隔、默认关闭的确定性分流和
  成功 cursor。

配置引用不是路径、秘密或配置正文。已安装 adapter 在自己的受信任宿主边界解析
它。StruInfo 只把 `{configurationRef}` 交给 adapter，不记录 Provider 配置、密码、
插件代码或任意 payload。偏好与完整个人数据包可以保留当前未安装的连接器配置；
运行时缺失则返回稳定不可用结果，不删除配置或推进 cursor。

### 权限与结果

插件和内建 reader 返回相同的 unchanged/changed、有界文档结果。宿主继续负责
ProcessingRun、外部 Blob、Evidence、隐私、幂等导入、可选确定性分流与成功后
cursor 提交。插件没有数据库、Entry、标签、Association、正式图谱、AI、偏好或
游标写端口。

## 产品接线与验证

导入页显示全部公开 capability，并且只有存在 plugin capability 时才为新配置提供
插件类型。已保存但缺失的 adapter 保持可见并标记不可用。验证使用注入式合成
adapter，覆盖 descriptor 闭合、外部引用、运行结果、缺失 adapter、偏好往返、
API 能力发现和浏览器空/可用状态；没有安装或执行第三方插件，没有新增迁移、依赖
或真实数据。

## 非目标与后续

本增量不实现插件下载、市场、签名、沙箱、热重载、任意模块路径、插件自定义 UI、
密钥管理或领域写权限。下一阶段进入 M1J 正式知识深化。
