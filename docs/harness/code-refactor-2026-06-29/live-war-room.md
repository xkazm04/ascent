# Code Refactor — Live War Room
> Total: 4 | Critical: 0 High: 1 Medium: 2 Low: 1

## 1. HMAC share-token sign/verify is near-duplicated across live-share.ts and briefing-share.ts
- **Severity**: High
- **Category**: duplication
- **File**: src/lib/live-share.ts:12-52 ↔ src/lib/briefing-share.ts:13-81
- **Scenario**: Two sibling modules implement the same signed-expiring-token scheme. `sign()` is byte-for-byte identical (`createHmac("sha256", secret).update(payload).digest("base64url")`). `shareSecret()` is identical except the dedicated env-var name (`LIVE_SHARE_SECRET` vs `BRIEFING_SHARE_SECRET`, both falling back to `AUTH_SECRET`). `liveShareEnabled()`/`briefingShareEnabled()` are identical. The mint and verify bodies share the same `payload.sig` framing, the same `lastIndexOf(".")` split, the same `Buffer`/`timingSafeEqual` length-guarded comparison, the same base64url JSON decode, and the same `exp < Date.now()` expiry check. briefing-share.ts even carries the comment "Mirrors lib/live-share.ts (WAR-4)" — this is an acknowledged copy.
- **Root cause**: The second share flow (Executive Briefing, EXEC-6) was built by copying the first (WAR-4) rather than extracting the crypto core. The only real per-flow differences are the env-var name, the default TTL, and the payload field set.
- **Impact**: Security-sensitive HMAC logic now lives in two places — any hardening (e.g. constant-time hardening, encoding change, key rotation) must be applied twice or silently drift. Doubles the surface that must be kept correct and tested (both have parallel `*.test.ts` files testing the same mechanics).
- **Fix sketch**: Extract a generic `src/lib/signed-share.ts` exposing `makeShareCodec({ envVar, defaultTtlMs, encode, decode })` (or a small `signToken`/`verifyToken` pair parameterized by a secret-resolver + a payload (de)serializer). Have `live-share.ts` and `briefing-share.ts` each call it with their env-var name, TTL, and field schema, keeping only their typed `XShareParams` and the `{org, exp}` vs `{org, range, from, to, segment, stack, exp}` codecs. Removes ~40 duplicated lines and single-sources the timing-safe verify.

## 2. Share-link mint POST routes are near-verbatim twins
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/api/org/live-share/route.ts:14-29 ↔ src/app/api/org/briefing/share/route.ts:14-28
- **Scenario**: Both handlers run the identical guard pipeline in the same order: `!xShareEnabled()` → 503 with a "sharing isn't configured (set X_SHARE_SECRET or AUTH_SECRET)" message, `!isSameOrigin(request)` → 403 "Cross-origin request rejected.", parse `body`, `!body.org` → 400 "Provide { org }.", `requireOrgRole(org,"owner")` → return `denied`, `signXShareToken(...)` → 503 "Could not mint a share link." if null, then `return NextResponse.json({ token, path: \`/.../${token}\`, expiresAt })`. The only differences are the env-var name in the 503 string, the path prefix, and that briefing forwards extra `range/from/to/segment/stack` fields.
- **Root cause**: Same copy-from-WAR-4 lineage as finding 1, one layer up. The owner+same-origin+mint envelope is identical; only the payload assembly differs.
- **Impact**: The authz/same-origin/enablement envelope for unauthenticated share links is duplicated, so a fix to that envelope (e.g. rate-limiting, audit logging, a tightened same-origin check) must be made in both routes or drift.
- **Fix sketch**: Add a shared helper, e.g. `mintShareLink(request, { enabled, sign, pathPrefix, notConfiguredMsg, extract })`, that does the enablement/same-origin/body/owner checks and the mint+response, taking a small `extract(body) => params` and a `sign(params)` callback. Each route shrinks to a few lines wiring its module from finding 1.

## 3. Read-only shared-page preamble + Notice component duplicated across the two share pages
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/live/shared/[token]/page.tsx:15-37 ↔ src/app/share/briefing/[token]/page.tsx:18-47
- **Scenario**: Both token-gated pages define a local `Notice({ title, body })` component (same centered-card markup; the briefing one additionally wraps `SiteHeader`/`SiteFooter`) and then run the same preamble: `const { token } = await params;` → `verifyXShareToken(token)` → on failure render `Notice` titled "Link expired or invalid" with the same "...no longer valid. Ask an org owner for a fresh one." copy → `!isDbConfigured()` → `Notice` "No data" / "This deployment has no database configured." → build data → on empty render `Notice` "Nothing to show yet" with the verbatim string `` `No scanned repositories for ${verified.org} yet.` ``.
- **Root cause**: The briefing shared page was modeled on the live shared page; the guard ladder and the three notice states are conceptually one "verify-token → check-db → check-empty → render" shell reproduced per page.
- **Impact**: Two copies of the same empty/error states and the `Notice` primitive; wording or structural changes (and the noindex/`force-dynamic` boilerplate, also duplicated) must be edited twice and tend to drift (the two `Notice`s already differ subtly).
- **Fix sketch**: Extract a shared `SharePageNotice` component (parameterize whether to render the site chrome) and optionally a `verifyShareOrNotice(token, verify)` helper that returns either a parsed payload or a ready `<Notice/>` element, so each page becomes verify → guard → build → render-body. Co-locate the verbatim empty-state copy in one place.

## 4. Dead `LiveRepoSeed` type re-export in LiveWarRoom.tsx
- **Severity**: Low
- **Category**: dead-code
- **File**: src/components/org/LiveWarRoom.tsx:25
- **Scenario**: `export type { LiveRepoSeed };` re-exports the type out of the component module. A repo-wide grep shows no consumer imports `LiveRepoSeed` from `@/components/org/LiveWarRoom` — both pages that import this module (`live/page.tsx`, `live/shared/[token]/page.tsx`) import only the `LiveWarRoom` function, and every actual `LiveRepoSeed` usage (including inside this same file, line 13) imports it directly from `@/components/org/liveWarRoomShared`. No barrel re-exports it either.
- **Root cause**: Leftover convenience re-export from when the type may have been expected to be consumed via the component; the canonical home is `liveWarRoomShared.ts`.
- **Impact**: Minor — a misleading second public surface for the type that suggests two valid import paths and invites drift; no runtime cost.
- **Fix sketch**: Delete line 25. The in-file usage already imports `LiveRepoSeed` from `liveWarRoomShared`, so nothing else changes.

---
### Cross-reference note (not a finding)
The brief flagged a possible "leaderboard rendering dup vs RepoLeaderboard." Confirmed **not** a duplication: `LiveWarRoomLeaderboard.tsx` is a compact absolutely-positioned reshuffling rank list (top-N rows with score bars), while `RepoLeaderboard.tsx` is a full `OrgTable` with checkbox row-selection and a sticky bulk-tag-to-segment action bar. They share no consolidatable markup or logic. The live-share ↔ briefing-share HMAC duplication (finding 1, previously flagged in the Executive Briefing wave) is confirmed real.
