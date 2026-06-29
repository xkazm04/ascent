# Code Refactor — Launch Fleet Map
> Total: 4 | Critical: 0 High: 0 Medium: 3 Low: 1

## 1. Duplicated `/api/app/repos` fetch+parse across FleetMap's two effects
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/launch/FleetMap.tsx:80-107 and :112-140
- **Scenario**: Two `useEffect` blocks fetch the same endpoint. The initial-hydrate effect (80-107) and the ~90s live-refresh effect (112-140) each build the identical query string (`new URLSearchParams({ org: inst.login, installation_id: String(inst.id) })`), call `fetch(`/api/app/repos?${qs.toString()}`)`, parse via `(await r.json().catch(() => null)) as { repos?... } | null`, and run `mapRepos(data?.repos)`. Lines 83-84/92 mirror lines 120-124.
- **Root cause**: The "fetch one installation's repos and coerce to stars" operation was written inline twice (once with an AbortController + .then/.catch, once inside a `Promise.all` + try/catch) instead of being factored into a shared helper.
- **Impact**: Any change to the endpoint shape, query params, or parse/coercion contract must be edited in two places and kept in sync; the two copies have already drifted slightly (the refresh path drops the `error` field from the parse type and omits the abort signal), which is exactly the kind of inconsistency duplication invites.
- **Fix sketch**: Extract a small async helper, e.g. `async function fetchOrgRepos(inst: Installation, signal?: AbortSignal): Promise<{ ok: boolean; repos: RepoStar[]; error?: string }>` that owns the qs build, fetch, json-parse-with-catch, and `mapRepos`. Both effects then call it and apply their own setState reducer (initial → `done`/`error`; refresh → `mergeStars`). Keeps the per-effect lifecycle (signal vs Promise.all) but removes the duplicated transport/parse body.

## 2. ConstellationField recomputes per-star geometry twice per render
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/launch/ConstellationField.tsx:93-111 and :125-177
- **Scenario**: The constellation SVG maps over `repos` twice — once to draw the org-core→star lines (93-111) and once to draw the star glyphs (125-177). Both maps independently compute the same three values for each star: `const { cx, cy } = starPosition(i, repos.length, r.fullName);`, `const look = starLook(r.overall);`, and `const dim = matcher ? !matcher(r) : false;` (lines 96-98 are duplicated verbatim at 127-131).
- **Root cause**: Lines and stars are rendered in separate passes for SVG paint-order reasons, but the geometry/look/dim derivation that both passes need was copied into each pass rather than computed once.
- **Impact**: Every render runs `starPosition` (incl. a string hash) and `starLook` twice for every repo, and the `dim`/`matcher` predicate is evaluated twice per star; more importantly the placement logic is duplicated, so a change to positioning or dimming rules must be mirrored in both maps or the lines and stars will disagree.
- **Fix sketch**: Precompute once, e.g. `const placed = repos.map((r, i) => ({ r, ...starPosition(i, repos.length, r.fullName), look: starLook(r.overall), dim: matcher ? !matcher(r) : false }));`, then render the lines pass and the stars pass from `placed`. Single source for each star's `cx/cy/look/dim`.

## 3. Per-org "average maturity over scanned repos" computed in two modules
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/launch/ConstellationField.tsx:36-44 and src/components/launch/fleetMapDerive.ts:79-82
- **Scenario**: ConstellationField computes a per-org average (`scanned` = repos with `overall != null`; `avg = scanned > 0 ? Math.round(sum(overall)/scanned) : null`). The `maturity` branch of `orderConstellations` in fleetMapDerive computes the same thing for sorting: `const scored = c.repos.filter((r) => r.overall != null); scored.length ? scored.reduce((s, r) => s + (r.overall ?? 0), 0) / scored.length : 0`. (`fleetStats`, lines 30-37, accumulates the fleet-wide variant of the identical "sum/count of scanned overalls" too.)
- **Root cause**: The domain concept "mean overall score across an org's scanned repos" has no single home, so each consumer re-derived it inline with slightly different null/rounding handling.
- **Impact**: The definition of an org's maturity (which repos count, how the mean is taken) lives in 2-3 places; a change to, say, how unscanned repos are treated would have to be applied everywhere to keep the card badge, the sort order, and the header stat consistent.
- **Fix sketch**: Add one pure helper in fleetMapDerive, e.g. `orgMaturity(repos: RepoStar[]): { scanned: number; avg: number | null }`, and have ConstellationField, `orderConstellations`, and (where applicable) `fleetStats` consume it. Each caller keeps its own presentation choice (round vs raw, null vs 0) on top of the shared computation.

## 4. ConstellationField repeats the `c.status === "done"` narrowing five times
- **Severity**: Low
- **Category**: structure
- **File**: src/components/launch/ConstellationField.tsx:35-44
- **Scenario**: `repos`, `scanned`, `total`, `overflow`, and `avg` each independently re-test `c.status === "done"` (and `avg` even rebuilds `c.status === "done" ? c.repos : []` a second time at line 42) to satisfy the discriminated-union narrowing before reading `c.repos`.
- **Root cause**: The union is narrowed per-derivation instead of once, so the same guard ternary is restated for each derived value.
- **Impact**: Verbose and slightly error-prone (the inline `c.status === "done" ? c.repos : []` inside `avg` is a redundant third copy); minor readability/maintenance cost only.
- **Fix sketch**: Narrow once at the top — `const all = c.status === "done" ? c.repos : [];` — then derive `repos = all.slice(0, MAX_STARS)`, `total = all.length`, `scanned = all.filter(r => r.overall != null).length`, `overflow = Math.max(0, all.length - MAX_STARS)`, and `avg` from `all`. Removes four repeated guards and the duplicated array expression.
