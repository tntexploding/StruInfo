# ADR 0075: Bounded AI tasks and the Agent interface

- Status: Accepted for implementation
- Date: 2026-09-12

The owner accepted roadmap step 2: an internal selected-document AI loop and an
external Agent interface. Both call shared application services in the existing
single workspace runtime.

A document task records a versioned, explicit authorization to split one public,
empty Snapshot, tag only its resulting Entries, and propose a bounded number of
keyword-supported public relationships. The task freezes the configured model,
limits Entries, relationship writes and model attempts, and uses the existing
typed proposal validators and acceptance commands. It never edits evidence,
overwrites an existing structure or silently adopts a later manual revision.
It is separate from unattended subscription policy, which remains the next step.

External Agents use a default-off bearer-protected endpoint with a fixed
server-configured identity and separate read, annotation and model-task grants.
A stdio MCP adapter forwards only named operations to that endpoint. It cannot
choose a workspace, impersonate the owner or call the owner HTTP facade.
External tag and relationship results use the existing typed AI proposal
boundary, with external-agent provenance and no internal Provider call.
Relationships remain unreviewed; this interface cannot certify a source.

Migration 000034 stores typed task authorization and content-free execution
progress as schema-validated JSON text in a workspace table. This is not an
arbitrary Provider payload store. Existing typed proposals remain the durable
write/recovery evidence. Processing Bundle v11 carries tasks; older bundles
restore an empty task set. Credentials stay in environment configuration and
are never exported.

A database advisory lock serializes each task, including across processes.
Successful stages and proposal identities survive interruption. Resume reuses
a completed proposal, and charges a new bounded attempt only when generation
must be retried. Revision conflicts remain visible failures. Pause takes effect
at a stage boundary; already completed writes remain. Startup does not silently
resume restored tasks. The model configuration stays optional and off without
credentials.
