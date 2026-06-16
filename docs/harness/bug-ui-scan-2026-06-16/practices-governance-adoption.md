# Practices, Governance & Adoption — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 1, High: 1, Medium: 2, Low: 1)
> Lens split: bug-hunter 3 / ui-perfectionist 2
> Files read: 11

Scope: practices/governance/adoption pages, `lib/org/adoption.ts`, `lib/org/governance.ts`, `PracticeApply.tsx`, `/api/practices/generate|apply` (+ the in-UI `apply-batch` route it calls). Cross-checked `lib/github/write.ts`, `lib/authz.ts`, `lib/scoring/gate.ts`, `lib/db/org-insights.ts`, `lib/pool.ts`.

The tenant/auth model on the PR-writing routes is **solid** — `apply`, `apply-batch`, and `generate` all correctly require `requireOrgAccess(owner)` / `sessionOwnsOrg(owner)` before minting the org's installation token, and batch forces all repos into one owner so the single gate covers the fan-out. No auth IDOR found. The exploitable surface is in *what the PR writes*, not who can open it.

## 1. Starter "apply" silently overwrites a repo's existing real file with a TODO scaffold
- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: Data loss / overwrite safety (privileged write to customer repos)
- **File**: src/lib/github/write.ts:86-90 (driven by apply/route.ts:59-70, apply-batch/route.ts:90-101)
- **Scenario**: Org owner applies practice `supply-chain-security` (path `SECURITY.md`), `ci-gates` (path `.github/workflows/ci.yml`), or `agent-guidance` (`AGENTS.md`) to a repo that **already has that file** on its default branch with real content. `openDraftPr` creates `ascent/<practice>` off base (so the branch inherits the repo's real `SECURITY.md`), `existingFileSha` finds it, and the code does a `PUT ... { sha }` that **replaces the file body with the generated TODO scaffold**. The draft PR's diff is "delete your real security policy / CI workflow, insert a stub." A maintainer who clicks merge (or an agent told to "fill in the TODOs") destroys the original.
- **Root cause**: `buildArtifact` always emits a fixed canonical path per practice, and `openDraftPr` treats an existing file purely as "needs a sha to update" — it never checks whether the seed would clobber meaningful pre-existing content. There is no "skip if the file already exists / has non-placeholder content" guard.
- **Impact**: Loss of a customer's real CI config, security policy, PR template, or AGENTS.md on merge. On a 25-repo batch this fans out across the whole fleet from one click. This is the highest-leverage hazard on a route whose whole job is writing to real repos.
- **Fix sketch**: Before PUT, fetch the file **on the base branch**; if it exists and is non-trivial (e.g. not already an Ascent-generated stub / not empty), refuse to overwrite — instead seed to a non-colliding path (e.g. `SECURITY.ascent.md`) or return an "already present, skipped" result the UI surfaces. At minimum, never `PUT` with a base-inherited sha; only update files Ascent itself created (detect a marker line in the body).

## 2. Reused-branch / reused-PR path ignores the requested `base`, returning the wrong PR
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: Idempotency / correctness on the write path
- **File**: src/lib/github/write.ts:75-107 (branch `ascent/<id>` from practice-artifact.ts:292)
- **Scenario**: A repo already has an open `ascent/ci-gates` PR targeting `main`. A caller re-applies with `base: "develop"` (the route forwards `body.base` unvalidated — apply/route.ts:66, apply-batch/route.ts:96). `openDraftPr` finds the branch already exists (422 → tolerated, **not recreated off `develop`**), PUTs the file onto the stale branch, then on the create-PR 422 queries `pulls?head=owner:branch&state=open` and returns `open[0]` — **the existing `main`-targeted PR**, reporting `reused: true`. The caller believes they opened/updated a `develop` PR; they got an unrelated one, now with their file force-pushed onto a branch whose history diverged from `develop`.
- **Root cause**: The branch name is keyed only on `practiceId`, not on `base`; the reuse lookup matches on head only and never compares the PR's `base`. "Tolerate already-exists" conflates "same intent" with "any prior run."
- **Impact**: Wrong/confusing PRs, file updated on a branch off the wrong base, `reused` reported for a PR the caller never asked for. Lower frequency than #1 (UI never sends `base`), but any future base selector or API client hits it.
- **Fix sketch**: Include base in the branch name (`ascent/<id>-<base>`) or verify `open[0].base.ref === base` before returning it; if the existing branch's base differs, error clearly rather than silently reusing.

## 3. Governance "closest to green" failCount double-counts dimensions vs the deduped UI label
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: Analytics / governance math edge case
- **File**: src/lib/org/governance.ts:148-154 (`failCount: result.failures.length`) vs gate.ts:170-189
- **Scenario**: A repo fails 3 dimension floors + posture. `evaluateGateLite` pushes **one failure per failing dimension** plus posture → `result.failures.length === 4`. The UI then renders `{f.failCount} condition{s}` (governance/page.tsx:144) as "4 conditions," and ranks `closestToGreen` by `a.failCount - b.failCount` (governance.ts:159). But the page's other panel ("Where the fleet fails") deliberately counts each *reason code* **once per repo** (governance.ts:124-130), so the same repo reads as failing 2 conditions (dimension + posture) there. The two panels disagree, and the "cheapest path" ordering is biased against repos that miss many small dimensions even when they're one deduped category away.
- **Root cause**: `failCount` reuses the raw per-dimension failure list instead of the deduped-by-code count the rest of governance uses; `dims.length` (recomputed with `floorFor`) is yet a third number that won't equal either.
- **Impact**: Misleading "N conditions" badges and a mis-ordered "cheapest path to green" worklist — the page's headline recommendation. Not a crash, but it undermines the feature's core promise.
- **Fix sketch**: Compute `failCount` from the deduped code set (`new Set(result.failures.map(f => f.code)).size`) so it matches the byReason model, and base the ranking on the same deduped count + `gap`.

## 4. Batch "Roll out to the fleet" opens up to 25 real PRs with no preview or confirmation, all repos pre-selected
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: Destructive action without confirmation / loading-state safety
- **File**: src/components/org/PracticeApply.tsx:40, 56-76, 211-219
- **Scenario**: The single-repo flow forces a `Preview starter` before the `Open draft PR` button even renders (artifact-gated, line 145). The batch flow has **no preview gate**: `selected` defaults to *every* gap repo (line 40), and clicking "Open draft PRs across N repos →" immediately POSTs to `apply-batch`, which writes to up to 25 repos. One accidental click — with the destructive overwrite of finding #1 — fans out across the whole fleet. There is no confirm dialog and no per-repo preview of what will land.
- **Root cause**: Asymmetric UX — the riskiest action (fleet write) has the least friction. `MAX_BATCH = 25` caps the blast radius server-side but the user gets no signal a cap exists, and `skipped` is returned but never shown.
- **Impact**: Easy to open dozens of unwanted PRs across customer repos; combined with #1, easy mass content clobber.
- **Fix sketch**: Require a confirm step (e.g. "Open N draft PRs?" with the repo list) before firing; default `selected` to empty (opt-in, not opt-out) or show the artifact preview once before the batch; surface `skipped`/`attempted` from the response.

## 5. Meters, repo select, and PR result feedback are invisible to assistive tech
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: Accessibility (WCAG 1.3.1 / 4.1.2 / 4.1.3)
- **File**: src/components/org/ui.tsx:170-196 (Meter); src/components/org/PracticeApply.tsx:122-137, 156-164, 220-240
- **Scenario**: `Meter` is a pure `<div>` fill with no `role="progressbar"`/`aria-valuenow`/`aria-valuemin/max`, so every adoption/governance bar (pass-rate, AI share, champions, "where the fleet fails") conveys its value only by width — a screen reader announces nothing. In PracticeApply the repo `<select>` has no associated `<label>`/`aria-label`, and the `error`, `pr`, and `batchResults` regions (which appear *after* an async PR action) are plain `<p>`/`<ul>` with no `aria-live`, so a non-sighted user gets no confirmation that a PR opened or failed.
- **Root cause**: Presentational primitives built width-first; async status text not wrapped in a live region.
- **Impact**: Adoption/governance analytics and the PR-apply outcome are inaccessible to screen-reader users — a dashboard whose value is the numbers it shows.
- **Fix sketch**: Add `role="progressbar"` + `aria-valuenow/min/max` (and an `aria-label`) to `Meter`; give the `<select>` an `aria-label="Repository"`; wrap the error/success/batch-result blocks in `aria-live="polite"`.
