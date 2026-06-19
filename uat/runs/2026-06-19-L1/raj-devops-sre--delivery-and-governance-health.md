# L1 — Raj (DevOps / SRE Lead) × delivery-and-governance-health

**Verdict: L1-conditional** — the delivery/governance read, the gate, and the regression alert are structurally sound and well-engineered (deterministic gate, fail-closed floors, delta-only alerts with an audit trail, per-tenant routing). But two majors carry forward: (1) the merge-blocking PR gate and the public gate API score on a **mock/deterministic** path by default — on the keyless/mock data Raj will actually evaluate, the LLM layer collapses to the deterministic signal, so the "verdict" is a signal threshold, not an AI judgement; and (2) the entire delivery+governance read is **only as fresh as the persisted scan and only as truthful as the GitHub token** — no token means governance/PR tiles silently empty or under-read, which is the green-by-default failure mode he is allergic to (here it manifests as blank-by-default, which is honest, plus an additive-only governance blend that can't *demote* a repo for missing guardrails).

---

## Reachable surface set

Under the UAT seed (`ASCENT_AUTH_BYPASS=1` + `ASCENT_OPEN_ORG_DASHBOARDS=1` + a seeded org via `node scripts/seed-org.mjs <org>`, PGlite on), Raj can open:

- `/org/[slug]/delivery` — PR signals, branch governance, 12-week commit activity. Backed by `getOrgPrSignals` / `getOrgGovernance` / `getOrgActivity` (`src/app/org/[slug]/delivery/page.tsx:46-50` → `src/lib/db/org-signals.ts:21,88,151`). All three are DB-gated (`isDbConfigured()` → `null` no-op when no DB).
- `/org/[slug]/governance` — fleet gate pass-rate, where the fleet fails, failing repos, cheapest-path-to-green, the CI snippet + gate URL (`src/app/org/[slug]/governance/page.tsx:27-29` → `src/lib/org/governance.ts:99` → `getOrgRollup` + `evaluateGateLite`). Owner can edit the policy (`GatePolicyEditor`, gated by `hasOrgRole(slug,"owner")`, line 44); under the bypass the auto-seeded "developer" owner profile makes this editable on the 2nd visit.
- **CI gate verdict** via `GET /api/gate/[owner]/[repo]` on any public repo, no auth (`src/app/api/gate/[owner]/[repo]/route.ts`). Returns 200 pass / 422 fail. **Default `mock=true`** (line 24).
- **The Action** (`action.yml`) → `scripts/maturity-gate.mjs` → the gate API. Default `live: false` → mock. The Action is "the hard merge gate"; the App posts the Check Run + sticky comment (`src/app/api/app/webhook/route.ts:202` `runPrGate`).
- **Regression alerts / digests** — code-reachable but **not browser-surfaced**: they fire from the cron rescan (`src/app/api/cron/rescan/route.ts`) and the App push webhook into a Slack-compatible sink. Raj can read the *audit entry* (`/org/[slug]/audit`, `scan.regression`) but the alert itself is a webhook POST he can only confirm by wiring a sink — `unreachable` as a live UI affordance at L1.
- **Cron autoscan + purge + digest** — `GET /api/cron/{rescan,purge,digest}` are `CRON_SECRET`-guarded server routes, not UI; their effect (fresh persisted scans, a real regression baseline) is what makes the above read trustworthy, but Raj cannot drive them from a browser.

Out of his set (per journey scope): executive narrative, billing/credits, practices authoring, per-dev ranking.

---

## Surface model notes (key affordances → backing file:line)

**Delivery read** (`/org/[slug]/delivery`):
- PR signals tiles (review coverage, merge rate, small-PR rate, AI-involved, AI-governed, time-to-merge) ← `getOrgPrSignals` aggregates each repo's latest scan `prStats` JSON (`org-signals.ts:21-63`), produced by `summarizePullRequests` (`src/lib/analyze/pulls.ts:46-152`). **Flow/stability vs volume:** the PR panel *does* carry stability/flow signals — `reviewedRate` is `null` (not a fake 0%) when there's no human-merged sample (`pulls.ts:132`), `aiGovernedRate` requires a ≥5 AI-PR sample before it drags D8 (`pulls.ts:147`), and `revertRate`/`smallPrRate`/time-to-merge are tracked. **Commit activity is a separate panel** clearly labelled "Weekly commits across the fleet" (`delivery/page.tsx:176-185`), not dressed as velocity — a point in its favor for Raj.
- Branch-governance tiles + per-repo table (Protected / Reviews / Checks / Signed / Rules), risk-first sorted, with an explicit `unprotected` chip (`delivery/page.tsx:121-169`; sort `org-signals.ts:132`). Tiles colored by `scoreHex` → `levelForScore` band (`src/lib/ui.ts:105`), so a low protectedRate maps to a red/orange band — **not** green-by-default coloring.

**Governance read** (`/org/[slug]/governance`):
- Provenance of branch state: `getOrgGovernance` reads each repo's persisted `governance` JSON and **drops any repo whose `readable === false`** (`org-signals.ts:113`). That JSON comes from a real REST read — the branch `protected` flag + the **rulesets API** `/rules/branches/{branch}` (`src/lib/github/governance.ts:47-84`), with `readable = branchRes.status===200 || rulesRes.status===200`. So the governance read reflects *real* GitHub branch-protection/ruleset state when a token can read it — matching his GitHub-rulesets bar. **But** without a `GITHUB_TOKEN` the read is unavailable → the tab shows "Delivery signals … need a GitHub token" (`delivery/page.tsx:64-74`) and the governance gate runs on score dims only.
- Fleet gate: one org policy applied uniformly via `evaluateGateLite` over the rollup snapshot (`governance.ts:116-118`), `byReason` deduped per repo (`governance.ts:124-130`), failures worst-first, cheapest-path-to-green with practice deep-links, and the **identical** policy emitted as a gate URL + Action `with:` block (`governance.ts:81-97`) so dashboard and CI can't drift.

**Gate verdict** (the blocking decision):
- `evaluateGate` is pure + deterministic, lists every failing condition with a specific message, and **fail-closed** on unscored dimensions — a non-finite/NaN dim score is treated as below any floor (`gate.ts:45-47,128-138`), so a partial LLM output can't slip a Security/Testing dim through as "passing." Archetype-aware defaults (org=L3/dim≥40/no-ungoverned; solo=L2/dim≥25) (`gate.ts:58-68`). `sanitizeGatePolicy`/`policyFromParams` treat a `0`/empty floor as "not set" so an always-pass gate can't masquerade as configured (`gate.ts:84-87,242,251-258`).
- The sticky comment is evidence-cited: names the failing conditions, a per-dimension "Where the score falls short" table (score→floor + top gap), the active policy line, and **the provider** (`gate-comment.ts:80-109,130-135`). Markdown is defused against table/marker injection (`gate-comment.ts:32-34`). This is the provenance Raj demands on a block.
- **Determinism guard:** the gate API reads/writes the same cache key as the requested mode (`!mock`), with a comment explicitly noting the old bug where a default mock gate could return a *stochastic LLM verdict* flipping pass↔fail on identical code (`route.ts:53-58`). Good — that's exactly his flaky-gate fear, and it's been engineered out.

**The mock-collapse cross-cut (load-bearing for Raj):**
- `MockProvider.assess` sets each dimension's `score: s.signalScore` verbatim, empty `discrepancies`, fallback roadmap (`src/lib/llm/mock.ts:39,59-87`). The engine blend at full coverage is `effectiveBlend = SCORE_BLEND(0.6)` and guardbands the LLM to ±25 of the signal — but with the mock, `llmScore = s.signalScore`, so `score = signalScore` **exactly** (`src/lib/scoring/engine.ts:70-102`, `SCORE_BLEND=0.6`/`LLM_GUARDBAND=25` `model.ts:16,23`). So on the mock path the gate is a pure deterministic-signal threshold.
- **Both** the public gate API (`route.ts:24` default `mock=true`) **and** the App-mode merge-blocking PR Check Run (`webhook/route.ts:216,219,231` — `mock:true` for head/fallback/base, by design "fast and free of LLM spend") score with the mock. The Action also defaults `live:false`. So the verdict Raj would make merge-blocking is, in its default and recommended configuration, a deterministic signal gate — not an AI judgement.

**Cron / regression baseline (freshness):**
- `cron/rescan` is **fail-closed** on a missing `CRON_SECRET` (503, `rescan/route.ts:32-38`), claims-before-work to prevent double-scan/double-bill (`:85`), captures `prev` BEFORE persisting (`:122`), and calls `checkAndAlertRegression` only on a *changed* commit (`:138-141`). It uses the deployment's configured `LLM_PROVIDER` (gemini/bedrock) — **real provider on a configured deploy** (`:5-6`), refunding + skipping the alert if it degraded to mock (`:136`). So the persisted fleet read that governance/regression diff against is real-provider when deployed properly. Scheduled by `vercel.json` (rescan `0 6 * * *`, purge `0 4 * * *`).
- **Baseline survives retention:** `cron/purge` keeps the newest N scans per repo (`src/lib/db/retention.ts:129-134`) and runs at 4 AM, *before* the 6 AM rescan captures `prev` — and retention defaults to "keep everything" (env defaults 0 = no purge, `retention.ts:60-62`). So the regression diff always has a real prior scan to diff against — not theater.
- **No re-spam of a stalled regression:** because the detector diffs consecutive scans (after − before), a repo that regressed and *stays* at the same low level produces a 0-delta on the next run and does **not** re-alert; it only re-pages if it drops *further*. Dedup is implicit-via-delta, not a dedup table — which is exactly the behavior Raj wants (no known-bad spam) but means there's no "still failing" reminder either (acceptable for him).
- Regression detector is **delta-only**: fires on a level demotion, a slide *into* ungoverned, overall drop ≥5, or a dim drop ≥15 (`src/lib/alerts.ts:38,46-94`); a small dip or steady-state does **not** fire (pinned `alerts.test.ts:65-69`). A repo that stays bad but doesn't drop *further* won't re-page → no known-bad spam. Audit row written even with no sink (`scan-alerts.ts:74-86`), per-tenant routing with no cross-org leak (pinned `scan-alerts.test.ts:123-157`), never throws into the scan path.

---

## Findings

```json
[
  {
    "id": "RAJ-L1-01",
    "journey": "delivery-and-governance-health",
    "character": "Raj (DevOps / SRE Lead)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "The merge-blocking gate verdict is a deterministic signal threshold, not an AI judgement, on the default/mock path",
    "expected": "A gate I make a required, merge-blocking check evaluates the repo's real maturity and blocks for an evidence-backed reason I'd defend to a blocked developer.",
    "got": "Both the public gate API (default mock=true) and the App-mode PR Check Run (mock:true by design, 'fast and free of LLM spend') score with MockProvider, which sets each dimension score = the deterministic signal score verbatim. The engine blend then resolves to score = signalScore exactly. So the blocking verdict is a threshold over file/PR/governance detectors — the LLM nuance the product sells is absent from the gate by default. On a keyless deploy even --live falls back to mock (LLM_FALLBACK_PROVIDER=mock).",
    "evidence": [
      "src/app/api/app/webhook/route.ts:216",
      "src/app/api/app/webhook/route.ts:219",
      "src/app/api/app/webhook/route.ts:231",
      "src/app/api/gate/[owner]/[repo]/route.ts:24",
      "src/lib/llm/mock.ts:39",
      "src/lib/scoring/engine.ts:96",
      "src/lib/scoring/engine.ts:102",
      "src/lib/maturity/model.ts:16",
      "action.yml:48"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Run the live gate (?mock=0 with claude-cli) on a real public repo and confirm the verdict + the sticky comment's 'scored by Ascent (provider)' line reads claude/gemini, not mock; confirm the deterministic mock verdict and the live verdict agree on pass/fail for the same repo (if they diverge, the default mock gate is blocking on a different bar than the one the dashboard advertises).",
    "suggested_acceptance": "The merge-blocking verdict, in its recommended config, is evidence-cited AND reflects the same scoring path the dashboard/report shows; OR the mock-vs-live distinction is surfaced on the Check Run so a blocked dev knows which scored them."
  },
  {
    "id": "RAJ-L1-02",
    "journey": "delivery-and-governance-health",
    "character": "Raj (DevOps / SRE Lead)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "Governance read is token-gated and additive-only — no token means blank/under-read, and missing guardrails can never demote a repo's score",
    "expected": "The governance panel reflects real ruleset/required-check state and flags a repo that lacks required checks; an ungoverned repo reads ungoverned, not protected.",
    "got": "Two effects. (a) Without a GITHUB_TOKEN the rulesets/branch read isn't available, getOrgGovernance returns null, and the tab shows a 'need a GitHub token' empty state — the fleet read is simply absent, not wrong, but it's blind exactly when he most needs it. (b) The governance->score blend (applyGovernanceSignals) is additive-only: present guardrails BOOST D3/D6/D8, but their ABSENCE is explicitly 'neutral' (comment: 'classic-protection repos may not expose their rules to a read token'). So a genuinely unprotected repo is not penalized in score/posture — the gate can't demote on missing protection, only on low signal. The per-repo table DOES show the truthful protected/checks/signed flags + an 'unprotected' chip, so the read itself isn't green-by-default; the SCORE just won't punish ungoverned repos.",
    "evidence": [
      "src/lib/github/governance.ts:70",
      "src/lib/db/org-signals.ts:113",
      "src/app/org/[slug]/delivery/page.tsx:64",
      "src/app/org/[slug]/delivery/page.tsx:71",
      "src/lib/analyze/pulls.ts:236",
      "src/lib/analyze/pulls.ts:240"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Seed an org WITH a GITHUB_TOKEN and confirm the governance table matches the actual ruleset state of a repo Raj knows is ungoverned (drill-to evidence). Then confirm whether an unprotected repo can still PASS the gate purely on score — if so, that's the green-by-default he fears, surfacing at the gate not the table."
  },
  {
    "id": "RAJ-L1-03",
    "journey": "delivery-and-governance-health",
    "character": "Raj (DevOps / SRE Lead)",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "dimension": "trust",
    "title": "Regression alerts and the weekly digest have no in-app surface — only an audit row + a webhook POST",
    "expected": "I can see what would have paged me, and the alert leaves an audit trail I can review before I wire it into Slack.",
    "got": "The audit trail exists ('scan.regression' recorded even with no sink, scan-alerts.ts:74) and the Slack payload is well-formed and explains WHY (top movements). But there's no dashboard view of recent alerts/digests; to evaluate whether it cries wolf, Raj must configure a webhook sink and watch it fire from cron. At L1 the alert is judge-able only by reading the (excellent) pure detector + its tests, not by seeing it in the UI.",
    "evidence": [
      "src/lib/scan-alerts.ts:74",
      "src/lib/alerts.ts:117",
      "src/app/api/cron/rescan/route.ts:138"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Wire a test webhook (or capture via the audit tab), trigger a real demotion via two seeded scans, and confirm exactly one alert fires with the right WHY attributions, and that a re-scan with no further drop does NOT re-page."
  },
  {
    "id": "RAJ-L1-S1",
    "journey": "delivery-and-governance-health",
    "character": "Raj (DevOps / SRE Lead)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "dimension": "trust",
    "title": "STRENGTH — Regression alert is delta-only with per-tenant routing, audit trail, and exactly-once credit alerts: engineered against alert fatigue",
    "expected": "Fire on real demotions only, never re-spam a known-bad repo, leave an audit trail, never page the wrong tenant.",
    "got": "detectRegression fires only on a level demotion / slide-into-ungoverned / overall drop>=5 / dim drop>=15 — a small dip or a steady-bad repo does NOT fire (so no re-paging of known-bad). Audit recorded even with no sink; per-tenant webhook routing is pinned so org A never POSTs to org B; the whole path is throw-safe (never fails the scan). Low-credits alerts fire exactly once on the threshold-crossing edge, never spamming below it. This is precisely his anti-flaky bar, met in code + exhaustively tested.",
    "evidence": [
      "src/lib/alerts.ts:46",
      "src/lib/alerts.test.ts:65",
      "src/lib/scan-alerts.test.ts:101",
      "src/lib/scan-alerts.test.ts:142",
      "src/lib/scan-alerts.test.ts:313"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed"
  },
  {
    "id": "RAJ-L1-S2",
    "journey": "delivery-and-governance-health",
    "character": "Raj (DevOps / SRE Lead)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "dimension": "trust",
    "title": "STRENGTH — The gate is deterministic, fail-closed, evidence-cited, archetype-aware, and the dashboard + CI run the IDENTICAL policy",
    "expected": "A block I can explain: which policy, which dimension, which evidence — and a verdict that doesn't flip-flop on identical code.",
    "got": "evaluateGate fail-closes on unscored dimensions (a missing Security/Testing dim FAILS rather than slips through), lists every failing condition with a specific message, and the sticky comment carries a per-dimension score->floor table + the active policy + the provider. The gate API reads/writes the SAME cache key as the requested mode so a default mock gate is reproducible (the old stochastic-flip bug is explicitly fixed). buildGovernanceOverview applies the org policy via evaluateGateLite — the same rules — and emits the identical policy as the gate URL + Action with-block, so dashboard and CI can't drift. On a hard error the PR check posts a 'neutral' check (with a Re-run button) so a required check is never silently absent.",
    "evidence": [
      "src/lib/scoring/gate.ts:45",
      "src/lib/scoring/gate.ts:128",
      "src/app/api/gate/[owner]/[repo]/route.ts:53",
      "src/lib/org/governance.ts:116",
      "src/lib/scoring/gate-comment.ts:96",
      "src/app/api/app/webhook/route.ts:258"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed"
  },
  {
    "id": "RAJ-L1-S3",
    "journey": "delivery-and-governance-health",
    "character": "Raj (DevOps / SRE Lead)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "dimension": "senior-quality",
    "title": "STRENGTH — Delivery read separates flow/stability from raw commit volume; cron rescan is fail-closed with a real regression baseline",
    "expected": "Commit count is not dressed as velocity; the read weighs review/stability the way DORA 2024 demands; the read is fresh with a real baseline to diff.",
    "got": "PR signals carry review coverage (null when unmeasurable, not a fake 0%), small-PR rate, revert/stability, and time-to-merge — flow signals distinct from the clearly-labelled separate 'commit activity' panel. The cron rescan fails closed on a missing CRON_SECRET, claims-before-work (no double-bill), captures prev BEFORE persisting (a real baseline), uses the deployment's real LLM provider (not mock), and only alerts on a changed commit. This is the freshness + baseline that makes the regression detection non-theatrical.",
    "evidence": [
      "src/lib/analyze/pulls.ts:132",
      "src/lib/analyze/pulls.ts:147",
      "src/app/org/[slug]/delivery/page.tsx:176",
      "src/app/api/cron/rescan/route.ts:32",
      "src/app/api/cron/rescan/route.ts:122",
      "src/app/api/cron/rescan/route.ts:5"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed"
  }
]
```

---

## Character feedback (first person, in Raj's voice)

Alright. First pass and I'm not reaching for the mute button — that's already better than most of these.

The delivery tab does the thing I actually want: PR review coverage, small-PR rate, revert rate, time-to-merge, and branch governance per repo, rolled up across the fleet, with an `unprotected` chip on the repos that earned it and the risky ones sorted to the top. And — credit where due — they didn't dress commit count up as velocity. Commit activity is its own panel, clearly labelled "weekly commits," sitting next to the flow signals, not pretending to be them. That's a tell that someone who's read DORA built this. The `reviewedRate` going `null` instead of a fake "0% reviewed" when there's no human-merged sample — that's the kind of measured-vs-no-sample honesty I check for. Good.

The gate is the part I came to interrogate, and structurally it's the best version of this I've seen on paper. It fail-closes — an unscored Security or Testing dimension *fails* the gate instead of slipping through as a phantom pass, which is the exact hole every SonarQube clone leaves open. The sticky comment tells a blocked dev which condition, which dimension, score-to-floor, and the active policy — that's provenance, that's a block I can defend in a hallway. And they killed the flaky-flip bug: the default gate reads and writes the same cache key as the mode it ran in, so it won't flip pass↔fail on identical code because some other scan warmed the cache first. The dashboard and the CI snippet run the *identical* policy object — no drift between what I see and what blocks. On a hard error it posts a *neutral* check with a re-run button instead of leaving a required check silently absent to block merge forever. Whoever wrote GATE-3 has been paged at 2am.

The regression alert is where I expected to write the whole thing off, and instead I'm nodding. It's delta-only — it fires on a real demotion, a slide into ungoverned, or a material drop, and a repo that's just *steadily bad* doesn't re-page every cron run. That's the known-bad spam that desensitizes a team, and it's designed out. Per-tenant routing is pinned so org A's regression never lands in org B's channel. Audit row written even when there's no sink. The credit alert fires *exactly once* on the threshold crossing. This is signal, not noise — on paper.

So why am I not wiring it in tomorrow? Two things, and they're the two that matter to me.

One: the gate that actually blocks the merge runs **mock**. The public API defaults to it, the App Check Run is hardcoded to it "fast and free of LLM spend," and the Action defaults `live: false`. The mock just echoes the deterministic signal score straight through — so the "maturity verdict" I'd be making a required check is a threshold over detectors, not the AI read this product is selling. Now — I'll be honest — for a *gate*, deterministic is a feature: I do NOT want an LLM flipping my merge status stochastically, and they clearly agree. But then sell it to me as what it is: a deterministic policy gate. If the dashboard shows me an AI-nuanced score and the gate blocks on a different, mock number, those had better agree, and right now I can't tell from the UI which one scored a blocked PR. That's an L2 reconcile-or-walk.

Two: governance is token-gated and the score blend is additive-only. No GitHub token and the whole delivery/governance read goes blank — honest, not green-by-default, but blind exactly when I'm doing the quarterly audit. Worse, even *with* the truthful per-repo table, the *score* never penalizes a repo for missing guardrails — protection only ever boosts, its absence is "neutral." So a genuinely ungoverned repo can still clear the gate on score alone. The table won't lie to me, but the gate might let the ungoverned repo through. That's the failure mode I lose sleep over, just relocated from the panel to the pass/fail.

Does it beat my day of tab-juggling? If the token's wired and the cron's running with a real provider — yeah, the fleet read in one place with continuous delta detection genuinely collapses the manual audit, and I'd lean in. Would I stake my name on the gate as-is? Not until L2 shows me the live verdict matches the advertised score and an unprotected repo actually fails. Close. Reproduce those two and I'm picking a required-check slot.

---

## l2_priority (carry-forward)

- **Mock-vs-live gate reconcile:** run `/api/gate/<repo>?mock=0` with `claude-cli` and confirm (a) the sticky comment provider line is not `mock`, and (b) the live verdict and the default *mock* verdict agree on pass/fail for the same repo. If they diverge, the default merge-blocking gate is enforcing a different bar than the dashboard score.
- **Tokened governance truth-check:** seed an org WITH a `GITHUB_TOKEN`, open `/org/<slug>/governance` + the delivery table, and confirm the protected/required-checks/signed flags match the *real* ruleset state of a repo Raj knows is ungoverned (drill-to evidence). Then confirm whether that unprotected repo can still PASS the gate purely on score (the relocated green-by-default risk).
- **Regression alert live, no-cry-wolf:** wire a test webhook, drive two seeded scans that produce a real demotion, confirm exactly one alert fires with correct WHY attributions and a `scan.regression` audit row — then re-scan with no further drop and confirm it does NOT re-page.
- **Cron freshness + purge baseline:** confirm `/api/cron/rescan` (with `CRON_SECRET`) advances schedules and persists fresh scans on a real provider, and that `/api/cron/purge` retention (keeps newest N, runs 4 AM before the 6 AM rescan, defaults to keep-all) does not delete the previous scan a regression diff needs as its baseline — verify the 4 AM/6 AM ordering holds under a low `RETENTION_MAX_SCANS_PER_REPO`.
- **Delivery read reconciliation:** confirm the PR/governance/activity numbers reconcile with what Raj independently knows about a specific seeded repo (the ungoverned one reads ungoverned; a fast-but-risky one shows the throughput-vs-stability tension, not just high commit volume).
