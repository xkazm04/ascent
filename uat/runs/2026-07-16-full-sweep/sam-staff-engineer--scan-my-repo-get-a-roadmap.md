# L1 (theoretical) — Sam (Staff Engineer) × "Scan my repo, get a roadmap"

cert_level: L1 · date: 2026-07-16 · method: static/code-grounded surface model + cognitive walkthrough (no browser)

---

## 1. Surface model (import-chain traced, file:line cited)

### Entry: landing → scan form
- `/` renders `IndexLanding` which mounts `ScanForm` (`src/app/page.tsx:69-77`).
- `ScanForm` (`src/components/ScanForm.tsx:47-288`) — a single `owner/repo` text input (`:167-191`), forgiving paste-normalization for a full GitHub URL/SSH ref (`stripRepoRef`/`normalizeRepo`, `:17-45`), client validation with an `aria-live` error (`:119-127`, `:230-234`), a submit button with spinner state (`:192-218`), and "Try:" example chips that also submit (`:255-283`).
- Submit navigates client-side to `/report?repo=<owner/repo>` (`:148`, `:267`) — no sign-in gate touched at this step.

### Scan execution → progress
- `/report` route (`src/app/report/page.tsx:13-24`) mounts `ReportClient` (`src/components/report/ReportClient.tsx:12-78`), which reads `?repo=` (`:14`) and drives `useReportScan` (`src/components/report/useReportScan.ts:46-317`).
- `useReportScan` first does a cheap cache **peek** (`GET /api/scan?peek=1&recent=1`, `:120-139`) so an already-scanned repo returns instantly; on a miss it opens `POST /api/scan/stream` (`:147-159`), an SSE stream (`src/app/api/scan/stream/route.ts`).
- The stream emits `progress` frames with `stage/message/pct/provider` (`useReportScan.ts:232-243`) consumed by `Loading`'s progress UI (`src/components/report/ReportClientStatus.tsx`, referenced `ReportClient.tsx:35`) — **this is real streamed progress, not a dead spinner** (per Sam's pet-peeve #7 / "latency theater").
- Auth: `authGateEnabled()` gates the stream only when Supabase is configured **and** the bypass is off (`route.ts:79-82`; `src/lib/access.ts:71`); under the UAT env (`ASCENT_AUTH_BYPASS=1` / no Supabase) the public single-repo scan is reachable with zero sign-in, matching the journey seed's claim. **Reachability: full — Sam never has to authenticate for this journey.**
- Weekly free-quota gate exists (`consumeScanQuota`, `route.ts:96-97`) but only throttles repeated scans; a `QuotaBanner`/`QuotaBlocked` surfaces it (`ReportClient.tsx:39-42,71-73`) with a stale-report salvage path (`useReportScan.ts:175-197`) rather than a dead end.

### Scan pipeline → grounding (AI surface)
- Orchestrator: `src/lib/scan.ts` — ingest (GitHub API, no clone) → deterministic `analyzeSignals` (`src/lib/analyze/index.ts`) → PR/branch-governance (`src/lib/analyze/pulls.ts`) → security check battery (`src/lib/security/checks.ts`, `src/lib/github/security-posture.ts`) → tech-stack extraction (`src/lib/analyze/tech-extract.ts`) → LLM `assess()` → `assembleReport` (`src/lib/scoring/engine.ts`).
- Prompt builder: `src/lib/scoring/prompt.ts:buildAssessmentPrompt` (`:150-214`). **Grounding audit** — real context sources that reach the prompt:
  1. Deterministic per-dimension signals (`signalBlock`, `:154-159`) — the file/config/PR-pattern evidence `analyze/index.ts` extracted.
  2. PR + branch-governance behavioral evidence (`processBlock`, `:19-38`) — merge rate, review rate, velocity, AI-involvement, branch protection.
  3. Deterministic security check battery for D9 (`securityBlock`, `:41-55`) — explicitly told to the model as **fixed, narrate-only**.
  4. Detected tech stack + stack-fit caveat (`:196`) — prevents penalizing a repo for conventions its stack doesn't use.
  5. Standing org decisions (`decisionsBlock`, `:79-93`) — prior human triage, framed as calibration not score inflation (n/a for Sam's anonymous public scan — no org, so this source is empty for this journey specifically).
  6. Recent commit message sample (`commitBlock`, `:186-187`).
  7. Sampled file excerpts, capped 2200 chars/file up to a 22 000-char window (`:167-179`).
  → **Grounding score: 6/7 real sources reach the prompt for Sam's anonymous single-repo scan** (decisions is the one source that's structurally empty here, by design — no org to have decided anything). This is unusually rich grounding for an AI-product audit surface.
- The system prompt explicitly instructs the model to flag **detector-vs-LLM discrepancies** (`prompt.ts:107-109` TASK block) and to calibrate scores to the deterministic signal within a guardband, never contradict D9 (`:55`).

### Reconciliation mechanics (Sam's #1 fear: fake-green scores)
- `src/lib/scoring/engine.ts:106-116` — the LLM score is **guardbanded**: clamped to ±`LLM_GUARDBAND` of the deterministic signal score, and the band **doubles** only when the LLM itself flags that dimension as a discrepancy (`:112-115`). The model cannot silently overrule a low deterministic signal with a flattering LLM score — this is the mechanism that should prevent Sam's "coverage score that contradicts the flaky build" failure mode.
- `assembleReport` blends signal+LLM per dimension and rolls up the overall level + posture quadrant from the same clamped per-dimension scores (`:326-344`) — one source of truth, not independently-computed numbers that can drift apart.

### Report surface — score, evidence, provenance, discrepancies, roadmap
- `/report/[owner]/[repo]/page.tsx` → `ReportView` (`src/components/report/ReportView.tsx:22-…`), tabs: Scoring / Dimensions / Roadmap / Sandbox (+ Contributors) (`:134,152`).
- Provenance track: `DimensionDetail.tsx:86-126` and `DimensionCard.tsx:120-160` — an inline SVG showing **signal tick, LLM tick, guardband zone, and blended marker** with hover `<title>` tooltips (`:97-123`), i.e. exactly the "signal→LLM→blended provenance track" Sam's criteria names.
- Per-dimension evidence list: `DimensionDetail.tsx:44-56`, sourced from `Signal.label`/`.detail` (`src/lib/types.ts:264-275`) rendered via `formatSignal`.
- **Evidence-format gap (see Findings §3 F1):** tracing every producer of `Signal` in `src/lib/analyze/index.ts` and `pulls.ts` (`grep "label:"` across both files), evidence strings are file/config-**presence** and count-based (e.g. `"Found .ai/manifest.yaml (agent-facing contract)"` `index.ts:152`, `"Detailed agent guidance (4k+ chars)"` `:116`, PR stats like `"${pr.merged} merged · ${pr.smallPrRate}% small…"` `pulls.ts:200`) — **none carry a line number**. No `label`/`detail` construction anywhere in `src/lib/analyze/*.ts` interpolates a line offset. This is short of the literal "file:line" Sam's acceptance criteria names twice, though every string still names a concrete, independently-checkable file or metric (not hand-wavy).
- Discrepancies: `ReportDiscrepancies` (`src/components/report/ReportNotices.tsx:20-38`) renders the LLM's `discrepancies[]` (dimension + claim) under a "Flagged for review" panel, wired from `ReportView.tsx` (`grep discrepanc` hit). **LLM-vs-detector disagreement is surfaced, not hidden** — matches Sam's criterion directly.
- Roadmap: `RecommendationTracker.tsx` (`:30-`) renders `PersistedRecommendation[]` with dimension/impact/effort/`levelUnlock` fields (schema per `prompt.ts:135-137`) and a status tracker (done/dismissed) that degrades gracefully to a read-only fallback when persistence is unavailable (`ReportView.tsx:101` comment) — matches "roadmap tracker" in Sam's `maps_to:`.
- Badge: standalone `/badge` (`src/app/badge/page.tsx`) → `BadgeGenerator` (`src/components/badge/BadgeGenerator.tsx:35-53`) generates Markdown/HTML/AsciiDoc snippets from `/api/badge/[owner]/[repo]`. **Gap (F2):** `BadgeGenerator` has no `useSearchParams`/prefill logic (confirmed by grep — zero hits) and nothing in `ReportView`/`ScoringTab` links to `/badge?repo=...` — only a `LevelBadge` *display* chip exists inline (`ScoringTab.tsx:6,48`), not a "get this badge" CTA. Sam must navigate to `/badge` cold and retype `owner/repo`.

---

## 2. In-character walkthrough (Sam, thought experiment over the model above)

I paste `owner/repo` — I'd use a repo I maintain, but for this dry run let's say `vercel/next.js`, something I know cold. The form is exactly what I expect: `github.com/` prefix, monospace, one field, one button. No "sign up to continue" wall, which already beats half the tools that get pitched to me. I hit Scan.

**Step 1 — do I know what's happening?** Yes. The button says "Scanning" with a spinner, and the SSE progress frames carry a stage/message/provider — assuming that's actually rendered live (not just piped and dropped), I'd see something like "reading files… → running detectors… → asking the model…" instead of a dead spinner. That's the single biggest thing that would have made me bail on a lesser tool. Code-level this is real (`useReportScan.ts:232-243`), so on paper this clears my "latency theater" pet peeve.

**Step 2 — does the score reconcile?** This is where I actually lean in. The guardband mechanism (`engine.ts:106-116`) is the right shape: the LLM can't just decide D2 is a 90 when the deterministic detector found `expect(true).toBe(true)`-tier tests — it's clamped to ±N of the signal, and the band only widens when the model itself calls out the detector as wrong. That's a real answer to my exact horror story (the fake 80% coverage number). I'd want to verify live that the detector for "real assertions vs. theater tests" is actually smart enough to catch my specific flavor of fake coverage — that's an L2 question, not something I can settle from the code alone — but the *mechanism* that would prevent the tool from just trusting the LLM's optimism is there and it's not decorative.

**Step 3 — can I re-trace every score?** Partially, and this is where I'd get pickier than the code fully earns. The provenance track (signal tick / LLM tick / guardband / blended dot) is exactly the visualization I'd want — it's the first thing I'd hover over. But when I go to the evidence list under a dimension, what I get is strings like "Documents build/test/run commands" or "Detailed agent guidance (4k+ chars)" — these tell me *what pattern matched*, and I can go verify it myself by opening the file, but it's not `file:line`. For a CLAUDE.md heuristic that's fine — there's one file, I'll find it in five seconds. For something like "AI-involved rate 41%, of those governed rate 60%" from PR stats, there's no file at all to point to — it's a computed metric, and that's legitimate, not a gap, because it's not evidence *from* a file. So: the traceability is real (I can independently verify every claim), but it stops one level short of literal line numbers, which is what my own criteria word it as. I'd note this, not walk away over it.

**Step 4 — are discrepancies surfaced?** Yes, structurally — the prompt explicitly tells the model to audit the detectors and flag disagreements, and there's a dedicated "Flagged for review" panel for exactly that. This is the part that would earn a quiet "okay, that's actually right" from me — most tools don't admit their own detector might be wrong.

**Step 5 — is the roadmap something I'd sprint it?** The schema forces `dimension`, `impact`, `effort`, `levelUnlock`, and an explicit instruction against "add more tests"-style genericism, framed as "explore, don't order." I like the framing — I don't want a tool bossing me, I want it pointing at evidence. Whether the *actual generated text* clears my bar ("pin 3 unpinned Actions to SHAs" vs. "improve documentation") is something only a live run settles — the prompt engineering is aimed at the right target, but prompt intent and model compliance are two different things, and that's squarely an L2 question.

**Step 6 — badge.** I finish reading the report, I'm reasonably convinced, and now I want the badge for my README. There's no button on the report for that — I have to know `/badge` exists, navigate there, and retype `owner/repo` I just scanned thirty seconds ago. Minor, but it's exactly the kind of "why do I have to do this twice" friction that makes a tool feel unfinished, and it directly touches my JTBD #3 ("hand me a badge... I'd stake my name on").

**Time-saved, on paper:** if the SSE progress holds and the scan completes in the few-minutes range the env doc describes, and the score genuinely reconciles, I go from "the better part of a day" to a coffee-break — that's the promise, and the design supports it structurally. I can't confirm the number without watching a real scan run.

**Senior-quality bar, on paper:** the grounding is the best part of this design — 6-7 real context sources reaching one prompt, a guardband that prevents LLM optimism from overriding hard signals, and an explicit self-audit instruction is more rigor than most of these tools bother with. If the live output matches the design's intent, this clears my bar. The one place I'd dock it even on paper is the evidence granularity — "file, not file:line" — because that's a real word-for-word gap against what I said I need.

---

## 3. Findings (L1)

### F1 — Evidence cites files/metrics, not literal file:line
- `id`: L1-SAM-ROADMAP-01
- `journey`: scan-my-repo-get-a-roadmap · `character`: Sam (Staff Engineer)
- `cert_level`: L1
- `type`: quality-gap
- `dimension`: trust
- `severity`: minor *(derived from impact below — every dimension detail Sam opens shows this, but it doesn't block re-tracing, only slows it)*
- `impact`: `{ frequency: high (every dimension card, every scan), reachability: high (default report view), trust_erosion: low-med (Sam can still independently verify; just not one click away) }`
- `title`: Dimension evidence strings are presence/pattern/count-based labels, never `file:line` citations
- `expected`: Per Sam's acceptance criteria ("every dimension score cites concrete, re-traceable evidence (file:line / PR / commit / governance fact)"), a claim like "agent guidance present" would point at `CLAUDE.md:1` or similar.
- `got`: `Signal { label, detail }` (`src/lib/types.ts:264-269`) is populated everywhere in `src/lib/analyze/index.ts` (e.g. `:116,152,167`) and `pulls.ts` (`:200,215,229,253,257,275`) with human-readable pattern/count descriptions and zero line-number interpolation anywhere in either file.
- `evidence`: `src/lib/types.ts:264-275`; `src/lib/analyze/index.ts:113-168`; `src/lib/analyze/pulls.ts:200-275`; rendered at `src/components/report/DimensionDetail.tsx:44-56`.
- `code_check`: confirmed-absent (no line-number field exists in the `Signal` type or any producer)
- `verdict`: confirmed
- `l2_priority`: Watch a real dimension's evidence list live and see whether Sam (as the L2 driver) can re-trace a claim to a specific file in under ~15 seconds — if file-name-only evidence is fast enough to verify in practice, this downgrades further toward polish; if a claim like a PR/governance metric has no traceable source at all in the live UI, that's a harder finding.

### F2 — No path from a finished report to a prefilled badge
- `id`: L1-SAM-ROADMAP-02
- `journey`: scan-my-repo-get-a-roadmap · `character`: Sam (Staff Engineer)
- `cert_level`: L1
- `type`: confusion *(present-but-undiscoverable would apply if a CTA existed and was hidden; here nothing links there, so this is closer to missing-feature at the connective-tissue level)*
- `dimension`: effort
- `severity`: minor
- `impact`: `{ frequency: high (every Sam who likes the score will want the badge), reachability: high (repo re-typing is trivial, just annoying), trust_erosion: low }`
- `title`: `/report/[owner]/[repo]` never links to `/badge`, and `/badge` doesn't accept a `?repo=` prefill
- `expected`: A "Get badge" affordance on the finished report that lands on `/badge` with the just-scanned repo already filled in.
- `got`: `ScoringTab.tsx:6,48` renders a `LevelBadge` **display** chip only (not a link to the generator); `BadgeGenerator.tsx` has no `useSearchParams` (grep for `searchParams` across `src/app/badge/page.tsx` + `BadgeGenerator.tsx` returns no hits) and its own `parseRepo` (`:14-22`) only reads the live text input.
- `evidence`: `src/components/report/ScoringTab.tsx:6,48`; `src/components/badge/BadgeGenerator.tsx:14-53`; `src/app/badge/page.tsx` (no searchParams read).
- `code_check`: confirmed-absent
- `verdict`: confirmed
- `l2_priority`: Confirm in the live report whether any other tab (Sandbox, Roadmap, header CTA) links out to `/badge` that a static read of `ScoringTab`/`ReportView` alone might have missed, and time how long the retype actually takes in practice.

### F3 (strength, not a defect) — Guardband reconciliation mechanism
- `id`: L1-SAM-ROADMAP-STRENGTH-01
- `type`: n/a (strength) · `dimension`: trust
- `title`: LLM score is structurally guardbanded to the deterministic signal, with the band widening only on a self-flagged discrepancy
- `evidence`: `src/lib/scoring/engine.ts:106-116`
- Why it matters: this is the exact mechanism that answers Sam's "coverage number that was a lie" trauma — worth protecting, don't refactor away without an equivalent safeguard. `l2_priority`: confirm on a live scan that a dimension with obviously-weak deterministic signal (e.g. a repo with theater tests) doesn't get pulled up by the LLM beyond the guardband.

### F4 (strength) — Rich, multi-source grounding
- `id`: L1-SAM-ROADMAP-STRENGTH-02
- `type`: n/a (strength) · `dimension`: senior-quality / trust
- `title`: 6 of 7 identifiable real context sources reach the assessment prompt for an anonymous public scan
- `evidence`: `src/lib/scoring/prompt.ts:150-213` (signals, PR/governance, security battery, tech stack, commits, file excerpts all present; standing-decisions block structurally empty only because there's no org for an anonymous scan).
- `l2_priority`: n/a — this is a design-level strength, confirmed by the prompt builder alone.

---

## Grounding score
**6/7** real, distinct context sources reach the assessment prompt for Sam's journey (deterministic signals, PR/governance behavior, security check battery, detected tech stack + stack-fit caveat, recent commits, sampled file excerpts). The 7th (standing org decisions) is structurally n/a for an anonymous public single-repo scan — not a gap, a scope boundary.

## Verdict
**L1-conditional** — the journey is structurally sound and completable (streamed progress, no auth wall, a genuine guardband/reconciliation mechanism, discrepancy surfacing, a real roadmap schema), but it carries two majors-adjacent findings worth fixing before Sam would call the trust bar fully cleared: evidence stops short of literal `file:line` granularity (F1), and the badge isn't one click from a finished scan (F2). Both are L2-eligible — neither blocks the job, they blunt the polish Sam explicitly scores on.

---

## 4. Character voice — first-person reaction

Okay. On paper, this is more thoughtfully built than I expected walking in. The guardband is the tell — someone on this team has actually been burned the way I have, because that's exactly the mechanism you build after a "maturity dashboard" lies to you once. The provenance track is the right idea done right: I want to see signal, LLM, and blended on one line, and that's what's there. The discrepancy panel is the kind of thing that makes me trust a tool *more*, not less, because it's the tool admitting its own detector might be wrong instead of hiding the seam.

Two things would needle me by the time I got to the bottom of the report. First — "evidence" mostly means "we found this file" or "here's this PR stat," which is fine, I can go check it myself, but it's not the line-number-level re-trace I said I wanted. It's not a lie, it's just not as sharp as the provenance viz makes it look. Second — I finish the scan, I like the badge, and then I have to go retype the repo I *just typed thirty seconds ago* on a completely separate page. That's a rough edge, not a dealbreaker, but it's the kind of thing that makes a demo feel unfinished in a standup.

Would I adopt it, based on what I can see in the code? Conditionally yes — if the live scan actually produces a score that matches my read of a repo I know cold, and the roadmap item is genuinely specific instead of "add more tests" dressed up, I'd use this before my VP asks me "are we AI-native" again. I'm not staking my README badge on it from a static read of the code alone — that verdict has to survive an actual live run, on an actual repo I know the warts of. But this is the first one of these I've looked at where I didn't roll my eyes at the architecture before even seeing a screen.
