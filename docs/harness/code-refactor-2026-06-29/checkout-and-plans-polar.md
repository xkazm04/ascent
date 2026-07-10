# Code Refactor — Checkout & Plans (Polar)
> Total: 5 | Critical: 0 High: 0 Medium: 3 Low: 2

_Scope: src/app/api/billing/checkout/route.ts, src/app/api/billing/webhook/route.ts, src/app/api/org/plan/route.ts, src/lib/polar.ts, src/lib/plans.ts, src/app/pricing/page.tsx (plus cross-references confirmed across the whole `src` tree)._

_Themes explicitly checked and RULED OUT (no finding):_
- _Webhook signature/event-handling shared shape vs the GitHub App webhook — NOT consolidatable. `billing/webhook` uses the `@polar-sh/nextjs` `Webhooks()` adapter (signature handled inside the SDK); `app/webhook` does manual HMAC + replay-defense + `after()` deferral. No duplicated code._
- _Plan-tier constants duplicated with `entitlement.ts` / `db/credits.ts` — NOT duplicated. Both import `resolveScanCharge` / `scanAllowance` / `isUnlimitedPlan` from `lib/plans.ts`; the catalog is genuinely the single source. Well factored._

---

## 1. `Pack` interface re-declares `CreditPack` (avoidable with a type-only import)
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/polar.ts:15-19 (canonical) ↔ src/components/org/CreditsControl.tsx:20-26
- **Scenario**: `lib/polar.ts` exports `interface CreditPack { productId: string; credits: number; label: string }`. `CreditsControl.tsx` re-declares the byte-identical shape as a local `interface Pack { productId; credits; label }`, with a comment that it's "declared locally so this client component never bundles the Polar SDK that lib/polar imports."
- **Root cause**: The stated justification doesn't hold for a **type-only** import. `import type { CreditPack } from "@/lib/polar"` is fully erased by the TS/SWC compiler — it produces zero runtime require of `lib/polar`, so the `@polar-sh/sdk` import on line 10 of `polar.ts` would never reach the client bundle. The local copy is therefore an unnecessary structural duplicate of an exported type.
- **Impact**: Two definitions of the same purchasable-pack shape that must be kept in sync by hand; a future field added to `CreditPack` (e.g. a price hint) silently won't flow to the dashboard control. The misleading "never bundles" comment also discourages anyone from doing the right thing.
- **Fix sketch**: In `CreditsControl.tsx` delete the local `Pack` interface and replace its uses with `import type { CreditPack } from "@/lib/polar"` (aliasing `as Pack` if the local name is preferred). Verify the client bundle is unchanged (type imports are erased, so it will be).

## 2. Plan-string normalization expression repeated 4× in plans.ts
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/plans.ts:77, 131, 138, 146
- **Scenario**: The same "coerce an arbitrary plan string to a known `PlanId`, defaulting to free" expression is open-coded four times:
  - `planFeatures` (l.77): `plan && isPlanId(plan) ? PLAN_FEATURES[plan] : null) ?? PLAN_FEATURES.free`
  - `planAllowsWhiteLabel` (l.131): `const id = plan && isPlanId(plan) ? plan : "free";`
  - `planAllowsSkillsLibrary` (l.138): identical line
  - `planAllowsByom` (l.146): identical line
- **Root cause**: No shared normalizer; each gate re-implements the same guard inline.
- **Impact**: Four copies of one rule. If the default tier or the validation ever changes (e.g. a deprecated alias), every site must be edited in lockstep — easy to miss one and silently mis-gate a feature.
- **Fix sketch**: Add one private helper `function normalizePlan(plan: string | null | undefined): PlanId { return plan && isPlanId(plan) ? plan : "free"; }` and route the four sites through it (`planFeatures` returns `PLAN_FEATURES[normalizePlan(plan)]`; the gates do `const id = normalizePlan(plan)`).

## 3. Capability gates hardcode tier thresholds instead of living in the PLAN_FEATURES catalog
- **Severity**: Medium
- **Category**: structure
- **File**: src/lib/plans.ts:130-148
- **Scenario**: `plans.ts` advertises `PLAN_FEATURES` as "the single source of truth for what each plan includes," and most allotments ARE data there (`includedCredits`, `unlimited`, `seats`, `retentionDays`). But three capability gates are encoded as inline string comparisons outside the catalog: `planAllowsWhiteLabel` → `id === "team" || id === "enterprise"`, `planAllowsSkillsLibrary` → the **byte-identical** `id === "team" || id === "enterprise"`, and `planAllowsByom` → `id === "enterprise"`. Two of the three function bodies are exact duplicates.
- **Root cause**: New per-tier capabilities were bolted on as predicate functions rather than added as flags on `PlanFeature`, so the "source of truth" is split: allotments are data, capabilities are control-flow. The Team-and-up threshold is now duplicated across two functions.
- **Impact**: Adding/repricing a capability means editing function bodies, not the catalog; the two identical Team+ checks can drift apart silently; and the `/pricing` page can't render these capabilities from data the way it renders `includedCredits`/`features`.
- **Fix sketch**: Add boolean fields to `PlanFeature` (e.g. `whiteLabel`, `skillsLibrary`, `byom`) and have each gate read `planFeatures(plan).<flag>` — or, if a strict tier ordering is wanted, add one `planAtLeast(plan, min: PlanId)` helper (using `PLAN_ORDER` indices) and express all three gates through it. Either collapses the duplicated Team+ check to one place and keeps the catalog authoritative.

## 4. `isPlanId` manually enumerates the four tiers, duplicating the PlanId union / catalog keys
- **Severity**: Low
- **Category**: duplication
- **File**: src/lib/plans.ts:71-73
- **Scenario**: `isPlanId` is `return v === "free" || v === "pro" || v === "team" || v === "enterprise";` — a hand-written restatement of the `PlanId` union (l.7), the `PLAN_FEATURES` keys (l.25-65), and `PLAN_ORDER` (l.69).
- **Root cause**: The set of valid tiers is declared in four places that must agree; the runtime guard is a literal copy of the type-level list rather than being derived from the catalog.
- **Impact**: Adding a fifth tier requires editing the union, `PLAN_FEATURES`, `PLAN_ORDER`, AND this guard. Forgetting the guard means a real plan id fails validation (and `/api/org/plan` rejects it); the error message in `org/plan/route.ts:27` ("free|pro|team|enterprise") is yet another copy of the same list.
- **Fix sketch**: Derive the guard from the catalog, e.g. `return Object.prototype.hasOwnProperty.call(PLAN_FEATURES, v);` (or `(PLAN_ORDER as readonly string[]).includes(v)`), so the valid set has a single runtime source. Optionally build the route's error string from `PLAN_ORDER.join("|")` to retire the last copy.

## 5. Org-slug normalization (`.trim().toLowerCase()`) duplicated across checkout, plan, and sibling org routes
- **Severity**: Low
- **Category**: duplication
- **File**: src/app/api/billing/checkout/route.ts:22, src/app/api/org/plan/route.ts:31 (plus org/import:65, org/repos:16, org/members:30/45/73)
- **Scenario**: Each org-scoped route re-derives the canonical slug inline with `(...).trim().toLowerCase()`. `org/plan/route.ts:29-31` even documents the coupling: "Normalize the slug once up front (mirrors the checkout route)."
- **Root cause**: There is no shared `normalizeOrgSlug()` helper (the existing `resolveOrgId`/`ensureOrgId` in `lib/db` are DB lookups, not string canonicalization), so the canonicalization rule is copy-pasted. A self-admitted "mirrors the checkout route" comment is the tell.
- **Impact**: Low individually (one line each), but the canonicalization rule — which is security-relevant since it feeds the owner-gate and the DB write in `org/plan` — lives in ~7 places. If the rule ever needs to change (e.g. strip a leading `@`, NFC-normalize), every route must be updated identically or org resolution drifts between auth and write.
- **Fix sketch**: Add `export const normalizeOrgSlug = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();` to a shared module (e.g. `lib/auth` alongside `PUBLIC_ORG`, or `lib/org`) and use it at each site. Cheap, removes the "mirrors X" coupling comments, and makes the canonical-slug rule single-sourced.
