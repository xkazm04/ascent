# Feature Scout Fix Wave 8 — Growth / onboarding (partial: 4/7)

> 4 findings closed on `master` (incl. the Critical ONB-1). 2 commits.
> Baseline preserved: `tsc` 0; **vitest 451/451**; eslint 0; `next build` ✓.

## Commits

| Finding | Commit | What shipped |
|---|---|---|
| ONB-1 (Critical) | `156fd29` | Onboarding no longer hardcodes mock — runs a **real** scan on the App path when the org has credits (route meters + refunds), else a **disclosed preview** (amber banner) so a credit-less org never 402-dead-ends |
| ONB-4 | `156fd29` | Collapsible "How maturity levels work" L1→L5 legend on the done state — scores land with meaning |
| USE-2 | `c45736e` | `metric=score` badge variant ("N/100" with level glyph+colour) + a "score" chip in BadgeGenerator |
| USE-1 | `c45736e` | `?ref=badge` on the badge click-through + generator snippet — report visits from a README badge are now attributable |

## What was fixed

- **ONB-1 (Critical) — Real first scan, honestly disclosed.** The single highest-stakes activation
  moment showed fabricated mock scores with no disclosure. Now: a `mock` flag is threaded through
  `ImportScanRequest`; on the App path WITH credits the onboarding scan is real (the import route
  already meters + refunds on failure); otherwise it's a clearly-labelled preview (amber "these are
  preview scores" banner). The public-handle funnel stays a preview (it can't meter). No 402 dead-end.
- **ONB-4 — Score interpretation.** A compact, collapsible level legend (reusing `LEVELS` +
  `LEVEL_GLYPH`/`LEVEL_CLASSES` + one-line blurbs) so a first-time user understands L1→L5.
- **USE-2 — Numeric badge.** The report's `overallScore` was computed and discarded for the badge;
  `?metric=score` now renders it. A "score" chip joins level/gate in the generator.
- **USE-1 — Badge attribution.** The previously-bare click-through href gains `?ref=badge`, so the
  README→report acquisition path is attributable in analytics/logs.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `vitest run` | 451/451 |
| eslint (changed) | 0 errors |
| `next build` | ✓ |

## Deferred (Wave 8 tail)

- **SHELL-1** (per-repo OG card renders the score) — needs a DB lookup inside the OG image route
  (`getScanReportByCommit` + a static fallback so unfurls never break) + `runtime = "nodejs"`.
- **SHELL-2** (org pages get `generateMetadata` + an OG image from `getOrgRollup`).
- **ONB-2** (wizard resumability via sessionStorage + a "welcome back" guard on the page).
- **USE-1 full analytics** — the `?ref=badge` tag shipped; a per-repo impression counter (storage) +
  a "Badge reach" panel on /usage is the remaining half (needs a counter table).

## Patterns reinforced

- **Disclose, don't fake** (ONB-1): when a surface must show estimated/mock data, run the real thing
  when feasible and *label* the estimate otherwise — never present mock numbers as live.
- **Surface data already computed** (USE-2): `overallScore` existed in the report and was dropped for
  the badge; a variant param exposes it with no new computation.

## What remains (from the INDEX)

Wave 8 tail (above) · Wave 5 tail (GOAL-2/3/6, SIM-2/4) · Stripe (CRED-1/CRED-3) · notifications/email
(excluded) · 49 mediums / 4 lows.
