# Code Refactor — Org Branding & White-label
> Context group: Org Dashboard & Analytics
> Total: 4 findings (Critical: 0, High: 1, Medium: 1, Low: 2)

## 1. Private-host / SSRF guard duplicated and already drifting across `branding.ts` and `alerts.ts`
- **Severity**: High
- **Category**: duplication
- **File**: src/lib/db/branding.ts:34-63 (and the sibling copy at src/lib/alerts.ts:315-336)
- **Scenario**: `isSafeLogoUrl` (branding.ts) and `validateAlertWebhookUrl` (alerts.ts) both implement the same security-critical rule: "parse a caller-supplied URL, require https, and reject hosts that are loopback / private-range / link-local IP literals." They are two independent hand-rolled implementations of the same outbound-URL safety check, living in two files with no shared helper.
- **Root cause**: The webhook validator (alerts.ts) was written first; when the logo-URL SSRF guard was later hardened (the long comment at branding.ts:25-33 documents tightening it past the old `^https://[^\s]+$` shape), it was authored fresh in branding.ts rather than extracting/reusing the existing alerts.ts logic.
- **Impact**: The two copies have ALREADY drifted, which is the dangerous part. branding.ts additionally blocks CGNAT `100.64.0.0/10` (line 56), IPv6 unique-local `fc00::/7` and link-local `fe80::` (lines 60-61), multicast/reserved `>=224` (line 57), and the `.local` / `.internal` / `metadata.google.internal` hostnames (lines 44-46). alerts.ts (lines 327-333) blocks none of these — so the webhook sink is reachable at e.g. `https://100.64.0.1/...` or `https://[fd00::1]/...` while the logo path is not. Future SSRF hardening must be remembered in two places, and a fix to one silently leaves the other exposed.
- **Fix sketch**: Extract a single pure helper, e.g. `isPrivateOrInternalHost(host: string): boolean` (or a higher-level `assertSafeOutboundHttpsUrl(raw): URL | null`) into a shared module such as `src/lib/security/outbound-url.ts`. Have both `isSafeLogoUrl` (branding.ts) and `validateAlertWebhookUrl` (alerts.ts) call it, keeping their respective wrapper concerns (branding returns boolean; alerts returns `{ok,error}` and also rejects inline credentials + over-length). Behavior-preserving for branding; for alerts it strictly widens coverage to match the stronger branding rules — note `src/lib/alerts.test.ts` already pins some private-host cases and should be extended for the newly-covered ranges. No call-site signature changes.

## 2. "Enterprise" labelling is stale — the feature is gated to Team-and-up
- **Severity**: Medium
- **Category**: cleanup
- **File**: src/components/org/BrandingSettings.tsx:3,43 (also the header comments at src/app/api/org/branding/route.ts:1 and src/lib/db/branding.ts:1)
- **Scenario**: Every in-scope file describes briefing white-label as an "enterprise" feature. The UI is the worst offender: line 3's comment says "owner-only (enterprise)" and line 43 renders a visible `enterprise` tier badge next to the "Briefing branding" heading. The actual server gate is `planAllowsWhiteLabel` (route.ts:26), which `src/lib/plans.ts:114-117` defines as **`team` OR `enterprise`** — and the route comment at route.ts:23-24 even explains the deliberate "so a reseller on Team can brand" decision.
- **Root cause**: The feature was originally Enterprise-only and later opened up to Team (plans.ts:112-113 documents the change). The plan gate and the route's own narrative were updated; the component's user-facing badge/comment and the two db/route file-header comments were not.
- **Impact**: A user-visible inaccuracy — a Team-plan owner sees an "enterprise" badge on a feature they are entitled to, which is confusing and erodes trust. The stale file-header comments also mislead maintainers about the gating tier.
- **Fix sketch**: In BrandingSettings.tsx change the line 43 badge text from `enterprise` to something accurate (e.g. `team+`) and update the line 3 comment from "(enterprise)" to "(Team plan and up)". Align the file-header comments at branding.ts:1 ("enterprise") and route.ts is already accurate in its body but its summary line is fine — adjust branding.ts's "(EXEC-5, enterprise)" to "(EXEC-5, Team+)". Pure doc/label change, no behavior impact.

## 3. Hex-colour validation regex duplicated between server and client
- **Severity**: Low
- **Category**: duplication
- **File**: src/lib/db/branding.ts:73 and src/components/org/BrandingSettings.tsx:53
- **Scenario**: The literal `/^#[0-9a-fA-F]{6}$/` appears in both files — server-side in `setOrgBranding` (to normalize/null a bad colour) and client-side in the `<input type="color">` value guard.
- **Root cause**: The client guard was added to keep the native colour picker from choking on a non-hex stored value, mirroring the server's existing validation inline rather than importing a shared constant.
- **Impact**: Minor. Two sources of truth for the accepted colour format; if the format ever changes (e.g. allow 3-digit shorthand or alpha) one copy could be missed. Low because the regex is trivial and the server remains authoritative.
- **Fix sketch**: Export a shared `HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/` (or an `isHexColor(s)` helper) from `src/lib/db/branding.ts` and import it in BrandingSettings.tsx:53. Behavior-preserving.

## 4. `OrgBranding` re-imported from the `@/lib/db` barrel rather than its defining module
- **Severity**: Low
- **Category**: structure
- **File**: src/components/org/BrandingSettings.tsx:7
- **Scenario**: `BrandingSettings.tsx` imports `type { OrgBranding } from "@/lib/db"` — the aggregate barrel (`src/lib/db/index.ts:62` re-exports it from `@/lib/db/branding`). The type's defining module is `@/lib/db/branding`.
- **Root cause**: Convenience — the barrel is the common import surface for db symbols, so the type was pulled from there too.
- **Impact**: Very minor. A client component reaching into the full `@/lib/db` barrel for a single type can pull the barrel's module graph into client-bundle dependency analysis (it's a type-only import, so erased at build, but it couples the component to the whole db index for editor/typecheck purposes rather than the one small file it needs). Cosmetic; flagged only for completeness.
- **Fix sketch**: Change the import to `import type { OrgBranding } from "@/lib/db/branding";`. Type-only, behavior-preserving. (Leave as-is if the repo convention is to always import db symbols via the barrel — this is borderline and a matter of house style.)

---
_Note: all three files are otherwise clean — no dead exports (`getOrgBranding`/`setOrgBranding`/`OrgBranding`/`BrandingSettings` are all referenced: briefing PDF route, executive page, db barrel, and tests), no leftover console.log/commented-out code, no unused imports. The context is in good shape; finding #1 is the only one with real consolidation value._
