# Fix Wave 7 — Accessibility + reduced-motion (ascent, bug-ui-scan-2026-06-20)

> 7 findings closed in 6 atomic commits. Baseline preserved: tsc 0; tests 2412 → 2414 (+2, +1 new
> test file); `next build` green. 0 regressions. All fixes are additive a11y — the visual design for
> non-reduced-motion / sighted users is unchanged.
> Branch: `vibeman/bug-ui-scan-2026-06-20-fixes`.

## Commits

| Commit | Finding(s) | Sev | What changed |
|---|---|---|---|
| about a11y | marketing-about-page #1, #2 | High×2 | Gate the About page's NON-transform animations (FleetGrid scan-line `left` + dist `flexGrow`, AboutAscentSteps climber `cx`/`cy`, ROI bars `width`) on `useReducedMotion()` → final/static state (the page-wide `reducedMotion="user"` only degrades transforms). ROI promotion badge now renders content only when `r.promoted` (was hidden via `text-transparent`, still read by SRs as phantom promotions). |
| matrix motion | landing-page-prototypes #1 | High | DimensionMatrix `CellBar` (animates `width`) gated on `usePrefersReducedMotion()` like ScoreGauge → final width when reduced. |
| wizard a11y | first-run-onboarding-wizard #1 | High | Polite live region announcing "Step N of 3: <title>" + focus moved to the new step heading on every phase change. |
| deck-nav focus | design-system-ui-primitives-deck #1 | High | DeckNav dots get the shared `.focus-ring` + a focus-revealed label (WCAG 2.4.7 / 2.4.4). |
| scoring-tab aria | repo-report-shell-tabs #1 | High | Replaced the orphaned `role="tabpanel"` + dangling `aria-labelledby` (post-SideNav-migration) with a labelled `<section aria-label="Scoring">`. |
| audit attribution | security-posture-audit-log #1 | High | `org.plan` / `org.gate_policy` / `org.alerts.*` audits now pass `actorId: session?.login` (was `meta.actor`), so the AuditLogViewer Actor column shows + filters them. Added a plan-route test. |

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `vitest run` | 2412 | **2414** (+2; +1 test file → 145) |
| `next build` | green | green |
| Regressions | — | none |

## Patterns added

31. **`reducedMotion="user"` only degrades transforms.** Any animation of `left`/`width`/`cx`/`flexGrow`
    must be gated explicitly on `useReducedMotion()` and rendered at its final value. (about #1, landing #1)
32. **Visually-hidden ≠ SR-hidden.** `text-transparent` (or color tricks) still expose content to
    assistive tech; conditionally render or `aria-hidden` it. (about #2)
33. **A multi-step flow must move focus + announce on step change.** Keyboard/SR users otherwise lose
    their place silently. (wizard #1)
34. **Custom nav controls need the shared focus ring + an accessible, focus-visible name.** (deck #1)
35. **Remove ARIA that points at a control that no longer renders.** A migration can leave an orphaned
    tabpanel + dangling IDREF. (report-tabs #1)
36. **Write the actor into the column the viewer reads + filters, not just free-text meta.** (audit #1)

## Deferred from these contexts (Medium/Low — Wave 8 / later)
- marketing-about #3-6, landing #2-6, wizard #2-6, deck #2-6, report-tabs #2-5, security-posture #2-5
  (interactive-diagram aria-live, competing h1s, "scan another" stale state, etc.).
