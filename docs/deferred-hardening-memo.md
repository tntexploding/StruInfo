# Deferred Hardening Memo

- Status: Active non-blocking engineering backlog
- Effective date: 2026-08-16
- Scope: Hardening and verification improvements that do not currently threaten
  product correctness

## Purpose

This memo records useful engineering work that does not meet the
`PRODUCT_BLOCKER` criteria in `docs/development-standards.md`. An entry here does
not authorize hiding a product defect, and it does not certify the affected
tooling or future environment. It prevents non-material work from repeatedly
blocking delivery of the runnable knowledge workflow.

Each entry must identify its owner, evidence, current product impact, and an
objective revisit condition. Deferred entries do not block implementation,
integration, or the next product slice. Reopen one only when its revisit
condition is met or new evidence demonstrates reachable material product impact.

## Archived Entries

ADR 0009 retired the old Curation/Knowledge/Retrieval runtime and removed its
TM2 command from the active project. DH-001 through DH-003 remain only as a
record of why that unissued harness never blocked product work.

### DH-001: Cross-Realm Aggregate Errors in the PostgreSQL TM2 Harness

- Source: `M1B-PG-MAINT-R3-F001`
- Owner: Test tooling
- Status: Archived by ADR 0009
- Scope: PostgreSQL TM2 admission-error classification
- Evidence: A native `AggregateError` created in another JavaScript realm can
  bypass the harness's same-realm member inspection when it also carries an
  allowed top-level connection code.
- Current product impact: None. This path is confined to Test-owned TM2 harness
  error classification and does not change the PostgreSQL product adapter,
  domain commands, retrieval behavior, or stored data.
- Revisit when: The formal PostgreSQL TM2 verdict is required for a release, or
  the harness begins accepting errors across worker, VM, plugin, or other realm
  boundaries.

### DH-002: PostgreSQL TM2 Report Self-Test Binding

- Source: `M1B-PG-MAINT-R3-F002`
- Owner: Test tooling
- Status: Archived by ADR 0009
- Scope: Final PostgreSQL TM2 report certification
- Evidence: The report oracle validates all 488 mandatory rows but does not yet
  require the independent self-test suite and all suite counters to be present
  and mutually consistent.
- Current product impact: None. The gap can weaken confidence in a future formal
  TM2 PASS report, but it does not alter product behavior or the already passing
  production-scope review.
- Revisit when: A formal PostgreSQL TM2 PASS is needed for a release or deployment
  gate.

### DH-003: Refresh the Formal TM2 Catalog and Grant Oracle for M1C

- Source: M1C-PERSIST forward migration and repository delivery
- Owner: Test tooling and operations
- Status: Archived by ADR 0009
- Scope: Formal PostgreSQL certification only
- Evidence: The historical TM2 ledger freezes four migrations, 35 business
  tables, and a runtime grant map that deliberately forbids Evidence writes.
  M1C adds `000005_create_evidence_capture_command.sql` and a product-reachable
  Evidence import repository, so that old certification map is no longer the
  complete current schema/permission oracle.
- Current product impact: None for the local runnable core. PostgreSQL 18 has
  accepted all five migrations and the M1C two-workspace functional smoke passed
  with a disposable DML role. The stale formal oracle neither runs in the product
  nor changes stored data.
- Revisit when: Formal TM2, production least-privilege grants, database CI, or a
  distributable deployment becomes a required release gate.

## Active Entries

### DH-005: Windows Playwright Web-Server Process Cleanup

- Source: M1C-USE-1 local browser verification
- Owner: Test tooling
- Status: Closed for the supported single-process local workflow in M1G-3D
- Scope: Playwright-owned Vite process cleanup on the current Windows host
- Evidence: All nine configured browser scenarios completed and reported PASS,
  including the persisted review queue, reviewed-Fragment-to-searchable-knowledge
  handoff, privacy gate, and responsive bounds, but the
  Playwright parent did not exit after its Vite listener had stopped. A separate
  bounded browser run closed normally and confirmed the same queue layout and
  interaction without horizontal overflow.
- Current product impact: None. The browser workflow, build, unit/integration
  tests and application runtime are correct; only the local test command's
  post-run process cleanup required explicit termination.
- Revisit when: Browser E2E becomes a mandatory CI or release gate, or the same
  cleanup failure reproduces under the pinned Node runtime outside the current
  Codex/Windows process host.

### DH-006: Private-Document Encryption, Multi-User Authorization, and Declassification

- Source: M1C-PRIVATE visibility increment
- Owner: Product and platform
- Status: Deferred product hardening
- Scope: Deployment security, privacy retention, and explicit declassification
- Evidence: The current local product implements an explicit visibility scope,
  external full-document Blob backup, monotonic propagation, and default-hidden
  retrieval. It does not encrypt Blob bytes, introduce accounts or per-user
  authorization, securely erase retained copies, or provide a command that
  removes privacy from existing revisions.
- Current product impact: None for the single-user local workflow requested in
  M1C. The interface and documentation make no stronger security claim, and
  ordinary queries cannot disclose private content without an explicit current
  opt-in.
- Revisit when: The application leaves the trusted single-user host, a second
  principal is introduced, encrypted-at-rest storage becomes a product
  requirement, or the user asks to declassify or securely delete retained
  private material.

### DH-007: Serialize Legacy Entry Snapshot Reads Before pg 9

- Source: M1D-3 selected-workspace PostgreSQL 18 smoke
- Owner: Platform
- Status: Deferred hardening
- Scope: Existing M1D Entry and Document-tag repository snapshot loaders
- Evidence: `pg@8.22.0` emitted its deprecation warning when pre-existing Entry
  and Document-tag loaders submitted concurrent queries through one checked-out
  client. The new association repository already issues its snapshot queries
  sequentially, and the full M1D-3 rebuild and browser read completed correctly.
- Current product impact: None observed. PostgreSQL 18 returned the correct 34
  Entries and 7 association pairs, and no supported product operation failed or
  returned inconsistent data. This is a future driver-compatibility cleanup, not
  a current main-line blocker.
- Revisit when: The repository upgrades to pg 9, the warning becomes an error,
  or measured latency/inconsistency points to these loaders.

### DH-008: Node Engine Admission Was Too Strict

- Source: M1D-5 local delivery verification
- Owner: Test tooling and release operations
- Status: Closed by proportional Node engine policy on 2026-08-23
- Scope: Repository command admission only
- Evidence: The repository previously required exact Node 24.18.0, causing a
  compatible Node 24.19.0 host to be rejected before verification began. Package
  engines now recommend Node 24.18.0 or newer, while `.node-version` and CI keep
  24.18.0 as the minimum compatibility reference. pnpm engine admission is
  non-strict, so version guidance no longer blocks unrelated work.
- Current product impact: None. Actual typecheck, test, build, dependency and
  runtime incompatibilities remain visible failures.
- Revisit when: A demonstrated runtime incompatibility requires raising the
  recommended minimum; do not restore an exact command-entry engine gate.

### DH-009: Replace the Superseded M1C Browser Scenario

- Source: M1E-1 owner-flow simplification
- Owner: Frontend test tooling
- Status: Closed by ADR 0009 runtime retirement on 2026-08-23
- Scope: `tests/e2e/m1c-product-workspaces.spec.ts`
- Evidence: The 1,068-line historical Review, Knowledge-change and legacy Search
  scenario was replaced by a current browser smoke that visits Overview, Import,
  Split, Tags, Associations, Query and the Formal Knowledge placeholder. It also
  rejects any request to the retired Curation, Knowledge or Search routes.
- Current product impact: The browser gate now describes the shipped Entry main
  line and can no longer encourage restoration of deleted product screens.
- Revisit when: Current user interaction needs deeper browser coverage; extend
  the new Entry fixture rather than restoring M1C runtime mocks.

### DH-010: Owner and Formal Acceptance Reviews

- Source: Owner scheduling decision ENG-045
- Owner: Product owner, platform and release maintainers
- Status: Deferred, non-blocking
- Scope: Owner experience review, real Provider quality/cost review, formal
  PostgreSQL/container certification, deployment and release/distribution review
- Evidence: The active workspace is intentionally empty and all former material
  remains in an external recovery archive. Current implementation validation uses
  only synthetic, value-free fixtures.
- Current product impact: No reachable product defect has been demonstrated.
  Review results remain unissued; deferral is not a PASS and does not authorize
  restoring real material.
- Revisit when: The owner explicitly resumes a named review, authorizes a real
  material set, prepares a deployment/distribution candidate, or new evidence
  shows a reachable current-product blocker.

### DH-011: Random Fetch-Forbidden Ephemeral Port in Local HTTP Integration

- Source: M1F-1 complete verification on 2026-08-24
- Owner: Test tooling
- Status: Deferred, non-blocking
- Scope: `tests/integration/m1c-local-http.integration.test.ts` ephemeral listener
- Evidence: One complete verification assigned the local synthetic server a port
  rejected by Node Fetch as `bad port` before any HTTP request. The unchanged
  integration command immediately passed 4/4, followed by a complete clean
  verification with 93 unit files / 686 tests, 2 integration files / 4 tests,
  build and artifact verification.
- Current product impact: None. The application listener and request handling
  were not reached in the failing attempt; M1F-1 code and all supported product
  behavior passed on the subsequent complete run.
- Revisit when: The collision recurs often enough to destabilize CI or a product
  listener, rather than a test-assigned Fetch-forbidden port, becomes affected.

### DH-012: Serialize Independent External Preference Writers

- Source: M1G-2 source-subscription delivery audit
- Owner: Platform
- Status: Deferred hardening
- Scope: External review-preferences file updates
- Evidence: Preference saves use atomic temporary-file replacement, but an
  association-policy write, exploration-policy write and source-subscription
  cursor write each load and replace the complete preference record. Two
  independent writers that overlap after reading the same prior revision could
  preserve their own field while replacing a concurrently changed sibling
  field.
- Resolution: M1G-3D adds one per-workspace atomic read-modify-write boundary
  to the external preference store and moves all current API, policy and source-
  subscription cursor writers onto it. Optimistic revision checks now occur
  inside the same serialized operation, and synthetic overlap tests prove that
  sibling fields survive.
- Remaining boundary: The lock is owned by one runtime composition. Coordinating
  separate operating-system processes that intentionally share one external
  workspace remains deferred because the ordinary local product runs the
  combined `all` role and no cross-process lost update is currently reachable.
- Revisit when: Separate API and scheduler processes are admitted for one shared
  workspace, or a cross-process preference lost update is reproduced.

### DH-013: Base-Image Scanner Findings Outside the Current Runtime Path

- Classification: DEFERRED_HARDENING.
- Recorded: 2026-09-05, maintenance v0.2.0.
- Evidence: the pinned Trivy 0.74.0 scan reports 56 HIGH/CRITICAL package findings
  across 18 CVEs in the unchanged Debian 12 base; none has a Bookworm fixed
  version in the scan. Node package findings at that severity are zero. The
  scanner exits 1 and the scheduled image job must continue to report failure.
- Current boundary: the x64 runtime uses UID 10001, an empty effective capability
  set, no-new-privileges, read-only root and no privileged mount configuration.
  Active server source/build has no child-process call; Perl, gzip CLI, infocmp
  and privileged ACL/mount operations are not document-processing paths.
  systemd-homed and MiniZip executables are absent. Debian specifically records
  the zlib MiniZip source finding as not affecting its Bookworm binary packages.
- Disposition: no supported product trigger was found; keep the scan result and
  the [grouped assessment](dependencies/evidence/maintenance-security-2026-09-05.md#runtime-image-findings)
  visible. This is not a zero-vulnerability verdict or scanner suppression.
- Revisit when a Bookworm/base-image repair becomes available, a new reachable
  finding appears, or runtime architecture, privileges, executables or parsers
  change. Do not migrate the OS, delete base packages or add ignore rules merely
  to produce a green check.

## Entry Template

### DH-NNN: Short Title

- Source: Review or issue identifier
- Owner: Product, platform, test tooling, operations, or documentation
- Status: Deferred hardening
- Scope: Affected component or future boundary
- Evidence: Reproduction or observed limitation
- Current product impact: Why it does not meet `PRODUCT_BLOCKER` criteria
- Revisit when: Objective trigger that justifies scheduling the work

## Closed Entries

### DH-004: Serialize Same-Client PostgreSQL Snapshot Reads

- Source: M1C real-browser synthetic vertical smoke
- Owner: Platform
- Status: Closed in M1C-EXPAND
- Resolution: Evidence, Curation and Knowledge snapshot reads now await each
  query sequentially on their checked-out client while preserving the same
  transaction. A clean PostgreSQL 18 ten-issue import/export/restore rerun
  completed without the `pg@8.22.0` concurrent-query deprecation warning and
  retained exact table and search parity.
