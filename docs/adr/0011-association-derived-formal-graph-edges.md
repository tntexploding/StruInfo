# ADR 0011: Association-Derived Formal Graph Edges

- Status: Accepted
- Date: 2026-08-23
- Decision owners: Project owner and maintainers
- Supersedes: ADR 0010's requirement that every formal edge be explicitly committed before appearing in the Knowledge graph
- Superseded by:

## Context and Constraints

ADR 0010 defined the owner-facing Formal Knowledge page as an Entry-centred
relation graph. It separated the existing deterministic similarity associations
from formal edges and required an explicit user command or enabled policy before
an association could become an edge.

The project owner has clarified that this promotion step is unnecessary. A
similarity association is already useful relationship information and may appear
directly in the formal graph, provided the user can edit or remove it. Requiring
manual confirmation for every generated edge would repeat work already performed
by the deterministic association system and make the graph unnecessarily costly
to maintain.

The change must preserve explainability, privacy-before-visibility, user
authority, deterministic non-AI operation, and protection of user edits from a
later projection rebuild.

## Decision

### Graph-edge sources

The current Formal Knowledge graph is the union of:

1. visible deterministic similarity associations produced by the existing
   `AssociationProjection`; and
2. user-created or user-edited relationship state.

A visible association projection may therefore appear immediately as a formal
graph edge. It does not require a separate promotion or confirmation action.
Its system relation kind is `similarity`, it is symmetric, and the UI labels its
origin as automatically calculated rather than user-authored. This universal
protocol value is not a personal vocabulary seed.

User-created relations may use a workspace-owned label and direction. User data
remains external workspace state and is not compiled into source, fixtures, or a
migration seed.

### User authority over generated edges

The user can edit, hide/delete, or restore an automatically generated edge:

- changing its label or direction creates a user-controlled interpretation that
  takes precedence over the calculated presentation;
- hiding or deleting it persists a block override so an association rebuild does
  not immediately recreate the visible edge;
- restoring it reveals the current deterministic projection again;
- projection rebuilds may update the underlying similarity score and explanation
  but cannot overwrite a user edit or block; and
- the graph always exposes whether the currently displayed edge is calculated,
  user-edited, or user-created.

This is direct user editing authority, not a mandatory review queue. The system
does not require the user to confirm every edge before the graph becomes useful.

### Implementation priority

M1E-2 first reuses the implemented Association projection and override boundary.
A forward migration is added only for relationship fields that the current
override cannot express, such as a user label, direction, or user-created edge.
The implementation must not create a second copy of similarity projections just
to call them Knowledge.

The Knowledge-page search, bounded centre neighbourhood, privacy scopes, exact
source return, accessible list/tree alternative, and separation from exhaustive
Query results remain as accepted in ADR 0010.

Future AI-derived relationships still require the existing automation authority
boundary. This decision permits deterministic association edges; it does not give
a model adapter a direct database write channel.

## Alternatives Considered

### Require promotion for every association

Rejected by the owner. It adds repetitive manual work without improving the
utility of deterministic similarity edges.

### Display associations only as a separate proposal layer

Rejected for the first graph. It creates two visually competing edge systems for
the same navigation task. Origin labels and user overrides provide the needed
distinction more directly.

### Make projection rebuilds overwrite all graph edges

Rejected. It would remove user authority and make editing or deleting an
automatic edge ineffective.

## Consequences

- The first Knowledge graph can be useful immediately from the 598 existing
  association projections instead of starting empty.
- M1E-2 can reuse current association reads, explanations, privacy rules, and
  manual overrides, reducing implementation scope.
- “Formal” means the relationship is part of the maintained Knowledge graph; it
  does not imply that every edge is a manually verified factual claim.
- Edge origin becomes required UI and API data so automatic similarity is not
  mistaken for a user-authored semantic assertion.
- User deletion of an automatic edge needs a durable block/tombstone behavior;
  otherwise rebuild would violate the user's edit.
- User-created labelled or directed relations may still require a small additive
  persistence extension.

## Security, Privacy, and Licensing

Privacy is applied before graph-edge selection and traversal. A similarity edge
with a hidden endpoint remains hidden. User-created labels, edits, blocks, and
layout preferences are personal workspace data and remain outside Git and the
application package.

No new dependency, third-party graph library, model provider, or licence
obligation is accepted by this decision.

## Migration and Rollback

Existing Association projection and override rows remain valid and become the
initial graph-edge source. No data rewrite is required merely to display them.
If additional user relation fields require storage, use a new forward migration
without changing accepted migrations.

Rollback returns the Formal Knowledge page to its pending state and leaves the
existing Association data untouched. External workspace state is restored from
the personal-data package, not from Git.

## Validation

The M1E-2 implementation must prove through public product boundaries that:

- a visible deterministic association appears as a `similarity` graph edge
  without a confirmation step;
- its score, explanation, symmetric semantics, and automatic origin are visible;
- the user can relabel or redirect it and the edit survives rebuild;
- the user can hide/delete it and rebuild does not make it visible again;
- the user can restore it and see the current projection;
- the user can create and remove a relationship that has no similarity
  projection;
- privacy is applied before edge visibility and traversal; and
- personal-data export and restore preserve user edits and blocks while derived
  projections remain rebuildable.

## References

- [ADR 0010](0010-entry-centered-formal-knowledge-graph.md)
- [Product requirements](../product-requirements.md)
- [Knowledge core architecture](../knowledge-core-architecture.md)
- [Frontend design specification](../frontend-design-specification.md)
- [Roadmap](../roadmap.md)
