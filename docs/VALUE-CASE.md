# ascent — Value Case & Positioning Decisions

_Ship-loop Milestone 1 (strategy-first), 2026-07-05. Synthesizes the boot audit's value & market lens with direct code verification. Companion to `docs/REFERENCE-SCAN-AUDIT.md` (the 10-org live-scan audit)._

## The core tension

ascent does two things that pull in opposite directions:

- **A reproducible pass/fail gate** — `/api/gate/:repo` runs a **deterministic** scan by default and returns 200/422 for `curl --fail`. The code deliberately preserves this ("the deterministic-CI contract", `gate/route.ts:76-81`). This is a legitimate, PR-checkable artifact in the OpenSSF-Scorecard / quality-gate lineage.
- **An LLM-authored maturity *narrative*** — a guardbanded blend (`0.6·LLM + 0.4·signal`, LLM clamped to ±band of the deterministic signal, D9 fully deterministic; `engine.ts:114-120`) plus a self-audit `discrepancies[]` loop where the model flags its own detectors' false positives/negatives and the guardband widens in response (`engine.ts:61,114`). This narrative is unusually candid and evidence-grounded.

The **narrative engine is the rare, defensible moat** — no incumbent writes a self-critiquing qualitative assessment of *how a team works with AI*. The **score/number is the liability** — it isn't yet reproducible-by-default, carries a GitHub-native bias, and is sold to a buyer the product hasn't named.

## Competitor / substitute map

| Category | Players | They win on | ascent's angle |
|---|---|---|---|
| Delivery analytics | LinearB, Swarmia, DX, Jellyfish, Faros | DORA/flow metrics from process data — outcomes leaders are measured on | ascent scores *practices/AI-nativeness*, not delivery outcomes |
| Code health / quality gate | Sonar/SonarQube, Code Climate | Ground-truth static analysis; established CI gate | ascent's gate is opinionated-maturity, not defect-level |
| Native / free | GitHub Insights + Advanced Security, OpenSSF Scorecard | Free, in the tool of record | ascent must be clearly *more* than a rebranded Scorecard |
| Supply-chain / posture | Scorecard, Snyk | Deterministic, reproducible posture | overlaps ascent's D9 (which is already deterministic) |

**Vitamin vs painkiller:** as a *score*, ascent is a vitamin against all of the above. As an *AI-native readiness briefing a human reads and acts on*, it's differentiated — nobody else does it.

## Verified in code (this milestone)

- **Guardband real:** `engine.ts:115-117` clamps the LLM to ±band of the signal; it nuances, can't fabricate past evidence. D9 takes the signal verbatim (`:118`).
- **Reproducibility is cheap:** `gemini/openai/bedrock.ts` all use `temperature: envNumber("LLM_TEMPERATURE", 0.2)` → set `0` for near-determinism. Only `claude-cli.ts` has **no** temperature knob (the reference scan ran on claude-cli — hence the observed non-reproducibility). Pinning model + prompt version closes the rest.
- **Gate already deterministic by default:** `route.ts:38` (`mock` defaults on), reads/writes the mock cache key so a default CI gate can't return a stochastic LLM verdict.
- **The AI-usage headline was wrong in the field:** reference audit found `aiUsage.detected` counted bot commits (Renovate ≠ AI); the AI-delivery ROI panel currently shows **hash-simulated dollar spend** by default behind only a small "simulated" badge (`aiDeliveryModel.ts:88-223`). Derived numbers have shipped confidently wrong — a trust tax on the ones that are right.

## Decisions (drive at CP)

**D28 — Positioning.** Is the product a *score/gate* or an *AI-native readiness briefing*?
→ _Recommendation:_ **Two-tier** — free deterministic "AI-native Scorecard" gate (already built) as the wedge; paid "AI-native readiness **briefing**" (the narrative + self-audit engine) as the value. Lead marketing with the briefing; the number supports it, doesn't carry it.

**D29 — Score reproducibility.** Commit to a reproducible scored path?
→ _Recommendation:_ **Yes, and it's cheap** — default `LLM_TEMPERATURE=0`, pin model + prompt version, prefer an SDK provider (not claude-cli) for any number a customer anchors on. Market the number as reproducible only after this lands.

**D30 — GitHub-native bias.** The reference audit claims a P0 fix for the golang-floor (golang 20 vs golang/appengine 74, same org) but **no re-scan validates it**.
→ _Recommendation:_ **Validate now, broaden next** — re-scan the biased cohort to prove the floor is gone before any external claim; then reduce GitHub-native-centric signal weighting so off-GitHub-CI shops aren't penalized. Until then, scope external claims to GitHub-Actions-native teams.

**D31 — Buyer / JTBD & pricing.** Who is the one buyer, and does pricing match?
→ _Recommendation:_ the artifact is a leadership/exec-narrative object (platform-eng leader, or acquirer/CTO-advisor doing due diligence), not a $10 self-serve developer tool. Name the primary buyer and re-shape pricing/packaging to their budget + buying motion.

**D32 — QA bar for derived headline metrics** (`aiUsage.detected`, AI-ROI $). _Recommendation:_ no hash-synthesized or unvalidated number appears in a customer-facing headline without a real-data path + a visible fidelity marker.
