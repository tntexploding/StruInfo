# ADR 0002: PostgreSQL Persistence and Durable Work

- Status: Accepted
- Date: 2026-08-08
- Decision owners: Project owner and maintainers
- Supersedes: ENG-003 in part
- Superseded by:

## Context and Constraints

StruInfo must preserve source snapshots, knowledge revisions, citations,
relationships, scheduled fetches, approval state, and external delivery state.
The same behavior must be testable on Windows and deployable on Linux.

Its first workloads are small, but correctness requires transactions,
constraints, recoverable jobs, idempotency, and auditable state transitions.
Chinese and semantic retrieval will evolve after real corpus measurements.
The project owner confirmed on 2026-08-02 that Windows development may use
Docker Desktop/WSL2 for production-parity infrastructure.

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
- Include workspace identity in every workspace-owned repository key, SQL
  predicate, uniqueness rule, cache key, history/event lookup, and idempotency
  scope. Authorization and resource selection use the same effective
  workspace identity.
- Implement idempotency as atomic insert-or-resolve in the business
  transaction. Equal payloads replay exactly; conflicting payloads return a
  stable conflict rather than an unhandled uniqueness failure.
- Claim work and external effects with checked compare-and-set transitions,
  owner/generation tokens, and lease expiry where required. Commit a durable
  attempt identity before the external side effect.
- Fence outcome writes by expected state and the exact claim/attempt token.
  Terminal states are monotonic; late or superseded results cannot regress or
  overwrite them.
- Store large source bodies and media in an immutable content-addressed Blob
  store.
- Establish Blob identity from an immediately owned defensive copy of the
  exact byte range. Length checks, hashes, parsing, and retained bytes all use
  that copy; Proxy or accessor-selected byte views are invalid inputs.
- Start with a local-filesystem Blob adapter and add an S3-compatible adapter
  without changing logical Blob or evidence IDs.
- Treat Blob bytes as immutable but garbage-collectable after workspace access
  is revoked, live references are gone, and documented retention expires.
- Keep state, export, and evidence-package writer/reader budgets closed and
  versioned. Measure the complete encoded artifact before atomic persistence;
  a successful current writer must produce bytes accepted by its current
  public reader. Large bytes remain Blob references rather than recursively
  nested base64 envelopes.
- Bind Fragment locators and trusted evidence roots to workspace, Resource,
  Snapshot, Blob, and revision context. Citations target an immutable
  KnowledgeRevision and are revalidated after semantic edits.
- Derive each WebSocket replay cutoff, snapshot, and bounded replay set from
  one repeatable-read view or an equivalently proven mechanism. Use a single
  serialized live-tail reader per subscription; compare sequence plus stable
  event identity and recover gaps or contradictions through HTTP.
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
Opaque IDs and prior path-membership checks are not authorization boundaries;
every secondary-ID lookup repeats the effective workspace predicate.
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

## Acceptance Evidence and Remaining Gates

Accepted on 2026-08-08 because:

1. M0-P exercised the selected PostgreSQL/Node/Drizzle/pg-boss direction,
   same-transaction durable work, migration/runtime role separation, recovery,
   and backup/restore on Windows and Linux at non-distributed probe scope.
2. P2 showed that revision-level evidence location is feasible and identified
   the closed-budget and deterministic-byte/container invariants now made
   normative above.
3. P3 showed that HTTP recovery, WebSocket projection, and durable side effects
   fit the transaction model, while identifying the workspace, idempotency,
   fencing, and consistent-read invariants now made normative above.
4. The final architecture review found no material persistence or recovery
   contradiction and prohibited direct reuse of the probe candidates.

Acceptance authorizes M0-S foundation work, not a production storage claim.
M0-S must pin and reverify exact Node, PostgreSQL, Drizzle, pg-boss, pgvector,
and container artifacts; create the migration/runtime roles; and add focused
real-PostgreSQL tests for workspace isolation, concurrent idempotency, claims,
late outcomes, outbox monotonicity, and WebSocket recovery.

The P1 backup result proves offline probe feasibility only.
Before production deployment, verify consistent PostgreSQL-plus-Blob backup,
hash and citation restoration, encryption, retention/garbage-collection
windows, migration interruption, and declared RPO/RTO.

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
