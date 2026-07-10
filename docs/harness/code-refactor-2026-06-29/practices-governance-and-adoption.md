# Code Refactor — Practices, Governance & Adoption
> Total: 5 | Critical: 0 High: 1 Medium: 2 Low: 2

## 1. PR-write auth/install/token preamble duplicated across every "open a draft PR" route
- **Severity**: High
- **Category**: duplication
- **File**: src/app/api/practices/apply/route.ts:20-58 · src/app/api/practices/apply-batch/route.ts:34-81 · (corroborating, out of scope) src/app/api/org/playbooks/[id]/apply/route.ts:27-69 · src/app/api/report/passport/pr/route.ts:~40-55
- **Scenario**: Both in-scope write routes run the identical guard-then-resolve sequence before doing any work: `isAppConfigured()` → 503; `const session = isAuthConfigured() ? await getSession() : null` → 401; `requireOrgAccess(owner)` → early-return; `getInstallationIdForOwner(owner).catch(()=>null)` → 403 with the verbatim string `` `Ascent isn't installed on ${owner}. Install the GitHub App (with write access) to open PRs.` ``; then `getInstallationToken(installId)` + `getOrgId(owner.toLowerCase()).catch(()=>null) ?? undefined`. The 503/401/403 strings differ only by "PR" vs "PRs". The "isn't installed" 403 string is copy-pasted in 4 files (apply:47, apply-batch:71, playbooks:58, passport/pr:52).
- **Root cause**: When the inner write sequence was extracted to `applyPracticeToRepo` (src/lib/practices/apply.ts), the *outer* App-config/auth/tenant/installation-token gate was left inline in each route. The read path already has the canonical analogue — `resolveScanAuth` in src/lib/scan.ts ("authorize-before-mint") — so the write path is the missing twin, not a new idea. apply-batch's own header comment even says "Same trust model as /api/practices/apply".
- **Impact**: A change to the write-trust model (e.g. tightening org access, swapping the install lookup, fixing the 403 copy) must be edited in 4 places and silently drifts if one is missed — and this is the security-sensitive customer-repo WRITE gate, the worst place to drift. ~15 duplicated lines × 4 routes.
- **Fix sketch**: Add `resolveOrgWriteAuth(owner: string): Promise<{ token: string; orgId?: string; session: Session | null } | Response>` next to `applyPracticeToRepo` (or in a small `lib/github/write-gate.ts`), folding the App-config/auth/`requireOrgAccess`/installId/token/orgId steps and single-sourcing the 503/401/403 strings. Each route then does `const gate = await resolveOrgWriteAuth(owner); if (gate instanceof Response) return gate; const { token, orgId, session } = gate;` and keeps only its own body parsing + success shaping.

## 2. AppApiError → HTTP-status/hint mapping repeated in every write route's catch block
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/api/practices/apply/route.ts:64-81 · (corroborating) src/app/api/org/playbooks/[id]/apply/route.ts:94-106 · src/app/api/report/passport/pr/route.ts:~78-95
- **Scenario**: The catch blocks repeat the same `AppApiError` triage: narrow `err.status` to 403/404(/409) else 502, and emit hint strings — the 403 hint `"The installation lacks contents/PR write access — update the GitHub App's permissions."` is byte-for-byte identical in 4 files, and the generic `"GitHub rejected the write. Check the repo and base branch."` is shared too. apply-batch carries a condensed copy of the same mapping in its per-repo worker (route.ts:96-104).
- **Root cause**: Same as #1 — the shared inner pipeline throws typed errors for callers to map, but each caller re-implements the identical mapping table instead of a shared translator.
- **Impact**: Rewording a hint or adding a status (e.g. surfacing 422) means editing 3-4 catch blocks; they already differ slightly (apply handles 409, playbooks doesn't), so the copy is drifting. Moderate, security-adjacent (error surface of a write path).
- **Fix sketch**: Extract `appWriteErrorResponse(err: unknown): NextResponse | null` returning the mapped JSON+status for `AppApiError`/`GitHubError` (and `null` to fall through to the generic 500). Each route's catch becomes `const mapped = appWriteErrorResponse(err); if (mapped) return mapped; console.error(...); return genericError;`. apply-batch reuses the same hint constants for its per-repo `error` strings.

## 3. `policyText` / `gateQuery` / `ciWith` triplicate the GatePolicy condition enumeration
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/org/governance.ts:69-106
- **Scenario**: Three sibling functions each walk the same GatePolicy conditions in a different output format: `policyText` → human bullets, `gateQuery` → URL params, `ciWith` → GitHub-Action `with:` lines. The shared spine (minLevel, minOverall, minDimension, the D9 floor, the `ungoverned` posture, `requireProtectedBranch`) is enumerated three times. The code comment at lines 82-85 explicitly warns: "gateQuery + ciWith MUST emit every condition policyText shows — otherwise the dashboard enforces a bar the copyable CI snippet / gate URL silently drops (policy drift)."
- **Root cause**: One concept (the set of gate conditions) is expressed as three parallel hand-maintained switch-bodies rather than a single descriptor list, so keeping them in sync is a manual discipline the comment is trying to enforce by prose.
- **Impact**: Adding/renaming a policy condition requires editing three functions in lockstep; miss one and the dashboard, the gate URL, and the CI snippet disagree — the exact "policy drift" the module is architected to prevent. (Note: gateQuery/ciWith are a deliberate *subset* — they only expose D9 + `ungoverned` + protection, not the full `minDimensionFor` map / arbitrary `forbidPostures` — so the table must allow per-format opt-out.)
- **Fix sketch**: Define one `GATE_CONDITIONS` descriptor array, each entry `{ applies(p), text(p), queryParam?(p): [key,val] | null, ciLine?(p): string | null }`. Derive all three outputs by mapping over it (`policyText` uses `text`, `gateQuery`/`ciWith` filter to entries whose query/ci projector returns non-null). Keep the per-dim `minDimensionFor` loop as one descriptor that fans out. Drift becomes impossible by construction.

## 4. `RepoContext` (practice-artifact) duplicates `RepoContextMeta` (github/source)
- **Severity**: Low
- **Category**: duplication
- **File**: src/lib/practice-artifact.ts:14-20 (vs src/lib/github/source.ts:185-191)
- **Scenario**: `RepoContext` declares `{ fullName; name; description?; primaryLanguage?; defaultBranch? }` — the all-optional twin of `RepoContextMeta` `{ fullName; name; description: string|null; primaryLanguage: string|null; defaultBranch: string }`. `buildArtifact(practiceId, ctx: RepoContext)` is the only consumer, and in every real call site it is fed a `RepoContextMeta` (from `fetchRepoContext`, via the generate route and `applyPracticeToRepo`). Two interface names describe one "minimal repo metadata for artifact tailoring" concept.
- **Root cause**: The artifact builder was written with a defensively looser local type instead of importing the producer's type, so the same shape now exists twice.
- **Impact**: Minor but real: a reader must reconcile two near-identical types, and a field added to `RepoContextMeta` won't reach `buildArtifact` without a parallel edit. Low.
- **Fix sketch**: Delete `RepoContext` and have `buildArtifact`/`ciWorkflow` accept `RepoContextMeta` (imported from `@/lib/github/source`), or alias `export type RepoContext = RepoContextMeta` if the looser optional shape is genuinely wanted for keyless callers. Update the test's local fixtures accordingly.

## 5. Batch-result contract typed twice (client `BatchResult` vs server `RepoResult`); `number` returned but unused
- **Severity**: Low
- **Category**: duplication
- **File**: src/components/org/PracticeApply.tsx:15-21 (vs src/app/api/practices/apply-batch/route.ts:25-32)
- **Scenario**: The apply-batch response row is declared on the server as `RepoResult { repo; ok; url?; number?; reused?; error? }` and re-declared on the client as `BatchResult { repo; ok; url?; reused?; error? }`. The shapes are the same except the client drops `number` — which the server populates (route.ts:95) but the component never reads, so that field travels the wire for nothing.
- **Root cause**: No shared contract type for the route's JSON; each side hand-rolls its own, and they've already drifted by one field.
- **Impact**: Low — the client/server boundary is a legitimate reason types aren't directly imported, but the silent `number` divergence shows the copies aren't kept honest, and a future field change must be mirrored manually.
- **Fix sketch**: Export the row type once (e.g. `export interface BatchApplyResult` in a shared `lib/practices` types module the route imports and the component re-imports as a `type`), then either consume `number` in the UI or drop it from the response. Collapses two declarations to one and removes the dead field.
