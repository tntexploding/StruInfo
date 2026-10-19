# Maintenance security repair — 2026-10-19

The owner's v0.4.0 release audit reproduced two maintenance failures on public main: the pinned Debian PCRE2 revision had disappeared from the rolling mirror, and production npm audit reported six advisories across five packages.

## npm fixes

| Package                   | Old → new       | Advisories                                                                                                                                         |
| ------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| proxy-addr                | 2.0.7 → 2.0.8   | [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)                                                                           |
| @modelcontextprotocol/sdk | 1.30.0 → 1.31.0 | [GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h)                                                                           |
| multer                    | 2.3.0 → 2.4.0   | [GHSA-3pph-fpjx-jg34](https://github.com/advisories/GHSA-3pph-fpjx-jg34)                                                                           |
| fast-uri                  | 3.1.7 → 3.1.8   | [GHSA-hrr3-gc8f-f4qj](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj)                                                                           |
| ip-address                | 10.7.0 → 10.7.1 | [GHSA-j6r3-76f7-8jcv](https://github.com/advisories/GHSA-j6r3-76f7-8jcv), [GHSA-h3mg-xc3c-68pw](https://github.com/advisories/GHSA-h3mg-xc3c-68pw) |

Registry metadata and downloaded archives agree on SHA-512. SHA-256 and registry identities are recorded in the release SPDX, with exact license text in the corresponding npm legal folders. All five packages retain MIT or BSD-3-Clause terms and have no install lifecycle. No release-age, integrity or peer policy was relaxed.

Multer no longer requires concat-stream and its unused closure; seven package identities and their unused legal files were removed.

The full audit also found build/test advisories. Vitest and its seven matching
`@vitest/*` packages move from 4.1.10 to 4.1.11 for
[GHSA-82fw-gwwq-j7x9](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9).
The brace-expansion override moves 5.0.9 to 5.0.12 for
[GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr),
[GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7) and
[GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p).
source-map-js moves 1.2.1 to 1.2.2 for
[GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
Their downloaded archives, checksums and license text were reconciled in the same
way; no additional package identities or install scripts were introduced. All other
selected versions remain unchanged. Both full and production-only npm audits now
report no known vulnerabilities. CI audits both build and runtime dependencies.

## Container build

The build stage uses the official Node 24 Bookworm Slim index:

`sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5`

The linux/amd64 manifest is `sha256:ec857ea6bb60cb3d0fa4d97495590c5fe7d51be8572c307b55957eeb06569cf7`, built from nodejs/docker-node commit `f27125230b3c367dcf63043ea3fe286fb3d0914c`. It contains Node 24.22.0 and PCRE2 `10.42-1+deb12u2`. The obsolete `apt-get install ...=10.42-1+deb12u1` step was removed.

The runtime stage uses the same official Node release on Alpine 3.24, index
`sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f`,
amd64 manifest `sha256:429bdfbc204b4eabc6438e6d34e4e9d8dd2ca1df8289bcd78cdd3c5db387b7a5`.
It ships only the compiled server, static frontend, JavaScript production packages,
migrations and legal records. Build tools and optional native Canvas are excluded;
no glibc compatibility layer is added. CI checks for native binaries and exercises
MCP loading plus HTML/PDF text extraction inside the network-disabled, read-only
runtime image. Database startup, grants and application readiness are also checked
in a disposable installation before release. Native dependencies would require
revisiting this build/runtime boundary.

This replaces the previous Debian runtime's unused system-tool closure, which still
reported 19 unfixed HIGH/CRITICAL CVEs in a fresh October 19 scan. It does not remove
packages from a running installation or suppress their findings.

The image scanner also reads the shipped full SPDX inventory. Its initial three
Node findings referred to brace-expansion and source-map-js in that inventory;
their package code was absent from the runtime filesystem. These build dependencies
were nevertheless patched above. The complete inventory and unfiltered scan remain.

The final October 19 runtime scan reports zero HIGH/CRITICAL findings in both the
Alpine packages and the complete npm inventory. The rebuilt image passes the
network-off parser/MCP check and a fresh non-superuser migration, grants,
preflight, HTTP readiness and static-page startup check. These results describe
this scan and artifact; scheduled scans continue to check newer advisories.

The existing Trivy 0.74.0 official archive/checksum remains pinned. The scan retains HIGH/CRITICAL severity and a failing exit for findings. It runs on main pushes as well as the weekly schedule, so a release no longer waits for the next scheduled scan. The final scan outcome is recorded in the release notes and GitHub workflow; build success alone is not a clean security result.

## CI product coverage

Quality retains Windows/Ubuntu static, unit, integration and artifact checks. A separate Ubuntu job runs the existing browser suite with preinstalled Chrome and the disposable PostgreSQL smoke harness. It adds no browser download, model call, personal data or dependency to the application. The final quality gate requires both jobs to succeed.
