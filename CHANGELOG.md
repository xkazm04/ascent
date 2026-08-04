# Changelog

All notable changes to Ascent are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project is pre-1.0 and not yet
versioned for release.

## [Unreleased]

### Added
- **Legal & feedback** — `/privacy` and `/terms` pages, and a footer feedback channel.
- **Observability** — Sentry error reporting + LightTrack first-party analytics (operator
  `/api/kpi` route + `landing_view` counter); security headers.
- **Deploy hardening** — migrations now run on every Vercel deploy
  (`vercel.json` `buildCommand`: `db:deploy` before `build`); post-deploy `@smoke` Playwright
  workflow; a Deploy & rollback runbook in the README.
- **Evidence ledger (foundation)** — AI-attributed changes persisted as auditable rows, and the
  audit-log HMAC is now verified on read, not just signed on write.
- **Org overview** — the org front door renders a real front page again: fleet scalars without
  buying a full rollup, a personal-tier entry point in the header, an explicit "mock score"
  disclosure, and a note on what the period selector does not govern.
- **Roadmap tracker** — dismissing an item becomes evidence the next scan hears; marking an item
  done asks "did the score move?"; tracked state survives a rewording; the sandbox plan persists;
  the org backlog no longer reads the fleet's whole history.
- **Provider integrations** — hardened public ingest endpoint, per-org ingest token rotation
  (with its own audit action), honest "what actually landed" ingest reports, and the ingest token
  is no longer printed in cleartext.
- **Org memory & skills** — value-ranked recall surface, reflect working in production, an
  untrusted-content boundary on the memory prompts, and honest skill-usage signals with a capped
  outcomes fan-out.
- **Repositories** — one-pass tech-stack summaries with surfaced stack-insight confidence.
- **KPIs** — adopted KPIs measured from data already stored.
- **Marketing** — large-screen reading scale and the `/about-org` organization deck.

### Changed
- **Org dashboards** — consolidated to one route with `?tab=` navigation, staggered loading.
- **Positioning (2026-08-04)** — first market release launches on the shipped trio (evidence-backed
  briefing, deterministic CI gate, fleet intelligence); GOLDEN-TRIO T1/T2 marked roadmap.

### Fixed (since 2026-07-28)
- **Security** — closed high-severity access-control and money-path (billing) gaps; untrusted-content
  boundary + canonical time zone + producer-level privacy floors in scoring/org; follow-up migrations
  authored for the deferred schema fixes.
- **Honesty passes** — charts and exports no longer claim more than the data supports; empty states,
  reachable actions, and accessibility the tests can prove; growth surfaces only the features the
  data actually supports (and refuses the rest).
- **Landing** — star coordinates quantized so SSR and CSR agree.

### Added (2026-07-28 and earlier)
- **License** — Business Source License 1.1 (`LICENSE`), with an Additional Use Grant keeping the
  GitHub Action + maturity badge usable. README License section.
- **Prepaid scan credits** — `Organization.scanCredits` + an append-only `CreditLedger`, an entitlement
  gate on every private-scan path (`/api/scan`, `/api/org/scan`, `/api/org/import`, `/api/cron/rescan`),
  and `GET /api/org/credits` + owner-gated grant endpoint. Public/mock scans stay free. See
  [`docs/features/billing/billing.md`](./docs/features/billing/billing.md).
- **RBAC** — `Membership.role` is now enforced (`requireOrgRole`); installation-owners are seeded as
  `owner`; owner-gated `/api/org/members`.
- **PDF export** — server-rendered report PDF (`GET /api/report/pdf`) + an export action on the report.
- **Reliability** — `global-error`, root `not-found`, and per-segment error boundaries (org + report).
- **SEO** — `opengraph-image` (site + per-report), `robots.ts`, `sitemap.ts`, per-page metadata, theme color.
- **Tooling** — pinned `vitest` test gate, committed Prisma migrations (`db:deploy`), `CONTRIBUTING.md`,
  `SECURITY.md`, `.env.example` completeness, `.nvmrc` + `engines`.

### Fixed (2026-07-28 and earlier)
- **Security** — closed cross-tenant IDORs on scan-token minting and org read/write routes; added
  per-IP + global rate limiting to the scan/import funnels.
- **Accessibility** — report tabs now follow the WAI-ARIA tabs pattern (roving tabindex, arrow keys,
  tab↔panel wiring); lifted sub-AA secondary text contrast; reduced-motion now disables looping
  pulse/spin; promoted the report repo title to `<h1>`.
- **Correctness** — dimension count derives from the model everywhere (was a hardcoded "7"/"8" in
  several places; the model defines 9).
