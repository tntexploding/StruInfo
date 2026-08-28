# ADR 0044: 可重复的本地性能基准与按证据优化

- 状态：Accepted
- 日期：2026-08-27
- 里程碑：M1L

## 背景

M1I–M1K 已补齐外部订阅、正式关系语义以及词项/向量/RAG。上线前剩余路线要求先测量导入、
拆分、索引、查询、图谱和订阅，再只优化已经观察到的热点。活动工作区仍须保持无真实资料，
因此本阶段不能用旧周报或个人数据制造性能结论，也不应在没有证据时提前引入缓存服务、
SQL query pushdown 或另一套搜索基础设施。

## 决策

### 一个可重复、无数据的工作负载

根脚本 `corepack pnpm run performance:m1l` 运行固定的合成工作负载，并只向标准输出写一份
`struinfo.m1l-performance-report.v1` JSON 报告。报告包含运行时、规范工作负载摘要、工作负载
SHA-256，以及每个操作的最小值、中位数、P95、最大值和总耗时。它不写数据库、偏好、
Blob、制品或仓库内报告。

标准工作负载覆盖：

- Markdown 解析与 Evidence 物化；
- section Entry 拆分；
- 本地词项投影和 Association 投影重建；
- 词法、语义、混合和两跳 Association 查询；
- 有界正式知识邻域；
- 连接器批次结果校验。

所有内容使用 `synthetic` 与 `example.invalid`，不访问网络、Provider 或真实 PostgreSQL。
以后只有所有者明确授权时才可另行运行真实工作负载；其正文、路径和报告仍不得进入 Git。

### 测量是方向证据，不是正确性门

耗时只能在同一机器、运行时、代码候选和相同 workload hash 下比较。单次数字不是生产 SLO，
也不作为单元测试的耗时阈值。质量门只运行缩小的 smoke workload，验证全部操作真正执行、
报告闭合且不含真实内容；标准基准由开发者显式运行。

### 只优化两个已确认的重复工作

第一次 Windows x64 / Node v24.19.0 标准运行使用 800 个 Entry、8,040 条 Association 投影、
27,997 个词项 posting。它显示两跳 Association 查询中位耗时为 184.565 ms，显著高于当次
词法 8.099 ms、语义 15.310 ms 和混合 14.038 ms。代码检查确认每访问一个节点都会重新把
整份 Entry/Projection/Override snapshot 建成 Map。

M1L 因此在一次查询内只建立一个不可变 Association 读取索引，按 Entry 建立邻接键并缓存
已读取视图，再由全部 BFS 节点复用。相同 workload hash 的最终运行中，两跳查询中位耗时为
4.196 ms，约下降 97.7%；投影、override、屏蔽、过期 revision、隐私过滤、排序和路径
语义均不变。其他操作数字受进程热身与宿主负载影响，本 ADR 不把它们解释成对应代码优化。

本地 HTTP 搜索还存在一次可直接证明的重复读取：检索服务已加载 Entry/Association 后，API
为了私密全文通道再次加载同一 snapshot。M1L 让 lexical 请求直接在一次加载上完成普通结果
与显式私密全文结果；semantic/hybrid 复用检索服务结果，并返回其协议上必为空的私密全文
通道。回归测试锁定 lexical 为一次 Entry load，semantic/hybrid 不在 API 层二次 load。

## 结果与边界

- 主线不增加迁移、数据库、依赖、后台缓存、守护进程或个人数据；
- 性能工具属于开发工具，不进入应用制品；
- 关联读取索引只在单次纯查询内存在，不改变 durable projection 或 override；
- 完整加载式查询继续保留。当前证据不支持 SQL pushdown、`pgvector`、`pg_trgm`、独立搜索
  服务、长期内存缓存或自动后台重建；
- 容器、备份恢复、监控、密钥、升级、生产权限、生产 SLO 和发布边界属于 M1M；
- 真实资料、真实 Provider、真实 PostgreSQL 和并发生产负载的性能结论仍待统一审核阶段。

## 验证

使用 smoke workload、Association 语义回归、搜索 API 调用次数回归和标准 workload hash
复测。完整仓库质量门继续覆盖格式、lint、TypeScript、单元、集成、构建和应用制品审计。
