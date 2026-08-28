# Dependency Governance

- Status: tracked foundation inventory plus the M1A Markdown, M1E-5B document-import and M1I-2 RSS/Atom dependency increments
- Contracts: `C-M0-S-r2`, `C-SLICE-A-MARKDOWN-r2`
- Review date: 2026-08-24
- Distribution status: `v0.1.0` source and private-runtime image authorized

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

The unique admitted set is exactly 14 runtime and 18 development packages.
Workspace-specific packages are declared by the workspace that imports or
executes them; the root does not provide undeclared application dependencies.
Some development identities occur in more than one importer when both the root
tool configuration and a workspace consume the same exact package.

| Owner                   | Runtime packages                                                                                                                                                                                                                                                                     | Development packages                                                                                                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| root shared tools       | none                                                                                                                                                                                                                                                                                 | `@eslint/js@10.0.1`, `@playwright/test@1.62.1`, `@types/node@24.13.3`, `eslint@10.8.1`, `eslint-plugin-react-hooks@7.1.1`, `eslint-plugin-react-refresh@0.5.3`, `globals@17.9.0`, `prettier@3.9.6`, `tsx@4.23.11`, `typescript@6.0.3`, `typescript-eslint@8.66.0`, `vite@8.2.1`, `vitest@4.1.10` |
| `apps/server`           | `@nestjs/common@11.1.28`, `@nestjs/core@11.1.28`, `@nestjs/platform-express@11.1.28`, `drizzle-orm@0.45.2`, `fast-xml-parser@5.11.0`, `mdast-util-from-markdown@2.0.3`, `parse5@8.0.1`, `pdfjs-dist@6.2.108`, `pg@8.22.0`, `pg-boss@12.26.3`, `reflect-metadata@0.2.2`, `rxjs@7.8.2` | `@types/express@5.0.6`, `@types/node@24.13.3`, `@types/pg@8.20.3`, `tsx@4.23.11`                                                                                                                                                                                                                 |
| `apps/web`              | `react@19.2.8`, `react-dom@19.2.8`                                                                                                                                                                                                                                                   | `@types/node@24.13.3`, `@types/react@19.2.18`, `@types/react-dom@19.2.4`, `@vitejs/plugin-react@6.0.5`, `tsx@4.23.11`, `vite@8.2.1`                                                                                                                                                              |
| `packages/contracts`    | none                                                                                                                                                                                                                                                                                 | none                                                                                                                                                                                                                                                                                             |
| `packages/test_support` | none                                                                                                                                                                                                                                                                                 | none                                                                                                                                                                                                                                                                                             |

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

### HTML/PDF parser dependency increment

`M1E-5B-DOCUMENT-IMPORT` admits `parse5@8.0.1` and
`pdfjs-dist@6.2.108` as `apps/server` direct runtime packages. The only net-new
transitive package is `entities@8.0.0`. The three exact public tarballs match
the lock SHA-512 integrity and the independently computed SHA-256 values kept
in the SPDX document. Their declared licenses are MIT, Apache-2.0 and
BSD-2-Clause, and exact legal files are retained under
`docs/dependencies/licenses/npm/`.

PDF.js declares `@napi-rs/canvas` as optional. StruInfo uses only its data-only
text extraction path, so `pnpm-workspace.yaml` explicitly lists that package in
`ignoredOptionalDependencies`. No Canvas package, platform native binding,
install lifecycle or Wasm/image-rendering capability enters the selected lock
closure. The PDF.js module is loaded only for an explicit PDF import; a narrow
identity `DOMMatrix` compatibility value permits module initialization without
claiming or exposing rendering. This exclusion is functional: M1E-5B does not
perform OCR or visual PDF reconstruction.

### RSS/Atom parser dependency increment

`M1I-2-RSS-ATOM` admits `fast-xml-parser@5.11.0` as an `apps/server`
direct runtime package. Its exact eight-package selected closure is the direct
package plus `@nodable/entities@3.0.0`, `anynum@1.0.1`,
`fast-xml-builder@1.3.1`, `is-unsafe@2.0.2`,
`path-expression-matcher@1.6.2`, `strnum@2.4.2` and `xml-naming@0.3.0`.
All eight declare MIT, contain no native binary or install lifecycle, and are
used only to parse bounded RSS/Atom XML after the product has rejected DTDs and
local/private network targets. The connector does not execute XML, follow item
links or gain a database write port.

Seven exact package legal files are retained under
`docs/dependencies/licenses/npm/`. The `@nodable/entities@3.0.0` tarball
declares MIT but omits a standalone license file, so its declaration and author
are reconciled to canonical MIT text under `npm-source/` and recorded in the
existing source-license reconciliation evidence. The SPDX records the exact
SHA-512 integrity selected by the lockfile for all eight packages.

## Lock and lifecycle decision

- Current lock SHA-256:
  `9AA55459A0A5EDD2D6AB7BEEB8CD81152297CB2276CB2026E4634F2306D7BD22`.
- M1I-2 pre-increment lock SHA-256:
  `10FB9E8A9E6403A7D7F5BE445776C50F6DF748D33F85923E54CDBE9B18471C4A`.
- M1E-5B pre-increment lock SHA-256:
  `99F261C35311919380BF6AEF018E0B2A9D076DC7937A5EDE1E0D7F26F56192A0`.
- Foundation pre-M1A lock SHA-256:
  `A783E1C5B2DADD8B653D8E16446847530473D5569BB08830D7FC03D79400880B`.
- The current lock has 410 package entries. The
  M1A Markdown increment remains 32 package entries and 24 materialized
  snapshots; M1E-5B adds exactly 3 package entries and 1 dependency-bearing
  snapshot; M1I-2 adds exactly 8 universal package entries and removes none.
- The selected Windows x64 and Linux x64/glibc union is 363 packages: the
  admitted 320-package foundation union plus 32 Markdown packages and 3
  universal document-import packages plus 8 RSS/Atom XML packages.
- A network-backed 2026-08-28 `pnpm audit --prod --audit-level low` result
  reported no known production-package vulnerabilities. The `v0.1.0` runtime
  image also removes the unused global npm/Corepack/Yarn toolchain; Trivy 0.66.0
  then reported 0 HIGH and 0 CRITICAL findings for the final local image.
  These are point-in-time results, not a perpetual vulnerability guarantee.

`pnpm-workspace.yaml` owns the pnpm 11 policy. Peer installation is disabled;
peer checks, exact saves, store integrity, lock revalidation, minimum release
age, missing-time rejection, exotic-subdependency rejection, and strict
dependency builds are enabled. Node engine compatibility is advisory rather
than an operation-blocking gate. The normal 1,440-minute release-age gate
accepted every exact package, so no `minimumReleaseAgeExclude` remains.

Lifecycle execution is default-deny. The only selected install lifecycle is
`esbuild@0.28.1` `postinstall`; `allowBuilds` explicitly sets that exact identity
to `false`. Frozen installation is performed with `--ignore-scripts` as a second
control. No dependency lifecycle script is authorized. Neither parser increment requires
an `allowBuilds` change; the unused PDF.js Canvas optional dependency is skipped
at resolution/install time.

## License, notice, and SPDX records

| Tracked artifact                              | SHA-256                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `THIRD_PARTY_NOTICES.md`                      | `EA5367975DAB23FBD5907DF041776E068CDFBEB7E8B077923622A9ACD2684242` |
| `sbom/npm-closure.spdx.json`                  | `AAF46524099C08A9574C236EA51D5F1238B46D8BCA0AC0209C11495ADA60FE25` |
| `sbom/github-actions-runtime.spdx.json`       | `A5CD5A5DBD820926AB6F77766756ECCB61BBC9B172096D3927392AF5064B3B59` |
| `evidence/source-license-reconciliation.json` | `2613B9B3894A1A1B5AAE3A7857BB96E46720ADAC7ED6C81736482E4197ABE0CF` |
| `evidence/lzma-sdk-7zdec-review.json`         | `9A9A573E009DA1E035A51164524B7B0E213C29708362F2647F254946E63C42A7` |

The npm SPDX describes the root plus 363 selected packages. The actions SPDX
describes both pinned actions, their 66-package bundled runtime union, and the
separately licensed LZMA SDK `7zdec.exe` artifact. The tracked legal-material
tree contains 442 files. Exact notice and source-reconciliation paths are checked
against that tree.

Seven npm entries retain conditional review handling: `caniuse-lite` is
`CC-BY-4.0`; `lightningcss` and its two selected platform bindings are
`MPL-2.0`; `type-fest` is `(MIT OR CC0-1.0)`; and `busboy` plus `streamsearch`
retain their parenthesized `(MIT)` expressions. The actions record separately
preserves `@protobuf-ts/runtime`'s
`(Apache-2.0 AND BSD-3-Clause)` expression and the public-domain LZMA SDK
attribution. All 32 net-new Markdown-closure packages are routine-review MIT. The M1E-5B
addition is MIT, Apache-2.0 and BSD-2-Clause with exact package legal files;
none adds a NOTICE file or a source-reconciliation record. The eight M1I-2
packages are routine-review MIT; seven include exact package legal text and one
uses the recorded declared-SPDX/canonical-text route.

## Explicit exclusions and release gate

The Playwright npm package is admitted for configuration and test source only.
Chromium, FFmpeg, winldd, and Linux browser-system packages are absent and remain
owned by `M0-S-BROWSER-MAINT-001`. No browser may be downloaded or made a
mandatory gate before that review passes.

The runtime image is built from the immutable Node 24 Bookworm Slim digest in
`Dockerfile`; the final stage removes the unused npm/Corepack/Yarn toolchain and ships
only production server dependencies, built Web assets, the project MIT license,
third-party notices and the npm SBOM/license tree. PostgreSQL remains an
operator-owned external service and is not part of the application image.

The owner authorized the `v0.1.0` public source release and private single-user
runtime image on 2026-08-28. The release contains no sample or owner data. A
later artifact with additional server, browser, container, model, font or sample
materials requires its own reconciliation before distribution.
