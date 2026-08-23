# ADR 0010: Entry-Centered Formal Knowledge Graph

- Status: Superseded
- Date: 2026-08-23
- Decision owners: Project owner and maintainers
- Supersedes: The owner-facing Formal Knowledge page interpretation in ADR 0005, ADR 0007, and ADR 0008
- Superseded by: ADR 0011

## Context and Constraints

ADR 0007 made `InformationEntry` the ordinary document annotation, association,
and retrieval unit. ADR 0008 reserved a `正式知识` page, and ADR 0009 removed the
unused M1C Knowledge runtime so a new product definition would not inherit its
editing ceremony by accident.

The project owner has now defined Knowledge, in the owner-facing product, as a
formal relation graph. Entries are the graph nodes. The Knowledge page has a
small search control, but unlike the Query page it does not present an exhaustive
result list as its primary output: the highest matching Entry becomes the graph
centre and the page shows the formal relations around it.

The decision must preserve the current runnable Entry workflow, exact evidence,
privacy-before-visibility, external personal-data isolation, and a complete
non-AI path. It must also keep the existing similarity-based Entry associations
separate from formal relationships.

## Decision

### Product meaning

The `正式知识` page is an Entry-centred formal relation graph:

- every node is an existing stable `InformationEntry` identity and displays its
  current Entry state;
- a formal edge is an explicitly committed relation between two Entry identities;
- an edge has a user-visible relation label and direction; that vocabulary is
  workspace-owned data rather than a source-code constant or migration seed;
- the exact Snapshot/Fragment evidence already attached to each Entry remains
  available from the node dossier;
- graph structure does not copy Entry bodies into a second ordinary content
  object and does not automatically create a `KnowledgeItem` for every Entry.

Historical `KnowledgeItem`, `KnowledgeRevision`, and `KnowledgeRelation` rows
remain compatibility data. This decision does not delete or silently reinterpret
them, and the new page must not restore the retired M1C writer or search runtime.
A later, explicit migration may map selected historical records when a real
workspace requires it.

### Formal relations versus Entry associations

The existing `AssociationProjection` and manual association override answer
“these Entries may be useful to visit together.” They remain candidate and
navigation data.

A formal relation answers “the owner has committed this named relationship
between these Entries.” Therefore:

- an association may be shown as a proposal while editing a formal relation;
- no score threshold, rebuild, import, parser, model, or AI adapter may turn an
  association into a formal edge without an explicit user command or a later
  enabled and versioned policy;
- rebuilding or deleting association projections cannot change formal edges;
- weakening or blocking an association cannot delete an existing formal edge;
- formal relation creation, revision, retirement, and restoration use one
  explicit application boundary with optimistic concurrency.

### Knowledge-page search and graph navigation

The page contains a simple deterministic Entry search. Its job is to select the
centre, not to duplicate the Query workspace:

1. the highest-ranked matching visible Entry becomes the centre node;
2. a compact candidate list lets the user choose another match when the first
   result is not the intended centre;
3. the initial view loads a bounded direct neighbourhood rather than the whole
   workspace graph;
4. selecting a node opens its node dossier; recentering or expanding is an
   explicit action and loads the next bounded neighbourhood;
5. selecting an edge opens its relation label, direction, current state, and
   edit controls;
6. every node keeps exact source return one action away.

The ordinary `查询` page remains the exhaustive filtered, paginated Entry result
surface. The `正式知识` page is a contextual graph-navigation and formal-relation
maintenance surface. A user who needs complete matching results stays in Query;
a user who wants to inspect how the best match is formally connected opens
Knowledge.

### Layout and accessibility

On a wide screen the page uses three clear regions:

```text
simple centre search and compact alternative matches
formal relation graph                     selected node / edge dossier
```

The graph is bounded and incrementally loaded. It must not render the complete
workspace by default or use decorative physics as evidence of meaning. Relation
labels and direction must be visible without relying on colour alone.

The same nodes and edges must be available through a searchable list/tree mode.
Keyboard users can search, choose the centre, traverse adjacent nodes, select an
edge, recenter, expand, and open evidence. On narrow screens the graph and
list/tree modes occupy the main surface and the dossier becomes a drawer or
routed detail view.

### Privacy and AI

Knowledge search and traversal default to public-only. The current page may
explicitly use public-only, include-private, or private-only scope. Privacy is
applied before centre selection, neighbour loading, counting, traversal, and
rendering; an edge with a hidden endpoint is hidden. Scope never silently carries
from another page or an earlier action.

The first implementation is fully manual and deterministic. Future AI may
propose a centre, relation label, direction, or candidate edge, but the proposal
uses the same formal command boundary and is visibly distinguished until the
user or an enabled versioned policy commits it.

## Alternatives Considered

### Restore the old KnowledgeItem editor and graph

Rejected. It would recreate a duplicate content model, reintroduce the ceremony
that direct use removed, and violate ADR 0009's cleanup boundary.

### Treat similarity associations as formal knowledge

Rejected. Rebuildable scores and user-confirmed semantic claims have different
meanings and lifecycles. Conflating them would let tuning or a projection rebuild
rewrite formal knowledge.

### Make the Query page display a graph mode

Rejected for the first slice. Query owns exhaustive retrieval and comparison;
Knowledge owns one centre and its formal context. Keeping the tasks separate
preserves clear page hierarchy.

### Render the entire workspace graph

Rejected. It is unnecessary for the current 345-Entry workspace, degrades
readability and accessibility, and creates a performance project before a real
use case requires one.

## Consequences

- Formal Knowledge gains one understandable owner-facing meaning without forcing
  every Entry through a second content-writing workflow.
- Existing Entry IDs, bodies, tags, privacy, and Fragment evidence are reused;
  the new persistence work is primarily formal relation state and its commands.
- Query and Knowledge have intentionally different output structures.
- The project needs a forward migration, public relation command/read boundary,
  bounded graph query, page implementation, personal-data-package extension,
  and focused browser verification before the page can be marked available.
- Relation labels are portable workspace data. The first implementation must
  define their closed transport shape, normalization, direction semantics, and
  retirement behavior without compiling a personal vocabulary into the app.
- Historical formal-Knowledge tables remain readable but are not automatically
  promoted into the new graph.

## Security, Privacy, and Licensing

Formal relations, relation labels, graph layout preferences, saved centres, and
all referenced Entry content are user-owned resources. They remain in the
external workspace database or external data root and in personal-data-package
exports; they never enter Git, fixtures, or the application package.

The graph privacy selector is a local visibility boundary, not encryption or
multi-user authorization. No new dependency or third-party graph library is
accepted by this decision; an implementation that proposes one still requires
the normal dependency and licence review.

## Migration and Rollback

Implementation uses a new forward migration and leaves accepted migrations and
historical rows unchanged. Until that slice ships, the existing `正式知识` page
continues to show an honest “definition accepted, implementation pending” state.

Rollback removes the new application entry points and returns the page to that
pending state. It does not delete external workspace rows. Restoring user data
continues to use the external personal-data package rather than a Git rollback.

## Validation

The first M1E-2 implementation is accepted when it proves, through public product
boundaries:

- an existing Entry can be selected as the highest-ranked centre;
- an alternative result can be chosen as the centre;
- the owner can create, edit, retire, and restore a labelled directed relation;
- association rebuilds and overrides do not mutate formal relations;
- a bounded neighbourhood loads and can be incrementally recentered or expanded;
- Query still returns exhaustive paginated results while Knowledge returns the
  centre graph;
- node evidence returns the exact Snapshot/Fragment;
- public-only, include-private, and private-only scopes are applied before
  centre selection and traversal;
- the list/tree alternative exposes the same essential nodes and edges; and
- the personal-data package round-trips the new formal relation state without
  moving personal resources into Git or the application package.

## References

- [ADR 0007](0007-information-entry-first-document-processing.md)
- [ADR 0008](0008-current-entry-state-and-portable-personal-data.md)
- [ADR 0009](0009-retire-superseded-m1c-runtime.md)
- [Product requirements](../product-requirements.md)
- [Knowledge core architecture](../knowledge-core-architecture.md)
- [Frontend design specification](../frontend-design-specification.md)
- [Roadmap](../roadmap.md)
