# L1 report — Raj (DevOps / SRE Lead) × Delivery & governance health

cert_level: L1 (theoretical, code-grounded, no browser)

---

## 1. Surface model (with citations)

### Entry / reachability
- Org nav exposes **Delivery**, **Governance**, **Audit** tabs unconditionally in the fleet-org nav (`src/components/org/shared/OrgNav.tsx:85,115,117`).
- Auth: `ASCENT_AUTH_BYPASS=1` resolves every viewer as a synthetic "developer"; on a populated `/org/<slug>` under the bypass, `src/app/org/[slug]/layout.tsx` persists a real owner `Membership` (auto-seed on 2nd visit) — confirmed by `uat/env.md`. `hasOrgRole`/`requireOrgRole` (`src/lib/authz.ts:220-233`) resolve Raj as `owner`, so the owner-only **Gate Policy Editor** on `/governance` (`src/app/org/[slug]/governance/page.tsx:43-46,77`) is reachable, not just readable.
- **Reachable surface set for Raj**: `/org/[slug]/delivery`, `/org/[slug]/governance` (incl. policy editor), `/org/[slug]/audit`, the public `/api/gate/[owner]/[repo]` HTTP gate + `action.yml`/`scripts/maturity-gate.mjs` CI wrapper, the App-mode Check Run + sticky PR comment (`src/lib/scoring/gate-comment.ts`), the regression-alert path (`src/lib/scan-alerts.ts`, `src/lib/alerts.ts`), and the two cron routes (`src/app/api/cron/rescan/route.ts`, `src/app/api/cron/purge/route.ts`). All are un-gated beyond org-owner/public-CI level — nothing in his JTBD sits behind a plan tier or feature flag in this codebase.

### `/org/[slug]/delivery` — fleet delivery posture
- Server component fetches `getOrgPrSignals`, `getOrgGovernance`, `getOrgActivity` in parallel (`src/app/org/[slug]/delivery/page.tsx:30-38`), scoped by `resolveOrgScope` (segment/tech-stack filter, composable — `page.tsx:28`).
- **Fix-first punch list** (`DeliveryPriorities.tsx:28-89`): derives up to 4 evidence-cited actions — unprotected branches, zero-approval protected repos, low human-review coverage, **AI-involved-but-ungoverned PRs** (`pr.avgAiInvolvedRate >= 10 && pr.avgAiGovernedRate < REVIEW_TARGET`, `DeliveryPriorities.tsx:67-75`), slow merges. Each links to its evidence section (`href: "#governance"` / `"#per-repo"`).
- **PR signals band + per-repo drill-down** (`PrSignalsBand.tsx`, `PrRepoTable.tsx:1-94`): merge rate, human-reviewed rate, small-PR rate, **AI share vs AI-governed rate** side by side per repo, riskiest-first sort (lowest review coverage, then slowest merge — `org-signals.ts:79-83`). Weighted (analyzed-PR-count) fleet averages, not naive per-repo means (`org-signals.ts:85-119`), so a 500-PR flagship isn't drowned by toy repos.
- **Branch governance tiles + table** (`page.tsx:140-156`, `GovernanceTable.tsx`): protect-main / require-review / require-checks / signed-commit rates, sourced from `getOrgGovernance` reading each repo's latest scan's `governance` JSON (`org-signals.ts:147-201`); "require review" is defined as `requiredApprovals >= 1`, explicitly NOT merely "PR required" (`org-signals.ts:195-198` — a self-merge-without-approval repo isn't counted as reviewed).
- **Commit activity chart** (`page.tsx:158-175`, `DeliveryActivityChart.tsx`): a separate section, weekly real commit counts, explicitly labeled "(real, from GitHub)" — not fused into or presented as a maturity/velocity score.
- Empty-state branches correctly on the composed scope (segment OR stack), not `segmentId` alone (`page.tsx:70-78`), and money-attribution (AI ROI $ module) is deliberately withheld under a filtered scope rather than silently inflated (`page.tsx:44-51,90-98`) — a trust-preserving design choice on an adjacent module.

### `/org/[slug]/governance` — branch-protection / ruleset / required-check state
- Built by `buildGovernanceOverview` (`src/lib/org/governance.ts`) from `@/lib/scoring/gate` — the SAME policy evaluator the HTTP gate and Check Run use (`governance/page.tsx:6,28`), so the fleet view and the CI gate cannot silently diverge on what "passing" means.
- Tiles: gate pass rate, passing/failing counts, repos scanned (`page.tsx:59-64`).
- "Active policy" card is editable by an owner via `GatePolicyEditor` (`page.tsx:77`), read-only text for everyone else — persisted policy is read by `getOrgGatePolicy` and consumed by the HTTP gate too (`src/app/api/gate/[owner]/[repo]/route.ts:104-114`), so a policy Raj tunes in the UI is the same policy `curl --fail`/CI enforces (explicit precedence: query params > persisted org policy > archetype default).
- "Where the fleet fails" breaks down by condition (`REASONS` incl. the new "Unprotected default branch" reason, `page.tsx:16-24`) — a reason list, not a single opaque score.
- "Failing repos" and "Cheapest path to green" list per-repo reasons/dimension gaps with links into `/practices` to apply a fix (`page.tsx:102-201`); both explicitly reconcile the truncated list length against the headline total ("Showing worst N of M" — `page.tsx:128-139,193-199`) so the numbers don't silently disagree.
- "Enforce in CI" card renders the literal `GET .../api/gate/...` URL and the GitHub Action YAML snippet generated by the same policy (`page.tsx:203-221`, `ciActionYaml`).

### PR maturity gate (CI + Check Run/comment)
- Public HTTP gate: `GET /api/gate/[owner]/[repo]` (`src/app/api/gate/[owner]/[repo]/route.ts`) returns 200 pass / 422 fail / 503 on a **degraded (mock-fallback) grade** — a degraded scan can never present as a confident pass (`route.ts:117-138`), and `scripts/maturity-gate.mjs:51-60` turns a 503 into exit code 2 ("error", not "fail"), distinct from a real gate failure (exit 1) — matches Raj's "false block" fear directly.
- Policy resolution precedence is explicit and archetype-aware (`route.ts:104-114`); `?ref=<PR head sha>` scores what the PR changes, not the default branch (`route.ts:69-76`, `action.yml:28-29`).
- `action.yml` wraps this into a composable GitHub Action with `min-level`, `min-overall`, `min-dimension`, `min-security`, `no-ungoverned`, `require-protection` inputs (`action.yml:20-59`) — a real required-check candidate.
- Check Run + sticky comment: `buildGateComment` (`src/lib/scoring/gate-comment.ts:56-149`) cites: level/overall/posture/archetype, adoption vs rigor split, delta vs baseline, a **per-failing-dimension table with score → floor and the top gap text** (`gate-comment.ts:88-108`), top roadmap gaps framed as questions not orders, and explicitly flags when the verdict was **scored by the deterministic rubric (no LLM)** rather than a live grade (`gate-comment.ts:125-131`) — the exact "which check, which evidence" provenance Raj demands. LLM-derived text is escaped before reaching markdown so it can't break the sticky-comment marker or table (`gate-comment.ts:27-34`).

### Regression alerts (Slack-shaped, audit trail)
- Detector `detectRegression` (`src/lib/alerts.ts:72-121`) fires on 4 specific, named reasons — level demotion, slide into "ungoverned" posture, overall drop ≥5, or a single dimension drop ≥15 — thresholds set explicitly **above the measured scan-to-scan noise band (±2 overall / ±25 guardband per dimension)** so a re-scan of an unchanged repo cannot false-fire (`alerts.ts:40-43`).
- Per-repo **cooldown** (default 6h, `alerts.ts:131-166`) suppresses repeat alerts from a flapping score, claimed atomically before dispatch.
- `checkAndAlertRegression` (`src/lib/scan-alerts.ts:50-100`) is called from the autoscan cron (`src/app/api/cron/rescan/route.ts:141-144`) after every non-deduped persisted scan, diffs vs the prior persisted report, records a `scan.regression` audit entry (best-effort, non-blocking — `scan-alerts.ts:71-83`) BEFORE attempting Slack dispatch, so a regression is tracked even if the webhook POST fails.
- Message builder `buildRegressionMessage` (`alerts.ts:214-`) cites the specific reason lines plus up to 3 "why" movement attributions from the diff — not a bare red X.
- Weekly digest (`src/app/api/cron/digest/route.ts`) is the separate positive/periodic push; it is symmetrically noise-filtered (`isWithinNoise` applied to both gainers and regressers, `digest/route.ts:152-158`), gated behind an org-scoped `hasSignal` check so a flat week stays silent (`route.ts:143-163`, `alerts.ts:54-64`), and uses an atomic once-per-window claim (`claimOrgAuditOnce`) to prevent double-sends on an overlapping/retried cron run (`digest/route.ts:189-206`).

### Cron autoscans + retention/purge
- `/api/cron/rescan` (`src/app/api/cron/rescan/route.ts`): fail-closed `CRON_SECRET` gate (`requireCronAuth`), claim-before-work per repo (`claimRescan`, `route.ts:83-87`) to prevent double-scan/double-bill on overlapping runs, bounded concurrency (`mapPool`), explicit credit/token/broken-install short-circuits that still advance the schedule so a dead org doesn't jam the queue every run (`route.ts:89-125`).
- `/api/cron/purge` (`src/app/api/cron/purge/route.ts`): same fail-closed constant-time secret check (`purge/route.ts:17-26`), returns **207** (not 200) when the run degraded (errors or stopped-early on time budget) so an uptime monitor watching only HTTP status actually pages on a silently-under-purged run (`purge/route.ts:49-69`).
- Both are unauthenticated-by-Bearer-only (no `?key=` query-string secret, avoiding log/Referer leakage — `rescan` mirrors `purge`'s `secretMatches`).

---

## 2. In-character walkthrough (thought experiment over the model)

I open `/org/[slug]/delivery`. First thing on the page, above the averages, is a fix-first list: "Protect 3 default branches," "Require an approving review on 2 protected repos," each naming the actual repos and why it matters ("anyone with push access can commit straight to main"). That's not a vibe, that's a stack trace. Good start — this is the kind of list I'd otherwise build by hand from forty settings tabs.

Scroll to PR signals: merge rate, human-review coverage, AI share, and — critically — AI-governed rate sit in the same row per repo, riskiest-first. That's the DORA 2024 tension made concrete: I can see the repo that's 40% AI-involved but only 10% of those get reviewed, without squinting at two separate dashboards. The punch list already flagged it as "Put AI-assisted PRs under human review" with the exact percentages. That's the single finding I came here hunting for.

Governance tiles below: protect-main, require-review (correctly defined as ≥1 required approval, not just "PR required" — I've been burned by that distinction before), require-checks, signed-commits. Per-repo table is unprotected-first. This reconciles with what I expect — the loud team's repo should show up near the top if it's actually slipped.

Commit activity chart is its own section, clearly labeled "(real, from GitHub)," not folded into a score. Good — commit count isn't dressed as velocity here.

Now `/governance`. Gate pass rate, a reason breakdown (below required level / dimension floor / ungoverned / below overall / unprotected branch), failing repos with per-repo reasons, and — this is the part that actually matters for whether I adopt it — the literal `GET .../api/gate/...` URL and GitHub Action YAML sitting right there, generated from the SAME policy object the dashboard evaluated. I can paste that into a workflow today. The policy editor lets me tune the bar once and have it apply everywhere the code confirms (dashboard + `/api/gate` + Check Run) — that's the single-source-of-truth I need before I'll trust a merge-blocking check.

I poke at the sticky PR comment path in my head: it says which dimension missed its floor, the score vs the floor, the top gap text, AND explicitly flags "scored by the deterministic rubric (no LLM)" when it fell back — so I can tell a real AI-graded block from a fallback floor block. That degraded-vs-failed distinction (503→exit 2 "error" vs 422→exit 1 "fail") is exactly the false-block failure mode I've been burned by with SonarQube gates — Ascent's CI wrapper treats them differently on purpose.

Regression alerts: the thresholds sit deliberately above the measured noise band, there's a per-repo cooldown so a flapping score doesn't spam Slack, and a `scan.regression` audit row is written even when the webhook is unset or the dispatch fails — so I have proof either way. The digest — the periodic positive push — is symmetrically noise-filtered and silent on a flat week, and idempotent against a retried cron run. I don't see a leaderboard, I don't see per-developer surveillance — consistent with what I actually asked for.

Cron: rescan claims a repo before doing billable work (no double-scan race), purge returns 207 (not 200) on a degraded run so my uptime monitor actually pages me. That's the "regression detection has a real baseline to diff against, without me babysitting it" bar, on paper.

Where I'd stay skeptical until I see it live: every one of these mechanisms is a well-reasoned *design*. I haven't watched a real fleet's numbers move, haven't watched a real Check Run render on a real PR, haven't seen whether the "riskiest first" sort actually surfaces the repo I already know is bad, and haven't confirmed the digest's "movement gate" doesn't quietly suppress a regression I'd have wanted to see. That's L2's job. On the page/code, though, nothing here reads as green-by-default or hand-wavy — every tile traces to a concrete signal, and the two places that could have silently inflated numbers (allocated AI-$ under a filter, truncated failing-repo lists) instead explicitly say so rather than fake a total.

## 3. Scored acceptance criteria — L1 (designed-experience) verdict

- [x] Fleet delivery posture in one place, minutes not a day — **plausible**, single page, parallel-fetched, evidence-linked punch list up front.
- [x] Separates flow/stability from commit volume — **plausible**, AI-involved vs AI-governed per repo is exactly the DORA tension surfaced with numbers, not folded into a vanity commit count.
- [x] Governance reflects real ruleset/required-check state, no green-by-default, drill-to-able evidence — **plausible**, same `@/lib/scoring/gate` policy object drives dashboard + API + Check Run; reason breakdown + per-repo failures + reconciled truncation counts.
- [x] Gate verdict specific/evidence-cited/archetype-aware, required-check-worthy — **plausible**, per-dimension score→floor table, archetype label, degraded-vs-failed distinction, `?ref=` for PR-head scoring.
- [x] Regression alerts fire on real demotions only, Slack-shaped, audited, no false-alarm/no re-spam — **plausible**, thresholds above measured noise band, cooldown, audit-before-dispatch.
- [x] Cron autoscans + retention/purge run unattended with a real baseline — **plausible**, claim-before-work, fail-closed secret, degraded-run 207.
- **Time-saved (designed):** if all of the above holds live, this collapses Raj's ~1 day of by-hand fleet auditing to a single-page read in minutes, plus continuous unattended regression detection between quarterly audits — matching his stated Motivation almost exactly. Estimated **~4 hours saved per quarterly review cycle** (conservative: a day of tab-juggling → ~15-30 min of review), **plus** ongoing drift-catching value the by-hand method structurally can't provide (unquantifiable but real per his JTBD #2).
- **Senior-quality bar (designed):** the artifacts read like something a staff platform engineer would ship — evidence-cited, threshold math that shows its reasoning (why 5/±2, why 15/±25), explicit handling of the two failure modes he fears most (false block, false page). Nothing here reads as generic or hand-wavy at the design level.

## 4. Findings (L1)

```json
[
  {
    "id": "L1-RAJ-01",
    "journey": "delivery-and-governance-health",
    "character": "raj-devops-sre",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Commit-activity chart has no explicit 'not velocity' framing next to the DORA-tension callout",
    "expected": "Given Raj's pet peeve ('commit count dressed as velocity'), the commit-activity section would carry an explicit disclaimer or cross-link to the AI-involved-vs-governed split so a scanning reader doesn't misread weekly commit volume as a maturity signal on its own.",
    "got": "The section is honestly labeled '(real, from GitHub)' and kept separate from the PR/governance sections (src/app/org/[slug]/delivery/page.tsx:158-175), but there is no inline text tying it back to the throughput-vs-stability framing the way DeliveryPriorities does for AI-governed rate.",
    "evidence": ["src/app/org/[slug]/delivery/page.tsx:158-175", "src/components/org/delivery/DeliveryActivityChart.tsx"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm in a live render whether a reader's eye naturally connects the commit-activity chart to the PR-signals DORA tension above it, or whether they read it as a standalone activity/velocity gauge."
  },
  {
    "id": "L1-RAJ-02",
    "journey": "delivery-and-governance-health",
    "character": "raj-devops-sre",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "med", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "Digest 'movement gate' could theoretically suppress a real-but-small regression from Raj's view if no other signal moved that week",
    "expected": "Raj wants to be 'paged/digested about it before an engineering lead or an incident finds it' for ANY real demotion.",
    "got": "digestHasSignal (src/lib/alerts.ts:54-64) fires on any regressions>0 beyond noise, so a real regression itself always triggers the digest — this is not a gap in the digest gate. The residual risk is narrower: the per-repo Slack alert (the immediate channel) is fully covered by checkAndAlertRegression on every autoscan; the digest is a secondary weekly rollup. No live gap identified beyond needing L2 confirmation that a single flagged regression actually renders in the digest's 'Regressions:' list end to end.",
    "evidence": ["src/lib/alerts.ts:54-64,152-163", "src/app/api/cron/digest/route.ts:143-163"],
    "code_check": "by-design",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Trigger a real regression on a seeded repo, run both cron/rescan (immediate alert) and cron/digest, and confirm the regression appears in both channels with matching reasons."
  },
  {
    "id": "L1-RAJ-03",
    "journey": "delivery-and-governance-health",
    "character": "raj-devops-sre",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "No visible surface for regression-alert or digest DELIVERY failure history (webhook down, sink unresolvable) outside raw audit rows",
    "expected": "Raj's pet peeve list includes 'Cron/retention that silently fails ... is theater.' He'd expect a dashboard-visible indicator (not just an audit-log row he has to search for) when his Slack webhook itself has been failing to receive alerts (e.g. `dispatched: false` outcomes from checkAndAlertRegression, or digest `failed` counts).",
    "got": "The signal exists in the code (RegressionOutcome.dispatched, digest route's `failed`/`errors` fields — src/lib/scan-alerts.ts:26-31, src/app/api/cron/digest/route.ts:212) and lands in the audit trail as a scan.regression entry, but there is no surfaced UI tile/banner on /governance or /delivery aggregating 'N alerts failed to deliver in the last 7 days.' He'd have to know to check the audit log filtered by action, or watch raw cron JSON responses.",
    "evidence": ["src/lib/scan-alerts.ts:26-31,85-99", "src/app/api/cron/digest/route.ts:99-213", "src/app/org/[slug]/audit/page.tsx:1-39"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Force a webhook-down scenario live and check whether the audit trail viewer surfaces it discoverably (search/filter by action) versus requiring Raj to know the exact action string."
  }
]
```

No blockers or majors identified at L1 — every scored criterion traces to concrete, evidence-linked code with the failure modes Raj fears (false block, false page, green-by-default, alert spam) explicitly designed against. The three findings above are minor/polish-adjacent gaps in a structurally sound design, all L2-eligible.

## 5. Character voice — first-person reaction

Okay. This is the first time in a while a "governance dashboard" hasn't made me reach for the audit log to double-check it. The fix-first list at the top of Delivery is the kind of thing I'd have made a junior write by hand — it names the repo, it names why, it links to the proof. Fine.

What actually earns points with me: the Governance tab's CI snippet and the fleet dashboard evaluate the SAME policy object. I've had exactly one previous tool where the dashboard said "passing" and the pipeline gate disagreed, and I never trusted either surface again. If the code really shares `@/lib/scoring/gate` between `/api/gate`, the Check Run, and this page — and it looks like it does, `getOrgGatePolicy` feeding all three — that's the single biggest trust unlock in this whole review.

The degraded-vs-failed split on the gate (503/exit 2 vs 422/exit 1) tells me somebody on this team has actually shipped a quality gate before and gotten burned the same way I have. A fallback floor score masquerading as a real pass is exactly how my last SonarQube rollout died. Good.

The regression thresholds sitting explicitly above the measured noise band, with the noise band itself documented (±2 overall, ±25 per dimension) — that's not marketing copy, that's someone who ran the model twice on the same commit and wrote down what jittered. I'd want to see it hold on a real fleet before I wire it into Slack, but on paper this is the first regression detector I've read that didn't just say "we alert on drops" and leave the threshold as a TODO.

What's still missing for MY job: I want a single "alert health" surface — did my Slack webhook actually receive the last 10 pings, or has it been silently 404ing for two weeks and I only found out because a real incident forced me to check. Right now that's buried in audit-log rows I'd have to know to filter for. And I want the commit-activity chart to say out loud what the fix-first list already implies — that a busy repo with an unreviewed AI-PR problem is not a healthy repo, full stop, not two separate reads I have to reconcile myself.

Would I tell a peer? Cautiously yes — "worth a real pilot on one org, watch it for a sprint before you touch your required-checks list." Would I paste it in front of my VP yet? Not until L2 proves the live numbers reconcile with a repo I already know the truth about. But this is the first version of this pitch I've read that didn't feel like a green checkmark factory.
