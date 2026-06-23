# Code Refactor — Fleet Alerts & Digests
> Context group: Org Scanning & Fleet Rollups
> Total: 3 findings (Critical: 0, High: 1, Medium: 1, Low: 1)

The context is in good shape: every export in `alerts.ts` and `db/org-alerts.ts` is referenced (most of the message builders are consumed by the sibling `src/lib/scan-alerts.ts`, the per-repo dispatch path, plus the two in-scope routes and their tests). No dead code, no commented-out blocks, no stray `console.log`, no stale TODOs. The findings below are about *duplication that can drift* and one inline message that breaks the established builder pattern.

## 1. Regressers noise-filter is computed twice in the digest route (drift-prone, self-documented "keep in sync")
- **Severity**: High
- **Category**: duplication
- **File**: src/app/api/cron/digest/route.ts:86, 109
- **Scenario**: The same expression `(movers?.regressers ?? []).filter((m) => !isWithinNoise(m.dOverall))` appears twice in the same `for` body: once feeding the `digestHasSignal` movement-gate (`regressions:` at line 86) and once building the rendered `regressers:` list (line 109, then `.slice(0,3).map(...)`). The two ALERTS #1 comments (lines 84-85 and 107-108) explicitly say the second copy must "mirror the signal gate above" — i.e. the code itself documents that these two sites have to be edited in lockstep.
- **Root cause**: The noise-symmetry fix (ALERTS #1) was applied at both the gate and the render site independently rather than computing the filtered set once. The "must mirror" comment is the tell that a shared value was wanted but not extracted.
- **Impact**: A maintainer changing the noise predicate (e.g. switching to `classifyDelta`, or tightening the band) at one site and not the other re-opens exactly the bug ALERTS #1 closed: the gate fires but lists nothing under "Regressions:", or vice-versa. This is a live bug-source guarded only by a comment.
- **Fix sketch**: Hoist once inside the loop, before the `digestHasSignal` call: `const regressersBeyondNoise = (movers?.regressers ?? []).filter((m) => !isWithinNoise(m.dOverall));`. Use `regressersBeyondNoise.length` for the gate's `regressions:` field, and `regressersBeyondNoise.slice(0, 3).map((m) => ({ name: m.name, delta: m.dOverall }))` for the message's `regressers:`. Behavior-preserving (identical values), and the "must mirror" hazard disappears because there is one source. Optionally do the same for the gainers expression (line 87 filters for the gate; line 105 slices the *unfiltered* list — note these intentionally differ, so only consolidate if that asymmetry is confirmed intended; the regressers dup is the clean, safe one).

## 2. Test-alert message is hand-built inline instead of via an `alerts.ts` builder
- **Severity**: Medium
- **Category**: structure
- **File**: src/app/api/org/alerts/route.ts:64-77
- **Scenario**: The `test: true` branch constructs an `AlertMessage` by hand, repeating the headline+body string verbatim in two places — once as the plain-text `text` and again inside `blocks[0].text.text` ("✅ Ascent test alert for {org}\nIf you can read this in your channel, alert routing works..."). Every other alert in this context (`buildRegressionMessage`, `buildFleetDigestMessage`, `buildLowCreditsMessage`) is produced by a pure builder in `src/lib/alerts.ts`; the test message is the lone exception that inlines Block-Kit assembly into an API route.
- **Root cause**: The test-send was added to the route to confirm delivery and the sample payload was the smallest thing that worked, so it never got a builder like its three siblings.
- **Impact**: The headline string is duplicated within the route (edit one, forget the other → text and card disagree); Block-Kit shape knowledge leaks into the HTTP layer instead of living with the other message builders; and the test message can't be unit-tested the way the other builders are in `alerts.test.ts`.
- **Fix sketch**: Add `buildTestAlertMessage(org: string): AlertMessage` to `src/lib/alerts.ts` (pure, same shape as `buildLowCreditsMessage`), have it compute the headline/body once and reuse it for both `text` and the single `section` block. Import it in `route.ts` and replace the inline `sample` object with `buildTestAlertMessage(body.org)`. Behavior-preserving; removes the verbatim string repetition and lets the message join the unit-tested builder family.

## 3. `win.end: null` is an untyped inline literal where a typed window is expected
- **Severity**: Low
- **Category**: cleanup
- **File**: src/app/api/cron/digest/route.ts:50
- **Scenario**: `const win = { start: new Date(...), end: null };` is an ad-hoc object literal passed to `getOrgRollup`, `getOrgMovers`, etc. Its inferred type is `{ start: Date; end: null }`, which relies on those consumers accepting `null` for `end` rather than an explicit shared window type.
- **Root cause**: The window was inlined at the one call site that needed it; no named type was introduced because there is only one producer.
- **Impact**: Minor — readability and a slightly fragile inferred type (`end: null` rather than `Date | null`). Not a behavior issue; flagged only as cosmetic cleanup.
- **Fix sketch**: If the rollup helpers already export a window type, annotate `win` with it (`const win: <WindowType> = { start: ..., end: null }`) so the literal conforms to the documented contract; otherwise leave as-is. Strictly optional — no consolidation across files is warranted for a single call site.
