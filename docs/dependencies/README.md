# Dependency Governance

- Status: tracked foundation inventory plus the M1A Markdown dependency increment
- Contracts: `C-M0-S-r2`, `C-SLICE-A-MARKDOWN-r2`
- Review date: 2026-08-11
- Distribution status: not authorized

This directory makes the admitted dependency decision durable. Package manifests
and the single lockfile remain the install source of truth. The SPDX documents,
legal material, and root `THIRD_PARTY_NOTICES.md` record the corresponding
identity and attribution closure; they do not select a StruInfo distribution
license.

## Toolchain baseline

| Tool                     | Version, range, or identity                                              |
| ------------------------ | ------------------------------------------------------------------------ |
| Node.js                  | `>=24.18.0`; reference minimum and CI version: `24.18.0`                 |
| pnpm                     | `11.20.0` through `packageManager` and Corepack                          |
| TypeScript               | `6.0.3`                                                                  |
| GitHub checkout action   | `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` (`v7.0.1`)   |
| GitHub Node setup action | `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` (`v7.0.0`) |

The Node version marker and CI retain the recommended minimum. Package engines
accept that version or newer, and pnpm engine checking is deliberately
non-strict so a local version mismatch produces guidance instead of blocking
repository commands. The exact pnpm/package graph and lockfile policy remain
unchanged. No pnpm setup or cache action is admitted.

## Direct package ownership

The unique admitted set is exactly 11 runtime and 18 development packages.
Workspace-specific packages are declared by the workspace that imports or
executes them; the root does not provide undeclared application dependencies.
Some development identities occur in more than one importer when both the root
tool configuration and a workspace consume the same exact package.

| Owner                   | Runtime packages                                                                                                                                                                                                     | Development packages                                                                                                                                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| root shared tools       | none                                                                                                                                                                                                                 | `@eslint/js@10.0.1`, `@playwright/test@1.62.1`, `@types/node@24.13.3`, `eslint@10.8.1`, `eslint-plugin-react-hooks@7.1.1`, `eslint-plugin-react-refresh@0.5.3`, `globals@17.9.0`, `prettier@3.9.6`, `tsx@4.23.11`, `typescript@6.0.3`, `typescript-eslint@8.66.0`, `vite@8.2.1`, `vitest@4.1.10` |
| `apps/server`           | `@nestjs/common@11.1.28`, `@nestjs/core@11.1.28`, `@nestjs/platform-express@11.1.28`, `drizzle-orm@0.45.2`, `mdast-util-from-markdown@2.0.3`, `pg@8.22.0`, `pg-boss@12.26.3`, `reflect-metadata@0.2.2`, `rxjs@7.8.2` | `@types/express@5.0.6`, `@types/node@24.13.3`, `@types/pg@8.20.3`, `tsx@4.23.11`                                                                                                                                                                                                                 |
| `apps/web`              | `react@19.2.8`, `react-dom@19.2.8`                                                                                                                                                                                   | `@types/node@24.13.3`, `@types/react@19.2.18`, `@types/react-dom@19.2.4`, `@vitejs/plugin-react@6.0.5`, `tsx@4.23.11`, `vite@8.2.1`                                                                                                                                                              |
| `packages/contracts`    | none                                                                                                                                                                                                                 | none                                                                                                                                                                                                                                                                                             |
| `packages/test_support` | none                                                                                                                                                                                                                 | none                                                                                                                                                                                                                                                                                             |

`drizzle-kit`, WebSocket/Swagger packages, routers, UI libraries, loggers,
deployment helpers, Redis, BullMQ, and Socket.IO are absent. Adding any package
or changing any version requires a dependency change request and a regenerated
lock/SBOM/NOTICE closure.

### Markdown parser dependency increment

`M1A-MD-DEP-MAINT-001` admits only
`mdast-util-from-markdown@2.0.3` as an `apps/server` direct runtime package.
It does not add `unified`, `remark-parse`, a GFM plugin, or a UUID package.

The exact resolver-selected runtime closure contains 34 packages:

- direct: `mdast-util-from-markdown@2.0.3`;
- net-new transitive: `@types/debug@4.1.13`, `@types/mdast@4.0.4`,
  `@types/ms@2.1.0`, `@types/unist@3.0.3`,
  `character-entities@2.0.2`,
  `decode-named-character-reference@1.3.0`, `dequal@2.0.3`, `devlop@1.1.0`,
  `mdast-util-to-string@4.0.0`, `micromark-core-commonmark@2.0.3`,
  `micromark-factory-destination@2.0.1`, `micromark-factory-label@2.0.1`,
  `micromark-factory-space@2.0.1`, `micromark-factory-title@2.0.1`,
  `micromark-factory-whitespace@2.0.1`, `micromark-util-character@2.1.1`,
  `micromark-util-chunked@2.0.1`,
  `micromark-util-classify-character@2.0.1`,
  `micromark-util-combine-extensions@2.0.1`,
  `micromark-util-decode-numeric-character-reference@2.0.2`,
  `micromark-util-decode-string@2.0.1`, `micromark-util-encode@2.0.1`,
  `micromark-util-html-tag-name@2.0.1`,
  `micromark-util-normalize-identifier@2.0.1`,
  `micromark-util-resolve-all@2.0.1`,
  `micromark-util-sanitize-uri@2.0.1`,
  `micromark-util-subtokenize@2.1.0`, `micromark-util-symbol@2.0.1`,
  `micromark-util-types@2.0.2`, `micromark@4.0.2`, and
  `unist-util-stringify-position@4.0.0`;
- already-admitted transitive packages reused by this runtime path:
  `debug@4.4.3` and `ms@2.1.3`.

All 34 exact tarballs match their lock and registry SHA-512 integrity. The 32
net-new packages each carry exact MIT legal text; no source reconciliation is
needed. The closure has no install lifecycle, bundled dependency, native/Wasm
binary, platform restriction, resolved optional dependency, or resolved peer
package. `debug@4.4.3` retains optional `supports-color` peer metadata, but peer
auto-install is disabled and no `supports-color` package is selected. Four
packages declare publication-only `prepack` or `prepublishOnly` scripts; those
scripts are not install lifecycle and were not run. Published JavaScript,
declaration files, and source maps remain ordinary npm package content rather
than separately bundled third-party binaries.

## Lock and lifecycle decision

- Current lock SHA-256:
  `99F261C35311919380BF6AEF018E0B2A9D076DC7937A5EDE1E0D7F26F56192A0`.
- Pre-increment baseline lock SHA-256:
  `A783E1C5B2DADD8B653D8E16446847530473D5569BB08830D7FC03D79400880B`.
- The current graph has 399 package entries and 231 snapshot entries. The
  Markdown increment adds 32 package entries and 24 materialized snapshot
  entries, removes none, and introduces no package outside its 34-package
  runtime closure.
- The selected Windows x64 and Linux x64/glibc union is 352 packages: the
  admitted 320-package foundation union plus 32 universal net-new packages.
- A network-backed 2026-08-11
  `pnpm audit --audit-level low --json` result reported zero at every severity
  over all 399 lock packages. This is a point-in-time registry result, not a
  perpetual vulnerability guarantee.

`pnpm-workspace.yaml` owns the pnpm 11 policy. Peer installation is disabled;
peer checks, exact saves, store integrity, lock revalidation, minimum release
age, missing-time rejection, exotic-subdependency rejection, and strict
dependency builds are enabled. Node engine compatibility is advisory rather
than an operation-blocking gate. The normal 1,440-minute release-age gate
accepted every exact package, so no `minimumReleaseAgeExclude` remains.

Lifecycle execution is default-deny. The only selected install lifecycle is
`esbuild@0.28.1` `postinstall`; `allowBuilds` explicitly sets that exact identity
to `false`. Frozen installation is performed with `--ignore-scripts` as a second
control. No dependency lifecycle script is authorized, and the Markdown
increment does not require an `allowBuilds` change.

## License, notice, and SPDX records

| Tracked artifact                              | SHA-256                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `THIRD_PARTY_NOTICES.md`                      | `F2D9EC875E62B34250414A61F214EAB65728EA4401BB4DFB99FBB6A04EDDF37F` |
| `sbom/npm-closure.spdx.json`                  | `8220A025E2E934EEBC2F7CA5FD983ADEB5D6D7A739AF1C701CE48F7F4E4DEF52` |
| `sbom/github-actions-runtime.spdx.json`       | `A5CD5A5DBD820926AB6F77766756ECCB61BBC9B172096D3927392AF5064B3B59` |
| `evidence/source-license-reconciliation.json` | `3344B7FA8C8C4A90530E6739C835912288F433A5777E63C757281A557BBEAD06` |
| `evidence/lzma-sdk-7zdec-review.json`         | `9A9A573E009DA1E035A51164524B7B0E213C29708362F2647F254946E63C42A7` |

The npm SPDX describes the root plus 352 selected packages. The actions SPDX
describes both pinned actions, their 66-package bundled runtime union, and the
separately licensed LZMA SDK `7zdec.exe` artifact. The tracked legal-material
tree contains 431 files. Exact notice and source-reconciliation paths are checked
against that tree.

Seven npm entries retain conditional review handling: `caniuse-lite` is
`CC-BY-4.0`; `lightningcss` and its two selected platform bindings are
`MPL-2.0`; `type-fest` is `(MIT OR CC0-1.0)`; and `busboy` plus `streamsearch`
retain their parenthesized `(MIT)` expressions. The actions record separately
preserves `@protobuf-ts/runtime`'s
`(Apache-2.0 AND BSD-3-Clause)` expression and the public-domain LZMA SDK
attribution. All 32 net-new Markdown-closure packages are routine-review MIT;
none adds a NOTICE file or a source-reconciliation record.

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
