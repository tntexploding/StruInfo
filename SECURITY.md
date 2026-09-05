# Security Policy

## Supported version

The current private single-user maintenance line is `0.2.x`. Security fixes are
applied to its latest release. The previous `0.1.0` remains available as a
historical release.

The weekly and manually runnable `Maintenance security` workflow audits production
packages and the built runtime image. Failed checks require triage; they do not
authorize automatic dependency updates or deployment. Operational checks and
notifications for a private instance remain in its external maintenance setup.

## Deployment boundary

StruInfo is not a public multi-user API. The application container must remain
bound to the host loopback or a private container network. Remote access must be
protected by an HTTPS reverse proxy, VPN, or SSH tunnel. The supplied Caddy
example applies HTTPS and single-user authentication to the complete Web and API
origin; do not expose port 3000 directly to the Internet.

Runtime configuration, database credentials, OpenAI keys, personal documents,
Blob data, preferences, exports and backups belong outside Git and outside the
container image.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not
open a public issue containing credentials, personal documents, deployment
addresses or an exploit against an active private instance.
