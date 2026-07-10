# Org Overview & Standing — bug-hunter + ui-perfectionist scan

> Context: Org Overview & Standing (group: Org Dashboard & Analytics)
> Files scanned: 13
> Total: 7 findings (Critical: 0, High: 0, Medium: 4, Low: 3)

Note on the auth wall (the brief's headline concern): the *access* gate is sound. `layout.tsx:57` uses the active `authGateEnabled()`+`getViewer()` login wall, and `layout.tsx:83` calls `canReadOrg(slug)`, which under the Supabase wall resolves `viewerOrgRole` and returns false for a non-member of an owned/private org (authz.ts:106-120). A non-member cannot read a private org's standing — the cross-tenant IDOR is closed. The two findings below are about the *role display* and the *copy* still keying off the dormant stack, not the access decision.

## 1. Member role chip never resolves under the active Supabase auth wall
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: dead-code-authz
- **File**: src/app/org/[slug]/layout.tsx:106
- **Scenario**: A signed-in Supabase member opens any org tab in production (Supabase wall on, `ASCENT_AUTH_BYPASS` off, custom OAuth dormant so `isAuthConfigured()` is false).
- **Root cause**: `roleLogin = session?.login ?? bypassViewer?.login ?? null`. `session` comes from the dormant custom-OAuth `getSessionState()` (null here) and `bypassViewer` is null unless the dev bypass is on — so `roleLogin` is always null. The real identity (`await getViewer()`) is never consulted for role resolution. `myRole` (line 120) therefore stays null, and `<OrgHeader role={myRole}>` (line 201) renders no role.
- **Impact**: MEM-6's promise ("every member sees their access level") is silently broken for every member on the production auth path — UX regression, hits the common case, not an edge.
- **Fix sketch**: Derive the login across both stacks: `const roleLogin = session?.login ?? (await getViewer())?.login ?? null;` (or reuse `resolveViewerLogin()` from `@/lib/access`), so a Supabase viewer's login feeds `getMembershipRole`.

## 2. Four scoped components are unreferenced dead code
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: dead-code
- **File**: src/components/org/OrgStanding.tsx:8
- **Scenario**: Grep across the whole repo for `<OrgStanding`, `<OrgGapsSection`, `<PeriodSummary`, `<CollapsibleSection` (and their imports) returns zero call sites; the overview `page.tsx` renders only `RepoCategoryRollup` + `RepoDimensionHeatmap`, and only `OrgLeverageMoves` was relocated (to `executive/page.tsx:180`).
- **Root cause**: The overview was slimmed and the Standing / "Where the gaps live" / "Quarter in review" narrative was cut without either re-wiring or deleting these files (`fixFirst.ts` and `PeriodSummary.test.ts` still assume a page that fetches movers/gaps/goals).
- **Impact**: The "Standing vs corpus", gap-analysis, and period-in-review sections — the value the context is literally named for — no longer appear anywhere in the product. Dead files rot (e.g. OrgStanding.tsx:40-46 shows "Benchmark fills in…" *and* "corpus avg: overall 0…" together when `corpusRepos` is 0, a latent contradictory empty-state that will never be caught because it never renders).
- **Fix sketch**: Decide per component — re-mount them on the overview (they were extracted specifically to keep `page.tsx` under 300 LOC) or delete the four files plus `fixFirst.ts`/`PeriodSummary.test.ts` so the tree reflects reality.

## 3. "No access" body copy branches on the dormant `isAuthConfigured()`
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: misleading-error
- **File**: src/app/org/[slug]/layout.tsx:84
- **Scenario**: A signed-in Supabase viewer who is not a member of private org `acme` visits `/org/acme`. The login wall passes (they're signed in), `canReadOrg` returns false, so this OrgEmpty renders.
- **Root cause**: The body text is chosen by `isAuthConfigured()` (the dormant custom-OAuth predicate), which is false under the Supabase wall — so it picks the else branch: "Per-organization dashboards require the GitHub App and authentication to be configured on this deployment. Only the shared public dashboard is available here."
- **Impact**: A legitimately-authenticated user who simply isn't a member is told the deployment is unconfigured / only the public dashboard exists — wrong and confusing; the true reason is "you're not a member of this org."
- **Fix sketch**: Gate the copy on `authGateEnabled()` (the active predicate): under the wall, say "You're signed in but not a member of {slug}. Ask an owner for an invite." Reserve the "not configured" text for the genuinely auth-off case.

## 4. `generateMetadata` recomputes the full org rollup on every render
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: redundant-query
- **File**: src/app/org/[slug]/page.tsx:22
- **Scenario**: Any human loads the overview. Next runs `generateMetadata` (which calls `getOrgRollup(slug)`) to emit `<head>` on every server render, then the page body runs `getOrgRollup(slug, win, segmentId, techGroupId)` again (line 57).
- **Root cause**: The heaviest fleet aggregate is computed twice per page load. The two calls have different args (metadata = unscoped/unwindowed; body = window+segment scoped), so a `cache()` wrapper couldn't dedupe them — it's genuinely two full rollups, one purely for OG/Twitter description text that only crawlers consume.
- **Impact**: Doubles the dominant DB cost on the dashboard's front page for every viewer, not just unfurls — latency + DB load that scales with fleet size.
- **Fix sketch**: Cheapen the metadata path — use `getOrgHeaderSummary(slug)` (the cheap query the layout already uses) for the description numbers, or gate the rich description behind a lighter query and let the neutral fallback stand otherwise.

## 5. `Meter` does not sanitize NaN, silently blanking the bar
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/components/org/ui.tsx:183
- **Scenario**: Any caller passes a NaN value (e.g. a goal `pct` computed as `done/total` with `total === 0`, or a delta divided by an empty baseline). `pct = Math.max(0, Math.min(100, NaN))` evaluates to `NaN`, so `style={{ width: 'NaN%' }}`.
- **Root cause**: The clamp assumes a finite number; `Math.min/Math.max` propagate NaN rather than flooring it. Browsers drop the invalid width, so the fill renders at 0 with no signal that the input was garbage.
- **Impact**: A meter reads as "0%" (empty) instead of surfacing bad data — a shared primitive used by executive goals, Trajectory, MeterRow across the fleet tabs, so the failure is invisible and wide.
- **Fix sketch**: `const pct = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;` (and optionally render a muted "—" track when the input isn't finite).

## 6. Opening "Custom" deselects the active preset before Apply
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: state-coherence
- **File**: src/components/org/TimeRangeSelector.tsx:57
- **Scenario**: The window is "90 days". The user clicks "Custom" to explore, then doesn't apply. `active = o.key === "custom" ? customOpen : range === o.key && !customOpen` — so the 90d button loses its highlight the instant Custom opens, while the page still shows 90d data (Apply hasn't run; `selectPreset("custom")` only opens the inputs).
- **Root cause**: `active` is driven by the transient `customOpen` UI intent rather than the applied window, so the highlighted control stops matching what's rendered until Apply.
- **Impact**: Momentary but real ambiguity — the toolbar says "Custom" is selected while the dashboard is still 90d; a user can't tell which window is live.
- **Fix sketch**: Keep the applied preset lit while Custom is merely open (e.g. only mark Custom active once `range === "custom"`, and show the open panel as a separate "editing" affordance rather than a selected state).

## 7. Custom date range: local-day input bucketed at server-local midnight
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: timezone
- **File**: src/components/org/TimeRangeSelector.tsx:75
- **Scenario**: A viewer in UTC-8 picks From = "2026-07-09" in the `<input type="date">`. The bare `yyyy-mm-dd` string is sent through the URL/cookie to `resolveWindow` → `parseDay` = `new Date("2026-07-09T00:00:00")`, interpreted at *server*-local (UTC on Vercel) midnight.
- **Root cause**: The selector emits a wall-calendar date with no zone; the server assigns the zone. On a UTC deployment the boundary is UTC midnight, ~8h earlier than the viewer's local start of that day — so a scan stored near the day boundary can fall on the wrong side of `start`.
- **Impact**: Minor, sub-day boundary skew on custom ranges for non-UTC viewers (presets are unaffected — they snap server-side deliberately). Correctness edge on day-boundary scans, not a crash.
- **Fix sketch**: Either treat the picked date as the viewer's local day and send an explicit offset/UTC instant, or document that custom ranges are UTC-calendar-day bounded so the intent is unambiguous.
