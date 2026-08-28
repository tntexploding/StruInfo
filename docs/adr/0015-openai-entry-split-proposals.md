# ADR 0015: OpenAI Entry Split Proposals

- Status: Accepted
- Date: 2026-08-24
- Decision owners: Project owner and maintainers
- Supersedes:
- Superseded by:

## Context and Constraints

The deterministic CommonMark section rule is the complete non-AI path from an
immutable public Snapshot to InformationEntry records. Some documents benefit
from combining adjacent sections into a smaller number of useful Entries, but
the model must not rewrite evidence, scan the workspace, send private material,
or obtain an Entry repository.

M1E-3B and M1E-3C already select one optional OpenAI Responses API boundary and
establish durable, typed proposals with explicit owner acceptance. M1E-3D should
reuse that boundary for one user-selected Snapshot and leave the deterministic
split action immediately available.

All owner and formal reviews remain deferred. Development verification uses
only synthetic, value-free fixtures; the active workspace remains empty.

## Decision

### One explicit public Snapshot

The Split page may start a proposal only after the user selects one public
Snapshot that has no current Entry. Private Snapshots are rejected before Blob
read or network access. There is no background document scan, batch Provider
submission, privacy opt-in escape hatch or automatic proposal start.

The service locally verifies the immutable text Blob and Fragment locators,
selects the first structure's ordered `section` Fragments, and sends only
`{ordinal, text}` records to OpenAI. Snapshot, Resource, Fragment and workspace
identifiers, other documents, preferences, database details and Blob identities
are not sent. Requests use native `fetch`, `store: false`, no tools, one attempt,
the existing configured model/output bound and the existing bounded deadline.

### Closed grouping result

The Provider may only group 1–64 existing sections into contiguous ranges that
cover every ordinal exactly once in source order. It returns a short summary and
one title for each group. It cannot edit, omit, duplicate or reorder source
text. Invalid gaps, overlaps, ranges, unknown fields or incomplete coverage fail
the run without changing Entry state.

Forward migration `000016` adds three normalized payload tables beneath the
provider-neutral proposal envelope:

- `processing_split_proposal` stores model, Prompt version and split-rule
  version;
- `processing_split_proposal_entry` stores ordered proposed Entry titles; and
- `processing_split_proposal_entry_fragment` stores each group's ordered exact
  Fragment identities.

No arbitrary JSON, Prompt body, raw Provider response, API key or raw error is
persisted.

### Manual application through existing Entry materialization

Starting, listing or rejecting a proposal never creates or changes an Entry.
The Split page shows the exact local Fragment text beneath every proposed group,
marks the result as `AI 生成 · 待人工确认`, and requires an explicit accept
action.

Acceptance reconstructs every Entry body locally from the stored ordered
Fragment identities and joins adjacent source sections without model-authored
text. It derives stable Entry identities and uses the existing Entry tables.
The PostgreSQL repository takes the existing workspace write lock and creates
the complete proposed set only when the Snapshot has no different Entry set.
A deterministic or competing split that wins first produces a stable stale
result instead of a second structure. Exact committed rows are replayable so an
interrupted proposal-decision write can be completed without duplicate Entries.

Snapshot, Structure, Fragment and Blob evidence remains immutable.

### Capability, UI and portability

The workspace publishes `ai_split` only when the external OpenAI configuration
is complete. It remains separate from `ai_tags` and `ai_associations`; none of
them imply generic AI automation. Without it, the Split page plainly states that
the deterministic local rule remains available.

Processing Bundle v4 carries all ten Processing tables. Legacy v1, v2 and v3
sections restore missing split proposal state as empty. The complete personal-
data package now carries 55 current workspace tables, referenced Blob bytes and
external preferences. Credentials and runtime configuration remain excluded.

## Alternatives Considered

### Let the model return rewritten Entry bodies

Rejected. It would break exact source reconstruction and create a second content
authority beside immutable evidence.

### Send an entire private document after a view opt-in

Rejected. The current privacy opt-in governs local visibility, not disclosure to
an external Provider.

### Automatically accept a valid grouping

Rejected. M1E-3D is a proposal boundary; the user retains the split decision.

### Replace the deterministic splitter

Rejected. AI configuration, availability, cost or output quality must never be
a prerequisite for Import → Split → Tags → Associations → Query.

## Consequences

- A selected public document can receive a durable, inspectable AI grouping.
- Model output changes only grouping and proposed titles; Entry bodies retain
  exact Fragment text and provenance.
- Three workspace tables and one migration are added; Processing Bundle advances
  to v4.
- Private transfer, automatic acceptance, a second Provider, AI query synthesis,
  Embedding and RAG remain outside this increment.

## Validation

M1E-3D proves with synthetic fixtures that:

- only ordered public section text enters the Provider request;
- private Snapshots stop before Blob read and fetch;
- the response must be a closed, contiguous, complete grouping;
- listing, starting, accepting and rejecting use public product routes;
- reject creates no Entry and accept reconstructs exact Fragment text;
- a competing deterministic materialization cannot be overwritten;
- Processing Bundle v4 round-trips ten tables and upgrades v1–v3 with empty
  split state; and
- the UI distinguishes AI origin, disclosure, review state and the complete
  local fallback.

Real Provider quality/cost, owner review, PostgreSQL/container certification and
release review remain deferred and unissued. They do not block later unrelated
product work without a reachable product defect.

## References

- [ADR 0006](0006-external-configuration-and-personal-data-isolation.md)
- [ADR 0007](0007-information-entry-first-document-processing.md)
- [ADR 0012](0012-provider-neutral-processing-runs-and-proposals.md)
- [ADR 0013](0013-openai-entry-tag-proposals.md)
- [ADR 0014](0014-openai-entry-association-proposals.md)
- [Product requirements](../product-requirements.md)
- [Roadmap](../roadmap.md)
