# Connect & Repo Selection — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)

## 1. Privacy disclosure understates the file budget — "≤32 files" vs the real MAX_FILES=50 (+ workflow overflow)
- **Severity**: High
- **Category**: magic-number
- **File**: `src/components/connect/PrivacyNotice.tsx:39`
- **Scenario**: The trust-critical "Where your code goes" notice tells the user "a budgeted sample of your repository's file contents (≤32 files) is sent to {provider}". The actual ingest budget is `MAX_FILES = 50` in `src/lib/github/source.ts:43`, and workflows get a RESERVED quota ON TOP of that (source.test.ts:965-974 asserts `picked.length > 50`). The disclosure understates what leaves the boundary by ~1.5-2x.
- **Root cause**: The number was hand-copied into prose (the stale "≤32" also survives in a comment at `src/lib/analyze/index.ts:296`) instead of being derived from the constant. Nothing ties the disclosure to the code it describes, so the budget was raised without the copy following.
- **Impact**: A factually wrong privacy claim at the exact decision point the component exists for ("accurate, no overclaiming" is its stated contract — it now UNDERclaims data egress). For a compliance-minded org evaluating private-repo scanning, an inaccurate disclosure is worse than none.
- **Fix sketch**: Export `MAX_FILES` (or a `SAMPLE_BUDGET_LABEL`) from `source.ts` and interpolate it: `(≤{MAX_FILES} files, plus CI workflow files)`. Add a unit test asserting the notice's copy contains the constant so the next budget change can't drift silently. Fix the stale `analyze/index.ts:296` comment while there.

## 2. Bulk-action scope mismatch: "Watch all" acts on the FILTERED set, "Schedule watched" acts on the whole org's DB watched set
- **Severity**: High
- **Category**: undocumented-assumption
- **File**: `src/components/connect/InstallationRepos.BulkActionsBar.tsx:33-48`
- **Scenario**: The two bulk controls sit side by side but have different scopes. "Watch all (N)" targets `filtered` (useInstallationRepos.ts:279). "Schedule watched" posts `{org, schedule}` with no fullNames (useInstallationRepos.ts:322-326), and the route's no-fullName branch runs `setWatchedSchedule(body.org, …)` over EVERY watched repo in the org (`src/app/api/org/schedule/route.ts:48-52`) — ignoring the active filter, and including repos watched earlier outside the current view. A user who filters to `private` + a language, watches 5 repos, then picks "daily" has just scheduled daily billable autoscans on all 80 watched repos in the org.
- **Root cause**: The bulk-schedule reuses the fleet-level route body for convenience; the label "Schedule watched" is technically honest but nothing in the UI says "ALL watched, not the N repos you're looking at", while its neighbor button trains the user to expect filter scope.
- **Impact**: Silent billable over-scheduling — each run draws a prepaid credit (the CreditCostStrip exists precisely because this is a commitment moment). The mistake only surfaces later as a drained balance / "autoscans pause at zero".
- **Fix sketch**: Either scope the bulk schedule to `filtered.filter(r => r.state?.watched)` and send explicit `fullNames`, or make the scope explicit in the control: label it `Schedule all ${watchedCount} watched` and echo the count in the confirmation message ("Set daily cadence for 80 watched repos" already does this after the fact — move the number BEFORE the commit, e.g. a `title`/inline count on the select).

## 3. The credit-estimate caveat is a `title` tooltip only — invisible to keyboard, touch, and screen-reader users
- **Severity**: Medium
- **Category**: a11y
- **File**: `src/components/connect/InstallationRepos.CreditCostStrip.tsx:30`
- **Scenario**: The strip's numbers are explicitly an upper bound ("dedup/degraded runs are refunded" — the hook's own comment at useInstallationRepos.ts:365). That qualification lives solely in `title={CREDIT_ESTIMATE_NOTE}` on the `<p>`.
- **Root cause**: `title` was the cheapest disclosure slot. But `title` on a non-interactive element never fires for keyboard users, doesn't exist on touch devices, and is unreliably exposed by screen readers — so the majority of users see "12 credits/month" as an exact charge.
- **Impact**: The billing figure reads as a hard commitment when it's an estimate; users on mobile (a large share of a "check my org" flow) can never discover the refund semantics. WCAG 1.4.13 / general content-on-hover guidance says hover-only content must have an equivalent.
- **Fix sketch**: Render the note as visible fine print (a `text-xs text-slate-600` second line, or an `aria-describedby`-linked disclosure toggle). The note is one sentence — inline it; drop the `title`.

## 4. Two design-token systems on one page: raw slate/emerald literals beside semantic divider/surface/danger tokens
- **Severity**: Medium
- **Category**: visual-inconsistency
- **File**: `src/app/connect/page.tsx:76,160,232` (also `src/components/connect/ConnectDiscovered.tsx:20-31`)
- **Scenario**: The page mixes vocabularies: panels use raw `border-slate-800 bg-slate-900/40` (page.tsx:76,232) while sibling connect components use semantic `border-divider bg-surface/40` (InstallationRepos.tsx:117, ConnectDiscovered.tsx:17, PrivacyNotice.tsx:36). Success notices hardcode `emerald-500/emerald-300` (page.tsx:160,168; ConnectDiscovered's CTA is a solid `bg-emerald-500` button) while errors/warnings use the semantic `danger`/`warn` scale, and every other primary CTA on the page is `bg-accent`. Cadence copy also diverges: RepoRow renders `off` as "no autoscan" (RepoRow.tsx:87) but BulkActionsBar shows raw "off" (BulkActionsBar.tsx:44-46).
- **Root cause**: The page predates the semantic token layer; extracted components adopted it but the shell and success states were never migrated — and there is no `success` token, so each success surface reinvents emerald.
- **Impact**: A theme/palette change now forks the page (surface panels shift, slate panels don't); the emerald "View dashboard" button competes with the accent CTA hierarchy for primary attention; the off/"no autoscan" mismatch makes the two schedule controls look like different vocabularies for the same setting.
- **Fix sketch**: Add a `success` semantic token (border/bg/text triple) and sweep the emerald literals; migrate page.tsx's `slate-800/900` panels to `divider/surface`; give SCHEDULES a single `label()` helper (`off → "no autoscan"`) used by both selects.

## 5. Filter empty state offers no one-click reset — four independent filters must be unwound by hand
- **Severity**: Low
- **Category**: missing-state
- **File**: `src/components/connect/InstallationRepos.tsx:114-115`
- **Scenario**: With query + visibility + watched-only + language all active, "No repositories match your search and filters." renders with no action. The user must remember which of four controls (one of them a `select` that may now be hidden — the language dropdown disappears when `languages` is empty) is excluding everything, and reset each.
- **Root cause**: The `EmptyState` supports `actions` (the zero-repos branch at line 61-65 uses it) but the zero-MATCHES branch was left action-less.
- **Impact**: Dead-end moment in the core selection flow, most likely for exactly the large-org users the filters were built for (hook comment: "Phase 7 — large orgs have hundreds of repos"). Minor, but the fix is one line against an existing affordance.
- **Fix sketch**: Pass `actions={[{ label: "Clear search & filters", onClick: resetFilters }]}` where `resetFilters` sets `query:"" / visibility:"all" / watchedOnly:false / language:"all"` (expose it from useInstallationRepos). Optionally name the culprit: "No matches for “{query}” among private repos".
