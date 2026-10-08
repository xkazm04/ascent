# The shared public org has no owner

- **Status:** Accepted (2026-10-07, the day the code landed)
- **Date:** 2026-10-07
- **Deciders:** App Master `ascent` and the operator. The non-member import rule is recorded in code as
  "operator decision, ask d0eb7d6c, 2026-10-07" (`src/components/onboarding/importTarget.ts:8`,
  `src/app/api/org/import/route.ts:152`); the no-cadence rule as "operator decision 2026-10-07"
  (`src/app/api/org/import/route.ts:181`, `src/app/api/org/schedule/route.ts:50`).

## Constraint

The `public` org is the free funnel: anyone may scan into it. Because anyone can reach it, **it has no
accountable owner**, and every owner-only power on it is either refused or becomes a cross-tenant door.

`requireOrgRole` admitted it at any `min`, owner included, for any signed-in viewer, because nobody holds a
role there and `ensureOwnerMembership` refuses to seed one (`src/lib/authz.ts:287-294`, `:308`;
`src/lib/db/members.ts:162`). The scan of 2026-10-07 (`378743f1`, `docs/security/scan-2026-10-07.md`) found
what that meant. `refusePublicOrgAdmin`'s own comment (`src/lib/authz.ts:340-345`) lists it: a free account
could erase every public repo's scan series, rewrite retention, set the LLM provider, grant itself owner or
revoke other people's tokens. The follow-up (`256c1e9b`, findings O1-O14) found more owner/admin routes that
relied on the open gate alone: plan, segments, gate policy, branding, alerts, admission, AI stance,
integrations, billing, forge, live share, skills/memory archive, and the Settings and Members tabs.

Two second-order facts forced the rest. A paid action on an org nobody owns has nobody to charge. And a
non-member who is signed in on the gated cloud cannot scan under another handle's org (`requireOrgAccess`
answers 403, `src/components/onboarding/importTarget.ts:5-7`), so the funnel needed a landing place that is
not a tenant.

## Decision

**Nobody administers the shared public org, on any deployment.** Four parts.

1. **Every admin write refuses `public` through one helper.** `refusePublicOrgAdmin(org)`
   (`src/lib/authz.ts:350`) returns 403 for `public` (trimmed, case-insensitive) and is **unconditional,
   auth-off included**. Routes call it before the role gate: `refusePublicOrgAdmin(org) ??
   (await requireOrgRole(org, "owner"))` (e.g. `src/app/api/billing/checkout/route.ts:69`). 31 non-test route
   files under `src/app/api` reference it at head. Fix series, all 2026-10-07: plan `b92604a9` (the
   follow-up table names it `3a0cd3a0`; both resolve), segments `799cac5f`, gate policy `c08f1b85`, branding
   `1e93418c`, admission `771fc8cc`, AI stance `77493e00`, integrations `7130af7e`, billing `72de461f`,
   forge `9f02775f`, live share `d1040f2e`, skills and memory archive `83317c4f`, alerts `13242dce`, admin
   tabs `cd3f2835`, members `229210ef`. A pre-fix invite to `public` can no longer be redeemed (`09c97629`;
   `src/lib/db/invites.ts:91`, `:191`). The role gate itself stays open on purpose, because report and
   executive reads go through it (`src/lib/authz.ts:292-293`). An operator who must purge `public` uses the
   retention cron or the database (`:348`).
2. **A signed-in non-member on the gated cloud scans a public handle into `public`** (`209466d1`).
   `importOrg` returns `"public"` when there is no installation and the deployment is cloud, gated, and the
   viewer signed in (`src/components/onboarding/importTarget.ts:23-31`). It creates no Membership and
   confers no admin power. The import route requires a signed-in viewer and caps the request at
   `PUBLIC_IMPORT_MAX` repos (`src/app/api/org/import/route.ts:84`, `:156-167`); the scan is charged to the
   viewer's own public-scan allowance, not to `public`.
3. **Billing refuses `public`:** no auto-recharge, checkout or portal (`72de461f`;
   `src/app/api/billing/autorecharge/route.ts:85`, `checkout/route.ts:69`, `portal/route.ts:42`). No one owns
   it, so no one can be charged for it.
4. **`public` takes no autoscan cadence and no bulk scan, from any door** (while an auth stack is live;
   auth-off deployments keep their defaults):
   - the cron seeder skips it: `b50d328c` (`src/app/api/cron/rescan/route.ts:103`, `excludeOrgSlugs`, applied
     in the query's where at `src/lib/db/org-watch.ts:347-355`, so rows that already carry a schedule stop
     seeding with no migration);
   - `/api/org/schedule` accepts only `off`: `8f435425` (`src/app/api/org/schedule/route.ts:53`);
   - import enrols no cadence: `2fdd7909` (`src/app/api/org/import/route.ts:182-191`);
   - `POST /api/org/scan` refuses it: `763343ac` (`src/app/api/org/scan/route.ts:65`);
   - the wizard sends `watch:false` and cadence off even for a stale opt-in: `7e7f0b1d`
     (`src/components/onboarding/importPlan.ts:47`).

   Docs: `537140b3` (`docs/features/fleet/rescan.md`, `docs/features/onboarding/wizard.md`).

## Alternatives that lost

1. **Give `public` a real owner (the operator, or a service account) and let the role gate work.** This makes
   the existing `requireOrgRole` correct with no new helper. It lost because it creates the one account that
   can erase, rebrand, re-key and bill the corpus every user's free scans land in, and it makes the operator
   the accountable party for content they did not choose. The scan's failure was an unowned org that *looked*
   administrable; an owned one would be administrable by someone, forever.
2. **Fix the role gate: make `requireOrgRole("public", ...)` return 403 for admin roles.** One edit, no
   per-route call sites. It lost because `hasOrgRole` callers read `public` through the same gate (the report
   permalink, the executive tab; `src/lib/authz.ts:292-293`), so denying at the gate breaks those reads. The
   helper keeps the gate's open default and names the refusal at each write.
3. **Patch only the routes the scan listed, route by route, with no shared helper.** Cheaper per route. It
   lost because that is how the follow-up found further open routes after the first seven were fixed, and a
   new owner-only route would be open by default. One named, greppable helper makes the omission the
   visible case.
4. **Make `public` a normal metered tenant: allow billing and cadence, charging a pooled owner or the first
   scanner.** Keeps the funnel's autoscan feature. It lost because there is no honest payer: the first
   scanner never agreed to carry others' repos, a pooled owner is alternative 1 again, and every recurring
   rescan would be a standing draw on nobody (`src/app/api/org/schedule/route.ts:50`).
5. **Send non-members to their personal workspace instead of `public`.** Isolates viewers. It lost because
   the individual tier's lens invariant keeps a public repo's series in the shared corpus only, and a
   personal org would fork it (`src/lib/authz.ts:246-248`).

## Consequences accepted

- Nobody, including the operator through the UI or API, can change `public`'s plan, branding, policy, members
  or credentials. Purges go through the retention cron or the database. The refusal is unconditional, so a
  self-hosted operator cannot configure `public` either.
- No recurring or bulk scan of public repos: a repo in `public` is refreshed only when someone rescans it
  from its report page, charged to that viewer. Auth-off deployments (local, demo, seeding) keep the old
  defaults on purpose, so behaviour differs by deployment.
- The refusal is per-route, not structurally enforced: a new admin route on `public` is open until it calls
  the helper. No source-scanning guard like `id-routes-gated.test.ts` covers it at head. That is a gap, not
  a decision.
- Non-members' scans in `public` belong to no one and are visible in the shared corpus.
- Pre-fix residue (grants, memberships, plan changes made on `public` before 2026-10-07) was not swept: the
  operator recorded that nothing is exposed on the hosted site and no residue work is planned
  (`docs/security/scan-2026-10-07.md:174`).
