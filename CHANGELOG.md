# Changelog

## 0.4.0 - 2026-10-19

- Adds multi-channel historical discovery, source feedback and editable introductions.
- Consolidates document processing constraints, durable recovery, configurable concurrency and bounded retries.
- Applies the accepted theme across all workspaces with real-progress overview motion and remembered reading settings.
- Removes eleven unreachable legacy UI modules and their obsolete tests.
- Fixes six production dependency advisories and the runtime build failure caused by a removed Debian package revision.
- Adds browser and disposable PostgreSQL CI checks, main-push security checks, and application-oriented setup documentation.
- Includes forward migration 000039 and processing bundle v15 with older bundle support.

See [v0.4.0 release notes](docs/releases/v0.4.0.md) for upgrade steps and limits.

## 0.3.0 - 2026-09-20

- Consolidates document entry, processing, reading and reports into four document-centred workspaces.
- Completes bounded AI receipt review, contextual splitting, tags, relations and revision-checked publication; exposes the same authority boundary through Agent / MCP commands.
- Adds remembered layouts, source-aware previews, optional on-demand summaries and visible per-document queues with checkpoint recovery and cancellation.
- Preserves coherent long articles, confirms tag aliases in retrieval, separates draft work from published knowledge and respects AI permission / price windows.
- Extends reports to monthly/topic periods and model-free collections, with Markdown and local PDF printing.
- Corrects settled-history queue counts and an ordinary-English false positive in backup credential checks.
- Keeps owner data external and requires no new dependency or migration beyond the existing 000038 baseline.

See [v0.3.0 release notes](docs/releases/v0.3.0.md) for upgrade and operating limits.

## 0.2.0 - 2026-09-05

Maintenance baseline: recoverable processing, incremental indexes, saved reading contexts, source review and cited Markdown export. See [v0.2.0 notes](docs/releases/v0.2.0.md).

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
