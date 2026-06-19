---
character: Nadia (AppSec Lead)
goal: "Show me, across the whole fleet, where our supply-chain and governance risk actually sits — open Dependabot alerts, what branch protection and review are truly enforced, and a clean audit trail — that I'd put in front of a SOC 2 auditor without hand-walking every repo."
promotion: discovery
seed: ASCENT_AUTH_BYPASS=1 + a seeded org (npm run db:local:seed); SUPPLY_CHAIN_PROVIDER=mock for demo Dependabot data. See uat/env.md
references:
  - https://www.konfirmity.com/blog/soc-2-secure-sdlc — SOC 2 secure-SDLC + change-management: CC6.1/CC8.1 require code changes be reviewed/approved before deploy, branch-protection + required-reviewer rules consistent across all repos, and timestamped attributable evidence (PR history, audit log) — "a policy existing isn't enough; show it's enforced and backed by evidence." Sets the definition-of-done and the audit-grade bar.
  - https://github.com/ossf/scorecard/blob/main/docs/checks.md — OpenSSF Scorecard's per-repo checks (Branch-Protection, Code-Review, Dependency-Update-Tool, Vulnerabilities). Sets that posture is a per-repo bundle of governance + dependency hygiene, so a fleet read must reconcile to named repos.
  - https://snyk.io/articles/slopsquatting-mitigation-strategies/ — slopsquatting / AI-code risk: ~20% of AI-suggested packages don't exist and AI code carries more IDOR/insecure-deserialization flaws. Sets why open advisory counts are live, daily-moving facts that must stay a SEPARATE signal from the deterministic D9 score — not fused into it.
---

## Trigger (why now)
The SOC 2 Type II evidence window is open and the auditor has asked Nadia to demonstrate that code-review and branch-protection controls are *enforced consistently across all production repos*, and to show the change history. Separately, the CISO has been forwarding her slopsquatting / insecure-AI-code articles and wants to know whether the fleet's dependency and guardrail risk is rising now that everyone codes with Copilot and Cursor. Her usual move — hand-walking dozens of repos in the GitHub UI for branch-protection settings, CODEOWNERS, and open Dependabot alerts, then collating a spreadsheet plus screenshots — would eat days, be stale on export, and isn't repeatable. The org is already scanned in Ascent and she wants to know if she can leave with a defensible, exportable posture today.

## Definition of done (their POV)
- She has a **fleet-wide supply-chain + governance posture in minutes**: average Security (D9), branch-protection rate, repos-at-risk, and open Dependabot advisory totals by severity, with the **named weakest and unprotected repos** — no hand-walking the GitHub UI.
- She is certain the **Dependabot advisory signal is SEPARATE from the D9 maturity score** (live facts shown alongside the deterministic rubric, not baked into it), and any demo/mock data is **labelled as demo** — so nothing she attests to is conflated or fabricated.
- She can show **enforcement, not existence**: governance coverage for protected branch / requires-review / requires-checks / signed-commits, with the falling-short repos named — defensible against SOC 2 CC6.1/CC8.1.
- She can produce an **audit-grade trail**: who did what and when, filterable by action/actor/date, paginated, and **exported to CSV** for the evidence binder.
- She is confident enough to **put the security/governance read and the audit export in front of the auditor as-is**, and to re-pull it next cycle.

## Out of scope
- Deep SAST / static analysis of source for vulnerable patterns (Ascent surfaces Dependabot advisory *counts* and the deterministic D9 dimension; it does not run a code-level SAST pass). If a per-line vulnerability scan isn't built, that's out of scope here, not a defect.
- Secret-scanning / credential-leak detection across the repos (not a built signal — out of scope, not a missing feature).
- SBOM generation / SLSA provenance attestation (recognized norms she knows, but not surfaces Ascent claims to provide).
- Going *live* against the real GitHub Dependabot API (needs the GitHub App "Dependabot alerts: read"); this journey uses `SUPPLY_CHAIN_PROVIDER=mock` demo data and only judges that demo data is honestly labelled.
- Changing or tuning the D9 scoring rubric itself, or remediating the repos (she's assembling evidence and reading posture, not fixing code or editing the gate policy).
- Per-developer security ranking / surveillance — she wants per-repo and fleet posture, not a leaderboard.

## Discovery hints
Entry point(s): /org/[slug]/security, /org/[slug]/governance, /org/[slug]/audit. Do NOT script the steps — getting lost is itself a finding. She may also drill into a repo's D9 "Supply Chain & Security" dimension evidence from a report. Watch especially whether she can (a) read the fleet supply-chain + governance posture in minutes and drill to named weakest/unprotected repos, (b) tell that the Dependabot advisory signal is SEPARATE from the D9 score and that demo data is labelled — without guessing, (c) distinguish *enforced* governance from merely *configured* (required review/checks, named gaps), and (d) export an attributable, timestamped, filterable audit trail she could hand an auditor.

## Frozen happy path  (filled in only on `promote`)
