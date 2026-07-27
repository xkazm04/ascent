# Launch Fleet Map — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

Reachability check (KNOWN FACT follow-up): `/launch` is now reachable — `src/app/api/auth/callback/route.ts:133` lands the OAuth callback on `/launch?next=…`, `resolveSignInState()` replaced the dormant custom-OAuth session read, and `viewer-installations.test.ts` pins the fix. robots.ts/seo.test.ts correctly keep it un-indexed.

## 1. A scan that streams zero repo events ends completely silently — the exact UX failure the error path was built to prevent
- **Severity**: High
- **Category**: missing-state
- **File**: `src/components/launch/FleetMap.tsx:88`
- **Scenario**: `scanOrg` surfaces every non-OK status (quota 402 / permission 403 / 500 / network) via `scanError` — the comment at lines 77–79 explicitly says silent reversion "looks identical to 'nothing watched'". But the legitimate 200 path with an SSE stream carrying zero applicable `repo` events (org has no watched repos, or every event arrives with `error`/`skipped` and is no-op'd by `applyScanEvent`) still reverts "Scanning…" → "Scan" with no message, no star change, no confirmation. There is also no success feedback of any kind ("scanned N repos").
- **Root cause**: Outcome is inferred solely from visible star mutations. `readSSE` completes without the caller counting how many frames `applyScanEvent` actually applied, so "scan ran, nothing to do" and "scan ran, all repos skipped/errored" are indistinguishable from "scan worked".
- **Impact**: The precise confusion the inline comment diagnoses survives on the happy path: a user whose org has nothing watched (common right after install — the page `/launch` deliberately targets) clicks Scan, sees a flash, nothing happens, retries fruitlessly. Per-repo `skipped`/`error` reasons streamed by the server are discarded invisibly.
- **Fix sketch**: Count applied/skipped/errored frames in the `readSSE` callback (e.g. compare the constellation reference before/after, or tally `msg.data.skipped`). On zero applied, set `scanError[login]` to a descriptive outcome ("No watched repos to scan — open the org to watch some", or "N repos skipped: <first reason>"). Optionally a transient "scanned N ✓" success note in the same slot.

## 2. A 200 response with a malformed/absent JSON body renders a false "no repositories" empty state
- **Severity**: Medium
- **Category**: edge-case-gap
- **File**: `src/components/launch/useFleetData.ts:24`
- **Scenario**: Initial per-org fetch does `r.json().catch(() => null)`; when `r.ok` is true it unconditionally commits `status: "done", repos: mapRepos(data?.repos)`. A truncated body, HTML error page behind a proxy, or a shape drift in `/api/app/repos` yields `null`/non-array → `mapRepos` returns `[]` → ConstellationField shows the confident "no repositories" badge and the org counts as cleanly settled in the header ("fleet charted").
- **Root cause**: HTTP status is treated as the only failure signal; body parse/shape failure on a 200 is mapped to the same terminal state as a genuinely empty org. Notably `mergeStars.ts:12` already treats an empty `fresh` on refresh as "almost always a failed/parse-empty pull" and no-ops — the initial load applies the opposite assumption to the identical payload, undocumented.
- **Impact**: A transient gateway blip at first paint tells the user their org has zero repos (the worst possible message on a first-run cinematic page), with no retry affordance; the 90s refresh may heal it but `mergeStars` keeps object identity only — the user already saw the lie.
- **Fix sketch**: On `r.ok && (data === null || !Array.isArray(data.repos))`, commit `status: "error", message: "Couldn't read repositories — retrying"` instead of `done`, mirroring mergeStars' stated rationale. One shared "empty means failure" rule for both paths.

## 3. Mover ring encodes direction by color alone (emerald vs orange)
- **Severity**: Medium
- **Category**: a11y
- **File**: `src/components/launch/ConstellationField.tsx:164`
- **Scenario**: A repo that moved ≥1 point in 30 days gets a thin ring — `RISER` (#34d399) up, `FALLER` (#f97316) down. Visually, direction is distinguishable ONLY by hue. The header "movers · 30d" stat pairs the same palette with ▲/▼ glyphs, and the star's tooltip/aria-label carries the signed delta, so the map's own chrome already acknowledges color isn't enough — but the per-star ring doesn't follow suit.
- **Root cause**: The redundant non-color channel (glyph/sign) was added to the aggregate stat and the hover/AT text, not to the always-visible glanceable mark.
- **Impact**: WCAG 1.4.1 (Use of Color): deuteranopia/protanopia users — for whom this emerald/orange pair converges — cannot tell risers from fallers at a glance, which is the ring's entire purpose; they must hover every ringed star.
- **Fix sketch**: Add a second channel to the ring, e.g. `strokeDasharray` for fallers (dashed = down, solid = up), or a tiny ▲/▼ `<text>`/path nub at the ring's top. Keep the shared palette; the shape difference costs nothing visually.

## 4. A mid-scan appended star re-seats every star in the constellation
- **Severity**: Medium
- **Category**: trade-off-undocumented
- **File**: `src/components/launch/applyScanEvent.ts:52`
- **Scenario**: When a live scan names a repo the map's earlier `/api/app/repos` pull didn't include, `applyScanEvent` appends it (deliberately, launch-fleet-map #6). But `starPosition(i, total, seed)` keys layout on `total` (`fleetMapStars.ts:65-71`), so `repos.length` changing by one recomputes the phyllotaxis radius for ALL stars: mid-animation, the whole constellation visibly shifts/contracts while the user watches their scan brighten stars. The positionCache comment even notes "a repo added or removed changes `total`, hence every key" — but only as a memoization fact; the visual jump during the product's signature cinematic moment is never weighed. Same jump recurs when the next authoritative refresh removes the appended star via `mergeStars` (repo genuinely absent), and again the appended star can silently exceed the `MAX_STARS` slice (ConstellationField.tsx:44) — the scan result lands but renders nothing for orgs at the 80-star cap.
- **Root cause**: Layout is a pure function of `(index, total)`; append/remove was reasoned about for correctness and cache identity, not motion. The `>MAX_STARS` interaction with append was never considered.
- **Impact**: Every star hops position once (sometimes twice) during a scan — jarring on the page whose whole job is polish; at the cap, a successful scan of an unknown repo is invisible, recreating the "dropped result" bug #6 meant to fix.
- **Fix sketch**: Place appended stars without disturbing `total` for existing ones — e.g. lay out by a stable per-repo hash angle with `total` frozen at the org's initial count, or position appended stars on an outer "incoming" ring until the next refresh re-flows everything at once. Document the cap interaction; if `repos.length >= MAX_STARS`, surface the scanned repo in the overflow line ("+N more stars") instead of dropping it.

## 5. The stat-pill pattern is hand-rolled three ways with divergent metrics
- **Severity**: Low
- **Category**: component-extraction
- **File**: `src/components/launch/FleetMapChrome.tsx:5`
- **Scenario**: Three near-identical "mono pill" renderings coexist: `Stat` (`rounded-full border-slate-700 bg-slate-900/60 px-3 py-1`, value `text-base font-bold`, hardcoded `#fff` fallback color), the header status pill inlined in `FleetMap.tsx:179` (same shell classes duplicated verbatim, different typography), and the per-org avg badge in `ConstellationField.tsx:74-80` (`px-2 py-0.5 text-sm font-bold`, same border/bg). All express "small mono metric chip" but drift in padding, text size, and color handling.
- **Root cause**: `Stat` was extracted for the header row only; the live-status pill and org badge were written inline afterward and copied its class string rather than the component.
- **Impact**: The next tweak (e.g. border token change, dark-theme adjustment) must be found in three places; the `#fff` literal bypasses the design tokens used everywhere else (`text-white`, `scoreHex`); pills sitting in the same viewport render at visibly different densities.
- **Fix sketch**: Extend `Stat` (or a `Pill` primitive in FleetMapChrome) with `size?: "sm" | "md"` and optional `role`/`aria-live` passthrough; replace the two inline copies. Swap `#fff` for the `text-white` class to stay in token-land.
