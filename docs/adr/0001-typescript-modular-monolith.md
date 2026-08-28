# ADR 0001: TypeScript Modular Monolith

- Status: Accepted
- Date: 2026-08-08
- Decision owners: Project owner and maintainers
- Supersedes: ENG-003 in part
- Superseded by:

## Context and Constraints

StruInfo is a single-user-first web application that must run during development
on Windows and deploy to Linux.
It needs HTTP, WebSocket progress, durable background work, Chinese text,
source-backed AI processing, images, and later optional video processing.

The project should optimize for a readable and maintainable first vertical
slice, not independent service scaling.
No production source tree may be created until this choice is accepted.

Owner confirmations on 2026-08-02:

- TypeScript is accepted as the proposed primary backend language;
- the maintainers do not currently have a stronger C# preference;
- Windows development may use Docker Desktop/WSL2 for infrastructure;
- private knowledge is denied to external AI by default, enabled explicitly per
  workspace, and supported by local or self-hosted provider adapters.

M0-P confirmed that the proposed Node/PostgreSQL roles can run with equivalent
core behavior on Windows and Linux within a bounded, non-distributed probe.
That result is architecture evidence, not production certification.

Remaining assumptions:

- the initial AI workload is remote API orchestration rather than model training;
- a later OCR or video workload may justify an isolated Python worker;
- exact production package versions can pass the M0-S compatibility, license,
  typecheck, and CI gates.

## Decision

Use a pnpm workspace with Node.js 24 LTS and strict TypeScript as the primary
application stack.

- Build the browser application with React and Vite.
- Build the server composition roots with NestJS.
- Keep domain and application policies independent of NestJS decorators.
- Ship one modular-monolith codebase with API, scheduler, and worker entrypoints.
- Run the roles together for the first local slice and separately in production
  when operationally useful.
- Use native WebSocket through the Nest `ws` adapter for ephemeral progress.
- Generate a versioned OpenAPI contract for authoritative HTTP commands and
  queries.
- Validate external payloads with a reviewed implementation of the declared
  JSON Schema dialect and keyword subset. A partial bespoke evaluator is not a
  production option.
- Reject duplicate raw JSON members before materialization. Application and
  domain interfaces accept ordinary own-data records, dense arrays, and owned
  byte copies rather than arbitrary accessor, Proxy, or exotic objects.
- Keep transport schema validation, persistence, scheduling, AI providers,
  source adapters, Blob storage, and external delivery behind explicit ports.
  Inject configuration, clocks, IDs, secrets, and external transports.
- Treat HTTP as the authoritative command/query and recovery interface.
  WebSocket is a versioned, authorized, recoverable projection and cannot own
  business state transitions.
- Add an isolated Python process only after a real OCR, local-model, or video
  requirement cannot be met safely in the primary runtime.
- Do not copy M0-P probe candidate source into the production tree. Implement
  the accepted invariants through reviewed modules and production tests.

The initial repository shape is:

```text
apps/server
apps/web
packages/contracts
packages/test_support
```

Business modules live under `apps/server/src/modules` and expose application
interfaces rather than calling one another's tables.

Use the Google TypeScript Style Guide as the normative language guide.
Use Prettier for deterministic formatting, ESLint with typed typescript-eslint
rules for static checks, TypeScript strict checking, Vitest for unit and
integration tests, and Playwright for browser end-to-end tests.
Any mechanically unavoidable mismatch with Google style must be narrow,
documented, and enforced consistently.

Exact package versions will be pinned in `package.json` and the single
`pnpm-lock.yaml` in the M0-S scaffold change after this ADR is accepted.
Production dependencies must use stable releases at that point.

## Alternatives Considered

### .NET 10 LTS Backend and TypeScript Frontend

.NET offers excellent Windows/Linux behavior, strong domain typing, hosted
services, and SignalR.
It remains the preferred fallback if the maintainers are substantially more
experienced in C# or require a Windows Service early.

It is not proposed because the project already needs the TypeScript frontend,
and a TypeScript backend lets contracts, tooling, and most adapters share one
language and package graph.

### Python Backend and TypeScript Frontend

Python has the strongest local AI, OCR, and document-processing ecosystem.
It is not proposed as the stateful core because the first product risk is
provenance and workflow value, not local model training, and common durable
Python queues create extra Windows/Linux differences.
Python remains available behind an explicit media-processing contract.

### Microservices

Microservices would provide independent scaling and release boundaries.
They are rejected for the first version because those needs are not yet
measured, while distributed transactions, deployment, tracing, and schema
coordination would be immediate costs.

## Consequences

Positive consequences:

- one primary language across browser, server, workers, and contracts;
- fast vertical iteration with explicit compile-time and runtime validation;
- the same build artifact can scale by process role without service extraction;
- strong web, streaming, scraping, and AI API ecosystems.

Negative consequences:

- TypeScript types are erased, so every external payload needs runtime schema
  validation;
- CPU-heavy OCR and media work must not block the Node.js event loop;
- Node LTS upgrades occur more frequently than .NET LTS upgrades;
- NestJS conventions must not leak into the domain model.

## Security, Privacy, and Licensing

Fetched content, media, Webhook payloads, and model output are untrusted.
All external data crosses runtime validation before application use.
Runtime validation must preserve standard conditional/composition semantics,
closed objects, bounded input, fatal UTF-8 decoding, and stable safe errors.
It must not execute caller-provided getters, iteration hooks, or Proxy traps.
CPU-heavy or native media processors run with explicit resource and file access
limits.

Node.js, TypeScript, NestJS, React, Vite, pnpm, Vitest, and Playwright require
exact-version and transitive-license review before installation.
Their current headline licenses are not a substitute for that review.

## Migration and Rollback

Before production code exists, rollback means rejecting this ADR and accepting
a replacement for .NET or Python.
After implementation begins, the stable boundaries are OpenAPI, event schemas,
PostgreSQL data, Blob IDs, and processor contracts; these reduce but do not
eliminate the cost of changing the runtime.

## Acceptance Evidence and Remaining Gates

Accepted on 2026-08-08 because:

1. The owner confirmed TypeScript and the Windows Docker/WSL2 development
   boundary.
2. M0-P established bounded Windows/Linux runtime feasibility and showed that
   the P2 provenance and P3 protocol findings can be expressed as production
   invariants without changing the modular-monolith choice.
3. The final risk-proportional architecture review found no material blocker
   and prohibited direct reuse of the disposable candidates.
4. The reviewed dependency graph was sufficient for architecture selection in
   a non-distributed probe.

Acceptance authorizes M0-S foundation work, not production readiness.
M0-S must pin exact package and tool versions, create the lockfile, review the
complete dependency/lifecycle/license closure, define style deviations and
verification commands, and establish the Windows/Linux CI matrix.
Production implementation must independently test runtime Schema conformance,
module boundaries, WebSocket Origin/workspace/resource limits, HTTP recovery,
and the P2/P3 invariants recorded in the development outline and ADR 0002.

## References

- [Development outline](../development-outline.md)
- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
- [Node.js release status](https://nodejs.org/en/about/previous-releases)
- [NestJS documentation](https://docs.nestjs.com/)
- [React versions](https://react.dev/versions)
- [Vite guide](https://vite.dev/guide/)
- [Playwright installation](https://playwright.dev/docs/intro)
