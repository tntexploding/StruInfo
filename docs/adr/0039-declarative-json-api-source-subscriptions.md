# ADR 0039: 声明式 JSON API 信源订阅

- 状态：Accepted
- 日期：2026-08-27
- 里程碑：M1I-3

## 背景

M1I-1 已提供内建与受信任插件共用的 SourceConnectorPort、Registry 和
remote_document Evidence 入库底座，M1I-2 已把公开 RSS/Atom 接到外部偏好、
调度、ProcessingRun、导入页和逐记录入库。上线前信源顺序的下一条窄路径是
JSON API：所有者需要明确一个只读 endpoint、记录数组和字段映射，并在 API
提供分页或增量 cursor 时稳定推进。

这个增量不是通用 REST 客户端或脚本运行器。主程序只解释有界属性路径，不执行
用户表达式，不接受任意请求方法、请求体或自定义代码。

## 决策

### 外部配置

sourceSubscriptions union 新增 json_api：

- 一个无凭据、无 fragment 的公开 HTTPS endpoint；
- 记录数组、记录 ID、标题和正文的必需点分属性路径；
- 原文地址、发布时间和远端版本的可选属性路径；
- 1–32 条单次记录上限；
- 各自独立的可选分页 cursor 与增量 checkpoint 映射，每项只包含一个响应属性
  路径和一个查询参数名；
- none 或 bearer_env 认证。后者只保存大写环境变量名，令牌本身只在运行
  进程环境中读取，不写偏好、个人数据包、数据库、Git、日志或响应；
- 既有标签、来源别名、隐私、间隔、启停、默认关闭的导入后确定性分流和成功
  connector cursor。

旧 Git 与 RSS 记录保持可读。配置和 cursor 继续位于包体外个人偏好文件，并随
完整个人数据包携带。

### 内建 adapter

builtin.json-api.v1 只执行 GET：

- 连接前拒绝 loopback、link-local、私有、组播和明显本地域名；
- 不跟随 redirect；每页 20 秒、1 MiB，只接受 JSON media type；
- 点分路径最多八段，只允许普通属性名；空 recordsPath 表示根数组；
- 每次最多完整读取 5 页、32 条。若下一页仍存在或记录超出上限则整次失败，
  不截断、不丢记录、不推进 cursor；
- 分页 cursor 只用于同一次检查的后续页；上次成功的增量 checkpoint 只进入
  下一次检查的首个请求。二者不得共用查询参数；
- 每条记录必须得到稳定 ID、标题和正文；版本由映射值或规范记录投影连同当前
  公开字段共同派生；
- 每条记录形成一份服务端 Markdown 投影，并把其所在 JSON 响应页的精确字节
  留在外部内容寻址 Blob。原文地址缺失时使用 endpoint；
- 相同记录版本由有界 token 窗口抑制；新增或修订记录按 API 顺序逐条进入
  remote_document Evidence。

连接器不能写数据库、偏好、游标、Entry、标签、联系、图谱或 AI。订阅服务仅在
整批 Evidence 写入以及可选本地确定性分流全部成功后提交 cursor。

## 产品接线

既有 source-subscription list/replace/run-now API、非重叠 scheduler、
ProcessingRun 和导入页支持 Git、RSS/Atom 与 JSON API。导入页明确展示字段
路径、记录上限、认证引用、分页和增量选项；保存前校验闭合配置。没有配置
Provider 或凭据时，手工文件、Git 和 RSS 路径仍独立可用。

## 验证与数据边界

验证只使用注入式 fetch、DNS、环境读取器和无含义 JSON。覆盖多页读取、增量
checkpoint、Bearer 引用、字段投影、记录修订、私网拒绝、缺失凭据、有界失败、
外部偏好往返、公共 API 与逐记录入库。没有请求真实 API，没有在仓库或活动数据
根中保存订阅、令牌或正文。

## 非目标与后续

M1I-3 不实现：

- POST/PUT、请求体、自定义 header、OAuth 流程、Cookie、登录态或密钥管理器；
- JSONPath、JavaScript、模板脚本、字段转换表达式或任意插件执行；
- 开放网页发现、链接跟随、附件抓取或自动接受后续业务动作；
- 自动标签/联系/图谱写入、AI、Embedding、RAG 或正式知识修改。

下一窄增量是 M1I-4 受限网页订阅，随后是 M1I-5 插件产品接线。
