# Changelog

## 0.1.0 - 2026-08-28

Initial private single-user release.

- Ships the seven-page `总览 / 导入 / 拆分 / 标签 / 联系 / 查询 / 知识` workflow.
- Keeps original evidence, database state, Blob bytes, preferences, secrets,
  exports and backups outside the repository and container image.
- Supports local files, GitHub Markdown, RSS/Atom, declarative JSON APIs,
  constrained same-origin pages and installed trusted source connectors.
- Provides manual, deterministic and optional OpenAI-assisted split, tag,
  association and evidence-bounded query flows.
- Provides lexical, semantic and hybrid Entry retrieval plus the editable,
  Entry-centred formal relationship graph.
- Presents association basis-point scores as ordinary percentages throughout
  the editable knowledge graph.
- Adds the non-root read-only Docker runtime, PostgreSQL 18 migration and
  maintenance path, backup/restore, health checks, security headers and the
  authenticated HTTPS reverse-proxy deployment boundary.

This release does not turn StruInfo into a public multi-user service. The
application port must remain private and all remote access must pass through the
operator's authenticated HTTPS proxy, VPN or SSH tunnel.
