# ADR 0012: Provider-Neutral Processing Runs and Proposals

- Status: Accepted
- Date: 2026-08-24
- Decision owners: Project owner and maintainers
- Supersedes:
- Superseded by:

## Context and Constraints

The Entry-first product already completes Import, Split, Tags, Associations and
Query without AI. The Overview page has an honest AI rail, but there is no
durable task or proposal boundary behind it. Adding a model provider first would
couple provider selection, job control, proposal semantics and user authority in
one change, and would tempt the UI to report progress that the product cannot
actually observe.

The owner has explicitly accepted M1E-3 and asked for the smallest real
task/proposal foundation before any provider is selected. The foundation must
remain useful with no provider, preserve the existing five-stage commands, keep
personal data outside Git and the installation tree, and avoid reviving the
retired M1C Knowledge runtime.

## Decision

### Durable provider-neutral runs

M1E-3A adds a workspace-scoped `ProcessingRun` current record. A run records:

- a stable identity and idempotency key;
- origin (`deterministic` or `ai`) and an optional provider key;
- one of the five product stages and a short current step;
- queued, running, succeeded, failed or cancelled state;
- bounded completed/total units, attempt and concurrency version;
- an optional Snapshot target and one of the existing privacy scopes; and
- a stable error code, never source text, prompt text, credentials or a raw
  provider error.

State transitions are closed and terminal states cannot be reopened. Public
product routes only list recent runs and cancel a queued/running run with an
expected version. There is deliberately no public “start AI” route until a real
provider and proposal kind are accepted. Internal adapters use the typed
repository port; they do not receive generic SQL or an opaque payload channel.

### Proposal envelopes, not an alternate write path

A `ProcessingProposal` belongs to one run, one stage and one typed proposal kind
(`split`, `tags` or `association`). The first slice stores only a bounded summary,
typed target identities, status and exact Fragment inputs. It stores no generic
JSON payload and exposes no accept command.

A later proposal-kind slice must define a closed typed payload and translate an
accepted proposal into the same existing materialize, Entry revision or
association command used by manual/deterministic operation. Until then a proposal
is reviewable evidence, not a database mutation instruction. Models and provider
adapters never write Entry or graph state directly.

### Honest Overview behavior

Overview reads the public run list. When it is empty, it says that there are no
processing tasks. When no provider capability is configured, it also says AI is
not configured. When a real run exists, the rail derives stage state, progress
and current step only from that run. Cancel is available only for queued/running
runs and uses the visible version.

The `ai` capability remains absent until a provider is configured. The separate
`processing_runs` capability means only that the task read/cancel boundary is
available.

### Persistence and portability

Forward migration `000013` adds three tables: current runs, proposal envelopes
and exact proposal Fragment inputs. They are workspace-first and use typed
foreign keys. These rows are personal workspace data and therefore join the
external personal-data package as a new backward-compatible section. Older
packages restore the processing section as empty.

## Alternatives Considered

### Select a provider and build the adapter first

Rejected. Provider choice, privacy transfer policy, cost limits and model output
quality are still open. None is needed to establish honest durable operations.

### Keep task state only in memory or in the browser

Rejected. Restart would lose progress, cancellation versions and proposal
evidence, and Overview could not be a truthful cross-session status surface.

### Store provider payloads as arbitrary JSON

Rejected. It creates a second untyped write protocol, weakens personal-data
governance and makes later proposal acceptance provider-shaped rather than
product-shaped.

### Reuse the retired Knowledge change-set runtime

Rejected. ADR 0009 removed that product path. Entry proposals must target the
current Entry-first commands rather than restore hidden compatibility code.

## Consequences

- The product gains a real operation/proposal seam without claiming an AI
  provider exists.
- Overview can replace its static task placeholder with persistent state while
  preserving a complete non-AI path.
- The next provider slice is smaller: it must supply an adapter, privacy/cost
  policy and one closed proposal payload, not invent job control at the same time.
- The first proposal envelope cannot be accepted. This is intentional; accepting
  an untyped summary would be a hidden alternate mutation path.
- Three more workspace tables and one package section must remain covered by
  migration, repository, API, transfer and UI tests.

## Security, Privacy, and Licensing

No provider, network transfer, model SDK, dependency or licence obligation is
accepted. AI runs require a non-empty provider key; deterministic runs forbid it.
Run errors are stable codes. Proposal summaries and evidence links are personal
workspace data and never enter Git, fixtures or application artifacts.

Private Snapshot targets retain an explicit privacy scope. This local visibility
fact is not encryption or multi-user authorization. A later external provider
must receive a separate accepted privacy and credential boundary before private
content can leave the local workspace.

## Migration and Rollback

Apply `000013` forward. Existing workspaces start with no runs or proposals.
Older personal-data packages restore an empty processing section; new packages
carry all three tables.

Rollback removes the Overview task connection and the processing public routes,
then leaves the additive tables unused. Existing Entry, association, graph,
evidence and Blob data are unchanged.

## Validation

M1E-3A must prove through public/product boundaries that:

- no-provider workspaces still expose the complete five-stage manual path;
- empty run storage is rendered honestly and never as fabricated progress;
- a persisted synthetic deterministic run is listed after restart;
- closed lifecycle transitions and expected-version cancellation work;
- terminal runs cannot be cancelled or reopened;
- proposal envelopes require valid typed targets and exact Fragment evidence;
- the API does not expose source text, credentials, raw provider errors or an
  acceptance route;
- new personal-data packages round-trip all three tables while old packages
  restore them empty; and
- responsive/keyboard UI behavior remains valid at the accepted widths.

## References

- [ADR 0004](0004-adaptive-knowledge-ingestion-and-policy-authorized-writes.md)
- [ADR 0006](0006-external-configuration-and-personal-data-isolation.md)
- [ADR 0009](0009-retire-superseded-m1c-runtime.md)
- [Product requirements](../product-requirements.md)
- [Knowledge core architecture](../knowledge-core-architecture.md)
- [Frontend design specification](../frontend-design-specification.md)
- [Roadmap](../roadmap.md)
