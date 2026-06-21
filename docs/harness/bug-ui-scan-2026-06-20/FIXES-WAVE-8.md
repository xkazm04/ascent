# Fix Wave 8 — UX / SEO / observability / live (ascent, bug-ui-scan-2026-06-20)

> 8 findings closed in 6 atomic commits. Baseline preserved: tsc 0; tests 2414 → 2426 (+12, +1 test
> file); `next build` green. 0 regressions. **Final wave** of the run.
> Branch: `vibeman/bug-ui-scan-2026-06-20-fixes`.

## Commits

| Commit | Finding(s) | Sev | What changed |
|---|---|---|---|
| seo | app-shell-seo-error-pages #1, #2 | High×2 | `sitemap.ts` no longer advertises the robots-disallowed `/connect` + `/onboarding` (the two SEO contracts are now disjoint); `robots.ts` routes its base URL through the shared `publicBaseUrl()` so a zero-config Vercel deploy emits the Sitemap/host line. |
| digest | fleet-alerts-digests #1 | High | The weekly digest noise-filters regressers symmetrically with gainers, so a pure scan-jitter week no longer fires a misleading "Regressions" digest. |
| rate-limit | quotas-rate-limiting #1 | High | `rateLimitRequest` checks the per-IP cap first and skips the global-window charge for an already-rejected request, killing the single-IP global-budget-drain (DoS amplification). |
| observability | quotas-rate-limiting #2 | High | `recordQuotaEvent("rate_limit", …)` wired into `/api/scan`, `/api/scan/stream`, `/api/org/import` over-limit branches (was badge-only) — abuse on the costly paths is now visible. |
| war-room | live-war-room #1, #2 | High×2 | The read-only TV/shared wall now polls (visibility-gated `router.refresh`, interval cleared on unmount) instead of being a frozen snapshot; auto-relaunch is paused when the tab is hidden (Page Visibility) so an idle wall stops burning fleet scan credits. |
| briefing | executive-briefing #1 | High | The PDF download href + the share token both carry the active `?segment=` scope, so a reseller exports/shares the segment they're viewing, not the whole org. |

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `vitest run` | 2414 | **2426** (+12; +1 test file → 146) |
| `next build` | green | green |
| Regressions | — | none |

## Patterns added

37. **sitemap and robots are one contract — keep them disjoint.** Advertising a disallowed path
    produces crawl warnings. (seo #1)
38. **One base-URL resolver, every SEO surface.** robots duplicating the logic dropped the Sitemap
    line on a deploy variant. (seo #2)
39. **A noise gate must be symmetric.** Filtering gainers but not regressers still fires on jitter. (digest #1)
40. **Check the narrow (per-IP) limit before charging the shared (global) budget.** Otherwise one
    abuser drains everyone's budget. (rate-limit #1)
41. **Instrument the costly paths, not just the cheap one.** Observability wired only into the badge
    route blinded the scan/import trips. (observability #2)
42. **A "live" surface must refresh; a background one must stop spending.** Gate live polling + costly
    auto-actions on Page Visibility. (war-room #1/#2)
43. **Carry the active scope into every export/share URL.** Dropping `?segment=` ships a wrong-tenant
    deliverable. (briefing #1)

## Run complete — all 8 waves done
This was the last wave. See `INDEX.md` for the full triage and `FIXES-WAVES-1-3.md` / `FIXES-WAVE-4..8.md`
for the per-wave detail. Remaining open items are the Medium/Low tail per context (listed in each
wave's "Deferred" section) plus the explicitly deferred-with-cause items (database-client #1 withDb
migration; checkout #2 setOrgPlan; credits #3/#4 schema).
