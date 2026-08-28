# AI Personal Knowledge OS — 前端风格规范

## 1. 产品定位

这是一个 **AI 原生、来源可追溯的在线个人信息枢纽 / Personal Knowledge Operating System**。

系统持续从用户指定或自动发现的信源中获取信息，保存捕获时的来源证据，并由 AI 完成：

- 信息筛选
- 内容总结
- 主题分类
- 实体抽取
- 关系建立
- 洞察生成
- 风险提示
- 行动建议

用户通过以下核心模块查询、审核、入库与推送：

- Knowledge Graph / 知识图谱
- Timeline / 时间线
- Ask AI / 问答助手
- Daily Brief / 每日简报
- Weekly Brief / 周报
- Evidence Review / 证据审查
- Source Provenance / 来源追溯
- Review Queue / 审阅队列

---

## 2. 核心视觉方向

### 风格关键词

- 深色
- 冷静
- 精密
- 高科技
- AI 原生
- 高信息密度
- 强控制感
- 强来源可信感
- 模块化
- 工程化

### 参考气质

整体风格应接近以下设计思想的融合：

- **Ark UI**：模块化、结构化、组件体系完整
- **Palantir Foundry**：高信息密度、关系图谱、证据链
- **Linear**：布局精密、层级克制、交互清晰
- **Raycast**：命令中心、AI 工具感
- **Obsidian**：知识关系与双向链接

目标不是“漂亮的 SaaS Dashboard”，而是：

> **一个可信、可操作、可审计的个人 AI 情报操作系统。**

---

## 3. 配色系统

### 主背景

- Graphite / Stone Black：`#1F2326`
- Near Black：`#121515`

用途：

- 页面主背景
- 左侧导航
- 深层工作区
- Evidence / Provenance 等高信息密度区域

### 次级深色

- Deep Navy：`#1C234B`

用途：

- 次级面板
- 选中态背景
- 图谱区域
- AI 工作区

### 核心强调色

- Electric Cyan：`#26CDCB`

用途：

- 当前选中项
- AI Agent Active
- 主按钮
- 图谱节点高亮
- 连接线
- Verified / Traceable 状态
- 关键指标
- Focus / Hover / Active 状态

### 辅助文字

- Primary Text：`#F3F7F8`
- Secondary Text：`#A8B0B5`
- Muted Text：`#6F7A80`

### 状态色

- Success / Verified：`#26CDCB`
- Warning：`#D9A441`
- Danger：`#D9534F`
- Topic Purple：`#7C6FE8`
- Info Blue：`#4D86FF`

---

## 4. 页面整体结构

推荐桌面端采用：

```text
┌──────────────────────────────────────────────────────────┐
│ Top Command Bar                                          │
├──────────────┬───────────────────────────────┬───────────┤
│              │                               │           │
│ Left Sidebar │ Main Workspace                │ Right Rail│
│              │                               │ / Drawer  │
│              │                               │           │
└──────────────┴───────────────────────────────┴───────────┘
```

### 左侧导航

建议固定宽度，包含：

- Command Center / 总览
- Knowledge Graph / 知识图谱
- Timeline / 时间线
- Ask AI / 问答助手
- Daily Brief / 每日简报
- Sources / 来源
- Evidence Vault / 来源证据
- Review Queue / 审阅队列
- Reports / 报告
- Settings / 设置

要求：

- 深色底
- 图标统一
- 当前项使用 cyan 边线 / 微弱 glow
- 不使用大面积渐变
- 数量 badge 尽量克制

---

## 5. 顶部 Command Bar

顶部应是全局操作中心，而不是普通导航栏。

核心元素：

- Global Search
- Ask AI
- Command Palette
- Capture
- Filter
- AI Agent Status
- Notifications
- User Profile

推荐 placeholder：

```text
Ask anything about your knowledge...
```

或：

```text
搜索信息、主题、来源或直接向 AI 提问…
```

### AI Agent 状态

例如：

```text
● AI Agent Active
```

使用 Electric Cyan 或绿色微光，但避免强烈霓虹泛光。

---

## 6. Command Center / Dashboard

### 顶部指标

建议 4–6 个核心指标：

- Captured Items
- AI Processed
- New Insights
- Connections Found
- Pending Review
- Active Sources

每张指标卡包含：

- 图标
- 核心数字
- 同比变化
- 小型 Sparkline

要求：

- 卡片高度统一
- 圆角克制
- 深蓝黑表面
- Cyan 只用于高亮信息

---

## 7. Knowledge Graph

这是产品的视觉核心之一。

### 节点类型

- People
- Projects
- Topics
- Sources
- Documents
- Claims
- Insights
- Events

### 关系类型

- 强关系：实线
- 弱关系：虚线
- AI 推断：特殊颜色 / 点线
- 来源支持：Source → Claim
- 内容归属：Item → Topic

### 交互

支持：

- Zoom
- Pan
- Filter
- Focus
- Expand
- Select Node
- Open Evidence

### 风格

- 深色网格背景
- 节点采用有限高亮颜色
- 中心节点允许轻度 Cyan Glow
- 不要做成炫技式 3D 星图

---

## 8. Live Source Feed

实时来源流应体现“系统一直在工作”。

每条信息显示：

- 来源 Logo / Icon
- 标题
- 来源类型
- 捕获时间
- AI 标签
- 可信度 / 状态

示例：

```text
Notion
PRD: AI Features v2.0
5 minutes ago
Document · Confidence 92%
```

---

## 9. AI Summary & Insights

建议包含三类核心 AI 输出：

### Key Insight

AI 自动总结的重要变化。

### Action Recommendation

用户下一步可采取的行动。

### Risk Alert

潜在风险、矛盾、异常或信息缺口。

每条 Insight 应显示：

- 结论
- 来源数量
- 可信度
- 关联主题
- 是否已审核

重点：**任何 AI 结论都必须能回到来源。**

---

## 10. Evidence & Provenance

这是整个产品最重要的差异化设计之一。

推荐表格字段：

- Claim / Fact
- Source
- Captured Time
- Confidence
- Related Topic
- Status
- Actions

状态示例：

- Traceable
- Verified
- Reviewed
- Draft
- Conflict
- Needs Review

---

## 11. Evidence Drawer

选择一个 Claim / Insight / Knowledge Node 后，从右侧展开 Evidence Drawer。

显示：

### Source Snapshot

保存抓取时的原始页面 / 文件 / 邮件快照。

### Extracted Excerpt

显示直接支持该结论的引用段落。

### Trust Score

例如：

```text
Trust Score: 88 / 100
```

可拆分为：

- Source Reliability
- Author Credibility
- Freshness
- Consistency

### Provenance Chain

```text
Captured
↓
Processed
↓
Classified
↓
Linked
↓
Reviewed
↓
Verified
```

### Metadata

包括：

- Source ID
- URL
- Author
- Capture Time
- Content Type
- Language
- Size
- Hash / Trace ID

---

## 12. Review Queue

Review Queue 应像“AI 输出的审核工作台”，而不是普通任务列表。

需要显示：

- 内容摘要
- AI 判断
- Confidence
- Source Count
- Risk / Conflict
- Review Priority

操作：

- Approve
- Reject
- Revise
- Merge
- Archive
- Use as Evidence
- Add to Library

---

## 13. Timeline

时间线用于查看“知识是如何形成的”。

事件包括：

- Source Captured
- AI Processed
- Insight Generated
- Connection Found
- User Reviewed
- Report Generated
- Knowledge Updated

需要支持：

- Day / Week / Month
- Topic Filter
- Source Filter
- Event Type Filter

---

## 14. Daily / Weekly Brief

简报不应只是“文章卡片”，而应是 AI 生成的情报摘要。

建议结构：

- What Changed
- Key Insights
- Watchlist
- Risks
- Suggested Actions
- New Connections
- Sources Used

所有结论均可点击回溯来源。

---

## 15. UI 组件原则

### 推荐

- 1px 低对比边框
- 6–10px 圆角
- 模块间距稳定
- 高密度但保留呼吸感
- 统一 Design Token
- 明确 Hover / Focus / Active
- 小范围使用 Cyan Glow

### 避免

- 大面积玻璃拟态
- 紫色渐变 SaaS 风
- 无意义大卡片
- 每个模块都发光
- 过多阴影
- 超大 Landing Page 标题
- 装饰性 3D 元素
- 为“科技感”牺牲可读性

---

## 16. 工程实现建议

前端建议：

- React / Next.js
- TypeScript
- Tailwind CSS 或 Token-based CSS System
- Radix / Ark 风格 Headless Components
- React Flow / Cytoscape 等图谱方案
- TanStack Table
- TanStack Query
- Zustand / Jotai 等轻状态管理

对于图谱、大列表和时间线：

- Virtualization
- Lazy Loading
- Incremental Rendering
- Memoization

避免一次性渲染大量节点或证据记录。

---

## 17. Codex 设计执行 Prompt

```text
使用 ark-ui-skill、frontend-ui-engineering 和 frontend-design-review。

为本项目设计并实现一个 AI 原生、来源可追溯的 Personal Knowledge Operating System。

视觉方向：
- Ark UI 风格的模块化和组件纪律
- Palantir 式信息密度与证据链
- Linear 式精密布局
- Raycast 式命令中心
- Obsidian 式知识关系网络

配色：
- Graphite Black #1F2326
- Near Black #121515
- Deep Navy #1C234B
- Electric Cyan #26CDCB

核心页面必须体现：
- Knowledge Graph
- Timeline
- Ask AI
- Daily / Weekly Brief
- Live Source Feed
- Evidence & Provenance
- Evidence Drawer
- Review Queue
- AI Agent Status

设计目标：
打造一个可信、精密、高信息密度、AI 原生的个人信息操作系统，而不是普通 SaaS Dashboard。

避免：
- 紫色渐变
- 过度玻璃拟态
- 无意义卡片堆叠
- Landing Page 风格
- 过度霓虹与装饰性动效

实现时同时保证：
- 组件化
- Design Token
- 响应式
- Accessibility
- 性能
- 清晰状态管理

完成后使用 frontend-design-review 对实现进行一次完整审查，并直接修正发现的问题。
```

---

## 18. 最终风格定义

一句话描述：

> **Ark UI 的产品结构 + Palantir 的信息控制感 + Linear 的精密度 + Raycast 的 AI 工具感 + 深黑 / 深蓝 / 电光青配色。**

最终应该让用户感受到：

- 我的信息正在持续被系统理解
- 所有 AI 判断都有证据
- 所有知识关系都可以追溯
- 系统在主动工作，但用户仍然拥有最终控制权
