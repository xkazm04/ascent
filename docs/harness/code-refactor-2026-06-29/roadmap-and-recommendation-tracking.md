# Code Refactor — Roadmap & Recommendation Tracking
> Total: 5 | Critical: 0 High: 0 Medium: 3 Low: 2

## 1. Recommendation route preamble (db-503 + id/org/404) duplicated across the three route handlers
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/api/recommendations/route.ts:23-28; src/app/api/recommendations/[id]/route.ts:28-39; src/app/api/recommendations/[id]/events/route.ts:16-26
- **Scenario**: All three handlers open with the same `if (!isDbConfigured()) { return NextResponse.json({ error: "Recommendation … requires a database (Phase 2 feature)." }, { status: 503 }); }` block (only the noun differs: "tracking" / "tracking" / "history"). On top of that, both `[id]` handlers repeat the identical id-resolution + ownership lookup: `const { id } = await ctx.params; const org = await getRecommendationOrgSlug(id); if (!org) return NextResponse.json({ error: "Recommendation not found." }, { status: 404 });`.
- **Root cause**: The shared "is persistence on?" gate and the shared "resolve owning org or 404" gate were copy-pasted per route instead of factored into a helper, because each route was written incrementally.
- **Impact**: A wording or status-code change (e.g. the 503 contract, or the 404 message) has to be made in three / two places and can drift; the per-`[id]` org-resolution + null-check is the security-relevant tenant gate, so divergence there is worse than cosmetic. Adds ~10 boilerplate lines per file.
- **Fix sketch**: Add a small `requireRecDb()` helper returning the 503 `NextResponse` (or `null`) and a `resolveRecOrg(ctx)` helper that awaits params, calls `getRecommendationOrgSlug`, and returns either `{ id, org }` or a 404 `NextResponse`. Both `[id]` handlers then become `const r = await resolveRecOrg(ctx); if (r instanceof NextResponse) return r;`. (The app-wide `isDbConfigured` 503 pattern repeats in many other routes too — a global `dbGate(feature)` is a larger follow-up; keep this finding scoped to the three recommendation routes.)

## 2. Status `<select>` + row-card chrome duplicated between RecommendationTracker and BacklogItemRow
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/report/RecommendationTracker.tsx:142-169; src/components/org/BacklogItemRow.tsx:102-151
- **Scenario**: Both components render the same status dropdown — identical class string `rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent disabled:opacity-50`, the same `style={{ color: STATUS_ACCENT[item.status] }}`, the same `disabled={saving}`, and option `<option>`s built from the status map — and the same row-card shell (`aria-busy={saving}` + `style={{ borderLeftWidth: 3, borderLeftColor: STATUS_ACCENT[...] }}`). The two even enumerate the statuses *differently*: RecommendationTracker maps `(Object.keys(STATUS_LABEL) as RecStatus[])` (line 164) while BacklogItemRow maps `REC_STATUSES` (line 146) — two spellings of the same list.
- **Root cause**: `STATUS_LABEL`/`STATUS_ACCENT` were extracted to `backlogShared.ts`, but the JSX that consumes them (the select widget) was not, so each call site re-implements the control.
- **Impact**: Styling/behavior of the status control can drift between the report tracker and the org backlog; the divergent enumeration source (`Object.keys(STATUS_LABEL)` vs `REC_STATUSES`) is a latent inconsistency if the two maps ever fall out of sync. ~15 duplicated lines across two files.
- **Fix sketch**: Add a shared presentational `StatusSelect({ value, disabled, onChange })` to `src/components/org/backlogShared.tsx` that renders the styled `<select>` and maps over the single canonical `REC_STATUSES` source. Both components consume it; delete the inline `<select>` blocks. Optionally also extract the row-card wrapper if a third caller appears.

## 3. `updateRecommendation` re-reads the same recommendation row twice and re-derives the org chain
- **Severity**: Medium
- **Category**: structure (redundant duplicated logic)
- **File**: src/lib/db/scans-recommendations.ts:51-69, 152-159
- **Scenario**: `updateRecommendation` issues two separate top-level `prisma.recommendation.findUnique({ where: { id } })` calls on the *same* id before the transaction — one for the full `current` row (line 51) and a second, `orgChain`, solely to read `scan.repo.orgId` (lines 65-68). The org-relation traversal in `orgChain` is the same Recommendation → Scan → Repository → Organization walk that the sibling `getRecommendationOrgSlug` (lines 152-159) already implements (one selects `orgId`, the other selects `org.slug`). The test fixture comment (`scans-recommendations.test.ts:46`, "serves the pre-transaction reads", plural) confirms the double read is real.
- **Root cause**: The org-id lookup was bolted on (to make the audit row readable) as a second query rather than folded into the existing `current` fetch via an `include`.
- **Impact**: Two round-trips where one suffices, plus a third copy of the org-traversal relation path that must be kept in sync with `getRecommendationOrgSlug` and the patch-route's own `getRecommendationOrgSlug` call within the same request. Maintenance/consistency cost (this is flagged as code redundancy, not as a perf issue).
- **Fix sketch**: Replace the first `findUnique` with `findUnique({ where: { id }, include: { scan: { select: { repo: { select: { orgId: true } } } } } })`, read `orgId` off `current.scan.repo.orgId`, and delete the separate `orgChain` query. Consider having both org-resolution sites share one selector constant so the relation path is defined once.

## 4. "Fastest path to next level" name-join + accent callout duplicated between NextLevelPath and NextLevelBanner
- **Severity**: Low
- **Category**: duplication
- **File**: src/components/report/roadmapPieces.tsx:105-122; src/components/report/RoadmapSandboxParts.tsx:165-229
- **Scenario**: Both components consume `cheapestPathToNextLevel(...)` and compute the step names with the identical line `const names = path.steps.map((s) => DIMENSION_SHORT[s.dimension]).join(" + ")` (roadmapPieces.tsx:108, RoadmapSandboxParts.tsx:191), then render a near-identical accent callout (`border-accent/20 bg-accent/[0.06] p-3` with a "fastest via {names}" / "reach {target.level} {target.name}" line tinted by `scoreHex(target.score)`). `NextLevelBanner` additionally adds the live gap + "Simulate this path" button, but the static-path headline and the names computation overlap verbatim.
- **Root cause**: The interactive sandbox banner was written as a fresh component rather than building on the static `NextLevelPath`, so the shared "describe the cheapest path" presentation got copied.
- **Impact**: Two places to update if the path phrasing or the names separator changes; small but genuine cross-file duplication of the `names` derivation and the callout shell.
- **Fix sketch**: Extract a `pathStepNames(path)` helper (one-liner) and a small `<FastestPathLine path … />` presentational piece into `roadmapPieces.tsx`; have `NextLevelBanner` render that core and layer its gap + simulate button around it. Low priority — the components diverge enough that full consolidation isn't warranted.

## 5. `RecommendationActor` is an exported type with no external consumer (dead public surface)
- **Severity**: Low
- **Category**: dead-code
- **File**: src/lib/db/scans-recommendations.ts:31-34 (definition); re-exported at src/lib/db/scans.ts:41 and src/lib/db/index.ts:33
- **Scenario**: `RecommendationActor` is defined and re-exported through *both* the `scans.ts` and `index.ts` barrels, but a repo-wide grep shows it is never imported by name anywhere — it is only used inline as the `opts` parameter type of `updateRecommendation` in its own file. (Its sibling `RecommendationPatch` *is* imported by name in `[id]/route.ts`, so that one's export is justified.)
- **Root cause**: The interface was exported "for symmetry" with `RecommendationPatch` when the module was split, but no caller ever needed the named type — `updateRecommendation`'s second argument is always an inline object literal.
- **Impact**: Minor — unused public API surface across two barrels that implies a contract no one consumes; a reader expects to find call sites and finds none. (Note: the interface itself is *not* dead, only its exported-ness; keep it as a local `interface` if not re-exported.)
- **Fix sketch**: Drop `RecommendationActor` from the `scans.ts:41` and `index.ts:33` re-export lists and remove `export` from its declaration (line 31), leaving it a module-local interface. If a future caller needs to type the options object, re-export it then.
