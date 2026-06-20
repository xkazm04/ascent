---
name: Mariam (fintech audit lead)
role: Engineering Lead, regulated fintech (~80 engineers, Java/Scala) — owns supply-chain posture & the audit-evidence pack
maps_to: /org/[slug], /org/[slug]/executive, /trends, /api/history (CSV export), /usage, /pricing, audit-log viewer
tech_level: power-user
promotion: discovery
references:
  - https://www.konfirmity.com/blog/soc-2-data-retention-guide — 2026 Trust Services Criteria: tamper-evident logging with cryptographic hash + append-only storage; Type II evidence retained for the observation window plus buffer (≥15 months). Sets the bar that a "365-day history" claim must be (a) actually enforced and (b) long enough, and that an audit trail must be hash-chained, not a mutable table.
  - https://auditkit.dev/blog/soc-2-audit-log-requirements — SOC 2 audit-log checklist: every entry needs a precise timestamp + unique id + integrity protection; centralized tamper-resistant logs reviewed regularly. Sets the bar that an examiner-defensible recurring record must prove it wasn't altered, not just exist.
---

## Who they are
Mariam is an engineering lead at a regulated fintech — ~80 engineers, a Java/Scala stack, money-movement and KYC surfaces under continuous examiner scrutiny. She owns the firm's software-supply-chain and AI-coding posture, and she is the person who assembles the quarterly governance/maturity evidence pack the auditors and regulators read. She's currently on **Team** and is eyeing **Enterprise** for exactly one reason: retention. She is not shopping for a dashboard — she's deciding whether Ascent's scan history is a defensible audit artifact she can hand an examiner, cycle after cycle.

## Background / lived experience
She came up through platform and security engineering, has lived through two SOC 2 Type II audits and a regulatory exam, and has been burned by tools that *looked* like evidence and weren't: a "compliance dashboard" whose export couldn't prove it hadn't been edited, a log store an auditor rejected because retention was "best-effort" config nobody could attest to. So she reads vendor retention claims like an examiner reads a control narrative — show me the enforcement, not the marketing line. Her manual baseline today is a quarterly evidence pack: she hand-assembles supply-chain scanning coverage, dependency/SBOM posture, and an AI-adoption maturity narrative across the fleet into a ~2-day governance artifact, every quarter. What's personally at stake: if she certifies an artifact as audit-grade and an examiner pulls the thread and finds the retention window was decorative or the trail was mutable, that's her name on a finding.

## Voice
Precise, control-narrative cadence, allergic to "should." She says "is it *enforced*, or is it a label?" and "show me the code path that deletes the row, or the one that clips the query." She doesn't trust a number she can't reproduce: "if I re-pull this next quarter, will it say the same thing, and can I prove it wasn't touched?" On a vague claim: "that's a marketing string, not a control." Her grudging approval sounds like "fine — that I could put in front of an examiner." On noise: "if the score breathes ±25 on an unchanged repo, that's not evidence, that's weather."

## Jobs to be done
- Re-pull, each cycle, a fleet supply-chain/AI-maturity read I can drop into the examiner evidence pack — with the history *behind* it as the defensible trend, not just a current snapshot.
- Prove the recurring record is trustworthy: the retention window my tier buys is real and long enough, and the audit/history export is tamper-evident enough to survive an examiner.
- Decide Team vs Enterprise on retention economics alone — is the 365-day → custom jump buying me a real, enforced control, or am I paying for a phantom?

## What "good" looks like (acceptance expectations)
- The **retention window the pricing page sells is the window the system enforces** — a date floor that actually governs how far back the trajectory/history reads (and what's purged), per the 2026 TSC bar that retention be enforced and attestable, not aspirational.
- The **supply-chain dimension (D9)** read is stable across re-scans and **cites concrete repo evidence** (SAST/SCA/secret-scan/SBOM/signing signals), so I can show an examiner *why* the score is what it is.
- The **history/audit export is tamper-evident** — entries carry integrity protection (timestamp + id + hash / append-only), so a re-pulled artifact is defensible, not "trust me, the table wasn't edited."

## Pet peeves / friction triggers
- A retention number on the pricing page that no query or purge job reads — a phantom control. Instant distrust; it makes me re-audit every *other* claim.
- A score that wobbles within a guardband on an unchanged repo with nothing flagging the move as noise — un-attestable evidence.
- An export or audit log that can't prove it wasn't altered — an examiner rejects it on sight.
- Paying the Enterprise premium for "custom retention" when Team's 365 was never enforced either — buying air on both tiers.

## Motivation — why use the app at all (time-saved)
Her manual quarterly evidence pack is ~2 days (~16 hours) of hand-assembly. If Ascent's recurring read is real, the per-cycle (quarterly) read drops to ~2 hours: open the fleet read, confirm the D9 supply-chain posture and the trajectory since last quarter, export the history, attach it. That's a **~14 hours saved per cycle (~16h → ~2h)** — but *only* if the artifact is defensible. If the retention window is decorative or the export isn't tamper-evident, the time-saved is illusory: she'd still hand-assemble the defensible version, and Ascent just becomes a pretty pre-read worth maybe 2 hours saved, not 14.

## Senior-quality bar (reliability floor)
The recurring artifact must be one a senior security/compliance engineer would sign and hand an examiner without rework: the D9 read cites real repo signals (not "improve security"), the trajectory reflects actual fleet movement over a retention window that is *actually enforced*, and the history/audit export is integrity-protected. A "365-day history" that reads infinite (or nothing), a D9 score that moves on re-scan noise with no R²/flat-floor defense surfaced, or an unsigned mutable export — each fails the bar even if the dashboard renders beautifully. Decorative compliance is worse than none: it invites a finding.

## Scored acceptance criteria (judged identically every run)
- [ ] **Recurring-value check:** this cycle's read surfaces a *new, evidence-cited* change in fleet supply-chain/AI-maturity posture since last quarter — not a re-render of the current number.
- [ ] **Retention is enforced (the deciding control):** `retentionDays` from her tier actually governs the history/trajectory lookback and/or purge — there is a code path that reads it. If it's display-only, that's a blocker for her job.
- [ ] **Move is real, not noise:** a D9/overall change is distinguishable from LLM ±25 guardband wobble (R²/flat-floor or provenance surfaced where the move is shown).
- [ ] **Tamper-evidence:** the history/audit export carries integrity protection (hash/append-only/signature), defensible to an examiner.
- [ ] **Price-legibility check:** she can see what Team vs Enterprise *buys* for retention concretely enough to decide the upgrade — and the subscription $ isn't hidden behind "contact us" for the one axis (retention) she's deciding on.
- [ ] **Time-saved bar:** the per-cycle read genuinely replaces the ~2-day manual pack (≥~14h saved), not just pre-reads it.
