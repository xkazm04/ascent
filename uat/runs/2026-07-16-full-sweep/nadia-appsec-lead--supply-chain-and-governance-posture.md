# L1 report — Nadia (AppSec Lead) × Supply Chain & Governance Posture

cert_level: L1 · theoretical, code-grounded · no browser

## 1. Surface model (import chain, file:line)

### Entry / reachability
- Nav: `src/components/org/shared/OrgNav.tsx:83` (`Security`), `:115` (`Governance`), `:117` (`Audit`) — all three are top-level `/org/[slug]/*` nav items, unconditionally listed for non-personal orgs.
- Auth: `ASCENT_AUTH_BYPASS=1` resolves Nadia as a synthetic "developer" viewer; the org layout auto-seeds her as a real `owner` Membership on the second visit (`uat/env.md`). Governance's edit control is `hasOrgRole(slug,"owner")`-gated (`src/app/org/[slug]/governance/page.tsx:43-45`) — she clears it. Audit reads go through `requireOrgRead` (`src/app/api/audit/route.ts:99`), which the owner role also clears.
- **Reachable surface set for Nadia**: `/org/[slug]/security`, `/org/[slug]/governance`, `/org/[slug]/delivery#governance`, `/org/[slug]/audit`, `/api/audit` (JSON + CSV), the D9 evidence drill-in modal, the security PDF export. All confirmed reachable — no gating blocks her.

### A) `/org/[slug]/security` — fleet supply-chain + governance read
- Page: `src/app/org/[slug]/security/page.tsx:41-45` calls `buildSecurityOverview` (`src/lib/org/security.ts:86-180`) and `getOrgSupplyChain` (`src/lib/security/supply-chain.ts:139-199`) in parallel — two genuinely separate data sources/objects, never merged into one number. Good match to her OpenSSF-Scorecard mental model of "posture = governance bundle + dependency hygiene, kept distinct."
- Tiles rendered: Avg Security (D9), **Branch protection %** (`gov.protectedRate` only — page.tsx:100-105), Repos at risk, Security gate (page.tsx:106-112).
- `SecurityRiskRegister` (`src/components/org/security/SecurityRiskRegister.tsx:63-184`) is the per-repo drill: D9 score button → opens `RepoDimensionModal`; a `Gate` pass/fail column; a 9-check control-coverage grid (`securityRegisterShared.ts:22-33`, sourced from `parseSecurityChecks` over the scan's D9 evidence lines, `security.ts:48-64` — this is real per-check, file:line-style provenance, not hand-waved); an **Advisories** column (only rendered when `advByRepo` is non-null, i.e. supply-chain provider is on) showing critical/high/total counts linking out to GitHub.
- Degraded-fetch honesty: `supply.degraded` (set when a `github`-mode token mint fails) is never cached and renders a visible amber banner ("advisories couldn't be fetched … not a clean bill of health," page.tsx:124-130) — this is exactly the "silent all-clear" failure mode she's been burned by, and it's closed.
- **Demo-data labelling gap (confirmed by grep):** `supply.demo` (`supply-chain.ts:27`, set `true` when `SUPPLY_CHAIN_PROVIDER=mock`) is read in exactly one place in the whole codebase — `src/lib/org/security.ts:240`, inside `securityMarkdown()`, the "Copy for LLM" export. It is **never passed to, or rendered by,** `SecurityRiskRegister.tsx`, the page's Tiles, or the PDF's advisories block (`src/lib/pdf/security-document.tsx` — grepped, no `demo` reference). The Advisories column header is just "Advisories"; the counts render identically whether they're live GitHub data or the deterministic hash-based mock (`mockProvider.fetchAdvisories`, `supply-chain.ts:107-115`). Under the UAT-pinned seed (`SUPPLY_CHAIN_PROVIDER=mock`, `uat/journeys/....md:5`) — the exact condition Nadia's own acceptance criterion targets — the on-screen numbers she'd read first carry **no visual demo marker at all**; she'd only learn it's synthetic by clicking "Copy for LLM" and reading the markdown two levels down.
- Security PDF: `src/app/api/org/security/pdf/route.ts` → `src/lib/pdf/security-document.tsx:39,48` renders `governance.protectedRate/requireReviewRate/requireChecksRate/signedRate` together (good — this is the one surface where all four enforcement rates DO appear together), but likewise carries no demo/mock disclosure for the advisories block.

### B) `/org/[slug]/governance` — the surface her criterion names for "enforcement, not existence"
- Page: `src/app/org/[slug]/governance/page.tsx:26-224` → `buildGovernanceOverview` (`src/lib/org/governance.ts:87-180`).
- What it actually shows: the **maturity CI gate** (level / dimension-floor / posture / overall / "unprotected default branch") pass-rate, "where the fleet fails" bars per condition (`page.tsx:86-97`), a failing-repos list with mixed reason strings (`page.tsx:108-126`), and a "cheapest path to green" worklist. This is a real, well-built policy-as-code surface — but it is a **gate-compliance view**, not a governance-*coverage* view.
- What her criterion explicitly asks this page to show — **protected-branch / requires-review / requires-checks / signed-commit coverage, with named repos that fall short** — is a different, already-computed object (`OrgGovernance` with `protectedRate/requireReviewRate/requireChecksRate/signedRate` + `perRepo`, `src/lib/db/org-signals.ts:139-142,194-200`) that this page **never imports**. `governance.ts:87-180` only calls `getOrgRollup` and `getOrgGatePolicy` — no `getOrgGovernance`.
- That object IS rendered — but on **`/org/[slug]/delivery`**, under a "Branch governance" section (`src/app/org/[slug]/delivery/page.tsx:140-155`): four tiles (Protect main / Require review / Require checks / Signed commits) plus `GovernanceTable` (`src/components/org/delivery/GovernanceTable.tsx:78-112`), which names every ungoverned repo with an "unprotected" chip and a direct "Fix on GitHub" link to that repo's branch-protection settings (`GovernanceTable.tsx:28-32,47-58`) — this is precisely the "enforcement, not existence, named repos" artifact her criterion wants. It is simply on the wrong tab from her point of view: a page literally called "Delivery," not "Governance" or "Security."
- **Verdict on this surface**: `code_check: present-but-missed` at the *page* Nadia would visit — the data and the UI both exist and are well-built, but the label→control mapping for a security/compliance user is inverted (rubric step 3: "will they connect the control to their intent?" — no, "Governance" reads as CI-gate policy, not SOC2 branch-governance coverage). Type: `confusion`, not `missing-feature`.

### C) `/org/[slug]/audit` — audit trail
- Page: `src/app/org/[slug]/audit/page.tsx:11-39` → `getAuditLog(slug,{limit:25})`, hands to `AuditLogViewer`.
- API: `src/app/api/audit/route.ts` — `GET /api/audit?org=&action=&actorId=&since=&until=&cursor=&limit=[&format=csv]`. Keyset pagination (`cursor`/`nextCursor`), org-scoped (`getAuditLog` filters by `orgId` — no cross-tenant leak per file comment lines 5-8), gated by `requireOrgRead` (line 99).
- Filters: action (dropdown, `AuditLogViewer.tsx:18-31` — one canonical `ACTIONS` list drives both filter UI and badge rendering, so they can't drift), since/until date inputs, actor text filter (`AuditLogViewer.tsx:173-184`).
- CSV export (`route.ts:26-83`): streams ALL matching rows cursor-looped, `CSV_MAX_ROWS=10000` cap, columns `at,action,actorId,orgId,repo,level,overall,headSha,meta` (line 23) — `orgId` was added specifically so the row-level HMAC `_sig` is reconstructible/verifiable from the file alone (comment lines 19-22). **Truncation is explicit, not silent**: a still-set cursor at the cap sets `x-ascent-truncated: true`, a `-PARTIAL` filename suffix, and an `x-ascent-row-cap` header (lines 58-80) — exactly what "don't silently read as complete" requires. File-level integrity via `x-ascent-content-sha256`.
- Actor attribution fix (confirmed): `src/app/api/org/members/route.ts:63-72` — the file's own comment states the prior bug (`getSession()` under the Supabase wall returns null with no cookie, so every privilege-change was audited with a null actor); it now calls `resolveViewerLogin()` before `recordOrgAudit("org.member.role", …)`. This is a real, code-confirmed fix matching the journey's "recently fixed" hint.
- Gap: the Actor column (`AuditLogViewer.tsx:249-256`) renders the raw `actorId` string (truncated to 12rem) with no name/avatar resolution — defensible for a raw evidence trail (an auditor wants the identifier, not a pretty name) but she may want it human-readable; minor, not blocking.

## 2. In-character walkthrough (Nadia)

I open `/org/vercel` (seeded) and go straight to **Security**. The Avg D9, branch-protection %, repos-at-risk, and gate tiles land in seconds — better than my spreadsheet already. The risk-register grid is the best part: one row per repo, a 9-check control battery graded 0–10, gate-failing repos surfaced first. That's the OpenSSF-Scorecard bundle I expect, reconciled to named repos. Good.

I look at the Advisories column. Numbers are there — some repos show "2C 3H 7". I want to know: is this real GitHub data or the demo I was warned this instance might be running? Nothing on the page tells me. No badge on the column header, no note near the tile, nothing. I click "Copy for LLM" out of habit and *there* — buried in the markdown — is `## Supply chain (Dependabot — demo data)`. That's the only place it says so. If I hadn't clicked that button I would have walked away believing these were live Dependabot counts and put them in the evidence binder. That is exactly my "would not attest to fabricated counts" line, and the UI just crossed it silently. This stings more than a missing feature — it's the one thing I explicitly said would break trust instantly.

I check the "Repos at risk" framing next to D9 — good, D9 stays the deterministic rubric, advisories sit in their own column, never blended into the score. I'll give credit: architecturally this is exactly the separation I want. It's the *labelling* on-screen that fails, not the design.

Next: Governance. I click the tab expecting protected-branch / requires-review / requires-checks / signed-commit coverage with named gaps — my CC6.1/CC8.1 evidence. Instead I get a CI maturity-gate pass-rate: level, dimension floors, posture, overall score, "unprotected branch" as one line among several fail reasons. That's a different claim — this is "does the repo clear Ascent's own maturity bar," not "is branch protection enforced fleet-wide." I don't see requires-review%, requires-checks%, or signed-commit% anywhere on this page. I go looking — I eventually find them on **Delivery**, of all places, under "Branch governance," with a proper table naming every ungoverned repo and a straight link to fix it on GitHub. That table is genuinely good — exactly what I'd screenshot for the auditor. But I had to guess to find it on a tab called "Delivery," not "Governance" or "Security." That's a real navigation/mental-model miss for a security-titled journey.

Audit trail: this is the strongest surface. Action filter, date range, actor filter, keyset "Load more," and a CSV download that actually streams everything matching the filter, flags truncation honestly instead of silently capping, and signs the file. I test the scenario the journey flagged — a role change — and the actor resolves to a real login now, not null. I'd sign off on this section as-is.

## 3. Findings

```
[
  {
    "id": "L1-NADIA-SCG-01",
    "journey": "supply-chain-and-governance-posture",
    "character": "nadia-appsec-lead",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Demo/mock Dependabot advisory counts render on the Security tab with NO visual demo label — only the 'Copy for LLM' markdown discloses it",
    "expected": "Any surface showing SUPPLY_CHAIN_PROVIDER=mock advisory counts is honestly labelled as demo/synthetic wherever a human reads it, per her acceptance criterion #3.",
    "got": "supply.demo (src/lib/security/supply-chain.ts:27) is read in exactly one place codebase-wide: src/lib/org/security.ts:240 inside securityMarkdown(). SecurityRiskRegister.tsx's Advisories column, the page Tiles, and src/lib/pdf/security-document.tsx never reference it.",
    "evidence": ["src/lib/security/supply-chain.ts:24-35 (demo field)", "src/lib/org/security.ts:240 (only read site)", "src/app/org/[slug]/security/page.tsx:63-69,92-136 (Advisories column, no demo prop passed)", "src/components/org/security/SecurityRiskRegister.tsx:63-72,150-161 (no demo prop in signature)"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Load /org/<slug>/security live with SUPPLY_CHAIN_PROVIDER=mock and confirm the Advisories column/tile shows zero demo indicator on screen; then confirm the same gap holds in the PDF export."
  },
  {
    "id": "L1-NADIA-SCG-02",
    "journey": "supply-chain-and-governance-posture",
    "character": "nadia-appsec-lead",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "'/org/[slug]/governance' shows the CI maturity-gate pass-rate, not the protected-branch/review/checks/signed enforcement coverage her criterion names — that data lives on '/org/[slug]/delivery' instead",
    "expected": "Governance page shows protectedRate / requireReviewRate / requireChecksRate / signedRate with named falling-short repos (SOC 2 CC6.1/CC8.1 evidence), per her acceptance criterion #4.",
    "got": "src/lib/org/governance.ts:87-180 (buildGovernanceOverview) only calls getOrgRollup + getOrgGatePolicy — never getOrgGovernance. The four enforcement rates + named-repo GovernanceTable exist and render well, but only under src/app/org/[slug]/delivery/page.tsx:140-155.",
    "evidence": ["src/app/org/[slug]/governance/page.tsx:26-224 (no enforcement-rate tiles)", "src/lib/org/governance.ts:87-97 (data sources)", "src/app/org/[slug]/delivery/page.tsx:140-155 (rates + GovernanceTable)", "src/components/org/delivery/GovernanceTable.tsx:78-112 (named unprotected repos, exists here only)"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Drive Governance tab live as Nadia without prior knowledge of Delivery; time how long it takes her to find requires-review/requires-checks/signed coverage, or whether she gives up and files it as missing."
  },
  {
    "id": "L1-NADIA-SCG-03",
    "journey": "supply-chain-and-governance-posture",
    "character": "nadia-appsec-lead",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Named weakest/unprotected repos (sec.unprotected) computed in buildSecurityOverview but never rendered on the Security page itself",
    "expected": "The Security tab drills to named unprotected repos directly (criterion #1), not only via the copy-for-LLM export.",
    "got": "unprotected (src/lib/org/security.ts:79,171) is only consumed by securityMarkdown() (security.ts:218-221); no component in security/page.tsx renders it. In practice she can still get named-gap repos via the risk register's Gate column or via Delivery's GovernanceTable, so this is a redundant/minor path gap, not a blocker.",
    "evidence": ["src/lib/org/security.ts:79,171,218-221", "src/app/org/[slug]/security/page.tsx (no `sec.unprotected` reference)"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm she can still reach named-unprotected-repo evidence fast enough via the risk register / Delivery table that this doesn't independently cost her time."
  },
  {
    "id": "L1-NADIA-SCG-04",
    "journey": "supply-chain-and-governance-posture",
    "character": "nadia-appsec-lead",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "med", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "Audit CSV export and screen show no demo/dev-environment disclosure",
    "expected": "n/a for a real deployment; flagged only because the UAT seed itself is synthetic and she'd want ANY exported evidence file to be unambiguous about environment.",
    "got": "CSV export headers carry integrity (SHA-256) and truncation flags but no environment/dev marker; acceptable for production but worth confirming this isn't a general gap.",
    "evidence": ["src/app/api/audit/route.ts:26-83"],
    "code_check": "by-design",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Low priority — only worth a quick live check, not a dedicated pass."
  }
]
```

**Strengths (worth protecting, not to be regressed):**
- D9 and Dependabot are architecturally kept as two separate data objects/API calls end-to-end (`security/page.tsx:41-45`) — never blended into one score. This is the single thing her scored criteria most demand and the design gets it right at the data layer.
- `degraded` (auth-failure) state on the supply-chain fetch is never cached and renders a visible non-clean-bill-of-health banner (`supply-chain.ts:160-167`, `security/page.tsx:124-130`) — closes the exact "silent all-clear" failure mode from her background.
- Advisory pagination now walks all pages instead of silently under-counting past 100 (`supply-chain.ts:67-103`) — a real, cited prior-bug fix (security-posture-audit-log #3).
- Audit trail: keyset pagination, action/actor/date filters sharing one canonical action list with the badge renderer, streaming CSV export with explicit truncation flagging (`-PARTIAL` filename + headers) instead of silent capping, per-row HMAC + file-level SHA-256 integrity, and `orgId` per row so the signature is independently reconstructible. This clears her audit-grade bar as designed.
- Privilege-change audit rows now resolve a real actor via `resolveViewerLogin()` instead of the dormant `getSession()` null-actor bug (`src/app/api/org/members/route.ts:63-72`) — the journey's flagged "recently fixed" item is genuinely fixed in code.
- Governance-page-as-gate is itself well built (policy-as-code, identical CI snippet, "cheapest path to green") — it's simply not the surface her SOC2-evidence criterion is asking this specific URL to be.

## 4. Character voice — would I adopt it?

Half of this would go straight in my evidence binder, and half of it I'd bounce back to engineering with a Jira ticket before I trusted it.

The audit trail is the real deal. Filterable, keyset-paginated, exportable to CSV with a signed hash and an honest truncation flag instead of quietly dropping my oldest rows — that's the first audit export I've seen from an internal tool that thought about "what happens when the auditor asks 'is this the whole trail?'" before I had to ask. And they actually fixed the null-actor bug on role changes, which is the one action I'd have flagged first if it were still broken. That's a "put it in the binder" pass.

The Security tab's architecture is right — D9 and Dependabot genuinely stay two claims, never fused, which is rarer than it sounds. But then it undercuts its own discipline: the advisory counts I'm looking at could be real or could be a hash of the repo name pretending to be real, and the page gives me zero way to tell without digging into an export button I might never click. That's not a rounding error to me — that's the exact scenario I described as "I will not put a fabricated advisory count in an evidence binder," and right now the UI would let me do it by accident. Fix that before I trust this tab unattended.

And Governance — I clicked the tab that's *named for my job* and got a CI gate scoreboard instead of my enforcement coverage. The data I actually wanted was one tab over, filed under "Delivery," which isn't where a security lead goes looking for branch-protection SOC 2 evidence. It's there, it's well-built, it just isn't where my mental model puts it. Ten more seconds of friction, not a dealbreaker, but it's exactly the kind of "is this the claim I think it is" confusion I get quiet and suspicious about.

Net: I'd use this over my spreadsheet — the audit trail alone probably saves me the worst day of every audit cycle. But I'm not closing my spreadsheet yet. I'd re-verify the advisory labelling and go find the governance page's real home before I'd stake anything on it in front of the CISO.
