# The Golden Trio — ascent's three monetizable strengths

_2026-07-28. Synthesis of: the `tiger/` vault (LLM-engine certification, 1 L1 run + 1 live benchmark), the
49-context codebase map, `docs/` (PRD · VALUE-CASE · ENTERPRISE · ORG-INTELLIGENCE · MATURITY_MODEL ·
AI_MANIFEST_SPEC · BILLING), and three parallel market sweeps (AI-native maturity assessment · AI ROI &
governance · agent-readiness tooling)._

---

## 0. The market fact that reframes everything

**The "AI-native maturity score" is no longer white space.** Since Jan 2026:

- **Factory.ai — Agent Readiness**: 8–9 pillars × 5 levels, 60+ binary criteria, *the same hybrid engine*
  (file checks + config parse + LLM eval, LLM grounded on prior reports to cut variance 7%→0.6% — their
  analogue of our guardband). CLI + dashboard + API + a CI gate that blocks merges lowering the score.
  Org rollup = "% of repos at L3+". Remediation PRs "coming soon." Bundled into a **$20/mo** seat.
- **Free floor already exists**: `pip install agent-readiness` (MIT, SARIF + `--fail-below` + public
  leaderboard, ~140 repos/day), AI Harness Scorecard, an Apify actor that reproduces our *entire
  deterministic D1 signal layer* for cents per run, and an [ossf/scorecard#5021](https://github.com/ossf/scorecard/issues/5021)
  proposal to standardize an AI Codebase Maturity Model.
- **Incumbents converged**: DX (acquired by Atlassian ~$1B, Nov 2025), Swarmia, Jellyfish, LinearB, Faros
  all shipped AI-adoption modules. Sonar shipped **AI Code Assurance** with publishable badges.
- **Upstream data is free**: GitHub Copilot Metrics API GA (Feb 2026), Anthropic Claude Code Analytics +
  cost/usage Admin APIs, Cursor equivalent.

**Conclusion: the score is table stakes; do not build the moat there.** The defensible positions are
(a) *neutrality + fleet breadth*, (b) *the auditable artifact*, and (c) *the remediation loop*. All three
of ascent's strongest built assets sit in exactly those places.

Also load-bearing: **AGENTS.md is now Linux-Foundation-governed** (Agentic AI Foundation, Dec 2025,
60k+ repos, read by 20–30 tools) and **MCP has an official registry** (~9.6k servers). There is still
**no schema for declaring which gates, evals, MCP servers and owners a repo exposes** — which is
precisely what `.ai/manifest.yaml` already is.

---

## The trio

| # | Strength | Why it's the moat | Buyer | Price shape |
|---|---|---|---|---|
| **T1** | **AI-Governance Evidence Ledger** — tamper-evident, time-series proof that AI-authored changes were reviewed, attributed and owned, fleet-wide | Least-crowded × highest WTP in the whole sweep. Security vendors sell *prevention*; GRC vendors (Vanta/Drata) sell frameworks and **openly admit AI evidence collection is still manual**. Nobody sells the artifact. | CISO / Head of Eng Governance / the person answering the procurement questionnaire | per org + per period, seat-free |
| **T2** | **The `.ai/` standard + executable `doctor` + fleet remediation PRs** | Vendor-neutral referee in a market where every scorer upsells its own agent. The one spec vacuum AAIF hasn't filled. Being the *required check in the pipeline* is the distribution mechanism that actually worked for Scorecard — badges weren't. | Platform / DevEx lead | free OSS wedge → paid fleet aggregation |
| **T3** | **Fleet & portfolio intelligence → the due-diligence report** | Factory rolls up one number (% at L3+). Nobody does distribution, org-vs-repo gap attribution, movers, bus factor, or fleet-of-fleets. The manual alternative in tech DD is **$25k–$110k**, and Sema is the only automated pure-play. | VP Eng (internal) / PE-VC partner (external) | per repo scanned; per engagement for DD |

Everything below is already ≥60% built. Nothing here is a from-scratch bet.

---

## T1 — AI-Governance Evidence Ledger

**What already exists:** `aiGovernedRate` (are AI-authored PRs actually reviewed? — `analyze/pulls.ts`,
gated at ≥3 AI PRs), branch-governance ingestion (rulesets API: required approvals, code-owner review,
status checks, signatures, linear history), CODEOWNERS→`RepoTeam` attribution, AI-tool taxonomy from
commit trailers + PR bodies, an **immutable audit log with per-row HMAC** + **CSV content-hash header**,
engine **and model** provenance columns in the signed history export (shipped via `tiger` P1-5), per-org
retention policy with a self-auditing purge job, and org-scoped RBAC.

That is ~80% of an assurance product that nobody is selling.

### Five directions

1. **The Conformance Pack** — one signed, hash-chained bundle per quarter per org: AI-PR review coverage,
   named human approver per AI-authored change, tool attribution, engine/model provenance, governance
   posture, and the gaps — pre-mapped to **ISO/IEC 42001 Annex A** clauses and to the questions in a
   standard enterprise AI procurement questionnaire. Build on the existing HMAC + content-hash export.
   *Honesty guardrail:* ISO 42001 + procurement is the real driver. EU AI Act high-risk obligations were
   **deferred to Dec 2027 / Aug 2028** by the Digital Omnibus; only Art. 50 transparency lands Aug 2026.
   Scope the claim to internal SDLC governance evidence — do not market it as AI-Act conformity.

2. **Ungoverned-AI-change gate** — extend the existing deterministic `200/422` gate at
   `/api/gate/:repo` with a *provenance policy*: fail when an AI-attributed change merges without a named
   human approver or without CODEOWNER review. The research is unambiguous that "provenance + policy gate
   for agent-authored PRs" is **described everywhere and productized nowhere**. This is the sharpest
   single unclaimed slice in the sweep, and ascent's gate is already deterministic-by-default.

3. **Code AI-BOM** — emit a CycloneDX / SPDX-3.0-AI-profile-shaped attestation: what share of the codebase
   is AI-attributed, by tool, with an explicit confidence and method disclosure. CISA + G7 published
   *SBOM-for-AI minimum elements* (Jun 2026); Sema already sells a GBOM into diligence. We have the tool
   taxonomy; the missing piece is the standard envelope and an honest confidence statement.
   *Precondition:* the `aiUsage.detected` bug (Renovate counted as AI) must stay fixed and be regression-tested —
   this number becomes a contractual artifact.

4. **Continuous control monitoring** — repoint Fleet Alerts & Digests from "score moved" to "**control
   failed**": review coverage on AI PRs fell below policy in N repos, branch protection removed, signing
   disabled. Auditors buy the *timeline*, not the snapshot; we already store the time series.

5. **GRC connectors (Vanta / Drata / Secureframe)** — push the ledger as a custom-control evidence source.
   This targets the exact automation gap those vendors admit to, and it is distribution-through-partner
   rather than another logo to win from cold.

**Sequencing:** 2 → 1 → 4 → 3 → 5. The gate (2) is small, ships as a differentiator immediately, and
generates the evidence stream the Pack (1) sells.

---

## T2 — The `.ai/` standard, the doctor, and fleet remediation

**What already exists:** `docs/AI_MANIFEST_SPEC.md` v0.1.0 — a genuinely well-designed, vendor-neutral
spec (capabilities-not-tools, pointers-not-embeds, must-ignore-unknown, semver-additive, `generatedFrom`
drift detection, declared-then-proven). Plus `doctor.mjs` (zero-dep executable conformance, 7 check
classes, hard-fails on tracked secrets), `guardrails.yaml`, the generated `.ai/` foundation, the Practice
Library with **leak-free templatized starters**, `practice-artifact.ts` + `github/write.ts` (already
opens PRs), the Skills Registry, and Org Memory.

The design principle in the user's own working rules — *controls shift left of CI; CI is only a hard
backstop* — is encoded in the spec's `controls.prePush` / `controls.ciHardPass` split. That is a real
opinion the market lacks.

### Five directions

1. **Publish the spec and become the reference validator.** Neutral home, versioned, propose through the
   **Agentic AI Foundation** alongside AGENTS.md/MCP. There is no schema for declaring gates, evals, MCP
   servers and ownership; AAIF is the venue and the vacuum is open *now*. Whoever's validator is
   canonical owns the category regardless of who wins the scoring war.

2. **`npx ascent doctor` — default-on, offline, no account.** The Scorecard lesson is explicit: badges
   did not drive its 1M-repo dataset — **the GitHub Action, the API, and ecosystem mandates did.** Ship
   the doctor as a free CI Action + pre-push hook that scores locally and never phones home. The paid
   product starts where a single repo can't answer: fleet aggregation, trend, cross-repo comparison.

3. **Fleet remediation PRs — beat Factory to its own roadmap.** Factory's remediation is "Coming Soon";
   ascent already writes practice-artifact PRs. Extend to *batched, org-scoped* application: "these 8
   repos lack agent guidance → open 8 PRs, each tailored from **your own exemplar repo's shape**, no
   proprietary code travelling." This is the single feature that converts a report into a purchase order,
   and the leak-free templatization is a genuinely hard thing we already solved.

4. **The multi-format arbiter.** Every real fleet now carries `AGENTS.md` + `CLAUDE.md` +
   `copilot-instructions.md` + `.cursorrules` + MCP config, drifting apart silently. Detect
   *contradiction and staleness across them*, nominate one canonical source, generate the projections.
   Nobody does this; every fleet with >1 AI vendor has the problem; it is pure signal work on data we
   already fetch.

5. **Capability conformance for the agent layer** — validate declared MCP servers against the official
   MCP Registry (namespace-verified), score skill-library health and drift, and feed verified capabilities
   into Org Memory so agents get the org's *proven* commands rather than aspirational ones. Ties the
   Skills Registry and Org Memory (currently orphaned value) into the standard's spine.

**Sequencing:** 2 → 3 → 1 → 4 → 5. Distribution first, monetizable remediation second, standards
politics third (it's slow and only pays once there's usage to point at).

---

## T3 — Fleet & portfolio intelligence

**What already exists:** org rollups, per-dimension fleet signals, gap analysis (**common org gap vs
repo-specific outlier** — the org-problem/repo-problem split), movers & regressions, period comparison,
forecast/trajectory, contributor + CODEOWNERS team rollups, bus-factor & key-person flags, segments,
Executive Briefing + PDF, white-label branding, the investment simulator, `/portfolio` (fleet-of-fleets)
and `/leaderboard`, watchlists including entries for repos that no longer exist.

Factory's org view is one number. This is the widest gap between ascent and the named competitor.

### Five directions

1. **Technical due diligence as a packaged engagement.** No install, no telemetry, no seats — point it at
   an org and produce process quality, team quality/bus factor, AI-code exposure, security posture, and
   a fleet distribution. The manual alternative is **$25k–$50k** (asset-light) to **~$110k** (full scope);
   Sema is the only automated pure-play and its "process quality"/"team quality" pillars map almost 1:1
   onto surfaces ascent already ships. Highest per-unit price in the entire sweep, and structurally
   unavailable to seat-priced incumbents that require integrations.

2. **The benchmark corpus as the compounding asset.** Percentile by stack / size / archetype against the
   public-scan corpus, with a published methodology. This is the only asset that grows with usage and
   that Factory cannot replicate without our breadth. *Precondition:* fix the GitHub-native scoring bias
   first (the golang-floor issue in `REFERENCE-SCAN-AUDIT.md` is claimed fixed but **never re-scan-validated**) —
   a percentile computed on a biased corpus is worse than no percentile.

3. **Sell the quadrant, not the score.** Everyone reports a single number or single-axis usage. Nobody
   sells **Adoption × Rigor**, and *"Fast & Ungoverned"* is the exact story a CTO needs and cannot get
   elsewhere. Make the quadrant the headline of the Executive Briefing, name the ungoverned repos, and
   let the number support it rather than carry it (this is D28 from `VALUE-CASE.md`, still undecided).

4. **Agent-admission control.** Convert scoring into an operational decision: "which of my 900 repos are
   safe to let agents into?" → a ranked admission list with a per-repo policy (agents allowed /
   assisted-only / blocked), exportable to org rules and to the T1 gate. This is the CISO-framed version
   of the same data and the one the research flagged as the fleet question nobody answers.

5. **Cost-joined investment simulation.** Extend `orgsim` + `forecast` with the Provider Integrations
   spend data: *"closing D8 across these 12 repos costs $X and buys level Y in Z quarters."* The AI-ROI
   vendors cannot do this — they have spend but no practice model. We have the practice model and the
   spend join is already scaffolded. **Do not lead with ROI** (five funded vendors, free upstream data,
   and a publicly contested evidence base — METR found experienced devs 19% *slower* while perceiving a
   20% speedup); use it only as the closing arithmetic on a T3 recommendation.

**Sequencing:** 3 → 1 → 4 → 2 → 5. The quadrant reframe is copy + layout on shipped data; DD packaging is
the fastest revenue; the corpus needs the bias fix before it can be claimed.

---

## Cross-cutting risks

| Risk | Read |
|---|---|
| **Factory ships remediation + org dashboards** | Likely within 2 quarters. Defend on *neutrality* (we have no agent to upsell — the only credible referee for a fleet running Copilot + Claude Code + Cursor at once) and on *fleet depth*, never on the score. |
| **GitHub ships a free "agent readiness" tab** | Treat as likely within 12 months given the Jun 2026 Copilot-code-review AGENTS.md integration. Defend on multi-vendor fleet + the audit artifact. |
| **Atlassian folds DX AI measurement into Compass/Bitbucket at zero marginal price** | Reinforces "don't lead with ROI." |
| **Pricing anchor** | Buyers will anchor on the $19–48/dev/mo review-bot band and Factory's $20 seat. **Price per repo/org/engagement, not per seat** — a periodic assessment is a weak seat-consumption story. |
| **Engine credibility (from `tiger/`)** | Two open items gate any externally-anchored number: the public tier still runs an **unbenchmarked** cheap model (P2-6, `gemini-3-flash` predicted ≈ haiku, which *failed* the must-pass panel), and re-scan wobble has **no noise floor** (P2-7) — a T1/T3 buyer who sees an unchanged repo's score move once will not buy the evidence story. Fix both before selling T1. |

## The three sharpest next moves

1. **Ungoverned-AI-change gate** (T1-2) — small, deterministic, uses the shipped gate, and lands the one
   genuinely unowned slice in the market.
2. **Fleet remediation PRs** (T2-3) — beats Factory to its own published roadmap using code that exists.
3. **Quadrant-first Executive Briefing** (T3-3) — copy and layout over shipped data; makes the pitch
   differentiated before a single new feature ships.
