# Code Refactor — Members & Access Control
> Total: 5 | Critical: 0 High: 1 Medium: 3 Low: 1

## 1. Invite routes hand-roll the `recordOrgAudit` resolve-orgId-then-audit tail
- **Severity**: High
- **Category**: duplication
- **File**: src/app/api/org/invites/route.ts:55-60 (sibling: src/app/api/org/invites/accept/route.ts:60-65)
- **Scenario**: The invites POST handler resolves the org id and audits by hand:
  ```ts
  const orgId = (await getOrgId(body.org.toLowerCase()).catch(() => null)) ?? undefined;
  await recordAudit("org.member.invited", {...}, { orgId, actorId: session?.login }).catch(() => {});
  ```
  The accept route repeats the exact same shape for `org.member.invite_accepted`.
- **Root cause**: `recordOrgAudit(action, slug, meta, actorId)` (src/lib/db/scans-audit.ts:57-65) exists for *precisely* this — its doc calls itself "the single home for the 'resolve orgId, then audit on success' tail that every owner-gated org mutation repeats." The sibling member-admin route (src/app/api/org/members/route.ts:60,84) already uses it; the invite routes were written before/around it and never adopted it.
- **Impact**: The audit envelope can drift between sibling routes (e.g. how a missing org is handled, whether `getOrgId` is lower-cased), and every call site re-imports `getOrgId` + `recordAudit` instead of one helper. The same hand-rolled pattern also lingers in org/alerts, org/plan, app/webhook, cron/rescan — this is the in-scope foothold of a broader cleanup.
- **Fix sketch**: In invites/route.ts replace lines 55-60 with `await recordOrgAudit("org.member.invited", body.org, { role: body.role, target: ... }, session?.login).catch(() => {});` and drop `getOrgId`/`recordAudit` from the import, swapping in `recordOrgAudit`. Do the same in invites/accept/route.ts (lines 60-65). The `.catch(() => {})` can stay since `recordOrgAudit` returns a boolean.

## 2. Duplicated "resolve/ensure a User by githubLogin" + synthetic noreply-email literal
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/db/members.ts:57, 80-85, 112-117, 156
- **Scenario**: Four functions each re-derive the same User-by-login access. Two *upsert* a user with the synthetic email — `email: \`${gh}@users.noreply.github.com\`` appears verbatim at lines 83 and 115 — and two `findUnique` the user id:
  - `ensureOwnerMembership` → `user.upsert({ where:{githubLogin:gh}, create:{...email...}, select:{id} })`
  - `setMembershipRole` → near-identical `user.upsert(...)`
  - `getMembershipRole` / `removeMembership` → `user.findUnique({ where:{githubLogin:gh}, select:{id} })`
- **Root cause**: No shared "resolve user id from login" helper, so the GitHub-login→User bridge (and its required-column email hack) is copy-pasted. The noreply-email format is a magic string duplicated across the two writers.
- **Impact**: If the email-synthesis rule or the `select`/`upsert` shape ever changes (e.g. storing avatar, changing the noreply domain), it must be edited in 2-4 places that are easy to miss; the magic string invites a typo that silently creates a second User row.
- **Fix sketch**: Add private helpers in members.ts: `function noreplyEmail(gh: string)`; `async function ensureUserId(gh: string, name?: string | null): Promise<string>` (the upsert) and `async function findUserId(gh: string): Promise<string | null>` (the lookup). Call them from the four sites. ~25 lines collapse to two helpers + four one-liners.

## 3. Last-owner transactional guard duplicated across `setMembershipRole` and `removeMembership`
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/db/members.ts:124-133, 167-170
- **Scenario**: Both mutators run the same in-transaction "don't orphan the last owner" check:
  ```ts
  if (<row>.role === "owner") {
    const owners = await tx.membership.count({ where: { orgId, role: "owner" } });
    if (owners <= 1) return "last_owner" as const;
  }
  ```
- **Root cause**: The guard was written inline in each transaction. It is the single most safety-critical invariant in this module (refusing to orphan an org), yet it lives in two copies.
- **Impact**: The two copies can diverge — e.g. one gets a `role === "owner"` tweak the other misses — silently weakening the orphan-protection on one path. Concentrating sensitive authz logic also makes it easier to review.
- **Fix sketch**: Extract `async function isLastOwner(tx, orgId): Promise<boolean>` (the `count <= 1` check) and call it from both transactions: `if (existing?.role === "owner" && await isLastOwner(tx, orgId)) return "last_owner"`. Keeps the per-function early-return semantics while making the invariant single-sourced. (Note: `tx` is the Prisma transaction client — type it via `Prisma.TransactionClient`.)

## 4. Verbatim cross-origin (CSRF) guard repeated on every mutating org route
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/api/org/members/route.ts:40,71 and src/app/api/org/invites/route.ts:28,66 (+ ~13 more sites repo-wide)
- **Scenario**: The identical line `if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });` is copy-pasted at the top of every mutating handler — 2× in the members route, 2× in the invites route, and ~13 further sites (org/alerts, org/plan, org/branding, org/credits/grant, org/live-share, org/llm-provider, report/passport/*, …).
- **Root cause**: There is no shared "reject cross-origin" helper; each new mutation route re-types the guard (the accept route even subtly reformats it onto two lines, src/app/api/org/invites/accept/route.ts:23-25).
- **Impact**: The 403 message/status can drift between routes, and a future change (e.g. logging rejected origins, tightening the check) means touching ~17 files. A copy-paste omission would silently drop CSRF defense-in-depth on a privilege-changing endpoint.
- **Fix sketch**: Add `export function rejectCrossOrigin(request: Request): NextResponse | null` to src/lib/auth (returns the 403 response or null) and replace each site with `const xo = rejectCrossOrigin(request); if (xo) return xo;`. One source of truth for the message + status.

## 5. Slug/login canonicalization (`.trim().toLowerCase()`) re-inlined instead of reusing a helper
- **Severity**: Low
- **Category**: duplication
- **File**: src/lib/authz.ts:18,51,73,107,183 and src/app/api/org/members/route.ts:30,45,73 (vs the existing `normalizeLogin` in src/lib/db/members.ts:34)
- **Scenario**: Org-slug canonicalization is written inline as `org.trim().toLowerCase()` (and `viewer.login.trim().toLowerCase()`) in five spots in authz.ts and three in the members route, while members.ts already defines `normalizeLogin(login) = login.trim().toLowerCase()` for the same operation — used only locally.
- **Root cause**: The canonicalization idiom predates any shared helper; `normalizeLogin` exists but is private to members.ts, so callers re-inline the same expression.
- **Impact**: Minor, but the rule "how an org slug is canonicalized" is load-bearing for the IDOR/audit-agreement guarantees the comments stress (gate, mutation, and audit must agree on the slug). Eight inline copies is eight chances to forget the `.trim()` and let a case/space-divergent slug through.
- **Fix sketch**: Promote a single `canonicalizeOrgSlug(s: string)` (and reuse `normalizeLogin`) from a shared module (e.g. src/lib/org-constants.ts) and import it at the inline sites. Low priority — the idiom is short and the current copies are consistent today.
