# Bug-UI Fix Wave 10 — Accessibility

> 2 atomic commits, 3 findings closed (2 high, 1 medium) + 2 found already-mitigated.
> Baseline preserved: `tsc` 0 → 0 errors · tests 509/509 → 509/509 (markup-only a11y changes; no new unit harness).

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|--------|-----------------|----------|-------|
| 1 | `a8b1ce2` fix(a11y): expose fleet-map star links + drop dangling tab aria-controls | launch #1, repo-report #4 | High + Medium | `ConstellationField.tsx`, `ReportTabBar.tsx` |
| 2 | `4e5058d` fix(a11y): name the org data tables for screen readers | people-delivery #2 | High | `org/ui.tsx`, contributors + delivery pages |

## What was fixed

1. **Fleet map interactive links unreachable (High).** The constellation SVG used `role="img"`, which collapses the entire subtree to a single image — so every per-star `<a>` report link (and its `aria-label`) was invisible to screen readers, making the map's core "a star is a repo" interaction inaccessible. Changed to `role="group"` (with a repo count in the label): keeps a group name *and* exposes the interactive links.
2. **Dangling tab `aria-controls` (Medium).** `ReportTabBar` set `aria-controls` on every tab, but only the active panel mounts — so inactive tabs pointed at an unrendered panel id. Now set only on the active tab, matching the component's own doc.
3. **Unnamed org data tables (High).** The shared `OrgTable` rendered a bare `<table>` with no caption/label, so a screen reader announced just "table." Added an optional `caption` prop (visually-hidden via `sr-only`) and wired accessible names for the three people/delivery tables.

## Already-mitigated (already-existed catch, Phase 4.1d)

- **Chart screen-reader fallbacks (score-charts #1 PostureQuadrant, #2 RadarChart, High).** The report flagged these as having "no SR fallback," but both already carry `role="img"` with a descriptive label — `PostureQuadrant` announces *"Posture: X. AI adoption N of 100, rigor N of 100"* and `RadarChart` is `aria-labelledby` a `<title>`+`<desc>`. The standard accessible-chart pattern is present. The residual concerns (hue-only encoding, keyboard hover) are real but lower-value, and the app already adds level glyphs (○◔◑◕●) elsewhere for non-color redundancy. **No change needed for the SR-fallback claim.**

## Verification

| | Before wave | After wave |
|---|---|---|
| `tsc --noEmit` errors | 0 | 0 |
| Tests | 509/509 | 509/509 |

## Patterns established (catalogue item 23)

23. **`role="img"` is a leaf — never put it on a container with interactive/structured children.** It collapses the whole subtree to one image, hiding any links/controls inside. Use `role="group"`/`role="list"` (or no role) so descendants stay in the accessibility tree; reserve `role="img"` + `aria-label` for genuinely atomic graphics (a single chart with no interactive parts).

## Deferred (diffuse / lower-value a11y polish)

The remaining a11y findings are spread across many components and are mostly Medium/Low, partly subjective, or already-partially-handled: `aria-live` on async actions, focus management on step/phase transitions, unlabeled form controls in various panels, colorblind-redundancy on individual charts. These are real polish but don't carry the blast radius of the closed items; left for a focused a11y pass.

## What remains

Remaining wave per INDEX: **W11 UI states & consistency** (layout shift, empty-state dead-ends, projection-mode scaling, cross-page inconsistency). All Medium/Low.
