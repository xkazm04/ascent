# Code Refactor — Credits & Entitlements
> Total: 5 | Critical: 0 High: 0 Medium: 3 Low: 2

Notes on the two KNOWN THEMES that turned out to be already-clean (verified, NOT flagged):
- *entitlement plan limits duplicate plans.ts*: `entitlement.ts` does not carry its own tier table — it
  delegates entirely to `plans.ts` (`resolveScanCharge`, `scanAllowance`). No duplication remains.
- *credit-estimate cost math overlaps onboarding/importCost*: `importCost.ts` and `InstallationRepos.tsx`
  both *reuse* `MONTHLY_RUNS`/`estimateMonthlyCredits` from `credit-estimate.ts` rather than re-deriving
  the arithmetic. Clean reuse, not duplication.

## 1. credits.ts re-implements the existing `getOrgId()` helper inline three times
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/db/credits.ts:157, 248, 276 (vs src/lib/db/org-rollup.ts:34-39)
- **Scenario**: `countMeteredScansThisMonth`, `getCreditLedger`, and `getCreditReconciliation` each open with
  the identical block
  `const org = await prisma.organization.findUnique({ where: { slug: orgSlug.toLowerCase() }, select: { id: true } }); if (!org) return …;`
  to resolve an org's id from its slug.
- **Root cause**: `src/lib/db/org-rollup.ts` already exports `getOrgId(slug)` which does exactly this
  (normalize-to-lowercase → `findUnique select id` → `id ?? null`, with its own `isDbConfigured` guard).
  The credit module grew its own copies instead of reusing it.
- **Impact**: The "how do we map slug→id" rule (including the lowercase-normalization contract that the
  file's own comments stress) lives in four places; a change to org lookup/casing must be made N times and
  can silently drift between the credit reads and the rest of the DB layer.
- **Fix sketch**: Import `getOrgId` from `@/lib/db/org-rollup` (or the `@/lib/db` barrel) and replace the
  three inline `findUnique({ select: { id } })` lookups with `const orgId = await getOrgId(orgSlug); if (!orgId) return …;`. Pure mechanical swap; behavior identical. (Leave the lookups that also select
  `scanCredits`/`plan` — `getCreditState`, `grantCredits`, `consumeScanCredit` — as-is, since they need more
  than the id.)

## 2. Org layout hand-rolls the `ASCENT_ALLOW_CREDIT_GRANTS` env check that `envBool()` exists to replace
- **Severity**: Medium
- **Category**: cleanup
- **File**: src/app/org/[slug]/layout.tsx:151-152 (vs src/lib/env.ts:14-17, src/app/api/org/credits/grant/route.ts:17-19)
- **Scenario**: The layout computes
  `const grantsEnabled = process.env.ASCENT_ALLOW_CREDIT_GRANTS === "1" || process.env.ASCENT_ALLOW_CREDIT_GRANTS === "true";`
  — the exact `v === "1" || v === "true"` idiom that `envBool(name)` was created to centralize. The grant
  route already wraps the same flag in `grantsEnabled() => envBool("ASCENT_ALLOW_CREDIT_GRANTS")`.
- **Root cause**: Leftover hand-rolled flag read that predates / skipped the canonical helper. It is
  conspicuously inconsistent: the very next line in the same file (`:159`) correctly uses
  `envBool("ASCENT_ALLOW_PLAN_CHANGES")`. `env.ts`'s own header explicitly calls out "plan/credit-grant
  gates" as the copies it was meant to eliminate.
- **Impact**: The accepted-truthy-token rule is duplicated (so it can diverge from `envBool`), and the
  "are manual grants enabled?" concept exists in two definitions (route `grantsEnabled()` vs layout inline)
  with no shared source — a maintenance/consistency hazard on a money-adjacent gate.
- **Fix sketch**: Replace the two-line expression with `const grantsEnabled = envBool("ASCENT_ALLOW_CREDIT_GRANTS");`
  (helper is already imported in this file). Optionally export `grantsEnabled()` from a shared module so the
  route and the layout read one predicate.

## 3. Identical CSRF/db route-preamble guards duplicated across credits + ~12 org routes
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/api/org/credits/grant/route.ts:22-24 (+ src/app/api/org/credits/route.ts:12); same lines in org/alerts, org/gate-policy, org/live-share, org/invites, org/branding, org/plan, org/members, org/llm-provider, briefing/share, report/passport/* …
- **Scenario**: Every mutating org route opens with the same two-line preamble:
  `if (!isDbConfigured()) return NextResponse.json({ error: "<Feature> require(s) a database." }, { status: 503 });`
  then the byte-identical
  `if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });`
  The second line is copied verbatim into ~12 handlers (the credit-grant route is the one others cite as the
  template).
- **Root cause**: There is intentionally no Next middleware (see `authz.ts` header), so guards are
  per-handler — but the CSRF guard in particular has no per-route variation, so it is pure copy-paste.
- **Impact**: A change to the CSRF response (status, body, header-based check) must be edited in a dozen
  files; an omission on a new money/privilege route is easy to miss because there's nothing to import.
- **Fix sketch**: Add a tiny shared guard in `@/lib/authz` (or `@/lib/auth`), e.g.
  `export function rejectCrossOrigin(req: Request): NextResponse | null { return isSameOrigin(req) ? null : NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 }); }`,
  then `const x = rejectCrossOrigin(request); if (x) return x;` at each call site. (A matching
  `requireDb(feature)` helper could fold the 503 line too.) Mechanical, behavior-preserving.

## 4. `isDuplicateExternalId` duplicates the canonical `isUniqueConstraintError` P2002 classifier
- **Severity**: Low
- **Category**: duplication
- **File**: src/lib/db/credits.ts:57-62 (vs src/lib/db/scans-shared.ts:41-43)
- **Scenario**: credits.ts defines a local `isDuplicateExternalId(err)` that duck-types
  `err.code === "P2002"`. `scans-shared.ts` already exports `isUniqueConstraintError(err)` for the same
  Prisma unique-constraint detection, and `installations.ts`/`sessions.ts` inline the same check yet again.
- **Root cause**: P2002 detection grew several independent copies across the DB layer instead of one shared
  predicate.
- **Impact**: The "what does a unique-constraint violation look like" rule is scattered; minor, but it's one
  more place to update if the detection ever needs to change.
- **Fix sketch**: Consolidate into a single exported helper. NOTE (be careful — preserve behavior): the
  credits version is deliberately *duck-typed* (no `instanceof`) because its test path and the idempotency
  contract throw plain `{ code: "P2002" }` objects, whereas `isUniqueConstraintError` uses
  `instanceof Prisma.PrismaClientKnownRequestError`. Any consolidation must keep the duck-typed form (or
  add a duck-typed variant) so the credit idempotency path keeps working — don't naively swap in the
  instanceof version.

## 5. CreditsControl's local `LedgerEntry` mirrors the server `CreditLedgerEntry`
- **Severity**: Low
- **Category**: duplication
- **File**: src/components/org/CreditsControl.tsx:11-18 (vs src/lib/db/credits.ts:19-28)
- **Scenario**: The client component re-declares a `LedgerEntry` interface (`id, delta, balanceAfter,
  reason, repoFullName, createdAt`) that is a near-subset of the server's exported `CreditLedgerEntry`
  (which adds `scanId`, `actor`, and types `createdAt` as `Date` rather than the JSON `string`).
- **Root cause**: The component hand-maintains its own shape rather than deriving from the canonical type.
  (Unlike the adjacent `Pack` type, which carries an explicit comment justifying the local copy to avoid
  bundling the Polar SDK, `LedgerEntry` has no such bundling constraint — `CreditLedgerEntry` is a plain
  interface in a server-data module with no heavy imports.)
- **Impact**: If the ledger row shape changes, the client type silently drifts from the server's; minor,
  since the component only reads a handful of fields.
- **Fix sketch**: Derive the client type from the canonical one to keep the field set honest, e.g.
  `type LedgerEntry = Pick<CreditLedgerEntry, "id" | "delta" | "balanceAfter" | "reason" | "repoFullName"> & { createdAt: string };`
  (importing only the type erases at compile time, so no SDK/runtime weight is added). If even a type
  import is undesirable across the client boundary, at minimum leave a comment cross-referencing
  `CreditLedgerEntry` as the source of truth.
