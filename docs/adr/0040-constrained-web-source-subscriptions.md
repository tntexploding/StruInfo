# ADR 0040: 受限网页信源订阅

- 状态：Accepted
- 日期：2026-08-27
- 里程碑：M1I-4

## 背景

M1I-1 已提供连接器与远程文档入库底座，M1I-2/M1I-3 已接通 RSS/Atom
与声明式 JSON API。上线前还需要一种能够定时保存用户明确指定网页正文的窄路径，
但不能因此把本地产品扩张成开放网络爬虫。

## 决策

### 外部配置与范围

`sourceSubscriptions` 新增 `web`：

- 一个无凭据、无 fragment 的公开 HTTPS 主页面；
- 最多七个由用户逐条填写的根相对同源路径，与主页面合计最多八页；
- 既有显示名、来源别名、隐私、启停、检查间隔、默认关闭的导入后确定性
  分流，以及成功 connector cursor。

服务不发现或跟随页面链接，不接受第二个 origin、通配符、站点地图、递归深度、
Cookie、登录态、脚本或浏览器会话。配置与 cursor 仍保存在包体外个人偏好中，
并通过既有完整个人数据包往返。

### 内建 adapter

`builtin.web.v1` 对每个显式页面：

- 连接前拒绝 loopback、link-local、私有、组播和明显本地域名；
- 只发出 HTTPS GET，不跟随 redirect，每页限制 20 秒和 1 MiB；
- 只接受 HTML/XHTML，使用既有服务端结构化文档投影，按
  `article → main → body` 提取阅读正文，忽略 active/hidden 内容；
- 精确响应字节作为 Snapshot raw Blob，Markdown 投影进入既有
  Evidence/Fragment/Split 主线；
- 以内容摘要、ETag 和 Last-Modified 组成有界逐页 cursor。304 或相同内容不
  产生重复 Snapshot；只有全部页面读取、入库和可选确定性分流成功，宿主才推进
  cursor。

连接器仍只有读端口。数据库、偏好、ProcessingRun、隐私、游标和下游动作由
主程序拥有。

## 产品接线与验证

既有 list/replace/run-now API、scheduler、ProcessingRun 和导入页新增受限网页
类型。页面明确显示请求上限、同源路径和不发现链接的边界。

验证只使用注入式 fetch、DNS 与合成 HTML，覆盖正文抽取、隐藏/活动内容排除、
同源多页、条件请求、raw bytes、redirect、私网、URL 和配置拒绝。活动工作区
没有抓取真实网页，也没有新增迁移或依赖。

## 非目标

本增量不实现开放 URL 发现、通用爬虫、robots/sitemap 调度、登录绕过、浏览器
自动化、附件抓取、渲染后 DOM、选择器脚本、反爬规避、自动接受下游动作或
私密内容外发。
