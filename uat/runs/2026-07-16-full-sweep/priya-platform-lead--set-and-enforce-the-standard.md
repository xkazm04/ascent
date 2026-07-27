# L1 report — Priya (Platform/DevEx Lead) × "Set and enforce the standard"

Certification level: **L1 — theoretical, static, code-grounded.** No browser was used; this is a
thought-experiment walkthrough over the actual code paths cited below.

---

## 1. Surface model (import-chain-verified)

### 1.1 Nav / reachability
`src/components/org/shared/OrgNav.tsx:52-121` — the org rail groups Practices+Plan+Backlog under
**Plan**, Skills+Memory under **Library**, and Governance under **Govern** (a separate rail group
from Plan). All are visible to any org member (no role/entitlement gate on the nav items
themselves — gating happens inside each page, see below). Under `ASCENT_AUTH_BYPASS=1` Priya is
seeded as **owner** on second visit (`uat/env.md` "Local profile auto-seed"; `src/app/org/[slug]/layout.tsx`), so every role-gated affordance below (`hasOrgRole(slug,"owner")`) is reachable to her.

**Reachable set for Priya:** `/org/[slug]/practices`, `/plan`, `/governance`, `/skills`, `/members`,
plus (only by deep-linking from a single-repo report, not from any org nav item) `/report/[owner]/[repo]`.

### 1.2 Governance — the gate
- Page: `src/app/org/[slug]/governance/page.tsx:26-224`. Fetches `buildGovernanceOverview(slug)`
  (`src/lib/org/governance.ts:87-180`), which reads `getOrgGatePolicy` + `getOrgRollup` and runs
  `evaluateGateLite` per repo (`governance.ts:115-118`).
- Fleet tiles: pass rate / passing / failing / scanned (`governance/page.tsx:59-64`).
- "Where the fleet fails" + "Failing repos" (worst first) (`governance/page.tsx:80-140`).
- **"Cheapest path to green"** — `GovernanceOverview.closestToGreen`
  (`governance.ts:33-45,133-158`), each item deep-links `/org/[slug]/practices#practice-{id}`
  (`governance/page.tsx:164-171`) to the exact practice that clears the dimension gap.
- **One-policy-no-drift mechanism**: `policyText`, `gateQuery`, `ciWith` in `governance.ts:73-85`
  all derive from **one** function, `describeGatePolicy()` in `src/lib/scoring/gate.ts` (comment
  at `governance.ts:69-72` states this explicitly). The dashboard's "Active policy" list
  (`governance/page.tsx:68-76`), the `GET /api/gate/...` query string, and the copy-pasted
  `action.yml` (`governance/page.tsx:203-221`, `ciActionYaml` at `governance.ts:189-191`) are three
  renderings of the same object — confirmed single-source, not three hand-synced copies.
- **Editable policy**: `src/components/org/governance/GatePolicyEditor.tsx`, owner-gated
  (`governance/page.tsx:42-46`, `hasOrgRole(slug,"owner")`), POSTs to `/api/org/gate-policy`,
  persists via `getOrgGatePolicy`/`sanitizeGatePolicy` (`scoring/gate.ts`).
- **CI enforcement of the identical bar**: `src/app/api/gate/[owner]/[repo]/route.ts:104-115` —
  policy precedence is explicit query params → **the org's persisted `getOrgGatePolicy`** → archetype
  default. The comment at `route.ts:104-110` documents a since-fixed bug where the HTTP gate used to
  ignore the saved policy — now it's the same store the dashboard reads.
- **Archetype-aware defaults** exist per repo (`defaultGatePolicy(archetype)`,
  `scoring/gate.ts:131-146`: org=L3/floor40/no-ungoverned, team=L3/floor35, solo=L2/floor25) and are
  used when *no* custom org policy is saved. **But** `buildGovernanceOverview` hardcodes
  `ORG_POLICY_ARCHETYPE = "org"` (`governance.ts:67,92`) and applies **one** default (or Priya's
  one custom `GatePolicyEditor` policy) to **every** repo in the fleet regardless of that repo's
  own archetype — see Finding F1.

### 1.3 Practices — the path to green
- Page: `src/app/org/[slug]/practices/page.tsx` → `PracticesView`
  (`src/components/org/practices/PracticesView.tsx`) → `PracticeLedger` (row list) →
  `PracticeDetailModal.tsx:1-52` → `MinedPracticeDetail.tsx:1-93` for a mined (fleet-detected)
  practice.
- Each mined practice shows adoption %, an **exemplar** repo, and **gap repos**
  (`MinedPracticeDetail.tsx:56-73`).
- **Single-repo apply**: `PracticeApply.tsx:105-150` — `POST /api/practices/generate` (preview) then
  `POST /api/practices/apply` (open draft PR), backed by `src/lib/practice-artifact.ts` (deterministic,
  language-aware, no LLM — `commandsFor()` at `practice-artifact.ts:49-63`, sanitizes repo-supplied
  text before interpolation, `practice-artifact.ts:78-80`).
- **Fleet rollout ("one-click across gap repos")**: `PracticeApply.tsx:220-308` "Roll out to the
  fleet" → multi-select of gap repos → `POST /api/practices/apply-batch`
  (`src/app/api/practices/apply-batch/route.ts:1-118`), bounded-concurrency fan-out
  (`mapPool`, `apply-batch/route.ts:86-107`), capped at `MAX_BATCH=25`, all-repos-must-share-one-org
  gate (`apply-batch/route.ts:64-67`), one failure doesn't abort the batch. This is a real,
  wired implementation of her "open the same starter PR across gap repos without rewriting it"
  criterion — not a mockup.
- **Real-PR caveat (in scope per journey's own out-of-scope note):** opening a real PR requires
  `isAppConfigured()` (GitHub App installed) — `apply-batch/route.ts:37-42`. Preview
  (`/api/practices/generate`) never needs it. The journey explicitly marks live PR creation
  out-of-scope for L1, so this is not a gap here, only a fact Priya will hit at L2/live use.

### 1.4 `.ai/` standard + onboarding SKILL.md
- Generator: `src/lib/standard/index.ts:27-36` `buildFoundation(report)` → manifest
  (`standard/manifest.ts:29-151`), doctor, CI wiring, maintain, memory seed, context scaffold.
- Manifest is grounded in real per-repo facts: `commandsFor(report.repo.primaryLanguage)`
  (`manifest.ts:30`), `report.archetype` (`manifest.ts:50`), real `TYPECHECK` command per language
  family (`manifest.ts:21-27`). It leaves explicit `TODO`s for what it **cannot** know from a scan
  (`boundaries.neverTouch: []`, `secretsFrom`, `agents: []` — `manifest.ts:61-64`) rather than
  inventing them — this satisfies the "no fabrication" criterion at the artifact level, but it does
  mean the artifact **as generated** is not a finished, name-your-own standard; see F4.
- Wrapper: `src/lib/onboarding/skill.ts:35-49` `buildOnboardingSkill(report)` embeds the whole
  foundation (`skill.ts:151-186` `foundation()`) plus the control-model framing (pre-push primary /
  CI thin backstop, `skill.ts:118-135`) plus per-weak-dimension **tracks** with pre-push checklists,
  CI hard-passes, and an explicit **guardrails** section forbidding fabrication
  (`skill.ts:275-285`: "Never fabricate architecture, commands, or constraints you can't verify in
  the repo. Leave a clearly-marked TODO instead of inventing.") The generated SKILL.md is a *harness*
  that instructs the repo's own agent to fill remaining TODOs against live code — by design, not an
  oversight (`skill.ts:1-9` header comment).
- **Distribution surface**: `GET /api/report/skill?repo=owner/name[@sha]`
  (`src/app/api/report/skill/route.ts:19-58`), download-gated by org read access
  (`requireOrgRead`, `route.ts:29`), 404s if no saved scan. The **only** UI entry point wired to it
  is the "✦ Onboarding skill" button on the **single-repo** report header
  (`src/components/report/ReportHeader.tsx:100-104`) — i.e. `/report/[owner]/[repo]`, not any
  `/org/[slug]/*` fleet page. See Finding F2.

### 1.5 `/org/[slug]/skills` — two-way skill sync
- Page: `src/app/org/[slug]/skills/page.tsx:17-49`. Reachable in nav under **Library**
  (`OrgNav.tsx:100-108`). Gates: read via layout; author/token-mint via `isMember` +
  `workspaceAllowsSkills` (Team-plan or personal-workspace free-with-limits,
  `skills/page.tsx:29`); `ApiTokensPanel` renders only `isMember` (`skills/page.tsx:32,46`).
- **Push** (`POST /api/org/skills/push`, `src/app/api/org/skills/push/route.ts:18-73`): named skill
  registration with optimistic-concurrency `baseVersion` (409 on conflict, `push/route.ts:57-62`),
  gated by `authorizeOrgApi(..., {scope:"skills:write"})` (token **or** session — token is identity,
  not an entitlement bypass, per the file header comment) **and** `planAllowsSkillsLibrary`
  (`push/route.ts:38-40`, Team-plan gate).
  Idempotent (`unchanged` status) so a repeated push from a local skill never churns.
- Pull/manifest/adopt/download/events routes also exist (`src/app/api/org/skills/{manifest,[id]/adopt,[id]/download,events}/route.ts`,
  confirmed present via file listing) — a real read side to match the write side, not stubbed.
- This is a genuinely wired distribution mechanism — org API tokens exist, scope to
  `skills:write`/others (`SKILL_TOKEN_SCOPES` passed at `skills/page.tsx:9,46`), and versioning
  prevents silent clobber. It satisfies "not a toy." Whether it's **the same source of truth** as
  the `.ai/` standard/practices (vs. a parallel skills library unrelated to the maturity standard)
  is a framing question — see Finding F3.

### 1.6 Score framing (DX Core 4 "friction not stick" bar)
- Governance page language: "Cheapest path to green," "Enforce in CI," per-**repo** failure lists
  (never per-engineer) — `governance/page.tsx:16-24,102-140`. No leaderboard-of-people surface found
  in the reachable set. This matches her bar structurally; L1 can't confirm the live LLM-recommendation
  prose never slips into individual-blame language (that's an L2 check on `governanceMarkdown` /
  `PRACTICES` copy at runtime).

### 1.7 Members / invite (discovery-hint check)
- `src/app/api/org/invites/route.ts`, `src/app/api/org/invites/accept/route.ts` exist; Members tab
  reachable in nav (`OrgNav.tsx:114`), owner-role-gated actions consistent with the rest of the app's
  RBAC pattern (`hasOrgRole`). Confirmed present and reachable; not deep-audited beyond existence
  since this journey's DoD does not require the full invite UX, only that it not be a dead end.

---

## 2. In-character walkthrough (Priya, cognitive walkthrough + scored criteria)

I open the seeded org. Overview first — fine, not what I'm here for. I go to **Plan** in the rail
and land on Practices. Good: it's grouped with Plan and Backlog, matches my mental model of "this is
where I define and manage the standard." I open a mined practice — I can see the exemplar, the gap
repos, and I can preview a leak-free starter and open a draft PR to one repo. Then I see "Roll out to
the fleet" — a real batch action across every gap repo, capped, no drift with the single-repo
preview I just read. **Okay, that's actually shippable.** This is the single strongest piece of the
surface: it is exactly "the PR that turns it green," not a red list.

I go to Governance (a different rail group — I had to notice "Govern" separately from "Plan," a
small extra hop, but the rail didn't hide it). Pass rate, failing reasons, cheapest-path-to-green
list that deep-links back to the exact practice — that reconciles cleanly with what I just saw on
Practices. I read the "Active policy" card and the CI snippet side by side: same bullet list, same
`min_level`/`min_dimension` values baked into both the query string and the `with:` block. I check
provenance in the code comments (not something I can see live, but the single-function derivation is
the right architecture) — that's the "one policy, no drift" story I actually believe. I edit the
policy as owner and it round-trips.

Then I go looking for archetype-awareness, because I manage a fleet where a scratch repo and our
core platform repo cannot be held to the same bar — and I notice the org-wide gate is **one flat
policy for every scanned repo**, regardless of whether a given repo is solo/team/org shaped. The
code *has* an archetype-aware default (`defaultGatePolicy`), but the moment I — the platform owner —
configure a policy in `GatePolicyEditor`, it becomes the exact "flat global threshold I'd have to
argue about per team" that my scored criteria explicitly warns against. This is the first real
crack: the machinery for archetype-awareness exists in the codebase but isn't exposed to me at the
org-policy layer.

I go looking for the `.ai/` standard and the onboarding skill next, because that's half my job today
— I need something to actually hand a team. Nothing on Practices, Plan, or Governance links to it.
I eventually have to remember (or be told) that it lives one level down, on a **single repo's**
report page, as a download button. For a fleet-rollout journey this is a real miss: I'd have to open
every gap repo's report individually to generate its onboarding skill; there's no "generate/download
standard for repo X" action from the fleet surfaces where I'm already looking at gap repos by name.
The generated file itself, when I do find it, is genuinely repo-specific (real commands, real
archetype, real weak-dimension tracks) and it's honest about what it can't know (explicit TODOs, an
explicit no-fabrication guardrail) — that clears my "no fabrication" bar, though it means the
artifact I'd actually paste isn't done being adapted until a run of the skill itself, not at
generation time. That's a legitimate design choice (a harness, not a finished doc) but I'd want that
made explicit to me on the page, not something I infer from reading the SKILL.md's own guardrails
section.

Finally, Skills. I find `/org/[slug]/skills` under Library. I can mint an org API token scoped to
`skills:write`, and the push endpoint is real (versioned, conflict-safe, idempotent). But sitting
next to Practices and Governance, its relationship to *the standard I just set* isn't obvious from
the page itself — is a skill pushed here automatically the org's AI-native standard, or a separate
library a team could diverge from? If it's the latter without saying so, that's my "two sources of
truth" pet peeve waiting to happen once teams start pushing their own skills independent of what
Practices/Governance enforce.

## 3. Scored acceptance criteria — verdict

- [x] Fleet conformance visible and reconciles — Governance's pass-rate/failing/closest-to-green all
  derive from one rollup + one gate function; Practices' adoption % is a separate but consistent read.
- [x] Path to green, not just a red list — `closestToGreen` + practice deep-link + one-click
  fleet-batch PR (`PracticeApply.tsx`, `apply-batch/route.ts`) is the strongest surface in the app.
- [~] One policy, no drift — **confirmed** between dashboard/CI/gate-query (single `describeGatePolicy`
  source); **not confirmed** across repo archetypes (see F1) — partial pass.
- [ ] Gate is archetype-aware, not flat — **fails at the org-policy layer** (F1): the per-repo
  archetype default is overridden fleet-wide by one org policy once she sets one.
- [~] `.ai/` standard is repo-specific and senior-grade — content quality is grounded (real commands,
  real archetype, honest TODOs, explicit no-fabrication rule); **discoverability from the fleet is
  broken** (F2).
- [x] Starter PR / practice artifact leak-free and mergeable — sanitized interpolation
  (`practice-artifact.ts:78-80`), batchable, per-repo stamped artifact so preview/apply can't
  cross-contaminate (`PracticeApply.tsx:118-119,128-133`).
- [~] Authored/rolled out in minutes — the practices+governance loop plausibly is minutes; the
  standard/skill loop costs extra minutes hunting for the surface (F2) — still net-faster than the
  manual audit, but not the frictionless "minutes" bar for that half of the job.
- [x] Score reads as friction-to-remove — repo-level framing throughout the reachable surfaces, no
  per-engineer ranking found.
- [x] No fabrication — explicit guardrail + TODO-not-invent pattern confirmed in code
  (`skill.ts:278-279`, `manifest.ts:61-64`).
- [~] Skill-sync is a real distribution mechanism — yes, mechanically (tokens, versioning, scopes);
  but its **relationship to the standard** she's setting is not stated on the page (F3).

---

## 4. Findings

```
F1
id: priya-set-enforce-standard-l1-f1
journey: set-and-enforce-the-standard
character: priya-platform-lead
cert_level: L1
type: quality-gap
severity: major
impact: { frequency: high, reachability: high, trust_erosion: high }
dimension: trust
title: Org-wide gate policy ignores per-repo archetype once Priya configures one
expected: The gate she sets should be archetype-aware (solo vs team vs org repos held to
  different, fair bars), per her explicit scored criterion and the codebase's own
  defaultGatePolicy(archetype) design.
got: buildGovernanceOverview hardcodes ORG_POLICY_ARCHETYPE="org" and applies ONE policy
  (the archetype default OR her one custom GatePolicyEditor policy) to every scanned repo in
  the fleet regardless of that repo's own archetype.
evidence:
  - src/lib/org/governance.ts:67
  - src/lib/org/governance.ts:92
  - src/lib/org/governance.ts:115-118
  - src/lib/scoring/gate.ts:131-146 (defaultGatePolicy is archetype-aware elsewhere, unused here)
code_check: present-but-missed
verdict: confirmed
resolution: open
l2_priority: "Confirm live whether a solo-archetype repo and an org-archetype repo in the same
  seeded fleet are held to the identical floor on the Governance page, and whether Priya can set
  per-archetype (not just one flat) org policy."
```

```
F2
id: priya-set-enforce-standard-l1-f2
journey: set-and-enforce-the-standard
character: priya-platform-lead
cert_level: L1
type: confusion
severity: major
impact: { frequency: high, reachability: high, trust_erosion: med }
dimension: clarity
title: The .ai/ standard + onboarding SKILL.md generator is undiscoverable from any fleet surface
expected: Given her JTBD is fleet rollout, she expects to generate/see the standard from
  Practices, Plan, or Governance — the surfaces the journey's own discovery hints point her to.
got: The only UI entry point is a per-repo "✦ Onboarding skill" button on the single-repo
  report page (/report/[owner]/[repo]); nothing on /org/[slug]/practices, /plan, or /governance
  links to it, even though those pages already list gap repos by name.
evidence:
  - src/components/report/ReportHeader.tsx:100-104
  - src/app/api/report/skill/route.ts:19-58
  - src/app/org/[slug]/practices/page.tsx (no reference to onboarding/skill)
  - src/app/org/[slug]/governance/page.tsx (no reference to onboarding/skill)
code_check: present-but-missed
verdict: confirmed
resolution: open
l2_priority: "Drive from a gap repo listed on Governance/Practices and time how long it takes to
  find the SKILL.md download; confirm there is truly no fleet-level link."
```

```
F3
id: priya-set-enforce-standard-l1-f3
journey: set-and-enforce-the-standard
character: priya-platform-lead
cert_level: L1
type: trust
severity: minor
impact: { frequency: med, reachability: high, trust_erosion: med }
dimension: trust
title: Skills-sync's relationship to "the standard" is not stated on the page
expected: Per her pet peeve on two sources of truth, she needs to know explicitly whether a
  skill pushed via /org/[slug]/skills IS (part of) the AI-native standard enforced by
  Governance/Practices, or a separate library a team could diverge from.
got: SkillsPanel/ApiTokensPanel render the push/pull mechanism and plan gate, but no copy on the
  page ties skills back to the gate policy or the .ai/ standard.
evidence:
  - src/app/org/[slug]/skills/page.tsx:34-48
  - src/app/api/org/skills/push/route.ts:1-8 (mechanism only, no standard linkage)
code_check: confirmed-absent
verdict: confirmed
resolution: open
l2_priority: "Ask (in character) whether pushing a skill changes what Governance enforces; see
  what the live UI actually claims."
```

```
F4
id: priya-set-enforce-standard-l1-f4
journey: set-and-enforce-the-standard
character: priya-platform-lead
cert_level: L1
type: confusion
severity: minor
impact: { frequency: med, reachability: high, trust_erosion: low }
dimension: senior-quality
title: Generated .ai/manifest.yaml ships several TODO placeholders by design, not disclosed at generation time
expected: Priya's bar is "not boilerplate with TODOs left as the deliverable" — she needs to know
  upfront that the manifest is a first-pass scaffold an agent run is expected to complete, not a
  finished artifact.
got: manifest.ts leaves boundaries.neverTouch, secretsFrom, and agents as TODO/empty by design
  (undisclosed fabrication risk avoided correctly), and skill.ts's guardrails section explains
  this INSIDE the generated file, but the report-page download button gives no such expectation
  before download.
evidence:
  - src/lib/standard/manifest.ts:61-64
  - src/components/report/ReportHeader.tsx:100-104 (button copy: "drop it in .claude/skills/ and run it")
code_check: by-design
verdict: confirmed
resolution: open
l2_priority: "Confirm the live download experience sets the expectation correctly (or doesn't)."
```

Strengths worth protecting (positive findings):
- The fleet-batch practice-PR rollout (`PracticeApply.tsx` + `apply-batch/route.ts`) is a genuine,
  wired "path to green" — this is precisely what her golden-path reference material demands and
  most internal-developer-portal tools fake with a mockup button. Do not regress it.
- The single-function derivation of dashboard policy text / gate query / CI snippet
  (`describeGatePolicy` in `scoring/gate.ts`, consumed identically by `governance.ts`) is exactly
  the "one source of truth" architecture her pet peeve demands — and the code comments show it was
  fixed on purpose after a prior drift bug (`route.ts:104-110`). Protect this pattern.

---

## 5. Priya's voice — would I adopt it?

*"Okay, the practices rollout is the real thing — a batch of draft PRs into every gap repo from one
screen, not a red dashboard with a `TODO: fix this yourself`. That's the first tool I've seen in a
year that gets the golden-path math right: it's the easy path, not a lecture. And the policy
plumbing — one function feeding the dashboard text, the gate query, and the CI snippet — that's the
architecture I'd have insisted on if I'd built it myself. I believe the 'no drift' claim because I
can see WHY it can't drift, not because someone told me so.*

*"But you buried the thing I actually need to hand a team. I have to leave the fleet view, open one
repo's report page, and download a markdown file — for every repo, one at a time — to get the
artifact I'd actually paste into a PR description. That's the manual-audit tax you promised to kill,
just moved one screen over. And once I do open that file, I find out it's a scaffold with TODOs in
it that I'm supposed to run through an agent to finish — fine, that's honest, I respect the
no-fabrication guardrail — but nobody told me that BEFORE I clicked download.*

*"And the gate — the second I set a policy, it stops being archetype-aware. I manage a payments repo
and a hack-week repo in the same org; if they're held to the same floor the moment I touch
'Governance,' I'm exactly the mandate-cop my rollout strategy exists to avoid. Fix that and I'd
stake my quarter on this. Right now I'd ship the Practices flow tomorrow and quietly work around the
other two."*

---

## 6. Verdict inputs

- Grounding score (AI/generated-artifact surfaces: manifest/doctor/SKILL.md/starter-PR content —
  6 real context sources checked: repo language, repo archetype, weak dimensions, exemplar/gap
  repos, existing CI/hooks awareness (instructional, not detected), repo description) — **5/6**
  sources genuinely reach the generated artifacts (the one gap: it does not detect/read the repo's
  *actual existing* lefthook/husky config or CI workflow file to extend, only instructs the agent to
  find and extend it at run time — a plausible-but-unverified claim at generation time).
- Estimated time-saved if the design holds: her own number is "a multi-week authoring effort plus a
  day per repo of manual audit" vs. Ascent's designed flow of minutes for the fleet read + a few
  minutes per repo to fetch the standard once the discoverability gap (F2) is fixed. Call it
  **~180 minutes saved** for a first pass across a handful of gap repos (fleet governance +
  practices read: ~10 min; per-repo standard fetch at 3-5 min each once found, ×5 repos ≈ 20 min;
  vs. a day-per-repo manual audit baseline) — conditional on F2 being fixed, since today the
  per-repo standard leg costs meaningfully more hunting time than designed.
