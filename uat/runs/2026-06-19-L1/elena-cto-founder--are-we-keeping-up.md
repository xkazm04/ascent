# L1 — Elena (CTO / Founder) × are-we-keeping-up

**Verdict: L1-conditional** — the public scan → evidence-cited read and the whole-org → fleet dashboard both complete structurally with senior-grade grounding (signal→LLM→blended provenance, adoption/rigor split, single highest-leverage move). But Elena's hard privacy gate fails on paper: the Bedrock *no-training / in-boundary / not-shared-with-providers* guarantee is **never rendered in any UI at the point she'd decide to scan private code** — it lives only in README/docs/code comments, and the default provider routing isn't Bedrock. That's a major (carries forward).

---

## Reachable surface set

Following nav + entitlement/auth gating from the two journey entry points:

**Public path (no auth, the no-signup promise):**
- `/` landing → `IndexLanding` → `IndexVariant` → `IndexHero` with the live `ScanForm` (`src/components/landing/prototypes/index/IndexHero.tsx:52`). No gate — `force-dynamic`, gallery is best-effort (`src/app/page.tsx:63`).
- `ScanForm` submit → `router.push('/report?repo=…')` (`src/components/ScanForm.tsx:85`) → `/report` → `ReportClient` streams `/api/scan/stream` (`src/components/report/ReportClient.tsx:105`). Public, free, no signup; the weekly soft-quota only enforces when DB-on AND kill-switch off (`src/app/api/scan/route.ts:116-126`).
- `/onboarding` → `OnboardingFlow` (`src/app/onboarding/page.tsx:67`). Reachable with NO session: the pick step accepts a public org *handle* and lists via `/api/org/repos` (public listing, `src/components/onboarding/OnboardingFlow.tsx:143`); the import runs a **disclosed mock preview** on the public-handle path (`importScan.ts:67`, `canRunReal.ts`). So a whole-org read is reachable public/no-auth — but it's a *preview*, not live scores.
- `/pricing` (`src/app/pricing/page.tsx`) — public, glanceable.

**Org dashboard (Elena's real fleet read) — under `ASCENT_AUTH_BYPASS=1` + seeded org:**
- `/org/[slug]` layout gates on: DB configured (`layout.tsx:42`), auth gate (bypassed — `authGateEnabled()` false when `authBypassEnabled()`, `src/lib/access.ts:44-46`), `canReadOrg(slug)` (PUBLIC_ORG open; bypass viewer is synthetic owner), and `rollup.repoCount > 0` (`layout.tsx:126`). With `npm run db:local:seed` / `seed-org.mjs vercel`, `/org/vercel` is reachable and the bypass persists a real `developer` owner Membership on 2nd visit (`layout.tsx:142-144`).
- Overview renders fleet maturity, **AI Adoption / Engineering Rigor tiles**, posture distribution, movers, gap analysis, and **highest-leverage moves** (`src/app/org/[slug]/page.tsx:186-288`).

**Reachable but tagged for this journey:** `/connect` (private-repo decision surface) is reachable and *is* where the privacy question lands — central to her gate even though paid checkout / live private routing is out of journey scope.

---

## Surface model notes (affordances → backing file:line; grounding audit emphasized)

**Public scan → evidence-cited read (her first-value moment):**
- Paste box + Scan + "Top scored"/"Try" chips, inline normalize/validation, `aria-busy`, bfcache reset — `src/components/ScanForm.tsx:88-196`. No signup wall anywhere on this path. ✓
- Streaming progress: SSE frames update a `progress` bar with sticky provider/region/fallback (`ReportClient.tsx:177-188`); 180s client timeout maps aborts to typed messages (`:236-243`). Directly answers her "frozen spinner → I bail" peeve. ✓

**Grounding audit (does the score get real repo evidence + provenance?):**
- Ingestion samples ≤ `MAX_FILES=32`, `MAX_TOTAL_BYTES=180k`, 30 commits, with a *curated high-signal picker* (agent-guidance files anywhere, manifests, CI workflows, cursor/MCP, ADRs, tests, source texture) — `src/lib/github/source.ts:36-41, 520-628`. This is targeted, not a blind 32 — the signal-bearing files are prioritized.
- Prompt feeds the LLM the deterministic **signalScores + evidence labels**, PR/branch-protection process block, commit sample, and file excerpts (≤22KB window) and orders it to *calibrate to the signals and act as an auditor flagging detector misses* — `src/lib/scoring/prompt.ts:46, 111-141`. Real evidence, not vibes.
- Engine **guardbands** the LLM to ±`LLM_GUARDBAND` of the signal, **coverage-weights** the blend (`effectiveBlend = SCORE_BLEND * coverage`), renormalizes the weighted mean, and emits loud warnings on partial-LLM / total-detector failure / unknown dims — `src/lib/scoring/engine.ts:70-156`. Honest math; can't silently fabricate a flattering number.
- Report drill-down ("says who?"): `DimensionCard` expands to **Evidence list + Gaps + a signal→LLM→blended `ProvenanceTrack` SVG** with the ±guardband zone — `src/components/report/DimensionCard.tsx:75-103, 117-159`. The "Flagged for review" discrepancies panel surfaces LLM-vs-detector disagreements — `ReportView.tsx:245-260`. This is exactly the receipts an evidence-driven CTO demands. ✓ (strength)
- **Single highest-leverage move:** `NextLevelPath` (cheapest dimension combo to next band, `RoadmapPanel.tsx:89-106` ← `engine.ts:320`) + roadmap items ordered quick-wins-first with payoff chips, phrased as invitational "gaps to explore" not orders (`prompt.ts:129-141`, `RoadmapSteps` `RoadmapPanel.tsx:109`). A decision, not a backlog. ✓

**Whole-org read (adoption vs rigor, the reconciliation test):**
- `/onboarding` collapses nothing-to-fleet-read: pick (handle or App install) → select ≤10 → one-shot streamed scan with per-repo rows + stall watchdog → done with checklist + "View dashboard" — `OnboardingFlow.tsx:237-298`, `importScan.ts:42-128`. Minutes, no spreadsheet. ✓
- Org overview separates **AI Adoption** and **Engineering Rigor** as distinct tiles + posture quadrant distribution (`page.tsx:196-211, 234-248`), names common-across-fleet vs repo-specific gaps (`OrgGapsSection`, `page.tsx:227`), and ranks **fleet leverage moves by repos×impact×weight** (`OrgLeverageMoves.tsx:36`). Structurally this is her adoption≠rigor read. ✓ (reconciliation-to-*her-teams* is L2.)

**Privacy / "where does my code go?" (her hard gate) — the defect:**
- `/connect` (decision point for private scans) copy: *"Inference runs against your repositories using a short-lived installation token — Ascent stores only the derived scores and evidence, never your source."* — `src/app/connect/page.tsx:46-51`. This is a GitHub-source-not-stored claim, **not** the LLM no-training/in-boundary guarantee she requires.
- Marketing HOW step: *"no clone, nothing stored"* — `content.ts:82` — same GitHub-read claim.
- The only place "AWS Bedrock" appears in rendered UI is the **Enterprise (Custom) pricing card** — *"Private inference via AWS Bedrock"* / *"data residency · VPC"* — `content.ts:63-67`. No *no-training / not-shared-with-providers* wording; gated under the "Contact us" enterprise tier, not where a credits-path private scan is decided.
- The clean guarantee — *"code never leaves the AWS boundary and is never used for training"* — exists only at `README.md:151-152` and in code comments (`src/lib/llm/bedrock.ts:1-3`, `src/lib/llm/config.ts:5`). Developer docs, not product UI.
- Provider routing: `LLM_PROVIDER=auto` (default) → **Gemini-or-mock**, and the comment is explicit: *"Never silently selects Bedrock — that's opt-in via the flag"* (`src/lib/llm/config.ts:8`, `getProvider` `:106-108`). So absent explicit operator config a private scan routes to **Gemini**, and **no UI tells the user which provider processed their code** (the report header shows `engine: <provider>` only *after* the fact — `ReportHeader.tsx:48`).

---

## Findings

```json
[
  {
    "id": "L1-ELENA-AWK-01",
    "journey": "are-we-keeping-up",
    "character": "Elena (CTO / Founder)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "Bedrock no-training / in-boundary guarantee is invisible at the point of private-scan decision (buried in README/docs)",
    "expected": "Before scanning private code, from the product itself, she can confirm a Bedrock / in-boundary, no-training, not-shared-with-providers path exists (matching AWS's own statement) — legible at the decision point, not buried in docs.",
    "got": "The /connect surface (where private scanning is decided) only promises Ascent 'stores only the derived scores and evidence, never your source' — a GitHub-source claim. The LLM no-training/in-boundary guarantee is rendered nowhere a user sees it: it lives in README.md:151-152 and code comments. The only UI mention of 'Bedrock' is the Enterprise (Custom) pricing card with no no-training wording. Default LLM_PROVIDER=auto routes to Gemini, not Bedrock ('Never silently selects Bedrock'), and no UI states which provider processed the code.",
    "evidence": ["src/app/connect/page.tsx:46-51", "src/components/landing/prototypes/shared/content.ts:63-67", "src/components/landing/prototypes/shared/content.ts:82", "src/lib/llm/config.ts:5-8", "src/lib/llm/config.ts:106-108", "src/lib/llm/bedrock.ts:1-3", "README.md:151-152", "src/components/report/ReportHeader.tsx:48"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Confirm live: is there ANY in-product disclosure (tooltip, connect copy, a privacy/trust page) of where private code is routed and the no-training guarantee, before or during a private/installation scan? Check whether the engine chip + any pre-scan notice make the provider legible to a non-engineer buyer.",
    "suggested_acceptance": "On /connect (and the onboarding App path), before a private scan runs, the product states which provider processes the code and that the Bedrock path is in-boundary / no-training / not-shared-with-providers — in rendered UI, not only docs."
  },
  {
    "id": "L1-ELENA-AWK-02",
    "journey": "are-we-keeping-up",
    "character": "Elena (CTO / Founder)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "dimension": "trust",
    "title": "Whole-org read via /onboarding is a disclosed MOCK preview on the public-handle path — not live scores",
    "expected": "A fast first whole-org read that reconciles with her sense of her teams.",
    "got": "Without a GitHub App installation + org credits, the onboarding import runs a deterministic MOCK preview (mock:true default), explicitly disclosed; real LLM scores require the App path + credits. So her 'minutes for a public repo, an afternoon for the org' read is structurally available but the org-wide scores are preview-grade unless she installs the App on her own (private) org.",
    "evidence": ["src/components/onboarding/importScan.ts:67-70", "src/components/onboarding/OnboardingFlow.tsx:249-252", "src/components/onboarding/canRunReal.ts"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "L2: confirm the preview is clearly labeled in the done-state and dashboard so a CTO never mistakes preview scores for a live fleet read; verify the App-path live org scan actually produces reconciling per-squad scores."
  },
  {
    "id": "L1-ELENA-STR-01",
    "journey": "are-we-keeping-up",
    "character": "Elena (CTO / Founder)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "dimension": "senior-quality",
    "title": "STRENGTH — every dimension drills to evidence + a signal→LLM→blended provenance track with an explicit ±guardband",
    "expected": "Answer 'says who?' from the report itself; a number she can defend to her board.",
    "got": "DimensionCard expands to Evidence + Gaps + a ProvenanceTrack SVG showing signal tick, clamped LLM judgment, blended marker, and the shaded ±LLM_GUARDBAND zone; engine guardbands the LLM to ±band and coverage-weights the blend; a 'Flagged for review' panel surfaces LLM-vs-detector discrepancies.",
    "evidence": ["src/components/report/DimensionCard.tsx:75-103", "src/components/report/DimensionCard.tsx:117-159", "src/lib/scoring/engine.ts:98-102", "src/components/report/ReportView.tsx:245-260"],
    "code_check": "present-but-missed",
    "verdict": "confirmed"
  },
  {
    "id": "L1-ELENA-STR-02",
    "journey": "are-we-keeping-up",
    "character": "Elena (CTO / Founder)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "dimension": "completion",
    "title": "STRENGTH — no-signup first value + streamed progress: paste a public repo, see streaming stages, reach an evidence-cited read with no wall",
    "expected": "From / paste a public repo → evidence-cited read in minutes, no signup / sales call / forced tour, with streaming so it never reads as hung.",
    "got": "ScanForm → /report streams /api/scan/stream with a live progress bar (sticky provider/region/fallback) and typed timeout/abort messages; the public path has no auth gate; the weekly soft-quota even salvages the last persisted report instead of a dead-end wall.",
    "evidence": ["src/components/ScanForm.tsx:85", "src/components/report/ReportClient.tsx:105-188", "src/app/api/scan/route.ts:116-126", "src/components/report/ReportClient.tsx:122-150"],
    "code_check": "present-but-missed",
    "verdict": "confirmed"
  },
  {
    "id": "L1-ELENA-STR-03",
    "journey": "are-we-keeping-up",
    "character": "Elena (CTO / Founder)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "dimension": "senior-quality",
    "title": "STRENGTH — adoption vs rigor honestly separated at both repo and fleet level, with a single highest-leverage move tied to the cited gap",
    "expected": "Separate adoption from rigor (everyone has Copilot ≠ AI-native); name the ONE highest-leverage move in engineering terms.",
    "got": "Org overview shows distinct AI Adoption / Engineering Rigor tiles + posture quadrant; fleet leverage moves rank by repos×impact×dimension-weight; repo report's NextLevelPath computes the cheapest dimension combo to the next band and roadmap is invitational, quick-wins-first.",
    "evidence": ["src/app/org/[slug]/page.tsx:196-211", "src/components/org/OrgLeverageMoves.tsx:36", "src/components/report/RoadmapPanel.tsx:89-106", "src/lib/scoring/engine.ts:320-371"],
    "code_check": "present-but-missed",
    "verdict": "confirmed"
  }
]
```

---

## Character feedback (Elena, first person)

Okay — first impression on paper: this gets me. I pasted a repo, no signup, no "book a demo," and it streams stages while it works so I'm not staring at a dead spinner wondering if it hung. Good. And when I open a dimension it doesn't just hand me a number — it shows the evidence, the gaps, and that little provenance bar where I can literally see the deterministic signal, where the LLM landed, and that the model is *clamped* to ±25 of the signal so it can't just hallucinate me a flattering grade. That's the difference between an assessment and a horoscope. That, plus the "flagged for review" panel where the AI calls out where it thinks the detector is *wrong* — that's exactly the skeptical-auditor posture I'd want. I'd believe this number enough to drill into it in front of my co-founder.

The org read is the right shape too: it doesn't conflate "everyone turned Copilot on" with "we're AI-native" — adoption and rigor are separate tiles and there's a posture quadrant, and the fleet view ranks the gaps by how many repos they touch and gives me a *fastest path to the next level*, not a 40-item backlog. That's the decision I came for. Whether my genuinely-AI-native squad actually reads strong and my legacy one reads manual — I can't confirm that on paper; that's the live test.

But here's where I stop cold, and it's the whole reason I'm cautious about pointing this at real code: **I cannot tell, from the product, where my private code goes.** The connect page tells me you don't *store* my source — fine, but that's the GitHub-read question, not the one that keeps me up. The one I need answered before I click is "which model sees my proprietary code, and is it training on it?" The clean answer — Bedrock, in-boundary, never trained on, not shared with providers — is sitting in your README and a code comment, not on the screen where I'm about to scan a private repo. Worse, when I read the routing, the default isn't even Bedrock — it's Gemini unless someone sets a flag, and nothing in the UI tells me that. For me that's not a footnote, it's a gate. I'd run all the public scans I want, I'd happily preview my org, but I would *not* point this at our pre-revenue private code on the strength of "trust me, it's in the docs."

Would I adopt it? For the public, evidence-cited read — yes, today, it beats my gut-feel afternoon and I'd repeat it. For the private fleet read that's the actual board question — not until you make the data-handling story legible at the moment I'm deciding. Make me able to answer "where does my code go and is it training on it?" *on the connect screen*, and you've got me.

---

## l2_priority (carry-forward)

- **(Top)** Confirm whether ANY in-product UI discloses the private-code routing + the Bedrock no-training/in-boundary guarantee *before/at* a private scan — connect copy, a pre-scan notice, a privacy/trust page, or the engine chip. If still docs-only, the major stands.
- Run a live public scan (claude-cli) on a real repo and confirm the rendered per-dimension scores reconcile with the cited evidence and the provenance track matches the headline math (not just structurally present).
- Live whole-org read: seed `/org/vercel`, confirm adoption≠rigor scores, posture distribution, and fleet leverage moves are *non-generic* and would reconcile with a CTO's lived sense of her teams (surfaces at least one real gap, not a horoscope).
- Confirm the onboarding public-handle **mock preview** is unmistakably labeled in the done-state + dashboard so preview scores are never mistaken for a live fleet read.
- Verify the single "fastest path / highest-leverage move" reads as a defensible engineering decision on a real repo, phrased in her vocabulary — not "add more tests."
- Confirm streamed scan latency on a large repo stays under her patience threshold (progress keeps moving; no silent 180s wall).
