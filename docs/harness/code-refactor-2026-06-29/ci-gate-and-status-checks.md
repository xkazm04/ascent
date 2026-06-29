# Code Refactor — CI Gate & Status Checks
> Total: 4 | Critical: 0 High: 1 Medium: 2 Low: 1

## 1. GatePolicy → representation projected by four hand-synced functions (already drifted)
- **Severity**: High
- **Category**: duplication
- **File**: src/lib/scoring/gate-comment.ts:134-138 (`policyBits`); src/lib/org/governance.ts:69-80 (`policyText`), :86-95 (`gateQuery`), :97-106 (`ciWith`)
- **Scenario**: Four separate functions each walk the *same* `GatePolicy` fields in the same order — `minLevel`, `minOverall`, `minDimension`, `minDimensionFor.D9`, `forbidPostures`, `requireProtectedBranch` — to render a different surface: the PR-comment footer (`policyBits`), the human-readable list (`policyText`), the gate query string (`gateQuery`), and the GitHub Action `with:` lines (`ciWith`). The code itself flags the hazard: governance.ts:82-85 carries a comment that "gateQuery + ciWith MUST emit every condition policyText shows — otherwise the dashboard enforces a bar the copyable CI snippet / gate URL silently drops (policy drift)."
- **Root cause**: There is no single declarative description of a policy's fields; every consumer re-enumerates them by hand, so adding/renaming a field means editing 4 sites in lockstep.
- **Impact**: The drift has *already happened*: `policyBits` (the sticky PR-comment footer) omits both `minDimensionFor` (the D9 security floor) and `requireProtectedBranch`, so a security-gated or protection-gated PR comment advertises an incomplete policy while `policyText`/`gateQuery`/`ciWith` show the full one. Future fields will diverge again. This is duplication producing divergent, user-visible behavior across the gate's own surfaces.
- **Fix sketch**: Define one ordered field spec, e.g. `const GATE_FIELDS = [{ key, present(p), text, query, ci, bit }, ...]`, and have `policyText`/`gateQuery`/`ciWith`/`policyBits` each `map`/`filter` over it. A new field is then added once. At minimum, move `policyBits` next to `policyText` (or have it call a shared helper) so the comment footer can't omit fields the rest of the gate enforces.

## 2. GatePolicy constructed from raw input in three places + redundant client/server validation
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/scoring/gate.ts:96-131 (`sanitizeGatePolicy`), :270-307 (`policyFromParams`); src/components/org/GatePolicyEditor.tsx:32-45 (`buildPolicy`)
- **Scenario**: Three independent constructors turn an input into a `GatePolicy`: `sanitizeGatePolicy` (untrusted object → clamped/truncated policy), `policyFromParams` (query string → policy with archetype fallback), and the client `buildPolicy` (form state → policy). Each re-enumerates the same six fields and re-implements the same numeric rules. The "a real floor is > 0" rule appears in `sanitizeGatePolicy.floorScore` (gate.ts:105-108), `policyFromParams` (gate.ts:284, 294, 298), with the comments at gate.ts:104 and :283 explicitly noting the rules "must match." `buildPolicy` also clamps the D9 floor `Math.max(0, Math.min(100, …))` (GatePolicyEditor.tsx:39) — work the server then redoes, because the POST route (src/app/api/org/gate-policy/route.ts:36) and `getOrgGatePolicy`/`setOrgGatePolicy` (src/lib/db/org-gate.ts:19,28) all pipe the value back through `sanitizeGatePolicy`.
- **Root cause**: No shared normalizer/field spec; each entry point reinvents clamp + positive-floor + field-pick logic.
- **Impact**: The clamp/floor invariants are maintained by comment ("must match") rather than by code, so they can silently diverge; the client-side clamp in `buildPolicy` duplicates validation the server authoritatively repeats, and reading three near-identical field walks adds maintenance friction.
- **Fix sketch**: Extract the shared scalar helpers (`clampScore`, `floorScore`) to module scope in gate.ts and have `policyFromParams` reuse them. Since the route already sanitizes, simplify `buildPolicy` to assemble raw field values and drop its redundant clamp (let `sanitizeGatePolicy` be the single normalization boundary). Optionally drive all three off the same field spec from finding #1.

## 3. GitHub path-segment encoder duplicated across write.ts and source.ts
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/github/write.ts:55, :102; src/lib/github/source.ts:469 (and the equivalent `encodeRef` at source.ts:124-126)
- **Scenario**: The idiom `path.split("/").map(encodeURIComponent).join("/")` — encode each slash-separated segment but keep raw `/` separators — is copy-pasted at write.ts:55 and :102, and again inline at source.ts:469 (`const encoded = …`). source.ts:124-126 already wraps the identical logic in a named helper `encodeRef(ref)` (with a detailed doc comment explaining *why* whole-string `encodeURIComponent` is wrong), but neither write.ts nor source.ts:469 reuse it.
- **Root cause**: A small but semantically load-bearing GitHub-API encoding rule was inlined instead of being shared; the one named version (`encodeRef`) is private to source.ts.
- **Impact**: Four copies of a tricky encoding (the doc comment notes getting it wrong silently 404s every tree/file read and degrades the scan to a content-less report). A fix or edge case (e.g. handling `..`/empty segments) must be applied in four spots or they diverge.
- **Fix sketch**: Export one helper, e.g. `encodePathSegments(p: string)` (or generalize/export the existing `encodeRef`) from a shared github util, and call it at write.ts:55, write.ts:102, source.ts:469, and source.ts:124-126.

## 4. `SECURITY_DIM` exported but referenced only inside gate.ts
- **Severity**: Low
- **Category**: dead-code
- **File**: src/lib/scoring/gate.ts:10
- **Scenario**: `export const SECURITY_DIM: DimensionId = "D9";` is exported, but a repo-wide grep finds its only use at gate.ts:301 (inside `policyFromParams`). The sibling constant `DEFAULT_SECURITY_MIN` (gate.ts:11) *is* consumed externally (src/lib/org/security.ts:72, plus tests), so the public export there is warranted — `SECURITY_DIM`'s is not.
- **Root cause**: Both security constants were exported together; only one ended up with an external consumer.
- **Impact**: Minor — a wider-than-needed public surface implies external coupling to "D9" that doesn't exist, and invites readers to hunt for callers that aren't there.
- **Fix sketch**: Drop the `export` (make it a module-local `const SECURITY_DIM`), or, if intentional API symmetry with `DEFAULT_SECURITY_MIN` is desired, leave it but note it's unused. Confirmed zero references outside gate.ts before removing.
