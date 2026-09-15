# ADR 0080: Intake quality and multilingual relation recall

- Status: Accepted by owner direction on 2026-09-13
- Scope: Full article preparation, reversible intake interception, relation
  candidate recall, and a bounded owner-selected pilot

## Decision

Keep immutable captures and whole-article Entries. A received RSS notification
is not evidence that the complete article was received. An explicitly requested
quality workflow may fetch the selected public canonical page with the existing
bounded Web connector. Save those exact bytes as a separate Snapshot, retain the
received capture, and record the preparation link. Failed or uncertain extraction
remains visible and does not silently become a complete article.

HTML projection recognizes explicit article-body markers and unambiguous
heading/content containers in addition to semantic article elements. It avoids
selecting an outer article or page shell when one marked reading body is
available. This excludes surrounding navigation and recommendation catalogs
while retaining the page title, argument, source links and image captions.
Ambiguous layouts still require completeness review; fetching a page is not
proof that its article was extracted correctly.

The inbox exposes versioned admission decisions with a reason, source return,
and an explicit restore action. Interception stops subsequent automatic work;
it does not delete evidence or rewrite existing Entries. A typed model review
may assess completeness and article purpose under a frozen owner policy. Manual
decisions take precedence. Private content never enters a model or network
preparation call. New records are workspace data and travel in personal packages.

Relation recall combines existing annotations, confirmed aliases, title/body
matching and bounded model-generated multilingual search variants. Search
variants are task evidence, not global semantic equivalence or user tag edits.
Rank and diversify candidates before the existing pair evaluator decides whether
a useful specific relation exists. A candidate budget is distinct from the
accepted relation budget; model attempts retain the existing total limit.
Prefer a complete current capture over superseded fragments of the same source,
and avoid consuming the candidate budget with repeated captures of one document.

The current model adapter asks for at most six grounded concepts, each with one
English and one Chinese phrase, within the existing output budget. Generated
short Latin abbreviations must also occur in the source reading text or original
tags; link destinations do not establish a term. Explicitly confirmed aliases
remain usable. These constraints narrow recall noise without claiming that a
shared topic is itself a useful relation.

Existing requests and saved policies retain their old bounds unless the new
workflow is explicitly selected. No new model provider, embedding service,
dependency, global unattended activation or report generation is implied.

## Verification

Synthetic tests cover public source preparation, privacy, retry and provenance,
manual interception and restoration, multilingual and alias recall, unrelated
negative candidates, source diversity, concurrency, budgets and package recovery.
UI checks cover the inbox actions, retained reading space and visible causes.
Engineering verification passed 1,275 unit tests, four integration tests, type,
format, lint, build, artifact and deployment checks. The 43 browser regressions
and synthetic PostgreSQL 18 migration/package/grant checks passed; live Edge
checks also exercised reversible intake controls and desktop/narrow layouts.
The owner-authorized pilot keeps all source content, configuration, model results
and review artifacts outside the repository. A passed workflow does not certify
the quality of every model-selected relationship.
