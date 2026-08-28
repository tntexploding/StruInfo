# ADR 0016: Manual Entry Fragment Grouping

- Status: Accepted
- Date: 2026-08-24
- Decision owners: Project owner and maintainers
- Supersedes:
- Superseded by:

## Context and Constraints

The deterministic section materializer and the optional OpenAI split proposal
can both create Entry structure from immutable Snapshot evidence. They do not
provide the complete no-Provider owner workflow requested for M1E-4A: inspect a
document, combine overly small sections, restore a boundary, name the resulting
Entries and commit the chosen grouping.

Fragment remains the immutable evidence anchor. Manual grouping must not become
a second source editor, accept caller-authored body text, duplicate an existing
Entry structure, or require AI, a new database migration or real material in the
active data-free workspace.

## Decision

### One unmaterialized Snapshot

The manual workbench operates on one user-selected Snapshot only while that
Snapshot has no current Entry. It loads the first structure's exact `section`
Fragments in source order. A private Snapshot is loaded only when the current
action explicitly includes private material; that scope is not retained for a
later action.

The browser starts with one group per Fragment. It may merge a group into the
immediately preceding group, split a merged group again before any contained
Fragment, reset to the deterministic structure and edit each group title. It
shows the normalized full document and every exact Fragment locally. It cannot
reorder, omit, duplicate or edit evidence text.

### Closed manual grouping

The request contains only the Snapshot identity, current privacy opt-in, group
titles and ordered Fragment identities. The flattened Fragment list must equal
the complete ordered `section` Fragment list exactly once. Titles are trimmed,
NFC-normalized and bounded to 200 Unicode scalar values.

The server ignores any browser display text and reconstructs each Entry body
from the stored local Fragment text, joining adjacent Fragments with two line
feeds. It preserves the Snapshot privacy fact and records split-rule version
`struinfo.entry-split.manual-group.v1`. A manual Entry identity is derived from
the normalized title plus exact Fragment identities, so an exact replay is
stable and a materially different proposed structure cannot masquerade as the
same Entry.

### One atomic structure winner

Deterministic, manual and accepted AI materialization use the same repository
operation under the existing workspace lock. The operation creates a complete
Entry set only when the Snapshot is empty. If any path has already committed an
Entry structure, later attempts return `split_structure_already_materialized`
and do not add, replace or partially write Entries.

M1E-4A does not restructure an existing Entry set. This avoids silently losing
current tags, ratings, associations, graph relationships or stable query
identity. A later post-materialization restructuring feature must define an
explicit lineage and migration command before it can replace this rule.

### Product and storage boundary

The dedicated Split-page component owns manual grouping state and a monotonic
Snapshot-load generation so a late response cannot overwrite a newer selection.
Natural document scrolling, keyboard-operable buttons, explicit loading/error/
private/already-materialized states and exact local previews remain required.

The existing Entry, Entry revision and Fragment-input tables store the result.
There is no new migration, dependency, preference, Bundle section or personal
data in Git. Snapshot, Structure, Fragment and Blob evidence remains immutable.

## Alternatives Considered

### Allow arbitrary character selections in M1E-4A

Rejected for this increment. A character-level editor needs new exact-range,
provenance and lineage semantics. Existing Fragment boundaries already provide
a useful, reversible manual workflow without weakening source traceability.

### Rewrite or reorder Fragment text in the split request

Rejected. Full-text source editing and reordered evidence would create a second
content authority and require a new Snapshot or derived-evidence model.

### Replace an existing Entry structure in place

Rejected. Existing Entry identities may already own tags, ratings, associations
and graph relationships. Silent replacement would be a reachable data-loss bug.

### Save manual grouping drafts in PostgreSQL

Rejected. The first version is a local, explicit action whose only durable
result is the committed current Entry structure. No user need currently justifies
another draft table or Bundle version.

## Consequences

- The full Import → Split → Tags → Associations → Query path remains usable
  without an AI Provider.
- Users can correct over-fragmented structure at existing evidence boundaries
  before the first Entry commit.
- Deterministic, manual and AI paths cannot stack duplicate structures.
- Private documents remain available for local manual work only after explicit
  current-action opt-in.
- Arbitrary within-Fragment boundaries, source-text editing, reordering, custom
  parser/rule selection and post-materialization restructuring remain future
  narrow boundaries rather than hidden partial behavior.

## Validation

M1E-4A uses synthetic, value-free fixtures to prove:

- initial groups follow exact source order;
- merge and split operations preserve complete Fragment coverage;
- titles and exact Fragment identities form stable manual materialization rows;
- missing, duplicated or reordered Fragment inputs are rejected;
- private state propagates only within explicit local scope;
- deterministic, manual and AI materialization share the empty-Snapshot winner;
- the public local HTTP route binds the closed request unchanged;
- late Snapshot reads cannot replace the current workbench selection; and
- focused domain, API, client, UI and integration tests plus the complete quality
  command pass without new dependencies or repository-owned personal data.

Owner review with real material, arbitrary range editing, post-materialization
restructuring and production deployment certification remain deferred and
unissued. They do not block unrelated product work without a reachable product
defect.

## References

- [ADR 0006](0006-external-configuration-and-personal-data-isolation.md)
- [ADR 0007](0007-information-entry-first-document-processing.md)
- [ADR 0008](0008-current-entry-state-and-portable-personal-data.md)
- [ADR 0012](0012-provider-neutral-processing-runs-and-proposals.md)
- [ADR 0015](0015-openai-entry-split-proposals.md)
- [Document Entry Processing Guidelines](../document-entry-processing-guidelines.md)
- [Product requirements](../product-requirements.md)
- [Roadmap](../roadmap.md)
