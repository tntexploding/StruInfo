# 前端实现对照

依据 2026-10-29 验收的《前端框架》和五页样板。下表列出页面、共用部分与实现位置。

| 部分             | 设计依据                                                             | 实现                                                                                                                                                                                |
| ---------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单入口与导航     | 框架 01、02、07。固定外壳、五条 hash 路由；仅挂载当前页              | [入口](../apps/web/app.js)、[外壳](../apps/web/shell/shell.js)、[生命周期](../apps/web/runtime/route.js)                                                                            |
| 总览             | overview-prototype。标识与统计、六节点流程、AI 中控与消息            | [页面](../apps/web/pages/overview/view.html)、[状态](../apps/web/pages/overview/model.js)、[动效](../apps/web/pages/overview/motion.js)                                             |
| 源管理           | source-layout。唱片、直径上下悬浮条、四类配置、底部接收区            | [页面](../apps/web/pages/sources/view.html)、[唱片](../apps/web/pages/sources/record.js)、[配置](../apps/web/pages/sources/store.js)、[接收](../apps/web/pages/sources/receipts.js) |
| 文档阅读         | reading-layout。全文与旁注、分段标签编辑、相关文档对照               | [页面](../apps/web/pages/reading/view.html)、[编辑](../apps/web/pages/reading/editor.js)、[数据与发布](../apps/web/pages/reading/documents.js)                                      |
| 数据库           | database-layout。居中搜索、顶部结果、折叠侧栏、配置浮层和报告        | [页面](../apps/web/pages/database/view.html)、[搜索](../apps/web/pages/database/results.js)、[报告](../apps/web/pages/database/report-options.js)                                   |
| 设置             | settings-layout。六类设置；每类独立读取、保留草稿、保存和重读        | [页面](../apps/web/pages/settings/page.js)、[字段契约](../apps/web/pages/settings/contract-map.js)、[存储](../apps/web/pages/settings/store.js)                                     |
| 字体、颜色和材质 | 框架 03、05。Sans SC 控件、Serif SC 正文；语义色；玻璃控件、实色正文 | [字体](../apps/web/styles/fonts.css)、[配色](../apps/web/styles/tokens.css)、[材质](../apps/web/styles/material.css)、[控件](../apps/web/styles/controls.css)                       |
| 浮层与结果提示   | 框架 02、05。居中 dialog、锚定 popover、底部展开；错误持续显示       | [对话框](../apps/web/shared/dialog.js)、[区域状态](../apps/web/shared/region.js)、[通知](../apps/web/shared/notice.js)                                                              |
| 栏宽与本地偏好   | 框架 03、08。拖动与键盘调节、工作区隔离、单一存储键                  | [分栏](../apps/web/layout-controls.js)、[偏好](../apps/web/runtime/preferences.js)、[外观](../apps/web/runtime/environment.js)                                                      |
| 请求与写入       | 框架 06、07。读取取消、超时、冲突提示；写入不自动重发                | [请求层](../apps/web/runtime/api.js)                                                                                                                                                |

每页入口为 `page.js`，结构为 `view.html`，样式为 `page.css`。页面样式限定在自己的根节点内。原始样板保留在仓库外。旧多入口和未引用的样式已退出。

公共控件的边界：

- 页面弹窗与共用内容窗使用 `shared/dialog.js` 处理打开、关闭、Escape 和焦点返回。页面保留内容、未保存检查及窗外关闭策略。
- 来源与设置通过 [开关](../apps/web/shared/switch.js) 生成同一结构，尺寸与状态样式集中在 `styles/controls.css`。页面负责数据绑定。
- 五页共用 `shared/notice.js` 的单个通知容器。弹窗打开时，通知置于当前弹窗内；关闭后返回页面层。
- 锚定菜单、底部接收区和单页编辑器保留原结构。公共控件不读取页面业务数据。

系统助手在外壳中挂载一次。结构直接复制 assistant-prototype 的 index.html，交互与样式复用 preview.js、preview.css。正式路由容器替换样板阅读区。实现为 [结构](../apps/web/shell/assistant.html)、[事件](../apps/web/shell/assistant.js)、[样式](../apps/web/shared/assistant-surfaces.css)。旧 assistant-dialog 和 assistant.css 已移除。后端调用范围见[系统助手](system-assistant.md)。
助手保留并排与展开模式。展开状态、并排宽度和窗口位置按工作区记忆。访问密钥仅留在当前页面。会话、执行步骤、确认和后台任务共用助手接口。AI 设置增加后台队列暂停与助手价格限制，保存时检查原有配置版本。

本轮接口适配：

- 总览使用 `GET entry-documents/summary`。不下载全部文档正文来计数。
- 文档列表支持游标、关键词、类型和阅读状态。正文按选定文档读取。
- `topics_list` 支持 `snapshotId`，返回关系成员的文档标识。阅读页无需逐条查询联系端点。
- 来源写入移除读取结果附带的运行状态。来源配置与 AI 范围分别保存版本。保存栏固定在底部；接收区默认 45%，最高 70%，支持拖动和方向键。
- 查询配置保留未应用草稿；点击应用后用于后续查询。
- 阅读页分别保存修改、发布基础内容和保存联系。页面不代替后端推定发布结果。
- `preferences/review` 沿用现有无版本接口。前端不自动重试其写入。

五页接口验证使用仓库外临时库和合成文档，覆盖导航、保存、发布、联系、搜索、设置、失败状态和实际截图。
助手已在本地 Docker 验证唯一入口、展开记忆、窗口拖放、报告阅读和历史删除。删除验证使用临时对话，保留已有对话和业务数据，未调用模型。

可调整浮窗的边界：

- 展开助手和报告阅读窗使用 [窗口几何](../apps/web/shared/window-geometry.js)。标题拖动，右下角缩放，工具栏复位。支持方向键，窗口保持在视口内。
- 小于 700 像素宽或 480 像素高时，使用固定布局，保留桌面位置。
- 助手与数据库共用 [报告阅读](../apps/web/shared/report-reader.js) 和单个 [内容窗](../apps/web/shared/content-dialog.js)。报告采用样板的玻璃层和透明背景。
- 内容窗显示历史、文档选择或参数时关闭位置调节。页面表单、锚定菜单、底部接收区不接入窗口几何。
- 阅读窗只处理展示与导出。任务控制保留确认；编辑与发布保留原接口和版本检查。
