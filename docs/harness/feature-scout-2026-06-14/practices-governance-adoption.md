# Feature Scout — Practices, Governance & Adoption (ascent, 2026-06-14)
> Total: 6
> Severity: 1C / 3H / 2M / 0L

## 1. Fleet rollout — apply a practice to all gap repos in one action
- **Severity**: Critical
- **Category**: functionality
- **File**: src/components/org/PracticeApply.tsx:31-109, src/app/api/practices/apply/route.ts:20
- **Scenario**: A platform lead sees a practice with 14 gap repos ("could adopt next"). The whole point of an org/fleet layer is to fix many repos at once. They want to open seeding draft PRs across the entire gap list, not click through a dropdown 14 times.
- **Gap**: `PracticeApply` exposes a single `<select>` and applies to exactly one repo per call; the apply route accepts one `{ repo, practiceId }`. The full gap list is already passed in as `gapRepoRefs` (org-insights.ts:654) and rendered ("Could adopt next (N)"), but there is no "Apply to all" / multi-select / batch endpoint. Grep confirms no `applyAll`/bulk/fleet-apply path exists anywhere in `src`.
- **Impact**: Org admins, platform/DevEx teams. This is the headline fleet-scale capability the product implies; one-at-a-time apply makes rollout O(repos) of manual clicks and is the single biggest value multiplier missing here.
- **Fix sketch**: Add `POST /api/practices/apply-batch { repos: string[], practiceId }` that loops `buildArtifact` + `openDraftPr` per repo (reuse the existing per-repo authz + audit), returning a per-repo result array; in `PracticeApply` add a checklist (default: all gap repos) and an "Open PRs across N repos" button rendering per-repo success/error rows. `openDraftPr` is already idempotent. ~1 day.

## 2. Close the loop — track applied practices and re-score delta
- **Severity**: High
- **Category**: user_benefit
- **File**: src/app/api/practices/apply/route.ts:73-77, src/app/org/[slug]/practices/page.tsx:47-130
- **Scenario**: After opening starter PRs, a leader asks "did adopting this practice actually move our score?" and "which of my apply-PRs got merged vs left as drafts?". They expect the practices page to show what was applied where and the maturity lift it produced.
- **Gap**: Every apply is audit-logged as `practice.pr_opened` (apply/route.ts:73) and `getAuditLog`/`AuditLogEntry` already exist and filter by `orgId` (db/index.ts:25), but nothing ever reads it back. The practice card shows only static `strongCount/total` adoption; there is no per-practice "applied to: repo (PR #, status, score Δ since)" view. Grep found no re-score-delta or applied-practice surfacing in `src/lib/org`.
- **Impact**: Org admins, execs proving ROI of the platform. Turns a fire-and-forget PR button into a measurable adoption funnel (opened → merged → re-scored → score moved), which is the proof that justifies the whole governance program.
- **Fix sketch**: New `src/lib/org/practiceAdoption.ts` reading `getAuditLog({ orgId, action: "practice.pr_opened" })`, joining each repo's dimension score at apply time vs latest scan for the practice's `dimId` to compute a delta; render an "Applied practices" section on the page with PR link + Δ. Optionally poll PR merge state via the existing App token. ~1-1.5 days.

## 3. Editable, persisted governance policy (not a hard-coded org bar)
- **Severity**: High
- **Category**: functionality
- **File**: src/lib/org/governance.ts:74, src/lib/scoring/gate.ts:48-58
- **Scenario**: A security-conscious org wants its gate to require D9 (supply-chain) ≥ 50 and overall ≥ 70; a more lenient org wants L2. The governance page literally says "change it once, enforce it everywhere" — so they expect to edit the policy in the UI.
- **Gap**: `buildGovernanceOverview` always calls `defaultGatePolicy("org")` (a fixed `{ minLevel: "L3", minDimension: 40, forbidPostures: ["ungoverned"] }`). There is no per-org policy storage (`Organization` model has `alertWebhookUrl` but no gate fields per schema.prisma:25-44) and no settings UI. Grep confirms no `customGatePolicy`/`savePolicy`/policy-override path. The CI snippet, gate URL, and `policyFromParams` already support arbitrary policies — only persistence + an editor are missing.
- **Impact**: Org admins, security/compliance owners. The gate is the enforcement primitive of the whole platform; a non-editable one-size bar makes governance unusable for orgs whose real bar differs, and contradicts the page's own copy.
- **Fix sketch**: Add a `gatePolicy Json?` column to `Organization`; have `buildGovernanceOverview` load it (fall back to `defaultGatePolicy`); add a `POST /api/org/governance/policy` (owner-gated like apply) + a small policy editor card on governance/page.tsx. Reuse existing `policyText`/`gateQuery`/`ciWith` serializers. ~1 day.

## 4. Governance & adoption are absent from the weekly digest
- **Severity**: High
- **Category**: feature
- **File**: src/app/api/cron/digest/route.ts:66-94, src/lib/org/governance.ts:70, src/lib/org/adoption.ts:30
- **Scenario**: A leader who never opens the app relies on the weekly Slack digest. They want to know "is the fleet drifting below the gate?" and "is AI adoption rising?" — the two numbers governance and adoption pages compute.
- **Gap**: The digest assembles rollup + movers + one recommendation + credits, but never calls `buildGovernanceOverview` (gate pass-rate) or `buildAdoptionOverview` (org AI share). Grep of the digest route shows no governance/adoption import. Both builders are pure assembly already used by their pages, so the data is one call away but unused in the push channel.
- **Impact**: Execs/leaders on the passive channel. Surfacing pass-rate drops and adoption trend in the digest makes the governance and adoption views actionable without anyone logging in — directly drives engagement and policy compliance.
- **Fix sketch**: In digest/route.ts add governance + adoption to the `Promise.all`, then extend `buildFleetDigestMessage` with a "Gate: X% passing (Δ)" and "AI adoption: Y%" line. Add week-over-week deltas by computing pass-rate over the prior window. ~0.5 day.

## 5. Practice catalog is fixed code — no custom/org-authored practices with starters
- **Severity**: Medium
- **Category**: feature
- **File**: src/lib/practices.ts:17, src/lib/practice-artifact.ts:113 (the `switch (p.id)`)
- **Scenario**: An org has its own standard (e.g. "every service ships a runbook") and wants it minable, gap-scored, and applyable as a draft PR like the built-in practices. The page already has hand-authored "Company playbooks" (PlaybooksPanel) but those only get a "copy into Claude Code" affordance — no generated artifact / draft PR.
- **Gap**: `PRACTICES` is a static array and `buildArtifact` hard-codes a `switch` over the 9 known ids returning `null` for anything else (practice-artifact.ts:288). Playbooks (db-backed, user-authored) and the apply pipeline are two disconnected worlds — a playbook can't be turned into a seeded PR. No generic/templated artifact path exists for custom practices.
- **Impact**: Org admins authoring standards. Bridging playbooks → artifact generation lets an org's own governance travel the same way the built-in catalog does, multiplying the "apply" feature across everything the org cares about, not just the 9 defaults.
- **Fix sketch**: Add a generic branch in `buildArtifact` that, for a playbook, emits `docs/playbooks/<slug>.md` from its title/summary/steps; give `PlaybookCard` the same Preview/Apply buttons as `PracticeApply` (pass a `playbookId` the generate/apply routes resolve via `listPlaybooks`). ~1 day.

## 6. "Cheapest path to green" is an LLM ask, not an in-app ranked worklist
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/lib/org/governance.ts:151-154, src/app/org/[slug]/governance/page.tsx:92-118
- **Scenario**: A team lead looking at failing repos wants the app to tell them directly "these 3 repos fail on a single condition — fix that and pass-rate jumps 12%", and ideally a one-click apply of the matching practice.
- **Gap**: The governance markdown ends with an "Ask" telling the user to paste into an LLM to find the cheapest path; the page itself only lists failures worst-first. There is no in-app "closest to passing" ranking, no projected pass-rate-if-fixed, and no link from a failing condition to the practice that remediates it (e.g. a failing D3 → `ci-gates` practice apply). Grep confirms no remediation-linking logic in `src/lib/org`.
- **Impact**: Team leads / DevEx. Converts a static failure list into a prioritized, actionable worklist that ties governance directly to the practices apply pipeline — the natural connective tissue between the two pages in this context.
- **Fix sketch**: In `governance.ts` compute, per failing repo, the count/closeness of conditions missed and the dimension→practiceId map (dimId already on `PracticeDef`); expose a "closest to green" list and a per-condition "Apply <practice>" deep-link to the practices page. ~0.5-1 day.
