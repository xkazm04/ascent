# Code Refactor — Org Branding & White-label
> Total: 4 | Critical: 0 High: 1 Medium: 1 Low: 2

## 1. Owner-gated same-origin POST preamble duplicated across ~8 org API routes
- **Severity**: High
- **Category**: duplication
- **File**: src/app/api/org/branding/route.ts:15-21 (one instance of the family)
- **Scenario**: The branding POST opens with the same 5-line ritual found verbatim in many sibling org routes:
  ```ts
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { org?: string; ... };
  if (!body.org) return NextResponse.json({ error: "Provide { org }." }, { status: 400 });
  const denied = await requireOrgRole(body.org, "owner");
  if (denied) return denied;
  ```
  The identical block (same-origin guard → JSON body parse → `org` presence check → `requireOrgRole(body.org, "owner")` → early-return on denial) appears in at least `org/branding`, `org/briefing/share`, `org/live-share`, `org/gate-policy`, `org/invites`, `org/credits/grant`, `org/llm-provider` (×2 handlers) and `org/llm-provider/test`. The branding and briefing/share copies differ only in the body's TypeScript shape.
- **Root cause**: No shared "owner-gated org POST" wrapper exists, so every new owner mutation copy-pastes the preamble. This is exactly the KNOWN THEME (cross-origin guard duplicated + org-resolution preamble duplicated).
- **Impact**: ~8 routes must be edited in lockstep for any policy change (e.g. tightening the org check, canonicalizing the slug, changing the 400/403 payloads). High drift risk: a single missed copy silently weakens the owner/CSRF gate. Inflates every route file.
- **Fix sketch**: Add a helper in `@/lib/authz` (or a small `lib/api/orgPost.ts`), e.g. `async function requireOwnerOrgPost<T>(request): Promise<{ org: string; body: T } | NextResponse>` that runs `isSameOrigin`, parses the body, validates `org`, and calls `requireOrgRole(org, "owner")`, returning either the parsed `{ org, body }` or the error `NextResponse`. Each route shrinks to `const r = await requireOwnerOrgPost<...>(request); if (r instanceof NextResponse) return r;` then proceeds with `r.org`/`r.body`.

## 2. Cross-origin CSRF reject expression repeated 13+ times — and a divergent hand-rolled copy already drifted
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/api/org/branding/route.ts:17
- **Scenario**: `if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });` is copy-pasted verbatim into 13+ route handlers (branding, briefing/share, live-share, gate-policy, plan, invites ×2, members ×2, credits/grant, llm-provider ×3, report/passport ×2, …). Worse, `src/app/api/org/active/route.ts:20-31` does NOT import the canonical guard at all — it re-implements `isSameOrigin` inline and returns a *different* payload (`{ error: "forbidden" }`), proving the duplication has already produced drift.
- **Root cause**: `isSameOrigin` is centralized in `@/lib/auth`, but the *reject-and-respond* step around it is not, so callers re-type (or re-implement) it.
- **Impact**: Inconsistent error bodies/status across routes; any change to the rejection contract requires touching every caller; the hand-rolled `active` copy can silently diverge from the canonical guard's logic over time.
- **Fix sketch**: Export a single `rejectIfCrossOrigin(request): NextResponse | null` from `@/lib/auth` and replace each `if (!isSameOrigin(...)) return ...` with `const x = rejectIfCrossOrigin(request); if (x) return x;`. Delete the local `isSameOrigin` in `org/active/route.ts` and route it through the shared helper so the error payloads converge. (Folds naturally into the Finding 1 wrapper for the owner-gated subset.)

## 3. `isSafeLogoUrl` is a one-line pass-through wrapper
- **Severity**: Low
- **Category**: structure
- **File**: src/lib/db/branding.ts:34-36
- **Scenario**: `function isSafeLogoUrl(raw: string): boolean { return isSafePublicHttpsUrl(raw); }` adds no logic — it forwards directly to the imported `isSafePublicHttpsUrl`, and is called exactly once (line 47).
- **Root cause**: Needless indirection; the wrapper exists only to host the explanatory comment on lines 27-33.
- **Impact**: Minor — an extra named symbol and an extra hop to follow when reading `setOrgBranding`. Low confusion cost.
- **Fix sketch**: Inline the call (`input.logoUrl && isSafePublicHttpsUrl(input.logoUrl.trim())`) and move the valuable SSRF rationale comment to that call site (or above the `isSafePublicHttpsUrl` import). Removes the dead hop without losing the documentation.

## 4. Default brand accent `#2563eb` magic literal duplicated in BrandingSettings
- **Severity**: Low
- **Category**: duplication
- **File**: src/components/org/BrandingSettings.tsx:12,54
- **Scenario**: The fallback accent colour `"#2563eb"` is hard-coded twice — once as the `brandColor` state seed (line 12) and again as the colour-input fallback when the current value fails `HEX_COLOR_RE` (line 54).
- **Root cause**: The default was copy-pasted rather than named, so the two fallbacks must be kept in sync by hand.
- **Impact**: Trivial but real — changing the default brand colour requires editing two spots, and the two could silently diverge.
- **Fix sketch**: Hoist a `const DEFAULT_BRAND_COLOR = "#2563eb";` (module scope, or co-locate it in `@/lib/branding/color` next to `HEX_COLOR_RE` since it is the canonical brand-colour module) and reference it in both places.
