# Maintenance security dependency review

- Date: 2026-09-05
- Scope: qs security patch and an external maintenance scanner
- Classification: routine review; no new product capability

## qs 6.16.0

The exact registry archive fixes [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx)
and [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g).
It is BSD-3-Clause, requires Node >=0.6, and uses existing es-define-property and
side-channel packages. No lifecycle or new dependency admission is required.

- Archive: https://registry.npmjs.org/qs/-/qs-6.16.0.tgz
- SHA-256: f7a1bfc96c3a0c1172f1f3ef3c280f5ce8054841922e715f0d686da62d7beba4
- SHA-512 is verified against registry integrity and recorded in the release SPDX.
- Full legal text: [BSD license](../licenses/npm/qs@6.16.0/LICENSE.md).

## Trivy 0.74.0

Use the [official release](https://github.com/aquasecurity/trivy/releases/tag/v0.74.0)
and its [Apache-2.0 source license](https://github.com/aquasecurity/trivy/blob/v0.74.0/LICENSE).
The scanner is an external verification executable, not linked, copied into
source modules, or shipped in the application image. The workflow reuses the two
already-admitted GitHub Actions; it does not add a scanner action or use a mutable latest tag.

| Official release archive        | SHA-256 verified from release asset metadata                     |
| ------------------------------- | ---------------------------------------------------------------- |
| trivy_0.74.0_Linux-64bit.tar.gz | 2ae6fe3ee734b7fdf11335663e18c75ea12dccc76062f09f164a3b0f8be4371a |
| trivy_0.74.0_windows-64bit.zip  | 94c40e0696e4b907a74b7b2e1438d5d72ebaca83115817407f568a002d520842 |

Checks are read-only, scan a data-free runtime image, and do not update packages,
write credentials or deploy. Network/registry failures remain failed checks.
Refresh this review when the scanner identity, artifact or source changes.

[GitHub scheduling limitations](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
require checking actual run recency during low-activity periods.

## Runtime image findings

Trivy completed against the data-free v0.2.0 runtime on 2026-09-05 with exit 1:
56 HIGH/CRITICAL package rows, 18 distinct CVEs, no fixed Bookworm version in the
report, and zero Node HIGH/CRITICAL findings. The first database mirror timed
out; the official ghcr.io/aquasecurity/trivy-db:2 retry succeeded. No ignore file,
ignore-unfixed flag or successful exit override was introduced. Full scanner
output and the exact deployed-image identity remain in the external operations
record. Classification is [DH-013](../../deferred-hardening-memo.md#dh-013-base-image-scanner-findings-outside-the-current-runtime-path).

| Group                | CVEs                                                                                                                         | Current-path assessment                                                                                                                                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| util-linux           | CVE-2026-53613, CVE-2026-76642, CVE-2026-78408, CVE-2026-78409, CVE-2026-78410                                               | No mount/nsenter subprocess, privileged mount authority or configured fstab user mounts. See the [Debian mount record](https://security-tracker.debian.org/tracker/CVE-2026-53613).                                                                                                               |
| gzip, acl, ncurses   | CVE-2026-41992, CVE-2026-54369, CVE-2025-69720                                                                               | No gzip CLI, privileged ACL path operations or infocmp invocation. Debian tracks [gzip](https://security-tracker.debian.org/tracker/CVE-2026-41992), [acl](https://security-tracker.debian.org/tracker/CVE-2026-54369) and [ncurses](https://security-tracker.debian.org/tracker/CVE-2025-69720). |
| systemd              | CVE-2026-16742                                                                                                               | systemd-homed is absent; the [affected service](https://security-tracker.debian.org/tracker/CVE-2026-16742) is not the container entrypoint.                                                                                                                                                      |
| Perl and its modules | CVE-2026-13221, CVE-2026-42496, CVE-2026-8376, CVE-2026-42497, CVE-2026-48962, CVE-2026-57432, CVE-2026-57433, CVE-2026-9538 | No Perl execution, regular-expression compilation, archive extraction or Perl deserialization path. The image is x64; [CVE-2026-8376](https://security-tracker.debian.org/tracker/CVE-2026-8376) additionally requires a 32-bit Perl build.                                                       |
| zlib                 | CVE-2023-45853                                                                                                               | [Debian's notes](https://security-tracker.debian.org/tracker/CVE-2023-45853) state that affected contrib/minizip code is not built into the Bookworm binary packages; no MiniZip executable is present.                                                                                           |

These are bounded reachability conclusions for the current Node application and
Compose restrictions, not proof against arbitrary future code execution. Keep
weekly raw scans failed while findings remain, and review new findings, fixed
versions and changes to this runtime boundary.
