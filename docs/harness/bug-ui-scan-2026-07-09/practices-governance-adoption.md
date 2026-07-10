# Practices, Governance & Adoption — bug-hunter + ui-perfectionist scan

> Context: Practices, Governance & Adoption (group: Org Dashboard & Analytics)
> Files scanned: 13
> Total: 7 findings (Critical: 0, High: 2, Medium: 2, Low: 3)

## 1. `generate` route mints the org's installation token for anyone under the active Supabase wall
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: broken-authz-idor
- **File**: src/app/api/practices/generate/route.ts:31
- **Scenario**: Production runs the Supabase login wall (`authGateEnabled()`); the legacy custom OAuth (`GITHUB_OAUTH_CLIENT_ID`/`AUTH_SECRET`) is unset, so `isAuthConfigured()` returns false (auth.ts:85). The token gate is `if (isAppConfigured() && (!isAuthConfigured() || sessionOwnsOrg(owner)))`. Because `!isAuthConfigured()` is `true`, the whole guard short-circuits — `sessionOwnsOrg` is never called and there is no `requireViewer`/`requireOrgRead`. Any caller (even unauthenticated) POSTs `{repo:"victimorg/private-repo", practiceId:"agent-guidance"}` and gets back an artifact built from `fetchRepoContext`, leaking the private repo's description, primary language, and default branch.
- **Root cause**: the auth predicate keys on the DORMANT `isAuthConfigured()`/`sessionOwnsOrg` (getSession) stack instead of the ACTIVE `authGateEnabled()`/`getViewer`; the brief's "gating on the dormant one is dead-code authz" exactly.
- **Impact**: cross-tenant disclosure of private-repo metadata + existence; also burns another org's installation token. Unlike apply/apply-batch (which correctly use `requireOrgAccess`), this read route has no Supabase-aware gate at all.
- **Fix sketch**: gate token-minting on `authGateEnabled() ? await requireOrgRead(owner)==null` (or `sessionOwnsOrg` rewritten over `getViewer`), and only fall back to the public token for a genuinely public repo. Add a `requireViewer()` at the top when the wall is on.

## 2. Opening/committing PRs to every org repo only requires `member`, not admin/owner
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: insufficient-authorization
- **File**: src/app/api/practices/apply/route.ts:46
- **Scenario**: `apply` and `apply-batch` gate with `requireOrgAccess(owner)`, which passes at `roleAtLeast(role,"member")` (authz.ts:81, ranks viewer<member<admin<owner). A low-trust `member` can push a branch + commit and open a draft PR into *every* repo in the org — a batch of up to 25 from one click. Contrast: editing the gate policy requires `owner` (governance/page.tsx:44) and billing/member-admin require admin/owner.
- **Root cause**: a customer-repo WRITE is treated as an "any member may act" operation; the privilege bar is inconsistent with every other mutation of comparable blast radius.
- **Impact**: within-tenant privilege over-grant; a viewer-adjacent member can spam branches/PRs across the fleet. (Not cross-tenant — owner is server-derived and membership-checked — so High, not Critical.)
- **Fix sketch**: replace `requireOrgAccess(owner)` with `requireOrgRole(owner,"admin")` in both apply routes; keep the read-only `generate` at member/viewer.

## 3. PR-write audit log records no actor under the active auth wall
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/app/api/practices/apply/route.ts:62
- **Scenario**: `actorId: session?.login`, where `session = isAuthConfigured() ? await getSession() : null` (line 27). Under the Supabase wall `isAuthConfigured()` is false, so `session` is always `null` and `actorId` is `undefined` — even though `getViewer()` holds a real identity. Same in apply-batch:41/88. Every `recordAudit("practice.pr_opened", …)` (apply.ts:48) for a customer-repo write is stored with no author.
- **Root cause**: actor identity is read from the dormant getSession stack, not the active viewer — the route header's promise that "every apply is audit-logged" for accountability silently fails in production.
- **Impact**: no attribution for who wrote a PR into a customer repo — the audit trail is a success-theater log exactly where it matters.
- **Fix sketch**: derive the actor via `resolveViewerLogin()` (access.ts:89, spans both stacks) and pass it as `actorId`.

## 4. Fleet batch opens PRs into up to 25 real repos with no confirmation
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: destructive-confirmation
- **File**: src/components/org/PracticeApply.tsx:245
- **Scenario**: "Open draft PRs across N repos →" calls `applyBatch()` immediately on click — no confirm dialog, and (unlike the single flow) no per-repo preview of what will be committed. A misclick writes branches + commits + draft PRs into as many as 25 customer repos at once; undoing means closing 25 PRs and deleting 25 branches by hand.
- **Root cause**: an irreversible-ish bulk write to third-party repos is treated as an ordinary button, with no friction proportional to blast radius.
- **Impact**: accidental fleet-wide PR spam in real GitHub orgs; erodes trust in the product.
- **Fix sketch**: add a confirm step naming the repo count (and practice) before firing; consider a one-repo preview/dry-run summary in the batch panel.

## 5. Single and batch actions aren't mutually locked — concurrent submission on the same repo
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: double-submission
- **File**: src/components/org/PracticeApply.tsx:173
- **Scenario**: The single Preview/Apply buttons disable on `busy`; the batch button disables on `batchBusy` — independent state. While a batch runs, the single "Open draft PR" stays enabled (and vice-versa). Firing a single apply of repo X while a batch that includes X is in flight launches two concurrent `openDraftPr` calls on the same `ascent/<practiceId>` branch, racing the contents PUT/PR POST → one can surface a spurious error.
- **Root cause**: two flows write the same resources but each only guards against itself.
- **Impact**: rare spurious per-repo failure / redundant requests; low because branches are deterministic and idempotent.
- **Fix sketch**: disable the single controls on `busy || batchBusy` and the batch control on `batchBusy || busy !== null`.

## 6. Batch summary reports failures as "Opened"
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: success-theater
- **File**: src/components/org/PracticeApply.tsx:255
- **Scenario**: The amber summary reads `Opened {attempted} of {attempted + skipped}`, but `attempted` = the count the server *tried* (batch.length), which includes per-repo failures (`ok:false`). If 5 of 25 fail, it still claims "Opened 25". The per-repo list below shows the ✗ rows, but the headline overstates success.
- **Root cause**: the summary conflates "attempted" with "succeeded".
- **Impact**: misleading confirmation; a user may believe all repos got PRs.
- **Fix sketch**: compute `ok = results.filter(r=>r.ok).length` and phrase it "Opened {ok} of {attempted} ({fail} failed, {skipped} over the cap)".

## 7. Repo-supplied metadata interpolated unescaped into the committed artifact
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: injection
- **File**: src/lib/practice-artifact.ts:88
- **Scenario**: `ciWorkflow` writes `branches: [${ctx.defaultBranch ?? "main"}]` and the markdown bodies interpolate `ctx.name`/`ctx.description` (lines 116/121) straight from `fetchRepoContext`. A repo whose default branch or description carries YAML/markdown-hostile characters produces a malformed `.github/workflows/ci.yml` (invalid YAML array) or broken markdown in the seeded PR. Paths are hardcoded per practice, so there is no path-traversal exposure — only content well-formedness.
- **Root cause**: repo metadata is a trust boundary but is templated in raw; the generator assumes clean, single-token values.
- **Impact**: a broken workflow file / garbled starter lands in the customer PR; self-repo so security impact is minimal.
- **Fix sketch**: quote the branch (`branches: ["${ctx.defaultBranch ?? "main"}"]`) and clamp/escape `name`/`description` to a safe single line before interpolation.
