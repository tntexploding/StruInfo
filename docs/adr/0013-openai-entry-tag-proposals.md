# ADR 0013: OpenAI Entry Tag Proposals

- Status: Accepted
- Date: 2026-08-24
- Decision owners: Project owner and maintainers
- Supersedes:
- Superseded by:

## Context and Constraints

M1E-3A established provider-neutral processing runs and typed proposal
envelopes. The product still has no provider execution, no closed proposal
payload and no proposal acceptance path. The complete manual and deterministic
Tags workflow already writes the current `InformationEntry` state and must
remain the authority boundary.

The next increment must select exactly one provider and one proposal type. It
must be useful without making AI available by default, must not send private
documents outside the local workspace, and must keep credentials, source data
and personal preferences outside Git and the application package.

## Decision

### One provider and one operation

M1E-3B selects the OpenAI Responses API and only the `tags` proposal kind. The
adapter uses the platform `fetch` implementation and therefore adds no SDK or
third-party dependency. It is enabled only when both `OPENAI_API_KEY` and
`STRUIINFO_OPENAI_MODEL` are supplied through external runtime configuration.
The API key is process-environment-only and is never written to a run,
proposal, log, package, export or browser response.

The endpoint is fixed to the OpenAI Responses API. Each explicit owner action
sends at most one non-private Entry, performs one request with no retry or
tools, sets `store: false`, and applies a bounded output-token and request
deadline. There is no automatic background scan in this increment.

### Closed tag proposal payload

Forward migration `000014` adds three typed payload tables below an existing
`ProcessingProposal`: one payload header, ordered content keywords and ordered
domain assignments. The header freezes the expected Entry revision, provider
model, prompt version and proposed type. No arbitrary JSON, prompt text, raw
provider response or source body is persisted.

The provider response is accepted only when it conforms to the closed schema
and the same type/domain/keyword budgets used by the Entry editor. The proposal
keeps its exact Fragment inputs and its visible AI origin. A malformed or
unavailable provider produces a stable run error code without exposing the raw
provider error.

### User authority and the existing write command

Starting a proposal never changes an Entry. The Tags page shows the proposed
keywords, type, domains, model origin and short explanation. Rejecting marks
only the proposal as rejected. Accepting translates the stored payload into the
existing `InformationEntryRepositoryPort.reviseEntry` command with the frozen
expected revision. Stale Entries remain unchanged and return a visible
conflict. Accepted keyword and domain annotations retain `ai` origin and a
provider/model/prompt version string.

The acceptance path is retry-safe: if the Entry revision was applied but the
proposal decision was interrupted, a retry may mark it accepted only after the
current Entry exactly matches the stored AI payload and expected next revision.
The model never receives a repository port and never writes Entry or graph
state directly.

### Privacy and availability

Private Entries are excluded before provider invocation. M1E-3B has no
`include_private` escape hatch: private-document AI processing requires a later
explicit decision. The UI explains that an owner-triggered public Entry body is
sent to OpenAI. When the provider is not configured, the capability and start
control are absent while manual tags, deterministic candidates and every other
main workflow remain available.

## Alternatives Considered

### Store the model response in the proposal summary

Rejected. A human-readable summary cannot be validated or safely translated to
the Entry command and would recreate the untyped payload problem rejected by
ADR 0012.

### Let the provider call the Entry repository

Rejected. It would bypass user review and create an AI-specific mutation path.

### Support private Entries immediately

Rejected. External disclosure of private content needs a separate, explicit
owner decision and product surface. It is not required for a useful first
provider slice.

### Add an OpenAI SDK

Rejected for this slice. The Responses API request is narrow and the platform
already supplies `fetch`; an SDK would add a dependency and licence surface
without improving the product boundary.

## Consequences

- Public, user-selected Entries can produce durable, reviewable AI tag
  proposals.
- The Tags page gains a real AI action without weakening or replacing its
  manual path.
- Provider configuration and failure do not block startup or non-AI work.
- Private Entries remain local-only in this slice.
- Three workspace tables and the next processing-package section version must
  remain covered by migration, repository, API, transfer and UI tests.

## Validation

M1E-3B must prove that:

- no-provider startup and the complete manual Tags workflow still work;
- the OpenAI request uses the configured model, fixed endpoint, `store: false`,
  no tools, a bounded output and one public Entry;
- private Entries are rejected before any network call;
- malformed/provider failures create only stable run errors;
- closed tag payloads round-trip through PostgreSQL and the personal-data
  package;
- proposal accept calls the existing Entry revision boundary, preserves the
  body and assessments, records AI annotation origin and rejects stale writes;
- proposal reject does not modify Entry data; and
- browser review clearly distinguishes a proposal from committed tags.

## References

- [ADR 0006](0006-external-configuration-and-personal-data-isolation.md)
- [ADR 0008](0008-current-entry-state-and-portable-personal-data.md)
- [ADR 0012](0012-provider-neutral-processing-runs-and-proposals.md)
- [Product requirements](../product-requirements.md)
- [Roadmap](../roadmap.md)
