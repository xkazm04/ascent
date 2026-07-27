# Usage Metering & Public Badge — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Gate badge snippet evaluates an undisclosed default policy the user never chose
- **Severity**: High
- **Category**: undocumented-assumption
- **File**: `src/components/badge/BadgeGenerator.tsx:51` (and `src/app/api/badge/[owner]/[repo]/route.ts:356`)
- **Scenario**: Picking the "gate" kind in the generator emits only `?gate=1`. The route then evaluates `policyFromParams(searchParams, report.archetype)` with no params set, i.e. the archetype-dependent `defaultGatePolicy` — a policy the badge author never saw or chose. The generator UI offers no min-level (or any policy) control and never states what "pass" means, while the CI section on the same page (`src/app/badge/page.tsx:11`) explicitly demonstrates `min-level: L3`, implying policies are a thing you pick. `policyFromParams` already accepts `min_level`, `min_overall`, `no_ungoverned`, etc. — the API supports it; only the generator hides it.
- **Root cause**: The generator wraps only the three cosmetic knobs (kind/style/format); the semantic knob (the policy) was left to the archetype default without recording that decision anywhere user-visible.
- **Impact**: A README can carry a green "✓ pass" gate badge whose criteria the maintainer can't state and which silently changes if the repo's detected archetype (and thus its default policy) changes — undermining exactly the "honest verdict" framing the route works hard for elsewhere (demo suffix, glyphs, private gating).
- **Fix sketch**: Add a min-level selector (L1–L5, default L3 to match the CI snippet) to the generator that appends `min_level=<Lx>` to the gate URL, and render one line under the preview: "Pass means: minimum overall level L3" (reuse `describeGatePolicy` for the resolved policy text).

## 2. Usage trend chart is invisible to keyboard, touch, and screen-reader users
- **Severity**: Medium
- **Category**: a11y
- **File**: `src/components/usage/UsageTrend.tsx:65-91`
- **Scenario**: The per-day values are exposed only through `title=` attributes on plain `<div>`s (`cursor-help`). `title` tooltips require a hovering mouse: they never fire on touch devices, the divs are not focusable so keyboard users can't reach them, and screen readers get a stream of unlabeled presentational divs — there is no `role="img"`, no aria summary, and no text alternative for the series. The file's own header comment claims "inline SVG (same approach as the trends/delivery charts)" but the markup is divs, so whatever a11y affordances the SVG charts carry didn't come along.
- **Root cause**: Hover-only affordance chosen as the sole data channel; no non-visual representation was added, and the stale "SVG" comment hid the divergence from the sibling charts.
- **Impact**: On a billing page, the day-by-day billable numbers — the data users reconcile invoices against — are unreachable for AT/keyboard/touch users; WCAG 1.1.1/2.1.1 gaps on a core dashboard.
- **Fix sketch**: Wrap the bar strip in `role="img"` with an `aria-label` summary ("Daily scans, last N days: X billable, Y free; peak D"), add a visually-hidden `<table>` (date/billable/free) as the text alternative, and fix or delete the "inline SVG" comment. The Export CSV link already exists as a data escape hatch — reference it from the sr-only text.

## 3. Trend chart degenerates at the windows the API deliberately allows (365d)
- **Severity**: Medium
- **Category**: edge-case-gap
- **File**: `src/components/usage/UsageTrend.tsx:65,96-105` (window bound: `src/lib/db/usage.ts:79-81`)
- **Scenario**: `boundUsageDays` was carefully engineered to allow authenticated orgs up to 365 days, but the chart renders one `flex-1` column plus a 1px gap per day. At 365 days the gaps alone consume 364px; inside the page's content column each bar is sub-pixel, hover targets are un-hittable, and React renders 730 nodes for an unreadable smear. The axis labels make it worse: `d.date.slice(5)` prints `MM-DD` only, so a 365-day window starts and ends on the same `MM-DD` with no year to disambiguate.
- **Root cause**: The chart was designed against the 30–90-day happy path; the upper bound of the shared window contract was raised (and documented) in the data layer without revisiting the presentation layer's assumptions.
- **Impact**: The one place the long window is actually surfaced (`?days=365` on /usage) produces a broken-looking, uninteractable chart — the feature exists in the API but is effectively unusable in the UI.
- **Fix sketch**: Bucket to weeks (or months) above a threshold (~120 days) before rendering — sum billable/free per bucket, label `MMM 'yy` — or cap the rendered series with a "showing weekly aggregates" note; keep the CSV per-day.

## 4. Badge text width is a per-char magic-number guess — wide glyphs and non-Latin labels clip
- **Severity**: Medium
- **Category**: magic-number
- **File**: `src/app/api/badge/[owner]/[repo]/route.ts:146-162`
- **Scenario**: `charW = big ? 7.2 : 6.7` prices every character identically, but the badge renders proportional Verdana: `W`/`M` are ~10-11px at 12px font, CJK/emoji glyphs ~12px+, while `i`/`l`/`.` are ~3px. The caller-supplied `?label=` (up to 80 arbitrary chars) plus values like "✗ fail" and "L5 Autonomous" flow through this estimate; a label of wide glyphs overruns the label rect into the value fill (clipped/overlapping text), while narrow ones waste padding. Nothing documents why 6.7/7.2 or that the estimate is average-case-only.
- **Root cause**: A fixed average character width stands in for real text measurement (shields.io ships a per-character Verdana width table for exactly this reason), and the constant's provenance/limits aren't recorded.
- **Impact**: Publicly embedded badges — the project's most visible artifact — render clipped or overlapping text for legitimate customizations (uppercase labels, CJK project names, ✓/✗ glyphs), and there's no `textLength`/overflow guard to fail soft.
- **Fix sketch**: Cheapest robust fix: add `textLength="${textW(...)}" lengthAdjust="spacingAndGlyphs"` to both `<text>` nodes so the browser squeezes instead of clipping; better, adopt a small width table (wide/normal/narrow classes + double-width for non-ASCII). Either way, comment the chosen basis next to the constants.

## 5. `?color=` lets any embedder repaint the verdict color — trade-off never recorded
- **Severity**: Low
- **Category**: trade-off-undocumented
- **File**: `src/app/api/badge/[owner]/[repo]/route.ts:360-366,371`
- **Scenario**: In gate and level modes the custom `?color=` wins over the semantic color (`resolveColor(customColor, gate.pass ? L5 : L1)`), so `?gate=1&color=brightgreen` renders "✗ fail" on bright green, and an L1 repo can wear L5 green. The route is otherwise meticulous about badge honesty (mock "· demo" suffix, glyph redundancy, private gating, no-XSS logo rules) — yet the most-glanced channel, hue, is caller-spoofable, and no comment records that this shields.io-parity behavior was weighed against the trust-signal framing.
- **Root cause**: shields.io conventions were adopted wholesale; the glyph/text redundancy makes the badge technically honest, but the deliberate decision to let color contradict the verdict was never written down alongside the other honesty guards.
- **Impact**: At README-glance distance a failing gate or low maturity level can present as green; reviewers who trust the color (most do) are misled, and future maintainers can't tell whether this is intended parity or an oversight.
- **Fix sketch**: Record the decision either way. Preferred: ignore `?color=` in gate mode and for the level value fill (allow it only for the neutral/unknown states or the label side), mirroring how the demo suffix refuses to let a mock pose as a verdict; one comment line next to `resolveColor` if parity is deliberately kept.
