# Dependency Governance

- Status: tracked M0-S foundation inventory
- Contract: `C-M0-S-r2`
- Review date: 2026-08-09
- Distribution status: not authorized

This directory makes the admitted dependency decision durable. Package manifests
and the single lockfile remain the install source of truth. The SPDX documents,
legal material, and root `THIRD_PARTY_NOTICES.md` record the corresponding
identity and attribution closure; they do not select a StruInfo distribution
license.

## Exact toolchain

| Tool                     | Exact version or identity                                                |
| ------------------------ | ------------------------------------------------------------------------ |
| Node.js                  | `24.18.0`                                                                |
| pnpm                     | `11.20.0` through `packageManager` and Corepack                          |
| TypeScript               | `6.0.3`                                                                  |
| GitHub checkout action   | `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` (`v7.0.1`)   |
| GitHub Node setup action | `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` (`v7.0.0`) |

The Node version marker, package-manager field, exact engines, CI input, and
lockfile all agree. No pnpm setup or cache action is admitted.

## Direct package ownership

The unique admitted set is exactly 10 runtime and 18 development packages.
Workspace-specific packages are declared by the workspace that imports or
executes them; the root does not provide undeclared application dependencies.
Some development identities occur in more than one importer when both the root
tool configuration and a workspace consume the same exact package.

| Owner                   | Runtime packages                                                                                                                                                                   | Development packages                                                                                                                                                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| root shared tools       | none                                                                                                                                                                               | `@eslint/js@10.0.1`, `@playwright/test@1.62.1`, `@types/node@24.13.3`, `eslint@10.8.1`, `eslint-plugin-react-hooks@7.1.1`, `eslint-plugin-react-refresh@0.5.3`, `globals@17.9.0`, `prettier@3.9.6`, `tsx@4.23.11`, `typescript@6.0.3`, `typescript-eslint@8.66.0`, `vite@8.2.1`, `vitest@4.1.10` |
| `apps/server`           | `@nestjs/common@11.1.28`, `@nestjs/core@11.1.28`, `@nestjs/platform-express@11.1.28`, `drizzle-orm@0.45.2`, `pg@8.22.0`, `pg-boss@12.26.3`, `reflect-metadata@0.2.2`, `rxjs@7.8.2` | `@types/express@5.0.6`, `@types/node@24.13.3`, `@types/pg@8.20.3`, `tsx@4.23.11`                                                                                                                                                                                                                 |
| `apps/web`              | `react@19.2.8`, `react-dom@19.2.8`                                                                                                                                                 | `@types/node@24.13.3`, `@types/react@19.2.18`, `@types/react-dom@19.2.4`, `@vitejs/plugin-react@6.0.5`, `tsx@4.23.11`, `vite@8.2.1`                                                                                                                                                              |
| `packages/contracts`    | none                                                                                                                                                                               | none                                                                                                                                                                                                                                                                                             |
| `packages/test_support` | none                                                                                                                                                                               | none                                                                                                                                                                                                                                                                                             |

`drizzle-kit`, WebSocket/Swagger packages, routers, UI libraries, loggers,
deployment helpers, Redis, BullMQ, and Socket.IO are absent. Adding any package
or changing any version requires a dependency change request and a regenerated
lock/SBOM/NOTICE closure.

## Lock and lifecycle decision

- Final lock SHA-256:
  `A783E1C5B2DADD8B653D8E16446847530473D5569BB08830D7FC03D79400880B`.
- Admitted candidate lock SHA-256:
  `2FAFED41EF12107322AA7498935EF4CBEF59ABC2FAB28F92A222B57F90696095`.
- Final and admitted `packages` plus `snapshots` sections are byte-identical
  after LF normalization; both hash to
  `5D7BCAE392839A92B5B67FCCF0704EDCDA5CAC4F7985B8F414BF7C35BE3DEA5C`.
- The graph therefore retains 367 package entries, 207 snapshot entries, the
  admitted 320-package Windows/Linux target union, identical integrities, peer
  contexts, and platform selections. Only importer ownership changed.
- A 2026-08-09 `pnpm audit --audit-level low --json` result reported zero at
  every severity over 367 lock packages.

`pnpm-workspace.yaml` owns the pnpm 11 policy. Peer installation is disabled;
peer and engine checks, exact saves, store integrity, lock revalidation,
minimum release age, missing-time rejection, exotic-subdependency rejection,
and strict dependency builds are enabled. The normal 1,440-minute release-age
gate accepted every exact package, so no `minimumReleaseAgeExclude` remains.

Lifecycle execution is default-deny. The only selected install lifecycle is
`esbuild@0.28.1` `postinstall`; `allowBuilds` explicitly sets that exact identity
to `false`. Frozen installation is performed with `--ignore-scripts` as a second
control. No dependency lifecycle script is authorized.

## License, notice, and SPDX records

| Tracked artifact                              | SHA-256                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `THIRD_PARTY_NOTICES.md`                      | `4019493BC3EE65C035F02E3F6B32078C385C213294F4352CC6953DFCEB7886C7` |
| `sbom/npm-closure.spdx.json`                  | `62F1AEF94CA2E568D7732E10191DA6AA691D43323B9403B4A3581D760583BB9F` |
| `sbom/github-actions-runtime.spdx.json`       | `A5CD5A5DBD820926AB6F77766756ECCB61BBC9B172096D3927392AF5064B3B59` |
| `evidence/source-license-reconciliation.json` | `3344B7FA8C8C4A90530E6739C835912288F433A5777E63C757281A557BBEAD06` |
| `evidence/lzma-sdk-7zdec-review.json`         | `9A9A573E009DA1E035A51164524B7B0E213C29708362F2647F254946E63C42A7` |

The npm SPDX describes the root plus 320 selected packages. The actions SPDX
describes both pinned actions, their 66-package bundled runtime union, and the
separately licensed LZMA SDK `7zdec.exe` artifact. The tracked legal-material
tree contains 399 files. Exact notice and source-reconciliation paths are checked
against that tree.

Seven npm entries retain conditional review handling: `caniuse-lite` is
`CC-BY-4.0`; `lightningcss` and its two selected platform bindings are
`MPL-2.0`; `type-fest` is `(MIT OR CC0-1.0)`; and `busboy` plus `streamsearch`
retain their parenthesized `(MIT)` expressions. The actions record separately
preserves `@protobuf-ts/runtime`'s
`(Apache-2.0 AND BSD-3-Clause)` expression and the public-domain LZMA SDK
attribution.

## Explicit exclusions and release gate

The Playwright npm package is admitted for configuration and test source only.
Chromium, FFmpeg, winldd, and Linux browser-system packages are absent and remain
owned by `M0-S-BROWSER-MAINT-001`. No browser may be downloaded or made a
mandatory gate before that review passes.

Node and PostgreSQL/pgvector container layers are absent. Compose, Dockerfile,
and database-container CI remain owned by `M0-S-CONTAINER-MAINT-001` after exact
per-platform SBOM, license, and vulnerability closure.

No public or distributable StruInfo release is authorized until the project
owner selects the project license and the release-specific server, browser,
container, sample-data, and other included artifact sets are reconciled against
it.
