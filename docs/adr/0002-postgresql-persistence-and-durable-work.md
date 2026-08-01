# ADR 0002: PostgreSQL Persistence and Durable Work

- Status: Proposed
- Date: 2026-08-02
- Decision owners: Project owner and maintainers
- Supersedes: ENG-003 in part when accepted
- Superseded by:

## Context and Constraints

StruInfo must preserve source snapshots, knowledge revisions, citations,
relationships, scheduled fetches, approval state, and external delivery state.
The same behavior must be testable on Windows and deployable on Linux.

Its first workloads are small, but correctness requires transactions,
constraints, recoverable jobs, idempotency, and auditable state transitions.
Chinese and semantic retrieval will evolve after real corpus measurements.

## Decision

Use PostgreSQL 18 as the single relational source of truth in development and
production.

- Use Drizzle ORM as a thin typed SQL and forward-migration layer, subject to a
  successful version-specific spike.
- Permit reviewed parameterized SQL for recursive, queue, search, and other
  PostgreSQL-specific operations.
- Use pg-boss for PostgreSQL-backed scheduling and background job delivery.
- Prepare and upgrade application, extension, and pg-boss schemas with a
  separate migration role before ordinary processes start.
- Keep public operation state separate from pg-boss internal job identity.
- Use a transactional outbox for reliable external events.
- Register internal jobs and external outbox events through a Unit of Work port;
  business modules do not write infrastructure tables directly.
- Do not copy one external event through both pg-boss and the outbox.
- Make every retryable job and external write idempotent; do not claim
  end-to-end exactly-once side effects.
- Store large source bodies and media in an immutable content-addressed Blob
  store.
- Start with a local-filesystem Blob adapter and add an S3-compatible adapter
  without changing logical Blob or evidence IDs.
- Treat Blob bytes as immutable but garbage-collectable after workspace access
  is revoked, live references are gone, and documented retention expires.
- Use relational adjacency tables for knowledge relations and tree placements.
- Enable pgvector only when embedding search enters a validated slice.
- Do not add Redis, a graph database, a vector database, or a separate search
  service in the first version.

The Windows default is PostgreSQL 18 plus pgvector in Docker Desktop/WSL2.
A native PostgreSQL installation is the fallback if containers are unavailable.
SQLite is not used as a production-behavior substitute.

## Alternatives Considered

### SQLite for Development and PostgreSQL for Production

SQLite reduces local setup but introduces two SQL dialects, different
concurrency behavior, and a data migration path before deployment.
It is rejected because Windows is a test environment, not a separate product
with an offline database requirement.

### Redis or Valkey with BullMQ

BullMQ is a mature Node.js queue, but it requires another stateful service.
Current Redis versions also require explicit restricted-license review under
the project policy; Valkey reduces that concern but still adds infrastructure
and a compatibility surface.

The first workload does not justify that cost.
Revisit when measured queue throughput, rate limiting, or independent queue
operations exceed PostgreSQL-backed work.

### Custom PostgreSQL Job Table

A custom leased job table can meet the requirements and avoids a library.
It is not preferred because retries, scheduling, dead letters, cleanup, and
concurrency are deceptively broad responsibilities.
The application still owns its public operation and idempotency semantics.

### Graph, Vector, or Search Databases

Specialized databases may outperform PostgreSQL for a proven workload.
They are deferred until corpus tests show that PostgreSQL relations,
`pg_trgm`, and pgvector cannot meet an explicit quality or latency target.

## Consequences

Positive consequences:

- Windows tests exercise the same constraints and concurrency as Linux;
- knowledge changes, job creation, and outbox writes can share transactions;
- one database backup contains relational truth and durable work state;
- no additional broker is required for the first deployment;
- vector retrieval can evolve without moving canonical knowledge.

Negative consequences:

- local development requires PostgreSQL and the pgvector extension;
- queue traffic shares capacity and operational fate with business data;
- filesystem Blob storage limits horizontal API scaling until an object-store
  adapter is deployed;
- PostgreSQL's default text search is not assumed to solve Chinese retrieval;
- pg-boss and Drizzle remain dependencies that require compatibility tests.

## Security, Privacy, and Licensing

Blob paths are derived internally and never accepted directly from untrusted
input.
Blob reads are authorized through workspace-scoped logical IDs.
Database roles use least privilege, migrations do not run under the ordinary
application role in production, and backups are encrypted and access-controlled.

PostgreSQL and pgvector use the PostgreSQL License, Drizzle is Apache-2.0, and
pg-boss is MIT at the time of this proposal.
The exact selected artifacts, containers, transitive dependencies, notices,
and checksums still require the repository admission process before use.

## Migration and Rollback

All schema changes use reviewed forward migrations and a documented restore or
compensating plan.
Blob metadata remains in PostgreSQL while bytes can migrate between adapters by
content hash and integrity verification.

If pg-boss is replaced, public `Operation` IDs and application idempotency keys
remain stable while pending work is drained or explicitly re-enqueued.
If pgvector is removed, embeddings can be rebuilt from recorded model and input
versions because they are derived data.

## Validation

Before changing the status to `Accepted`:

1. Pass P1, P2, and P3 defined in the development outline.
2. Verify Drizzle and pg-boss against the exact pinned PostgreSQL and Node
   versions.
3. Prove that a migration role can prepare and upgrade the pg-boss schema and
   that the ordinary runtime role can start and work without DDL permission.
4. Back up and restore PostgreSQL plus Blob bytes, then verify every stored hash
   and citation target.
5. Document logical deletion, physical garbage collection, and backup expiry
   for Blob data before accepting a retention promise.

## References

- [Development outline](../development-outline.md)
- [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/)
- [PostgreSQL license](https://www.postgresql.org/about/licence/)
- [PostgreSQL pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html)
- [pgvector](https://github.com/pgvector/pgvector)
- [Drizzle PostgreSQL extensions](https://orm.drizzle.team/docs/extensions)
- [pg-boss](https://github.com/timgit/pg-boss)
- [Redis licensing](https://redis.io/legal/licenses/)
- [Valkey migration and compatibility](https://valkey.io/topics/migration/)
