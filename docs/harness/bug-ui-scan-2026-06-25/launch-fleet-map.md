# Launch Fleet Map — Bug + UI Scan
> Context: Launch Fleet Map (Onboarding, Shell & AI Standard)
> Total: 5 findings (0 critical, 0 high, 2 medium, 3 low)

## 1. Live auto-refresh can clobber in-flight manual-scan scores
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/components/launch/FleetMap.tsx:112-140 (guard at 116, merge `setConstellations` at 126-128)
- **Value**: impact 6 · effort 3 · risk 3
- **Scenario**: The 90s refresh `refreshAll` checks `scanCtrl.current` exactly once, at the top (line 116). It then `await`s `Promise.all(...)` over every installation — several seconds of parallel `/api/app/repos` fetches. If the user clicks "Scan" on an org *during* that await, `scanOrg` sets `scanCtrl.current` and the SSE stream begins painting fresh scores via `applyScanEvent`. When the already-issued refresh fetch resolves, it carries the *pre-scan* (often `overall: null`) rows and runs `mergeStars(c.repos, fresh)` (line 127). Because `f.overall (null) !== p.overall (85)`, mergeStars returns the stale `f`, wiping the just-applied live score. The user sees lit stars flicker back to grey mid-scan.
- **Root cause**: The "never fight an in-flight manual scan" guard is evaluated before the network round-trip, not at the moment the result is committed to state — the `cancelled`/visibility re-check at lines 122-125 deliberately re-reads `cancelled` but never re-reads `scanCtrl.current`.
- **Impact**: Transient state corruption / visible flicker of maturity scores; on unlucky ordering a star can settle on the stale value until the next refresh.
- **Fix sketch**: Re-check the live-scan guard immediately before each commit: inside the `.then`, `if (cancelled || scanCtrl.current) return;` before `setConstellations`. Better: capture a scan "generation" counter at fetch start and discard the result if it changed. Makes the whole stale-write class impossible.

## 2. Manual scan swallows HTTP/scan errors with zero user feedback
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/components/launch/FleetMap.tsx:56-78 (early return at 68, catch at 72-74)
- **Value**: impact 6 · effort 3 · risk 2
- **Scenario**: A user clicks "Scan" on an org. If `/api/org/scan` returns a non-2xx — quota exceeded (402), missing permission/installation (403), or a server error (500) — the code hits `if (!res.ok || !res.body) return;` and silently bails; the `catch {}` likewise swallows network failures. The button text reverts "Scanning…" → "Scan", no star changes, and the user is given no reason. The map looks identical to "nothing was watched" or "scan ran but found nothing."
- **Root cause**: The error path was written only for the *abort/network* case ("leave the seeded stars as-is"), conflating an expected cancel with genuine failures (quota/permission) that the user must be told about.
- **Impact**: UX degradation / confusion — a paying user can't tell that a scan was blocked by quota or permissions; they'll retry fruitlessly or assume the feature is broken.
- **Fix sketch**: On `!res.ok`, read the JSON error and surface a per-org error banner (the `Constellation` already has an `error` variant + `message` field used elsewhere). Distinguish `AbortError` (silent) from other catches in `catch (e)` and show a toast/inline message for the latter.

## 3. "Unscanned" level-filter button has no accessible name
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: a11y
- **File**: src/components/launch/FleetMap.tsx:221-236 (label rendered at line 233)
- **Value**: impact 4 · effort 1 · risk 1
- **Scenario**: The level band toggles render their key as text, but the `"unscanned"` band is rendered as a bare em-dash: `{b === "unscanned" ? "—" : b}`. A screen-reader user tabbing the toggle row hears "L1 toggle button … L5 … dash button" — the most semantically important filter ("show repos with no score yet") is announced as "—", which is meaningless. The other five buttons (L1–L5) read fine.
- **Root cause**: The visual glyph was chosen for compactness without a parallel `aria-label`, so the accessible name collapses to the punctuation.
- **Impact**: The unscanned filter is unusable / unintelligible to assistive-tech users; minor sighted-user ambiguity too.
- **Fix sketch**: Add `aria-label={b === "unscanned" ? "unscanned" : b}` (or `title`) to the `<button>`, keeping the "—" purely decorative.

## 4. Auto-refresh never re-pulls on tab re-focus and keeps a timer alive while hidden
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/components/launch/FleetMap.tsx:112-140 (interval set at line 135, visibility guard at 116)
- **Value**: impact 3 · effort 3 · risk 2
- **Scenario**: The map refreshes only on a fixed `setInterval(refreshAll, 90_000)`. When the tab is hidden the tick fires but the visibility guard early-returns, so no data is fetched (good) — but there is no `visibilitychange` listener to refresh *immediately* when the user returns. A user who leaves Mission Control open in a background tab and comes back can stare at scores up to ~90s stale before the next tick. The hidden-tab timer also keeps waking the page for a no-op.
- **Root cause**: Freshness is modeled purely as a polling cadence; the "tab became visible again" event isn't treated as a refresh trigger.
- **Impact**: Mildly stale fleet numbers on tab re-focus; minor wasted wake-ups. Low because the data is not time-critical.
- **Fix sketch**: Add a `document.addEventListener("visibilitychange", …)` that calls `refreshAll()` (debounced) when the tab becomes visible, and optionally pause the interval while hidden.

## 5. Mover ring keeps stale 30-day delta after a live scan
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src/components/launch/applyScanEvent.ts:26-30; rendered in src/components/launch/ConstellationField.tsx:138-139
- **Value**: impact 3 · effort 2 · risk 2
- **Scenario**: `applyScanEvent` updates a star's `overall` and `level` from the SSE stream but leaves `dOverall` untouched. ConstellationField draws a directional "mover" ring + tooltip when `Math.abs(r.dOverall) >= 1` (line 138). After a manual scan changes a repo's score, the ring and the "`+3 30d`" tooltip still reflect the *pre-scan* delta — e.g. a repo just scanned down to L2 can still wear a green "riser" ring, contradicting its new score.
- **Root cause**: The live-scan event carries the new absolute score but no recomputed window delta, and the reducer doesn't invalidate the now-inconsistent `dOverall`.
- **Impact**: Misleading movement indicator on freshly-scanned stars until the next full `/api/app/repos` refresh corrects it.
- **Fix sketch**: When applying a live score, null out `dOverall` for that star (so the stale ring disappears) until the next authoritative refresh, or have the scan stream emit the recomputed delta.
