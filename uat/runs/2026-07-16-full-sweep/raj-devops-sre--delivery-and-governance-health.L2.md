# L2 report — Raj (DevOps / SRE Lead) × Delivery & governance health

cert_level: L2 (empirical, live browser + live API/CLI)

---

## 0. Start state

- Dev server already running (`GET /api/health` → 200) at session start; reused, not respawned (per env.md).
- Seed present and **not** empty/clone-stamped: two distinct orgs already live in PGlite — `public` (10 repos, mostly mock, `vercel/swr` real L3) and `vercel` (6 repos: `vercel`, `next.js`, `ai`, `v0-sdk`, `workflow`, `eve` — mixed real signals, distinct per-repo AI-share/review numbers). `vercel` is the richer fixture for Raj's journey (has AI-involved PRs, governance gaps, an audit trail) and is what this report drives.
- `CRON_SECRET` was **unset** at start (`autoscan.cronSecret:false` in `/api/health`). To answer l2Priority #6 I set a real `CRON_SECRET` in `.env.local` and restarted the dev server once (legitimate, in-scope test per the explicit ask "against a real CRON_SECRET"), then **restored the original `.env.local` and restarted again** before finishing — final health check below confirms the environment is back to its pre-session state (`cronSecret:false`, `githubApp:false`).
- Also did one additional deliberate, temporary restart with `CLAUDE_CLI_TIMEOUT_MS=1`/`LLM_TIMEOUT_MS=1` to force the live LLM provider unavailable (l2Priority #3), then restored again. Total: 3 restarts, all intentional live tests per this journey's explicit L2 priorities, not wedged-server recovery. `.env.local` is git-ignored so nothing was committed; final state verified identical to the session-start health payload.

---

## 1. Journal (first-person, in character)

I open `/org/vercel/delivery` — this is the org I actually trust to reconcile, since `next.js`, `ai`, `v0-sdk` are real repos I could go verify on GitHub myself. Fix-first list up top: one action, "Put AI-assisted PRs under human review — 21% of PRs are AI-involved, but only 65% of those get an approving review." That's the exact flag I was told to go hunt for at L1, and it's really there, really computed off this fleet's real PR data, not a canned string. Good — that's not theoretical anymore.

Scroll to the AI delivery intelligence table: `vercel/ai` — 88% AI reach, "Shadow AI" verdict; `vercel/vercel` and `vercel/v0-sdk` — "Ungoverned." Named repos, named verdicts, distinct numbers per repo. This is the DORA tension with names on it, not a vibe.

Branch governance: 100% protect-main, 100% require-review, 67% require-checks across 6 repos — only `ai` and `v0-sdk` show gaps in the table (no required checks), the rest "fully governed" collapsed into a fold. Fine, matches what a real fleet looks like — not everything is on fire.

Now `/governance`. Gate pass rate 50% (3/6). Failing repos: `v0-sdk` (3 conditions), `next.js` (1 condition — D4 Agentic Workflows 15, below 40), `ai` (1 condition — D4 at 35). The page says, in so many words: "The dashboard gate and your pipeline run the identical policy — no drift." I go test that claim exactly the way I'd test it in real life — I curl the public gate URL it just handed me.

```
GET /api/gate/vercel/next.js
→ 422, level L3, overall 61, failures: D4 (15) AND D9 Supply Chain & Security (20)
```

But the Governance page — and the repo's own report page (L4 · 68, scanned 16m ago) — say `next.js` is **L4, overall 68**, failing only on **D4**. That's not a rounding difference. That's a full maturity level and a whole extra failing dimension (D9) that the dashboard never showed me. If I'd wired this gate into a required check the way the page just told me to, my CI would block `next.js` for a reason ("Supply Chain & Security scored 20") that nobody looking at my Governance tab would ever see, and my dashboard would keep telling my team the repo passes on Agentic Workflows alone. That's the exact SonarQube-death-spiral pattern — the tool disagreeing with itself — except worse, because this tool is telling me out loud that it can't disagree with itself.

I go read why, because I want to reproduce it, not just distrust it on sight. Turns out it's real and structural, not a fluke: the public `/api/gate` endpoint is deliberately built to **never use the operator's ambient GitHub token** (`noAmbientToken: true` — good security reasoning, stops an anonymous caller enumerating private repos through the org's PAT), so it runs its own fresh, token-less mock scan on every cache miss — no PR signals, degraded GitHub coverage. The Governance tab and the report page read the org's **persisted** scan, done with a real token at ingest time. Same `getOrgGatePolicy` policy object feeding all three, exactly as claimed — but the *score* that policy gets evaluated against is not guaranteed to be the same score across the three surfaces. "No drift" is true of the policy config. It is not true of the verdict.

I test the other half of my fear next — the false-block/false-page failure mode. I force the real LLM provider unavailable (CLAUDE_CLI_TIMEOUT_MS crushed to 1ms, restart) and hit the gate with `?mock=0` on a small public repo:

```
GET /api/gate/octocat/Hello-World?mock=0
→ 503, degraded:true, engine.provider:"mock",
  error: "The AI grade could not be produced (the LLM provider was unavailable, so the scan
  fell back to the deterministic floor). This verdict is NOT authoritative — retry the gate."
```

Then I run the actual CI wrapper against that same live endpoint:

```
node scripts/maturity-gate.mjs octocat/Hello-World --ascent-url http://localhost:3000 --min-level L3 --live
→ "✖ Gate could not produce an authoritative grade ... engine: mock (expected a real provider); retry, or pass --mock..."
  exit code 2
```

That's exactly the distinction I demanded — a 503/exit-2 "the gate couldn't run" is not conflated with a 422/exit-1 "the repo failed." I restored the real LLM budget and re-ran the same repo against the live `claude-cli` provider (took 44s, not instant) and got a real, non-degraded 422 with `engine.provider:"claude-cli"`. Both sides of the coin behave. This is the one piece of the whole review that came back cleaner than I expected.

Regression alerts and the digest — I wanted to force a real demotion and watch the whole chain (Slack alert → audit row → digest) fire. I can't, not in this environment. `cron/rescan` — the only path that calls `checkAndAlertRegression` outside of a live GitHub App push webhook — short-circuits with `{"skipped":"GitHub App + database required."}` even with a correct `CRON_SECRET`, because there's no GitHub App configured locally (`autoscan.githubApp:false`). No manual "Re-test" scan path calls the regression detector either — by design, alerts are tied to the *scheduled* autoscan/push path, not ad hoc re-scans. So I genuinely cannot make a real regression fire in this dev fixture without a GitHub App installation, which is out of scope for a local UAT pass. I did confirm `CRON_SECRET` fail-closed behavior fully live: no header → 503, wrong secret → 401, correct secret → 200 (with the GitHub-App-required skip). I ran `cron/purge` with the same secret against the populated fleet: `200`, `orgsProcessed:0` — I checked the code, retention is opt-in and no window is configured, so this is a correct clean no-op, not a silent failure. I ran `cron/digest` too: `200`, `skippedNoSink:2` — both orgs have no Slack/webhook sink configured, also a correct, honest no-op.

One thing I did get to check live: my L1 worry that alert-delivery failures are invisible outside raw audit rows. I opened `/org/vercel/audit` — there's an "ACTION" filter dropdown, and it already lists **"Regression"** and **"Alert sink"** as named, clickable options, not something I'd have to guess the underlying enum string for. So I was wrong to worry I'd need to know an exact action-string — the affordance is there. What's still missing is what I actually said originally: a **standing indicator** (a tile/banner on `/governance` or `/delivery`) that tells me proactively "N alerts failed to deliver this week" without me remembering to go check Audit at all.

## 2. Findings (L2)

```json
[
  {
    "id": "L2-RAJ-01",
    "journey": "delivery-and-governance-health",
    "character": "raj-devops-sre",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "The Governance dashboard/report and the public /api/gate endpoint can disagree on level, overall score, and failing dimensions for the SAME repo, live, right now — the 'identical policy, no drift' claim covers only the policy config, not the verdict",
    "expected": "Per the Governance page's own 'Enforce in CI' copy ('The dashboard gate and your pipeline run the identical policy — no drift') and Raj's core adoption condition, the verdict he sees on /governance should match what curl --fail against the documented gate URL returns for the same repo.",
    "got": "Live: /org/vercel/governance and /report/vercel/next.js both show vercel/next.js as L4, overall 68, failing only D4 (Agentic Workflows, 15<40). GET /api/gate/vercel/next.js (the exact URL the page tells you to paste into CI) returned 422 with level L3, overall 61, failing BOTH D4 (15<40) AND D9 Supply Chain & Security (20<40) — a different maturity level, a 7-point score gap, and an extra failing dimension the dashboard never surfaces. Root cause (confirmed in code): the public gate route always runs its own fresh, token-less scan on a cache miss (src/app/api/gate/[owner]/[repo]/route.ts:76,99 — `noAmbientToken: true` by design, for private-repo enumeration safety), while the Governance tab and report page read the org's persisted, token-backed ingest scan. The SAME getOrgGatePolicy policy object does drive evaluation on both sides (confirmed) — but the underlying report it's evaluated against is not the same report.",
    "evidence": [
      "live GET http://localhost:3000/api/gate/vercel/next.js -> 422 {level:L3, overallScore:61, failures:[D4,D9]}",
      "uat/runs/2026-07-16-full-sweep/shots/vercel-governance.text.txt (next.js listed L4 · overall 68, D4-only failure)",
      "uat/runs/2026-07-16-full-sweep/shots/vercel-nextjs-report.text.txt (L4 · Integrated, 68/100, confidence 59%)",
      "src/app/api/gate/[owner]/[repo]/route.ts:48-54,76,85-101 (noAmbientToken + fresh-scan-on-miss)"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": "The policy-object-sharing claim (same getOrgGatePolicy across dashboard/API/Check Run) is real and holds — that part of the L1 trust case is intact. What doesn't hold is verdict identity: any repo whose org-ingest scan had GitHub-token-only signal (private-repo rulesets, some D9 supply-chain checks, PR data) will diverge from what the token-less public endpoint computes on a cache miss. The App-mode Check Run (webhook/route.ts:250, token-backed) sits as a plausible THIRD independent score for the same commit."
  },
  {
    "id": "L2-RAJ-02",
    "journey": "delivery-and-governance-health",
    "character": "raj-devops-sre",
    "cert_level": "L2",
    "type": "confirmation",
    "severity": "info",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "Degraded-vs-failed gate distinction (503/exit 2 vs 422/exit 1) verified live end-to-end, including the real claude-cli healthy path",
    "expected": "L1 l2_priority: confirm this renders correctly when the live LLM provider is forced unavailable.",
    "got": "With CLAUDE_CLI_TIMEOUT_MS forced to 1ms (provider genuinely unavailable), GET /api/gate/octocat/Hello-World?mock=0 returned 503, degraded:true, engine.provider:'mock', with an explicit 'NOT authoritative — retry the gate' message. Running scripts/maturity-gate.mjs against that same live endpoint produced exit code 2 with a clearly-worded 'Gate could not produce an authoritative grade' message, distinct from a real fail. Restoring the LLM budget and re-running against the same repo produced a real, non-degraded 422 with engine.provider:'claude-cli' (44s latency) — confirming the healthy path also works, not just the degraded one.",
    "evidence": [
      "live GET .../api/gate/octocat/Hello-World?mock=0 (forced-unavailable) -> 503 {degraded:true, engine:{provider:'mock'}}",
      "live: node scripts/maturity-gate.mjs octocat/Hello-World --live -> exit 2, 'Gate could not produce an authoritative grade'",
      "live GET .../api/gate/octocat/Hello-World?mock=0 (LLM restored) -> 422 {degraded:false, engine:{provider:'claude-cli', model:'sonnet'}}"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "resolved-verified",
    "ceiling": "Verified only against the public HTTP gate + CLI wrapper; the Check Run/sticky-comment surface's degraded-flag rendering (gate-comment.ts:125-131) was confirmed by code only, not observed live (no PR/webhook fixture available)."
  },
  {
    "id": "L2-RAJ-03",
    "journey": "delivery-and-governance-health",
    "character": "raj-devops-sre",
    "cert_level": "L2",
    "type": "confirmation",
    "severity": "info",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "'AI-involved but ungoverned' fix-first flag confirmed live on a named, real repo with reconciling per-repo evidence",
    "expected": "L1 l2_priority: confirm the fix-first punch list and the flag actually surface on a live seeded org.",
    "got": "On /org/vercel/delivery, the fix-first list showed exactly one action: 'Put AI-assisted PRs under human review — 21% of PRs are AI-involved, but only 65% of those get an approving review,' and the per-repo PR table below it shows the same tension broken out per repo (vercel/ai: 20% AI share, 88% AI reviewed; vercel/vercel: 30% AI share, 33% AI reviewed) — the flag and its evidence both render and reconcile with each other.",
    "evidence": ["uat/runs/2026-07-16-full-sweep/shots/vercel-delivery.text.txt lines 42-45, 130-137"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "resolved-verified",
    "ceiling": "Only one fix-first action appeared in this fixture (not the full 4-action variety types the code supports); 'reconciles with a repo Raj already knows is bad' was validated structurally (named repos + verdicts, e.g. vercel/ai = 'Shadow AI') but not against a repo Raj has real prior knowledge of, since this is a UAT fixture, not his actual fleet."
  },
  {
    "id": "L2-RAJ-04",
    "journey": "delivery-and-governance-health",
    "character": "raj-devops-sre",
    "cert_level": "L2",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "med", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "L1-RAJ-03 partially refuted: the Audit trail DOES have a labeled 'Alert sink' / 'Regression' action filter — Raj does not need to know an exact action string",
    "expected": "L1-RAJ-03 claimed 'he'd have to know to check the audit log filtered by action, or watch raw cron JSON responses.'",
    "got": "Live /org/vercel/audit shows an ACTION dropdown with named, clickable options including 'Regression' and 'Alert sink' alongside Scan/Rec update/Alert rules/etc — a labeled affordance, not a string he'd have to guess. The narrower part of L1-RAJ-03 still holds: there is no proactive tile/banner on /governance or /delivery surfacing 'N alerts failed to deliver in the last 7 days' — he'd still have to think to visit /audit and apply the filter, rather than being told.",
    "evidence": ["uat/runs/2026-07-16-full-sweep/shots/vercel-audit.text.txt lines 36-53 (ACTION filter options list)"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": "Discoverability is better than L1 assumed (a labeled filter exists); the remaining gap is proactive surfacing, not blind search.",
    "note": "This narrows/corrects L1-RAJ-03 rather than confirming it as originally worded — file as a refinement, not a duplicate."
  },
  {
    "id": "L2-RAJ-05",
    "journey": "delivery-and-governance-health",
    "character": "raj-devops-sre",
    "cert_level": "L2",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "low", "reachability": "low", "trust_erosion": "med" },
    "dimension": "reachability",
    "title": "Regression-alert firing, cooldown, and digest reconciliation could NOT be exercised live in this environment — cron/rescan hard-requires a configured GitHub App, which local UAT has none of",
    "expected": "l2Priority: trigger a real regression on a seeded repo, confirm the Slack-shaped alert fires once, an audit entry lands, and it appears in the weekly digest; separately confirm cron/rescan's claim-before-work behavior against a populated fleet.",
    "got": "checkAndAlertRegression is invoked from exactly two places: src/app/api/cron/rescan/route.ts (after a real autoscan) and src/app/api/app/webhook/route.ts (a real GitHub push event). Neither is reachable in this dev fixture: cron/rescan short-circuits with {\"skipped\":\"GitHub App + database required.\"} even with a correct, freshly-set CRON_SECRET (confirmed live — health showed autoscan.githubApp:false throughout), and there is no live GitHub push webhook to simulate. No manual/UI re-scan path calls the regression detector (by design — alerts are tied to the scheduled/push path only). cron/digest and cron/purge WERE exercised live with a real CRON_SECRET (401 wrong secret, 503 no secret, 200 correct secret) but both correctly no-op on this fixture (digest: skippedNoSink:2, no org has a webhook sink configured; purge: orgsProcessed:0, retention is opt-in and unconfigured — both confirmed by-design in code, not silent failures).",
    "evidence": [
      "live: curl -H 'Authorization: Bearer <real-secret>' /api/cron/rescan -> {\"skipped\":\"GitHub App + database required.\"}",
      "live: /api/health -> autoscan:{ready:false, githubApp:false}",
      "src/app/api/cron/rescan/route.ts:39",
      "src/app/api/app/webhook/route.ts (push-event-only alert trigger)"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": "This is a fixture/environment gap, not a demonstrated product defect — the regression-alert, cooldown, and digest-reconciliation mechanics remain verified by code + unit tests only (carried from L1), never observed firing live end-to-end. uat/env.md does not currently document a path to stand up a GitHub App locally for this; that's the concrete fix that would unblock a future L2 pass on this specific priority."
  }
]
```

## 3. Adversarial verification notes

- **L2-RAJ-01** (gate/dashboard divergence): a skeptic's strongest refutation attempt would be "you just hit an unlucky race — the repo's real GitHub state actually changed between the persisted scan and your curl call." Checked: the persisted report page says "Scanned 16m ago" with confidence 59%, mock/deterministic engine; the live gate call happened seconds after, same session, same underlying repo content (no realistic 7-point real-world regression on `next.js` in 16 minutes). The code confirms a structural, deterministic cause (`noAmbientToken: true` on every public-gate call, cache-miss triggers a fresh token-less scan) independent of timing — this is not a race, it is designed behavior with an unintended trust consequence. **Kept as confirmed, major.**
- **L2-RAJ-02** (degraded distinction): could this have been a fluke of my artificially crushed timeout rather than a real "unavailable" state? No — I verified both directions: forced-unavailable → 503/degraded/exit 2, and restored → real 422 from `claude-cli` with 44s real latency and `model:"sonnet"` in the payload, so the harness demonstrably called out to the actual model, not a stub. **Kept as confirmed.**
- **L2-RAJ-05** (regression not reachable): a skeptic might say "you should have found another way to trigger it." I checked every code path that calls `checkAndAlertRegression` (grep across src) — there are exactly two, both gated behind infrastructure (GitHub App / real webhook) absent from this env by `/api/health`'s own admission. Downgraded from a "product finding" framing to an explicit environment/fixture gap in the `ceiling` field, per the trust rules on scope honesty.

## 4. Scored acceptance criteria — L2 (live) verdict

- [x] Fleet delivery posture in one place, reconciles with named repos — **confirmed live** (vercel org, fix-first + per-repo evidence agree).
- [x] Separates flow/stability from commit volume — **carried from L1, unchanged live** (commit-activity section still un-cross-linked to the DORA framing above it — L1-RAJ-01 stands, not re-tested pixel-for-pixel at L2 but nothing in the live render contradicts it).
- [~] Governance reflects real ruleset/required-check state, no green-by-default — **confirmed accurate on the Governance tab itself**, but **the same repo's verdict disagrees with the public gate endpoint** (L2-RAJ-01) — this is the headline finding.
- [~] Gate verdict specific/evidence-cited/archetype-aware, required-check-worthy — **the verdict CONTENT is evidence-cited and specific** (confirmed), but **which verdict you get depends on which surface you ask**, which undercuts "required-check-worthy" until reconciled.
- [ ] Regression alerts fire on real demotions only, audited, no re-spam — **not empirically reachable this session** (L2-RAJ-05); carried forward from L1 code-level confidence only.
- [~] Cron autoscans + retention/purge run unattended with a real baseline — **CRON_SECRET fail-closed gate fully confirmed live** (503/401/200); purge and digest confirmed live as correct no-ops; **rescan's actual scan execution + claim-before-work could not be observed** (GitHub App required).
- **Time-saved (live-adjusted):** the delivery+governance read itself genuinely collapses to a single-page, reconciling read in minutes — that part of the promise holds live. But Raj's stated bar is "would I wire the gate into required checks" — and L2-RAJ-01 is precisely the failure mode that would stop him: he tested the CI snippet the page told him to paste, and it disagreed with the page. That failure would burn the exact trust Raj said he needs before adopting, so I am **not** crediting the full designed time-saved figure — the delivery-read value (~2-3 hrs/quarter saved) holds; the gate/required-check value (the other ~1-2 hrs + the "continuous unattended regression detection" claim) does not clear his bar as-is.

## 5. Character voice — first-person reaction (live)

Okay. Half of what I read at L1 held up exactly as promised, live, no asterisks: the fix-first flag is real and reconciles per-repo, and the degraded-vs-failed distinction on the gate is the cleanest thing I tested all day — I forced the LLM dead myself, watched it fail closed to a 503 with an honest "not authoritative, retry" message, watched the CLI wrapper turn that into exit 2 instead of exit 1, then restored it and watched a real claude-cli call come back 44 seconds later with a real verdict. That's not a demo, that's a team that's been burned by exactly this before.

But I found the thing that would actually stop me from shipping this to my required-checks list, and it's the thing I was most worried about walking in: I copy-pasted the literal gate URL off the Governance page — the one it tells me is "the dashboard gate and your pipeline run[ning] the identical policy — no drift" — and curled it. Different level. Different score. An extra failing dimension my dashboard never showed me. Not because anything crashed, not because I mistyped anything — because the public gate endpoint can't see what my org's authenticated ingest scan saw, by design, for a real security reason I actually respect (don't leak private repos through my operator token). But the page doesn't say that. It says "no drift." I would have wired that gate into a required check today, watched it block a PR for a reason my own dashboard doesn't list, and spent an hour convinced Ascent was flaky before I found the actual cause. That's the SonarQube death spiral starting on day one, self-inflicted by the tool's own confidence.

I couldn't test the thing I care about most for ongoing trust — a real regression firing, once, into my Slack, with a matching audit row and a matching digest line — because this sandbox has no GitHub App wired up. I don't hold that against the product; I hold it against the fact that I still don't know if it works, live, and "I don't know" is not "I trust it." I did confirm the CRON_SECRET gate is properly fail-closed (503 unset, 401 wrong, 200 right) and that purge/digest no-op honestly instead of silently pretending to do work — that's the "no theater" bar cleared, at least for the plumbing I could reach.

Would I tell a peer? Same as L1, but sharper: "pilot it, but before you touch your required-checks list, reconcile the dashboard verdict against a raw curl on three repos you already know — because I just found a real repo where they don't agree, and it wasn't hard to find." Would I wire the alert into my Slack yet? I can't answer that — I never got to see it ring.

---
*Server state at end of session confirmed clean: `GET /api/health` → `{"status":"ok","db":"up","reconnected":false,"dbMode":"pglite","autoscan":{"ready":false,"cronSecret":false,"githubApp":false,"db":true}}` — matches the pre-session baseline.*
