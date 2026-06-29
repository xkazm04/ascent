# Code Refactor — Fix Log (ascent, 2026-06-29)

Branch: `vibeman/code-refactor-2026-06-29` (worktree off HEAD `c8e04c3`).
Baseline preserved: **tsc 0 errors · vitest 2630/2630** (170 files) → grows as tests are added.
One fix-subagent per wave (sequential, no concurrent writers); orchestrator runs the full tsc+vitest gate after each wave.

---

## Wave 1 — Cron auth + CSRF guard dedup (Theme A)

**2 commits · 2 High findings closed · gate: tsc 0 · vitest 2638/2638 (171 files, +8 new).**

| Commit | Finding | What |
|---|---|---|
| `d83bffc` | data-retention #1 (H) | Extracted `requireCronAuth(request)` → `src/lib/cron-auth.ts` (+ unit test); cron `purge`/`digest`/`rescan` routes now call it. Byte-identical behavior (503 on unset secret, 401 on bad cred, Bearer + `?key=` matching, fail-closed on empty). |
| `ca6bdfc` | org-import #1 (H) | `/api/org/active` dropped its local `isSameOrigin` copy and imports the canonical one from `@/lib/auth`. Route still returns its own `{error:"forbidden"}` 403. |

Note: the local `isSameOrigin` was currently byte-identical to canonical (the report said "drifted"; it was a latent drift risk, not active). Still worth deduping so it can't diverge.

---

## Wave 2 — `getOrgId` adoption: rollup family + private `resolveOrgId` (Theme B)

**2 commits · top finding (org-slug→id dup ~35×) partially closed · gate: tsc 0 · vitest 2638/2638.**

| Commit | Finding | What |
|---|---|---|
| `b4ce116` | database #1 / repositories-segments #2 (H) | Deleted the private `resolveOrgId` in `segments.ts` + `plan.ts` (10 call sites → canonical `getOrgId`); `scans-shared.ts`'s exported `resolveOrgId` now delegates to `getOrgId` (kept name for out-of-scope callers). |
| `65e1e5b` | fleet-rollups #1 (H) | Replaced ~17 inline `organization.findUnique({where:{slug}})→id` lookups across `org-rollup/insights/signals/contributors/teams` with `getOrgId`. |

Verified `getOrgId` semantics: `isDbConfigured()` guard → `trim().toLowerCase()` slug → `select {id}` → `id ?? null`. Behavior-preservation rests on the upstream invariant that slugs are stored & queried lowercased (scan route + auth + install all lowercase). **Left:** `getOrgRollup` (needs full org row for `plan`) — commented.

---

## Pattern catalogue (durable — grep these shapes proactively in future audits)

1. **Triplicated fail-closed auth gate.** A security check (cron secret, CSRF, role) copy-pasted across sibling routes drifts — one ascent cron route had historically fail-opened. Fix: extract `requireX(request): Response | null` (reject-or-null) and adopt at every site so the policy lives once.
2. **Locally-reimplemented canonical guard.** A helper already exists in `lib/auth`/`lib/site` but a route hand-rolls its own copy (often a stale fork). Fix: delete the copy, import the canonical; preserve the route's exact observable response.
3. **Inline entity-resolver copies vs a canonical resolver.** ~35 inline `findUnique({where:{slug}})→id` lookups duplicated a canonical `getOrgId`. Before adopting, verify the canonical's exact semantics (normalization, missing-value contract, db-guard) match each site, and lean on the upstream invariant (slugs stored/queried lowercased) so normalization is a no-op.
4. **Test mocks that don't mirror production normalization.** A fakePrisma resolved slugs case-sensitively while prod stores lowercase + normalizes on lookup; adopting the normalizing resolver exposed the mock's wrong assumption. Fix the mock to mirror prod, not the code.
