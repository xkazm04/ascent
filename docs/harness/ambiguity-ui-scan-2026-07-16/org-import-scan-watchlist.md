# Org Import, Scan & Watchlist — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Import path ignores BYOM: charges platform credits and runs platform inference for orgs scanning on their own Bedrock
- **Severity**: High
- **Category**: edge-case-gap
- **File**: `src/app/api/org/import/route.ts:141` (also `:146`)
- **Scenario**: A BYOM org (own Bedrock, inference billed to its AWS account) runs a real-LLM import. `/api/org/scan` and `/api/cron/rescan` both resolve `isByomActive(org)` and exempt the org from metering, and the scan route passes `orgSlug: org` into `scanRepository` so `getProviderForOrg(opts.orgSlug)` selects the org's Bedrock. The import route does neither: `metered = !mock && org !== "public"` (line 146) has no `!byom` term, and `scanOpts` (line 141) is `{ token, mock }` / `{ noAmbientToken: true, mock }` with **no `orgSlug`** — so `scanRepository` resolves the provider for `undefined` and falls back to the platform provider.
- **Root cause**: BYOM was retrofitted onto the scan and cron routes ("explicit + future-proof", scan route line 64-66) but the third sibling with identical semantics was skipped; nothing records why import is different. Dropping `orgSlug` also bypasses the standing-decisions read (`decisionSlug = opts.decisionOrgSlug ?? opts.orgSlug` in scan.ts:276).
- **Impact**: A BYOM org importing 100 repos is double-billed in effect: platform credits are reserved per repo (or the run is truncated at balance 0 with `insufficient_credits` skips) while the inference that should have run on the org's own Bedrock runs on the platform's provider budget instead — the exact defect the cron comment (rescan route lines 108-113) says was fixed there.
- **Fix sketch**: Mirror the scan route: `const byom = await isByomActive(org).catch(() => false); const metered = !mock && org !== "public" && !byom;` and add `orgSlug: org` to both branches of `scanOpts`. One-line test: BYOM org + non-mock import reserves zero credits and `getProviderForOrg` receives the slug.

## 2. Cron treats a transient token-mint failure as a revoked installation — the whole org silently skips a full cadence
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/app/api/cron/rescan/route.ts:94` (mint at `:63-65`, settle at `:96`)
- **Scenario**: The pre-resolve loop mints one installation token per org; any failure (`getInstallationToken(...).catch(() => undefined)`) puts the org in `brokenInstallOrgs`. Every due repo of that org is then settled with `advanceToFullCadence` — for a `monthly` fleet that is a silent 30-day skip. But the mint can fail transiently: a GitHub App API blip, a 5xx, or a rate limit during that one cron pass.
- **Root cause**: The comment asserts "likely revoked/suspended" — a plausibility judgment encoded as a hard assumption, with no distinction between "revoked" (permanent, skip the cadence) and "GitHub had a bad minute" (retry soon). The failure path deliberately avoids the 6h `advanceScheduleAfterFailure` backoff, but the trade-off ("one transient outage costs monthly repos a whole month") is not recorded anywhere.
- **Impact**: One flaky mint during a daily cron makes an entire org's fleet vanish from scanning for its full cadence with only `skippedNoToken` in a JSON body nobody reads; `recordScanOutcome` writes "installation token unavailable" per repo, but the dashboard shows stale scores for up to a month with no operator alert.
- **Fix sketch**: Use `advanceScheduleAfterFailure` (6h backoff) instead of `advanceToFullCadence` for `brokenInstallOrgs` — it already exists, already wins over the lease, and self-heals a transient outage on the next pass while still keeping a genuinely-revoked org off the front of the queue. Alternatively, retry the mint once, or distinguish 401/404 (revoked → full cadence) from 5xx/429 (transient → backoff).

## 3. Import silently coerces an invalid `schedule` to "weekly", and recurring autoscans are opt-out defaults
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/app/api/org/import/route.ts:96-98`
- **Scenario**: `body.schedule && SCHEDULES.has(body.schedule) ? body.schedule : "weekly"` — a caller who sends `schedule: "biweekly"` (or `"Weekly"`, or a typo) gets **weekly** recurring, credit-spending autoscans with a 200/SSE success and no signal that the value was rejected. The sibling `/api/org/schedule` 400s on the same input (`route.ts:29-33`). Compounding it, `watch` defaults to `true` and `schedule` defaults to `"weekly"`, so a bare `{ org }` import enrolls up to 100 repos in weekly cron rescans — the header comment says "optionally marking them watched + scheduled" but the option is on by default.
- **Root cause**: Fallback-to-default was chosen over validate-and-reject for the same field two routes treat differently; the default-on recurring cost is a product decision that lives only in `?? true` / `"weekly"` literals.
- **Impact**: For a metered org, a one-time import quietly becomes a standing weekly credit drain across the whole imported set; a caller's explicit-but-misspelled cadence intent is silently rewritten. Seeding scripts and API consumers can't tell coercion happened.
- **Fix sketch**: Reject invalid `schedule` with 400 (parity with `/api/org/schedule`), or at minimum emit an SSE `notice` (`reason: "schedule_coerced"`). Document the watch/schedule defaults in the route header and in `send("progress", { stage: "found", ... })` (it already echoes `watch, schedule` — the client should render them).

## 4. Final `result.scanned` counts skipped repos as scanned — in-progress skips are invisible in the summary
- **Severity**: Medium
- **Category**: edge-case-gap
- **File**: `src/app/api/org/import/route.ts:228-230,307` (same shape in `src/app/api/org/scan/route.ts:132-135,195`)
- **Scenario**: Both bulk routes increment the `scanned`/`done` counter on the `in_progress` skip and the mid-run `insufficient_credits` skip, then report it as `result.scanned`. A run where every repo was claimed by a concurrent import/tab emits `result: { scanned: N, total: N, skippedForCredits: 0 }` — a perfect-looking summary in which zero scans happened. `skippedForCredits` captures credit skips, but claim-collision skips are counted **as scans** and appear in no skip field.
- **Root cause**: One variable serves two roles: the progress denominator index ("processed so far") and the outcome metric ("successfully scanned"). The claim-skip path was added later and reused the index increment without adding an outcome bucket.
- **Impact**: The SSE `result` — the one machine-readable summary scripts and the seeding flow key off — overstates work done. `OrgScanButton` partially compensates by counting per-repo `skipped` events client-side, but `RepoRescanButton`'s single-repo case and any API consumer reading only `result` get "scanned" for a repo that was never scanned.
- **Fix sketch**: Track `skippedInProgress` (mirroring `skippedForCredits`), stop incrementing the success metric on skip paths (keep a separate `processed` index for progress events), and emit `result: { scanned, skippedForCredits, skippedInProgress, total }`.

## 5. Disabled-control hints are title-only (unreachable for keyboard/AT users) and ScheduleSelect's error color bypasses the design token
- **Severity**: Low
- **Category**: a11y
- **File**: `src/components/org/repositories/RepoRescanButton.tsx:81` (also `ScheduleSelect.tsx:68`, `shared/OrgScanButton.tsx:92`)
- **Scenario**: All three org controls explain *why* they're disabled ("GitHub App isn't configured, so the route would 503"; "Watch repositories on Connect to enable scanning") exclusively via `title` on a `disabled` element. Disabled elements are removed from the tab order and `title` is mouse-hover-only, so keyboard and screen-reader users get a dead control with no reason. Separately, `ScheduleSelect.tsx:79` renders its error in `text-red-400` while every sibling in this context uses the semantic tokens (`text-danger` / `text-warn` in RepoRescanButton:90 and OrgScanButton:130-139), and it has no live-region semantics (OrgScanButton wraps its status in `role="status" aria-live="polite"`; ScheduleSelect/RepoRescanButton errors are silent to AT).
- **Root cause**: The `disabled + title` pattern was copied across the leaderboard controls (RepoRescanButton's header comment says it deliberately mirrors ScheduleSelect's presentation), propagating the gap; `text-red-400` predates or ignores the token pass applied to its siblings.
- **Impact**: AT and keyboard users can't discover why Rescan/cadence controls are inert or that a save failed; error red drifts from the theme's danger color in dark/light adjustments.
- **Fix sketch**: Use `aria-disabled="true"` + a no-op click (or an adjacent visible hint / `aria-describedby` on a focusable wrapper) instead of `disabled` + `title`; swap `text-red-400` → `text-danger`; add `role="status"` (or `role="alert"` for the rollback error) to the inline outcome `<span>`s in ScheduleSelect and RepoRescanButton.
