# StruInfo Decision Log

This log indexes product and engineering decisions while the project is small.
High-impact implementation choices use an ADR under `docs/adr/` and are linked
from this file.

## Status Values

- Proposed: Under active review.
- Accepted: Current direction.
- Deferred: Deliberately postponed until a named decision gate.
- Superseded: Replaced by a later entry or ADR.
- Rejected: Considered and not selected.

## Decisions

| ID | Date | Status | Decision | Rationale or review gate |
| --- | --- | --- | --- | --- |
| PD-001 | 2026-08-01 | Superseded | Long-term vision is an AI-native, source-traceable personal information hub | Superseded by PD-010: AI remains important but is not the knowledge core's correctness or availability dependency |
| PD-002 | 2026-08-02 | Superseded | First value probe uses one known source, a cited AI digest, approval, and source-backed retrieval | Replaced by PD-003 through PD-007 after the owner re-centered the product on knowledge ingestion and maintenance |
| PD-003 | 2026-08-10 | Superseded | The product core is source-backed AI knowledge ingestion, decomposition, comparison, linking, maintenance, and retrieval; reports and external channels follow the core | Superseded by PD-010, which retains the knowledge-first scope but removes AI as a required core path |
| PD-004 | 2026-08-10 | Accepted | The first source is the `ruanyf/weekly` GitHub repository, with at least ten fixed issues and independent section items as the primary manual decision unit | Regular Markdown structure supplies heterogeneous text, links, and images without making a second connector an MVP dependency |
| PD-005 | 2026-08-10 | Accepted | Information value, current interest, exploration value, noise, and factual reliability are assessed separately; `PreferenceProfile` cannot automatically overwrite `ExplorationPolicy` | Learn the owner's preferences while deliberately resisting filter bubbles and preserving explainable diversity |
| PD-006 | 2026-08-10 | Accepted | AI authority grows through versioned policy: admitted content may produce automatic low-risk additions and non-destructive revisions, while merge, deletion, major conflict resolution, large restructuring, and permission expansion remain human-controlled by default | Preserve manual supremacy, audit, pause, compensation, and reprocessing without requiring approval of every extracted atom forever |
| PD-007 | 2026-08-10 | Accepted | The first product UI validates intake, review, knowledge browsing, evidence-backed search, and manual takeover; digests, QQbot, public integrations, and cloud deployment are later slices | Validate the correct knowledge logic before multiplying delivery surfaces |
| PD-008 | 2026-08-10 | Accepted | The first fixed corpus is `ruanyf/weekly` issues 398–407 at commit `cf5e367d98e5141fb3381816f2ac8c5dd1bdb69f`; raw Markdown remains local and ignored while redistribution rights are unresolved | Ten consecutive current issues cover long-form, numbered items, links, images, promotions, fiction, opinion, and cross-domain material with reproducible source identity; [Stage 0 freeze](stage-0-corpus-freeze.md) |
| PD-009 | 2026-08-10 | Accepted | Preference calibration is supporting data, not a prerequisite for the canonical knowledge database; content classification, intake action, knowledge kind, epistemic role, review state, and operation origin are independent | Manual corpus review exposed a type/action conflation; the actual user annotation stays outside Git while the durable modeling rule re-centers the next slice |
| PD-010 | 2026-08-10 | Accepted | The product core is source-backed, versioned knowledge decomposition, linking, recomposition, maintenance, and deterministic retrieval that remains fully usable without AI; AI augments the same command and search boundaries | Owner clarification; preserves user control, offline/provider-independent access, and a database model that is not defined by model behavior |
| ENG-001 | 2026-08-02 | Accepted | Use the relevant Google style guide with narrow recorded project deviations | User requirement; consistent code is easier to review and maintain |
| ENG-002 | 2026-08-02 | Accepted | Reuse reliable third-party work only with provenance and license review | Preserve maintainability and distribution options |
| ENG-003 | 2026-08-08 | Superseded | Defer the broad runtime, framework, storage, and deployment choice | Runtime and storage are resolved by ENG-004/005; AI and cloud vendors remain deferred to feature/deployment ADRs |
| ENG-004 | 2026-08-08 | Accepted | Use a TypeScript modular monolith with API, scheduler, and worker roles | M0-P platform/protocol evidence and zero-blocker final review; [ADR 0001](adr/0001-typescript-modular-monolith.md) |
| ENG-005 | 2026-08-08 | Accepted | Use PostgreSQL for business truth and durable work, plus immutable Blob storage | M0-P persistence/provenance evidence and zero-blocker final review; [ADR 0002](adr/0002-postgresql-persistence-and-durable-work.md) |
| ENG-006 | 2026-08-02 | Accepted | Windows development may use Docker Desktop/WSL2 for production-parity infrastructure | Owner confirmation |
| ENG-007 | 2026-08-08 | Accepted | Treat M0-P candidates as disposable architecture evidence and implement the accepted P2/P3 data, workspace, idempotency, fencing, and recovery invariants afresh | `M0-P1-BE-001-R4`, `M0-P2-MAINT-001-R2`, `M0-P3-CANDIDATE-MAINT-001`, `M0-LIC-MAINT-001-R3`, and `M0-P-REVIEW-001` |
| ENG-008 | 2026-08-10 | Accepted | Use the exact M0-S workspace, toolchain, dependency policy, CI, quality gates, operational-health shell, and first-party migration boundary as the engineering foundation | Fixed-candidate Windows/Linux Test R1, zero-finding Maintenance closure, and [ADR 0003](adr/0003-m0-s-engineering-foundation.md) |
| ENG-009 | 2026-08-10 | Accepted | Use a separate curation boundary and allow formal knowledge writes only through action-scoped user commands or enabled versioned policy | Owner-approved product authority model; [ADR 0004](adr/0004-adaptive-knowledge-ingestion-and-policy-authorized-writes.md) |
| ENG-010 | 2026-08-10 | Accepted | Use a source-backed, versioned relational knowledge graph with immutable item and relation revisions; manual, deterministic, import, and AI origins share one command/change-set boundary; fuzzy and associative retrieval remains deterministic and AI-independent | Owner confirmation; keeps canonical knowledge independent of vectors and models while preserving provenance, typed relations, recomposition, history, and usable retrieval without AI; [ADR 0005](adr/0005-versioned-knowledge-core-and-ai-optional-operations.md) |
| ENG-011 | 2026-08-10 | Accepted | Load active runtime configuration externally and keep all personal knowledge, vocabulary, preferences, policies, snapshots, exports, and backups outside Git, source/install trees, and packages | Explicit owner requirement; [ADR 0006](adr/0006-external-configuration-and-personal-data-isolation.md) |
| ENG-012 | 2026-08-11 | Accepted | Use `C-SLICE-A-EVIDENCE-r2` as the first source-evidence migration and closed pure application boundary; source keys are portable adapter identities rather than machine paths | Fixed candidate `c50ad35e07b2f1b64cd938b0417d4b6bd7c231aa` passed all 27 TM1 module/static rows; real PostgreSQL, runtime grants, transactions, concurrency, browser, and container execution remain behind their named admission gates |
| SEC-001 | 2026-08-02 | Accepted | Private knowledge is denied to external AI by default; enable per workspace and retain local/self-hosted adapters | Owner confirmation; threat model still required before transfer |
| LEGAL-001 | 2026-08-02 | Deferred | Project distribution license | Decide before any public or distributable release |
| LEGAL-002 | 2026-08-10 | Deferred | Full-text, image-retention, and redistribution rights for the first source and its linked material require an explicit record before public deployment or redistribution | Public readability or an informal “open” description is not a substitute for a recorded content license and retention policy |

## Adding a Decision

Add context, the decision, reasons, consequences, owner, evidence, and the event
that should trigger review. Use an ADR when a decision changes architecture,
data compatibility, security boundaries, operations, or long-term dependencies.
