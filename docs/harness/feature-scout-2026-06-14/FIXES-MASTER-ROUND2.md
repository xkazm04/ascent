# Feature Scout — direct-to-master round (Wave 4 funnel slice + Wave 7)

> 9 findings closed, committed directly to `master` (PR #2 — Waves 1–2 + the 3 schema items — was merged first).
> Baseline preserved throughout: `tsc` 0 → 0; **vitest 450/450 → 451/451**; `init-sql` parity 26 → 27 → 28; eslint 0; `next build` ✓.

After PR #2 merged, work continued on master per the user's request (skipping notifications/email).
Two clusters shipped: the **monetization funnel slice** (no Stripe) and **Wave 7 (audit/compliance +
CI gate)**.

## Wave 4 — Monetization funnel slice (Stripe deferred)

| Finding | Commit | What shipped |
|---|---|---|
| QUOTA-3 | `c6136a2` | `peekPublicScanQuota` (read-only, no consume) + `GET /api/quota` + a live "scans left this week" meter on the landing page |
| CRED-2 | `d1d49ae` | `src/lib/plans.ts` PLAN_FEATURES (the source of truth the entitlement layer + UI read), data-driven `isUnlimitedPlan`, owner-gated `POST /api/org/plan` (paid tiers behind `ASCENT_ALLOW_PLAN_CHANGES`), public `/pricing` comparison |
| QUOTA-1 | `9c0c643` | "See plans →" upgrade CTA threaded into QuotaBlocked (primary for the signed-in dead-end) / QuotaStaleNotice / QuotaBanner |

**Deferred:** CRED-1 (Stripe Checkout) + CRED-3 (auto-recharge) — the payment integration. User chose to
skip Stripe for now; the funnel (meter → pricing → tiers → upgrade CTA) is in place to wire to checkout later.

## Wave 7 — Audit/compliance + CI gate (6/6)

| Finding | Commit | What shipped |
|---|---|---|
| SEC-3 (bug) | `0ef8b0a` | Audit viewer keyed on `recommendation.status_changed` (never written) → matched nothing + 5 actions rendered "unknown". Drive ACTION_META/FILTERS from ONE action list with correct keys |
| SEC-2 | `0ef8b0a` | Date-range (since/until) + actor filters in the viewer (API already supported them) |
| SEC-1 | `0ef8b0a` | `GET /api/audit?format=csv` (cursor-looped, capped) + a "Download CSV ↓" link carrying the filters |
| GATE-3 | `ef5202c` | runPrGate's catch now posts a `neutral` "couldn't evaluate" check instead of leaving a required check silently absent (which blocked merge forever) |
| GATE-2 | `ef5202c` | A "Re-run" action button on the Check Run + a `check_run` webhook handler (rerequested / requested_action) that re-runs the gate without a new push |
| GATE-1 | `d163519` | `Organization.gatePolicy` JSON (additive migration) + `getOrgGatePolicy`/`setOrgGatePolicy` + `sanitizeGatePolicy`; runPrGate AND buildGovernanceOverview now honor the persisted policy (the App check previously ignored any bar); owner-gated `/api/org/gate-policy` + a GatePolicyEditor on the governance tab |

## Verification (final)

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `vitest run` | 451/451 (54 files) |
| `init-sql` parity | 28/28 (Invite + now exercised additively) |
| eslint (changed) | 0 errors |
| `next build` | ✓ |

GATE-1's migration (`20260614130000_add_org_gate_policy`) was NOT run against a live DB (DB-less repo);
additive nullable JSON column — deploy runs `prisma migrate deploy`.

## Patterns reinforced

- **Read-only sibling of a consuming op** (QUOTA-3): `peekPublicScanQuota` mirrors `consumePublicScanQuota`'s
  identity/window math without the write — so a "before you commit" meter matches the gate exactly.
- **One source of truth for tiers** (CRED-2): `PLAN_FEATURES` feeds both gating and the pricing UI, so
  `pro`/`team` stop being inert marketing and can't drift from what's enforced.
- **Drive paired maps from one list** (SEC-3): the badge metadata and the filter dropdown derive from a single
  action array, so they can't fall out of sync the way the keyed-by-a-typo bug did.
- **Persist + sanitize policy, honored at every call site** (GATE-1): the gate the dashboard shows and the
  gate that blocks merges resolve the same stored, sanitized policy — no more "configured but ignored".

## What remains (from the INDEX)

Wave 5 Planning · Wave 6 Live ops · Wave 8 Growth/onboarding · the Stripe pieces (CRED-1/CRED-3) ·
notifications/email (Wave 3, excluded) · 49 mediums / 4 lows. A future /vibeman run resumes from the INDEX.
