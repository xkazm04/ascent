# Security Policy

Ascent scans repositories and, in its Phase 2 features, mints short-lived GitHub App installation
tokens and stores per-tenant maturity data. We take security seriously and appreciate responsible
disclosure.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately via GitHub's **private vulnerability reporting**:

1. Go to the repository's **Security** tab → **Report a vulnerability**.
2. Describe the issue, the affected version/commit, and a minimal reproduction.

If private reporting is unavailable to you, open a GitHub issue that contains **only** a request for
a security contact (no details), and a maintainer will follow up with a private channel.

Please include, where possible:

- The component and route/file involved (e.g. `/api/scan`, `src/lib/authz.ts`).
- Impact (data exposure, token misuse, cost/DoS, auth bypass) and any cross-tenant implications.
- Steps to reproduce or a proof of concept.

## Scope

In scope: authentication/authorization (session crypto, `requireOrgAccess`/`canReadOrg`, the
cross-tenant model), GitHub App token handling, webhook signature verification, the scan/import
cost-control limits, and any data exposure across organizations.

Out of scope: vulnerabilities in third-party dependencies (report upstream), findings that require a
compromised host or a self-supplied malicious `DATABASE_URL`/secrets, and rate-limit notes on a
single self-hosted instance (the in-memory limiter is a per-instance cost backstop by design).

## Response expectations

- **Acknowledgement:** we aim to confirm receipt within a few business days.
- **Triage & fix:** severity-dependent; we'll keep you updated and credit you in the release notes
  unless you prefer to remain anonymous.
- **Disclosure:** please give us a reasonable window to ship a fix before any public disclosure.

## Supported versions

Ascent is pre-1.0; security fixes land on the latest `master`. Pin a commit and update forward to
receive fixes.
