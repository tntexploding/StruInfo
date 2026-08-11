# ADR 0006: External Configuration and Personal Data Isolation

- Status: Accepted
- Date: 2026-08-10
- Decision owners: Project owner and maintainers
- Supersedes:
- Superseded by:

## Context and Constraints

StruInfo is intended to hold personal knowledge, source subscriptions,
classifications, preferences, exploration policy, saved searches, prompts, and
later integration settings. These values are user data, not application source
or release defaults.

The project owner requires complete separation between engineering code,
runtime configuration, and personal data. Personal knowledge and preference-like
material must not be hard-coded, committed to Git, copied into tests, or
included in any package, image, executable bundle, or public artifact.

The current repository contains only engineering-foundation code and synthetic
tests, so this boundary can be established before product data exists.

## Decision

Use four separate storage and configuration boundaries:

1. **Application artifact**: code, migrations, public contracts, validation
   schemas, and placeholder examples without active credentials or personal
   values.
2. **External runtime configuration**: database connection, listen addresses,
   external data roots, feature switches, provider endpoints, and secret
   references supplied outside the application artifact.
3. **Workspace-owned PostgreSQL data**: knowledge, source records, custom
   vocabulary, classifications, preferences, exploration and automation
   policies, saved views, UI settings, and audit history.
4. **External Blob/data root and secret store**: source bytes, media, exports,
   backups, and credentials, stored outside both the source repository and the
   installed application or container image.

Actual runtime configuration files and personal profiles are never repository
inputs or build resources. The repository may contain only configuration
schemas and clearly synthetic placeholder examples. Environment variables may
select an external configuration file and provide secret references, but
personal knowledge and preference documents are not encoded into environment
variables.

Personal values include, at minimum:

- knowledge text, notes, attachments, snapshots, and media;
- custom categories such as “novel,” vocabulary, relation labels, and aliases;
- preference profiles, exploration policy, automation policy, feedback, and
  ranking choices;
- source subscriptions, allowlists, schedules, retention choices, and saved
  searches;
- user prompt overlays, layouts, notification settings, and integration
  mappings; and
- workspace exports, backups, logs containing content, and real test samples.

These values live in workspace-scoped database rows or external user documents
and can be exported as a versioned workspace bundle. A bundle is data, not
executable configuration, and must pass schema, size, path, and authorization
validation on import. Secrets are referenced, not included in ordinary bundle
exports.

Code may define protocol state machines, permission semantics, validation
limits, and synthetic defaults that are the same for every installation. It
must not define a user's categories, preferred sources, scores, topic weights,
knowledge, personal prompts, or provider permissions.

Every local or deployed data root is resolved to its canonical absolute path at
startup. The application rejects a personal data, Blob, export, upload, or
backup root contained by:

- the Git working tree;
- the application source directory;
- the installed package or executable directory; or
- a container image's non-persistent filesystem.

Windows development uses an explicitly configured directory outside the
repository. Linux deployment uses an external persistent volume, database, or
object store outside the image. There is no repository-relative personal-data
fallback.

Build and release processes exclude ignored local data and verify that packages
contain only declared source, compiled assets, migrations, contracts, notices,
and synthetic fixtures. Tests use generated or tracked synthetic data only.

## Alternatives Considered

### Keep user YAML beside the source tree and rely on `.gitignore`

This is convenient during development but still places private data inside the
Git working tree, increases accidental packaging risk, and violates the owner's
explicit boundary. Rejected. Ignore rules remain defense in depth, not the
storage design.

### Compile preferences and source lists into application defaults

This makes configuration easy to deploy but couples releases to one user's
private state and risks publishing it. Rejected.

### Store every setting only in environment variables

Environment variables work for small operational and secret references but are
not versioned, expressive, or safe enough for knowledge, taxonomies, policies,
and large user profiles. Rejected as the personal-data model.

### Store runtime settings and user profile in one file

This mixes operator concerns, secrets, portable user preferences, and business
data, making backup, sharing, validation, and least privilege harder. Rejected.

## Consequences

- Local setup requires an explicit external data location before personal data
  can be created.
- PostgreSQL and Blob backups together contain personal state; source-control
  backups do not.
- User categories and preferences can evolve without code changes or package
  rebuilds.
- Portable workspace import/export needs a versioned schema and secret-exclusion
  rules.
- Runtime configuration loading and canonical-path rejection become early
  engineering tasks.
- Existing hard-coded non-personal runtime defaults must be audited; personal or
  environment-specific values move to external configuration before product
  data is introduced.

## Security, Privacy, and Licensing

External configuration and workspace bundles are untrusted inputs and require
closed runtime schemas, bounded sizes, canonical path checks, and safe error
messages. Logs must not echo secrets, knowledge bodies, or full configuration.

Workspace export requires authorization and an explicit choice about evidence,
media, AI records, and secrets. Deletion and backup-retention behavior remains
visible and auditable.

No personal corpus may be repurposed as a test fixture, documentation example,
AI prompt sample, or model evaluation input without a separate explicit user
decision and an independently stored sanitized artifact.

## Migration and Rollback

No personal product data exists in the application schema, so no data migration
is required. Runtime configuration will gain an explicit external configuration
and data-root contract before the first knowledge migration.

Removing the path guard or storing personal defaults in the artifact requires a
superseding ADR and explicit owner approval. Operational rollback may disable
new workspace creation, but must not silently relocate data into the package.

## Validation

- Start the application with an external configuration and data root on Windows
  and Linux.
- Reject canonical paths under the repository, installation directory, or
  container image layer, including traversal and link-based containment.
- Build packages and images, enumerate their contents, and prove that no real
  profile, knowledge, snapshot, export, credential, or backup is present.
- Export and import a synthetic workspace bundle without embedding secrets.
- Verify that changing a custom category, preference, source, or saved query
  requires no source change or rebuild.
- Verify logs and configuration errors do not reveal private values.

## References

- [Knowledge core architecture](../knowledge-core-architecture.md)
- [Development standards](../development-standards.md)
- [Product requirements](../product-requirements.md)
- [ADR 0001](0001-typescript-modular-monolith.md)
- [ADR 0002](0002-postgresql-persistence-and-durable-work.md)
