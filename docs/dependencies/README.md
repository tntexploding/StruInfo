# Dependency inventory

Package manifests and `pnpm-lock.yaml` select the installed versions. The SPDX inventory and `THIRD_PARTY_NOTICES.md` record their sources and legal material. StruInfo uses MIT; each third-party package retains its own license.

## Current release: v0.5.0

This release includes the [October 28 security repair](evidence/security-reconciliation-2026-10-28.json). MCP, Vite, Vitest, request parsers and their selected dependencies move to patched versions. The npm SPDX inventory contains 373 dependency identities for Windows x64 and Linux x64/glibc, plus the application root. The Alpine runtime uses its JavaScript production subset without native bindings.

| Component      | Version or reference                                           |
| -------------- | -------------------------------------------------------------- |
| Node.js        | >=24.18.0; CI tests the minimum                                |
| pnpm           | 11.20.0, selected through Corepack                             |
| TypeScript     | 6.0.3                                                          |
| Runtime base   | Node 24 Alpine digest; Bookworm Slim is used for building      |
| GitHub Actions | Immutable checkout/setup-node revisions in `.github/workflows` |
| Scanner        | Trivy 0.74.0; pinned official archive checksum                 |

## Ownership and install policy

Runtime dependencies belong to the workspace that imports them. Root packages are development tools. The backend uses Nest/Express, PostgreSQL/Drizzle, pg-boss, the official MCP SDK and bounded document parsers; the frontend uses React/Vite and the existing Markdown parser. Model requests use the existing HTTP adapters, without an additional vendor SDK.

`pnpm-workspace.yaml` controls exact versions, overrides, a 24-hour minimum release age, store integrity, lock revalidation, strict peer dependencies and lifecycle denial. Frozen installation uses `--ignore-scripts`. The optional PDF Canvas package is excluded. These controls were retained during the security repair.

Dependency changes require reviewing registry identity, archive integrity, license and install scripts, then updating the lockfile, notices and SPDX relationships. Superseded npm legal folders can be removed once no selected package or retained notice references them. Historical evidence documents remain as dated records.

## Legal records

- `sbom/npm-closure.spdx.json`: application and selected npm packages, checksums and relationships.
- `sbom/github-actions-runtime.spdx.json`: pinned actions and their bundled dependencies.
- `licenses/npm/`: exact installed package legal text.
- `licenses/npm-source/` and `evidence/source-license-reconciliation.json`: packages whose archive omits its standalone legal file.
- `evidence/lzma-sdk-7zdec-review.json`: separate attribution retained for the action runtime.

The existing conditional license decisions remain: CC-BY-4.0 for caniuse-lite, MPL-2.0 for Lightning CSS and selected bindings, `(MIT OR CC0-1.0)` for type-fest, and the recorded combined/runtime expressions. Security patch packages remain MIT or BSD-3-Clause and add no lifecycle script.

## Test and distribution tools

Browser tests use an already installed Chrome, including the GitHub-hosted runner's browser. The project does not download or bundle browser binaries. PostgreSQL smoke reuses the admitted disposable `postgres:18.6` harness and synthetic data. Trivy runs outside the application and never ships in its runtime image.

The application image contains only built code, migrations, static assets, production dependencies and legal material. It runs as a non-root user; npm/Corepack/Yarn are removed. PostgreSQL, runtime configuration, model keys, originals and backups remain external.

Prior decisions: [September 5](evidence/maintenance-security-2026-09-05.md), [September 15](evidence/maintenance-security-2026-09-15.md). These are historical scan results; consult the current workflow for current findings.
