# Tiger L1 — Tomáš (Prospective Buyer) × scan-assess

**Verdict:** fix-first. The output reads as credible senior-grade work on a good day, the mock-floor degrade is *honestly labeled* (no success-theater badge to fear) — but the model setting Tomáš's one and only first impression is already the **cheap tier** (`gemini-3-flash-preview`), and that is exactly the model Lens-C predicts goes generic on the roadmap. The 30-second-skeptic risk is not a hidden floor; it's a real-but-cheap model writing the invitational roadmap.

## Angle & reachable output (tier-honest)

Tomáš is a Free / unauthenticated **public-scan** user: paste a repo, no login. What his eyes actually land on, in order:
- **The score + level** (guardbanded — see below; nearly model-insensitive).
- **The headline** sentence.
- **Dimension summaries / strengths / gaps.**
- **The invitational roadmap** (3–5 items) — the part he'd forward to leadership as proof the tool "gets it."
- **"Flagged for review" (discrepancies)** — the auditor pass, rendered at `ReportView.tsx:245-256`.

Two facts decide his verdict, and I confirmed both in code:

1. **Which model writes his first impression?** The public/MVP default is **`gemini-3-flash-preview`** (`src/lib/llm/gemini.ts:15`, selected via `geminiOrMock()` at `index.ts:138-142`) — a *cheap-tier* model ($0.5/$3 per MTok, `config.ts:41`). So the buyer's proving-ground scan is **not** run on the sonnet default the engine note assumes; it's run on the model Lens-C flags as the one that drifts generic on roadmaps. This is the single most important fact for my angle.

2. **Would the worst case (silent mock floor) sell him a fake "scored by AI" badge?** **No — refuted.** The degrade is surfaced three ways: a yellow "Heads up" banner with *"AI analysis was unavailable, so scores reflect detected signals only"* (`scan.ts:322-326` → `ReportView.tsx:171-183`); a header chip that flips to **"Demo · deterministic rubric"** (`ReportHeader.tsx:40-46`); and the embeddable **badge gets a "· demo" suffix** (`badge/[owner]/[repo]/route.ts:324-325`). A skeptic *would* see it. The honest-billing path (failed-attempt tokens dropped, `scan.ts:206-219`) and the anti-success-theater work (`index.ts:128-137`) are real strengths to protect.

## Surface-model notes (fresh file:line for my angle)

- **Guardband caps the score's value-add.** LLM clamped ±25 around the deterministic signal, then blended `effectiveBlend·guarded + (1−blend)·signal` (`engine.ts:96-102`; `LLM_GUARDBAND`/`SCORE_BLEND` from `maturity/model`). So *"measured how?"* answers honestly as "deterministic detectors, AI nuances within a band" — good for Tomáš's trust, but it also means **the number is not where the model earns its money.** The roadmap and the discrepancy audit are.
- **Roadmap tone is invitational by construction** (`prompt.ts:129-136`): titles are observations ("Agent guidance is thin"), `explore` is open questions, "never as orders." For Tomáš this cuts **both ways** (finding T-VAL1).
- **Mock-degrade roadmap is a static catalog** (`recommendations.ts:20-120`, used by both mock and empty-LLM-roadmap fallback at `engine.ts:171-173`). It's genuinely well-written and archetype-ranked — but it's the *same 9 paragraphs* for every repo at that dimension. If Tomáš's scan degrades, the "AI roadmap" he forwards is a lookup table. The "· demo" label is his only tell.
- **Discrepancy audit is the one real reasoning task** (`prompt.ts:138-141`) and it renders prominently as "Flagged for review" — for a skeptic, a *specific* caught detector-miss ("tests clearly present, D2 reported 0") is the single most credible thing on the page. An empty array (cheap model finds nothing) makes the section vanish — silent, not wrong, but it removes his best proof.

## Findings

```json
[
  {
    "id": "T-VAL1",
    "lens": "business-value",
    "call_site": "scan-assess",
    "character": "tomas-prospective-buyer",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "senior-quality",
    "title": "Public first-impression scan runs on the CHEAP tier (gemini-3-flash) — the exact model Lens-C predicts drifts generic on the roadmap",
    "expected": "The one self-serve scan a buyer judges the whole product on should run on at least the mid-tier (sonnet) default the engine is designed around, so the roadmap reads as a staff-engineer's specific read, not catalog filler.",
    "got": "The public/MVP default provider is gemini-3-flash-preview (cheap tier, $0.5/$3). The buyer's proving-ground scan is run on the model most likely to produce a generic, repo-agnostic roadmap and to under-catch discrepancies — the two things that distinguish senior-grade output from AI filler.",
    "evidence": ["src/lib/llm/gemini.ts:15", "src/lib/llm/index.ts:138-142", "src/lib/llm/config.ts:41", "src/lib/scoring/prompt.ts:129-141"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Run a real public scan with the default gemini-3-flash on a repo I know vs sonnet — does the roadmap cite repo-specific evidence or fall back to generic 'agent guidance is thin' phrasing, and does the discrepancy array stay non-empty?"
  },
  {
    "id": "T-VAL2",
    "lens": "business-value",
    "call_site": "scan-assess",
    "character": "tomas-prospective-buyer",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "Invitational roadmap tone risks reading as wishy-washy to a decide-now buyer",
    "expected": "A roadmap that names a specific, defensible next move I can take to leadership ('close D3 — no CI gate, here's the +N pts it unlocks').",
    "got": "Tone is invitational by mandate — titles are observations, 'explore' is open questions, 'never as orders' (prompt.ts:129-136). Thoughtful for an internal coaching tool; for a buyer in evaluation mode it can read as a tool that won't commit to a recommendation. The deterministic '+N pts · unlocks LX' projection (engine.ts:261-276) is the antidote but is engine-side, not in the LLM roadmap text the model controls.",
    "evidence": ["src/lib/scoring/prompt.ts:129-136", "src/lib/scoring/engine.ts:261-276", "src/lib/scoring/recommendations.ts:122-161"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Show a real roadmap to a buyer persona — does 'explore these questions' land as thoughtful or as 'it won't tell me what to do'? Does the +N pts projection rescue the specificity?"
  },
  {
    "id": "T-STR1",
    "lens": "business-value",
    "call_site": "scan-assess",
    "character": "tomas-prospective-buyer",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH — mock-floor degrade is honestly labeled; no fake 'scored by AI' badge to see through",
    "expected": "My worst fear: the model fails, the app silently serves the deterministic floor under an AI banner, and I'm sold a toy as a product.",
    "got": "The degrade is surfaced everywhere a skeptic looks: warnings banner ('AI analysis was unavailable…'), header chip flips to 'Demo · deterministic rubric', and the embeddable badge gains a '· demo' suffix. Failed-attempt tokens are dropped from billing. This is the opposite of success theater.",
    "evidence": ["src/lib/scan.ts:322-326", "src/components/report/ReportHeader.tsx:40-46", "src/app/api/badge/[owner]/[repo]/route.ts:324-325", "src/lib/scan.ts:206-219", "src/lib/llm/index.ts:128-137"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Force a provider failure on a live scan — confirm the demo label and warning actually render to an anonymous user, not just in unit tests."
  },
  {
    "id": "T-STR2",
    "lens": "business-value",
    "call_site": "scan-assess",
    "character": "tomas-prospective-buyer",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH — discrepancy audit ('Flagged for review') is the most credible thing on the page for a skeptic",
    "expected": "Proof the output isn't just confident filler — that the model actually read the repo and can disagree with its own detectors.",
    "got": "The auditor pass (prompt.ts:138-141) renders prominently and frames detector-misses as 'where the AI read the repo more closely' (ReportView.tsx:245-256). A specific caught miss is exactly the 'huh — that's actually not wrong' moment. BUT it's the part most degraded by a cheap model: an empty array silently hides the section, removing my best proof.",
    "evidence": ["src/lib/scoring/prompt.ts:138-141", "src/components/report/ReportView.tsx:245-256"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "On gemini-3-flash vs sonnet over a repo with a known detector blind spot — does the cheap model catch the discrepancy, or does the section go empty?"
  },
  {
    "id": "T-C1",
    "lens": "model-optimization",
    "call_site": "scan-assess",
    "character": "tomas-prospective-buyer",
    "cert_level": "L1",
    "type": "cost",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "cost",
    "title": "First-impression credibility is model-bound to roadmap+discrepancy quality, not score — and the public default is already cheap-tier",
    "expected": "The part of the output a buyer judges (roadmap specificity + a caught discrepancy) should be run on a model that reliably produces it.",
    "got": "Score is guardbanded (engine.ts:96-102) so it's cheap-model-safe. Roadmap and discrepancies are NOT guardbanded and are precisely what a cheap model degrades. The public default IS the cheap model. So the buyer's verdict rides on the weakest-by-cheapness part of the output.",
    "evidence": ["src/lib/scoring/engine.ts:96-102", "src/lib/llm/gemini.ts:15", "src/lib/scoring/prompt.ts:124-141"],
    "code_check": "present-but-missed",
    "verdict": "uncertain",
    "model_variant": "gemini-3-flash-preview (current public default) vs sonnet-4 vs gpt-4o-mini",
    "quality_delta": "vs sonnet: predicted roadmap-specificity DOWN and discrepancy-recall DOWN at flash; score ~unchanged (guardbanded). vs gpt-4o-mini ($0.15/$0.6): likely worse still on roadmap.",
    "cost_delta": "flash→sonnet ≈ +6x input / +5x output per scan; on a ~15K-in/2K-out assessment that's roughly +$0.03/scan — trivial against a six-figure contract decision.",
    "l2_priority": "Benchmark gemini-3-flash vs sonnet on 3 repos a buyer knows: does the cheap model's roadmap cite file-level specifics, and is the score within the guardband either way (confirming only roadmap/discrepancies move)?"
  }
]
```

## Lens-C answer

**premium-helps — but narrowly, and the lever is the public default, not 'go premium'.**

- **Score:** cheaper-holds. Guardbanded ±25 and blended 60/40 (`engine.ts:96-102`) — gemini-flash, haiku, even gpt-4o-mini all land the number in the same band. Tomáš's *number* is model-insensitive by design. No upgrade buys credibility here.
- **Roadmap:** this is where it breaks. The invitational roadmap (`prompt.ts:124-141`) is the artifact Tomáš forwards to leadership, and it's the classic "cheap model writes plausible generic prose" failure. On `gemini-3-flash-preview` (the live public default) I'd bet against repo-specific specificity. **mid-floor (sonnet) is the right call for the public scan specifically** — the per-scan cost delta is ~$0.03, noise against the decision it influences.
- **Discrepancies:** premium-helps. The one genuine reasoning sub-task; sonnet/opus/thinking catch detector-misses a flash model misses, and an empty "Flagged for review" section costs Tomáš his single strongest proof point.

Net: the cheapest impactful change is **not** to buy opus — it's to stop running the *buyer's proving-ground scan* on the cheapest model. Run the public first-impression scan on sonnet; keep flash for at-scale internal re-scans where the score (guardbanded) is what matters.

## Character feedback (Tomáš, first person)

> Would I trust the number? Yeah, grudgingly — they told me how it's measured (deterministic detectors, AI nuances within a band, blended), and the score moving only ±25 means they're not letting a chatbot invent a grade. That's more honest than most "AI maturity" pitches. Good.
>
> Would I paste the badge? Only if it doesn't say "· demo." And credit where due — it *does* say "demo" when the model fell over, which means they're not trying to sell me the floor as AI. That single label is why I didn't close the tab. If it had quietly shown me a deterministic lookup table under a "scored by AI" banner, I'm gone and I'm telling people.
>
> Is the roadmap one I'd run? This is where I get nervous. "Agent guidance is thin — here are three questions to explore"… on a good model that's a thoughtful staff-engineer read. But I'm running this on their cheap default, and cheap models write exactly this kind of agreeable, could-be-any-repo prose. If it doesn't name *my* files, *my* missing CI gate, I read it as filler and I'm out. And the "we won't tell you what to do, we'll invite you to explore" tone — for a coaching tool, fine; for me deciding whether to spend, I need it to commit to a recommendation. The "+N points, unlocks L3" projection is the thing that saves it — that's a number I can take upstairs.
>
> Worth the wait/cost? The scan's cheap and fast, that's not my problem. My problem is they spent the *least* on the one scan I judge them by.
>
> The ONE engine change I want: **run the public first-impression scan on sonnet, not gemini-flash.** Three cents a scan to make the artifact I forward to leadership read like a senior wrote it instead of a lookup table. Everything else is right — the honesty, the guardband, the discrepancy audit. Don't undercut all of it to save three cents on the demo.
>
> Would I tell a peer? "Their scan is more honest than most — it admits when the AI didn't run, and the score isn't a hallucinated grade. But run it and read the roadmap closely; on their free tier it can read generic. If it names your actual repo, this is real."

## Scores

- **Grounding score: 4/5.** For Tomáš's needs the prompt cites what matters — real deterministic signals + evidence, commit sample, process/PR signals, file excerpts, archetype (`prompt.ts:103-141`). The −1: the **22KB excerpt window** means a monorepo he knows is judged on ~10 files, and there's **no memory** of his org's stated goals or prior scans — a buyer pointing it at his own large codebase will notice the breadth gap (the thing that flips a skeptic from "huh, not wrong" to "it didn't actually read my repo").
- **Per-use time-saved (his level): ≈ 30–60 minutes of evaluation, decided in <3 min.** His "time-saved" is the cheapness of the *buy/no-buy decision itself* — one self-serve scan replaces a discovery call + demo-request cycle. The honest degrade label and the glass-box score let him reach a verdict fast; the cheap-model roadmap is the one thing that could send him away wrongly.
- **Engine verdict: fix-then-ship.** The wrapping, honesty, and guardband are ship-grade. The one fix that changes Tomáš's verdict is routing the *public* scan to a mid-tier model so the roadmap and discrepancy audit — the parts he actually judges — clear the senior-grade bar on the first impression.
