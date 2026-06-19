---
character: Mei (OSS Maintainer)
goal: "Scan my own public repo for free, no signup, get a maturity score I'd actually trust, and grab a README badge I can paste in front of thousands of devs."
promotion: discovery
seed: no auth/DB — a public repo scan + the /badge generator. See uat/env.md
references:
  - https://github.com/ossf/scorecard/blob/main/README.md — OpenSSF Scorecard badge: one paste-ready, auto-updating Markdown badge that links to detailed results, readable with no signup. Sets the definition-of-done for what a good README maturity badge looks like.
  - https://leaddev.com/software-quality/open-source-has-a-big-ai-slop-problem — AI-slop deluge (curl ~5% genuine, RubyGems 15 min → a full day, tldraw closed contributions). Sets the bar that the score must be credible/specific or it's worse than no badge, and motivates the PR maturity gate.
  - https://byteiota.com/open-source-maintainer-crisis-60-unpaid-burnout-hits-44/ — Maintainer crisis (~60% unpaid, 44% burnout). Sets the no-account / no-paywall trigger: a personal OSS project won't pay or sign in for a badge.
---

## Trigger (why now)
Mei's README is a wall of hand-curated badges and her issue/PR queue is filling with AI-generated, test-less PRs she has to triage on her own time. She wants a single, honest signal of how AI-native and healthy her project actually is — something she can paste in the README like her OpenSSF Scorecard badge, and maybe enforce on incoming PRs. She has maybe ninety minutes tonight. She heard Ascent does a free public scan with no signup and emits a Shields-style badge, and she's testing whether that's real or just another funnel.

## Definition of done (their POV)
- She scanned her own public repo **without ever creating an account, signing in, or paying**, and read the full report.
- The maturity read **reconciles** with what she knows about her repo and **each dimension cites evidence she can click into** — credible enough to vouch for publicly.
- She copied a **Shields-style badge** (level or pass/fail gate mode) with **paste-ready Markdown** (and HTML/AsciiDoc available) that links back to the report, and is confident enough to put it in her README.
- She knows how to wire up the **published GitHub Action PR maturity gate** (or at least clearly where to get it), so AI-slop PRs hit a bar before they hit her.

## Out of scope
- Any authed/org feature: history/trends across scans, private repos, org rollups, persistent badge hosting, dashboards under `/org/[slug]` — if those need auth/DB, that's the boundary she won't cross for a personal OSS project (note it; don't flag the public path as broken for lacking them).
- Buying credits, pricing/billing, seat management — she will not transact for a personal OSS repo.
- Comparing two scans / deep trend analysis (a returning-user journey, not this first credible-badge run).
- Actually merging/blocking real PRs in a live repo — evaluating that the gate is installable and credible is enough here.

## Discovery hints
Entry point(s): / (scan her repo) → /report → /badge. Do NOT script the steps — getting lost is itself a finding.
Watch especially whether she can (a) reach a full report from `/` with **no signup/login/email/payment of any kind**, (b) trust the score — does it reconcile with her repo and cite clickable evidence, (c) get from the report to `/badge` and copy a **clean, paste-ready Markdown badge** in level and pass/fail gate modes that links back to evidence, and (d) find the published **GitHub Action PR maturity gate** and understand how to install it. Any point where a public feature is gated behind auth that didn't need to be, or the score is generic/unsourced, or the badge Markdown won't paste cleanly, is a finding.

## Frozen happy path  (filled in only on `promote`)
