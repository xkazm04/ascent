# Code Refactor — Goals & Initiatives
> Total: 5 | Critical: 0 High: 1 Medium: 3 Low: 1

## 1. The four goals/initiatives route handlers re-state the same preamble
- **Severity**: High
- **Category**: duplication
- **File**: src/app/api/org/goals/route.ts:12-38, src/app/api/org/initiatives/route.ts:13-55, src/app/api/org/goals/[id]/route.ts:26-35
- **Scenario**: Across the 4 CRUD routes the same boilerplate is copy-pasted several ways:
  - **DB guard (4×)**: `if (!isDbConfigured()) return NextResponse.json({ error: "<X> require a database." }, { status: 503 });` appears in goals/route GET+POST, goals/[id] gate, initiatives/route GET+POST, initiatives/[id] PATCH — only the word "Goals"/"Initiatives" differs.
  - **GET-list shape (2×)**: goals/route GET (12-20) and initiatives/route GET (13-21) are line-for-line identical except `listGoals`/`listInitiatives` and the `{ goals }`/`{ initiatives }` key: read `?org`, 400 on missing, `requireOrgRead`, return `{ key: items ?? [] }`.
  - **POST create-result tail (2×)**: `return NextResponse.json(created ?? { error: "Failed to create <X>." }, { status: created ? 200 : 500 });` (goals/route:37, initiatives/route:54).
  - **targetDate ISO validation (2×)**: identical 3-line `if (body.targetDate != null && Number.isNaN(Date.parse(body.targetDate))) { … 400 … }` block in goals/route POST (33-35) and goals/[id] PATCH (26-28) — and inconsistently *absent* from the initiatives routes.
- **Root cause**: Each route file was authored independently against the same authz/db contract; no shared route helpers exist for the org-scoped CRUD shape.
- **Impact**: A change to any cross-cutting rule (the 503 wording, swapping `requireOrgRead`, response envelope) must be hand-applied in up to 5 places; the targetDate check already drifted (initiatives skip it). More handler text to read than logic.
- **Fix sketch**: Add small helpers in `@/lib/authz` or a `@/lib/api/org` module: `dbGuard(resourceLabel)` returning the 503 response (or null); a `listOrgRoute(req, { read, key, load })` wrapper for the two GET handlers; an `invalidIsoDate(v)` predicate for the targetDate check. Reuse across all four routes so they shrink to their resource-specific bits.

## 2. Per-row tenant gate is extracted in goals/[id] but re-inlined in initiatives/[id]
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/api/org/goals/[id]/route.ts:14-19, src/app/api/org/initiatives/[id]/route.ts:17-22; src/lib/db/plan.ts:334-338 & 474-478
- **Scenario**: goals/[id] factors the per-row gate into a private `gate(id)` helper (isDbConfigured → `getGoalOrgSlug` → 404 → `requireOrgAccess`) reused by both PATCH and DELETE. initiatives/[id] PATCH re-inlines the *identical* flow (`getInitiativeOrgSlug` → 404 → `requireOrgAccess`) instead. Underneath, `getGoalOrgSlug` and `getInitiativeOrgSlug` (plan.ts) are near-twin one-liners differing only in `goal`/`initiative`.
- **Root cause**: The reusable `gate()` pattern was introduced on the goals side only and never mirrored to initiatives; the two org-slug lookups were written separately.
- **Impact**: The gate logic now lives in two shapes (helper vs inline), so a fix to the per-row ownership check (e.g. a new role rule) can be applied to goals and missed on initiatives. The twin lookups double the surface for the same Prisma query.
- **Fix sketch**: Lift a shared `rowGate(getOrgSlug, id, notFoundLabel)` (or copy the `gate()` helper into initiatives/[id]); collapse `getGoalOrgSlug`/`getInitiativeOrgSlug` into one `getOwnerOrgSlug(model, id)` (or a tiny generic over the Prisma delegate).

## 3. `organization.upsert` "ensure org" block duplicated in createGoal & createInitiative
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/db/plan.ts:226-230 and 393-397
- **Scenario**: Both `createGoal` and `createInitiative` open with the identical 5-line block:
  `const org = await prisma.organization.upsert({ where: { slug: orgSlug }, update: {}, create: { slug: orgSlug, name: orgSlug === "public" ? "Public Scans" : orgSlug } });`
  The exact same block also recurs across ~6 other db modules (members.ts:86, org-skills.ts:148, org-watch.ts:31, segments.ts:64, playbooks.ts:74, installations.ts:20).
- **Root cause**: No shared "ensure the org row exists" helper; each create path re-implements the upsert (including the `"public" → "Public Scans"` naming rule).
- **Impact**: The public-org naming rule and upsert semantics are restated ~8 times; a change (e.g. default name, adding a created field) means an 8-site sweep. Within scope it is a verbatim 5-line dup across the two creators.
- **Fix sketch**: Add `export async function ensureOrg(slug: string): Promise<{ id: string }>` in `@/lib/db/client` (or plan.ts) wrapping the upsert + naming rule; call it from both creators and migrate the other db modules opportunistically.

## 4. `GoalProgressView` hand-mirrors `GoalProgress` field-for-field
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/org/plan/goalView.tsx:12-35 (vs src/lib/db/plan.ts:185-218)
- **Scenario**: `goalView.tsx` declares `GoalProgressView` — a ~22-field interface whose own comment says it "mirrors GoalProgress from src/lib/db/plan.ts". It is structurally `GoalProgress` with only `achievedAt`/`createdAt` loosened to optional. The same file already does `import type { GoalLaggard } from "@/lib/db/plan"` (line 9), and `GoalProgress` is exported from the `@/lib/db` barrel (index.ts:207), so the source type is reachable.
- **Root cause**: A separate "view" type was created for the client boundary instead of deriving from the already-serializable `GoalProgress`.
- **Impact**: Two ~22-field interfaces for one payload must be kept in lockstep by hand; a new GoalProgress field silently won't reach the UI type (no compile error, no sync test). Pure maintenance tax.
- **Fix sketch**: `import type { GoalProgress } from "@/lib/db/plan"` and define `export type GoalProgressView = Omit<GoalProgress, "achievedAt" | "createdAt"> & { achievedAt?: string | null; createdAt?: string }` (or just re-export `GoalProgress` if the optionality is no longer needed). All current consumers (GoalsPanel, GoalsOverview, LiveWarRoom*) keep working.

## 5. `INIT_STATUS_LABEL` re-states the canonical status vocabulary
- **Severity**: Low
- **Category**: duplication
- **File**: src/components/org/plan/goalView.tsx:91-96 (vs src/components/org/backlogShared.ts:4-9)
- **Scenario**: goalView defines a private `INIT_STATUS_LABEL: Record<string,string>` mapping `open/in_progress/done/dismissed` to labels — the same `REC_STATUSES` vocabulary already canonicalized as `STATUS_LABEL` in backlogShared.ts (which sibling `InitiativesPanel.tsx:7` already imports, and which has a sync test in backlogShared.test.ts). It is a parallel copy differing only in casing ("in progress" vs "In progress").
- **Root cause**: The lowercase chip needed a label map and re-hardcoded the statuses rather than reusing the shared source.
- **Impact**: A 5th status (or a relabel) must be added in two places; the goalView copy has no sync test, so it can silently drift and fall back to the raw id.
- **Fix sketch**: Reuse `STATUS_LABEL` from `@/components/org/backlogShared` (lowercasing at render if the lighter casing is desired, e.g. `STATUS_LABEL[it.status]?.toLowerCase()`), or export a shared `INIT_STATUS_LABEL` derived from `REC_STATUSES` so both surfaces single-source the vocabulary.
