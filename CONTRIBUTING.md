# Contributing to StruInfo

StruInfo is a single-owner document workspace. Changes should keep the complete path usable: receive a document, review it, organize its entries, then publish it for retrieval and reports.

## Set up

Use Node.js >=24.18.0, Corepack and pnpm 11.20.0. Install the frozen graph without lifecycle scripts:

```bash
corepack enable
pnpm install --frozen-lockfile --ignore-scripts
pnpm verify
```

The normal checks use synthetic fixtures and do not need a model or a personal database. To run the application, follow [the installation guide](docs/getting-started.md). Runtime configuration, documents and secrets belong outside the repository.

## Code map

| Directory                                        | Responsibility                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| `apps/server/src/modules`                        | Evidence, entries, processing, subscriptions and domain rules               |
| `apps/server/src/application`                    | Document use cases, execution authority, task orchestration and publication |
| `apps/server/src/platform`                       | PostgreSQL, network sources and model adapters                              |
| `apps/server/src/transport`                      | Owner HTTP and external Agent / MCP interfaces                              |
| `apps/server/src/composition`                    | Runtime wiring; keep framework setup out of domain rules                    |
| `apps/server/src/storage`, `workspace_transfer`  | External files, preferences, backup and compatibility codecs                |
| `apps/server/migrations`                         | Immutable forward SQL migrations                                            |
| `apps/web/src/workspaces`, `components`, `theme` | Product pages, shared controls and accepted theme                           |
| `packages/contracts`                             | Shared wire contracts and schemas                                           |
| `packages/test_support`, `tests`, `tools`        | Synthetic fixtures, product checks and maintenance tooling                  |

Keep writes in shared application use cases. New HTTP and MCP callers must reuse permission, revision, privacy and publication checks. Original evidence is immutable. Human decisions and drafts take priority over automatic work. Historical schemas and saved task checkpoints remain readable even when their old UI has been removed.

## Make a change

1. Read `AGENTS.md` and its canonical documents. Use a branch from public `main` for ordinary contributions.
2. State the user-visible problem and keep the implementation focused.
3. Add regression coverage for a reproduced behavior defect. Use synthetic content only.
4. Update usage documentation when behavior or configuration changes.
5. Run the checks relevant to the change, then the release checks below when preparing a release.

Use `type(scope): summary` commit subjects. PR descriptions should explain the resulting behavior and validation. New dependencies and version changes require updated lockfile, license material, notices and SBOM. Do not alter applied migration files or replace old schemas to simplify tests.

## Checks and release

```bash
pnpm verify
pnpm test:e2e
pnpm performance:m2-p0d -- --smoke
pnpm audit --prod --audit-level low
docker build --tag struinfo:review .
```

Browser checks use installed Chrome; they do not download a browser. PostgreSQL smoke creates and removes its own Docker container and external temporary data. Use `--full` only for an intentional larger synthetic capacity check.

For P1–P5 publication, receiving, splitting, annotations and topics, run `pnpm test:publication`. It creates an empty
PostgreSQL container and checks manual import, HTTP/MCP confirmation and query,
draft isolation, topic persistence and conflicts, background failure, privacy and export/restore. The container is
removed on exit; its synthetic test report stays in the printed temporary directory.
No model configuration or private instance connection is loaded. See
[ADR 0088](docs/adr/0088-confirmed-content-and-deferred-organization.md) for the
publication boundary and [ADR 0092](docs/adr/0092-bounded-background-topics.md) for independent bounded topic work.

GitHub runs the quality matrix on Windows and Ubuntu, browser/PostgreSQL smoke, and production dependency/runtime image security checks. A failed check stays failed until repaired or explicitly reviewed; do not remove tests or suppress findings to make a badge green. Maintenance security also runs weekly and can be started manually.

Before release, synchronize package/image/MCP versions, changelog, release notes and SBOM; inspect the staged tree for owner data and secrets. The project's existing public `main` history is independent of the owner's development branch. Release reviewed source as a normal descendant of public `main`; never merge the private development history or force-push it over public history.

Publishing source does not upgrade an existing installation. Deployment uses a verified external backup, forward migration, queue preparation, runtime grants and preflight. Preserve the owner's settings and existing model permissions.

## Reference

- [Product requirements](docs/product-requirements.md)
- [Architecture](docs/knowledge-core-architecture.md)
- [Development standards](docs/development-standards.md)
- [Frontend design](docs/frontend-design-specification.md)
- [Dependency policy](docs/open-source-policy.md)
- [Current implementation](docs/current-project-state.md) and [roadmap](docs/roadmap.md)

Code is MIT licensed. Releases retain [third-party notices](THIRD_PARTY_NOTICES.md), exact legal material and the SBOM. Documents, credentials, screenshots of private content, model replies and operation logs are not release materials.

P2 configuration and receipt behavior are documented in [source receiving](docs/source-receiving.md). Source strategies and capture metadata remain external data; use synthetic fixtures for tests.

P3 recipes, trials and task compatibility are documented in [source splitting](docs/source-splitting.md).
Personal recipes remain external; use synthetic sources for rule and browser tests.

## Structured annotation changes

See [ADR 0091](docs/adr/0091-evidence-bound-structured-annotations.md) and the
[annotation guide](docs/structured-annotations.md). Keep body evidence, term identity,
manual authority and confirmed publication checks together. Catalog fixtures must be synthetic;
real vocabularies and model results stay outside Git. `pnpm test:publication` verifies migration,
proposal persistence, confirmed retrieval and restore in disposable PostgreSQL.
