# ADR 0050: 外部 Codex 审阅工作包

- 状态：Accepted
- 日期：2026-08-31
- 里程碑：M2-P0E

## 背景

M2-P0A–P0D 已能在约十五分钟内把 500 个合成 Snapshot 物化并确定性处理为 15,000 个
Entry，但 `no_deterministic_tags` 等疑难项仍只能按无正文身份抽样。当前开发周期使用 Codex
对话而不是模型 API；若仍由浏览器逐条打开和保存，就无法实现 4–6 小时完整入库目标。

## 决策

maintenance 新增 `ingest review-export`。它只选择仍为 current、`pending` 的 1–20 个 typed
exception，把精确 Entry revision、裁决 version、正文和现有 content/type/domain 标注写入外部
数据根 `exports/codex-work/`。工作包不写 PostgreSQL、不进入 Git、镜像、应用制品、日志或个人
数据包的新分区；其原始数据已由既有完整个人数据包覆盖。

工作包 ID 由 workspace、batch、精确 Entry revision 和内容摘要确定。同一输入重放得到同一文件，
不同内容不能占用同一 ID。旁边生成一个 invalid-by-default 的结果模板，Codex 必须把每个
`replace_me` 改成闭合决定后，P0F 才可读取。导出报告只包含文件名、哈希和计数，不输出正文。

隐私 Entry 仍留在本机外部数据根，但必须在当次命令明确使用 `--include-private true`；默认导出
遇到隐私样本即拒绝，而不是静默扩大范围。

## 结果

- 开发周期 Agent 可成批读取疑难内容，不依赖 Provider/API 或浏览器逐条操作；
- 中断后可按稳定 packet ID 继续，已编辑的结果文件不会被重复导出覆盖；
- 文件是含用户内容的临时外部工作资料，操作方应按自己的保留策略删除；删除不影响数据库和
  完整个人数据备份；
- 本阶段没有迁移、依赖、网页功能或自动写权限。
