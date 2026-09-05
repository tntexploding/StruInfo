# ADR 0055：面向残余分类的批量 Codex 复核

- 状态：Accepted
- 日期：2026-09-01
- 决策者：Project owner / Main Agent

## 背景

M2-P2A–D 的真实 refresh 已完成。397 个 Snapshot、14,565 个批次 Entry 全部成功刷新，
但仍留下 11,794 个当前分类异常：

- `classification_type_missing`：7,528；
- `classification_domain_missing`：1,069；
- `classification_tied`：1,868；
- `classification_no_signal`：1,329。

现有 P0E/P0F 已经能够导出 Codex 工作包并闭合写回，但每包最多 20 条，而且默认结果模板不带
现有标签。处理只缺一个维度的条目时，Codex 仍要重复抄写完整三维标签，无法合理处理上述规模。

## 决策

1. 保留 `struinfo.m2-p0e.codex-review-packet.v1` 和
   `struinfo.m2-p0f.codex-review-result.v1`，不建立第二套复核或写回协议。
2. 只有显式选择四个 classification exception code 时，单包上限提高到 100。未指定代码或处理
   旧异常时仍保持 20，避免无意扩大普通正文工作包。
3. 分类结果模板继续以 `action: "replace_me"` 保持默认不可应用，同时预填当前内容关键词、已有
   类型和已有领域。缺失的类型或领域使用 `replace_me`，Codex 只补缺失维度；若改为
   `accept`、`manual_review` 或 `deferred`，必须移除 annotation。
4. 导出器优先使用现有 Entry-ID 选择性读取，只读取被抽样的 Entry；不再为一个工作包加载整个
   工作区。Repository 未实现该优化时仍可回退完整读取。
5. packet 解码、exact adjudication service 和 PostgreSQL adapter 的闭合上限统一为 100，使一个
   100 条结果可以沿现有 Entry 原子修订、精确裁决和增量 Association 重建链完整写回。
6. 16 MiB packet 与 2 MiB result 的字节上限保持不变。正文过大时操作方必须降低 `--limit`，
   不能绕过容量边界。
7. 默认仍排除隐私内容；本次命令显式 `--include-private true` 才可导出。文件仍只写入外部
   `exports/codex-work/`，不进入 Git、数据库或制品。

## 操作顺序

按“一次只补一个问题”的顺序处理：

1. `classification_type_missing`；
2. `classification_domain_missing`；
3. `classification_tied`；
4. `classification_no_signal`。

每轮导出最多 100 条，编辑外部 result 后立即 `review-apply`。成功应用的 exact adjudication 不会
再次出现在 pending packet；过期 revision 会整包拒绝，可重新导出，不需要浏览器逐条恢复。

## 结果与边界

- 这是开发周期 Codex 批量复核，不是 API Provider 自动分类。
- 没有迁移、依赖、UI、后台循环、自动接受或个人资料进入仓库。
- P2F 覆盖率与纠错 UI 仍等待实际复核体验；查询性能问题属于单独的后续性能增量。
- 合成测试覆盖 100 条分类请求、旧 20 条限制、预填模板、选择性 hydration 和 101 条拒绝。
