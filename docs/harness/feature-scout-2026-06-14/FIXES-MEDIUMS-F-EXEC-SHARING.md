# Feature Scout Fix — Mediums Wave F · Exec briefing, sharing & exports (complete: 6/6)

> The reporting/sharing wave — comparison, white-label, a no-account share link, CSV/PDF exports, and a
> fleet OG card. 2 additive migrations (briefing achieved… no — branding + nothing else). Baseline
> preserved: `tsc` 0; **vitest 458/458**; eslint 0; `next build` ✓ (EXIT 0).

## Commits

| Finding | Commit | What shipped |
|---|---|---|
| PPL #6 — delivery/contributor CSV | `1e073e5` | `GET /api/org/export?org=&kind=contributors\|delivery[&segment=][&format=csv]` + "Export CSV" links on both tabs (segment-aware, read-gated). |
| MAP #5 — fleet OG snapshot | `1c7bc9a` | `launch/opengraph-image.tsx` renders a branded constellation (real `starPosition` layout) + `generateMetadata`. Brand-level (an unfurl has no session) — not a specific fleet. |
| EXEC #4 — period comparison | `50da237` | `buildExecBriefing` fetches the prior equal-length window → a `priorPeriod` block (headline + per-dim deltas); rendered on the page, PDF, and Copy-for-LLM markdown. |
| SEC #6 — security PDF | `d402b4e` | `SecurityDocument` + `GET /api/org/security/pdf` (mirrors the briefing PDF) + a "Download PDF" button on the Security tab. |
| EXEC #6 — shareable briefing link | `68ee210` | `briefing-share.ts` HMAC capability token (reuses the WAR-4 pattern) + owner-gated mint route + `/share/briefing/[token]` read-only render (noindex) + an owner "Share read-only link" button. |
| EXEC #5 — white-label briefing | `1d7eef2` | `Organization.brandName/brandColor/logoUrl` (migration) + `getOrgBranding/setOrgBranding`; `BriefingDocument` brands accent/kicker/logo (unbranded-render fallback if a logo fails); owner+enterprise settings form. |

## What was fixed

- **PPL #6 — exports.** Analytics tables were screenshot-only; contributors → per-person rows, delivery
  → per-repo governance rows, both as CSV, segment-scoped.
- **MAP #5 — shareable entrance.** `/launch` now has a constellation social card (safe, data-free).
- **EXEC #4 — comparison, not a number.** The briefing reads "vs previous period" across headline +
  dimensions, end-state against the equal-length window before it.
- **SEC #6 — auditor-ready posture.** The Security tab exports a board/auditor PDF from the same source.
- **EXEC #6 — share without an account.** A signed, expiring, read-only briefing link for board members.
- **EXEC #5 — white-label.** Enterprise orgs brand the downloaded briefing PDF (name/accent/logo).

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `vitest run` | 458/458 (54 files) |
| `init-sql.test.ts` parity | 30/30 (branding = additive columns on Organization, no new table) |
| eslint (changed) | 0 errors |
| `next build` | ✓ EXIT 0 — export / security-pdf / branding / share-briefing / launch-OG routes emitted |

## Patterns reinforced

- **Reuse the signed-capability pattern** (EXEC #6): the WAR-4 HMAC token approach generalizes to any
  "read-only, no-account, expiring" share — a token carrying `{org, window, exp}`, verified at a public
  route, no table.
- **Mirror the export/PDF scaffolds** (PPL #6, SEC #6): a new CSV/PDF is the established `csvField`/
  `safeFilenameSlug` or `renderToBuffer(Document)` scaffold pointed at a different `build*` source.
- **End-state vs prior window** (EXEC #4): the previous period's end is this period's start, so a single
  extra windowed rollup yields a per-dimension "vs previous period" with no schema change.
- **Validate-on-write so the artifact can't break** (EXEC #5): hex/https validated when branding is set,
  plus an unbranded-render fallback in the PDF route — a bad logo degrades, never 500s.
- **Branded public surfaces stay data-free without a session** (MAP #5): the OG renders brand chrome,
  not the viewer's fleet, because an unfurl carries no auth.

## What remains (from the INDEX)

All eight medium waves (A–H) are now complete. Remaining: the **4 lows**, and the deferred
Stripe-/email-dependent mediums (credit-pack catalog, paid quota tier, email receipts) — Stripe
(CRED-1/CRED-3) + notifications/email stay excluded per the user.
