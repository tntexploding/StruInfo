# ADR 0078: Optional DeepSeek Responses Provider

- Status: Accepted
- Date: 2026-09-12
- Authority: The owner selected DeepSeek as the internal model and authorized a real API workflow test using an external secret file.

## Decision

Add a separate DeepSeek secret/model pair and provider identity. OpenAI and DeepSeek
share the existing bounded Responses adapters for split, tags, associations,
translation and evidence-scoped query synthesis. Only one Responses provider is
configured at a time. OpenAI embeddings remain independent.

Use native fetch against the fixed official endpoints. DeepSeek uses
`reasoning.effort=none`, JSON Schema and the existing output/timeout bounds.
Providers return typed results; existing services still enforce privacy, exact
evidence, current versions, idempotency and authorized acceptance. A configured
model does not enable the saved unattended policy or expand Agent grants.

Migration 000036 only extends the translation provider check. Existing records,
table layout and bundle sections stay unchanged; newly exported DeepSeek
translations require this or a newer runtime to restore. Do not modify historical
migrations or relabel DeepSeek output as OpenAI.

## Service and verification boundary

This integrates a hosted API selected by the owner, with no SDK, model weights,
vendored code or new dependency. The API is subject to the provider's
[terms](https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html);
it is not redistributed under the application's MIT license.
The Responses `store: false` field is not a promise about provider retention or
training policy. Secret and actual configuration remain external.

Protocol sources: [Responses compatibility](https://api-docs.deepseek.com/guides/responses_api/),
[request fields](https://api-docs.deepseek.com/api/create-response/),
[model catalog](https://api-docs.deepseek.com/quick_start/pricing/).
Verification first uses synthetic fixtures and then a small isolated real-model
batch. Owner subscriptions and historical documents are not implicitly admitted.
