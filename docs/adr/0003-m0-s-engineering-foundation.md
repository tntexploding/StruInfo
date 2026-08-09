# ADR 0003: M0-S Engineering Foundation

- Status: Proposed
- Date: 2026-08-09
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

Use one pnpm workspace with the following exact toolchain:

- Node.js `24.18.0`;
- pnpm `11.20.0` through the root `packageManager` field and Corepack; and
- TypeScript `6.0.3`, ES2023, ESM, and NodeNext module/resolution semantics.

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
strict peer and engine compatibility, exact saves, store integrity and lockfile
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
outside `verify` until browser admission. `db:migrate` targets the future
first-party migration entrypoint and cannot fall back to the runtime credential.

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
ordinary runtime roles never perform DDL. Implementation and SQL remain Backend
work after this foundation is integrated.

Track the actual npm and action SPDX inventories, exact legal material, source
reconciliation, and third-party notice in the repository. The project remains
`UNLICENSED`; this is an inventory decision, not a release authorization.

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

- the initial foundation commit cannot produce a green `verify` result until
  Backend, Frontend, Contract, and Test owners add real source and tests;
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

## Validation

The fixed Windows environment generated the lock and performed a frozen install
with reviewed pnpm `11.20.0`, `--ignore-scripts`, and browser download disabled.
The resolved lock sections equal the admitted candidate, and a current audit
reported zero vulnerabilities. JSON/SPDX/reference checks and configuration
format/lint checks pass.

Typecheck and build stop at `TS18003` because the owned source trees are
intentionally absent. Unit, integration, and E2E discovery stop with no tests
found. Those are pending owner prerequisites, not foundation passes and not
configuration defects. This Proposed ADR does not mark M0-S accepted.

## References

- [ADR 0001](0001-typescript-modular-monolith.md)
- [ADR 0002](0002-postgresql-persistence-and-durable-work.md)
- [Development outline](../development-outline.md)
- [Dependency governance](../dependencies/README.md)
- [Database migrations and roles](../database-migrations-and-roles.md)
- [Open-source policy](../open-source-policy.md)
