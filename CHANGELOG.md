# Changelog

All notable changes to Ascent are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project is pre-1.0 and not yet
versioned for release.

## [Unreleased]

### Added
- **License** — Business Source License 1.1 (`LICENSE`), with an Additional Use Grant keeping the
  GitHub Action + maturity badge usable. README License section.
- **Prepaid scan credits** — `Organization.scanCredits` + an append-only `CreditLedger`, an entitlement
  gate on every private-scan path (`/api/scan`, `/api/org/scan`, `/api/org/import`, `/api/cron/rescan`),
  and `GET /api/org/credits` + owner-gated grant endpoint. Public/mock scans stay free. See
  [`docs/BILLING.md`](./docs/BILLING.md).
- **RBAC** — `Membership.role` is now enforced (`requireOrgRole`); installation-owners are seeded as
  `owner`; owner-gated `/api/org/members`.
- **PDF export** — server-rendered report PDF (`GET /api/report/pdf`) + an export action on the report.
- **Reliability** — `global-error`, root `not-found`, and per-segment error boundaries (org + report).
- **SEO** — `opengraph-image` (site + per-report), `robots.ts`, `sitemap.ts`, per-page metadata, theme color.
- **Tooling** — pinned `vitest` test gate, committed Prisma migrations (`db:deploy`), `CONTRIBUTING.md`,
  `SECURITY.md`, `.env.example` completeness, `.nvmrc` + `engines`.

### Fixed
- **Security** — closed cross-tenant IDORs on scan-token minting and org read/write routes; added
  per-IP + global rate limiting to the scan/import funnels.
- **Accessibility** — report tabs now follow the WAI-ARIA tabs pattern (roving tabindex, arrow keys,
  tab↔panel wiring); lifted sub-AA secondary text contrast; reduced-motion now disables looping
  pulse/spin; promoted the report repo title to `<h1>`.
- **Correctness** — dimension count derives from the model everywhere (was a hardcoded "7"/"8" in
  several places; the model defines 9).
