# Open-Source and Third-Party Policy

- Status: Accepted engineering baseline
- Effective date: 2026-08-02
- Note: This policy is a project risk-control process, not legal advice.

StruInfo may reuse reliable open-source projects when reuse improves quality and
maintainability. Reuse is never source-free or license-free: each component must
have a verifiable origin, bounded purpose, maintained version, and recorded
obligations.

## Authoritative References

- [SPDX License List](https://spdx.org/licenses/) for standardized identifiers
  and canonical license references.
- [Open Source Initiative license list](https://opensource.org/licenses) for OSI
  approval status.

Presence in the SPDX list does not by itself mean a license is OSI approved or
compatible with this project. StruInfo uses the MIT License, and every dependency
remains subject to review against the exact way it is distributed or operated.

## Dependency Admission Checklist

Before adding or upgrading a library, tool, container, copied fragment, asset,
dataset, model, font, or service SDK:

1. Record its purpose and why existing project or standard-library code is not
   sufficient.
2. Verify the canonical project, exact version or immutable commit, download
   location, and artifact checksum where available.
3. Assess maintenance activity, release provenance, security history, and the
   smallest feature/package that meets the need.
4. Verify the license from the exact release and relevant files, not only a
   registry label, README badge, or repository homepage.
5. Record the complete SPDX expression and preserve `AND`, `OR`, and `WITH`
   semantics.
6. Review direct and transitive dependencies, bundled browser artifacts,
   containers, generated runtime code, copyright statements, license texts,
   upstream `NOTICE` files, and exceptions.
7. Record whether the component is linked, modified, vendored, copied, generated,
   offered as a service, or shipped to users.
8. Lock production and build dependencies with the selected package manager and
   rerun review when the version, source, packaging, or project license changes.
9. Update `THIRD_PARTY_NOTICES.md` and retain all required compliance materials.

Unknown, missing, conflicting, or custom license terms do not enter the main
branch or a distributable artifact without explicit owner review.

## Review Categories

These categories prioritize review; they are not compatibility judgments.

| Category | Default handling | Examples |
| --- | --- | --- |
| Routine review | Usually acceptable after provenance and notice checks | MIT, ISC, 0BSD, Zlib, BSD-2-Clause, BSD-3-Clause, Apache-2.0 |
| Conditional review | Confirm use boundary and obligations before merge | MPL, LGPL, EPL, CDDL, dual licenses, license exceptions, fonts, docs, data, models |
| Restricted review | Owner approval and explicit analysis required | GPL, AGPL, source-available, non-commercial, no-derivatives, use-restricted, custom terms |
| Unknown or isolated | Do not merge or distribute | Missing license, conflicting declarations, unavailable terms, unknown source |

GPL and AGPL can be OSI-approved open-source licenses. Their placement in the
restricted category is a conservative project policy for the current MIT-licensed
distribution and private-service boundary. Apache-2.0 still requires checking
for applicable upstream `NOTICE` material.

## Copied or Adapted Code

For every non-trivial copied, translated, or adapted fragment, record:

- upstream project and immutable commit or tag;
- permanent URL, original file, and original line range when available;
- author, copyright, exact license, and upstream notices;
- local destination and a summary of modifications;
- the review record and required attribution or source-availability action.

Preserve valid upstream copyright and license headers. Reformatting, renaming,
or AI-assisted rewriting does not erase provenance obligations. Do not copy
non-trivial code from blogs, answers, public repositories, search results, or AI
output when its license or original source cannot be established.

## Records and Release Gate

- Package manifests and lockfiles are the runtime dependency source of truth.
- `THIRD_PARTY_NOTICES.md` is the human-readable attribution index.
- Complete license texts and upstream notices must accompany each relevant
  distributed artifact; the notices index does not replace them.
- Generate a machine-readable SPDX SBOM for each distributable release after the
  technology stack and build system are selected.
- Treat server, browser, CLI, container, model, and sample-data artifacts as
  separate dependency sets.
- Do not publish a release until all included materials have been reviewed against
  the selected StruInfo MIT License and their own obligations.

The owner selected the MIT License for StruInfo on 2026-08-27. The canonical
project text is the repository-root `LICENSE`; this selection does not replace
the per-dependency review and notices required above.

User-fetched web content is not a software dependency merely because the system
processes it. Any snapshot, sample, image, dataset, or model bundled with a
release still needs separate permission and attribution review.
