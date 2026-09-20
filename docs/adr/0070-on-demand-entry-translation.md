# ADR 0070: On-demand Entry translation for reading

- Status: Accepted owner-use support boundary
- Date: 2026-09-06
- Trigger: The owner selected on-demand translation of selected articles while
  preserving originals, then requested completion with the Provider disabled.

## Decision

Query offers an explicit Chinese-translation action for one current public
InformationEntry. Only its title and body are sent to the existing OpenAI
Responses boundary. Selecting, searching, importing, polling subscriptions and
reading a saved translation never call the Provider. The generation capability
is `ai_entry_translation`, independently labelled from tag/split/association
proposals and query synthesis. It is absent without the existing external model
and environment/secret-injected API key. No credentials are added by this work.

Migration `000032` adds `information_entry_translation`: one current cached
Simplified Chinese reading aid per workspace, Entry and target language, bound
to the exact source revision number and revision UUID. It stores typed title,
body, Provider/model/prompt-version metadata and generation time. It stores no
prompts, raw Provider envelopes, errors, credentials or alternative evidence.
Snapshot, Fragment, Entry body and annotations remain unchanged.

Public/current source scope is checked before sending. Settlement rechecks
revision and privacy under the existing workspace write lock. Reads join the
current public Entry and its exact version; private, retired and stale cached
content cannot be returned. A revision change requires a new explicit request.
Concurrent requests for the same source version are coalesced in the supported
single service; a completed cache is reused across restarts and model changes.

Entry Bundle v6 includes the translation table in personal-data export and
atomic restore. Versions 1–5 remain readable with empty translation state.
All original and derived reading content belongs to the external database/data
root, never Git, application assets or fixtures.

## Reading and failure behavior

- The Query article retains exact-source return and a labelled original/Chinese
  switch. Machine translation is a reading aid, not source-verified content.
- The full selected title and body must fit 24,000 Unicode scalar values. There
  is no silent input truncation, automatic summarization or full-page fetching.
  A feed excerpt remains an excerpt.
- Responses use `store: false`, a closed JSON schema, no tools, a 120-second
  deadline and a separate 16,384-token output budget. Title and body output are
  bounded to 2,000 and 48,000 scalar values, with a 1 MiB response ceiling.
  Incomplete, refused, empty or malformed output is rejected without saving.
- Failure preserves the original and allows retry. Closing the page suppresses
  late UI updates; a request already received by the server may finish saving.
  GET only reads cached data, including when the Provider is subsequently off.
- This is a synchronous request with atomic completed-result persistence, not a
  durable/resumable ProcessingRun or a background translation queue.

## Exclusions and validation

Automatic translation, batch translation, private-content transfer, additional
Providers/languages, translation editing, translation search/indexing and report
generation are outside this boundary. Semantic fidelity remains a human reading
check; passing schema and lifecycle tests is not translation-quality evidence.

Verification uses synthetic material and injected Provider responses. The real
Provider remains unconfigured; no selected owner article is translated as part
of development. See the current project state for validation results.

The adapter follows the official
[Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).

ADR 0071 subsequently enables [cached-translation lexical search](0071-cached-translation-entry-search.md); its narrower supersession preserves this generation and storage boundary.
