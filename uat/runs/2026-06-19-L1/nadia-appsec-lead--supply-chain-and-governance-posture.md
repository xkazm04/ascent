# L1 — Nadia (AppSec Lead) × supply-chain-and-governance-posture

**Verdict: L1-pass** — the three surfaces she needs are structurally sound and the load-bearing claim (Dependabot advisories are a *separate* signal, not folded into D9) is architecturally enforced and legibly labelled. No blockers, no majors. Findings are minor/polish + a clutch of strengths.

---

## Reachable surface set

Seed: `ASCENT_AUTH_BYPASS=1` + seeded org (`npm run db:local:seed`) + `SUPPLY_CHAIN_PROVIDER=mock`.

| Route | Reachable? | Gating chain followed |
|---|---|---|
| `/org/[slug]/security` | yes | `org/[slug]/layout.tsx:52,61,78` → `canReadOrg` (authz.ts:62). Under bypass, Supabase unconfigured ⇒ `authGateEnabled()=false` (access.ts:44-45); custom OAuth dormant ⇒ `isAuthConfigured()=false`; so `canReadOrg` returns `openOrgDashboardsEnabled()` (authz.ts:68,105) — gated on a **second** flag `ASCENT_OPEN_ORG_DASHBOARDS=1` (uat/env.md:33). |
| `/org/[slug]/governance` | yes | same layout gate; owner-edit of the gate policy gated by `hasOrgRole(slug,"owner")` (governance/page.tsx:45) — read-only policy shown to everyone. Under bypass the seeded "developer" is persisted as owner (layout.tsx:142-144), so she also sees the `GatePolicyEditor` — out of scope (she's reading, not tuning). |
| `/org/[slug]/audit` | yes | layout gate; `/api/audit` re-gates with `requireOrgRead` (audit/route.ts:88 → authz.ts:79) — same `openOrgDashboardsEnabled()` resolution, so CSV/JSON export is reachable under the seed. |
| Nav discoverability | yes | `OrgNav.tsx:25-41` — **Security** under "Intelligence", **Governance** + **Audit** under "Govern". All three are first-class left-rail tabs; she won't get lost finding them. |
| Repo-level D9 evidence | reachable but not exercised here | report `DimensionCard` for D9; this journey stays at the org/fleet level. |

**Reachability nuance (carry to L2):** page + export reads need `ASCENT_OPEN_ORG_DASHBOARDS=1` in addition to `ASCENT_AUTH_BYPASS=1`. The journey seed line (journey:5) names only the bypass; `uat/env.md:32-33` documents both. The org-e2e/seed workflow sets it, so I treat the surfaces as reachable, but if a run sets only the bypass, every org tab degrades to the calm `OrgEmpty "No access"` state (layout.tsx:78-87) — a page-renders-empty failure, not a crash. L2 must confirm the run env carries both flags.

---

## Surface model notes (affordance → backing file:line)

**Grounding audit — the separation claim (her #1 trust gate):**
- D9 "Supply Chain & Security" is a **deterministic file-presence detector** (`analyze/index.ts:552-603`): it scores configured tooling-as-code — SAST (CodeQL/Semgrep), SCA (`dependabot.yml`/Renovate/Snyk presence), secret-scanning, SBOM, signing, SECURITY.md, threat-model docs. It scores **whether the guardrail is configured**, never a live count.
- The Dependabot **advisory counts** come from a wholly separate runtime fetch: `getOrgSupplyChain` (`security/supply-chain.ts:112`), behind a provider abstraction (`github` / `mock` / `off`, selected by `SUPPLY_CHAIN_PROVIDER`, lines 92-101). **`getOrgSupplyChain` is imported only by `security/page.tsx:6` and the markdown brief** — it is never referenced by `scoring/engine.ts`, `scoring/prompt.ts`, or `analyze/index.ts` (grep-confirmed). The live advisory count is *physically incapable* of moving the D9 score in this codebase.
- The model file even documents the firewall in prose: D6 explicitly says supply-chain security "is scored separately under D9" (`maturity/model.ts:125`), and the D9 detector header says "shift-left security as code" (`analyze/index.ts:552`). Architecture matches the claim.

**Security tab (`security/page.tsx`):**
- Fleet tiles: Avg Security (D9), Branch protection %, Repos at risk (critical+weak, D9<60), Repos scanned (lines 59-73) — fed by `buildSecurityOverview` (`org/security.ts:34`) over the rollup D9 averages + `getOrgGovernance`.
- Supply-chain card is **conditional + labelled**: `{supply && supply.scanned > 0 && …}` (line 120) renders "Open Dependabot advisories across N repos." and, when `supply.demo`, appends **"Demo data — set SUPPLY_CHAIN_PROVIDER=github for live alerts."** (line 125). Per-severity chips (lines 127-132) + worst-first per-repo list (lines 133-145). `demo` flag set by `provider.name === "mock"` (supply-chain.ts:145). Mock data is deterministic-hashed (lines 82-90).
- Weakest-on-security + Governance-coverage cards (lines 150-196): named weakest repos with D9 meter + a `⚠` unprotected marker (line 162); governance rows for Protected branch / Requires review / Requires status checks / Requires signed commits (lines 175-180); a "No branch protection" chip list naming the unprotected repos (lines 181-191).

**Governance tab (`governance/page.tsx` → `org/governance.ts`):**
- Pass-rate / passing / failing / scanned tiles (lines 60-65). Active policy text (lines 68-79). "Where the fleet fails" by reason — level / dimension / posture / overall, deduped per repo (lines 81-100). "Failing repos" worst-first naming each missed condition (lines 103-129). "Cheapest path to green" with per-dimension gaps + deep-links to the matching practice (lines 131-183). "Enforce in CI" — gate URL + Action snippet running the *identical* policy (lines 185-203).
- The fleet rates trace to **real persisted GitHub governance**: `getOrgGovernance` (`org-signals.ts:88`) reads each repo's latest-scan `governance` JSON, which is written from `fetchBranchGovernance` (`github/governance.ts:47`) — the `protected` branch flag + the **rulesets API** (`/rules/branches/{branch}`, line 57) reading the *active* `pull_request` / `required_status_checks` / `required_signatures` rules. This is enforcement state, not a CODEOWNERS-exists check.

**Audit tab (`audit/page.tsx` → `AuditLogViewer.tsx` → `/api/audit` → `scans-audit.ts`):**
- Attributable: each row shows actor (`actorId`, viewer.tsx:212), action badge, timestamp (`title={e.at}` full ISO, line 206), details (scan ref → linked report).
- Filterable: action dropdown, since/until date inputs, free-text **actor** filter (viewer.tsx:144-168) → query params (lines 100-107) → `getAuditLog` where-clause (scans-audit.ts:123-129).
- Deterministic keyset pagination: composite `(at desc, id desc)` cursor, base64url-encoded, fetch-one-extra hasMore (scans-audit.ts:87-91,137-143) — gap-free, stable boundaries.
- **CSV export**: `csvHref` carries the *current filter set* (viewer.tsx:136); `/api/audit?…&format=csv` cursor-loops ALL matching rows (capped 10k) into an RFC-4180 CSV with a dated attachment filename (route.ts:34-72). Cells are formula-injection-neutralized (`=+-@` prefix → `'`, route.ts:24-28) — exactly the hardening an auditor's tooling would want.

---

## Findings

```json
[
  {
    "id": "L1-NADIA-SC-01",
    "journey": "supply-chain-and-governance-posture",
    "character": "Nadia (AppSec Lead)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "dimension": "trust",
    "title": "Dependabot advisory signal is architecturally separated from D9 and labelled demo under mock — the central trust gate holds",
    "expected": "Advisory counts shown alongside the deterministic D9 rubric, never folded into the score; mock data flagged as demo so she'd never attest to fabricated counts.",
    "got": "getOrgSupplyChain is consumed ONLY by the Security tab + its LLM brief, never by the scoring engine/prompt/analyzer; D9 is a file-presence detector. The supply-chain card literally says 'Demo data — set SUPPLY_CHAIN_PROVIDER=github for live alerts' when provider=mock, and the brief tags the section '(Dependabot — demo data)'.",
    "evidence": ["src/lib/security/supply-chain.ts:112", "src/lib/security/supply-chain.ts:145", "src/app/org/[slug]/security/page.tsx:120", "src/app/org/[slug]/security/page.tsx:125", "src/lib/analyze/index.ts:552", "src/lib/maturity/model.ts:125", "src/lib/org/security.ts:135"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "suggested_acceptance": "The two claims (deterministic D9 vs live advisory count) stay physically separate in code and are visually + textually distinguished, with mock data labelled demo at every surface (tab + copied brief)."
  },
  {
    "id": "L1-NADIA-SC-02",
    "journey": "supply-chain-and-governance-posture",
    "character": "Nadia (AppSec Lead)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "dimension": "trust",
    "title": "'Requires review' rate counts requires-a-PR, not requires-an-approval — an enforcement gradation she'd want made explicit",
    "expected": "Per SOC 2 CC8.1, 'requires review' means an approval is actually required before merge (required_approving_review_count >= 1) — not merely that a PR is opened.",
    "got": "getOrgGovernance.requireReviewRate counts g.requiresPullRequest (= a pull_request rule exists), NOT requiredApprovals >= 1. fetchBranchGovernance DOES capture requiredApprovals and requiresCodeOwnerReview, but the fleet rate and the 'Requires review' UI row use the weaker requiresPullRequest predicate. A repo with a PR rule but 0 required approvals counts as 'requires review'.",
    "evidence": ["src/lib/db/org-signals.ts:136", "src/app/org/[slug]/security/page.tsx:177", "src/lib/github/governance.ts:77", "src/lib/github/governance.ts:64"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "On the seeded fleet, check whether the 'Requires review' % visibly overstates approval-enforced coverage — i.e. are there repos with a PR rule but 0 required approvals being counted as compliant?",
    "suggested_acceptance": "The 'Requires review' coverage reflects required_approving_review_count >= 1 (and ideally surfaces CODEOWNERS-required-review), so a PR-with-no-approval repo is not counted as review-enforced."
  },
  {
    "id": "L1-NADIA-SC-03",
    "journey": "supply-chain-and-governance-posture",
    "character": "Nadia (AppSec Lead)",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "polish",
    "dimension": "missing",
    "title": "Supply-chain card and CODEOWNERS-required-review have no dedicated export path; only the LLM brief + per-row CSV exist",
    "expected": "For the evidence binder she wants the Dependabot advisory totals and the enforcement gradations exportable, not just pasteable into an LLM.",
    "got": "Security tab offers a PDF (security/page.tsx:48-54) + 'Copy security brief for LLM' (markdown incl. advisory section). Governance offers 'Copy governance brief for LLM' only. Only the AUDIT trail has a true filtered CSV. The advisory counts and requiresCodeOwnerReview don't reach a structured export.",
    "evidence": ["src/app/org/[slug]/security/page.tsx:48", "src/app/org/[slug]/security/page.tsx:55", "src/lib/org/security.ts:133", "src/app/org/[slug]/governance/page.tsx:57"],
    "code_check": "by-design",
    "verdict": "uncertain",
    "l2_priority": "Confirm the Security PDF renders the supply-chain section and is binder-grade; decide whether a structured (CSV) security/governance export is wanted beyond the PDF + LLM brief.",
    "suggested_acceptance": "Out of scope at L1 — the PDF + audit CSV cover the attestation need; a structured posture CSV is a nice-to-have."
  },
  {
    "id": "L1-NADIA-SC-04",
    "journey": "supply-chain-and-governance-posture",
    "character": "Nadia (AppSec Lead)",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "dimension": "clarity",
    "title": "Supply-chain card hides entirely when SUPPLY_CHAIN_PROVIDER=off — no 'supply-chain scanning not enabled' affordance",
    "expected": "When advisory scanning is off she should still see that the surface exists and how to turn it on, rather than the section silently not rendering (so she doesn't mistake 'no card' for 'no advisories').",
    "got": "The card is wrapped in `{supply && supply.scanned > 0 && …}` (and getOrgSupplyChain returns null when provider=off), so with the default 'off' provider there is NO supply-chain card and no hint it could be enabled. Under the journey's mock seed this is moot, but the absence is silent rather than explained.",
    "evidence": ["src/app/org/[slug]/security/page.tsx:120", "src/lib/security/supply-chain.ts:99", "src/lib/security/supply-chain.ts:113"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Lower priority — under the mock seed the card is present and labelled. Consider an 'enable supply-chain scanning' empty-state when provider=off.",
    "suggested_acceptance": "When provider=off, show a one-line 'Supply-chain advisory scanning not enabled (set SUPPLY_CHAIN_PROVIDER)' so absence is explained, not silent."
  },
  {
    "id": "L1-NADIA-SC-05",
    "journey": "supply-chain-and-governance-posture",
    "character": "Nadia (AppSec Lead)",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "minor",
    "dimension": "completion",
    "title": "Org tabs + audit export need ASCENT_OPEN_ORG_DASHBOARDS in addition to ASCENT_AUTH_BYPASS; bypass alone degrades to a 'No access' empty state",
    "expected": "Per the journey seed (ASCENT_AUTH_BYPASS=1 + seeded org), the security/governance/audit surfaces open.",
    "got": "The page layout's canReadOrg and /api/audit's requireOrgRead both resolve to openOrgDashboardsEnabled() when OAuth is unconfigured (Supabase off + custom OAuth dormant). authBypassEnabled flips authGateEnabled/getViewer but NOT canReadOrg's auth-off branch, so org reads require the SEPARATE flag ASCENT_OPEN_ORG_DASHBOARDS=1 (documented uat/env.md:33). The seed workflow sets it, but the journey seed line names only the bypass.",
    "evidence": ["src/lib/authz.ts:62", "src/lib/authz.ts:68", "src/lib/authz.ts:105", "src/lib/access.ts:44", "src/app/org/[slug]/layout.tsx:78", "src/app/api/audit/route.ts:88", "uat/env.md:33"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Confirm the live run env carries BOTH ASCENT_AUTH_BYPASS=1 and ASCENT_OPEN_ORG_DASHBOARDS=1; if only the bypass is set, every org tab renders the calm 'No access' empty-state and the journey can't start.",
    "suggested_acceptance": "Documented two-flag dependency is acceptable; ensure the seed/UAT env sets both."
  },
  {
    "id": "L1-NADIA-STR-01",
    "journey": "supply-chain-and-governance-posture",
    "character": "Nadia (AppSec Lead)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "dimension": "senior-quality",
    "title": "STRENGTH — Governance reads ENFORCEMENT (active rulesets) and names the gaps, not mere CODEOWNERS/branch-protection existence",
    "expected": "Per SOC 2 CC6.1/CC8.1, posture must reflect what's required across all repos, with the falling-short repos named.",
    "got": "fetchBranchGovernance reads the rulesets API (/rules/branches) for the ACTIVE pull_request / required_status_checks / required_signatures rules + the branch protected flag — enforcement state, not file presence. The Security + Governance tabs name the unprotected repos and each failing repo's exact missed condition. CODEOWNERS is parsed for team attribution, deliberately not dressed up as a required-review control.",
    "evidence": ["src/lib/github/governance.ts:47", "src/lib/github/governance.ts:55", "src/lib/db/org-signals.ts:130", "src/app/org/[slug]/security/page.tsx:181", "src/app/org/[slug]/governance/page.tsx:103", "src/lib/github/codeowners.ts:11"],
    "code_check": "present-but-missed",
    "verdict": "confirmed"
  },
  {
    "id": "L1-NADIA-STR-02",
    "journey": "supply-chain-and-governance-posture",
    "character": "Nadia (AppSec Lead)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "dimension": "senior-quality",
    "title": "STRENGTH — Audit CSV export is binder-grade: filtered, full-trail cursor-loop, attributable, timestamped, and formula-injection-hardened",
    "expected": "An auditor's 'show me the change history' answered by an exportable, attributable, filterable trail — not a screenshot.",
    "got": "/api/audit?format=csv cursor-loops ALL matching rows (10k cap) for the CURRENT filter set into RFC-4180 CSV with at/action/actorId/repo/level/overall/headSha/meta columns, dated attachment filename, and =+-@ formula-injection neutralization. Deterministic (at desc,id desc) keyset pagination. Org-scoped so no cross-tenant leak.",
    "evidence": ["src/app/api/audit/route.ts:34", "src/app/api/audit/route.ts:24", "src/app/api/audit/route.ts:30", "src/lib/db/scans-audit.ts:87", "src/components/org/AuditLogViewer.tsx:136"],
    "code_check": "present-but-missed",
    "verdict": "confirmed"
  },
  {
    "id": "L1-NADIA-STR-03",
    "journey": "supply-chain-and-governance-posture",
    "character": "Nadia (AppSec Lead)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "dimension": "time-saved",
    "title": "STRENGTH — Fleet read reconciles to named per-repo (weakest, unprotected, failing) without hand-walking the GitHub UI",
    "expected": "A fleet number she can drill to the named weakest/unprotected/failing repos (OpenSSF per-repo bundle mental model), not a hand-averaged figure.",
    "got": "Security tab: avg D9, branch-protection %, repos-at-risk, supply-chain totals, AND named weakest repos + named unprotected repos + per-severity per-repo advisory rows. Governance tab: pass-rate + named failing repos with exact missed conditions + cheapest-path-to-green. Collapses the days-of-clicking SOC 2 evidence pull to a single fleet view.",
    "evidence": ["src/lib/org/security.ts:86", "src/lib/org/security.ts:96", "src/app/org/[slug]/security/page.tsx:150", "src/lib/org/governance.ts:131", "src/app/org/[slug]/governance/page.tsx:103"],
    "code_check": "present-but-missed",
    "verdict": "confirmed"
  }
]
```

---

## Character feedback (Nadia, first person)

Okay — I came in ready to catch this product doing the thing every "security dashboard" does: quietly fusing a live Dependabot count into a "maturity score" so I can't tell whether the number moved because someone added a test or because a CVE dropped at 3am. **It doesn't.** I traced it. D9 is a file-presence detector — it reads whether you've *configured* CodeQL, Dependabot, gitleaks, SBOM, signing. The advisory *counts* are a totally separate fetch that only the Security tab and the copy-for-LLM brief ever touch; the scoring engine literally never imports it. And under the mock provider it stamps the card "Demo data — set SUPPLY_CHAIN_PROVIDER=github for live alerts." That's the difference between a tool I'll put in front of an auditor and one I'll quietly close. Those are two different claims and the code keeps them two different claims. That, I can put in the evidence binder.

Governance is the other place these things usually lie to me — a CODEOWNERS file that exists but isn't *required* gets counted as a control. Here the branch governance reads the active rulesets, not just "is there a branch protection object," and it names the unprotected repos and the exact condition each failing repo misses. CODEOWNERS is parsed for *team attribution*, not paraded as a required-review control it isn't. That's honest. The one thing I'm side-eyeing: the "Requires review" rate counts "a PR rule exists," not "an approval is actually required." A repo with a PR rule and zero required approvers shouldn't get to wear the review badge — that's exactly the CC8.1 gap an auditor pokes at. The data's *there* (it captures required-approval count and code-owner-review), it's just not the predicate the fleet rate uses. Tighten that and I stop caveating the number.

The audit trail is the part that genuinely beats my spreadsheet: filter by actor/action/date, deterministic pagination, and a CSV that exports the *whole filtered trail* — and someone hardened it against formula injection, which tells me an adult thought about who reads this file. That's a re-pullable, attributable change history, not a screenshot.

What's missing for *my* job is small and honest: no SAST/secret-scan of my own source (the journey says out of scope — fine, and the app doesn't pretend otherwise, which I respect more than a fake feature), and the supply-chain card vanishes entirely when scanning's off instead of telling me it's off. Net: on paper this collapses my days-of-clicking SOC 2 pull into one fleet view I'd actually defend. I'd adopt it — pending L2 proving the live numbers reconcile and the export opens clean in my evidence tooling.

---

## l2_priority (carry-forward)

- **Confirm the run env sets BOTH `ASCENT_AUTH_BYPASS=1` AND `ASCENT_OPEN_ORG_DASHBOARDS=1`** — bypass alone degrades every org tab + the audit export to a "No access" empty-state (the journey can't start). [SC-05]
- **Verify "Requires review" doesn't overstate approval-enforced coverage** on the seeded fleet — are repos with a PR rule but 0 required approvals counted as review-enforced? [SC-02]
- **Confirm the supply-chain card renders with the "Demo data" label under `SUPPLY_CHAIN_PROVIDER=mock`** and that the per-severity totals + named per-repo advisory rows display, and that the same labelling appears in the copied security brief. [SC-01]
- **Open the audit CSV export in a real spreadsheet** — confirm it contains the full filtered trail (actor, timestamp, action, scan ref), respects the active filters, and the formula-injection guard holds.
- **Confirm the Security PDF is binder-grade** and includes the supply-chain section (or decide PDF + audit-CSV suffice vs a structured posture CSV). [SC-03]
- **Confirm the fleet numbers reconcile to the per-repo lists** (avg D9, branch-protection %, repos-at-risk vs the named weakest/unprotected/failing repos) — no hand-averaging drift.
