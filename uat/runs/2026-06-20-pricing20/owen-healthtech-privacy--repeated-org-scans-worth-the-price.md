# L1 — Owen (HIPAA platform eng) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional.** The recurring-value machinery (trajectory/movers/trend, guardbanded blend) is **engine-agnostic** — it survives the swap from cloud Claude to Bedrock or to the deterministic floor — and the product has an unusually honest, *in-product* privacy disclosure of the inference hop plus a real no-training Bedrock path. What keeps it off a clean pass for Owen: **Bedrock is "Phase 2"** (the provider works but the enterprise infra is per-deployment, so a 60-eng Pro buyer can't just flip it on), there is **no BYO-model / self-host / on-prem story** beyond Bedrock or mock, and the **subscription $ is invisible** for the exact tier (Pro) he'd start on. The privacy story holds; the *reachability* of the privacy-safe engine at his tier, and price-legibility, are the open majors.

## Reachable surface set (tier-honest)

Under `ASCENT_AUTH_BYPASS=1` on a populated `/org/<slug>`, Owen reaches the full `/org/*` set as a synthetic owner. Tier-honest entitlements for his likely **Pro** start:
- **Reachable & relevant:** `/connect` privacy notice (the inference-hop disclosure), `/org/[slug]` Overview (Trajectory + movers/period), `/trends`, `/usage` (credit + **provider-mix**), `/pricing`, the per-report **engine chip**. Scheduled autoscans + alerts are **Pro+** — included.
- **By-tier / not at Pro:** segments + comparisons, playbooks, **180-day** retention cap (vs Team 365 / Enterprise custom). For a *monthly* cadence 180 days = ~6 trajectory points, which is plenty — retention is **not** his binding constraint (unlike the compliance/M&A characters).
- **The real gate — operational, not auth:** `LLM_PROVIDER=bedrock` is a **deployment-level** env choice (`llm/index.ts:101`), not a per-org toggle, and Bedrock's IAM/VPC/KMS wiring is **per-deployment Phase-2 infra** (`docs/features/llm-providers.md:63-65`, `ARCHITECTURE.md §`). So "exists in code" ≠ "reachable by a Pro-tier Owen who just installs the GitHub App." For SaaS Pro he'd be on the *deployment's* provider (Gemini in prod, or mock), not his own Bedrock — that's the upsell to Enterprise/self-managed, and it's the crux of his verdict.

## Surface-model notes (recurring-value affordances → file:line; privacy/engine emphasis)

- **The inference-hop disclosure exists, in-product, per-engine — the thing he opens with.** `ConnectPrivacyNotice` (`src/components/connect/PrivacyNotice.tsx:30-58`) states "a budgeted sample of your repository's file contents (≤32 files) is sent to {provider}" and has a precise `WHERE` map (`:15-22`): Bedrock = "stays within the AWS boundary and is never used for model training," `claude-cli` = "stays on this machine," **mock = "nowhere … no code leaves this deployment."** It explicitly *separates* the inference hop from persistence ("Ascent persists only the derived scores and evidence — never your source," `:38-40`) — exactly Owen's "those are different leaks" distinction. **Major strength for him.**
- **What leaves = ≤32 files of source, capped.** `src/lib/github/source.ts:36` `MAX_FILES = 32`, `:37` `MAX_FILE_BYTES = 14_000`, `:38` `MAX_TOTAL_BYTES = 180_000`; the prompt window further caps to `PER_FILE = 2200` / `OUTER = 22000` (`scoring/prompt.ts:87-88`). High-signal config + a *sample* of source/tests (`pickFilesToFetch`, `source.ts:520-628`). So per monthly cycle, per private repo, a bounded ~180KB source sample crosses the inference boundary — bounded and inspectable, but it *is* source leaving on the cloud engines.
- **Bedrock is the real no-training path, and it's honest about being Phase 2.** `src/lib/llm/bedrock.ts:1-11` documents in-account/in-region inference, no training, US-geo default `us.anthropic.claude-sonnet-4-6`; ARCHITECTURE.md states Bedrock is **in scope for SOC, ISO, GDPR, HIPAA, FedRAMP High**, KMS-encrypted, over PrivateLink/VPC, "never used for training." `docs/features/llm-providers.md:38,63-68` is candid: Bedrock is **Phase 2** (provider works; IAM/VPC/residency per-deployment), and "Gemini ≠ enterprise path." No "HIPAA-compliant" over-claim found — it says *eligible infra, you wire the rest*. **Clears his no-over-claim bar.**
- **Engine-honest recurring read — the move can't be laundered.** Every scan persists `engineProvider` (`src/lib/db/scans-persist.ts:203`, read back `scans-read.ts:712,181,295,364`); `/usage` groups by `engineProvider` for a **provider-mix** view (`src/lib/db/usage.ts:115`); the per-report chip shows `engine: {provider} · {model}` or, for mock, a distinct **"Demo · deterministic rubric"** badge (`src/components/report/ReportHeader.tsx:40-51`). So a cycle that ran on mock (or a different provider) is **visible in the trend**, not silently blended in. **This is the single feature that makes a mixed/degraded-engine fleet trustworthy to him.**
- **Selection fails fast, doesn't silently degrade.** `getProvider` trusts an explicit `LLM_PROVIDER=bedrock` and constructs `BedrockProvider` (`llm/index.ts:101`); the comment at `:94-100` is explicit that pre-degrading a selected-but-unavailable real provider to mock was REMOVED because it served "mock scores with NO caveat (success theater)" — now a misconfig fails at `assess()` and degrades *with* honest accounting (the `llmFailed` warning + fallback SSE event). `bedrock.ts:107-122` even repair-parses a stringified tool-input so a recoverable Bedrock answer isn't degraded to the mock floor. **Directly addresses his "silent fallback to mock" pet peeve.**
- **Recurring value is engine-agnostic — survives the swap.** Trajectory (`forecast.ts:82`, OLS over day-offset/score; null < 2 distinct days; `FLAT_PER_WEEK=0.5` floor `:64,131`; R² surfaced as "trend confidence … · noisy" `Trajectory.tsx:96`) is computed from the **persisted score history**, not from any provider. The blend (`engine.ts:70-102`: LLM guardbanded ±`LLM_GUARDBAND`=25 to the deterministic signal, 60/40, coverage-scaled) means even the mock floor produces a **renormalized, archetype-weighted** number, and the deterministic signals carry the bulk. **So the recurring read renders on Bedrock OR mock** — it does not collapse to nothing without cloud Claude. The honest caveat: on **mock**, every dimension is `signalScore` ± nothing (no LLM nuance), and the report is *labeled* deterministic — repeatable, but the LLM-written discrepancy-catching and roadmap nuance are absent. That's the "repeatable but possibly hollow" risk, and it IS surfaced.

## Findings

```json
[
  {
    "id": "owen-priv-disclosure-in-product",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "owen-healthtech-privacy",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH — the inference hop is disclosed in-product, per-engine, and separated from persistence",
    "expected": "Before sending source to an LLM, tell me WHAT leaves and WHERE per engine, surfaced in the product — not just a persistence promise buried in docs.",
    "got": "ConnectPrivacyNotice states '≤32 files of your repository's file contents are sent to {provider}' with a precise per-provider WHERE map (Bedrock = AWS boundary, no training; claude-cli = stays on this machine; mock = nowhere), and explicitly separates the inference hop from persistence ('persists only scores + evidence, never your source'). Exactly Owen's 'those are two different leaks' distinction.",
    "evidence": ["src/components/connect/PrivacyNotice.tsx:15-22", "src/components/connect/PrivacyNotice.tsx:30-58", "src/lib/github/source.ts:36"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "On /connect with LLM_PROVIDER set, confirm the live notice names the effective provider and the ≤32-file disclosure renders before any private scan."
  },
  {
    "id": "owen-engine-honest-trend",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "owen-healthtech-privacy",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "STRENGTH — every scan records its engine, so a degraded/mixed-engine cycle is visible, not laundered into the trend",
    "expected": "If one monthly cycle silently ran on the deterministic floor (or a non-private engine), I must be able to see that — a trend that blends private and mock reads with no marker is worthless to me.",
    "got": "engineProvider is persisted per scan and read back into the comparable shape; /usage groups by engineProvider (provider-mix); the report chip shows 'engine: provider · model' or a distinct 'Demo · deterministic rubric' badge for mock. A degraded cycle is surfaced, not hidden.",
    "evidence": ["src/lib/db/scans-persist.ts:203", "src/lib/db/scans-read.ts:712", "src/lib/db/usage.ts:115", "src/components/report/ReportHeader.tsx:40-51"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "With claude-cli engine: re-scan a repo, force a mock fallback on one cycle, confirm the /usage provider-mix and the report chip distinguish the two cycles."
  },
  {
    "id": "owen-recurring-value-engine-agnostic",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "owen-healthtech-privacy",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "senior-quality",
    "title": "STRENGTH (with caveat) — trajectory/movers/blend are engine-agnostic, so the recurring read survives Bedrock or the mock floor",
    "expected": "The recurring value must not depend on cloud Claude. If I run Bedrock or am forced to mock, the trajectory/movers/trend must still render and still be guardbanded.",
    "got": "Trajectory is OLS over the persisted score history (forecast.ts), independent of provider; the blend guardbands the LLM ±25 to the deterministic signal and is coverage-weighted toward the deterministic floor (engine.ts:70-102), so even mock yields a renormalized archetype-weighted number. The recurring read does NOT collapse without cloud Claude. Caveat: on mock there is no LLM nuance/discrepancy-catch — repeatable but thinner — though it is labeled deterministic.",
    "evidence": ["src/lib/maturity/forecast.ts:82-148", "src/lib/scoring/engine.ts:70-102", "src/lib/llm/mock.ts:42-96"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Run the same fleet under bedrock vs mock; confirm Trajectory/movers render in both and the mock report is labeled 'Demo · deterministic rubric' (not dressed as AI analysis)."
  },
  {
    "id": "owen-bedrock-phase2-unreachable-at-pro",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "owen-healthtech-privacy",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "missing",
    "title": "The privacy-safe engine is a deployment-level Phase-2 choice, not a per-org toggle — a Pro-tier Owen can't actually select Bedrock on the SaaS",
    "expected": "As a 60-eng Pro buyer with private repos, I want to route MY scans through Bedrock with a no-training guarantee — without standing up my own deployment.",
    "got": "LLM_PROVIDER is a single deployment-wide env flag (llm/index.ts:27-34,101); there is no per-org provider field. Bedrock's IAM/VPC/KMS/residency is per-deployment 'Phase 2' infra (docs say so plainly). On the hosted SaaS a Pro buyer is on the DEPLOYMENT's provider (Gemini/mock), not their own Bedrock — so the enterprise-privacy path is effectively gated behind Enterprise/self-managed, not reachable at Pro. The honesty is good; the reachability is the gap.",
    "evidence": ["src/lib/llm/index.ts:27-34", "src/lib/llm/index.ts:101", "docs/features/llm-providers.md:63-68"],
    "code_check": "unreachable",
    "verdict": "confirmed",
    "l2_priority": "Confirm there is no per-org/UI control to choose the inference provider; document that Bedrock requires an Enterprise/self-managed deployment so the privacy path's true tier-binding is explicit."
  },
  {
    "id": "owen-no-byo-selfhost-story",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "owen-healthtech-privacy",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "high" },
    "dimension": "missing",
    "title": "No BYO-model / self-host / on-prem inference story beyond Bedrock or mock — the most-sensitive repos have only the hollow floor",
    "expected": "For repos too sensitive even for a cloud BAA, I want a self-hosted/open-weight or air-gapped inference option (or at least an OpenAI-compatible endpoint I point at my own gateway) — so I get LLM nuance without code leaving my perimeter.",
    "got": "Providers are gemini/bedrock/openai/claude-cli/mock (llm/index.ts:29). 'openai' is an OpenAI-COMPATIBLE endpoint (could be a self-hosted gateway) but is undocumented as a privacy path and unmentioned in the disclosure's enterprise guidance, which points only to Bedrock. claude-cli keeps code local but runs under a PERSONAL subscription Owen can't BAA — not an enterprise answer. So for max-sensitivity repos the only no-leak option is mock = the deterministic floor (repeatable but no LLM nuance).",
    "evidence": ["src/lib/llm/index.ts:29-34", "src/components/connect/PrivacyNotice.tsx:46-53", "src/lib/llm/claude-cli.ts:1-11"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Verify the openai-compatible provider can be pointed at a self-hosted/VPC endpoint and whether the privacy notice should name it as a self-host path; otherwise document 'Bedrock or mock' as the only privacy-safe options.",
    "suggested_acceptance": "A documented self-host / OpenAI-compatible private-endpoint path (or explicit 'Bedrock-only' positioning) so a regulated buyer's most-sensitive repos get LLM nuance without code leaving their perimeter."
  },
  {
    "id": "owen-price-invisible-at-pro",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "owen-healthtech-privacy",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "Subscription $ is invisible for Pro/Team — Owen can count credits but can't see what the privacy-capable tier costs to decide",
    "expected": "To decide Pro vs Enterprise at 60 engineers, I need the actual subscription price next to the credit allotment and retention window.",
    "got": "/pricing renders only 'Prepaid — credits, 1 per private scan' for Pro/Team and 'Custom — contact us' for Enterprise; the real $ lives in Polar, not the app (plans.ts has no dollar fields by design). He CAN compute monthly burn (P private repos × 1 cycle = P credits/mo vs Pro 100 / Team 500) and read the 180/365-day retention, but the subscription price for the privacy-capable tier is a contact-wall — and Enterprise (where Bedrock actually lives) is 'contact us', so the whole privacy path is behind a quote.",
    "evidence": ["src/app/pricing/page.tsx", "src/lib/plans.ts:24-65"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Confirm /pricing shows no subscription $ for Pro/Team and that Enterprise (the Bedrock-bearing tier) is contact-only; weigh as a price-legibility blocker for a buyer who needs the enterprise privacy path."
  },
  {
    "id": "owen-mock-floor-repeatable-but-thin",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "owen-healthtech-privacy",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "senior-quality",
    "title": "If forced to mock, the recurring score is repeatable and labeled — but loses the LLM nuance/discrepancy-catch that makes it senior-grade",
    "expected": "If my only no-leak option is the deterministic floor, the recurring read must either be senior-grade or be honestly labeled so I don't pay for hollow nuance.",
    "got": "Mock derives dimensions straight from signalScores, memoized/deterministic, and the report is badged 'Demo · deterministic rubric' (honest). But the LLM auditor's discrepancy-catching, roadmap nuance, and per-dimension strengths/gaps are absent — the recurring read becomes 'the same signal numbers re-rendered each cycle,' which at low repo velocity flatlines into 'nothing new.' Repeatable, honestly labeled, but thin — and that thinness is exactly what he'd be paying a subscription for if Bedrock isn't reachable.",
    "evidence": ["src/lib/llm/mock.ts:27-39", "src/lib/scoring/engine.ts:135-146", "src/components/report/ReportHeader.tsx:40-45"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Re-scan an unchanged repo twice under mock — confirm the score is stable (no guardband wobble) and that the deterministic label is unmistakable, so a hollow-but-repeatable floor can't read as senior LLM analysis."
  }
]
```

## Character feedback (Owen, first person)

"First question, same as always: where does my code go during a scan? And — credit where due — this is the first scanner in a while that actually *answers it in the product*. The /connect notice tells me ≤32 files of my source get sent, names the provider, and keeps the inference hop separate from the 'we only store scores' line. Those are two different leaks and most vendors blur them on purpose. This one doesn't. Good.

The part I came to stress-test: does the value survive when I *can't* use cloud Claude? It does, structurally. The trajectory and the movers are computed off the stored score history and the deterministic blend — not off whichever model ran — so if I'm on Bedrock, or even forced to the mock floor, the recurring read still renders and is still guardbanded. And critically, the engine that produced each scan is recorded and shown — there's a 'Demo · deterministic rubric' badge for mock and a provider-mix in /usage — so a month that quietly degraded can't get laundered into my trend as if it were a real Bedrock read. That's the thing that would let me trust a mixed-engine fleet. And the docs say *HIPAA-eligible infrastructure, you still own IAM/KMS/VPC* — not 'HIPAA-compliant.' That honesty buys them a lot with me.

Where it stops short: Bedrock is real in the code but it's a *deployment-level, Phase-2* thing. There's no per-org switch — on the hosted SaaS at Pro, I'm on whatever provider the deployment runs, which is Gemini or mock, not my Bedrock. So the privacy-safe engine I actually need is effectively an Enterprise/self-managed conversation, and Enterprise pricing is 'contact us.' I also can't see the Pro subscription price at all — I can count credits (a few dozen private repos, once a month, sits well under Pro's 100), but 'what does it cost' is a contact-wall. And outside of Bedrock there's no self-host/BYO-model path: claude-cli runs locally but under a personal subscription I can't put under a BAA, and 'openai-compatible' isn't documented as a privacy option. So for my most sensitive repos my only no-leak choice is the deterministic floor — which is repeatable and honestly labeled, but it's the signal numbers re-rendered, not the senior LLM read I'd be paying for.

Is each cycle telling me something new? On Bedrock, yes. On mock at low velocity, not much — and that's the honest risk. Do I trust a move is real? Yes — guardband ±25, R²/flat-floor shown, engine recorded. Would I tell a regulated peer? I'd say: 'the privacy story is the most honest I've seen, the recurring value genuinely survives the engine swap — but you'll be on the Enterprise track to actually run Bedrock, and budget a 'contact us' call to learn the price.'

**Verdict: upgrade — but conditionally, and to Enterprise, not Pro.** Pro is where I'd start on cost, but Pro can't give me my Bedrock, so the privacy-safe recurring value I'm buying only exists on the Enterprise/self-managed track. I'm not churning — the machinery and the honesty are right — but I can't *renew at Pro* for a privacy path that isn't reachable there, and I can't decide on a price I can't see. Net: upgrade-intent gated on (1) a reachable Bedrock/self-host option at a tier I can price, and (2) a visible number."

## Grounding score · time-saved · verdict

- **Grounding score: 6 / 7** recurring-context + privacy sources reach the read. Present and surfaced: (1) inference-hop disclosure per engine, (2) per-scan engine provenance + provider-mix, (3) engine-agnostic trajectory needing repetition to exist, (4) guardbanded blend (move-is-real defense), (5) movers/period deltas vs previous scan, (6) honest mock labeling. **Missing for him: (7) a reachable privacy-safe engine at his tier** — Bedrock exists but is deployment/Phase-2-bound, and no self-host/BYO path. So the *machinery* grounding is excellent; the one source that doesn't reach a Pro-tier Owen is the privacy engine itself.
- **Per-cycle time-saved (number): ~16 hours per monthly cycle** — replaces a ~2–3-day by-hand AI-adoption security/architecture memo with a ~15–20-minute review of the org overview + engine chip, AND unlocks a *monthly* cadence the manual process can't sustain. **Conditional:** that 16h is real only if the read runs on a privacy-safe, senior-grade engine (Bedrock). If he's forced to the mock floor, the saving shrinks toward zero because he'd re-do the nuanced review by hand anyway.
- **Renew/downgrade/churn/upgrade: UPGRADE (to Enterprise/self-managed), conditionally.** One-line reason: the recurring value provably survives the engine swap and the privacy disclosure is honest, but the engine he's actually allowed to run (Bedrock) lives behind Enterprise/self-managed and an invisible price — so he upgrades past Pro to reach it, gated on a reachable Bedrock/self-host path and a visible number.

## l2_priority carry-forward (claude-cli engine)

1. **Engine-honesty across cycles:** with `claude-cli`, scan a fleet, force a mock fallback on one cycle, and confirm the `/usage` provider-mix + the per-report 'Demo · deterministic rubric' badge make the degraded cycle distinguishable in the trend (not laundered).
2. **Recurring value survives the swap:** run the same fleet under `bedrock` (or document the substitute) vs `mock`; confirm Trajectory/movers/trend render in both, and that the mock report is unmistakably labeled deterministic while still producing a guardbanded number.
3. **Mock floor stability:** re-scan an unchanged repo twice under mock — confirm the score is byte-stable (no guardband wobble), i.e. the repeatable floor is genuinely repeatable, so a hollow-but-stable score can't masquerade as senior LLM analysis.
4. **Privacy-engine reachability:** confirm there is no per-org/UI control to select the inference provider, and that the disclosure points only to Bedrock — pinning that the privacy-safe engine is an Enterprise/self-managed (not Pro) capability.
