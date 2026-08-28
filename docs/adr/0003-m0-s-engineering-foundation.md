# ADR 0003: M0-S Engineering Foundation

- Status: Accepted
- Date: 2026-08-09
- Accepted: 2026-08-10
- Decision owners: Project owner and maintainers
- Supersedes:
- Superseded by:

## Context and Constraints

ADR 0001 and ADR 0002 accept the TypeScript modular monolith, PostgreSQL 18,
Drizzle ORM runtime mapping, pg-boss durable work, and separate API, Scheduler,
and Worker roles. M0-S must turn those decisions into one reproducible workspace
without reusing M0-P candidate source or claiming production readiness.

The exact package, lifecycle, browser, container, and GitHub Actions review found
an admissible npm graph after four bounded corrections: use pnpm 11 `allowBuilds`,
remove `drizzle-kit`, admit only the Playwright npm package, and defer all
container artifacts. Contract `C-M0-S-r2` accepts those corrections.

The first shared writer must establish configuration and governance while
Backend, Frontend, and Test owners still own all application and test behavior.
Empty or skipped checks cannot be reported as successful.

## Decision

Use one pnpm workspace with the following toolchain baseline:

- Node.js `>=24.18.0`, with `24.18.0` retained as the reference minimum in
  `.node-version` and CI;
- pnpm `11.20.0` through the root `packageManager` field and Corepack; and
- TypeScript `6.0.3`, ES2023, ESM, and NodeNext module/resolution semantics.

The Node engine range is advisory at command entry. pnpm reports an engine
warning when a local runtime is below the reference minimum, but it does not
reject repository commands solely because the Node version differs. Actual
build, test, dependency, or runtime incompatibilities remain ordinary visible
failures. This proportional policy was accepted by the project owner on
2026-08-23 so patch/minor Node upgrades and temporarily older local runtimes do
not stall unrelated product work.

Use four private first-party workspaces:

```text
apps/server
apps/web
packages/contracts
packages/test_support
```

Each application workspace declares the exact runtime and development packages
it consumes. Root-only configuration owns shared lint, format, typecheck, test,
build, and E2E tooling. No application may rely on an undeclared root runtime
package. The unique direct set is exactly the admitted 10 runtime and 18
development identities documented in `docs/dependencies/README.md`.

Use one root `pnpm-lock.yaml`. Its SHA-256 is
`A783E1C5B2DADD8B653D8E16446847530473D5569BB08830D7FC03D79400880B`.
Importer redistribution changes the lock's whole-file identity, but its complete
`packages` and `snapshots` sections are byte-identical to the admitted candidate,
so resolved versions, integrities, peer contexts, and platform selections do not
drift.

Put pnpm 11 policy in `pnpm-workspace.yaml`: disable automatic peers, require
strict peer compatibility, report Node engine compatibility without turning it
into a command-entry blocker, require exact saves, store integrity and lockfile
revalidation, enforce a 1,440-minute release age with strict missing-time
handling, block exotic subdependencies, and require explicit build decisions.
Lifecycle execution is default-deny; exact `esbuild@0.28.1` is explicitly denied
and no package is allowed. Do not use removed `onlyBuiltDependencies`.

Use strict TypeScript without `skipLibCheck`, Prettier `3.9.6` at width 80, and a
flat type-aware ESLint configuration. Packages cannot import applications;
server and web cannot import each other's internals; first-party application
modules use named exports. Tool-required configuration files may use default
exports.

Expose real root commands for formatting, format checking, linting, typechecking,
unit tests, synthetic integration tests, Playwright E2E, build, verification, and
database migration. The non-browser/non-container `verify` order is:

```text
format:check -> lint -> typecheck -> test -> test:integration -> build
```

The commands do not enable empty-test success. `test:e2e` is real but remains
outside `verify` until browser admission. `db:migrate` targets the first-party
migration entrypoint and cannot fall back to the runtime credential.

Use GitHub Actions for a Windows/Ubuntu quality matrix. Pin only:

```yaml
actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
```

CI uses exact Node, Corepack, the frozen lock, and `--ignore-scripts`. It has no
browser, database, Compose, or container job.

Make the unversioned `/health/live` and `/health/ready` bodies durable as an
OpenAPI 3.1 contract under `packages/contracts`. They contain only the frozen
schema version, service, role, status, and database check fields, require JSON
and no-store responses, and add no `/api/v1` product route.

Use a first-party ordered SQL migration runner over admitted `pg@8.22.0` rather
than `drizzle-kit`. Require a separate migration credential, immutable checksummed
forward files, an advisory lock, and atomic migration/ledger transactions. The
ordinary runtime roles never perform DDL. The implemented runner validates all
committed migration files before connection, reconciles a project-owned ledger,
and starts with one migration that creates only the `struinfo` schema.

Track the actual npm and action SPDX inventories, exact legal material, source
reconciliation, and third-party notice in the repository. The project remains
`UNLICENSED`; this is an inventory decision, not a release authorization.

This paragraph records the original M0-S state. The owner selected MIT on
2026-08-27; the repository-root `LICENSE` is now authoritative.

Defer these independent gates:

- `M0-S-BROWSER-MAINT-001` before Chromium, FFmpeg, winldd, Linux browser-system
  packages, mandatory E2E, or browser CI; and
- `M0-S-CONTAINER-MAINT-001` before Compose, Dockerfile, PostgreSQL/pgvector
  container execution, or database-container CI.

## Alternatives Considered

### Keep all dependencies in the root importer

This preserves a simple lock importer but hides which application owns a
package. It is rejected. Shared tooling remains at root; server and web declare
their exact own packages even when a development identity is repeated.

### Use `drizzle-kit@0.31.10`

The exact release has contradictory license provenance and selects a vulnerable
development path. It is rejected from this foundation. A small first-party runner
over the already admitted PostgreSQL driver keeps the credential and migration
sequence explicit without adding a package.

### Allow `esbuild` postinstall

The lock already selects exact platform packages, and the foundation does not
need lifecycle execution. Default deny plus an explicit exact rejection is
smaller and auditable.

### Install browsers and add database containers now

Both artifact families lack the accepted distribution closure required by the
open-source policy. They are staged behind named gates instead of represented as
skipped or passed.

## Consequences

Positive consequences:

- one exact graph and one lock serve Windows and Linux quality work;
- ownership, module boundaries, lifecycle decisions, and CI action identities
  are visible in tracked configuration;
- format and lint configuration can be validated before feature source lands;
- later source owners receive honest failing type, test, and build gates rather
  than placeholders; and
- browser and container distribution risk stays separate from npm admission.

Negative consequences:

- producing a green foundation required coordinated Backend, Frontend,
  Contract, Test, and Maintenance ownership rather than one placeholder commit;
- E2E and real PostgreSQL integration remain unavailable until their artifact
  gates close;
- the first-party migration runner becomes maintained project code; and
- some exact development packages appear in multiple importers to avoid hidden
  root leakage while preserving one resolved closure.

## Security, Privacy, and Licensing

The foundation contains no credentials, private knowledge, fetched snapshots,
real AI output, or external fixture data. CI permissions are read-only and no
network service is started by the verification configuration.

Dependency lifecycle scripts execute zero times. Browser and container contents
are explicitly excluded. The tracked NOTICE, 399 legal files, npm SPDX, actions
SPDX, conditional-license records, and separate LZMA SDK attribution satisfy the
foundation inventory requirement but do not authorize a public release. The
project owner must select the StruInfo distribution license before release.

## Migration and Rollback

Before source owners depend on the foundation, rollback is a normal revert of the
single foundation commit. After integration, dependency or command changes use a
reviewed dependency/contract change request and regenerate the lock, SBOM, and
notice together.

Do not edit applied SQL migrations during rollback. Database schema reversal uses
a reviewed forward compensation or a consistent PostgreSQL-plus-Blob restore as
described in `docs/database-migrations-and-roles.md`.

## Acceptance Evidence and Remaining Gates

Accepted on 2026-08-10 because:

1. The exact Node, Corepack, pnpm, package, lock, lifecycle, action, NOTICE, and
   SPDX/SBOM identities passed the bounded admission and correction reviews.
2. Fresh Backend, Frontend, Contract, and Test implementations established the
   application roles, operational-health contract, trustworthy UI shell, strict
   fixtures, and non-empty quality gates without reusing M0-P candidate source.
3. The first-party migration runner closed the independent credential,
   exact-byte checksum, advisory-lock, ledger, transaction, retry, cleanup, and
   ordinary-runtime no-DDL contract using only admitted `pg@8.22.0`.
4. Formal Windows and WSL Ubuntu testing on fixed candidate
   `6bc881659e0a6df52ca42c8960f27c986524bcde` passed formatting, linting, strict
   typechecking, 160 unit tests, 2 synthetic integration tests, builds, 53
   focused migration tests, source/built fail-closed smokes, and 15-test static
   Playwright discovery with clean tracked state on both platforms.
5. The final focused Maintenance review closed the sole material finding and
   found no new material regression or dependency, contract, permission,
   provenance, or governance drift.

This acceptance establishes the non-browser, non-container engineering
foundation; it is not production readiness. Runtime browser E2E and browser CI
remain behind `M0-S-BROWSER-MAINT-001`. Real PostgreSQL 18/pgvector execution,
grants, advisory-lock concurrency, interruption recovery, Compose, Dockerfiles,
and database CI remain behind `M0-S-CONTAINER-MAINT-001`. The project
distribution license, real product scenario, AI provider, cloud vendor,
production backup, and deployment decisions also remain open.

## References

- [ADR 0001](0001-typescript-modular-monolith.md)
- [ADR 0002](0002-postgresql-persistence-and-durable-work.md)
- [Development outline](../development-outline.md)
- [Dependency governance](../dependencies/README.md)
- [Database migrations and roles](../database-migrations-and-roles.md)
- [Open-source policy](../open-source-policy.md)
