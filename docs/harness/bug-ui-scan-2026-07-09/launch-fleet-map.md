# Launch Fleet Map — bug-hunter + ui-perfectionist scan

> Context: Launch Fleet Map (group: Onboarding, Shell & AI Standard)
> Files scanned: 8
> Total: 7 findings (Critical: 0, High: 1, Medium: 3, Low: 3)

## 1. Header stays stuck on "charting…" forever when any org errors
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: stuck-state
- **File**: src/components/launch/FleetMap.tsx:112
- **Scenario**: A user has 3 installs; one org's `/api/app/repos` fails (rate limit, revoked token, network). `useFleetData` sets that constellation to `status:"error"`, which never becomes `"done"`.
- **Root cause**: `hydrating = stats.loaded < stats.orgs`, and `fleetStats` only increments `loaded` for `done` orgs (fleetMapDerive.ts:27-28). The assumption "every org eventually reaches done" is false; an errored org never counts.
- **Impact**: The `role="status"` `aria-live` pill (FleetMap.tsx:172) announces `charting 2/3…` permanently and never says "fleet charted"; `repos`/`scanned` render `…` forever (FleetMap.tsx:157-158) if the loaded orgs happen to total 0. Every user with one flaky org sees a lie.
- **Fix sketch**: Count settled orgs — add an `errored`/`settled` tally to `fleetStats` and set `hydrating = settled < orgs` (done OR error), so a permanently-failed org still lets the header complete.

## 2. mergeStars never removes repos — the star list only ever grows
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-corruption
- **File**: src/components/launch/mergeStars.ts:9
- **Scenario**: A repo is deleted on GitHub, unwatched, or removed from the installation. The ~90s live refresh pulls a `fresh` set without it; `mergeStars` hits `if (!f) return p` and keeps the old star.
- **Root cause**: The merge is union-only: it updates and appends but never drops a `prev` star absent from `fresh`. The assumption that the repo set is monotonic (never shrinks) is false.
- **Impact**: Deleted/removed repos linger as stars until a full page reload; clicking one opens a `reportPermalink` to a now-404/stale report. Over a long-lived Mission Control tab the star count silently drifts above reality (unbounded).
- **Fix sketch**: Base the result on `fresh` identity: iterate `fresh`, reuse the `prev` object when unchanged, and drop any `prev` star not present in `freshBy` — preserving order via `fresh`.

## 3. Whole constellation re-renders (positions recomputed) on every SSE frame
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: performance
- **File**: src/components/launch/FleetMap.tsx:88
- **Scenario**: Scanning an 80-repo org streams ~80 `repo` frames; each calls `setConstellations((cur) => applyScanEvent(cur, login, msg))`, rebuilding that org's constellation object every frame.
- **Root cause**: `ConstellationField` is unmemoized and recomputes `starPosition` (sqrt/cos/sin) and `starLook` for all ≤80 stars twice (lines 97-115 and 129-180) on each render. A per-repo stream therefore does O(N²) trig + reconciliation for one scan.
- **Impact**: Visible jank/CPU spikes on the launch page during a large-org scan, worst on low-end/mobile devices — the exact "light up the map on the spot" moment the page is built for.
- **Fix sketch**: `React.memo` `ConstellationField`; precompute a `{cx,cy}` map per `fullName` with `useMemo` keyed on the repo list; reuse it for both the lines and stars passes.

## 4. Star tap targets are far below the mobile minimum
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: mobile
- **File**: src/components/launch/ConstellationField.tsx:154
- **Scenario**: On a ~360px phone the card SVG renders ~320px wide from a 120-unit viewBox (~2.7× scale). The transparent hit halo is `r={Math.max(look.r + 1.4, 3)}` → as small as 3 units ≈ 8px radius ≈ **16px diameter** touch target.
- **Root cause**: The hit area is sized in viewBox units tuned for desktop pointer precision; 16px is under the WCAG 2.5.8 (AA) 24px minimum and well under the 44px comfort target.
- **Impact**: On mobile, tapping a star to open its report is fiddly and mis-fires onto neighboring stars — the primary "a star is a repo" interaction is hard to hit on touch.
- **Fix sketch**: Raise the halo floor (e.g. `Math.max(look.r + 1.4, 5)`), or below `sm` render a larger invisible hit circle so the effective target clears ~24px.

## 5. applyScanEvent's finite-number guard lets null/""/false paint a 0 score
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: validation-gap
- **File**: src/components/launch/applyScanEvent.ts:23
- **Scenario**: A `repo` frame arrives with `overall: null` (or `""`/`false`) but no `error`/`skipped` flag. `Number(null) === 0`, which passes `Number.isFinite`, so the star is painted with score 0 (darkest) over a real prior score.
- **Root cause**: The guard's own docstring claims it rejects garbage that "yields NaN", but `Number()` coerces several non-numbers to 0, not NaN. The current `/api/org/scan` only sends numeric `overall` (route.ts:150), so this is a robustness hole in a self-described "UNTRUSTED stream" guard, not yet reachable.
- **Impact**: If the stream shape ever drifts (proxy, future server change), a scanned repo silently darkens to 0 instead of being ignored.
- **Fix sketch**: `if (typeof data.overall !== "number" || !Number.isFinite(data.overall)) return constellations;` — reject before coercion.

## 6. A scan result for a repo not already on the map is silently dropped
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/components/launch/applyScanEvent.ts:30
- **Scenario**: An org's watched repo is scanned from the map but wasn't in the initial `/api/app/repos` payload (added between load and scan). Its `repo` frame maps over `c.repos`, matches no `fullName`, and is discarded.
- **Root cause**: `applyScanEvent` can only *update* an existing star — the `.map` has no append path, so a scored-but-unknown repo never becomes a star.
- **Impact**: The user scans, sees results stream server-side, but that star never lights up until the next ~90s live refresh (`mergeStars` appends it). Looks like the scan missed it.
- **Fix sketch**: When no existing star matches inside the `done` org, append a new `RepoStar` for `fullName` so the scan can add stars, not only brighten them.

## 7. Up to N×80 stars twinkle infinitely — steady-state repaint on a large fleet
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: performance
- **File**: src/components/launch/ConstellationField.tsx:167
- **Scenario**: A user with 6 done orgs of ~80 repos renders ~480 `.launch-star` circles, each running `ascent-twinkle` `infinite` (globals.css:280-282) plus a pulsing core per card.
- **Root cause**: Every hydrated star animates forever with no cap on concurrently-animating elements. (Reduced-motion IS respected — globals.css:412-414 — so this only affects the default motion path.)
- **Impact**: Continuous compositor work and battery drain on the launch page for default-motion users with a big fleet, particularly on mobile, even when idle.
- **Fix sketch**: Only animate the brightest / a capped subset of stars (e.g. top N by `overall`), or pause the twinkle when the card is offscreen via an `IntersectionObserver`.
