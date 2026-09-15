# Maintenance security repair

- Date: 2026-09-15
- Trigger: owner-reported GitHub Actions failures
- Scope: existing production dependency and Node base-image updates

The failed scheduled runs on September 7 and 14 and the September 5 manual run
are Maintenance security runs. The latest main-branch Quality Windows/Ubuntu
matrix passed. The September 14 dependency audit reports four Multer advisories;
the image scan reports those packages plus Debian base findings.

## Multer 2.3.0

The exact override updates Multer 2.2.0 to 2.3.0 while retaining Nest 11 and all
existing transitive versions. The official advisories identify the fixed version:
[multipart parsing](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm),
[aborted uploads](https://github.com/advisories/GHSA-qfvm-cv95-jqjf),
[field indices](https://github.com/advisories/GHSA-535w-7cp7-47q4) and
[field assignment](https://github.com/advisories/GHSA-qvfw-j98x-7q72).

Registry archive: <https://registry.npmjs.org/multer/-/multer-2.3.0.tgz>.
Its SHA-512 matches the registry and lock integrity; computed SHA-256 is
`a8810897a9443e32de583bacfa8fd413483b973b5c5dfc09726a5405583c0969`.
The archive retains MIT legal text, no NOTICE or install lifecycle, and the
same four dependency ranges. The license and SPDX inventory have been updated.
`pnpm audit --prod --audit-level low` passes with no known vulnerabilities.

## Runtime base

Both Docker stages now use the official Node 24 Bookworm Slim manifest
`sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553`.
The linux/amd64 image contains Node 24.21.0 and identifies official source commit
`93a7bafc324a85ac1ee461604cff87cffacb6d7a` in nodejs/docker-node.
This retains the operating-system family, application entrypoint and runtime
restrictions. npm/Corepack/Yarn remain removed from the final image.

The refreshed Node base still contains PCRE2 10.42-1. The final stage therefore
installs the signed Debian security package `libpcre2-8-0=10.42-1+deb12u1`, which
fixes [CVE-2026-86145](https://security-tracker.debian.org/tracker/CVE-2026-86145)
and [CVE-2026-89161](https://security-tracker.debian.org/tracker/CVE-2026-89161).
No other OS package is upgraded by this command; apt lists are removed.

Final Trivy 0.74.0 scan with the September 15 database finds 0 Node package
HIGH/CRITICAL findings and 56 Debian rows across the same 18 CVEs already
reviewed in DH-013; none has a fixed Bookworm package in the report. The two
PCRE2 findings are gone. The raw HIGH/CRITICAL gate therefore remains failing
for the reviewed upstream backlog, rather than claiming a zero-finding image.

The existing raw-scan failure policy and DH-013 remain in effect. No ignore
rules, severity reduction, forced-success exit or OS migration is introduced
to hide unresolved upstream findings. Detailed data-free build and scan logs
remain in the external operations directory. This repair is not a claim of
zero container vulnerabilities or completed remote CI before publication.
