# Practices, Governance & Adoption — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)

## 1. Copy-for-LLM adoption brief bypasses the CHAMPION_MIN_POP privacy guard the page enforces
- **Severity**: High
- **Category**: edge-case-gap
- **File**: `src/lib/org/adoption.ts:180` (also `src/app/org/[slug]/adoption/page.tsx:64`)
- **Scenario**: `champions.ts` documents that the small-population guard "must be applied IDENTICALLY everywhere champions are surfaced" — naming individuals in a tiny org is "a surveillance-y ranking". The page honors it: `showEnablement` requires `contributors.total >= CHAMPION_MIN_POP` before rendering `EnablementTargets`, and `ChampionsCard` receives the total for its own guard. But `adoptionMarkdown(a)` — the "Copy adoption brief for LLM" payload built from the SAME overview — unconditionally emits `## AI champions` (named logins with per-person AI shares) and `## Enablement cohort` (named zero-AI individuals), even for a 1–2 person org.
- **Root cause**: The markdown builder is pure over `AdoptionOverview` and never sees/applies the population threshold; the guard lives only in the React layer.
- **Impact**: One click copies exactly the individual ranking the UI deliberately suppresses — and hands it to an external LLM with an "Ask" that proposes per-person interventions. The documented invariant ("applied identically everywhere") is silently false.
- **Fix sketch**: Apply the guard in `adoptionMarkdown` (or better, in `buildAdoptionOverview`: empty `champions`/`enablement` when `contributors.total < CHAMPION_MIN_POP`, so every consumer inherits it). Add a test mirroring the page's guard.

## 2. Practice-preview route falls back to the operator PAT for non-installed owners — anonymous private-repo probe
- **Severity**: High
- **Category**: undocumented-assumption
- **File**: `src/app/api/practices/generate/route.ts:33-51`
- **Scenario**: `POST /api/practices/generate` has no auth gate at all (by design: "public repos need no auth"). The mint gate correctly refuses the installation token for callers without org standing, and the follow-up guard drops the ambient `GITHUB_TOKEN` — but only when the owner has an App installation. For any owner NOT installed, the request still runs `fetchRepoContext` with the operator's `GITHUB_TOKEN`, which "commonly has broad read access" (route's own words).
- **Root cause**: The PAT-refusal guard keys on `getInstallationIdForOwner(...)` rather than on the caller's standing; the residual assumption — "every private repo the operator PAT can read belongs to an installed org" — is unstated and untrue for the operator's own/adjacent orgs. Same shape as the known `scanRepository` ambient-PAT fallback (`noAmbientToken`).
- **Impact**: An anonymous caller can confirm existence and read name/description/primary language/default branch of any private repo the operator PAT can see (the description is echoed verbatim into the returned artifact body), for owners without an App installation. Also a free unauthenticated GitHub-API amplification surface (no rate limit).
- **Fix sketch**: Only use `process.env.GITHUB_TOKEN` when the caller has standing (reuse `canMintInstallationToken`-style resolution) or pass the equivalent of `noAmbientToken` for anonymous callers; token-less fetch keeps public repos working.

## 3. The PR that opens is a fresh regeneration, not the artifact the user previewed (and batch PRs are never previewed)
- **Severity**: Medium
- **Category**: trade-off-undocumented
- **File**: `src/lib/practices/apply.ts:31-33` (also `src/components/org/practices/PracticeApply.tsx:128-150`)
- **Scenario**: `PracticeApply` goes to great lengths to guarantee "apply the repo we actually PREVIEWED" (repo-stamped artifact, disabled select, mutual lock) and the apply button only appears after a preview. But `apply()` posts only `{ repo, practiceId }`; the server re-runs `fetchRepoContext → buildArtifact` at apply time. If repo metadata changed between preview and apply (description edited, primary language flipped after a push, default branch renamed), the committed body/commands/CI matrix differ from what the user reviewed. The batch path opens up to 25 PRs whose per-repo tailored content was never previewable at all.
- **Root cause**: Preview and apply are two independent generations sharing no fingerprint; the "review-then-commit" contract is enforced for repo identity but not for content. Neither `apply.ts` nor the component documents this regeneration trade-off (it's deterministic-given-context, but the context is refetched).
- **Impact**: "Content the user never reviewed" can land in a customer repo — precisely the failure mode the component's own comments call out for the repo dimension. Mostly a small drift window, but it undermines the stated contract and is invisible when it happens.
- **Fix sketch**: Cheapest: send a hash of the previewed body with apply; server regenerates, compares, and 409s with "repo changed since preview — re-preview" on mismatch. Or document the regeneration semantics in both files and the batch confirm copy ("content is generated per-repo at apply time").

## 4. "AI-involved PRs" tile uses the red→green maturity ramp the page explicitly forbids for adoption metrics
- **Severity**: Medium
- **Category**: visual-inconsistency
- **File**: `src/app/org/[slug]/adoption/page.tsx:94`
- **Scenario**: The tile row carries a comment: "Adoption metrics use a neutral accent hue, not the red→green maturity ramp: low adoption here is an expected early baseline, not a defect, so scoreHex would read 8% as alarm-red." The first two tiles follow it (`BAND.some`). Two lines later, the "AI-involved PRs" tile — a pure adoption measure (share of PRs with AI involvement) — is colored with `scoreHex(d.aiInvolvedRate)`, so an early-days org sees exactly the alarm-red 8% the comment says must not happen. (`aiGovernedRate` on the fourth tile is defensible — that one is a quality/governance rate.)
- **Root cause**: The BAND rationale was applied to the contributor-derived tiles but not to the PR-derived adoption tile; nothing distinguishes "adoption rate" from "health rate" at the call site, so the wrong palette was reached for.
- **Impact**: The tile row contradicts itself — 8% AI commit share renders calm blue while 8% AI-involved PRs renders alarm red — implicitly telling orgs low PR adoption is a defect, which the page's own doctrine (and the "honest context, not a defect" framing) rejects.
- **Fix sketch**: Color the AI-involved-PRs tile `BAND.some` (or leave `color` undefined) to match the other adoption tiles; keep `scoreHex` only for `aiGovernedRate`.

## 5. apply-batch accepts duplicate repos — concurrent double-writes to the same branch and duplicate React keys
- **Severity**: Low
- **Category**: edge-case-gap
- **File**: `src/app/api/practices/apply-batch/route.ts:58-74` (also `src/components/org/practices/PracticeApply.tsx:288`)
- **Scenario**: The route validates owner uniformity and caps at `MAX_BATCH`, but never dedupes `body.repos`. `["acme/api", "acme/api"]` fans out two concurrent `applyPracticeToRepo` calls for the same repo: both race `openDraftPr` on the same `ascent/<practice>` branch — one typically wins, the other surfaces a confusing GitHub ref-exists/422 error (and burns audit rows + cap slots). The UI can't produce duplicates (it sends from a `Set`), but the API is a public surface; if a duplicate does come back, `PracticeApply` renders the results list with `key={res.repo}`, a duplicate React key.
- **Root cause**: Batch hygiene stops at parse/owner checks; the "one repo = one worker" assumption is implicit and unenforced, and the pool's bounded concurrency makes the same-branch race likely rather than rare.
- **Impact**: Wasted batch capacity (duplicates count toward the 25-cap while real repos get `skipped`), spurious per-repo failures reported to the user, double audit entries, and a minor client rendering hazard.
- **Fix sketch**: Dedupe after parsing (`Map` keyed on `owner/repo` lowercased) before the cap slice; in the client, key result rows by index+repo or dedupe defensively.
