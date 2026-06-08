# Feature Scout Fix Wave 7 — Export + alerts + compliance

> 2 of 6 findings closed in 2 atomic commits — the two cleanest, verifiable, low-collision ones.
> 4 deferred with cause. Baseline preserved: tsc 0 → 0 · eslint clean · `next build` green.

## Why these two

RPT-3 (trend CSV) and ORGS-4 (weekly digest) are the export/alerts findings that are backend-clean,
fully verifiable, and don't touch the multi-surface fleet UI the concurrent UI run is editing. The
other four are UI-export across several pages (ORGD-2, PERS-4), a new dashboard view (ORGD-4), or new
audit infrastructure (PERS-3).

## Commits (shipped)

| # | Commit | Finding | Sev | What |
|---|--------|---------|-----|------|
| 1 | `a1025c2` | RPT-3 | High | export scan history as CSV |
| 2 | `adcfbf1` | ORGS-4 | High | scheduled weekly fleet digest |

## What was fixed

1. **RPT-3** — `/api/history` was JSON-only, so the trend (the "show my boss progress" artifact)
   couldn't leave the page. Added `?format=csv` emitting per-scan rows (scannedAt, overall, level,
   levelName, engine, D1..D9) oldest→newest as a file download (RFC-4180 quoting + injection-safe
   filename), forcing dimension inclusion for the export, plus an "Export CSV ↓" link on /trends.
2. **ORGS-4** — The only outbound notification was a per-repo regression alert; the rich org aggregates
   were pull-only, so a leader who didn't open the app saw nothing unless something broke. Added
   `GET /api/cron/digest` (registered weekly in vercel.json, CRON_SECRET-guarded): per org with watched
   repos it summarizes the week via the existing rollup/movers/recommendation queries, builds a pure
   Block-Kit `buildFleetDigestMessage` (sibling of `buildRegressionMessage`), and POSTs through the
   existing `dispatchAlert` sink. No-op without a DB or `ALERT_WEBHOOK_URL`.

## Deferred (with cause)

- **ORGD-2 (CSV export from org fleet views)** — needs "Export CSV" links across the repositories /
  contributors / delivery pages (multi-surface UI the concurrent run is editing) + a new export route.
- **PERS-4 (audit/usage/history export)** — overlaps RPT-3 (history) + the existing /api/usage CSV;
  the remaining piece (audit-log export) pairs with the audit UI. Deferred as a set.
- **ORGD-4 (surface regressions in the dashboard)** — a new filtered "Regressions" view + linking the
  overview pill — `org/[slug]` UI (collision).
- **PERS-3 (actor-attributed audit trail)** — needs new infra: `db/users.ts` (`ensureUser`/
  `ensureMembership`) wired into the auth/session path so `AuditLog.actorId` resolves to a real user +
  role. Security-sensitive; its own focused session.

## Verification (before → after)

| Gate | Result |
|------|--------|
| `tsc --noEmit` | 0 → 0 errors |
| `eslint` (6 changed files) | 0 errors, 0 warnings |
| `next build` | ✅ all routes compiled (incl. the new /api/cron/digest) |
| live digest dispatch | NOT exercised (no ALERT_WEBHOOK_URL / live DB here) — verified by tsc + build; dispatchAlert + the message builder are the existing, unit-tested pattern |

## Patterns established (catalogue addition, item 14)

14. **Push channel from pull-only aggregates** — when rich data is only ever fetched by a human opening
    a dashboard, add a scheduled cron that runs the SAME aggregate queries and pushes a summary through
    an existing alert sink. Keep the message builder pure (sibling of the existing one) and gate the
    whole thing on the sink being configured, so it's a clean no-op by default.

## What remains

Wave-7 leftovers: ORGD-2, PERS-4, ORGD-4, PERS-3 (above). This was the last untouched wave; everything
else outstanding is the documented cross-wave deferrals + mediums/lows, per the INDEX.
