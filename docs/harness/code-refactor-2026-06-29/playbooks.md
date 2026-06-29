# Code Refactor — Playbooks
> Total: 4 | Critical: 0 High: 1 Medium: 2 Low: 1

## 1. PR-write preamble + catch-block error mapping duplicated across 4 PR routes
- **Severity**: High
- **Category**: duplication
- **File**: src/app/api/org/playbooks/[id]/apply/route.ts:27-61, 94-106 (also src/app/api/practices/apply/route.ts:20-53,64-81 · src/app/api/practices/apply-batch/route.ts:35-74 · src/app/api/report/passport/pr/route.ts:26-59,75-89)
- **Scenario**: Every route that opens a draft PR with an org installation token repeats the same opening guard sequence — `isAppConfigured()` → 503 with the verbatim string "...needs the GitHub App installed with contents + pull-request write access.", a session-required 401, `getInstallationIdForOwner(org)` → 403 "Ascent isn't installed on `${org}`. Install the GitHub App (with write access) to open PRs.", then `getInstallationToken(installId)`. The trailing `catch` is even closer to byte-identical: `AppApiError` → status 403/404(/409) with the same "The installation lacks contents/PR write access..." / "GitHub rejected the write..." hints, then `GitHubError` → `err.status ?? 502`, then `console.error("[<tag>] failed", err)` + a generic 500.
- **Root cause**: The team already factored the *inner* write sequence into `applyPracticeToRepo` (src/lib/practices/apply.ts) but deliberately left "each route keeps its OWN auth/tenant gating and HTTP error mapping" inline. That preamble/epilogue is in fact ~95% identical across the 4 routes, so it was copy-pasted (the playbooks/apply header comment literally says "Same trust model... as /api/practices/apply").
- **Impact**: A change to the App-not-installed message, the 401/403 contract, the AppApiError status set, or the error hints must be hand-edited in 4 places and is easy to let drift (playbooks/apply already omits the 409 branch that practices/apply and passport/pr both have). ~30 duplicated lines per route × 4.
- **Fix sketch**: Add two helpers in `src/lib/github/pr-route.ts`: (a) `requirePrWriteContext({ org, request })` returning `{ token, session } | Response` that runs the isAppConfigured/session/installId/getInstallationToken chain (callers already have `org` from their own tenant gate, so this stays org-resolution-agnostic); (b) `mapPrWriteError(err, tag): NextResponse` that encapsulates the AppApiError/GitHubError/console.error+500 mapping (accept an `allow409` flag for the routes that refuse to clobber). Each route then calls the gate, the helper, and `return mapPrWriteError(err, "playbooks/apply")` in catch.

## 2. Repo tenant-validation block duplicated between the two playbook write routes
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/api/org/playbooks/[id]/repos/route.ts:25-30 and src/app/api/org/playbooks/[id]/apply/route.ts:46-50
- **Scenario**: Both routes resolve the org from the playbook, then run the identical 4-line coordinate check: `parseRepoUrl(repo)` → 400 "Provide { repo: 'owner/name' }.", then `parsed.owner.toLowerCase() !== org.toLowerCase()` → 400 "Repo must belong to `${org}`." and build `${owner}/${repo}`. The repos route's own comment admits it: "Tenant gate on the repo coordinate — mirror the PR-apply route (apply/route.ts:47-51)."
- **Root cause**: A security hardening was applied to one route and copied verbatim into the sibling rather than extracted, so the two now carry the same logic and the same two user-facing strings.
- **Impact**: The two messages / the owner-match rule can silently diverge; a future repo-coordinate rule (e.g. allowing org aliases) must be edited in both. Small but exact, spanning 2 files.
- **Fix sketch**: Add `parseOrgRepo(repo: string | undefined, org: string): { fullName, owner, repo } | Response` next to `resolvePlaybookOrg` in `src/lib/org/playbook-gate.ts` (it already owns the per-row playbook contract). Both routes call it and branch on `instanceof Response`.

## 3. PlaybookRow row-mapping duplicated inside db/playbooks.ts
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/db/playbooks.ts:54-64 and 116-130
- **Scenario**: `listPlaybooks` maps a Prisma row to `PlaybookRow` (`id, title, dimId, summary, steps: parseSteps(p.steps), createdBy, createdAt: p.createdAt.toISOString(), version, updatedAt: p.updatedAt.toISOString()`); `getPlaybook` repeats the same 9-field object literal verbatim.
- **Root cause**: The same DB→DTO mapping was inlined in both the list and single-fetch paths instead of being shared.
- **Impact**: Adding/renaming a `PlaybookRow` field (or changing the steps/date serialization) requires editing both literals in lockstep; an omission yields a subtly different shape between list and detail. ~10 duplicated lines in one file.
- **Fix sketch**: Add a private `toPlaybookRow(p: Prisma.PlaybookGetPayload<...>): PlaybookRow` and have both functions `return rows.map(toPlaybookRow)` / `return toPlaybookRow(p)`.

## 4. Slugify expression reinvented inline (no shared helper)
- **Severity**: Low
- **Category**: duplication
- **File**: src/app/api/org/playbooks/[id]/apply/route.ts:23 (cf. src/lib/standard/maintain.ts:58)
- **Scenario**: The apply route defines `const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "playbook";`. `standard/maintain.ts:58` carries the same slugify shape with different bounds (`slice(0, 40)`, `/^-|-$/g`, `|| 'note'`). No shared `slugify` util exists in the repo.
- **Root cause**: A common "title → URL/path/branch slug" operation was hand-rolled per call site, so each copy picked its own length cap and trim regex.
- **Impact**: Minor, but the branch name and the committed `docs/playbooks/<slug>.md` path both depend on this expression; any future tweak (e.g. collapsing consecutive dashes already handled, or unicode handling) won't propagate. Low because each instance is a single expression with intentionally different parameters.
- **Fix sketch**: Add `slugify(s: string, { max = 60, fallback = "item" } = {})` to a shared util (e.g. `src/lib/text.ts`) and call it from both sites; keep per-site `max`/`fallback` as args.
