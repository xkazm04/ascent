# Bug Hunter — Org Dashboard & Views (ascent)

> Total: 6 findings (Critical: 1, High: 1, Medium: 2, Low: 2)
> Files read: 14
> Scope: /org/[slug]/* pages, components/org/*

## 1. IDOR: any signed-in user can read any org's (private) dashboard
- **Severity**: Critical
- **Category**: functionality
- **File**: src/app/org/[slug]/layout.tsx:44-60 (and every sub-page: page.tsx:67, contributors/page.tsx:32, delivery/page.tsx:31, practices/page.tsx:11, repositories/page.tsx:14)
- **Scenario**: Sign in as user A (installed only on org `acme`). Navigate to `/org/megacorp` (a private org you have no GitHub-App installation for). The layout's only auth check is `if (isAuthConfigured() && !session)` — it verifies you are *someone*, never that you *own this slug*. `getOrgRollup("megacorp")` (org.ts:559) does `prisma.organization.findUnique({ where: { slug } })` with no session/installation filter, so the full fleet renders: private repo full names, maturity scores, contributor logins/commit counts, bus-factor/key-person flags, branch-governance gaps, and the org's whole practice library. The drill-down tabs are identical — none authorize.
- **Root cause**: Authorization exists (`authz.ts` `requireOrgAccess`/`sessionOwnsOrg`, `auth.ts` `readableOrgForOwner`) and is correctly applied on the *write* path (`/api/org/scan/route.ts:29` calls `requireOrgAccess(org)`), but the *read* path treats the slug as a trusted, self-authorizing parameter. "Authenticated" was conflated with "authorized for this tenant."
- **Impact**: IDOR/authz — cross-tenant disclosure of private repo names, scores, and contributor PII for any org that has ever been scanned.
- **Fix sketch**: In `layout.tsx`, after resolving the session, gate the slug: `if (isAuthConfigured() && !(await sessionOwnsOrg(slug)) && slug !== PUBLIC_ORG) notFound();` — one guard in the shell protects every sub-page (which "assume valid data" per the layout's own doc-comment).

## 2. Auth-disabled deployments expose every org slug with zero gating
- **Severity**: High
- **Category**: functionality
- **File**: src/app/org/[slug]/layout.tsx:44-45
- **Scenario**: On any deploy where `GITHUB_OAUTH_CLIENT_ID`/`SECRET`/`AUTH_SECRET` aren't all set, `isAuthConfigured()` returns false, so `if (isAuthConfigured() && !session)` short-circuits and the dashboard renders for *anyone unauthenticated*. A "local/demo" instance reachable on a LAN/preview URL, or a prod box where `AUTH_SECRET` was dropped from the env, silently serves every org's private fleet data to the open internet with no sign-in prompt.
- **Root cause**: The "auth-off is open" convention (intended for local dev, mirrored in `authz.ts`) is applied to a multi-tenant *read* surface that ships private data. There is no Next middleware (`authz.ts` notes none exists at `src/middleware.ts`), so misconfiguration fails fully open instead of closed.
- **Impact**: silent failure / authz bypass — a single missing env var turns the whole org dashboard public with no visible symptom.
- **Fix sketch**: Don't equate "auth not configured" with "no authorization needed" for reads of non-`public` slugs; require a session (or redirect to a setup notice) whenever the slug isn't `PUBLIC_ORG`, regardless of `isAuthConfigured()`.

## 3. OrgScanButton silently drops per-repo scan failures
- **Severity**: Medium
- **Category**: functionality
- **File**: src/components/org/OrgScanButton.tsx:34-41
- **Scenario**: Trigger "Scan all watched." The route emits a `repo` event per repo, and on failure sends `send("repo", { repo, error: msg })` (scan/route.ts:99). The client's `readSSE` handler only branches on `event === "progress"` and `event === "error"` — it ignores every `repo` event entirely. So if 3 of 10 repos fail (bad token, deleted repo, GitHub 403), the progress bar still marches to 10/10, the button returns to its idle "Scan all" label, and the UI gives zero indication anything failed. The failure surfaces only later as a "⚠ scan failed" badge on the Repositories tab after `router.refresh()` re-reads `recordScanOutcome` — easy to miss, and absent from the button's own feedback.
- **Root cause**: The SSE consumer handles only the happy-path events; the per-repo `error` channel the server explicitly emits has no client handler, so partial failure reads as full success.
- **Impact**: misleading dashboard / silent failure — user believes a clean fleet scan completed when repos were skipped.
- **Fix sketch**: In the `readSSE` callback, handle `event === "repo"` and accumulate `data.error` into a failed-repo count, then show "Scanned X, Y failed" when `running` clears.

## 4. Progress denominator is wrong for scoped scans until the first event
- **Severity**: Medium
- **Category**: functionality
- **File**: src/components/org/OrgScanButton.tsx:19-22, 47, 58
- **Scenario**: Click "Stale only" (`run({ staleOnlyDays: 14 })`). The button initializes `total: watchedCount` (the full watched count from the layout, `layout.tsx:62`), so it immediately renders "Scanning 0/12…" even though the server-side stale filter (scan/route.ts:41-44) may scope the run to, say, 3 repos. `total` only self-corrects once the first `progress` event arrives with the real `total`. If the scoped set is empty, the server sends only `event:"error"` ("No watched repositories matched the scan scope") and *no* progress — `pct` stays computed against the wrong denominator and the count never reconciles before the error replaces it. The displayed N is fabricated client-side rather than reflecting the actual scoped job.
- **Root cause**: The client guesses the job size from a different source (`watchedCount` prop) than the server uses to build the job (`listWatchedRepos` + scope filters), so the two can disagree for any scoped run.
- **Impact**: UX / misleading progress — wrong "X/Y" during the most common token-saving path.
- **Fix sketch**: Start `total: 0` (or `current: "starting…"` with no count) until the first `progress`/`result` event sets the authoritative total, instead of seeding it from `watchedCount`.

## 5. Heatmap renders a fabricated "0" for dimensions a scan didn't emit
- **Severity**: Low
- **Category**: code_quality
- **File**: src/app/org/[slug]/repositories/page.tsx:130-140
- **Scenario**: `DIMS` is derived from the canonical dimension map (ui.tsx:16), which can include a newer dimension (e.g. D9 Security) than an older scan persisted. For such a repo, `byId[d] ?? 0` yields `0`, and the cell renders a colored "0" tile identical to a genuine "scored 0 on Security" result. A repo that was simply scanned before D9 existed looks like it catastrophically *failed* D9. The same `?? 0` feeds `heatCell(v, …)`, so the missing cell is painted as a real low score.
- **Root cause**: Absence of a dimension is collapsed to the value `0` instead of a distinct "not measured" state, conflating "scored zero" with "not scanned for this dimension."
- **Impact**: misleading dashboard — stale-schema repos appear to fail dimensions they were never evaluated on.
- **Fix sketch**: Render a muted "—" placeholder when `byId[d]` is `undefined` (only color/score when the dimension is actually present in `r.latest.dims`).

## 6. Overview re-fetch can render a blank page inside the org chrome
- **Severity**: Low
- **Category**: code_quality
- **File**: src/app/org/[slug]/page.tsx:67-68
- **Scenario**: The layout already proved the org exists and has repos, then renders `<OrgNav>` + children. The overview child independently re-calls `getOrgRollup(slug, win, segmentId)` and does `if (!rollup) return null;`. If that second fetch returns null (DB blip between the two `force-dynamic` queries, or a future code path where the windowed/segmented variant can yield null), the user sees the org header + tab bar with a completely empty body — no error, no empty-state, no explanation. The layout's careful `OrgEmpty` guard is bypassed because the child fetches its own copy.
- **Root cause**: Two independent fetches of the same rollup with divergent fallback behavior (layout shows a friendly empty state; the child renders `null`), so a transient inconsistency degrades to a silent blank rather than a message.
- **Impact**: silent failure — blank dashboard body with no signal to the user that anything went wrong.
- **Fix sketch**: Replace the bare `return null` with a `<SectionEmpty>`/error notice, or pass the layout's already-fetched rollup down so the page doesn't refetch and can't disagree.
