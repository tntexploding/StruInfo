# ADR 0038: 公开 RSS/Atom 信源订阅

- 状态：Accepted
- 日期：2026-08-27
- 里程碑：M1I-2

## 背景

M1I-1 已建立内建读取器和受信任插件适配器共用的
`SourceConnectorPort`、Registry 与 `remote_document` Evidence 入库底座，
但公开产品仍只能配置精确 GitHub Markdown 文件。上线前外部信源顺序的
下一条窄路径是 RSS/Atom：所有者需要在导入页保存公开 Feed、手动或定时
检查变化，并把每个新增或修订条目分别送入现有 Evidence → Split 主线。

RSS/Atom 不是开放网页爬虫。Feed 内的条目链接是来源引用，不授予程序继续
抓取链接、发现站点或执行 Feed 内容的权力。

## 决策

### 外部配置与公开产品边界

外部工作区偏好中的 `sourceSubscriptions` 现在是版本化 union：

- 旧记录没有 `kind` 时继续按 `github_markdown` 读取；
- 新的 `rss_atom` 记录保存标签、公开 HTTPS Feed URL、来源别名、隐私、
  1–20 条单次上限、15 分钟至 7 天间隔、启停状态、默认关闭的导入后确定性
  分流开关以及成功 connector cursor；
- 配置、游标和调度状态继续位于包体外偏好文件并随个人数据包携带，不进入
  Git、迁移 seed 或应用包体。

现有版本化 list/replace/run-now API、非重叠 scheduler 和 Import 页面共同处理
Git 与 RSS/Atom。导入页只显示这两种已接通类型；JSON API、网页和插件配置
在后续边界完成前不得显示为可用。

### 内建 RSS/Atom adapter

`builtin.rss-atom.v1` 实现 M1I-1 的同一连接器端口：

- 只接受无凭据、无 fragment 的公开 HTTPS 单一 Feed URL；
- 连接前解析主机地址并拒绝 loopback、link-local、私有、组播和明显本地域名；
- 请求不跟随 redirect，20 秒超时，Feed 最大 1 MiB，只接受 RSS/Atom/XML
  media type；
- 拒绝 DTD，使用固定的 XML 嵌套上限，不执行脚本、外部实体或 Feed 指令；
- 识别 RSS 2.0 item 与 Atom entry，按 Feed 顺序最多读取 20 条；
- 条目正文中的 HTML 复用既有服务端 HTML → Markdown 语义投影；纯文本直接
  形成 Markdown，正文后只附一个本地可回看的原始条目 HTTPS 引用；
- 不请求条目链接、图片、附件或任意嵌入资源。

精确 Feed 响应字节作为外部内容寻址原始 Blob 留存；每条条目的服务端 Markdown
投影成为独立 `remote_document` Snapshot。相同 Feed 字节、条目身份和版本继续
复用既有幂等 Evidence 写入。

### 条件请求、增量和提交规则

connector cursor v1 保存 Feed SHA-256、当前窗口的有界条目 token，以及可用的
ETag/Last-Modified。后续请求使用 `If-None-Match`/`If-Modified-Since`：

- 304、完整 Feed 字节未变，或当前窗口没有新条目版本时返回 unchanged；
- 新身份或同一身份的新内容版本按 Feed 顺序逐条入库；
- 整批 Evidence 导入以及可选的本地确定性物化/分流全部成功后，订阅服务才推进
  cursor；失败保留上一成功 cursor，可安全重试；
- ProcessingRun 的完成单位报告实际处理条目数，而不是把一批误报为单条。

连接器仍没有偏好、数据库、Entry、标签、联系、图谱、AI 或 cursor 写端口；
这些权力继续只属于主程序的既有边界。

## 依赖决定

服务端精确固定 `fast-xml-parser@5.11.0`。其八包选定闭包全部声明 MIT，
不含原生二进制和 install lifecycle；精确 lock integrity、法律文本、NOTICE 与
SPDX 已进入仓库依赖治理材料。这个依赖只负责有界 XML 结构解析，不增加网络、
数据库或插件执行权限。

## 验证与数据边界

验证只使用注入式 fetch/DNS 和合成 RSS/Atom 字节，覆盖 RSS/Atom 正文投影、
ETag 条件请求、条目新增/修订、旧 Git 偏好兼容、RSS cursor 往返、批量入库、
API union 与稳定失败。不恢复或抓取真实 Feed，不向仓库写入用户订阅或正文。

## 非目标与后续顺序

M1I-2 不实现：

- JSON API 字段映射、认证或分页；
- 网页正文抓取、站内发现、登录态、浏览器自动化或绕过反爬；
- enclosure/播客附件下载、图片抓取、全文外链补抓或跨域跳转；
- 插件安装/配置 UI、插件数据库写入、AI、Embedding、RAG 或正式知识修改。

下一窄增量是 M1I-3 声明式 JSON API；随后是 M1I-4 受限网页订阅和
M1I-5 插件产品接线。
