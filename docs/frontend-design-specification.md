# StruInfo Frontend Design Specification

## 已验收总览（2026-10-27）

总览复用 `overview-prototype` 样板，样式放在 `overview_home.css`，作用域仅为总览。
保留样板的比例、材质、圆角、图标和光效绘制；只适配现有数据、操作、主题与响应式尺寸。
左右保留小幅留白，六个流程框宽度不超过 208 像素，多余宽度均匀分配到框间。
上方左侧为项目名称与简介，右侧为文档、条目、标签、联系和报告统计；统计口径可查看。
下方左侧为 AI 许可开关与任务预览，右侧为待审核、来源复核和系统消息。完整队列与操作在玻璃浮窗中展示。
光束充能 1.2 秒，最高 50% 亮度；发射 1.2 秒，200% 亮度，沿用样板的宽轨迹与渐变光晕。
统计和任务分次返回时合并同一充能事件；数字在光束到达后变化。无真实增量时不发射统计光束。

## 四页内容工作区（2026-10-26）

本节替代下方 P2–P6 增量入口的页面位置；功能与权限边界继续沿用。

- **总览**：项目标识在左上，真实统计在右上；流程在中部，AI 总控和队列在左下，系统消息在右下。任务可打开详情、继续、暂停或取消，后台主题任务独立展示。
- **源管理**：复用已验收的唱片几何和阻尼动画。搜索固定在上方，添加来源和手动输入固定在下方。右侧直接编辑来源配置与 AI 处理提示；接收记录、原文阅读和检查计划在玻璃浮窗中查看。
- **文档阅读**：采用方案 A，全文与旁注并列。文档选择使用浮窗，段落、标签、联系和主题放在旁注；编辑按需展开。人工修改仍需确认入库。
- **数据库**：左侧分类，中间搜索、原文或问答，右侧报告入口。分类栏、报告栏和阅读旁注均可调整宽度；正文字号和行宽可调整。
- **设置**：集中管理外观、词表、处理规则、模型接入、联网额度、定时报告、通知及数据维护。来源专用配置保留在源管理。

正文和固定内容保持实色。交互控件和弹窗沿用既有玻璃、边缘光效；浅深色分别使用主题底色。
来源选择支持点击、拖动、滚轮与方向键；减少动态效果时直接更新选择。
流程仍由实际任务完成和统计增量驱动。充能最高为 50% 光强，发射增加亮度、轨迹宽度与渐变光晕，飞行 1.2 秒。
初次加载不补播历史事件，隐藏页面不持续播放。弹窗支持 Escape 和焦点返回，报告表单在关闭后保留。

## P6 增量入口

数据阅览右上工具组提供“联网研究”；报告右上提供“定时与通知”。沿用现有玻璃浮窗与普通正文样式。
网页结果显示正文／摘要、来源、获取时间和“保存到待审核”。库内范围沿用当前筛选；公开搜索词单独输入。
报告面板区分配置、生成队列和发布通知，所有自动开关默认关闭。正文和配置不因展开面板改变宽度。

## P5 主题与联系（2026-10-24）

数据阅览右上角提供“主题与联系”，复用现有浮窗，不挤压正文。
主题、相似候选、归组任务分别显示；候选注明来源和匹配原因，主题显示成员与两端依据。
归组说明范围、预算、等待原因和已用费用。仅可恢复的任务显示继续按钮。
人工成员和屏蔽状态用文字表示。表单桌面两列、窄屏一列，三个切换控件不撑开浮窗。
固定内容沿用实色，交互控件使用现有主题样式，保留键盘关闭与焦点返回。

## P4 条目标注（2026-10-24）

工作台底部提供“条目标注”，在现有浮窗中编辑本条标注或配置词表。
分类、正文依据、明确观点和阅读状态分组显示；保存反馈保留，刷新正文不清空正在编辑的面板。
固定标注正文保持实色，不增加光效。字段桌面两列、窄屏一列，浮窗内部滚动，关闭按钮可达。
查询筛选增加结构化分类，沿用已有筛选浮窗。标注来源、不确定结果和过期情况使用文字说明。

## P3 拆分方案（2026-10-24）

入口放在工作台底部“修改分段”旁，复用现有浮动面板。固定正文保持原样。
方案选择、参数、试读启用和结果分别成组；按钮保持内容宽度，字段桌面两列、窄屏一列。
窄屏面板固定于视口并内部滚动。显示范围、版本、启用状态、切点和暂停原因。
已启用参数只读，复制后修订；预览不写入，应用后仍需确认入库。
不以绿色状态或试读成功暗示语义审核已完成。

## P2 来源管理（2026-10-24）

沿用文档入口和订阅编辑面板，不新增工作区。
“接收安排”独立成组：检查方式、时区和星期、失败重试、时效与来源偏好。
普通字段两列排布，窄屏一列；星期选项按宽度换行。状态与错误使用文字说明。
来源卡片显示下一次检查、等待原因、最近新资料和异常。历史能力只说明实际支持的渠道。
文档入口提供接收渠道筛选，早期未标记记录单列，不推断成手动上传。
接收策略与 AI 许可分开说明，不把偏好称为可信度。

## 样板直接应用（2026-10-19）

本轮采用已验收的阅读式样板。`editorial_reference.css` 直接复用样板的
`study.css`、`overview.css` 和 `overview-motion.css`，仅转换选择器和作用域。
`editorial_layout.css` 负责现有组件、窄屏、浅色主题和外观设置的适配。
光环与光束继续使用样板渲染器，不生成演示任务或虚构统计。

总览上部为项目标志、待办和统计，下部为处理流程、最近文档与任务队列。
文档入口以待审文档为列表，来源选择和管理在浮窗中；手动输入保留在来源中。
工作台保留全文阅读，按条目阅读使用独立条目面板。正文与元数据保持实色，
玻璃用于按钮、底部操作条和临时浮窗。其他工作区沿用同一字体、材质与间距。

文档入口底部操作条在正文区域内居中，随可用宽度收缩。人工操作与 AI 操作
各自成组，说明位于按钮下方；窄窗口自动换行。

阶段完成时，光束用 0.8 秒从零蓄力到正常亮度，再用 0.4 秒升至两倍亮度；
光环在这 1.2 秒内汇聚，光束和节点转移用 0.2 秒，抵达后同步开始数字增长。
初始读取、页面隐藏和减少动态效果时不补播历史变化。保留 AI 总控、
价格和并发限制、人工草稿及确认操作。

## 当前视觉主题：Titanium Amber 06M / B（2026-10-17）

所有者已依次验收配色、细节 B 和组合动效；本节覆盖下文历史配色及动态效果规范，
不改变四个工作区、总览、设置、手工确认和任务权限的行为。

深色画布 `#161617`、侧栏 `#1f1f20`、内容面 `#28282a`、抬升面 `#353636`；
正文 `#eeede7`，次要文字 `#bcbcba`。琥珀 `#f3cd7b` 用于主操作与选中项，
冰蓝 `#9ed3e9` 用于 AI，靛蓝 `#96b4ff` 用于联系和引用，珊瑚 `#f4b0a4`
用于标签。同一种语义不混用靛蓝和珊瑚；关系来源继续使用文字标明。
完成、警告、故障分别使用绿、橙、红，并始终附带状态文字。
浅色模式采用同语义的高对比配色，保留跟随系统和既有外观偏好。

界面字体 Noto Sans SC，正文 Noto Serif SC；使用本机字体及现有回退，不在线加载字体。
控件 14px / 500，正文 17px / 1.85，阅读目标宽 760px，页面标题 28px / 600。
主要卡片圆角 18px，控件 10px，标签 6px，浮层 16px；边界 1px，焦点保留 2px。
正文、标签、固定面板保持实色；按钮边缘柔光，选项卡和临时展开工作台采用轻玻璃质感，
不支持模糊或要求降低透明度时使用实色。切换主题不延迟背景颜色而损害文字对比度。
文档 AI 状态移至标题区域右下方，标签和联系仍在文首；浮层保留焦点、Escape 与草稿。

总览运行节点采用连续环形光带，以明暗变化体现旋转。真实阶段完成后，2600ms 顺时针
汇聚，同时直线统计光束从无到有；节点转移与统计光束均用 900ms，抵达后下一节点
2600ms 顺时针展开，数字在同一时刻开始 1600ms 增长。“AI 自动”位于运行节点上方。
数字仅来自观测到的增量；不拿调用次数估算知识产量，不制造联系数量。近期报告数只表示
当前返回范围中已生成报告。首次打开、恢复可见、减少动画或读取失败后不重播历史完成。
减少动画时直接显示最终数值与文字状态，隐藏页面停止画布；离开或调整尺寸时清理动画。
环形光带复用展示页 `effects-rings.js`，光束复用 `effects-flow.js` 的 SVG 渐变与遮罩，
保留原来的宽度、模糊层、曲线和时序；阶段和统计比较独立于业务服务，动画不发起模型调用或写入。

展示代码复用：`theme/approved_reference.css` 收纳展示页 `study.css`、`details.css`、
`effects.css`、`effects-flow.css` 对应声明，只适配产品选择器。按钮必须保留 `::after`
发光叠层；玻璃采用原来的 32% 底色透明度、12px 模糊和内侧高光。
`theme/approved_layout.css` 负责真实页面布局和所有者确认的材质协调。
页面左上显示名称及一句用途说明，右侧归本页操作；总览也使用“运行总览”和待办说明，
品牌标志保留在导航中。全局状态收进设置上方的“系统状态”玻璃浮窗，正常、检查中和
异常均有文字提示；AI 接入配置与运行状态分别显示，进度与总控在总览查看。
外观仅在设置中保存，保留既有版本检查和冲突草稿。
少量操作复用选项卡的玻璃容器，内部按钮静止时降低单独泛光，悬停和展开时突出；
查询工具分为“筛选与匹配方式”“查询管理”“阅读与导出”，浮窗内按用途折叠，
不会挤压正文，也不会在收起时丢弃查询、索引或导出草稿。
固定面板只增加微弱边缘高光，正文及标签继续使用不透明底色；不重写已验收的光带与光束。
桌面由应用外壳分配可用高度，四个工作页和设置不再扣除已移走的顶栏，底部保留 24px；
长列表和正文在区域内滚动，窄屏恢复自然纵向排列。
联系星图嵌入阅览页时继承剩余高度，图谱画布和关系详情各自滚动，不再按独立页面撑高。
设置分类使用等宽选择行，选中项复用已验收的琥珀玻璃材质，并以侧边标记和加粗区分；
未选项保持安静，窄屏变为等宽双列，配置正文仍为不透明面板。
不得用近似重画替换已验收的材质或动效。
浏览器核对覆盖实际颜色、字号、圆角、玻璃底色、按钮叠层和各断点布局。

### 设置页与文案

设置表单直接展开，每组使用独立边框和标题。运行记录和证据明细仍可按需展开。
外观页只放主题、光效、动画和正文显示；备份在“数据与维护”，隐私选择留在实际操作处。
发光强度、玻璃效果、界面动画、流程动画和正文字号即时生效，保存在当前浏览器。
默认保留已验收效果；关闭动画后直接显示状态与最终数字，重新开启不重播旧记录。
浏览器光效设置不随个人数据包迁移；主题仍通过原有接口保存。
设置说明和字段标签至少 14px。联系权重按两列排列，窄屏改为一列；
滑条最长 360px，旁边保留数值输入。按钮按文字宽度显示，长表单在内容区内滚动。

项目文案使用简短陈述句。先写用途，再写操作；错误提示写清原因和下一步。
按钮直接写动作，如“保存设置”“重新读取”“从上次进度继续”。
删除重复说明、开发过程描述和空泛修辞。优先说明实际行为，例如“确认后入库”“原文保留”。
权限、隐私、预算、版本检查和人工确认仍需写明具体条件。
文案调整覆盖界面、提示、README 和项目说明；代码标识、协议字段及历史记录保持原义。

## 当前总览：文档流程图（2026-09-27）

此节取代早期总览的四页导航板、独立 AI 工作框与固定右侧任务栏。顶部为 SI / StruInfo 标志与简介，其次为项目统计；主要空间呈现接收 → 入库 → 拆分 → 标签 → 联系 → 报告的流程图。入库说明明确原文保存与最终发布的区别，不暗示未完成内容已经可检索。

运行使用蓝色、等待使用琥珀色、完成使用绿色、故障使用红色、人工复核使用柔和紫色；自动发起的任务在流程节点、任务卡片与消息中使用柔和 AI 暖色底面、边线及“AI 自动任务”标记，状态仍用独立文字与颜色表达。人工发起与外部 Agent 保留各自身份。颜色始终伴随状态文字。动画只依据真实运行状态，状态过期时停止，遵守减少动画偏好。新到待审文档单独点亮接收节点；历史已解决故障不算当前故障。

点击节点打开完整工序详情，可查看文档进度、等待原因并跳转。总控和任务队列入口在图上方，消息与来源复核在图的角落。队列弹窗保留有界批量控制；内层批量弹窗关闭不得关闭外层队列或丢失反馈。桌面整页显示、任务与消息内部滚动，窄屏改为顺序排列。并发上限取自当前配置，与实际运行任务数分开表述。

## 来源简介编辑（2026-09-26）

简介只描述来源的主题和文章类型。订阅新增／编辑框在简介旁提供可选的“AI 生成简介”，按钮按内容宽度显示。公开 RSS / 网页依据来源介绍、近期标题及有限 RSS 内容片段生成，其他渠道先填写内容线索；隐私来源手工填写。结果使用现有柔和 AI 配色，显示“使用这份简介”，采用后仍可编辑，保存订阅后生效。来源信息发生变化时不能采用旧草稿。生成中、信息不足、读取失败、AI 未配置／被禁止及价格等待均提供明确反馈；此即时工具不会承诺自动续跑。

> 2026-09-25：增加人工审核样本参考、总览来源复核，以及设置中的并发和有界断点重试；保留人工决定、预算、价格窗口、来源范围和恢复安全。见 [ADR 0087](adr/0087-source-feedback-and-ai-execution.md)。

## 文档入口来源、操作说明与正文宽度（2026-09-19）

文章选择卡和正文标题下都显示订阅名称／原始来源。“手动放入文档”仅包含真实上传与手动文本；来源未匹配的远程文档使用“其他接收来源”，不得因自动处理队列关闭而误归类。

底部明确区分“我已审核，接受并整理”与“交给 AI 审核并整理”。前者采用人工接收决定，后者先由 AI 判断；接收后均完成拆分、标签、联系与入库，仍遵守总控和价格时段。说明与按钮相邻并通过 aria-describedby 关联；翻译和摘要注明只辅助阅读。

正文滚动容器铺满右侧阅读区，文字以独立的内边距维持可读行宽；不可把文字最大行宽设为滚动框最大宽度。操作按钮按内容宽度排列，空间不足时换行。

## 批量恢复与历史待处理文档（2026-09-19）

总览任务队列直接提供“批量从断点继续”“批量取消任务”；“为耗尽任务重启一轮”“处理未开始文档”收在更多批量操作中。勾选后每批提交最多 32 篇。点击后以原生模态弹窗勾选；列表内部滚动，底部确认与返回队列始终可见。
取消只停止后续处理，不改变接收决定或删除原文、已完成结果；无模型配置时也可取消。取消窗口默认不勾选，支持仅选失败任务，显示逐篇状态和原因。已完成、已取消和被替代的旧任务不列入。弹窗打开后固定所见版本，提交逐篇检查版本并报告部分失败；取消后不能直接继续该任务。容量超限等不可直接重试的问题不列入断点继续。
继续保留断点与剩余额度；重启仅针对额度或尝试次数耗尽的失败文档任务，开启同额度的新一轮，保留已完成步骤、前驱记录和累计历史调用数，旧任务不能再次写入。
较新的人工修改与正文版本冲突须先处理，批量操作不覆盖。
历史待处理范围为已接受或旧版直接收存的公开文档，排除待审、拒绝、暂缓、已完成／取消的任务和重复来源版本；创建新任务仍经过接收规则。
继续、新建与重启遵守 AI 总控、串行队列、原有价格窗口及既有确认入库规则；取消不受模型或价格许可限制。不启用无人值守订阅或自动重启。
此前授权的历史批次已分批入队；本次增补取消控件不自动执行真实任务。真实资料与操作记录保存在仓库外。

## 当前总览与文档发布（2026-09-19）

AI 工作框保持紧凑，仅显示总控、状态和处理数字。模型型号与逐篇细节放在队列或设置；不再在 AI 框上方重复失败/待继续提示。任务队列沿用记忆展开与内部滚动，显示审核、结构、标签、联系、入库五段真实状态，支持定位原文及显式恢复。工作台中的公开文档手动修改后显示“确认入库”，使用完整条目版本提交，处理中仍可阅读原文。

## 当前交互规范：文档中心工作区（2026-09-19，ADR 0084）

本节替代早期独立“收件箱 / 资料库 / 专题 / 查询”的页面组织与右侧操作栏规范；历史能力与隐私约束仍保留。

1. 桌面左栏上下分别为总览标志与设置，其下以普通紧凑列表连续排列文档入口、工作台、数据阅览、报告，不再拉伸均分整栏高度。左栏只保留导航，AI 状态与操作集中在总览和对应文档中。刷新时保留当前工作区；新打开项目默认进入总览，只记忆页面标识。
2. 文档入口左侧为可筛选、排序、展开的来源列表，右侧依次是当前来源待审文档、全文与浮动操作条。来源说明由外部订阅配置提供，缺失时明确提示，实际往期标题提供阅读线索。审核完成显示工作台入口。手动放入文档作为固定来源，点击打开导入区，并在该来源下查看接收记录；不再设置单独的导入按钮组。订阅与暂停使用不同语义颜色，可按活跃订阅优先排序。
3. 工作台左侧文档可按状态与时间/来源筛选排序；正文与文首标注共用阅读区域。底部将人工编辑与 AI 操作分组。分段线位于实际原文边界，编辑前读取完整当前分段；读取失败不能提交替代结构。草稿不自动写入，确认后才更新检索内容。切换文章时保留左侧列表的筛选、分页和滚动位置；选中文章的处理状态刷新不清空列表已有数据。
4. 数据阅览的搜索与提问同页切换。搜索筛选、正文／星图切换与阅读工具集中在搜索栏右上方，窄屏自然换行。搜索工具为可键盘关闭的浮层，应用筛选后收起；关系图占用下方完整区域。阅读语言、清单导出及更多工具不占第三栏。结果列表与正文之间可拖动调宽，也支持方向键及双击复位；宽度在当前浏览器记忆，窄屏上下排列。隐私范围仍须每次明确选择。
5. 报告配置与任务历史始终并列；窄屏上下排列、区域内滚动。选材与生成按钮在配置区域内，历史条目展开后阅读、编辑、导出。PDF 使用本机打印保存，未配置任何推送。
6. 两栏宽度在浏览器记忆，不保存内容或授权；窄屏导航改为四个等宽入口。圆角、色彩、正文阅读宽度继续复用现有语义令牌。AI 使用既有低饱和强调色。

收件箱以原标题、独立来源行和原文预览帮助选择；AI 摘要使用既有柔和 AI 色，明确标注基于接收原文，和审核原因分开。开关默认关闭并记忆；单篇与批量生成按钮必须独立于接受／拒绝，显示正在生成、已生成和失败原因，关闭后停止剩余批次，保留在途结果。

> 2026-09-19：文首标签概览优先展示人工文档标签和跨条目标签，覆盖数量依据当前可见条目计算；全部条目标记在可展开浮层按条目分组，支持定位阅读。全文阅读在每条真实拆分线下方展示其后条目的全部内容标签，首条标签置于首条正文前且不虚构分割线；无标签时不加空白标记。标签沿用柔和实色样式并随栏宽换行。条目阅读只突出当前条目标签，领域单独标明；不因展示层精简而删标签。查询解释区分原词与已确认别名，并展示实际命中的原标签。

## 总览 AI 工作状态（2026-09-17）

总览将“待你决定”的资料与“失败待重试 / 待手动继续”的任务分开，核对数量按当前接收记录去重，不由旧任务结果重复催办。收起 AI 框时仍提供收件箱直达按钮；逐篇标题可定位对应资料。收件箱增加“需人工核对”筛选，用柔和琥珀色、文字标记和原因区分待接受与整理暂缓。接受仅决定资料库可见性，人工放行另行解除整理限制；二者不自动启动模型。总体许可显示“已允许 / 已禁止”，仅保存变更，明确它不是启动按钮。

完整的快讯、简报、新闻汇编按自身体裁判断完整性，不因篇幅短、编号或多主题被当作残缺单篇文章；摘要抓取、缺失正文、选题排除仍保持原拦截边界。新提示词只影响后续审核，已有暂缓决定与证据不改写。

总览 AI 框汇总已启动的接收审核、文档整理和日报/周报任务，显示实际运行阶段、资料来源、等待数量及需要查看的结果。价格等待显示服务端返回的北京时间最早可继续时刻；手动暂停、恢复待确认、模型变化和已关闭的自动策略不承诺自动续跑。审核通过明确停在接受，整理另行启动。没有排队任务时不虚构下次运行时间。

页面可见时每 10 秒只读刷新，读取失败明确标记旧结果。任务和报告各最多读取 100 条，运行/等待优先于终态历史，达到上限说明计数范围；报告仍核验公开且已放行的来源。复用已有接口和授权，不新增调度、模型调用、迁移或依赖；即时翻译/查询工具不属于该后台任务汇总。

## 按需 AI 接收审核（2026-09-16）

收件箱的“AI 审核所选”对显式选择的待接受资料创建独立 intake 任务。沿用已保存的接收规则、全文准备、公开范围与价格窗口；每批最多 32 份，每份最多 3 次模型尝试，且不超过当前配置的单文档调用预算。完整且通过审核的资料自动接受，不确定或不适合的资料保留待接受并显示原因。任务可暂停、取消与恢复；价格等待不消耗调用预算。

审核接受后停在资料库，不拆分、标注或建联，并阻止既有自动队列继续处理，整理须另行启动。人工版本优先；接收来源与任务标识持久保存，重试不覆盖较新决定。原文不改写，无新表、迁移或依赖；既有 JSON 与数据包扩展读取，新任务随包保存，恢复仍要求明确继续。全局无人值守保持关闭。

## 订阅资料的人工接受（2026-09-16）

新增公开订阅资料先保存在收件箱，默认待接受；接受后进入资料库。收件箱支持按状态与来源筛选、跨页全部接受、接受所选、拒绝所选，以及从已拒绝恢复待接受。全部接受只处理点击时当前筛选中的待接受资料，批量操作逐份核验版本，明确报告部分失败。

接收选择复用 processing_document_intake 的可选 receipt 状态，与 AI 完整性/选题审核独立。保存选择不调用模型，不启用自动策略；已有启用的自动队列在接受前等待，接受后仍遵守原范围、预算和价格窗口。拒绝保留原始证据。历史无 receipt 的资料保持原可见性，已有条目或已启动结构处理的资料不能通过本入口移出资料库。原文与待接受记录同事务保存，重复接收不重置决定；个人数据包携带新字段，旧包继续可读。无新增表、迁移或依赖，降级使用升级前备份。

## 文档旁的 AI 处理记录（2026-09-16）

资料库在文档列表与阅读区呈现真实 AI 文档任务状态，拆分虚线直接绘于原文的真实条目边界；整篇保留不画线。实际标签与关联文章集中在文首，使用普通标签与文字链接。处理状态保留为紧凑一行，阶段记录在右侧详情中查看。详情复用右侧工作台，不挤压正文；可直接查看条目、当前标签和联系，以及接收原文对应的实际处理正文。价格等待、人工暂停、拦截、部分完成、未建联和达到额度未评估分别呈现。

文首联系按独立行展示完整目标标题、关联说明及真实来源/核查状态，允许自然换行。纯编号标题显示明确标注的正文摘录，保留原标题；通用英文共同关注说明以中文呈现，原始关系说明与依据按需展开。宽泛关联后排，不改写已有关系或触发模型。文首信息随全文或条目正文滚动，避免较长说明长期挤占阅读空间。

资料库顶部标题默认最多两行，超长快讯优先显示完整的前置简报标题；其余超长标题使用有界文字预览。完整来源标题在可键盘操作的浮层中查看，展开不改变正文高度，来源内容不改写。

原文分界按完整条目证据及 Unicode 范围定位，不受列表分页影响。文首标签保留 AI 来源，联系显示实际关联文章；任务记录说明历史执行情况，不替代当前内容或人工核查。读取采用原有任务接口的可选文档范围，在最近记录限制前筛选，保留工作区和执行身份隔离。页面可见时只读刷新，隐藏后停止轮询，不触发新任务或模型调用。

虚线只用于原文真实拆分边界，不用于标签、联系或阶段按钮；处理详情沿用右侧预留列及 Escape 返回焦点。后台结果刷新保留阅读对象与标注草稿，失败显示读取错误而不宣称未处理。RSS 摘要、当前正文及历史正文必须明确区分。

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
当前主导航为收件箱、资料库、专题、查询、报告和设置；首次加载、刷新或重新打开项目时默认进入运行总览，也可由左上角「SI StruInfo」标志返回。总览面板按当前浏览器记忆恢复展开状态，批量处理从设置进入。
后续改造以本节替代下文的工序分页、工业风、仅深色主题、旧圆角与动效参数要求。
下文有关来源证据、业务权限、隐私、可访问性、性能和真实状态的要求继续有效。
收件状态、专题存储和自动处理权限按实际实现情况显示。

### 内容对象与工作区

文档和条目共同构成内容核心，各入口共享同一套内容详情和操作。
文档支持完整阅读、原文与译文切换、来源回看和结构调整。
条目支持直接阅读、标注、查询、比较和联系，不要求先回到父文档才能操作。
本次专题复用现有 Entry 图谱，围绕所选话题或条目查看、编辑有界关系。持久专题成员和自由页面搭建不在本次范围。

| 当前入口 | 主要任务                                     | 边界                                       |
| -------- | -------------------------------------------- | ------------------------------------------ |
| 收件箱   | 配置订阅、手动导入、查看已接收文档与实际任务 | 真实收件决定可恢复，原文与处理结果分别呈现 |
| 资料库   | 阅读文档和条目，在同一处调整结构、标注和联系 | 工具覆盖预留的右列，展开不挤压正文         |
| 专题     | 选择话题或条目并探索已有图谱关系             | 查看限定范围的关系图，专题集合尚未持久保存 |
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

## 总览 AI 监督与可调整栏目

- AI 工作区位于总览原有内容下方，使用共享暖铜色 AI 语义变量，与蓝灰主界面区分；浅深主题均需可读。AI 工作框与右侧任务队列首次使用时默认收起，收起后保留实时状态和待办数；两者及最近结果、独立调用记录的展开状态仅保存在当前浏览器，切换页面、刷新或下次打开时恢复，浏览器存储不可用时仍可正常展开收起；AI 工作框始终与上方统计区同宽。桌面总览限制在一屏，展开详情、队列、历史结果或独立调用记录时仅面板内部滚动；窄屏保留自然页面滚动。右侧队列优先显示进行与等待，历史记录按需展开。
- “允许 AI 继续 / 禁止 AI 操作”为版本校验的服务端总体许可。明确保留已发出请求、既有结果、原任务范围、单独暂停和价格闸门；界面不得把允许描述为自动接管新文章。
- 逐篇展示审核、结构、标签、联系的实际阶段，允许审核结束而后续未启动，关系评估可完成但没有边。阶段条不模拟耗时百分比；历史记录与当前待办分开统计。
- 资料库左右分隔线与收件箱工具分隔线支持指针拖动、左右方向键、Home/End 和双击复位。限制最小阅读宽度；窄屏堆叠后隐藏不适用的分隔线。尺寸仅保存在当前浏览器，不存入知识数据或仓库。
- 收件箱导入按工具面板实际宽度排列表单，展开来源信息、切换文本/Git/本地文件不能继承整页列定位。工具区独立滚动，不推挤相邻正文或列表。
