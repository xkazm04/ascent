# Run brief — 2026-08-30-moonshot-cert (L1 phase)

**Commission:** certify the moonshot programme's shipped-unverified items (waves 1–4, all landed on
master `fca0c742` today) through the standing roster, and pay the owed journeys (Dana M1 — the
briefing PDF changed; Sam; Tomáš). Registry: declared, mapped (`.ai/registry-map.json`).

**Selection (7 pairs):**
| # | Character | Journey | Moonshot surfaces in scope (spec refs under docs/specs/moonshot/) |
|---|---|---|---|
| 1 | dana-vp-engineering | prove-and-track-fleet-maturity | #26 briefing "Local loop" proof line + ImprovementEvent union; #32 compaction basis in forecast; #1 digest Controls block; M1 standing rule |
| 2 | sam-staff-engineer | scan-my-repo-get-a-roadmap | #9 expectedLift + ?sort=measured; #34 exemplar diff on /report/compare; #15 D1 coherence (rubric r11); master's B4/B6 partial ships |
| 3 | tomas-prospective-buyer | evaluate-whether-to-adopt | public funnel; r11 D1 changes the public report; B2/B8 recert (shipped earlier, unverified) |
| 4 | nadia-appsec-lead | supply-chain-and-governance-posture | #1 control ledger + /api/org/controls + /api/audit/verify + as-of-merge conformance pack; #8 admission compiler + Governance Perimeter; #16 controls matrix |
| 5 | priya-platform-lead | set-and-enforce-the-standard | #13 manifest-as-scan-input + capability matrix; #16 doctor check-id ledger; #35 foundation rollout + secrets provisioning; #15 guidance projections (maintain project / doctor drift) |
| 6 | victor-finops-director | repeated-org-scans-worth-the-price | #11 unified meter byLane/byTeam + showback; #10 two-speed freshness + queue (no more truncated 'Continue') |
| 7 | priya-platform-lead | loop-to-l5 | #27 price list + model per lane; #25 lane brief + report verdicts + lessons inbox; #26 PR-from-lane + one ledger; #3 remote-agent lanes + MCP work tools |

**Recurrence leads — ALL are HYPOTHESES; verify independently, and contradict the brief if the code
says otherwise.** From the 2026-08-10 drain (BACKLOG B-items) still or partly open:
- Dana: DANA-L1-001/002 (forecast hedge/nulling; B9 open), 010/011/012 (B3 shipped-unverified — re-certify), 003 (B1 shipped-unverified).
- Sam: SAM-L1-01 (B4 "partly shipped" on master — path-triggered signals cite files now?), SAM-L1-02
  (B6 partly shipped: `scoreIntegrityJson` + chip exist; the provenance track's fixed ±band claimed
  still open), SAM-L1-04 (B5 permalink open), 05, 06.
- Tomáš: B2 (public scan un-walled) + B8 (quota promise) both shipped-unverified; TOMAS-L1-03 ETA copy (B10 open?).
If a lead is already fixed, say so — that is a `resolved-verified`-candidate row for L2 to confirm, not a finding.

**Standing rules for this run:** shared denominators/units come from the overlay (rubric/env), never
per-walker; wiring audit (`grep -rn <field> <ui-dir>` = 0 hits is a finding by construction) —
the moonshot merged 30+ lanes, which is exactly the refactor-shape that produces
present-but-unwired; enumerate every branch of shared mappings; compute the Character's reachable
surface set BEFORE judging (self-hosted vs cloud gates, plan tiers, `selfHosted()` behaviours);
`l2_priority` must declare its environment precondition (note: the loop/drive/work-protocol surfaces
are SELF-HOSTED-gated — `ASCENT_AUTOPILOT`, `selfHosted()`; the MCP work tools need an org API token
with `followups:write`).
