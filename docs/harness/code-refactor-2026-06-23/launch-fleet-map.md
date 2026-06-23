# Code Refactor — Launch Fleet Map
> Context group: Onboarding, Shell & AI Standard
> Total: 3 findings (Critical: 0, High: 0, Medium: 2, Low: 1)

The Launch Fleet Map context is, on the whole, clean: tight separation between the
server page, the client `FleetMap` orchestrator, presentational `ConstellationField` /
`FleetMapChrome`, and a set of small **pure** helper modules (`fleetMapStars`,
`fleetMapDerive`, `applyScanEvent`, `mergeStars`) that each carry focused unit tests.
No dead modules, no commented-out blocks, no stray `console.log`, no unused imports, and
the one apparent "duplicate" type (`ApiRepo` in `fleetMapStars.ts`) is a deliberately
documented local subset of the route's response shape — left as-is. The three findings
below are the only genuine, behavior-preserving cleanups worth making.

## 1. `RepoStar.private` and `RepoStar.name` are written but never read
- **Severity**: Medium
- **Category**: dead-code
- **File**: src/components/launch/fleetMapStars.ts:4-14, 64-75
- **Scenario**: The `RepoStar` interface declares `name: string` and `private: boolean`, and `mapRepos` faithfully coerces both (`name: String(r.name ?? r.fullName)`, `private: Boolean(r.private)`). But no production consumer ever reads either field. `ConstellationField.tsx` (the sole star renderer) keys exclusively off `fullName`, `overall`, `level`, `dOverall`, and `watched`; `fleetMapDerive.ts` (`makeMatcher` / `fleetStats` / `orderConstellations`) and `mergeStars.ts` likewise never touch `name` or `private`. A repo-wide grep for `.private` / `r.name` against `RepoStar` turns up only the write site in `mapRepos` plus shape assertions in `starLayout.test.ts` — no behavioral reader.
- **Root cause**: `RepoStar` was modeled as a near-mirror of the `/api/app/repos` `AppRepo` row (which legitimately carries `name`/`private` for the connect UI). The map only ever needed a fraction of those fields, but the carried-over fields were never pruned once the rendering surface settled on `fullName`/maturity/`watched`.
- **Impact**: Low-risk but real: two fields of dead surface area on the core domain type plus their coercion lines, which mislead a maintainer into thinking `private` (e.g. a lock glyph) or `name` (a short label) is wired into the map when neither is. Slightly inflates the mental model of every helper that takes `RepoStar`.
- **Fix sketch**: Delete the `name` and `private` declarations from the `RepoStar` interface (lines 5-6 of the interface) and drop the corresponding `name:`/`private:` lines from the `mapRepos` object literal. Update the three shape assertions in `starLayout.test.ts` (the `toEqual`/`name`/`private` expectations around lines 110, 125, 133-134) to match the slimmer shape. No runtime behavior changes — nothing consumes the values. (If a near-term feature needs `private` for a lock badge, leave a single-line TODO instead; otherwise remove.)

## 2. `filterActive` is computed twice — in `FleetMap` and again inside `makeMatcher`
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/launch/FleetMap.tsx:149-151; src/components/launch/fleetMapDerive.ts:63-64
- **Scenario**: `FleetMap` derives `const filterActive = q !== "" || levels.size > 0 || watchedOnly;` (line 150) purely to decide whether to show the "clear" button (line 253). The very next line builds `matcher = makeMatcher({ q, levels, watchedOnly })`, and `makeMatcher` recomputes the identical boolean internally (`const filterActive = q !== "" || levels.size > 0 || watchedOnly; if (!filterActive) return undefined;`) — returning `undefined` precisely when no filter is active. So the same three-term predicate lives in two files and must be kept in lockstep by hand.
- **Root cause**: `makeMatcher` was extracted into the pure `fleetMapDerive` module (with its own "active = undefined matcher" contract, documented in its JSDoc) after the component already had its own inline `filterActive`. The component's copy was never re-derived from the helper's return value.
- **Impact**: A latent drift hazard: if the set of filter inputs ever grows (e.g. a new facet), one copy can be updated and the other forgotten, desyncing the "clear" affordance from whether dimming is actually active. Two literals to maintain for one concept.
- **Fix sketch**: Drop the standalone `filterActive` line in `FleetMap.tsx` and derive it from the single source of truth the helper already exposes: `const filterActive = matcher !== undefined;` (place it just after the `matcher` `useMemo`). The JSX guard at line 253 is unchanged. This makes `makeMatcher`'s `undefined`-when-inactive contract the one definition and is fully behavior-preserving.

## 3. Mover-direction colors (`#34d399` up / `#f97316` down) hardcoded in two files
- **Severity**: Low
- **Category**: duplication
- **File**: src/components/launch/ConstellationField.tsx:155; src/components/launch/FleetMap.tsx:195
- **Scenario**: The "riser = emerald, faller = orange" movement semantic is expressed as bare hex literals in two in-scope files: `ConstellationField` paints a star's directional ring with `stroke={moved > 0 ? "#34d399" : "#f97316"}`, and `FleetMap`'s "movers · 30d" `Stat` uses `color={stats.risers >= stats.fallers ? "#34d399" : "#f97316"}`. The same two magic colors encode the same up/down meaning in both places, with no shared constant (unlike the maturity ramp, which is centralized via `scoreHex`).
- **Root cause**: The movers overlay (MAP-3) and the header movers stat were added at different times; each inlined the direction colors locally rather than reaching for a shared token.
- **Impact**: Cosmetic / maintenance only: a palette retune of the up/down colors requires editing both files and risks one drifting from the other. Low blast radius (two call sites, both in scope).
- **Fix sketch**: Add two named constants beside the existing palette in `fleetMapStars.ts` (which already exports `ACCENT`/`FAINT`), e.g. `export const RISER = "#34d399";` and `export const FALLER = "#f97316";`, then reference them at both call sites (`moved > 0 ? RISER : FALLER` and `stats.risers >= stats.fallers ? RISER : FALLER`). Behavior-preserving; collapses the two semantics to one source. Skip if the team prefers to keep one-off SVG colors inline — strictly a nicety.
