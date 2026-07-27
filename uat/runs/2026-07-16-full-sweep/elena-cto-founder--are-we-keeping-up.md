# L1 (theoretical) — Elena (CTO / Founder) × "Are we keeping up?"

cert_level: L1 · no browser used · surface model built from source, file:line cited.

## 1. Surface model (import chain, cited)

### A. Public single-repo scan (`/`)
- Landing renders `IndexLanding` with `ScanForm` — `src/app/page.tsx:75-82`.
- `ScanForm.submit()` normalizes `owner/repo` client-side and routes to `/report?repo=...` — `src/components/ScanForm.tsx:127-152` (no signup/account step in this path).
- `/report` → `ReportClient` → `useReportScan(repo, fresh, {notify, email})` — `src/app/report/page.tsx:13-23`, `src/components/report/ReportClient.tsx:12-27`.
- `useReportScan` first peeks the cache (`GET /api/scan?peek=1&recent=1`, ungated) then opens `POST /api/scan/stream` — `src/components/report/useReportScan.ts:120,147`.
- `POST /api/scan/stream`: rate-limits, resolves auth, **gate check** `if (authGateEnabled() && !viewer) return 401` — `src/app/api/scan/stream/route.ts:69-73` — then consumes a soft weekly quota, then runs the scan inside an SSE `ReadableStream` with a 15s heartbeat and `progress` events — `route.ts:96-124`.
- `authGateEnabled()` = `supabaseAuthConfigured() && !authBypassEnabled()` — `src/lib/env.ts:42-44`. Under the UAT env (`ASCENT_AUTH_BYPASS=1`, no Supabase project) this is **false** → public scan funnel is open, no signup. **In a production deploy with Supabase configured, this is `true` for every scan, including the very first public one** — see Finding F2.
- Scan orchestration: `src/lib/scan.ts` — ingest → deterministic signals (D1-D9) → `buildAssessmentPrompt` (`src/lib/scoring/prompt.ts:27`) → `provider.assess()` (`src/lib/scan.ts:340`) → `assembleReport` (`:465`).
- Grounding fed into the prompt (`src/lib/scoring/prompt.ts`):
  - PR + branch-protection evidence (`processBlock`, lines 20-37) — merge rate, review rate, velocity, AI-in-PR rate, branch protection rules.
  - Deterministic Security/D9 battery, model told to narrate not re-score (`securityBlock`, lines 44-59).
  - Standing org decisions (dismissed findings + reasons) so the model doesn't re-raise judged gaps (`decisionsBlock`, lines 79-95).
  - System prompt explicitly bans invention: "You never invent facts: every judgment must be supported by the signals and file excerpts provided" — `prompt.ts:65`.
  - **Grounding score for this surface: 4/4 of the real context sources Elena would expect (repo signals, PR/governance history, security posture, standing team decisions) reach the prompt.** No brand/competitor axis applies here (not that kind of product).
- Report UI: `ReportView` tabs — Scoring / Dimensions / Roadmap / Sandbox / Contributors (`src/components/report/ReportView.tsx:20,152`). Evidence per dimension rendered as plain-text bullets, not links — `DimensionCard.tsx:78-89` (`d.evidence.map(...)` → `<span>{e}</span>`), sourced from `evidence: evidenceStrings(s)` (`src/lib/scoring/engine.ts:131`) and `formatSignal` (`src/lib/types.ts:273-275`, e.g. `"Found 6 test files"`). **No `file:line` or PR/commit deep-link accompanies an evidence string** — see Finding F1.
- "Trust = adoption × rigor" language and the priority-ordered `RoadmapSteps` (item #1 = numbered "Start here" equivalent, "⚡ Quick win" badge, plus a `NextLevelPath` "Fastest path" callout above it) — `src/components/report/roadmapPieces.tsx:104-121,124-146` — this is the single-repo "highest-leverage move" surface, reachable via the Roadmap tab (not the default landing tab, which is Scoring — `ReportView.tsx:152`).

### B. Whole-org read (`/onboarding` → `/org/[slug]`)
- `/onboarding` server component seeds an activation checklist from the session; a "Welcome back" jump to an already-scanned org's dashboard is offered — `src/app/onboarding/page.tsx:14-49`.
- `OnboardingFlow` checklist includes "Install the GitHub App" → `/connect` (private/org repo access) — `src/components/onboarding/OnboardingFlow.model.ts:58`.
- `/connect` renders `ConnectPrivacyNotice` **at the exact decision point** before granting the App access to private repos — `src/app/connect/page.tsx:58`, `src/components/connect/PrivacyNotice.tsx:31-56`. It names the effective inference provider, states plainly where sampled file contents go, and (non-Bedrock) explicitly offers "`LLM_PROVIDER=bedrock` — code stays within your AWS boundary and is never used for model training" — matching the AWS Bedrock FAQ language in her `references:`. Bedrock path: `"Claude on AWS Bedrock — your code stays within the AWS boundary and is never used for model training."` — `PrivacyNotice.tsx:15-16`.
- `/org/[slug]` overview: `getOrgRollup` + `getOrgRepoHistories` → `RepoCategoryRollup` (group by Type/Stack/Level, per-group avg + net move) + `RepoDimensionHeatmap` — `src/app/org/[slug]/page.tsx:65-131`. This is the **rigor** side (D1-D9 maturity per repo/cohort).
- Adoption (the other half of "adoption × rigor") lives on a **separate tab**, `/org/[slug]/adoption`: `buildAdoptionOverview` → org AI commit share, AI-active contributor %, AI-involved/governed PR rate, `AdoptionSpectrum` (heavy/partial/none), champions, team adoption, enablement targets — `src/app/org/[slug]/adoption/page.tsx:42,83-119`. Explicitly framed as *not* the maturity ramp ("low adoption is an expected early baseline, not a defect" — `page.tsx:26`).
- The org-level "single highest-leverage move" (`OrgLeverageMoves`, "The move to make next", ranked by reach × impact × dimension weight, with engine-true projected point gain) lives on **`/org/[slug]/executive`**, not on the overview page she lands on first — `src/app/org/[slug]/executive/page.tsx:13,180`; `src/components/org/executive/OrgLeverageMoves.tsx:21-38`. `/org/[slug]/page.tsx` (the overview) has no import of `OrgLeverageMoves` (verified: no match in that file). See Finding F3.
- Local-profile auto-seed on first `/org/[slug]` visit under bypass persists a real owner `Membership` (`src/app/org/[slug]/layout.tsx`, per `uat/env.md`) — so RBAC-gated tabs (executive, settings) resolve for her on the second visit; first visit alone would not yet show her as owner. Minor reachability wrinkle noted, not scored as a finding (documented, one-time).

## 2. Reachability check (Elena's actually-reachable set, under `uat/env.md`'s pinned UAT env)

- `ASCENT_AUTH_BYPASS=1` + Supabase not configured locally → `authGateEnabled()` is **false**: `/`, `/report`, `/onboarding`, `/connect`, `/org/*` are all open with no sign-in — matches her character binding (`/`, `/onboarding`, `/org/[slug]`, `/pricing`, privacy story).
- `ASCENT_OPEN_ORG_DASHBOARDS=1` + local-profile auto-seed → `/org/<slug>` reachable and resolves her as owner (real `Membership` row) on the second visit.
- Everything in her `maps_to` (`/`, `/onboarding`, `/org/[slug]` overview, `/pricing`, Bedrock/privacy story) is reachable in this env. `/org/[slug]/executive` (where the org-level "one move" lives) and `/org/[slug]/adoption` are **not named in her `maps_to`** but are one click away in the same nav — reachable, just not pre-declared, which is why F3/F4 below are framed as discoverability, not blockers.
- Production-config caveat (F2): if Supabase auth is the deployed configuration (the stated intended posture per `uat/env.md`'s own auth section), `authGateEnabled()` flips true and the public `/` → `/report` funnel — her #1 acceptance criterion — is not reachable without signing in. This is out of the UAT env's reachable set today but is the real production surface her character binding implicitly assumes stays open; flagged for L2/deploy-config verification, not scored against the UAT-env walkthrough itself.

## 3. In-character walkthrough (thought experiment over the model above)

*Fifteen minutes between meetings. I open `/`.*

I paste `vercel/next.js` into the input — no `github.com/` typing needed, it's pre-filled as a prefix and the box just wants `owner/repo`. I hit Scan. It jumps me straight to `/report?repo=...` with a live progress checklist and an SSE stream with a 15s heartbeat — I'm not staring at a dead spinner (`useReportScan.ts`, `route.ts:96-124`). No signup wall touched. Good — that's the single biggest thing that would have made me bounce, and it didn't happen.

The report lands on Scoring first. Score, level, radar — fine, but I want the "says who" answer, so I open a dimension card. The evidence bullets are real and specific ("Found 6 test files", governance facts, PR stats) — not "add more tests" horoscope filler — but they're **plain text, not a link to the actual file or PR**. I can believe them because the language is specific enough to smell right, but I can't click through to the line myself. For a first quick read I'll let this go; if I were about to gate a merge on this score I'd want the click-through.

I flip to the Roadmap tab. There's a "Fastest path" callout and a numbered list with a "⚡ Quick win" badge — item #1 reads like the one thing to do Monday, not a backlog dump. That matches what I wanted, though I had to find the tab myself (Scoring is the default landing view, not Roadmap) — a small "where's the ask" moment, not a wall.

Now the org read. I go to `/onboarding`, pick my repos, and it flags "Install the GitHub App" for private/org access. I click that before committing — and there it is: a privacy box that names the exact inference path in plain terms ("Claude on AWS Bedrock — your code stays within the AWS boundary and is never used for model training") and, when Bedrock isn't wired, tells me explicitly `LLM_PROVIDER=bedrock` is the knob for that guarantee. This is legible **at the decision point**, not in a docs page I'd have to go hunting for — exactly my gate, cleared before I've handed over anything private.

At `/org/<slug>` I see repos grouped by Type/Stack/Level with per-group averages and movement, plus a repo × dimension heatmap — this reads as rigor, and it's real (mock-provider scores are still derived from the actual deterministic signals per repo, not canned, so a genuinely-thin repo reads thin). But "adoption × rigor" as a *combined read* isn't on this page — adoption (AI commit share, champions, enablement) is a separate tab. I'd find it — it's one click in the nav — but if I were moving fast I could easily leave the overview believing I only got the rigor half of the promise.

I go looking for "the one move" at the org level and don't find it on the page I landed on — it's on Executive, not Overview. Once I find it, it's exactly what I wanted: "The move to make next," ranked, with a real projected point gain and which repos it touches. I just had to go one tab further than the character-binding implied.

## 4. Scored acceptance criteria — verdict

| # | Criterion | Verdict | Note |
|---|---|---|---|
| 1 | `/` → evidence-cited read in minutes, no signup/sales call before first value | **PASS** (in UAT env) / **at-risk in prod config** | `authGateEnabled()` gates the whole funnel once Supabase is the real deployed config — F2 |
| 2 | Streams progress; names a single highest-leverage move, engineering vocabulary | **PASS** (single-repo Roadmap #1 + "Fastest path"); **PARTIAL at org level** (exists, but on Executive not Overview) | F3 |
| 3 | Every score grounded in drill-to-able repo evidence, answers "says who?" | **PARTIAL** | Evidence is real and specific text, not a click-through to file/line/PR — F1 |
| 4 | Org read reconciles with her sense of teams; separates adoption from rigor | **PASS, structurally** | Two distinct, real (signal-derived) surfaces — rigor on Overview, adoption on its own tab — but not unified into one reading, and she must discover the second tab herself — F4 |
| 5 | Privacy: legible, in-product, at point of decision, before scanning private code | **PASS** | `/connect`'s `ConnectPrivacyNotice`, reached from the onboarding checklist, states the Bedrock no-training/in-boundary guarantee in AWS's own terms |
| 6 | Time-saved: well under an afternoon vs. the multi-week manual loop, beats gut-feel skim | **PASS, structurally** (design promise) | Single scan: minutes. First org read: one seed run + browsing, well under an afternoon. Confirmed live by L2. |
| 7 | Senior-quality: she'd defend the level + the one move in front of her board | **CONDITIONAL** | Machinery and grounding are real (guardbanded LLM, provenance track, evidence, forbid-invention system prompt) — the design promise clears the bar; whether the actual generated prose does is an L2 question, and the org-level "one move" surface needs to be surfaced where she'd actually look |

## 5. Findings (L1)

### F1 — Evidence is prose, not drill-to-able
- file: `src/components/report/DimensionCard.tsx:78-89`; `src/lib/types.ts:273-275`; `src/lib/scoring/engine.ts:131`
- type: `confusion` (present-but-undiscoverable in the sense that the underlying file/PR isn't reachable from the claim) — dimension: `trust`
- summary: Dimension evidence renders as a plain-text label (e.g. `"Found 6 test files"`, `formatSignal()`) with no link to the actual file, line, or PR it came from.
- failure_scenario: Elena reads "CI config found" for D5, wants to check *which* workflow file and whether it actually gates anything before she repeats the number to her board — there is no click-through in the report itself; she'd have to go open the repo herself and guess.
- severity: **major** (undercuts "says who?" — her explicit trust bar — for anything beyond a first skim)
- impact: frequency=high (every dimension, every scan), reachability=high (she opens dimension cards on the very first scan), trust_erosion=med (evidence text itself is specific/plausible, so it's a partial not total trust failure)
- code_check: confirmed-absent (no href/file-line anywhere in the evidence render path — verified no `github.com`/`href` in `DimensionCard.tsx`)
- verdict: confirmed
- l2_priority: On a live scan of a real repo, check whether any evidence string could plausibly be turned into a link (repo/PR/commit URLs are already known to the scan) and whether Elena's tolerance holds for a first-pass skim vs. a board-facing citation.

### F2 — Production auth policy gates the entire public funnel, not just org features
- file: `src/app/api/scan/stream/route.ts:69-73`; `src/lib/env.ts:42-44`
- type: `trust` / potential `broken-flow` depending on deploy config — dimension: `completion`
- summary: `authGateEnabled()` (Supabase configured + bypass off) makes **every** scan, including the very first anonymous public-repo scan, return 401 without sign-in. The UAT env deliberately keeps this off, but that is exactly the config her character binding assumes is the honest state of the funnel.
- failure_scenario: Ascent is deployed with Supabase wired up (its stated real login path) and no dev bypass. Elena hits `/`, pastes `vercel/next.js`, and gets a 401 asking her to sign in before she's seen a single score — precisely the "wall before first value" she calls an instant bounce.
- severity: **major** (directly contradicts her #1 acceptance criterion) but **impact tempered by reachability**: not reachable in the UAT env used for this and the eventual L2 pass, so today's live test cannot observe it — it's a policy fact about the *other* deploy config.
- impact: frequency=n/a under current env, reachability=**unreachable under current UAT fixture** (bypass is on), trust_erosion=high if it ever fires
- code_check: present-by-design (this is deliberate anti-abuse gating, not a bug) — `by-design`, but the design contradicts a stated JTBD for the persona this journey targets
- verdict: confirmed (code fact), impact deferred
- l2_priority: not testable at L2 under the pinned UAT env; flag for a separate config-matrix check (does the marketing/pricing site actually promise "no signup" while a Supabase-configured production build would 401 the funnel?).

### F3 — Org-level "single highest-leverage move" lives on Executive, not Overview
- file: `src/app/org/[slug]/executive/page.tsx:180`; `src/components/org/executive/OrgLeverageMoves.tsx:21-38`; absent from `src/app/org/[slug]/page.tsx`
- type: `confusion` (discoverability) — dimension: `clarity`
- summary: Elena's character binding names `/org/[slug]` overview as where she'd find the "movers, highest-leverage move" — the actual component (`OrgLeverageMoves`, "The move to make next") is imported only by the Executive tab.
- failure_scenario: She scans an org, lands on Overview, sees the fleet trajectory and heatmap, and leaves believing there's no single decision surfaced — because she never clicks into "Executive," a tab she has no strong a-priori reason to open on a first pass (it reads as "board deck," not "next repo fix").
- severity: **minor** (the affordance exists and is one click away in persistent nav; not a dead end)
- impact: frequency=high (every org read), reachability=med (nav-discoverable but not on the landing tab), trust_erosion=low (once found, it's exactly the right artifact)
- code_check: present-but-missed (the feature exists; the surface model's placement assumption was wrong)
- verdict: confirmed
- l2_priority: watch whether a live walkthrough actually clicks into Executive unprompted, or leaves without ever seeing "The move to make next."

### F4 — Adoption and rigor are real but split across two undeclared tabs
- file: `src/app/org/[slug]/page.tsx:65-131` (rigor) vs. `src/app/org/[slug]/adoption/page.tsx:42-119` (adoption)
- type: `confusion` — dimension: `clarity`
- summary: The two halves of "adoption × rigor" (her explicit vocabulary, and the product's own `"trust = adoption × rigor"` tagline at `roadmapPieces.tsx:104-121`'s sibling `TrustLadder`) live on separate nav tabs rather than one combined read; neither tab is named in her character's declared `maps_to`.
- failure_scenario: She reads the rigor-only Overview, forms a partial "are we AI-native" verdict, and doesn't discover the Adoption tab's champions/enablement/AI-commit-share data unless she goes looking — undercutting "separates adoption from rigor" as a *single legible read*, even though both pieces individually are strong.
- severity: **minor** (both surfaces are real, evidenced, and well-built individually; this is an integration/discoverability gap, not a missing capability)
- impact: frequency=high, reachability=med, trust_erosion=low
- code_check: present-but-missed
- verdict: confirmed
- l2_priority: confirm whether a live Elena walkthrough naturally visits both tabs inside her 15-minute budget, or stops at Overview.

### Strength — Grounded, provenance-transparent scoring
- file: `src/lib/scoring/prompt.ts:65` (anti-invention system prompt); `src/components/report/DimensionCard.tsx:107-135` (`ProvenanceTrack`, visualizes signal vs. LLM vs. blended score with a guardband)
- type: positive
- summary: The scoring pipeline threads real PR/governance/security/standing-decision evidence into the prompt, forbids invented facts, and renders the signal→LLM→blended provenance as an auditable micro-viz. This is exactly the "not vibes" bar Elena sets, and it's structurally real, not cosmetic.

### Strength — Privacy story lands at the decision point
- file: `src/components/connect/PrivacyNotice.tsx:31-56`
- type: positive
- summary: `/connect`'s privacy notice is reached from the onboarding checklist *before* the GitHub App is granted private-repo access, names the effective provider, and states the Bedrock no-training/in-boundary guarantee in language matching the AWS FAQ she cited. This clears her hardest gate cleanly.

## 6. Character voice — reaction (L1, over the designed experience)

"Okay, this is closer to right than most things I've been shown. I paste a repo, I get a scan, nobody made me sign up first — that alone puts it ahead of every 'book a demo' tool that's wasted my afternoon. The evidence reads like a real audit, not a horoscope — 'AI-involved PR rate,' 'branch protection not enforced,' that's my vocabulary, not marketing copy. And the privacy box at `/connect` actually answers the question I ask first, in the terms I'd check against AWS's own docs — that's the one thing that would've stopped me cold, and it didn't.

"Two things would bug me on a real run. First: I can't click an evidence bullet to the actual file. I'll believe 'found 6 test files' on a skim, but if I'm putting this number in front of my board I want the receipts, not a description of them. Second: I went looking for 'the one move' at the org level and it wasn't where I landed — I had to find Executive. Once I found it, it's exactly what I wanted, ranked, with a real projected point gain — so it's there, it's just not where my instinct took me first.

"Would I adopt it for the fifteen-minute gut-check? Yes — it's fast, it doesn't waste my time, and it doesn't ask for anything before it earns it. Would I stake the board deck on the score as-is? Not until I can click through to the evidence myself. That's a fixable gap, not a dealbreaker — and unlike most of the tools that pitched me, this one at least shows its work instead of asking me to trust a badge."
