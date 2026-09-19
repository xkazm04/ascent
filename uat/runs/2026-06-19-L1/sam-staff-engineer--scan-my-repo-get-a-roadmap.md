# L1 — Sam (Staff Engineer) × scan-my-repo-get-a-roadmap

**Verdict: L1-conditional** — the flow completes and the scoring machinery is genuinely substantive and auditable (real provenance track, glass-box waterfall, content-graded detectors, reconciling roll-ups). But two of Sam's hard acceptance criteria are *structurally* compromised on the journey's stated keyless start state: LLM-vs-detector discrepancies are always empty in mock mode, and the roadmap on the public path is catalog-templated (no repo-specific target) — exactly the "good machinery fed thin context" failure Sam hunts for. Both lift under the live `claude-cli` provider (env.md default), which makes them the headline L2 checks.

---

## Reachable surface set (anonymous, no auth, the seed's keyless/DB-off public scan)

Gating followed: `/api/scan/stream` requires no auth and no DB for a public (`orgSlug==="public"`, tokenless) scan — the login wall fires only for non-public orgs (`stream/route.ts:56`); persistence is best-effort (`if (isDbConfigured())`, `route.ts:180`). The expensive path is rate-limited + weekly-quota-metered (`route.ts:36`, `72-82`) but that doesn't gate completion. `LLM_PROVIDER=auto` with no key → MockProvider (`llm/index.ts:106-108`, `36-39`).

**Reachable (and useful) keyless:**
- `/` scan form → `/report?repo=` → `/report/[owner]/[repo]` (live SSE scan, full report renders). `ScanForm.tsx`, `ReportClient.tsx`, `ReportView.tsx`.
- Report content: ScoreRing/level, posture quadrant, dimension radar + per-dimension cards with **Evidence list + ProvenanceTrack** (`DimensionCard.tsx:75-103`), **ScoreWaterfall** glass-box (`ScoreWaterfall.tsx`), Roadmap tab (`RoadmapSteps` fallback), Sandbox what-if (`engine.ts:290`).
- `/badge/[owner]/[repo]` and the `?gate` badge — publicly reachable, no auth, token-less mock scan (`badge/route.ts:301`). Advisory (200 pass / 422 fail), not merge-blocking by itself.

**Reachable but DEGRADED-EMPTY keyless (DB off):**
- **Recommendation tracker** — DB-gated; `/api/recommendations` → 503 (`recommendations/route.ts:23`). Public report silently falls back to non-persisted `RoadmapSteps` (`ReportView.tsx:232-236`); no `+N pts / unlocks LX`.
- **Onboarding SKILL.md** (`/api/report/skill`) — DB-gated → **503 "Skill export requires a database"** (`skill/route.ts:27`), but the header link is rendered unconditionally (`ReportHeader.tsx:65-71`). Same for Export PDF.
- **/trends** → "Trends need a database" notice; `/api/history` → 503 (`trends/page.tsx:76`, `history/route.ts:68`).
- **/report/compare** → "Comparison needs a database" notice; needs ≥2 persisted scans (`compare/page.tsx:83`).

**Out of scope for this journey:** all `/org/*`, trends history, compare (their own journeys). Per the journey, Sam may *notice/judge* the offered SKILL.md as an artifact but not execute it.

**Live-default caveat (L2):** env.md pins `LLM_PROVIDER=claude-cli` for UAT runs, so the *actual* live run is NOT mock — discrepancies, LLM-written summaries, and a repo-specific roadmap WILL be produced. The findings below distinguish "keyless/mock designed behavior" (what the seed describes) from "live path."

---

## Surface model notes — the grounding audit (where Sam looks first)

**Ingestion — `src/lib/github/source.ts`.** ≤32 files (`MAX_FILES=32`, line 36), 14 KB/file, 180 KB total, 30 commits. `pickFilesToFetch` (line 520) is *signal-aware*, not random: agent-guidance files anywhere in the tree (line 528-537), exact high-signal manifests/configs (line 540-586), up to 3 CI workflows, ADRs/docs, **4 test files**, **6 source files** for texture. Coverage is scaled by fetch success rate (line 630-642) and surfaced as `confidence`. → Verdict: a real, defensible sample of the high-signal surface — not "does file X exist."

**Deterministic signals — `src/lib/analyze/index.ts`.** This is the part that wins Sam. It is emphatically NOT presence-counting:
- **D1** grades guidance *content* — build/test commands, architecture, "verify-after-change" discipline, explicit never/always constraints, advanced tooling (MCP/hooks/subagents), tool-permission policy, examples, @-file refs (`guidanceQuality`, line 97-120). A token stub scores low (line 100-101).
- **D2** computes **test-to-source ratio** (line 222-226), frameworks, e2e, coverage config, and advanced rigor (mutation/contract/perf/a11y/schema). Caps prevent a thin suite riding advanced flags to the top.
- **D9** explicitly distinguishes **present vs. CI-wired** (`.ai/doctor.mjs` "wired into CI/hook" = 8 pts vs "present (not yet wired)" = 2 pts, line 141-149); SAST/SCA/secret/SBOM/signing as code.
- The `.ai/` standard is scored *by evidence of use* — the Goodhart guard (line 122-153): an empty scaffold barely scores; memory must have ≥2 entries.
- Each detector is isolated; a thrown detector → `failed:true`, excluded from the mean (not scored 0), with a warning (`index.ts:632-659`, `engine.ts:88-93`).

**The blend — `engine.ts` + `model.ts`.** LLM guardbanded to ±25 of the signal (`engine.ts:99-101`, `LLM_GUARDBAND=25`), then blended `0.6·LLM + 0.4·signal` — and the LLM weight is **scaled by coverage** (`effectiveBlend = SCORE_BLEND·coverage`, line 71), so a half-seen repo leans on the coverage-robust detectors. Overall = renormalized archetype-weighted mean (`overallScoreFor`, `model.ts:227`); axes/posture from the same scores; weight-sets validated to sum to 1 at load (`model.ts:299`). → **Reconciliation holds at the math level**: dimensions → axes → overall → level → posture are one consistent roll-up, and `contributions()` (`engine.ts:396`) proves the headline is the literal sum of visible parts.

**What the LLM is told — `prompt.ts`.** System prompt: "never invent facts… calibrate to the deterministic signal scores," and *actively flag* detector misses in `discrepancies` (line 46). The user prompt hands the LLM the per-dimension `signalScore` + evidence labels, the PR/governance process block, commit sample, and sampled file excerpts (22 KB window). Roadmap is constrained to be invitational/exploratory. → The LLM is grounded in the same evidence Sam would re-trace; it cannot hallucinate an extreme (guardband) and is told to surface detector disagreement.

**Provenance UI — `DimensionCard.tsx:117-159`.** The `ProvenanceTrack` SVG draws the ±25 guardband zone, the signal tick, the LLM tick, and the blended marker on a 0..100 line, with `aria-label` "signal X, LLM Y, blended Z". This is exactly the signal→LLM→blended track Sam demands. Discrepancies render in the "Flagged for review" panel (`ReportView.tsx:245-261`) — *only when non-empty*.

**Roadmap — `recommendations.ts` (keyless) vs LLM (live).** Keyless fallback = `CATALOG` templates ranked by weighted upside (`buildFallbackRoadmap`, line 123); rationale interpolates the score ("D3 scored 28/100…") but the *title* is a generic gap statement ("Little gates what reaches main"), with no repo-specific target. The live LLM is instructed to ground each entry in the evidence (`prompt.ts:124-141`). The **onboarding SKILL.md** (`onboarding/skill.ts` + `tracks.ts`) IS repo-specific even keyless — language-aware coverage/CI deliverables (`tracks.ts:323-340`), real dimension gaps/scores baked in, "adapt don't paste / never fabricate" guardrails (`skill.ts:272-282`) — but it's DB-gated and unreachable on the public path.

---

## Findings

```json
[
  {
    "id": "L1-SAM-01",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "Keyless/mock path emits zero LLM-vs-detector discrepancies — the 'Flagged for review' panel never appears",
    "expected": "Sam can see where the model and the deterministic detector disagreed and why (his scored criterion #3).",
    "got": "MockProvider hard-sets discrepancies: [] (mock.ts:86); the panel only renders when discrepancies.length > 0 (ReportView.tsx:245). So on the seed's keyless start state the discrepancy surface is structurally absent — Sam sees no detector self-audit at all.",
    "evidence": ["src/lib/llm/mock.ts:86", "src/components/report/ReportView.tsx:245", "src/lib/scoring/engine.ts:192", "src/lib/scoring/prompt.ts:138-141"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Run a live claude-cli scan on a repo Sam knows (e.g. a repo with tests the detector under-counts) and confirm the LLM actually populates discrepancies with re-traceable, correct claims — not an empty array.",
    "suggested_acceptance": "On the live provider, ≥1 honest discrepancy surfaces on a repo where the detector demonstrably misses (e.g. tests in a non-standard dir); keyless mode should label that the discrepancy audit requires the LLM."
  },
  {
    "id": "L1-SAM-02",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "dimension": "senior-quality",
    "title": "Public roadmap is catalog-templated — names the gap, not a repo-specific highest-leverage move",
    "expected": "'pin the 3 unpinned GitHub Actions to SHAs; gate the advisory 70% coverage check in CI' — a specific, evidence-grounded next move (criterion #4).",
    "got": "Keyless roadmap is the static CATALOG ('Little gates what reaches main — trust rests on who reviewed'), ranked by weighted upside; rationale interpolates the score but carries no repo-specific target. The repo-specific artifact (onboarding SKILL.md, which DOES name real commands/files) is DB-gated and unreachable on the public path.",
    "evidence": ["src/lib/scoring/recommendations.ts:20-120", "src/lib/scoring/recommendations.ts:149-160", "src/lib/onboarding/tracks.ts:323-340", "src/app/api/report/skill/route.ts:27"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Live claude-cli: does the LLM roadmap (prompt.ts:124-141) actually produce a repo-specific, evidence-cited next move, or does it regress to 'improve documentation / add more tests'? This is the make-or-break senior-quality check.",
    "suggested_acceptance": "On a known repo the top roadmap item references a concrete file/config/count from that repo's evidence, not a generic dimension restatement."
  },
  {
    "id": "L1-SAM-03",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "major",
    "dimension": "completion",
    "title": "'Onboarding skill' and 'Export PDF' links render on every public report but 503 without a DB",
    "expected": "If an affordance is offered, it works on this Character's reachable surface — or it isn't shown.",
    "got": "ReportHeader renders both links unconditionally (ReportHeader.tsx:58-71). On the keyless/DB-off public path /api/report/skill returns 503 'Skill export requires a database' (skill/route.ts:27). Sam clicks the one artifact he'd actually judge for repo-specificity and gets an error — the worst possible moment to look unserious to a skeptic.",
    "evidence": ["src/components/report/ReportHeader.tsx:58-71", "src/app/api/report/skill/route.ts:27", "src/app/api/report/skill/route.ts:43-48"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "l2_priority": "Confirm whether the UAT env (PGlite DB on per env.md) makes these links work; if so this is keyless-only. Either way: gate the link on report persistence, or downgrade gracefully, rather than 503.",
    "suggested_acceptance": "The skill/PDF affordance is hidden (or shows an inline 'needs history' hint) when no persisted report exists, never a raw 503."
  },
  {
    "id": "L1-SAM-04",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "dimension": "trust",
    "title": "Anonymous public scan has NO PR/branch-protection evidence — D3/D6/D7/D8 are file/commit-only",
    "expected": "Sam's read includes 'is the flaky build gated?', 'are reviews required?', 'is AI in PRs governed?' — PR + branch-protection facts.",
    "got": "prStats/governance are token-gated (scan.ts:136-141, 156-158); a keyless public scan gets null for both, so the rigor-axis dimensions reflect only repo-tree + commit signals. The report DOES warn honestly ('Pull-request signals were skipped — they need a GitHub token', scan.ts:316-320 → ReportView.tsx:171). Honest, but it caps how far Sam's read can reconcile with the actual review/gate discipline he knows.",
    "evidence": ["src/lib/scan.ts:136-141", "src/lib/scan.ts:156-161", "src/lib/scan.ts:316-320", "src/components/report/ReportView.tsx:171-183", "src/lib/analyze/pulls.ts:161-226"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "With a GITHUB_TOKEN set (env.md notes it raises limits + unlocks PR/governance), confirm the D3/D6/D8 evidence lines actually populate (review coverage %, status-checks-required, AI-governed rate) and reconcile with the repo's real branch protection."
  },
  {
    "id": "L1-SAM-05",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "dimension": "trust",
    "title": "Engine guardband can cap an LLM that's correctly contradicting a wrong detector",
    "expected": "When the detector is demonstrably wrong, the truth should win — Sam's whole bar is the score matching the repo.",
    "got": "The LLM score is clamped to ±25 of the signal BEFORE the blend (engine.ts:99-102). If a detector badly under/over-scores a dimension (e.g. tests in a non-standard layout the regex misses), the guardband structurally prevents the LLM from fully correcting it — the discrepancy is surfaced (good) but the NUMBER stays anchored to the wrong signal. A defensible design choice (anti-hallucination), but a skeptic who knows the detector missed will see the score not move enough.",
    "evidence": ["src/lib/scoring/engine.ts:99-102", "src/lib/maturity/model.ts:23", "src/lib/analyze/index.ts:186-187"],
    "code_check": "by-design",
    "verdict": "uncertain",
    "l2_priority": "Pick a repo whose test/CI layout the detector mis-reads; confirm the discrepancy is flagged AND judge whether the ±25-anchored blended score still misleads. If it does, the discrepancy panel must be prominent enough that Sam trusts the caveat over the number."
  },
  {
    "id": "L1-SAM-S1",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "dimension": "trust",
    "title": "STRENGTH — the provenance track + score waterfall are exactly the attribution a skeptic needs",
    "expected": "Re-traceable signal→LLM→blended provenance per dimension; the headline as a visible sum of parts.",
    "got": "Every dimension card shows an Evidence list AND a ProvenanceTrack SVG (±25 band, signal tick, LLM tick, blended marker, aria-labelled) — DimensionCard.tsx:75-159. The ScoreWaterfall decomposes the headline into each dimension's weight×score with ▲/▼ lift, mathematically proven to sum to the overall (engine.ts:396-419). This is the single thing most likely to make Sam say 'okay, that's actually right.'",
    "evidence": ["src/components/report/DimensionCard.tsx:75-159", "src/components/report/ScoreWaterfall.tsx:18-94", "src/lib/scoring/engine.ts:396-419"],
    "code_check": "present-but-missed",
    "verdict": "confirmed"
  },
  {
    "id": "L1-SAM-S2",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "dimension": "senior-quality",
    "title": "STRENGTH — detectors grade substance, not file presence (the anti-'CONTRIBUTING.md +1' design)",
    "expected": "Not 'has AGENTS.md? +1' — judge whether it's real and followed.",
    "got": "D1 grades guidance CONTENT (commands, architecture, constraints, advanced tooling); D2 uses test-to-source RATIO and caps advanced flags; D9 distinguishes present vs. CI-wired; the .ai/ standard is scored by evidence-of-use (Goodhart guard). This directly answers Sam's burned-by-a-consultant's-checklist scar.",
    "evidence": ["src/lib/analyze/index.ts:97-120", "src/lib/analyze/index.ts:222-243", "src/lib/analyze/index.ts:135-153", "src/lib/analyze/index.ts:141-149"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed"
  },
  {
    "id": "L1-SAM-S3",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "dimension": "trust",
    "title": "STRENGTH — honest accounting: warnings on low coverage / mock degrade / partial LLM coverage, and mock is badged 'Demo · deterministic rubric'",
    "expected": "No latency theater, no success theater; tell me when the AI didn't really contribute.",
    "got": "Mock/degrade is badged in the header (ReportHeader.tsx:40-46) and warned ('not fully AI-validated', engine.ts:135-156); low coverage and truncation warn (scan.ts:326-334); SSE streams real per-stage progress (ReportClient.tsx:174-198). A degraded scan is not cached/persisted as canonical (scan/route.ts:211-224).",
    "evidence": ["src/components/report/ReportHeader.tsx:40-46", "src/lib/scoring/engine.ts:135-156", "src/lib/scan.ts:326-334", "src/components/report/ReportClient.tsx:174-198"],
    "code_check": "present-but-missed",
    "verdict": "confirmed"
  }
]
```

---

## Character feedback (first person, in Sam's voice)

Okay. Arms crossed, expecting to catch it out — and on the part that matters most, the machinery, it mostly holds up. I went looking for the evidence before I looked at the number, like always, and it was *there*: every dimension card has an evidence list and that little signal→LLM→blended track with the ±25 band drawn on it. That's the thing. That's what the trust-gap research keeps saying closes the gap — attribution built into the system — and someone actually built it instead of writing it in a deck. The waterfall proving the headline is the literal sum of weight×score is the other half; I can re-derive the overall by hand and it lands. Good. And the detectors aren't grading on whether a `CONTRIBUTING.md` exists — D1 reads whether CLAUDE.md documents real commands and constraints, D2 uses a test-to-source ratio, D9 actually distinguishes "doctor.mjs present" from "doctor.mjs wired into CI." That's the difference between this and the consultant dashboard that scored my flaky-1-in-5 build green. I'd quietly respect that.

But here's where I narrow my eyes. The journey I was handed is the *free keyless* scan — no key, no DB — and on that path the tool is running its deterministic mock. Which means: the discrepancy panel I most wanted, the "here's where the model thinks the detector is wrong" — it's hard-empty. `discrepancies: []`. The one feature that proves the tool is auditing *itself* doesn't show up on the path a first-time skeptic actually lands on. And the roadmap I get isn't "pin your 3 unpinned Actions to SHAs, gate that advisory coverage check" — it's a catalog line, "Little gates what reaches main," with my score interpolated into the rationale. That's better than "add more tests," but it is not the sharper-than-I'd-write-it plan I came for. I'd not put that in a sprint as-is.

The genuinely sharp artifact — the onboarding SKILL.md that bakes in my real language's coverage command and tells the agent to *adapt, never fabricate* — I went to click it and got a 503 because there's no database. You offered me the one thing I'd have judged you on and then couldn't hand it over. On a public report. To a skeptic. That's the unforced error.

So: would I adopt it? On paper, on the live `claude-cli` path the env notes pin — *probably yes*, and faster than my day-long manual audit, IF the live discrepancies are honest and the live roadmap is repo-specific. On the keyless path as the journey describes it — it's a credible *structural* read and a great evidence UI, but it's the demo, and it shows. Would I stake my name on the badge? Not until I've watched the live LLM produce a discrepancy on a repo I know it should, and a roadmap that names a file. That's the whole question, and it's an L2 question. Don't ask me to trust the number — you didn't, mostly, and that's why I'm still in the room.

---

## l2_priority (carry-forward — what L2 MUST verify live)

- **Live discrepancies are real and correct.** Run claude-cli on a repo whose test/CI layout the detector mis-reads; confirm ≥1 honest, re-traceable discrepancy surfaces in "Flagged for review" — not an empty array. (L1-SAM-01)
- **Live roadmap is repo-specific.** Confirm the top LLM roadmap item names a concrete file/config/count from the repo's evidence ("pin these 3 Actions", "gate the 70% coverage check"), not a dimension restatement. The senior-quality make-or-break. (L1-SAM-02)
- **Skill/PDF affordances work in the UAT env (PGlite on).** Confirm the header links resolve to a real, repo-specific SKILL.md rather than 503; judge the SKILL.md's actual repo-fidelity (real commands, real module map). (L1-SAM-03)
- **Tokened scan reconciles with branch protection.** With GITHUB_TOKEN set, confirm D3/D6/D8 evidence populates (review coverage %, status-checks-required, AI-governed rate) and matches the repo's real review/gate discipline. (L1-SAM-04)
- **Score reconciliation against a repo Sam knows cold.** The core test: does the overall + 9 dims + posture agree with a staff engineer's own read — and does the ±25 guardband ever leave a blended score misleading where the detector was wrong, even with the discrepancy flagged? (L1-SAM-05)
- **Time-to-verdict.** Confirm the live SSE scan reaches a defensible verdict in ~2–3 min (claude-cli can take tens of seconds to minutes per env.md) without the client 180s timeout firing.
