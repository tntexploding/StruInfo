# ADR 0072: Supplied Chinese translation for owner reading

- Status: Accepted owner-use correction
- Date: 2026-09-08
- Trigger: The owner reports that selected articles remain English after annotation, while the application Provider must remain disabled.

## Decision

A narrow PUT on the existing Entry translation resource imports one explicitly supplied title and complete Chinese body. It binds the exact public/current Entry revision number and UUID, uses the existing bounded text validator and atomic repository, and never calls a Provider or changes Entry, Snapshot, Fragment, tags, scores or associations. The server supplies target language, origin and timestamp. Source content and translations remain external data.

Migration 000033 admits `provided-translation-v1` as a stored origin, distinct from `openai-responses-v1`. The historical model and prompt-version fields are empty for supplied text; no API/model provenance is invented. There is no second Provider integration. A current translation is never overwritten: identical replay succeeds, different text conflicts, and a source revision change permits a new cache. Concurrent generation and import keep the first completed cache.

Query prefers an available Chinese cache for all article openings, with a visible original switch. Imported text is labelled separately and is not portrayed as source-verified or human-only. Import does not attest translation completeness or accuracy; those require material review. A feed excerpt remains an excerpt.

Entry Bundle v7 admits the new origin; v6 remains readable with its existing rows, and v1-v5 still upgrade with empty translation state. No dependency, automatic generation, subscription trigger, private-content transfer, translation editor or generic agent capability is added. One-off owner translations and operational evidence must not enter Git or images.

## Validation

Repository verification passed with 1,119 synthetic unit tests, four HTTP integration tests and 29 browser regressions. The disposable PostgreSQL smoke applied all 33 migrations and verified supplied-cache import, repeat import, overwrite rejection, current-source preservation, lexical search and restore; the unit suite also preserves v6 package compatibility.

The frontend correction stays within the existing moderate `struinfo-industrial` Query reader: prefer a saved translation and show its supplied origin. No layout, assets or dependencies change. Material translation, deployed image identity and actual reading verification belong in the selected external instance's operational record.
