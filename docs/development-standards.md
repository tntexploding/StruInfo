# StruInfo Development Standards

- Status: Accepted engineering baseline
- Effective date: 2026-08-02
- Last revised: 2026-08-16
- Scope: Human-authored code, tests, configuration, and documentation

These rules establish a readable, modular, standardized, and maintainable code
system without selecting a technology stack prematurely.

## Normative References and Precedence

Use the [Google Style Guides](https://google.github.io/styleguide/) as the
default source-code convention for each selected language. Use the
[Google Markdown Style Guide](https://google.github.io/styleguide/docguide/style.html)
for repository documentation.

Apply rules in this order:

1. Applicable legal and licensing obligations, plus reachable and material
   security, privacy, and data-integrity requirements.
2. Explicit project deviations recorded in this document or an accepted ADR.
3. The relevant Google language or documentation style guide.
4. Official ecosystem conventions where Google gives no guidance.

Repository formatters and linters must enforce this policy. If a standard tool
cannot match a Google rule, record the narrow deviation and prefer one stable,
automated result over recurring manual style debate.

Generated files and unmodified vendored code are exempt from reformatting, but
their origin and generation process must be documented.

## Runnable-Core Priority and Proportional Gates

The primary development objective is to reach a runnable, logically coherent
product through the shortest maintainable path. Correct core behavior takes
priority over speculative completeness, defensive perfection, and exhaustive
test-harness hardening.

A finding may block the current product-development path only when concrete
evidence shows that it is reachable through a currently supported boundary and
has at least one of these effects:

- prevents the application from building, starting, or completing an accepted
  primary workflow;
- produces a materially incorrect domain result or violates an accepted core
  invariant, including workspace isolation, provenance, idempotency, manual
  authority, or the complete non-AI path;
- creates a credible current risk of data loss, data corruption, credential or
  private-content disclosure, or unauthorized access or mutation;
- makes an in-scope migration, recovery path, or required compatibility
  boundary unusable; or
- violates an applicable legal or licensing obligation for the activity being
  performed.

The following findings are non-blocking by default and must be recorded as
deferred hardening instead of stopping product development:

- hypothetical inputs, runtimes, realms, deployment modes, or attack paths that
  cannot occur through the currently supported product boundary;
- defects or missing defenses in a test harness, oracle, report parser, review
  script, or other verification tooling that do not expose a product defect;
- defense-in-depth work for a future network, cloud, multi-user, plugin, or
  distribution boundary that is not currently enabled;
- performance optimization without evidence of a user-visible regression in
  the current workload; and
- style, naming, diagnostic, or extra-hardening improvements that do not change
  the correctness of the current product path.

Every Test, Maintenance, and implementation handoff must classify each finding
as `PRODUCT_BLOCKER`, `DEFERRED_HARDENING`, or `ENVIRONMENT_NOT_READY`.
A `PRODUCT_BLOCKER` must identify the supported trigger, a reproducible product
impact, and the violated accepted requirement. A test-tooling failure is not a
product failure merely because it prevents that tooling from issuing a formal
verdict. Certification may remain explicitly unissued while product development
continues.

Record non-blocking findings once in `docs/deferred-hardening-memo.md`, including
their evidence and a concrete condition for revisiting them. Do not start repeat
repair cycles or reopen a deferred item without new evidence that changes its
reachability or material product impact. Test and review work must not silently
expand an accepted gate after implementation begins.

The Main Agent owns final scope and blocking classification. When no
`PRODUCT_BLOCKER` remains, the next product task proceeds even if deferred
hardening, future-environment validation, or formal certification remains open.
This rule does not permit concealing a reachable material security, privacy,
data-integrity, or legal defect; it requires proportional evidence before such a
defect can stop the main line.

## Technology-Stack Gate

Before adding production code, approve an ADR that selects:

- runtime language and supported versions;
- application and repository boundaries;
- the corresponding Google style guide;
- formatter, linter, type/static checker, and test runner;
- package manager, lockfile policy, and dependency audit command;
- local verification commands and the initial CI contract.

Do not create placeholder source trees, package manifests, CI workflows, or
container files before those decisions are made.

## Readable Code

- Use precise English identifiers that describe domain intent.
- Prefer simple control flow and explicit data movement over hidden behavior.
- Keep functions focused and modules cohesive; split them by reason to change.
- Make dependencies visible through constructors, parameters, or clear module
  interfaces instead of global mutable state.
- Prefer composition and small interfaces over speculative abstraction.
- Avoid abbreviations, magic values, boolean parameter puzzles, and comments
  that merely repeat the code.
- Comments and docstrings explain purpose, constraints, tradeoffs, provenance,
  or surprising behavior.
- Return errors with actionable context. Never silently discard failures.
- Validate configuration at startup and use safe, documented defaults.
- Use structured logs and exclude credentials, private content, and unnecessary
  personal data.

## Configuration and Personal Data

- Keep executable code, configuration schema, active runtime configuration,
  secrets, and workspace data as separate boundaries.
- Treat the repository and release artifact as protocol-only: they may define
  schemas, ports, state machines, migrations, and synthetic examples, but they
  are never the active store for user-owned resources.
- The repository and release artifact may contain configuration schemas and
  synthetic placeholder examples, but never an active personal configuration.
- Load environment-specific runtime values from an external configuration path,
  environment variables, or secret references. Do not encode them in domain or
  composition code.
- Store personal knowledge, custom vocabulary, preferences, policies, source
  subscriptions, saved searches, prompt overlays, snapshots, exports, and
  backups in workspace-owned PostgreSQL or an external data root.
- The same rule covers manually supplied documents, fetched source bytes,
  annotations, memory/profile files, UI state, attachments, media, model
  context, and every similar resource. Git ignore rules are defense in depth,
  not permission to keep active data inside the worktree.
- Personal data roots must resolve outside the Git worktree and installed
  application/package directory. Validate canonical paths at startup and reject
  containment, traversal, and link-based escapes.
- Do not use real user data as a test, documentation, example, benchmark, or AI
  fixture. Tracked fixtures are synthetic and must not be derived from private
  content without a separately approved sanitized artifact.
- Code may define system state machines, authorization semantics, schemas, and
  universal safety limits. User categories, topic weights, sources, scores,
  provider permissions, and personal prompts are data, not code constants.
- Domain and application code consume personal resources only through typed,
  replaceable ports. Do not import a user file as a JavaScript/TypeScript module,
  bundle it as an asset, seed it through a migration, or make a repository-
  relative path the production default.
- One unchanged build must support multiple external configurations and
  workspaces. Replacing configuration or reopening a workspace must not require
  source changes, a rebuild, or copying data into Git. The first version may use
  an explicit controlled restart/reopen instead of background file watching.
- Reload and switch operations are validate-then-activate: construct and verify
  the complete replacement configuration, database/data-root adapters, and
  workspace identity before exposing them. Failure leaves the previously active
  configuration/workspace intact and returns a visible error; partial mixed
  state is not accepted.
- Runtime configuration selects endpoints, data roots, feature settings, and
  secret references. Knowledge, preferences, vocabulary, sources, prompts, and
  saved views remain workspace data; do not turn the runtime dotenv file into a
  second knowledge store.

There is no arbitrary maximum file or function length. Reviewers should ask
whether a unit has one understandable responsibility and can be tested without
unrelated setup.

## Modular Design

The repository uses the accepted modular-monolith workspace shape. Later
modules and layout changes must preserve these dependency principles:

- Domain knowledge and policy do not depend on web frameworks, databases,
  schedulers, model vendors, source adapters, or QQ-specific APIs.
- External systems are reached through explicit adapters and replaceable
  interfaces.
- Modules do not form dependency cycles.
- Public contracts have defined inputs, outputs, errors, versioning, and
  ownership.
- Cross-module mutation is avoided; state transitions are explicit and audited.
- New abstractions require at least one current use and a credible second use.

## Tests and Verification

- Every behavior change includes focused tests; every bug fix includes a
  regression test when practical.
- Unit tests do not depend on live networks, clocks, random values, AI providers,
  or user machines. Inject deterministic substitutes at those boundaries.
- Integration tests cover storage, source fetching, model adapters, scheduling,
  and external protocols separately.
- Contract tests protect versioned HTTP, WebSocket, Webhook, and data-export
  formats once those interfaces exist.
- Security-sensitive parsers and state transitions require negative and abuse
  cases, not only happy paths.
- A test-framework defect may block certification by that framework, but it does
  not block product development unless it demonstrates a `PRODUCT_BLOCKER` under
  the proportional-gate rules above.
- Test fixtures must be synthetic, explicitly licensed, or safely anonymized.
- The README or contributor guide must list one command for formatting, linting,
  static checks, tests, and the complete local gate after the stack is selected.

## Frontend Design

Frontend implementation and review must follow
`docs/frontend-design-specification.md`.
That document owns the project visual contract, evidence and AI presentation,
design tokens, responsive behavior, accessibility target, and design-review
gate.

Visual reference documents and personal Agent Skills do not authorize new
frameworks, packages, fonts, assets, or copied third-party code.
Those changes still pass the technology, dependency, and open-source gates in
this document and the accepted ADRs.

## Documentation

Follow the Google Markdown guide: one H1, ATX headings, blank lines around
headings and lists, fenced code blocks with a language, informative links,
standard Markdown instead of HTML, no trailing whitespace, and a final newline.

English prose should wrap near 80 characters where practical. For Chinese prose,
use one semantic sentence per physical line and treat 80 Unicode characters as a
soft target; headings, tables, links, and code blocks remain exceptions. This is
the repository's documented CJK readability deviation.

Documentation is part of a change, not deferred cleanup. Update the canonical
requirement, roadmap, decision, API, migration, and operator documentation with
the code that changes them. Delete or archive obsolete guidance instead of
leaving contradictory sources of truth.

## Git and Review

- `main` is the single long-lived branch. Use short-lived branches for work.
- Prefer small commits with `type(scope): imperative summary` subjects.
- Do not mix formatting sweeps, refactors, features, and dependency upgrades in
  one commit.
- Review behavior, security, privacy, provenance, compatibility, observability,
  rollback, tests, and licensing before style minutiae.
- Accepted architecture decisions are changed by a superseding ADR, not by
  rewriting their history.

## Security Baseline

- Treat fetched pages, documents, messages, and model output as untrusted data.
- Prevent server-side request forgery before implementing arbitrary URL fetches.
- Do not let source content grant tool permissions or alter trusted instructions.
- Authenticate external writes and sign/replay-protect Webhook events.
- Keep retries idempotent and make partial failure visible.
- Store secrets outside Git and redact them from errors, telemetry, and prompts.
- Default local services to loopback; require explicit configuration for wider
  network exposure.
- Require a threat model before implementing public deployment, external model
  data transfer, authenticated crawling, or a cloud-to-local bridge.

## See Also

- `CONTRIBUTING.md`
- `docs/deferred-hardening-memo.md`
- `docs/open-source-policy.md`
- `docs/frontend-design-specification.md`
- `docs/decision-log.md`
- `docs/adr/README.md`
