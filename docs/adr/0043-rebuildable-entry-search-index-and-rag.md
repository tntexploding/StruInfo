# ADR 0043: 可重建 Entry 检索索引、向量召回与 RAG

- 状态：Accepted
- 日期：2026-08-27
- 里程碑：M1K

## 背景

M1F-1 已提供标题、正文和三维标签上的精确、包含与近似词法查询，M1F-3 可对前八条
公开结果进行带来源的会话内综合。它们没有中文局部词项投影、向量召回或真正由检索
模式选择证据的 RAG。上线前路线要求先建立可替换索引和离线重建，再提供召回评估，
同时保留无 Provider 的完整 Query 主线。

## 决策

### 规范数据与派生索引分离

`InformationEntry` 当前态仍是规范数据。前向迁移 `000025` 只增加两张可全部删除并重建的
派生表：

- `information_entry_search_projection` 绑定 Entry ID、精确当前 revision、投影摘要、
  tokenizer 版本和可选 embedding provider/model/vector；
- `information_entry_term_posting` 保存 `title / body / tags` 三个字段的有界词项与出现次数。

重建在 workspace write lock 下原子替换整个工作区索引。索引不进入个人数据包；恢复后
状态明确显示未建立，由用户重新生成。这样不会把同一份可推导数据复制进长期个人资料，
也不会让模型切换变成数据迁移。

### 可替换的本地词项投影

`struinfo.entry-terms.unicode-v1` 复用既有 NFC 与 ASCII 小写规则。字母、标记和数字形成
普通词；Han、Hiragana、Katakana 与 Hangul 连续文本生成单字和相邻双字。该实现是稳定、
本地、无字典的首版召回投影，不宣称完成语言学分词。标题、正文和内容/类型/领域标签
分别保留字段身份；每个 Entry 的投影和 Provider 输入均有明确上限。

### 可选向量 Provider

首个向量边界使用原生 `fetch` 调用 OpenAI Embeddings API，不增加 SDK。模型只从外部
`STRUIINFO_OPENAI_EMBEDDING_MODEL` 配置读取，API key 仍只来自环境变量
`OPENAI_API_KEY`。请求和响应按输入索引闭合校验，向量必须有限、非空且维数一致。

没有 embedding 配置时，词项索引与全部词法 Query 仍可使用，界面不得宣告语义检索
可用。私密 Entry 在投影、Provider 调用、向量召回、计数和 RAG 之前排除；M1K 不允许
把私密正文或标签发送给外部 Provider。

### 三种检索模式与可解释排序

Query 增加：

- `lexical`：保持既有确定性匹配、排序、摘要和 cursor 兼容；
- `semantic`：只使用与当前 Entry revision、当前 tokenizer 和当前模型完全匹配的向量；
- `hybrid`：保留词法或向量任一召回，二者同时存在时按 45% 词法、55% 向量组成有界
  整数分。

语义和混合模式进入 query digest 与 cursor；结果公开词法分、向量相似度、Provider、模型、
索引版本及最终检索分。旧或过期投影不参与召回。状态 API 显示当前公共 Entry、有效投影、
已嵌入投影、过期投影和词项数量，Query 页提供显式重建操作。

### 召回评估与 RAG

测试/开发评估入口接收小型显式 query→expected Entry ID 集合，返回 Recall@K 与 MRR 的
0–10000 整数结果；它不保存查询、判断或用户行为。当前数据为空时只用合成、无个人含义
的样例验证。

既有 Query 综合现在复用同一个检索服务。用户选择 semantic 或 hybrid 时，Provider 综合
接收到的仍只是本地检索出的前八条公开有界证据和临时句柄；引用继续映射回精确
Snapshot/Fragment。答案只存在页面会话，不写 Entry、图谱、偏好、处理任务或索引。这是
带本地证据的 RAG，不是 Provider 自主搜索、Web 搜索或通用代理。

## 非目标

M1K 不引入独立向量数据库、搜索服务、`pgvector`、`pg_trgm`、后台自动重建、私密内容
外发、答案历史、自动事实确认、模型训练、第二 Embedding Provider、SQL query pushdown
或生产性能结论。上述内容只能由后续 M1L/M1M 或真实使用证据推动。

## 验证

使用合成 Entry、二维已知向量、注入式 fetch 和内存/假 PostgreSQL 边界验证词项、投影
上限、余弦已知答案、重建、语义/混合排序、隐私先行、Recall@K/MRR、OpenAI 请求闭合、
迁移和 repository 映射。活动工作区不导入真实资料。
