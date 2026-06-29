# Code Refactor — Backlog Management
> Total: 5 | Critical: 0 High: 1 Medium: 2 Low: 2

## 1. Recommendation-status editing UI + plumbing duplicated between the Backlog components and RecommendationTracker
- **Severity**: High
- **Category**: duplication
- **File**: src/components/org/BacklogPanel.tsx:28-34,47-78 · src/components/org/BacklogItemRow.tsx:138-151 (cross-file: src/components/report/RecommendationTracker.tsx:43-49,156-169)
- **Scenario**: Two recommendation-status editors exist side by side. Both maintain a per-id `savingIds: Set<string>` plus an identical `setSaving(id, on)` toggle helper, an `errors` map cleared on edit, and a PATCH to `/api/recommendations/:id` with the same optimistic/reconcile/error flow. Both render a status `<select>` with byte-identical markup: `className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent disabled:opacity-50"`, `style={{ color: STATUS_ACCENT[item.status] }}`, options mapped over `STATUS_LABEL`.
- **Root cause**: The per-repo report tracker (RecommendationTracker) and the org backlog panel/row were built independently against the same `/api/recommendations/:id` endpoint and the same `STATUS_LABEL`/`STATUS_ACCENT` tokens, so the saving-set helper and the status dropdown were copy-pasted rather than shared. `backlogShared.ts` already centralises the *constants* but not the *control* or the *saving plumbing*.
- **Impact**: Two places to keep in sync — a change to the status dropdown styling, the saving-set semantics, or the PATCH/error contract must be made twice; drift between the report and org views is easy to introduce and hard to notice.
- **Fix sketch**: Extract a `<StatusSelect value status onChange disabled>` component and a `useSavingIds()` hook (the `Set` + `setSaving` toggle) into `backlogShared.ts` (or a sibling `recStatusUi.tsx`); have both `BacklogItemRow` and `RecommendationTracker` consume them. Optionally fold the shared `/api/recommendations/:id` PATCH-error handling into a small helper.

## 2. Org GET-route org-resolution preamble copy-pasted across ~10+ routes
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/api/org/backlog/route.ts:13-18
- **Scenario**: The route opens with the same four-step preamble used by nearly every `/api/org/*` GET handler: `isDbConfigured()` → 503; `searchParams.get("org")`; `if (!org)` → `{ error: "Missing ?org." }` 400; `const denied = await requireOrgRead(org); if (denied) return denied;`. The identical block appears in gate-policy, export, repositories, goals, credits, security/pdf, briefing/pdf, skills, and initiatives routes.
- **Root cause**: Each org route reimplements the DB-guard + org-param + read-authz handshake inline instead of calling a shared resolver. Only the 503 message string varies.
- **Impact**: ~10 hand-maintained copies of an auth/DB gate. A change to the resolution or authz contract (e.g. a new header check, a different status code) must be applied to every route, and an omission silently weakens a tenant boundary.
- **Fix sketch**: Add a helper `resolveOrgRead(request, { feature })` to `@/lib/authz` that returns `{ org }` or a ready `Response` (handling the 503/400/deny in one place); each route becomes `const r = await resolveOrgRead(request, { feature: "backlog" }); if (r instanceof Response) return r;`.

## 3. `IMPACT_RANK` re-declares the canonical impact-weight map
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/org/BacklogPanel.tsx:10
- **Scenario**: `const IMPACT_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };` is declared locally for the "Projected points" tiebreak. The exact same literal already exists as the canonical `IMPACT_WEIGHT` in src/lib/db/org-shared.ts:6, and is re-declared verbatim again in src/components/report/roadmapPieces.tsx:85 and src/lib/onboarding/tracks.ts:288.
- **Root cause**: No client-safe shared constant for impact ordering exists; `IMPACT_WEIGHT` lives in a db-internal module, so UI code keeps re-typing the same three pairs instead of importing one source of truth.
- **Impact**: Four divergent copies of the same ranking. If the impact vocabulary ever changes (e.g. a "critical" tier), every copy must be updated independently; a missed one mis-sorts silently.
- **Fix sketch**: Hoist a single `IMPACT_RANK` (or rename to one shared name) into a neutral, client-importable module (e.g. `@/lib/scoring/constants` or `@/lib/types`) and import it in BacklogPanel, roadmapPieces, tracks, and have `org-shared.IMPACT_WEIGHT` re-export it.

## 4. `BacklogSummary` re-implements a local `Stat` tile instead of the canonical one
- **Severity**: Low
- **Category**: duplication
- **File**: src/components/org/BacklogSummary.tsx:3-12
- **Scenario**: A private `function Stat({ label, value, color })` renders a bordered number tile. A canonical, richer `Stat` already exists at src/components/ui/Stat.tsx (superset props: `sub`, `delta`, `goal`), and other local `Stat`/metric reimplementations exist in FleetMapChrome.tsx:3, app/usage/page.tsx:36, and the pdf documents.
- **Root cause**: The backlog summary needs a *bordered tile* variant whereas `ui/Stat` is intentionally borderless (composed inside a `Surface`), so a one-off was written rather than adding a tile variant — multiplying the "stat block" implementations in the codebase.
- **Impact**: Yet another stat-tile to maintain; label/value typography tweaks intended to be global won't reach this one. Low because the markup genuinely diverges from the canonical component, so consolidation needs a small variant rather than a drop-in swap.
- **Fix sketch**: Add a `tile`/`bordered` variant (or wrap in `Surface`) to `@/components/ui/Stat` and replace the local `Stat` here; align FleetMapChrome's identical `Stat({ label, value, color })` at the same time.

## 5. `INIT_STATUS_LABEL` near-duplicates `STATUS_LABEL` from `backlogShared`
- **Severity**: Low
- **Category**: duplication
- **File**: src/components/org/backlogShared.ts:4-9 (cross-file dup: src/components/org/plan/goalView.tsx:91-96)
- **Scenario**: `backlogShared.ts` exports `STATUS_LABEL` as the canonical rec-status id→label map (`open`/`in_progress`/`done`/`dismissed`). `goalView.tsx` re-declares `INIT_STATUS_LABEL` over the identical four status ids, differing only in casing (lowercase `"in progress"` vs `"In progress"`).
- **Root cause**: The initiative status chip wanted a lowercase rendering, so a parallel map was written instead of deriving from the shared one.
- **Impact**: A second status-id vocabulary that must track the first; adding/removing a status id (the keys are the same `RecStatus` union) requires editing both maps, and they can silently disagree on which ids are valid.
- **Fix sketch**: Derive the lowercase variant from the canonical map — e.g. `INIT_STATUS_LABEL = mapValues(STATUS_LABEL, (s) => s.toLowerCase())` — or have `goalView` import `STATUS_LABEL` and lowercase at the call site, removing the standalone literal.
