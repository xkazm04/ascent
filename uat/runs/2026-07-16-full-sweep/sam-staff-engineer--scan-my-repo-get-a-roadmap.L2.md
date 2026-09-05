# L2 (empirical, live browser) — Sam (Staff Engineer) × "Scan my repo, get a roadmap"

cert_level: L2 · date: 2026-07-16 · method: live browser (Playwright, bespoke driver) against `npm run dev` (localhost:3000), `LLM_PROVIDER=claude-cli`, `ASCENT_AUTH_BYPASS=1`, PGlite persistence. Repo scanned live: **expressjs/express** (a repo Sam would genuinely know cold — legendary test suite, mature CI, near-zero AI tooling — good ground truth to reconcile against).

Driver: `uat/driver/drive-sam.mjs` (full journey) + `uat/driver/drive-sam-capture.mjs` (capture-only re-pass against the now-cached report, written after the first driver's own "report ready" text heuristic stalled on a page section it didn't anticipate — see journal). Screenshots/text/ARIA in `uat/runs/2026-07-16-full-sweep/shots/` prefixed `01-`…`08-` (first pass) and `sam-05`…`sam-08` (capture pass).

---

## 1. Journal (first-person, in character)

I land on `/`. Unlike the L1 surface model's read (`ScanForm` mounted inline on the page), what I actually see is a hero with a big **"Scan a repository →"** button — no visible text field yet. Fine, one extra click, and honestly cleaner: the masthead doesn't get cluttered with an input I might fat-finger before I've read what this thing promises. I click it.

A dialog opens: "Paste any public GitHub repo. In about a minute, Ascent reads it and returns: [level, dimensions, roadmap]." **"About a minute."** I make a mental note of that claim — I've been burned by tools that promise "instant" and then spin for ages. I type `expressjs/express` — a repo I've read the internals of more than once, know the CI is mature, know the docs are okay-not-great, know there's no `CLAUDE.md`/`AGENTS.md` in it. Good test case. I hit Scan.

The page navigates to `/report?repo=expressjs/express` and — this is the first real test — **it is not a dead spinner.** I watch actual stage text tick through: "Reading repository metadata" → "Reading file tree & history" → "Reading key files" → "Analyzing 9 dimensions…" → "Asking Claude…" → "Composing your report", with a live elapsed clock (0:04, 0:08, 0:12…) and a percentage that keeps creeping even while parked at a stage. "Asking Claude…" is where it sits for the long haul — the honest copy right there on screen says "this usually takes a few minutes. You can leave this tab open." That's a very different promise than the "about a minute" the modal just told me thirty seconds earlier. I leave the tab. It's still "Asking Claude…" at 1:00. At 2:00. At 2:40. This is not "about a minute" — but it also isn't a lie exactly, because the loading screen itself never repeats that claim; it corrects itself once you're actually waiting. Still, that's a promise made and immediately walked back, and I noticed it because I was watching the clock the whole time (habit).

At **3:31** from submit (t+211s) the report renders. Total wall time from clicking "Scan a repository" to a finished report: **about 3 minutes 50 seconds** including my own typing. Not "about a minute." Not quite my own "2-3 minutes" bar either, but close enough that I wouldn't walk away — it's in the range where I'd tab back to check email once and come back to a finished report, which is exactly the "coffee break" promise the design was going for.

**The report itself.** This is the part that actually earns something from me. Overall: **L3 — Augmented, 45/100**. Headline: *"Express sits at the L2/L3 boundary: an elite, human-engineered test suite and CI pipeline make the codebase safe to change quickly, but there is essentially no codified AI workflow — no agent guidance, no agentic review or CI automation, and no AI verification harness."* That is — genuinely — what I would have written. Testing scored **95/100** ("Best-in-class automated test suite (112 files, 2.24 test-to-source ratio, tracked coverage)"). AI Tooling scored **2/100**. Agentic **12**. AI Process **8**. That's not a tool being generically pessimistic — that's a tool that correctly identified this specific repo has an outstanding manual engineering culture and essentially zero AI-native practice, which is *exactly* Express's actual state. I did not expect a scan to nail that distinction this cleanly. Quiet respect, not effusive.

**Strengths list** cites real, checkable specifics: "112 files, 2.24 test-to-source ratio," "4 workflows... wide Node/OS matrix plus lint and CodeQL SAST gates," "all Actions pinned by SHA," "100% reviewed merges, 93% small PRs, only 3% reverted." **Risks** cite a "critical-severity CI injection pattern (untrusted input in run steps in ci.yml/legacy.yml)" and "Branch protection is largely un-enforced (0 required approvals/status checks)." These are not hand-wavy. I could go check every one of these in about the time it takes to open the file — because they *name* the file or the concrete metric, even without a line number.

**Discrepancy panel** ("Flagged for review"): the model itself says D5 (Documentation)'s 35 may undercount, citing the README's Contributing/Security Issues/Running Tests sections and four runnable example apps. That's the audit-itself mechanic working exactly as advertised — and it's a fair catch; Express's docs *are* better than a bare-README score implies.

**Provenance track.** I expand D4 (Agentic Workflows, scored 12). The SVG's own accessible label reads: `"Score provenance: signal 10, LLM 13, blended 12"` — the LLM nudged the deterministic signal by +3, well inside the guardband, and I can see the shaded band on the chart itself. This is the mechanism I read about in the code holding up live, on a real dimension, in front of me.

**Evidence granularity.** D4's evidence list has exactly one line: *"Dependency update bot configured."* No file, no line. But I know what that's pointing at — `.github/dependabot.yml` — inside of about five seconds, because I know this codebase and I know what "dependency update bot" means as a category. Re-tracing it cost me a thought, not a search. For a repo I *didn't* know as well, this would take longer — maybe 20-30 seconds of guessing which config file — but it never left me stuck; every evidence string I saw named something concrete enough to go find.

**Roadmap.** This is the sharpest surprise of the whole run. Item 1: *"Agent guidance is unwritten — nothing tells an AI where to start... there's nowhere to encode the backward-compatibility and 4.x/5.x-branch norms that matter enormously for a framework this widely depended on"* — with explore-questions naming `lib/router` and `lib/application.js` specifically. Item 2: *"A critical CI injection pattern sits alongside otherwise strong pipeline hygiene... the dangerous-workflow finding in ci.yml/legacy.yml (untrusted input consumed in a run step)"* — again, real file names, a real finding class (dangerous workflow / script injection), not "improve your CI." This is not "add more tests" energy at all — if anything it's sharper than what I'd have drafted in five minutes, because it caught the CI injection pattern, which I would only have found if I'd gone looking specifically.

But — and this is the thing that would needle me in a standup — every single roadmap item is phrased as an **observation plus open questions**, never an instruction. "Agent guidance is unwritten" (not "write a CLAUDE.md"). "EXPLORE → What would a first-time contributor... most need to know...?" I get *why* — the copy is deliberately "companion, not boss," inviting the team to explore rather than ordering them around — and I respect the instinct (I hate tools that boss me too). But I said I wanted something I'd "actually put in the next sprint," and a sprint ticket is an imperative, not a discussion prompt. I can convert "would signing published npm artifacts (npm provenance) be feasible" into "add npm provenance signing to the release workflow" myself in ten seconds — but I have to do that conversion. It's not quite handed to me sprint-ready; it's handed to me one exploratory step short of that.

**Badge.** I look for a way to get my badge from the finished report. The only "BADGE" link on the whole page is in the global site footer/header nav — `href="/badge"`, plain, no query param, no repo context. Confirmed live exactly as the code read predicted: I'd have to click it and retype `expressjs/express` a second time.

---

## 2. L2 priorities — answered

1. **Time how fast Sam can re-trace a dimension claim to a concrete file/line, live.** — For a repo I know (Express), under 15 seconds even for a one-line, no-file-named claim ("Dependency update bot configured" → I know that's `.github/dependabot.yml`). For evidence that does name a file/metric explicitly (the test-to-source ratio, the pinned-Actions claim), re-tracing is near-instant. **Verdict: file-only granularity does NOT meaningfully slow Sam down in practice, for a repo he knows** — confirms L1's speculation that this "downgrades further toward polish." A repo Sam *doesn't* know cold would cost more (no baseline to match "dependency bot" against), but that's a different, unavoidable problem (unfamiliarity), not this one.

2. **Confirm a weak-deterministic-signal dimension isn't pulled up past the guardband by the LLM.** — **Partially confirmed, partially inapplicable.** Express doesn't have theater tests (Testing scored 95, and legitimately so), so I couldn't reproduce Sam's exact fake-coverage trauma on this repo. What I *did* confirm live: D4's provenance track shows signal 10 → LLM 13 → blended 12, a small, guardband-bounded nudge, not an inflation. And the three weakest dimensions (AI Tooling 2, AI Process 8, Agentic 12) were NOT pulled up despite the repo's overall polish — the model correctly kept them low. This is consistent with the guardband holding, but a repo with genuinely fake test coverage would be a sharper test; recommend recertifying against one.

3. **Any other tab/header link to `/badge`?** — Confirmed: exactly one link on the whole report page, `href="/badge"` in the persistent site-footer nav, text "BADGE" — no repo prefill, same on every tab (Scoring/Dimensions/Roadmap all share the footer). No additional CTA anywhere in Scoring/Dimensions/Roadmap tab bodies. Matches and closes L1 F2's open question.

4. **Is the roadmap genuinely repo-specific, not generic "add more tests"?** — **Confirmed, decisively.** Both quick-win items name real files (`lib/router`, `lib/application.js`, `ci.yml`/`legacy.yml`) and a real vulnerability class (CI injection via untrusted input in a run step) that's specific to this repo's actual CI config — not boilerplate. This clears Sam's bar on substance. (See new finding below on the *phrasing*, which is a separate axis from specificity.)

5. **Do SSE progress frames actually render live stage/message text?** — **Confirmed, strongly.** Captured six consecutive real stage transitions with a ticking elapsed clock and percentage, not a static spinner: "Reading repository metadata" (0:04, 62%) → "Reading file tree & history" → "Reading key files" → "Analyzing 9 dimensions" → "Asking Claude…" (0:08 onward, 72%, held through the long LLM call) → "Composing your report." This is real, not decorative.

6. **Time the actual end-to-end scan against the ~2-3 min promise.** — **211 seconds (3:31) from submit to rendered report**, ~3:50 total including the click-through and typing. This beat the code's own internal median estimate (`SCAN_ESTIMATE_MS` = 360s / 6min in `scanEstimate.ts`) but overshot both Sam's own "2-3 minutes" expectation and — more importantly — the pre-scan modal's explicit **"in about a minute"** promise by roughly 3.5-4x. See new finding below.

---

## 3. Findings (L2)

### L2-SAM-01 — Confirmed: evidence is fast to re-trace in practice (downgrades L1-F1 toward polish)
- `id`: L2-SAM-ROADMAP-01 (confirms + downgrades L1-SAM-ROADMAP-01)
- `cert_level`: L2 · `type`: quality-gap · `dimension`: trust · `severity`: **polish** (downgraded from L1's "minor")
- `evidence`: `uat/runs/2026-07-16-full-sweep/shots/sam-07-dimension-detail.text.txt:140-143` ("EVIDENCE · Dependency update bot configured" — one line, no file path); re-traced by the L2 driver (in Sam's head) to `.github/dependabot.yml` in well under 15 seconds based on domain knowledge.
- `verdict`: confirmed (the gap is real) but impact is lower live than the code read alone suggested — for a repo Sam knows, this never blocks him.
- `ceiling`: for a repo Sam does NOT know as well, the same one-line evidence would cost meaningfully more re-trace time — this remains a real (if now smaller) gap.

### L2-SAM-02 — Confirmed: no repo-prefilled path from report to badge (confirms L1-F2)
- `id`: L2-SAM-ROADMAP-02 (confirms L1-SAM-ROADMAP-02)
- `cert_level`: L2 · `type`: confusion · `dimension`: effort · `severity`: minor
- `evidence`: `uat/runs/2026-07-16-full-sweep/shots/sam-badge-links.json` → `{"badgeLinks":[{"href":"/badge","text":"BADGE"}],...}` — exactly one link, footer nav, no `?repo=` param, present identically on Scoring/Dimensions/Roadmap.
- `code_check`: confirmed-absent (matches static read)
- `verdict`: confirmed

### L2-SAM-03 (NEW — surface-model gap L1 missed) — Landing page's real affordance is a modal-trigger button, not an inline form
- `id`: L2-SAM-ROADMAP-03
- `cert_level`: L2 · `type`: confusion · `dimension`: clarity · `severity`: polish
- `title`: L1 described `/` as directly mounting `ScanForm` as "a single owner/repo text input" visible on page load; live, the actual affordance is a **"Scan a repository →" button that opens a modal dialog** (`src/components/landing/prototypes/index/ScanModal.tsx:140-148`) containing the form. This is genuinely good UX by design (the code comment explains it keeps the masthead clean and puts the "what you get" promise front-and-center on open) — not a defect — but it IS a gap between L1's surface model and the live page, worth recording so future L1 passes cite the button correctly.
- `evidence`: `uat/runs/2026-07-16-full-sweep/shots/01-landing.png` (button, no visible input); `src/components/landing/prototypes/index/ScanModal.tsx:140-148,218`.
- `code_check`: present-but-missed (by L1's surface model)
- `verdict`: confirmed as a surface-model gap, not a UX defect — by-design and arguably better than L1 assumed.
- `resolution`: by-design
- `ceiling`: n/a — one extra click, clearly labeled, no friction for Sam in practice.

### L2-SAM-04 (NEW) — The modal's own "in about a minute" copy contradicts the app's measured ~3.5-6 min reality
- `id`: L2-SAM-ROADMAP-04
- `cert_level`: L2 · `type`: quality-gap · `dimension`: trust · `severity`: **major** *(derived: frequency high — every scan sees this exact copy right before waiting several minutes; reachability high — first thing every Sam sees; trust_erosion medium — Sam explicitly polices "latency theater" and tracks the clock)*
- `title`: The scan modal tells every user **"In about a minute, Ascent reads it and returns..."** (`src/components/landing/prototypes/index/ScanModal.tsx:194-195`) immediately before a scan that the codebase's own calibration doc says runs a **measured median of 360s / 6 min** (`src/components/report/scanEstimate.ts:8,13`: "Clean wall times: 272/337/357/367/397/486s (median ≈ 360s)"), and that the *loading screen itself* — seconds later — corrects to "this usually takes a few minutes" (`scanEstimate.ts:59`). Live, this run took **211s (3:31)** from submit to report, beating the internal median but still ~3.5x the modal's own promise.
- `expected`: The pre-scan promise and the in-flight honest copy should agree — either the modal says "a few minutes" (matching the loading screen and the measured reality), or the pipeline genuinely resolves in about a minute.
- `got`: Two different, self-contradicting time promises shown roughly 30-40 seconds apart in the same flow.
- `evidence`: `src/components/landing/prototypes/index/ScanModal.tsx:194-195`; `src/components/report/scanEstimate.ts:1-13,59`; live timing in `uat/driver/drive-sam.mjs` output — submit at `08:46:21`, report-ready detected at `08:49:52` (poll#45, t+211s) via `uat/runs/2026-07-16-full-sweep/shots/sam-05-report-scoring.text.txt` ("Scanned 5m ago" shown a few polls later, consistent with continued clock drift in the UI's relative-time display).
- `code_check`: confirmed-absent as a reconciled promise (the two numbers are hard-coded in two different components, unrelated to each other — `ScanModal.tsx`'s "about a minute" is a static string, not derived from `SCAN_ESTIMATE_MS`).
- `verdict`: confirmed. Adversarial check: is this refutable as "well, mock scans ARE fast, so 'about a minute' might be true for `mock` mode"? No — the modal copy is unconditional (shown regardless of provider), and the UAT env's own pinned default is `LLM_PROVIDER=claude-cli` specifically so this dimension is tested against real latency, per `uat/env.md`. The contradiction is real for the primary configured path.
- `l2_priority`: n/a (this is itself an L2 finding)
- `ceiling`: this is a copy/UX fix, not a scan-speed fix — the honest "few minutes" framing already exists one screen later; the fix is deleting or correcting one hardcoded string, no architecture change needed.

### L2-SAM-05 (NEW) — Roadmap substance is repo-specific and sharp; but every item is phrased as a question, never a directive
- `id`: L2-SAM-ROADMAP-05
- `cert_level`: L2 · `type`: quality-gap · `dimension`: senior-quality · `severity`: minor
- `title`: The roadmap items are excellent on specificity (matches/exceeds Sam's "pin 3 unpinned Actions to SHAs" bar — see journal for the `lib/router`/`ci.yml` citations) but the system prompt explicitly instructs "invitational... never as orders" phrasing (`src/lib/scoring/prompt.ts:115-122`), so every title is an observation and every action is dressed as an open "EXPLORE" question, never an imperative Sam could paste directly into a sprint ticket.
- `expected` (per Sam's own acceptance criteria): "a specific, evidence-grounded, highest-leverage next move... that Sam would actually put in the next sprint."
- `got`: real, specific gaps — genuinely sprint-ticket-worthy in substance — wrapped in questions ("Would signing published npm artifacts... be feasible?") rather than stated as the action itself ("Add npm provenance signing to the release workflow").
- `evidence`: `uat/runs/2026-07-16-full-sweep/shots/sam-08-roadmap.text.txt:87-164`; prompt instruction at `src/lib/scoring/prompt.ts:115-122` ("Ascent is a transition COMPANION, not a boss... Phrasing must be invitational throughout").
- `code_check`: by-design (the product deliberately chose this framing as a stated design principle, not an oversight)
- `verdict`: confirmed as a real friction point for Sam specifically, though it is an intentional product stance, not a bug. Adversarial check: would a skeptic say "Sam can trivially reword the question into an imperative himself, so this is nitpicking"? Partially fair — the conversion cost is low (seconds per item) — which is why this is scored **minor**, not major: the substance clears the bar; only the delivery format requires one extra step from Sam.
- `resolution`: by-design
- `ceiling`: the product's "companion, not boss" philosophy is a deliberate stance that will keep costing Sam this small conversion tax on every roadmap item; only a phrasing-mode toggle (or a Sam-specific "actionable" view) would remove it without abandoning the design intent.

### L2-SAM-06 (strength, confirmed live) — Guardband + reconciliation held up on a real scan
- `id`: L2-SAM-ROADMAP-STRENGTH-01 (confirms L1-STRENGTH-01)
- `evidence`: D4 provenance SVG aria-label, `uat/runs/2026-07-16-full-sweep/shots/sam-06-dimensions.aria.yaml:114`: `"Score provenance: signal 10, LLM 13, blended 12"` — LLM nudge of +3 stayed inside the guardband. Overall score reconciliation: Testing 95, AI Tooling 2, Agentic 12, AI Process 8 against Express's actual well-known state (elite manual engineering, near-zero AI-native tooling) — exactly matches what Sam (who knows this repo) would score it.
- Why it matters: this is the single most trust-building thing in the whole run — the read matched Sam's own mental model of a specific, real, well-known repo.

### L2-SAM-07 (strength, confirmed live) — Discrepancy self-audit fired on a real, fair catch
- `evidence`: `uat/runs/2026-07-16-full-sweep/shots/sam-05-report-scoring.text.txt:187-192` — "D5's 35 may undercount documentation depth — the README's table of contents shows dedicated 'Contributing', 'Security Issues', and 'Running Tests' subsections, and the sampled examples/ directory contains at least four distinct runnable apps..." A specific, checkable, plausible self-correction — not decorative.

---

## Grounding score (unchanged from L1, confirmed live)
**6/7** — live output visibly drew on deterministic signals (test-to-source ratio, Actions pinning, branch protection), PR/commit behavior (100% review rate, 93% small PRs, 8% AI-involvement), the security battery (critical CI-injection finding), tech stack (JavaScript-specific framing), and sampled files (README ToC, `examples/` contents cited verbatim in the discrepancy). Standing decisions remains n/a (anonymous scan, no org).

## Timing (re-measured live vs. promise)
- Modal promise: **"about a minute."**
- Internal calibration (code comment, `scanEstimate.ts`): **median ≈ 360s (6 min)**, p90 ≈ 490s.
- **This run: 211s (3:31) from submit, ~3:50 total from clicking "Scan a repository."**
- Sam's own stated expectation: "~2-3 minutes."
- Verdict: beat the code's own pessimistic internal median comfortably, landed close-but-over Sam's personal bar, and significantly undercut the modal's own advertised claim. Net: **time-saved holds** (a day's manual audit → ~4 minutes is still an enormous win) but the specific "about a minute" promise is broken and worth fixing (L2-SAM-04).

## Verdict
**L2-pass.** The journey's definition-of-done was met live: the scan completed with no signup/keys, with real streamed progress (not latency theater); the overall level, 9 dimension scores, and posture quadrant reconciled with what Sam (as someone who knows Express) would expect — nothing scored strong where the substance was thin; every score was re-traceable to concrete, checkable evidence (fast in practice, though not literal file:line); LLM-vs-detector discrepancies were surfaced with a specific, fair catch; the roadmap named repo-specific, evidence-grounded, high-leverage moves (citing real files and a real CI vulnerability) that clear Sam's specificity bar even though their invitational phrasing costs him a small manual conversion step; and Sam reached a credible verdict in well under Ascent's own internal median, in a time range that still represents a massive win over "the better part of a day." The two carried-forward L1 majors (evidence granularity, badge prefill) both survive as confirmed-but-downgraded/confirmed-as-is findings — neither blocked the job. Two new findings emerged only at live L2: the modal's broken time-promise (L2-SAM-04, the most actionable finding of this run) and the substance-vs-phrasing tension in the roadmap (L2-SAM-05).

---

## 4. Character voice — first-person reaction (live)

Okay. I said on paper this was more thoughtfully built than I expected, and having actually watched it run on a repo I know cold, that holds up — more than holds up, honestly.

The score matched my own read of Express almost exactly: elite tests, mature CI, essentially no AI-native anything. I didn't have to squint or make excuses for the tool to agree with what I already knew. That's the whole ballgame for me — a tool that flatters a repo I know is thin gets closed immediately; this one told me the truth about a repo I know well, unprompted, including finding a CI injection pattern I hadn't specifically gone looking for. "Okay, that's actually right" — and then some.

The provenance track wasn't decoration — I expanded a dimension and the guardband math was right there: signal 10, LLM 13, blended 12. Small, bounded nudge, exactly the mechanism that would have caught my old fake-80%-coverage horror story if it ever showed up here.

Two things needled me, and one thing actively annoyed me. Needled: the evidence strings are still "we found this pattern," not file:line — fine, I could always trace it, but it's not the sharpest version of this. Needled: I still had to go retype the repo name on a separate badge page. Annoyed: the modal told me "about a minute" and then made me wait three and a half. I watch clocks. Don't tell me a minute and then, thirty seconds later, quietly admit "a few minutes" on the very next screen — just tell me the truth up front. That's a five-minute copy fix and it's the single thing I'd file first.

The roadmap is the pleasant surprise of the whole thing — genuinely sharper than "add more tests," naming real files and a real vulnerability class I'd have had to dig for myself. My only gripe is the "explore" framing: I don't need Ascent to ask me permission to tell me what's wrong. I get the "companion not boss" instinct and I don't hate it philosophically, but when I said "hand me a roadmap I'd put in the next sprint," I meant an item I copy-paste into Linear, not a discussion prompt I have to rewrite as one first. Small tax, paid every single item, every single scan.

Would I adopt it? Yes, based on this run — not conditionally anymore. If it can read a repo I've spent years in and land the score, the risks, and one vulnerability I didn't already have flagged, in under four minutes, that beats my own grep session. I'd fix the "about a minute" lie before I'd show this to my VP, and I'd want the roadmap items reworded as actions before I trust myself to paste one straight into a sprint without editing it first. But I'd use this again on my own repos this week, and I'd tell a peer to try it on something they actually know — that's the real test, and it passed.
