# Feature Scout Fix Wave 8 — Growth / onboarding (complete: 8/8)

> All 8 Growth/onboarding findings closed on `master` across two sittings (ONB-1/4 + USE-2/1-tag
> first, then the SHELL/ONB/USE tail). Baseline preserved end-to-end: `tsc` 0; **vitest 456/456**
> (451 baseline + 4 orgsim multi-leg + 1 init-sql parity for the new model); eslint 0; `next build` ✓.

## Commits

| Finding | Commit | What shipped |
|---|---|---|
| ONB-1 (Critical) | `156fd29` | Onboarding runs a **real** scan on the App path when the org has credits (route meters + refunds), else a **disclosed preview** (amber banner) — no 402 dead-end, no fabricated scores presented as live. |
| ONB-4 | `156fd29` | Collapsible "How maturity levels work" L1→L5 legend on the done state. |
| USE-2 | `c45736e` | `metric=score` badge variant ("N/100" with level glyph+colour) + a "score" chip in BadgeGenerator. |
| USE-1 (tag) | `c45736e` | `?ref=badge` on the badge click-through + generator snippet — README→report visits attributable. |
| ONB-3 | `cb75663` | A completed (non-error) scan row is now a Link to `/report/{owner}/{repo}?ref=onboarding` with a hover "view report →" — the number drills into the report that explains it. |
| SHELL-1 | `5be2995` | The per-repo report OG card renders the **real** score + level glyph/name + adoption/rigor + a 9-dim strip (getScanReportByCommit under the readable org, `runtime=nodejs`), with the static card as a never-fail fallback. |
| SHELL-2 | `00640b2` | Org dashboard gains `generateMetadata` + `opengraph-image.tsx` (fleet avg score, level, posture mix) — real numbers ONLY when `canReadOrg` (public org / a member's session); an unauthenticated unfurl degrades to a neutral card, so private aggregates never leak. |
| ONB-2 | `83132eb` | Resumable wizard: the inputs ({org, sourceLabel, sourceInstallId, selected[]}) persist to sessionStorage and rehydrate on mount (re-fetch repos, re-apply selection, land on the select step); a server "Welcome back → View dashboard" banner for viewers who've already scanned. |
| USE-1 (reach) | `0e8610c` | `BadgeImpression` tally (additive migration), bumped fire-and-forget per origin badge GET keyed by (repo, referer host); a "Badge reach" panel on /usage (impressions, embedding hosts, most-fetched badges) — honestly labelled a lower bound (camo/CDN cache). |

## What was fixed (the tail)

- **ONB-3 — Drill-in.** The payoff of a scan is the report; a finished row dead-ended on its score.
  It's now a link straight into that report (tagged `?ref=onboarding`).
- **SHELL-1 — A social card that sells.** The report unfurl showed only the repo name. It now draws
  the real score/level/dimensions when a scan exists, falling back to the static card on any miss or
  error so an unfurl can never break.
- **SHELL-2 — The fleet is shareable too.** Org pages had no metadata or OG image. Added both, gated
  so private fleet aggregates never reach an unauthenticated fetch (the unfurl gets a neutral card).
- **ONB-2 — Don't lose the user.** A refresh / auth bounce reset the wizard to step one. The inputs
  now survive in sessionStorage and rehydrate to the select step; returning users who already scanned
  get a "welcome back" jump to their dashboard.
- **USE-1 (reach) — Close the badge loop.** The acquisition tag shipped earlier; now a per-(repo,host)
  tally + a /usage "Badge reach" panel show where badges are embedded and how often they're fetched —
  with an explicit lower-bound caveat (proxy/CDN caching).

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `vitest run` | 456/456 (54 files) |
| `init-sql.test.ts` parity | 28/28 (new `BadgeImpression` model + table mirrored) |
| eslint (changed) | 0 errors |
| `next build` | ✓ (EXIT 0; both OG routes + /usage + /onboarding emitted) |

## Patterns reinforced

- **Disclose, don't fake / honest lower bounds** (ONB-1, USE-1): when a number is partial (preview
  scores, CDN-undercounted impressions), run the real thing when feasible and *label* the estimate —
  never present it as exact. The "Badge reach" panel says so on its face.
- **Gate derived public surfaces on the same authz as the page** (SHELL-2): the OG image / metadata
  reuse `canReadOrg`, which is false for an unauthenticated unfurl, so a private org degrades to a
  neutral card automatically — no separate visibility flag to keep in sync.
- **Never-fail public assets** (SHELL-1): a DB-backed OG image wraps its read and always has a static
  fallback, so an unfurl degrades rather than 500s.
- **Best-effort writes off the hot path** (USE-1): a fire-and-forget, error-swallowed tally on a
  CDN-fronted public endpoint adds no latency and can't break the response.
- **Rehydrate from inputs, not transient UI state** (ONB-2): persist the minimal inputs and rebuild
  live (re-fetch the repo list) rather than serializing volatile derived state that would restore broken.

## What remains (from the INDEX)

Stripe (CRED-1/CRED-3) · notifications/email (excluded by the user) · the SHELL mediums/low (manifest/PWA,
JSON-LD, sitemap badge route) · 49 mediums / 4 lows. Waves 1, 2, 5, 6, 7, 8 + the migrations session are done.
