# StruInfo Frontend Design Specification

## 报告阅读层次（2026-09-15，ADR 0083）

报告默认采用单一阅读主栏；“报告历史”按需展开，生成、核对、导出紧邻报告标题。
摘要用自然段连续阅读，段落角色保留为内部信息，不重复生成三个小标题；重要限制直接出现在正文。
同一条摘要的来源在底部去重列出；多来源摘要以段落后的简短编号保留各段出处，单来源不重复标号。
出处附近紧凑显示发布/接收日期，早于本期的文章标为补充阅读。
未入选事件默认收起在“其他阅读”中；旧稿不改写内容，也按自然段阅读。
来源返回和人工编辑应保留既有上下文及原始 AI 草稿。核对工作台从右侧按需打开，使用原生模态对话框管理焦点；关闭或 Escape 收起而不丢弃当前页面中的编辑。
保存使用开始编辑时的版本，冲突保留修改；只有保存或显式放弃后才允许切换报告。刷新浏览器前仍需保存。

## 模型价格时段（2026-09-14，ADR 0082）

AI 设置顶部提供独立峰谷开关、北京时间规则、当前状态、恢复时间和官方来源。轮询状态不覆盖未保存的开关草稿；保存冲突保留草稿。等待期间展示真实等待原因和可用的暂停/取消操作，不把等待报告标作中断。即时工具提示低价时段重试；控件保持紧凑、响应式和可键盘操作。

## 报告工作区（2026-09-13，ADR 0081）

主导航新增「报告」，位于查询与设置之间。使用现有圆润阅读主题。最初的三栏式布局由上文的阅读主栏与按需工具取代；桌面正文独立滚动，窄屏自然排版。来源入口打开资料库，返回报告时保留选择和编辑状态。选材、生成中、失败、无材料、模型关闭、来源已变化与人工核对状态必须明确；点击生成才调用模型，普通保存不能自动标成已核对。

## 接收审核交互增量（2026-09-13）

收件箱列表提供紧凑“接收审核”入口与状态筛选。详情使用现有工具面板，显示真实暂缓/拒收原因、接收原文与网页正文入口、可选人工原因、拒收、放行、恢复和本篇任务。恢复状态与执行任务是两个独立动作。设置提供可选审核规则和候选检查预算，阶段明细展示召回理由、未建立联系和额度未评估，不用百分比分数冒充模型事实置信度。

- Status: Shipped frontend baseline with an owner-approved redesign target
- Version: 1.20
- Effective date: 2026-09-12
- Scope: StruInfo web application design, implementation, and review

## Current increment: AI workflow controls (2026-09-12)

Settings → AI contains the saved policy, scope/budgets, runtime status and bounded task controls; Inbox contains the same durable queue. All progress and usage MUST come from stored records. Polling and queue filters MUST preserve an unsaved policy draft. Global pause MUST operate on saved policy; conflicts preserve the draft. The existing rounded reading theme and compact grouped actions apply to expanded forms as well as collapsed sections. Source/model secrets remain outside the Web form. No configured model means execution stays unavailable while local work remains usable.

## 1. Purpose and Authority

This document turns the product requirements and the supplied visual direction
into an implementable frontend contract.
It is normative for StruInfo frontend work and design review.

The following terms express requirement strength:

- **MUST**: required for acceptance;
- **SHOULD**: expected unless a documented reason justifies a deviation;
- **MAY**: optional and must still satisfy all higher-priority requirements.

Apply frontend guidance in this order:

1. legal, privacy, security, provenance, and data-integrity requirements;
2. `docs/product-requirements.md` and accepted ADRs;
3. this specification;
4. the supplied source direction in
   `docs/AI_Personal_Knowledge_OS_Frontend_Style_Guide.md`;
5. external design skills and high-level reference products.

External skills are authoring and review aids, not runtime dependencies.
This specification is self-contained so a contributor does not need a personal
Skill installation to follow the project contract.

## Owner-approved document workspace direction (2026-09-11)

状态：所有者已认可信息架构与视觉方向，五工作区增量完成后按 ADR 0081 增加报告入口。
当前主导航为收件箱、资料库、专题、查询、报告和设置；资料库为默认入口，批量处理从设置进入，运行总览由左上角「SI StruInfo」标志进入。
后续改造以本节替代下文的工序分页、工业风、仅深色主题、旧圆角与动效参数要求。
下文有关来源证据、业务权限、隐私、可访问性、性能和真实状态的要求继续有效。
设计确认不等于收件状态、专题存储或自动处理权限已经存在。

### 内容对象与工作区

文档和条目共同构成内容核心，各入口共享同一套内容详情和操作。
文档支持完整阅读、原文与译文切换、来源回看和结构调整。
条目支持直接阅读、标注、查询、比较和联系，不要求先回到父文档才能操作。
本次专题复用现有 Entry 图谱，围绕所选话题或条目查看、编辑有界关系。持久专题成员和自由页面搭建不在本次范围。

| 当前入口 | 主要任务                                     | 边界                                       |
| -------- | -------------------------------------------- | ------------------------------------------ |
| 收件箱   | 配置订阅、手动导入、查看已接收文档与实际任务 | 真实收件决定可恢复，原文与处理结果分别呈现 |
| 资料库   | 阅读文档和条目，在同一处调整结构、标注和联系 | 工具覆盖预留的右列，展开不挤压正文         |
| 专题     | 选择话题或条目并探索已有图谱关系             | 有界关系图，不等于持久化专题集合           |
| 查询     | 完整检索、语言切换、比较与引用导出           | 保留原有筛选、分页、隐私与来源边界         |
| 报告     | 周期选材、引用草稿、人工核对与 Markdown 导出 | 按需创建，来源可追溯，定时创建和发送未启用 |
| 设置     | 页面外观、按钮布局、全局规则、AI 状态与维护  | 外部配置按版本保存；密钥仍由服务器环境读取 |

现有拆分、标签和联系能力成为内容工作台的按需工具。
查询保留独立入口与完整筛选，知识图谱以“专题”呈现有界关系探索。
资料库优先启动；运行总览通过左上角品牌按钮进入，支持点击和键盘操作，在窄屏下也保持可达。总览显示独立的当前页状态，不归入设置分类。
重组导航时必须保留仍受支持操作的可达入口，不能以占位页面替代既有功能。

### 连续的阅读与处理

工作台由列表、阅读区和按需工具组成，默认优先阅读，同一时刻突出一种整理任务。
来源、选中对象、真实处理结果和主要操作保持可见；每个任务只突出一到两个主要操作。
切换结构、标注或联系工具时保留阅读对象与列表上下文，不把全部表单永久堆在正文旁边。
短文支持按需整篇保留，长文才按需要调整结构；标签、联系和翻译不是每份材料的必经步骤。
已有结构的替换继续使用现有预览、影响说明和明确提交边界。

切换工具和返回列表应保留选中身份、筛选、分页、滚动位置和未提交草稿。
持久恢复必须基于明确的外部存储契约，并重新校验工作区、对象版本与可见范围。
隐私可见性继续要求当前操作的显式选择；保存视图或恢复位置不能暗中扩大该范围。
未保存、正在保存、已保存和保存失败要明确区分，动画不得提前宣称写入成功。
失败应定位到对应材料及可用的重试或修正动作。

收件决定、处理结果和阅读情况是不同维度，不能合成一个模糊的“已完成”。
现有订阅检查会先保存来源证据；ADR 0080 的拒收/拦截停止后续自动整理，并可恢复待审核或人工放行。
它不表示原文从未接收，也不隐含删除证据。
保存前逐篇审批、自动创建条目或自动执行后续动作必须有各自明确的业务契约与既有授权依据。

### 自定义视图与专题集合

自定义页面先采用保存视图：对象类型、受支持筛选、排序、分组、显示字段、有限布局与侧栏固定顺序。
所有视图共享阅读和操作规则，默认界面在没有个人配置时也必须完整可用。
保存视图动态返回当前匹配材料；手动专题集合保存明确选择的成员引用，两者不可混称。
现有命名查询与选中条目上下文可以复用；ADR 0073 已定义侧栏按钮顺序、可见性与默认主题的外部配置。文档收件决定、跨会话阅读恢复和持久专题成员仍需独立契约。
会话内导出选择不是持久专题，现有自动路由工作队列也不是通用文档收件箱。
新增个人视图、状态和集合保存在外部工作区，并按相应数据类别完善个人数据包兼容性。
本方向不引入任意页面搭建器、脚本执行、隐式行为学习或额外自动处理权限。

### 圆润且层次清晰的视觉

目标是适合长时间阅读的桌面界面，使用稳定纸面、可辨识控件和克制的表面层次。
参考 [Fluent 2 elevation](https://fluent2.microsoft.design/elevation) 的层级原则与
[Fluent 2 motion](https://fluent2.microsoft.design/motion) 的状态连续性原则。
这些是设计参考，不指定新的组件库、字体、素材或运行依赖。

| 角色         | 目标规则                                                                    |
| ------------ | --------------------------------------------------------------------------- |
| 工作区背景   | 中性且安静，以表面明暗区分导航、列表与阅读区                                |
| 阅读纸面     | 不透明背景，16–20px 圆角，轻微阴影或明度层级；内部通过排版组织正文          |
| 按钮与输入框 | 8–10px 圆角，清楚边缘；按钮以填充、轻微浮起感和按压反馈表明可操作性         |
| 主要操作     | 实色填充，短按钮按内容宽度成组排列                                          |
| 选中条目     | 持续底色、侧边或形状标记及明确状态，切换工具后仍可识别                      |
| 标签与元信息 | 紧凑而安静，静态标签不伪装成按钮                                            |
| 浅色与深色   | 分别设计表面明度和对比；深色不能只依赖黑色阴影区分层次                      |
| 正文排版     | 系统中文字体、正常字距，正文以 16–18px 和舒适行距为起点，支持缩放与长文阅读 |

默认、悬停、按下、选中、聚焦、加载和禁用状态必须可辨识，必要边界不能只在悬停后出现。
保持下文既有对比度、键盘、触控目标、强制色彩和缩放要求。
柔和圆角不得以减弱文字或控件对比换取；大面积玻璃透明和低对比凹凸效果不作为主要质感。
列表与正文在桌面可采用等高框架，长内容滚动区之外保持主要操作可达；窄屏按任务顺序重排。
信源表格、图谱与维护表单使用符合自身任务的布局，不强制复制阅读工作台。
共享语义 token 和控件统一执行这些规则，不能逐页叠加不同的圆角、描边或阴影方案。

### 动效与反馈

以下数值作为新组件的初始范围，按实际位移、可读性和性能验证后统一为共享 token：

- 按压等直接反馈：约 90–150ms，立即响应输入；
- 同级阅读状态或内容切换：约 150–220ms，保留稳定框架；
- 局部工具展开与收起：约 180–260ms，帮助辨认工具属于哪个对象；
- 保存与处理结果：在当前对象旁显示真实状态，避免使整页移动或跳转；
- 减少动态效果：取消位移、缩放和装饰动效，保留清楚的静态反馈。

正文阅读期间保持稳定，不使用持续装饰运动、批量弹跳、人工等待或虚构进度。
展开工具仍受所在区域宽度约束，短按钮不能因展开状态拉满整行。

### 实施顺序与验收

1. 统一表面、按钮、输入、选中状态和反馈组件，打通单文档工作台及现有来源、译文、条目与标注调用。
2. 接通信源与收件箱，先确定最小收件状态、失败定位和外部持久化契约。
3. 整合资料库与查询，打通文档、条目、比较和有界关系探索之间的上下文返回。
4. 扩展保存视图、固定入口与持久专题集合，继续复用现有身份、权限、导出和来源边界。

每步先验证真实可执行的调用及失败路径，再逐步替换对应旧入口；不以概念示意的点击结果替代业务实现。
所有自动化验证使用合成、无个人含义的数据，真实资料与视觉证据继续保持在仓库和发行物之外。
验收围绕三条完整使用路径：新文章到达后决定如何处理、跨来源选取材料准备引用导出、中途离开后恢复工作。
报告自动生成仍是独立能力；准备材料与引用导出不能呈现为已经生成日报或周报。
各路径检查上下文连续性、原文/译文与出处、草稿/保存/失败状态，以及深浅主题、键盘、减少动态效果、长内容和窄屏。

设计实施以 `ui-visual-design-system` 为视觉参考，`desktop-app-design` 约束工作台组织，
`interaction-motion-design` 指导反馈与切换；这些技能服务于本节规则，不替代仓库规范。

### 五工作区实施增量

收件箱保留订阅列表、手动导入与实际接收记录，已接收文档可直接进入资料库。
资料库右列按“来源详情 → 调整结构 → 添加标签 → 建立联系”呈现常用操作。
桌面预留该列，编辑面板覆盖按钮区而不改变正文宽度；来源片段、人工/规则/AI 拆分、条目和整篇文档标签以及现有图谱编辑复用原接口。
同一文档切换工具时保留未提交标注与结构草稿；窄屏把工具放在正文后，保持完整宽度。

专题沿用现有关系图与等价列表，关系检查栏和图谱在桌面限制为一屏高度。
查询将数量放在搜索标题旁、图谱入口放在搜索动作旁；正文旁集中语言和出处控制，资料清单与更多工具默认收起。
查询顶部的保存查询、筛选和索引维护采用锚定触发按钮的悬浮菜单，同时只展开一个；展开不改变结果列表或正文的位置与高度。
菜单限制在可视区域内，长表单独立滚动，保留可见收起入口；支持再次点击、点击外部及 Esc 收起，键盘关闭后返回触发按钮，未提交内容在切换菜单时保留。
设置汇集共用规则与维护操作，AI 页只展示真实能力及现有外部接入方式。

侧栏的有序按钮子集和默认外观通过 ADR 0073 的接口保存在外部偏好，旧配置保持默认布局，冲突保留草稿并要求重新读取。
隐藏的功能仍可从各页“更多操作”进入。顶部主题选择是本次页面预览，设置中的默认外观是持久值。
本增量不保存隐私可见性、模型密钥、任意脚本、执行权限或新专题成员。

### 首个实施增量（历史记录）

默认资料库复用现有文档列表、原文读取、条目分页、按需翻译和标注保存接口。
桌面文档列表与阅读纸面等高、各自滚动，短操作在工具栏内组合；只有一个条目时不显示多余的选择和分页控件。
标注工具按需展开，保存后留在原条目并返回标注入口的键盘焦点；正文修改为次级展开项。
结构调整继续使用已有预览和提交工具，从文档工作台携带明确文档范围进入，并提供返回该文档的操作。
来源侧栏也可显式打开资料库中的对应文档，隐私文档的按钮明确标明隐私范围。

文档筛选、选中条目、条目分页、原文/译文各自滚动位置和标注草稿在本次应用会话内保留。
草稿绑定原始条目版本；读取到新版本时显示旧草稿提示，不将旧草稿自动套用到新版本。
刷新浏览器不保留这些会话状态；文档阅读恢复、通用收件箱、专题及侧栏个人布局仍未新增持久化。
迟到请求和保存反馈按文档、条目及隐私范围隔离。退出资料库进入普通导航后重置其隐私范围。

共享语义色板提供跟随系统、浅色、深色；外观选择只保存在当前页面会话。
阅读纸面为 18px 圆角，控件为 10px，直接反馈为 120ms，工具展开为 200ms。
整页不做位移动画；减少动态效果时关闭工具动画和按压位移。
本增量没有新增依赖、业务路由、数据表或自动处理权限。

## 2. Design Contract

The fixed design contract is:

| Axis                     | Decision                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Product identity         | A trustworthy, source-traceable, AI-augmentable knowledge workspace                                          |
| Visual family            | `struinfo-industrial`, an original black/white/cyan industrial information system                            |
| Full-product depth       | `complex / 3`: multi-zone shell and complete shared component treatment                                      |
| M0-S depth               | `moderate / 2`: recognizable shell and states without fake product data                                      |
| Historical M1C depth     | `complex / 3`: retired four-workspace runtime retained only in design history                                |
| M1E depth                | `complex / 3`: five-stage Entry workflow, overview and reserved Formal Knowledge page                        |
| Primary evidence pattern | Black edge shell, cyan active rule, indexed sections, precise provenance dossier                             |
| Primary user question    | What is worth retaining or exploring, what knowledge changed, what supports it, and what can I control next? |

The interface MUST feel like an operating workspace, not a marketing landing
page or a generic card dashboard.
Information architecture and truthful state MUST remain legible before any
decorative layer is noticed.

The design may use high-level industrial and editorial patterns associated with
the Ark UI family, but MUST remain an original StruInfo implementation.
It MUST NOT copy protected logos, screenshots, character art, production
bundles, proprietary fonts, or exact coordinates from reference products.

## 3. Product Experience Principles

### 3.1 Evidence before confidence

Every important AI output MUST expose its evidence path.
The interface MUST distinguish at least:

- source excerpt;
- source claim;
- AI-derived summary;
- AI inference;
- user-authored assertion;
- user review state.

The interface MUST NOT compress trust into one ambiguous score such as
`Trust Score: 88 / 100`.
When data exists, show the following dimensions separately:

- traceability to a captured snapshot and exact fragment;
- source assessment and its scope;
- extraction confidence;
- entity or relation confidence;
- independent corroboration or conflict;
- freshness and relevant time type;
- review status and reviewer.

An absent dimension MUST read `未评估` or an equally explicit unknown state.
It MUST NOT be replaced with a generated number.
User confirmation means the user accepted the record or confirmed what a source
said; it MUST NOT be rendered as proof that the claim is objectively true.

Information value, current interest, exploration value, noise, and factual
reliability are separate concepts.
The interface MUST NOT use interest as proof, source quality as a reason to
force attention, or one aggregate score to hide these dimensions.
When an item is surfaced to break an information bubble, the UI MUST explain
the exploration type, such as adjacent expansion, cross-domain connection,
foundational gap, emerging signal, viewpoint diversity, or serendipity.

### 3.2 AI is visible but not anthropomorphized

AI is optional. The interface MUST remain fully operable for capture, content
classification, intake decisions, manual splitting, editing, typed relations,
recomposition, revision history, deterministic search, export, and restore when
no model or embedding provider is configured. `AI 未启用` is a capability state,
not a product failure, and MUST NOT disable non-AI actions.

AI-generated or AI-modified content MUST carry a persistent origin label such
as `AI 生成 · 待审核` or `AI 生成 · 策略自动入库` according to its real state.
The label MUST remain associated with the content when it is copied into a
drawer, brief, graph dossier, or review view.
Policy-authorized content MUST also expose the policy name/version and a route
to inspect, pause, or override the decision; automatic admission never removes
AI origin.

`AI Agent Active` or similar status text MAY appear only when it reflects a real
runtime state.
The interface MUST NOT invent model activity, progress, telemetry, or system
codes for atmosphere.

### 3.3 User control remains explicit

High-impact actions such as approve, reject, merge, archive, replace, delete,
or push MUST use visible action verbs.
They MUST NOT be represented by unexplained icon-only controls.

Each view SHOULD expose one primary action and at most one co-primary action.
Secondary operations SHOULD use progressive disclosure.
The next state and any irreversible consequence MUST be clear before commit.
Automatic decisions MUST provide a visible reason, scope, policy version, and
manual takeover path.

### 3.4 Failure is a first-class state

Loading, empty, partial, stale, offline, unauthorized, conflict, and failed
states MUST be designed alongside the success state.
An error MUST explain what failed, what remains safe, and what the user can do
next.
One generic `完成` state MUST NOT hide independent fetch, AI, storage, or
delivery failures.

### 3.5 Density has structure

StruInfo SHOULD be information-dense, but density comes from hierarchy,
alignment, compact metadata, and progressive disclosure.
It MUST NOT come from tiny essential text, repeated metrics, border boxes around
every region, or decorative telemetry.

Every persistent datum MUST have one visual owner.
For example, a candidate row owns comparable status fields, while its evidence
drawer owns the supporting excerpt and provenance details.
The same number SHOULD NOT be repeated in both places merely to fill space.

## 4. Phase-aware Information Architecture

Current working navigation is `总览 / 导入 / 拆分 / 标签 / 联系 / 查询 / 知识`. The owner-facing `知识` label retains the existing Formal Knowledge domain boundary. The seventh destination follows Query and implements the bounded Entry-centred shape and automatic/user edge rules accepted by ADR 0010/0011. It is a distinct graph workspace, not the retired KnowledgeItem editor. Only implemented routes MAY expose controls or live metrics.

The active non-AI task path is:

```text
external source document
  -> immutable Snapshot and Fragment evidence
  -> current InformationEntry materialization
  -> content / type / domain tags plus independent usefulness / interest
  -> explainable Entry associations and manual overrides
  -> privacy-scoped deterministic Entry search and exact source return
  -> highest-match Entry centre + bounded formal graph + relation edits
```

The former Review Queue, Knowledge Change Set editor and deterministic Knowledge
search are retired application surfaces. Their historical data and design
records do not authorize hidden navigation or API calls.

Scheduled acquisition, Daily and Weekly Briefs, QQbot, public integration APIs,
a whole-workspace graph canvas, complete Timeline, and mixed online query are
later modules unless a tracked milestone explicitly releases them. M1E-2's
bounded centre-neighbourhood graph and editable edge sources are separately
accepted by ADR 0010 and ADR 0011.

## 5. Application Shell

### 5.1 Desktop composition

The full product uses four structural zones:

```text
top command bar
left navigation | main workspace | contextual evidence rail
```

Recommended dimensions are tokens, not one-off component values:

- command bar: `64px`;
- expanded navigation: `232px`;
- compact navigation: `72px`;
- evidence rail: `clamp(360px, 30vw, 480px)`;
- main workspace: `minmax(0, 1fr)` with no arbitrary dashboard max-width.

The main workspace owns the current task.
The left rail owns navigation.
The right rail owns additional context for the selected record.
The command bar owns global search and genuinely global actions.

Do not put the same action in the command bar, page header, card header, and
footer at the same time.

### 5.2 Responsive recomposition

Required verification widths are `320px`, `390px`, `768px`, `1024px`, and
`1440px`.

| Width or condition | Required behavior                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `>= 1200px`        | Expanded or user-collapsible left rail; contextual rail may remain docked                  |
| `768px-1199px`     | Compact rail; contextual rail becomes a dismissible overlay or replaces a secondary column |
| `< 768px`          | One-column workspace; navigation becomes a disclosed menu or bounded bottom strip          |
| Portrait           | Recompose actions and drawers; do not scale desktop absolute positions                     |
| Short-wide         | Preserve primary content and actions; reduce optional instrumentation first                |

Essential actions MUST remain reachable without horizontal scrolling.
Tables MAY use a contained horizontal scroll region when a meaningful stacked
alternative would destroy comparison.
The document itself MUST NOT overflow horizontally.

### 5.3 M0-S shell profile

M0-S implements only an operational-health shell.
It MUST NOT fabricate sources, knowledge counts, AI activity, insights, graphs,
notifications, or review work.

The initial screen SHOULD contain:

- StruInfo product identity and a short `Personal Knowledge OS` descriptor;
- one semantic page heading for system readiness;
- the exact API health state: loading, ready, not ready, or unexpected error;
- role and database readiness when supplied by the contract;
- one explicit retry action when retry is supported;
- a visible development/mock label when deterministic mock transport is active.

The M0-S screen uses `moderate / 2` depth: one edge shell, one quiet blueprint
rule or grid layer, indexed metadata, restrained reveal, and complete responsive
states.
It does not need the full long-term navigation or a synthetic dashboard.

### 5.4 Current product boundary

The Web application and narrow loopback API expose one owner workflow:
Evidence/Blob import, deterministic or local-manual Entry materialization,
current Entry/Document tagging, explainable associations, privacy-aware Entry
search, external preferences, complete personal-data-package transfer, and
provider-neutral ProcessingRun read/cancel. ADR 0013 through ADR 0015 additionally
expose three optional OpenAI
proposal surfaces: one selected public Snapshot for split, one selected public
Entry for tags, and one selected public Entry pair for association. Each surface
must show Provider/model/prompt origin, privacy disclosure and explicit
accept/reject without hiding its deterministic or manual path.

ADR 0036 adds an explicit local multi-file mode to Import. It MUST keep the
single-file path available, identify the batch as session-only, show per-file
preparing/ready/running/success/failure/stopped state and an aggregate progress
indicator, and provide visible retry and stop-after-current actions. A stopped
in-flight request MUST NOT be rendered as cancelled. Narrow screens MUST stack
file facts and actions without document-level horizontal overflow. The surface
MUST say that it reads only explicitly selected files and does not scan
directories or start Split, Tags, Associations, Automation or AI work. While a
queue has items, source and single/batch mode switches MUST remain locked until
the owner clears the queue; while it runs, shared privacy, date, parser and
preface controls MUST remain locked. The client MUST NOT discard files merely
because their name, size and modification time match.

ADR 0016 adds a dedicated local manual grouping workbench to the Split page. It
MUST:

- operate only on a selected Snapshot that has no Entry structure;
- show an explicit empty, private-locked, loading, load-failure and already-
  materialized state;
- begin with ordered section Fragments and permit only adjacent merge, split at
  an existing Fragment boundary, reset, merge-all and bounded title editing;
- keep full-document and exact per-Fragment text inspectable without forcing a
  fixed-height viewport or hiding actions;
- submit only titles and Fragment identities, never browser-authored Entry body
  text;
- retain a monotonically increasing load generation so a late Snapshot response
  cannot replace a newer selection; and
- recompose into one column below 1200 CSS pixels while preserving natural
  vertical scrolling and target sizes.

The manual workbench MUST NOT imply arbitrary character selection, source-text
editing, reordering or replacement of already materialized Entries.

ADR 0035 adds a secondary configurable local-rule panel to Split. It MUST keep
the existing one-section behavior as the default, present short-adjacent merge
as a plain-language alternative, separate unsaved draft/save/preview/apply
states, and disable apply until the preview exactly matches the saved profile
revision. Preview groups must expose title, Fragment count, scalar count and a
bounded local excerpt. Private material remains locked until the current Split
scope explicitly opts in. Below 1200 CSS pixels controls and preview recompose
into one column with natural page scrolling. The panel MUST NOT present scripts,
regular-expression programs, source reordering, Provider inference or silent
background execution as supported rule types.

Manual Curation, the old formal Knowledge writer/current-item reader and the old
Knowledge search are not current product capabilities. Their pages, client
contracts and server routes MUST NOT be restored as secondary or hidden tools.
The `知识` page implements the graph, edge-origin and retrieval semantics accepted in ADR 0010/0011 and the relation-maintenance boundary in ADR 0042. It uses the existing Association override with six graph metadata columns: origin, label, direction, semantic kind, source-review status and note. It does not add a parallel graph store. Automatic similarity MUST be labelled calculated rather than source-checked; the edge inspector MUST expose both endpoint evidence actions before the user records a source-review state.

Privacy is explicit and local to the action being taken:

- import offers an unchecked private-document control before submission;
- Entry views and search default to public-only and may explicitly include or
  show only private results;
- a previous result or navigation event MUST NOT silently broaden a later view;
- privacy state uses text in addition to color; and
- private source bytes and complete text open only within the explicitly
  broadened current scope.

This visibility boundary is not encryption or multi-user authorization. The UI
MUST NOT claim otherwise.

### 5.5 Entry workspace profile

M1D adds Entry browsing, annotation, and search to the existing shell. It MUST
not relabel an Entry as formal knowledge or force the advanced knowledge editor
into the routine path.

The first vertical slice has one clear task: select an existing document,
materialize or open its current Entries, edit the three keyword dimensions, and
search the saved result with an exact source route. The screen MUST expose:

- Snapshot/document identity and Entry order;
- current Entry body and precise evidence location;
- editable free content keywords;
- exactly one type keyword;
- one primary domain and at most two secondary domains;
- explicit save state and actionable failure state;
- deterministic body/keyword match reasons; and
- a clearly labelled route to the working Formal Knowledge page without mixing graph editing into routine Entry annotation.

Type and domain choices are system protocol values and use concise Chinese
labels. A selected `其他` value reveals a dimension-specific custom-name field;
the UI MUST NOT reuse one custom value between type and domain. Actual content
keywords and custom names come from the active workspace and MUST NOT be
compiled into frontend fixtures or defaults.

Privacy remains action-scoped. Ordinary Entry lists, counts, suggestions,
related-item sections, search, and complete-document results exclude private
content. The user must explicitly enable `查询隐私文档` for the current view
before any private Entry, association, or complete document becomes visible, and
the expanded scope must remain visibly marked. Complete private documents use a
separate result channel and reveal full evidence only after an explicit action.

The minimal slice may omit document-tag aggregation and automatic association
scoring, but it MUST present those absent capabilities honestly instead of
fabricating candidates, counts, or AI activity. At 320/390/768/1024/1440 widths,
Entry body, keyword controls, save action, search results, and source return must
remain reachable through normal document scrolling and keyboard order.

### 5.6 Current owner workflow shell

The primary browser information architecture MUST use seven currently working destinations in this order: `总览`, `导入`, `拆分`, `标签`, `联系`, `查询`, and `知识`.
The five processing workspaces form one continuous timeline; `总览` is its home
and status surface. Retired review and Knowledge tools MUST NOT appear as
secondary maintenance routes.

Each workspace has one dominant task and a visibly subordinate context area:

- `总览` shows current external-workspace counts, the five processing stages,
  and a separate provider-neutral task rail backed by the public recent-run
  boundary. It derives stage, percentage, current step, proposal count and cancel
  eligibility only from actual records. Empty storage says there are no tasks;
  absence of all AI capability values separately says AI is not configured;
- `导入` places source/privacy/alias/format/date and optional prefatory-text
  fields in the dominant panel, imported-document history in a secondary panel,
  and whole-workspace Bundle import/export in a distinct lower band;
- `拆分` separates structure/rule controls and generated Entry order from the
  full-text or selected-segment inspection surface. Immutable Snapshot evidence
  MUST NOT be presented as destructively editable source data. When `ai_split`
  is available, the selected public Snapshot may explicitly start one proposal,
  inspect groups through local exact Fragment text, and accept or reject it;
- `标签` keeps Entry/Document selection beside an editor for the independent
  content, type, and domain dimensions. When `ai_tags` is available, one selected
  public Entry may explicitly start, inspect, accept or reject a proposal.
  Full-document and private-content views require an explicit current-view control;
- `联系` gives candidate associations and their evidence the main area, with
  current-entry selection subordinate to it. Its public versioned-policy editor
  exposes content/type/domain weights, threshold, revision, save feedback, and
  the resulting automatic rebuild; pair-specific overrides remain visibly separate;
- `查询` gives the search input visual priority, Entry results the main reading
  area, a distinct complete-private-document channel when explicitly enabled,
  and privacy, source, structural, keyword, and association scope a compact
  settings rail. Result details and precise evidence remain one action away.

A requested capability that is not backed by the current public product boundary
MUST be labelled unavailable or pending rather than simulated. The M1F-3 panel
MUST remain visibly unavailable unless `ai_query_synthesis` is returned;
semantic and hybrid controls MUST remain unavailable unless
`semantic_entry_search` is returned. This always applies to automatic proposal
acceptance, private vector matching and external retrieval. Query's exact,
contains and approximate controls
MUST be described as local lexical matching; approximate results show a bounded
lexical score and MUST NOT be styled as probability, confidence or semantic
equivalence. A real imported or deterministic ProcessingRun may still be shown and
cancelled through `processing_runs`; this MUST NOT be relabelled as generic AI
availability. `ai_split`, `ai_tags`, and `ai_associations` independently enable
only their Split, Tags, and selected-pair Formal Knowledge proposal surfaces.
`ai_query_synthesis` independently enables only the ADR 0022 Query result
synthesis surface; none of these capabilities unlocks another AI control.
Deterministic and manual paths, including association-policy writes, remain
fully usable.

ADR 0021 adds two Query-owned result tools. An explicit Association switch uses
the currently selected visible Entry as the existing one- or two-hop anchor and
must show that this is local deterministic traversal rather than AI or semantic
equivalence. Query may also compare at most two results from the same semantic
query scope. The comparison shows separate source, revision, privacy, lexical
match, structure, usefulness, interest, tag, body and evidence facts; it must not
invent a winner, combined score, summary or relation. It may persist across
cursor pages only while the semantic query and privacy scope remain unchanged,
and becomes invisible immediately when either changes. At widths below 1024 CSS
pixels comparison cards stack in one column and retain natural page scrolling.

ADR 0022 defines the current Query-owned AI surface. Search remains the only
primary action. After a non-empty public result, a secondary “AI 综合当前结果”
action opens one answer panel below the local result controls. It MUST NOT
run on typing, filter changes, paging, result selection or page entry.

Before the first Provider call in a page session, the panel MUST state that
bounded text from the current public result set will be sent to the configured
OpenAI model. When `includePrivate` or `onlyPrivate` is active, the action is
disabled with a plain-language reason; a local privacy opt-in MUST NOT be styled
as external-transfer permission. Provider absence, empty evidence, timeout,
invalid output and stale scope are actionable visible states rather than blank
panels or generic failures.

A successful panel hierarchy is:

```text
AI 综合 · 仅基于当前公开查询结果
answer
evidence status + model + prompt version
claim list with local E01..E08 evidence actions
limitations and truncation notices
```

The answer is visually subordinate to retrieved records and MUST be labelled as
AI-generated without relying on colour. Claim evidence chips open the
application's local Entry/source view; they are not model-authored Web citations.
The panel does not present a chat composer, autonomous tool state, confidence
percentage, “verified” badge or save-to-knowledge shortcut. Search/filter,
Association or privacy changes immediately remove the old answer, and request
identity prevents a late response from reappearing.

At widths below 1,024 CSS pixels, answer, claims and evidence stack into one
column with natural page scrolling. The primary search, privacy state, AI
disclosure, status announcement, retry and evidence actions remain keyboard
reachable. Loading uses an in-place status/skeleton and MUST NOT replace or hide
the deterministic result set.

ADR 0043 adds the M1K Query retrieval controls without replacing that hierarchy.
The mode selector presents `词法 / 语义 / 混合` as one labelled radio group next
to, but distinct from, exact/contains/approximate lexical matching. Empty query
or either private scope forces lexical mode. Semantic and hybrid modes show
vector similarity and final retrieval score as separate facts; neither is a
truth, confidence or source-quality score.

A secondary index panel reports the real public Entry, current projection,
embedded projection, stale projection and term counts, tokenizer/model identity,
and ready/not-ready state. ADR 0066 makes explicit incremental refresh the routine
action: each request processes at most 32 changed or obsolete items, with actual
remaining counts, pause-after-current-batch, continuation and retry feedback.
Committed work survives page closure; leaving MUST stop subsequent requests and
late responses MUST NOT replace a newer view. Provider failure preserves local
terms and explains how to retry or continue lexical Query. Full rebuild stays
inside a secondary repair disclosure with tokenizer/index identity, term count
and the cost of regenerating all configured vectors. It MUST NOT fabricate
background indexing or ProcessingRun progress. If no embedding
model is configured, local term rebuilding and lexical Query remain available
while semantic controls explain why they are unavailable. RAG synthesis labels
semantic/hybrid use as local evidence retrieval followed by AI synthesis; it
does not present a chat, autonomous Web search or private-content permission.
At narrow widths the mode group and index facts wrap or stack in normal reading
order and do not hide the search input or results.

ADR 0068 adds a secondary “来源复核” action in Knowledge. It opens a bounded
relationship queue with explicit verification and privacy filters, both Entry
sources, a review note and “保存并继续”. The ordinary batch is 20 pairs; next/previous
batch actions preserve a scope-bound cursor. The list has a bounded scroll area
so narrow screens can reach the selected review without crossing the whole queue.
Stored checks without version bindings and checks of changed Entries are labelled
as needing review. Show current and previously reviewed versions separately,
preserve calculated/user/AI origin and direction, and never imply factual proof.
Saving binds the displayed Entry and override revisions. Conflicts provide a
fresh-read action; privacy/filter changes clear evidence and invalidate late
responses. Returning to the graph starts from public scope. Both source headings
have unique accessible identities, native controls remain keyboard reachable,
and the two source columns stack on narrow screens.

ADR 0067 adds a secondary saved-query disclosure in the Query settings rail.
The owner can save, update, rename, delete and explicitly reopen at most 20
queries. Names and conditions remain external personal preferences; result
bodies, cursors, comparisons and AI answers are never stored there. Reopening
reruns the query and reads the selected Entry's current version. A selection
outside the current result page is labelled separately and does not change
matching, ordering or counts. Missing entries and unavailable Association or
semantic modes provide an actionable recovery route.
Every reopened private view requires a fresh scope choice before private
results or reading positions are fetched. Query-to-source and Query-to-graph
actions preserve the current request's evidence scope; returning from the graph
restores conditions and selection. Navigation context is memory-only.
Saved-query controls wrap in their own layout flow, remain keyboard reachable
and show loading, empty, conflict and retry states.

ADR 0069 adds a secondary Query disclosure for a cited Markdown list. The owner
explicitly selects up to 20 current results across cursor pages, previews versions,
privacy and sources, then generates and downloads the file. Selection order is
export order. Scope changes and navigation clear selection, preview and download;
late responses cannot reintroduce private content. Title or selection changes
invalidate preview. Source text is literal, scrollable and keyboard accessible;
current Entry excerpts, original evidence and existing relationship origins remain
distinct. Generation has an explicit private-scope label and visible error/retry
states. No automatic file creation occurs during search, paging or selection.

ADR 0023 adds one separate local exploration panel after the ordinary Query
results. It MUST remain visually and behaviorally independent from search
matching, order, count, pagination and cursor state. Exploration is default-off
external personal configuration; the panel shows its enabled state, an exact
0–50% current-page share, and independent neighbor-expansion, cross-domain and
serendipity switches. A policy change is saved explicitly before use.

Exploration MUST NOT run on typing, search, paging, selection or filter changes.
The owner selects one visible Entry and explicitly requests candidates. Each
candidate shows one plain-language reason, local Association score/basis,
same/cross-document scope and exact-source action. The panel labels candidates
as local navigation suggestions rather than facts, AI recommendations or
semantic equivalence. Query/privacy/anchor changes clear the panel immediately;
request identity prevents late responses from restoring an obsolete scope.
Disabled, loading, empty and failed states stay visible without hiding or
changing the ordinary result list. On narrow screens policy controls and cards
stack with natural page scrolling and no horizontal overflow.

Desktop layouts SHOULD preserve a narrow workflow timeline, a dominant work
surface, and at most one contextual side rail. Tablet layouts MAY stack the
context rail below the dominant task. At phone widths the navigation items
MAY become a bottom bar, but all seven labels, current-page indication, primary
action, privacy state, errors, results, and source-return controls MUST remain
reachable without horizontal page scrolling. Pages use natural vertical
scrolling; they MUST NOT hide unfinished controls to force a single viewport.

### 5.7 M1E-2 Formal Knowledge workspace profile

The Formal Knowledge workspace is a contextual graph-navigation and formal-
relation maintenance surface. It MUST NOT duplicate the exhaustive Query result
page or restore the retired KnowledgeItem editor.

Its desktop hierarchy is:

```text
simple centre search + compact alternative matches
bounded formal graph                    selected node / relation dossier
```

The search control uses deterministic Entry matching. The highest visible match
becomes the centre by default, while alternative matches remain available for an
explicit centre change. Search is subordinate to the graph task: it does not
show the full paginated Query result set.

The graph MUST:

- use current InformationEntry records as nodes without copying their bodies;
- show visible deterministic similarity associations and user-created/user-edited relations as edges;
- display edge origin, label and direction without relying on colour;
- load a bounded direct neighbourhood first and expand or recenter only after an
  explicit action;
- keep exact Snapshot/Fragment evidence one action from every node;
- distinguish automatically calculated, user-edited and user-created edges;
- apply public-only, include-private, or private-only scope before centre
  selection, neighbour loading, counting, traversal, and rendering; and
- never render the entire workspace by default.

The dossier owns the selected node or edge. A node dossier shows current Entry
content, three keyword dimensions, privacy state and exact evidence. A relation
dossier shows both endpoints, automatic/user origin, score and explanation when
applicable, relation label, direction, current state and the available edit,
hide/delete, restore or create action. The page has one primary action at a
time; graph navigation and relation editing must not compete as equal button
clusters.

A searchable list/tree mode MUST expose the same essential nodes and edges. At
phone widths the graph and list/tree modes replace each other in the main
surface, alternative matches become a compact disclosure, and the dossier opens
as a drawer or routed detail. Search, centre selection, adjacent-node traversal,
edge selection, recenter, bounded expansion and evidence return MUST be keyboard
operable.

The M1E-2 implementation uses a dedicated workspace component and stylesheet rather than routing graph behavior through Query or Associations page modes. Empty workspaces show an honest no-match state; active controls are backed by the public graph read/edit routes. The base graph remains bounded to direct neighbours; M1E-3C may add only the explicit selected-pair association proposal described in section 9.5. The page does not fabricate full-workspace layout, facts, or unsupported graph analytics.

## 6. Design Tokens

All visual values MUST be reached through semantic `--si-*` custom properties
or an equivalent typed token layer.
Components MUST NOT introduce raw hex colors or arbitrary spacing when a project
token already expresses the role.

### 6.1 Color

```css
:root {
  color-scheme: dark;

  --si-color-bg-canvas: #121515;
  --si-color-bg-shell: #0d1011;
  --si-color-surface-1: #1f2326;
  --si-color-surface-2: #252b2e;
  --si-color-surface-ai: #1c234b;

  --si-color-text-primary: #f3f7f8;
  --si-color-text-secondary: #a8b0b5;
  --si-color-text-muted: #879298;
  --si-color-text-disabled: #6f7a80;

  --si-color-border-subtle: #2b3134;
  --si-color-border-default: #394146;
  --si-color-signal: #26cdcb;

  --si-color-warning: #d9a441;
  --si-color-danger: #d9534f;
  --si-color-danger-text: #ff7c77;
  --si-color-topic: #7c6fe8;
  --si-color-topic-text: #a99eff;
  --si-color-info: #4d86ff;
  --si-color-info-text: #8db0ff;
}
```

Neutral surfaces SHOULD occupy at least three quarters of a representative
screen.
Electric cyan is reserved for current selection, focus, the primary action,
real active processing, traceable state, and important graph edges.
It MUST NOT become the color of all headings, body text, and borders.

The supplied muted color `#6f7a80` is below the normal-text contrast target on
the approved elevated surfaces.
It is therefore a disabled or decorative token.
Readable muted text uses `#879298` or a later verified equivalent.

The base danger, topic, and information colors MAY identify borders, icons, or
filled badges.
Their lighter text variants MUST be used for normal text on dark surfaces.
Color MUST NOT be the sole carrier of any state.

### 6.2 Typography

No font file is admitted by this specification.
Use system and already-installed fallbacks until a font receives dependency and
license review.

```css
:root {
  --si-font-ui:
    'Noto Sans SC', 'Source Han Sans SC', 'Microsoft YaHei UI', 'PingFang SC',
    system-ui, sans-serif;
  --si-font-display:
    'Bahnschrift SemiCondensed', 'Arial Narrow', var(--si-font-ui);
  --si-font-mono: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;

  --si-text-xs: 0.75rem;
  --si-text-sm: 0.8125rem;
  --si-text-body: 0.875rem;
  --si-text-control: 1rem;
  --si-text-title: clamp(1.625rem, 2.5vw, 2rem);
  --si-text-reading: clamp(1.25rem, 2vw, 1.625rem);
}
```

Rules:

- use one `h1` for each routed page and do not skip heading levels;
- keep Chinese body text at normal tracking and comfortable line height;
- use uppercase Latin only for short section labels, status keys, and indices;
- use tabular numerals for timestamps, counts, hashes, and coordinates;
- do not use oversized landing-page titles inside operational workspaces;
- essential text MUST NOT be smaller than `0.8125rem` at default zoom;
- mobile inputs SHOULD use at least `1rem` text.

### 6.3 Spacing and sizing

Use the following spacing scale:

```text
2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64px
```

Use `4px` as the base unit.
Values outside the scale require a component-level reason, such as a 1px rule
or a responsive viewport calculation.

Interactive targets MUST be at least `40x40px` on pointer-oriented desktop
layouts and `44x44px` on touch layouts.

### 6.4 Radius, rules, and elevation

Use a restrained radius hierarchy:

- `0px`: stage geometry, rules, table edges, clipped decoration;
- `4px`: compact status and data controls;
- `6px`: standard inputs and buttons;
- `8px`: drawers, dialogs, and large functional surfaces;
- values above `10px`: only circular or semantically pill-shaped controls.

Use 1px low-contrast rules and one strong edge instead of four-sided card
chrome wherever possible.
Depth comes from surface contrast, masks, overlap, and information hierarchy.
Heavy stacked shadows and broad glass effects are prohibited.

### 6.5 Iconography and texture

Use one consistent original or approved open-source line-icon system with
`1.5-2px` strokes.
Icon-only controls require an accessible name and are limited to familiar
secondary actions.

Blueprint grids, directional rules, corner brackets, and clipped wedges MAY be
generated with original CSS or SVG.
They MUST be low contrast, ignore pointer events, and support grouping,
direction, state, or product identity.
Random scanlines, terminal noise, hexagons, and fake readouts are prohibited.

## 7. Motion

Use motion to reveal hierarchy and confirm real state:

```css
:root {
  --si-motion-direct: 240ms;
  --si-motion-reveal: 650ms;
  --si-motion-attention: 1800ms;
  --si-motion-ease: cubic-bezier(0.22, 0.8, 0.2, 1);
}
```

M0-S MAY use one masked or directional page reveal and direct hover/focus
feedback.
The full product MAY coordinate reveal and real-state attention motion.

Nonessential loops MUST stop under `prefers-reduced-motion: reduce`.
Reduced motion MUST preserve state clarity and focus, not simply remove all
feedback.
Do not animate decorative properties continuously on dense data screens.

## 8. Shared Component Model

Prefer composition over large configuration objects.
Colocate a focused component, its styles, tests, and local types.
Separate data access and state orchestration from presentational rendering.

More than 200 lines is a review signal, not an automatic violation.
Split a component when it has multiple reasons to change or cannot be tested in
isolation; do not split cohesive code to satisfy a number.

The shared component vocabulary SHOULD grow around real use:

- `AppShell`;
- `CommandBar`;
- `PrimaryNavigation`;
- `WorkspaceHeader`;
- `StatusBadge`;
- `SourceReference`;
- `AiOriginLabel`;
- `IntakeDecisionControls`;
- `ValueAssessment`;
- `ExplorationReason`;
- `ProcessingPlanSummary`;
- `KnowledgeChangeSet`;
- `MediaUsageLabel`;
- `EvidenceDrawer`;
- `ReviewActions`;
- `DataTable`;
- `EmptyState`;
- `ErrorState`;
- `LoadingState`;
- `Dialog` and `Drawer`;
- `GraphViewport` and its accessible list alternative;
- `TimelineList`;
- `BriefSection`.

Do not create a speculative component library before a component has one real
consumer and a credible second use.

## 9. Component and Page Patterns

### 9.1 Command bar

The command bar is a global operation surface, not duplicated page navigation.
Search, Ask AI, Capture, filters, notifications, and agent status appear only
after the corresponding behavior exists.

Search and Ask AI MUST communicate their scope: saved knowledge, current online
material, or mixed results.
Capture MUST make the destination and subsequent review state clear.

### 9.2 Entry tags and current-state editing

The Tags page owns routine manual annotation. For the selected Entry or complete
Document it presents:

- exact source identity and a direct evidence route;
- content, type and domain tags as separate dimensions;
- independent five-position usefulness and interest controls;
- editable deterministic keyword candidates;
- user-managed quick tags, exclusions and user-confirmed aliases; and
- a single explicit save action with visible success or failure.

Usefulness and interest MUST NOT be collapsed into a combined preference or
truth score. Case-only duplicates are normalized deterministically; bilingual or
semantic equivalence requires an explicit user alias. URL targets, paths and
attachment names are excluded from candidates by default.

If external preference storage is unavailable, manual annotation remains usable
with a visibly session-only fallback. Quick tags and aliases remain external
personal data and never become source constants or migration seeds.

Routine edits update one current finished Entry state with an optimistic
concurrency version. The UI MUST NOT recreate intake actions, judgment reasons,
manual-link intent, the old review queue or a KnowledgeChangeSet editor.
Associations are edited only through the current association page and its
enhance/weaken/block/restore boundary.

### 9.3 Evidence drawer

The drawer SHOULD contain these ordered regions when data exists:

1. Entry identity, privacy scope and current version;
2. exact supporting excerpt or image region;
3. captured Snapshot and canonical source links;
4. content/type/domain tags and independent usefulness/interest values;
5. split lineage and optional association path;
6. media usage and whether it came from source text, deterministic extraction, AI proposal or user confirmation;
7. source, capture, language, content type and revision metadata.

The drawer MUST preserve keyboard focus, provide a clear close action, and
return focus to the invoking record.
On narrow screens it becomes a full-height dialog or routed detail view.

### 9.4 Daily and weekly briefs

A brief is a decision surface, not a feed of uniform article cards.
Group information by change, topic, object, or event.
Each item SHOULD answer:

- what changed;
- why it may matter;
- what evidence supports it;
- how it relates to saved knowledge;
- what action is available.

Every important conclusion MUST link to its evidence.
A weekly brief MUST NOT visually imply it is only seven daily briefs joined
together.

### 9.5 Formal Knowledge graph

The graph uses a dark bounded grid and restrained node colours. It MUST NOT
resemble a decorative 3D star field, use physics motion as semantic evidence, or
load the whole workspace by default.

Visible edges may be deterministic similarity associations, user relationships
or accepted AI-assisted relationships. Deterministic similarity enters the
maintained graph without a per-edge confirmation queue; an AI proposal remains
outside graph state until the user accepts it through the normal relation
command. Meaning and origin require more than colour:

- every edge states whether it is automatically calculated, AI-assisted,
  user-edited or user-created;
- an automatic edge exposes its `similarity` kind, score and explanation;
- a percentage labelled `规则相似度` comes only from an existing projection's
  base score; missing projections show origin and review status instead of 0%,
  including graph nodes, tooltips, the relation list and accessible names;
- AI-created and manual relationships have no implied percentage confidence.
  Inspectors state `未计算规则相似度` when no projection exists. A real zero
  score remains visible, and any adjustment is labelled separately from the
  rule score;
- an accepted AI edge keeps a visible AI origin until a later user edit;
- a user label is readable on selection and in the equivalent list/tree;
- direction has an arrow, endpoint wording and accessible text; automatic
  similarity is explicitly symmetric; and
- hidden/deleted edges are absent until the user restores them, and the UI makes
  durable blocking distinct from temporary filtering.

When the optional OpenAI association capability is configured, the selected-edge
inspector MAY offer “生成联系提案” only for the two currently selected public
Entries. It MUST state that exactly those two Entries are sent, MUST reject a
private endpoint before any Provider action, and MUST label output as
`AI 生成 · 待审核`. The proposed relation label, direction, explanation, model
and Prompt version remain visually separate from the committed edge. Accept and
reject are explicit adjacent actions; dismissing, navigating or rejecting MUST
NOT modify graph state. Without Provider configuration the same inspector keeps
all manual edit, block, restore and create actions.

The highest deterministic Entry search match is the initial centre. Zoom, pan,
filter, focus, bounded expand, recenter, selection, relation editing, and open-
evidence actions MUST be keyboard-operable where technically possible. A
searchable list/tree alternative MUST expose the same essential records and
relations to assistive technology and low-power devices.

### 9.6 Timeline

Every displayed timestamp MUST identify its semantic type when ambiguity is
possible: event, published, captured, validity, or knowledge revision time.
AI-inferred times require an inference label and precision.

The timeline SHOULD use a semantic list in document order.
Visual rails and markers are supplementary, not the only representation.

### 9.7 Ask AI

Ask AI is an optional enhancement route. It MUST NOT replace Saved Knowledge or
Search, and hiding or disabling it MUST leave deterministic filtering, exact
and alias matching, Chinese substring search, source/time filters, and relation
navigation available.

Answers MUST separate saved knowledge from real-time online material.
Important claims require citations.
When evidence is insufficient, the primary answer state MUST say so directly.

AI output MUST show generation state, source scope, citation availability, and
review status.
The UI MUST NOT portray fluent prose as verified merely because generation
completed successfully.

## 10. State and Content Language

Use concise Chinese as the primary product language.
Short English micro-labels MAY clarify hierarchy, for example
`EVIDENCE / 证据` or `REVIEW / 审阅`.
Do not scatter ornamental English or invented protocol names.

Use stable, explicit state terms.
Recommended labels include:

- `可追溯`;
- `待审核`;
- `策略自动入库`;
- `待人工判断`;
- `探索推荐`;
- `已压缩`;
- `仅保留来源`;
- `用户已确认`;
- `有争议`;
- `已驳回`;
- `已撤回`;
- `证据不足`;
- `可能过期`;
- `处理中`;
- `处理失败`;
- `部分完成`;
- `离线`.

Status text MUST be understandable without its icon or color.
Dates MUST include timezone or make the active timezone visible at the view
level.
Hashes and trace IDs SHOULD be shortened visually but remain copyable in full.

## 11. Accessibility

The minimum target is WCAG 2.1 AA.
Compatible WCAG 2.2 interaction criteria SHOULD be adopted where practical.

Every frontend change MUST satisfy:

- semantic `header`, `nav`, `main`, `aside`, and heading structure;
- a keyboard-visible skip link to the main workspace;
- logical DOM and focus order matching the visual task order;
- keyboard access to every interaction, with no positive `tabindex`;
- a visible `2px` signal-colored focus outline with offset;
- focus trapping and return for modal dialogs and drawers;
- visible labels for form controls;
- accessible names for icon-only controls;
- `aria-live="polite"` for nonurgent status updates;
- `role="alert"` only for actionable urgent failures;
- table headers and scopes for evidence tables;
- meaningful image alternative text and empty alt for decoration;
- normal text contrast of at least `4.5:1`;
- large text and non-text UI contrast of at least `3:1`;
- 200% text zoom without lost content or function;
- state communication through text or shape as well as color;
- reduced-motion parity;
- no hover-only information or controls.

Dark mode is the only approved visual theme at this stage.
The absence of a light theme is not a defect.
Forced-colors and high-contrast behavior MUST remain usable and MUST NOT be
disabled to preserve the art direction.

## 12. Frontend Engineering Constraints

The accepted application shape is React, Vite, and TypeScript.
Use the existing dependency graph and token-based CSS.

The source style guide mentions Next.js, Tailwind CSS, headless component
libraries, graph libraries, table libraries, server-state libraries, and global
state stores as possible future tools.
That mention is not dependency authorization.
Any such addition requires the repository dependency and open-source review
process and, when it changes the accepted application shape, an ADR.

Current implementation rules:

- use named first-party exports;
- keep component APIs small and composable;
- keep fetch adapters behind narrow interfaces;
- use local state for component-local interaction;
- lift state only to the nearest real shared owner;
- use URL state for shareable filters only when routing exists;
- do not add a global store for the M0-S shell;
- keep mock transports deterministic and prevent live-network fallback;
- render untrusted source and AI text as text, never injected HTML;
- never compile personal knowledge, custom categories, preferences, source
  subscriptions, saved queries, user prompts, real snapshots, or actual runtime
  configuration into frontend constants, mocks, fixtures, or assets;
- load workspace-owned vocabulary and preferences through authenticated runtime
  contracts; tracked demos and tests use clearly synthetic values only;
- treat missing AI configuration as a supported state and keep all non-AI
  routes and actions usable;
- keep CSS family tokens and depth tokens independent;
- use one semantic markup tree rather than duplicate pages per depth.

A representative root contract is:

```html
<html
  lang="zh-CN"
  data-ui-family="struinfo-industrial"
  data-ui-depth="moderate"
></html>
```

The full product may advance the shell to `complex` without changing semantic
content or accessible names.

## 13. Performance and Large-data Behavior

The UI MUST preserve interaction quality as sources, evidence, and relations
grow.

- paginate or virtualize large tables and timelines after measurement;
- load graph neighborhoods incrementally rather than rendering the full graph;
- pause offscreen motion and media;
- lazy-load noncritical images with explicit dimensions;
- memoize only measured expensive computation;
- avoid broad context updates that rerender the entire workspace;
- use CSS transitions for direct motion and reserve JavaScript animation for
  behavior CSS cannot express;
- provide a low-complexity list alternative for graph-heavy workflows.

Performance tooling or virtualization libraries still require dependency
admission.
Do not add them speculatively.

## 14. Asset and Provenance Rules

All shipped UI code and visual assets MUST be original, user-owned, or admitted
under a compatible license with required attribution.

Do not ship:

- Hypergryph, Arknights, Endfield, Palantir, Linear, Raycast, or Obsidian logos;
- reference-product screenshots, production bundles, character art, or icon
  sheets;
- fonts with unclear redistribution rights;
- copied community themes whose embedded asset rights are unknown.

Prefer original CSS/SVG grids, lines, masks, and diagrams.
Reference-product names describe high-level qualities only and do not imply
affiliation or source-code reuse.

## 15. Verification and Design Review Gate

### 15.1 Required implementation evidence

Before frontend handoff, record:

- format, lint, typecheck, focused unit tests, and build results;
- loading, ready/success, empty, partial, offline, and error behavior relevant to
  the task;
- keyboard focus order and named controls;
- reduced-motion behavior;
- viewport evidence at `320`, `390`, `768`, `1024`, and `1440` widths;
- console and runtime-error result;
- token usage and absence of unreviewed asset or dependency additions.

M1C has local real-browser functional evidence at desktop, `390px`, and `320px`,
including keyboard-first focus, responsive bounds, source return and a real
PostgreSQL-backed synthetic vertical flow. This is not production browser,
container/Linux or distribution certification. Static or unit evidence alone
MUST NOT be described as a browser PASS, and later release gates must record
their own browser/runtime identity.

### 15.2 Design review output

Use this review structure:

1. context, user task, phase, family, and depth;
2. summary verdict: `PASS`, `NEEDS_WORK`, or `BLOCKED`;
3. design-token and component compliance;
4. three-pillar assessment;
5. blocking, major, and minor findings;
6. exact remediation and rerun scope.

The three pillars are:

| Pillar        | Acceptance question                                                      |
| ------------- | ------------------------------------------------------------------------ |
| Frictionless  | Is the primary task and next action obvious and efficient?               |
| Quality Craft | Is the result coherent, responsive, accessible, and token-driven?        |
| Trustworthy   | Are AI origin, evidence, uncertainty, and failures represented honestly? |

Blocking findings include:

- an inaccessible primary task;
- misleading AI or evidence status;
- a hidden failure or dead end;
- fabricated telemetry or product data;
- copied or unreviewed third-party assets;
- a broken responsive layout at a required width;
- a material contract or dependency violation.

The project has no Figma library or Storybook at this stage.
Review against this document, rendered states, and code tokens.
Do not mark their absence as a defect or pretend that a Figma comparison
occurred.

## 16. Agent Handoff Contract

Every frontend implementation or review task MUST state:

- the fixed Git baseline;
- the released route or component scope;
- `data-ui-family` and target `data-ui-depth`;
- real user content and states allowed in the task;
- unavailable modules that must not be fabricated;
- owned paths and forbidden dependency/config paths;
- required viewport, accessibility, test, and build evidence;
- whether browser execution is admitted or still pending;
- the design-review verdict and unresolved material findings.

For M0-S, use:

```text
family = struinfo-industrial
depth = moderate
screen = operational health shell
primary task = understand readiness and retry a failed check
real data = operational-health contract only
future product modules = do not render as active UI
```

## 17. Design Inputs

This specification synthesizes:

- [StruInfo product requirements](product-requirements.md);
- [supplied frontend style direction](AI_Personal_Knowledge_OS_Frontend_Style_Guide.md);
- [Ark UI Skill](https://github.com/Brandon030722/ark-ui-skill);
- [Frontend UI Engineering](https://github.com/addyosmani/agent-skills/tree/main/skills/frontend-ui-engineering);
- [Frontend Design Review](https://github.com/microsoft/skills/tree/main/.github/skills/frontend-design-review).

No external Skill code, reference-product asset, or runtime dependency is
copied into the application by this document.

## On-demand Chinese reading support (ADR 0070)

The selected Query article keeps its original title and exact-source action. A secondary reading control switches between original text and the separately saved Chinese translation. Generating requires an explicit action with the Provider transfer scope stated before sending; absent configuration and private/oversized Entries show an explanation and disabled generation. The original remains readable while waiting and after failure. Translation is labelled machine-generated, bound to the displayed Entry revision, and displayed through the safe reading view described below. Selection, privacy/query-scope changes and revision changes invalidate pending display state. Cached reading remains available with the Provider off. No new navigation destination, design tokens, assets or dependency is introduced.

## Cached translation search (ADR 0071)

The title/body lexical scope includes valid saved Chinese fields. Results label
original and translated title/body matches separately while retaining one Entry.
Opening a translated hit initially prefers cached Chinese reading; loading,
unavailable caches and errors preserve the original, and explicit language
switches remain available. Search never generates a translation. The existing
machine-origin and exact-source labels remain visible. Untranslated content is
discoverable through original text or existing annotations. This adds no new
navigation, token, asset or control surface.

## Owner-selected seven-page UI maintenance (2026-09-08)

The seven destinations retain `struinfo-industrial / complex / 3`. Page titles
use the compact operational scale; repeated instruction panels become optional
native disclosures. Borders separate functional regions without adding nested
frames or decorative corners to ordinary reading content. The application has
one main landmark, an expanded rail from 1200 px, and a bounded narrow-screen
navigation strip. Source overlays retain focus containment, Escape dismissal
and return to the triggering control.

Source selection uses a labelled, searchable native document chooser. Desktop
Split and Tags place the bounded Entry queue beside the main reading/editor
surface; small workspaces stack them. Tags keeps save/previous/next at the start
of the editor with a sticky action row. Document aggregation, AI suggestions,
preferences and automation stay in secondary disclosures. Type coverage and
correction controls must fit the available workspace, including large counts.

Query places search first, then closed saved-query/filter/index disclosures,
then the list and reading surface. Opening settings uses normal document flow;
it must not compress the reader or overlap results. Article and candidate titles
wrap to two lines where bounded, with a full accessible name/native title.
Opaque source keys are visually replaced by a readable source name or host;
full identifiers remain in the source dossier and Entry metadata.

The original and translated reading views parse CommonMark into a whitelist of
React elements, reusing the already locked MIT `mdast-util-from-markdown@2.0.3`
closure. Raw HTML remains inert visible text. Links allow only HTTP(S), resolve
relative paths against the source URI, and suppress opener/referrer access.
Images are explicit links and do not load automatically. Rendering does not
rewrite Entry bodies, translations, Snapshot/Fragment evidence or exports.
The editor and exact-source view retain their original text representations.

Associations places both endpoints together. A returned candidate is selectable
even when it is outside the current page; changing the source or query/privacy
scope invalidates the old target. Percentage controls use 0–100 consistently.
Knowledge candidate titles cannot escape their buttons, and bounded graph nodes
occupy non-overlapping columns around the centre. Narrow screens initially use
the equivalent relationship list; graph mode remains available with local pan.

Overview distinguishes Entries with tags from type-review coverage. Its task
rail describes only the latest actual ProcessingRun and that run's current
stage, rather than implying completion of the whole collection or all stages.
Owner-content screenshots and deployment evidence remain outside Git and the
application artifact; automated checks use only synthetic materials.

## Supplied translation reading (ADR 0072)

Query now initially prefers any current Chinese cache, including saved-view openings. Original text remains available during loading, on missing caches, after errors and by explicit switch. Supplied translations show a distinct external-import label with an uncertainty note; no new layout, dependency, editor, navigation or Provider generation permission is added.

## Long-content and action reachability maintenance (2026-09-09)

Reading bodies in Query, Split and source review retain all text in a labelled,
keyboard-focusable scroll region capped by the viewport height. Article headers,
language switches, exact-source actions and metadata remain outside that region.
Changing the displayed text resets its reading scroll position. Result queues,
association candidates, subscriptions and manual/restructure groups use bounded
scroll areas; pagination, subscription save and split commit remain outside the
scrolling list. Scroll gestures can continue onto the page at a region boundary.

The Import document list filters locally by readable source name, source key or
source URL, displays 20 documents per page, and provides previous/next and direct
page selection. Filtering returns to page one; changing pages resets list scroll.
The full count and current displayed range remain explicit. Source return and
privacy opt-in use the existing exact-document controls. New subscription drafts
focus their name field, bringing the new row into view without saving it.

Desktop and narrow layouts retain natural page scrolling and all controls.
Do not restore the earlier unbounded narrow-screen structure preview or place
commit controls beneath an unbounded article/list. No business API, persistence,
Provider permission, dependency or owner content is introduced by this repair.

## Aligned workspaces and compact actions (2026-09-10)

Owner workspaces other than Overview use the Import page's clear selection and
working-surface hierarchy. At desktop widths with sufficient workspace space,
selection and reading/editing columns share `--si-workbench-height`.
Queues and detail panels scroll independently without losing content; result
pagination stays outside the queue, and Tags keeps its save navigation sticky
within the editor. Changing the selected Entry resets the detail scroll. Reading
headers, language controls and evidence actions remain distinct from body text.
Associations keeps its candidate list scrollable with pair and policy controls
outside it. The graph retains local pan and its equivalent relationship list.

Short action buttons use content width and retain the existing target sizes.
Related buttons wrap together; a short label is not a reason to create a full-width
row. Preference suggestions and trials share a row when space permits, and rule
fields use responsive columns. Draft rules and suggestion results use labelled,
keyboard-focusable bounded lists; generation, trial and save stay outside those
lists even when all 64 suggestions are shown. Secondary settings retain their
allocated column when expanded; opening a disclosure must not make it span the
whole work area. Fields and related controls adapt to the available panel width.
Narrow layouts stack the working columns, retain bounded queues and natural page
scrolling, and allow controls to wrap without document overflow.
This maintenance changes no business commands, privacy scope or Provider authority.

## Stable disclosure columns (2026-09-11)

Opening a secondary tool reveals its contents within the existing column; it
must not trigger full-row spanning. Column count follows available workspace
width rather than disclosure state. Short actions keep content width and related
controls wrap inside the panel. A tool whose prerequisite is missing explains
which document or preparation step is needed instead of exposing an empty drawer.
These visible states do not enable otherwise unavailable reads or writes.
The available-subscription list also fits its allocated width, without default
list indentation or a minimum track wider than a narrow panel; long channel
names wrap within the list.
