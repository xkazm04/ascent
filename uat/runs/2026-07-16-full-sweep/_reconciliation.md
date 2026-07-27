# Reconciliation sweep — `uat/runs/2026-07-16-full-sweep/`

Cross-surface consistency pass over every `*.md` report written this run (35 L1 + 27 L2, 22 Characters,
3 journey families: `repeated-org-scans-worth-the-price` (pricing-20 panel on the `vercel` org),
`prove-and-track-fleet-maturity` / `are-we-keeping-up` / `understand-my-team` (fleet/roadmap), plus the
governance/testing/buyer journeys). Per the uat skill's reconciliation-sweep step: pick shared concepts
that recur across surfaces this run touched, trace each across every surface that uses it, assert
agreement, emit disagreement as `type: trust`.

Method: `grep`-driven extraction of each candidate concept's stated value across all reports, then
read-in-context at every distinct value found, then checked against the source-of-truth code
(`src/lib/maturity/model.ts`, `src/lib/plans.ts`) where available.

---

## Concepts checked — clean (no mismatch)

1. **Pricing table** (Free $0/5 scans/1 seat/30d, Pro $10mo/100/3/180d, Team $20mo/500/10/365d,
   Enterprise Custom/Unlimited/Unlimited/Custom). Traced across `_L2-shared-pricing-evidence.md` §5 and
   ~20 independent Character L2 reports (arjun, kenji, klaus, mariam, priyanka, sasha, theo, victor,
   yusuf, sofia, tania, lena, gabriel, helena…) — every restatement matches exactly. One apparent outlier
   (gabriel's "$48/mo at 1200 scans") is explicitly his own back-of-envelope arithmetic for the
   unpriced Enterprise tier ("my own arithmetic, not the product's, and probably wrong at real
   Enterprise volume") — not a product-surface claim, so not a mismatch.
2. **`SCORE_NOISE_BAND = 2`** constant, cited ~17 times across L1/L2 reports discussing trajectory/delta
   rendering — value agrees everywhere it's quoted.
3. **Retention per tier** (30d / 180d / 365d / Custom) — consistent everywhere cited.
4. **Fleet-level numbers for the `vercel` org** — masthead `vercel · L4 · 72 · OWNER` (dana, x2),
   Overview cohort splits `AI-Native · 4 · avg 79` / `Solid but Manual · 2 · avg 59` (dana, elena —
   independently observed, agree with each other), and the fleet dimension-average heatmap in
   `_L2-shared-pricing-evidence.md` §9 (AI Tooling 62 / Testing 90 / CI·CD 95 / Agentic 33 / Docs 68 /
   Quality 86 / Commits 87 / AI Process 74 / Security 52) — re-cited identically by camille, tania,
   sasha, theo when referencing the same "weakest dimensions" fact. 72 (fleet) vs 79/59 (cohort
   subsets) are different aggregations of the same 6 repos, not conflicting numbers.
5. **Governance gate pass rate for `vercel`** — priya's "Active policy" run (`rate 50%, 3/6 passing,
   Minimum overall level L3, every dimension ≥ 40`) and raj's independent read (`Gate pass rate 50%
   (3/6). Failing: v0-sdk (3 conditions), next.js (1 — D4 Agentic 15, below 40), ai (1 — D4 at 35)`)
   agree on the headline rate and are mutually consistent on which repos fail and why.
6. **Usage-page engine mix** (`Claude CLI 4 · 50%, Mock 4 · 50%`) — single canonical source
   (`_L2-shared-pricing-evidence.md` §6), re-cited without alteration by victor's L2 report.
7. **vercel/ai two-scan trajectory numbers** (D4 35→36, overall 80→80 Δ0) in
   `_L2-shared-pricing-evidence.md` §2 — independently corroborated by raj's governance read
   ("`ai` … D4 at 35"), same figure.
8. **Product name casing** (Ascent/ASCENT/ascent) varies by prose position only — ordinary sentence-case
   variation, not a factual disagreement; not treated as a finding.

## Concepts checked — mismatch found (emitted as findings below)

9. **Maturity-level taxonomy name for "L4"** — MISMATCH (see Finding A).
10. **Per-repo D4 (Agentic Workflows) score for `vercel/next.js`** — MISMATCH (see Finding B), and this
    is the strongest finding of the sweep: it triangulates across *three* independent surfaces/reports.
11. **Per-repo D9 (Security) score for `vercel/next.js`**, within a single report's own live-test
    narration — MISMATCH (see Finding C).
12. **D7 dimension's short name**, in one illustrative (non-data) example — minor mismatch (see
    Finding D).

---

## Finding A — `type: trust` — L4 maturity-level name: "Integrated" (canonical) vs "Managed" (quoted in two L1 reports)

**Source of truth:** `src/lib/maturity/model.ts:64-67` — `{ id: "L4", name: "Integrated", band: [65,84], tagline: "Agents in the loop, not just at the keyboard" }`. There is no level named "Managed" anywhere in the level table (`L1 Manual, L2 Assisted, L3 Augmented, L4 Integrated, L5 Autonomous`).

**Surfaces that get it right (majority, ~8+ independent citations):** `_L2-shared-pricing-evidence.md` §3 (`"Holding around 80 (L4 · Integrated)…"`), `elena-cto-founder--are-we-keeping-up.L2.md:25` (`"L3 · you → L4 Integrated"`, `"~72/100 — enough to reach L4 Integrated"`), `klaus-embedded-firmware--...L2.md:104`, `priyanka-indie-solo--...L2.md:19`, `raj-devops-sre--...L2.md:77`, plus every `L3 · Augmented` citation (18+ reports) which correctly matches L3's real name.

**Surfaces that get it wrong:** two independent **L1 (theoretical)** reports both quote the same illustrative forecast-headline example using the wrong name:
- `camille-devtools-vendor--repeated-org-scans-worth-the-price.md:19` — *"On track to L4 · Managed in ~8 weeks (≈date) · trend confidence 62%"*
- `lena-seed-node-cto--repeated-org-scans-worth-the-price.md:20` — *"On track to reach L4 · Managed in ~8 weeks (≈ 2026-09-10)."*

Both cite the same code path (`forecastHeadline()`, `src/lib/maturity/forecast.ts:332-345`) as their source, so this reads as a shared drafting error (likely copied from one another or a shared scratch draft) rather than two independent misreads — but since neither report's corresponding **L2** pass re-quoted or corrected the name (lena's L2 report doesn't restate the level name at all; camille's L2 report doesn't either), the wrong name stands uncorrected in both L1 artifacts on record.

**Impact:** low-to-moderate — L1 reports are internal/theoretical work-product, not something a live user sees, so `reachability` is effectively n/a for an end user. But the two reports are part of this run's permanent record and would mislead anyone reading them as a reference for the taxonomy (e.g. a future Character-run author copying the "expected" string). `trust_erosion`: medium (it's exactly the kind of definitional drift the reconciliation sweep exists to catch — a level name should never vary run to run).

**Suggested resolution:** correct `camille-devtools-vendor--...md:19` and `lena-seed-node-cto--...md:20` to read "L4 · Integrated"; no product-code change needed — this is a report-authoring error, not a code defect.

---

## Finding B — `type: trust` — vercel/next.js D4 "Agentic Workflows" score disagrees 92 (landing register) vs 15 (fresh scan / gate / governance), triangulated across 3 sources

**Surface 1 — org landing/discovery register** (`tomas-prospective-buyer--evaluate-whether-to-adopt.L2.md:48`, `01-landing.text.txt`): vercel/next.js row shows `AI Tooling 72, Testing 93, CI/CD 78, Agentic 92, AI Process 87, avg 82, "as of 2d ago"`.

**Surface 2 — a fresh live scan of the same repo, minutes later** (same report, `05-scan-final.text.txt` / `07-dimensions-tab.png`): `D1=66, D2=99, D3=83, D4 Agentic Workflows=15, D8=90, overall=68`.

**Surface 3 — the live governance/gate page, same org, independently visited by a different Character** (`raj-devops-sre--delivery-and-governance-health.L2.md:24`): `/governance` lists `next.js (1 condition — D4 Agentic Workflows 15, below 40)` as a failing repo.

Surfaces 2 and 3 agree with each other (D4=15, gathered by two different Characters on two different report passes) and directly contradict surface 1 (D4=92) for the identical repo. This is not a rounding difference — it's a 77-point swing on the exact dimension both the fresh report and the governance page independently call out as the repo's weak point.

Tomas's own report (`code_check`) already traced the plausible root cause: the landing register is `unstable_cache`-backed with a stated TTL (`src/lib/db/scans-read.ts:566-572`), so surface 1 is most likely a stale cached snapshot of an older persisted scan row, not a live scoring bug — labeled `by-design caching behavior with an unintended trust side-effect`. Raj's independent D4=15 reading for the same repo (via the governance page, a third and separately-fetched surface) strengthens rather than weakens that read: it corroborates 15 as the current, real value, making the register's 92 look more clearly stale/wrong rather than a fluke of Tomas's specific test sequence.

**Verdict:** `confirmed` — the discrepancy is real, reproducible, and now cross-corroborated by an independent Character/report that never interacted with Tomas's session. Root cause: `uncertain` between the two candidates above, but "stale cache" is now the better-supported one given raj's agreement with the fresh-scan value rather than the register value.

**Impact:** `frequency`: low-med (a buyer who cross-references two pages, or — per this sweep — anyone comparing the discovery register against governance data); `reachability`: high (the landing register sits above the fold on the org's public-facing discovery surface); `trust_erosion`: high — a prospective buyer's very first impression of the org's weakest dimension is the wrong direction from what the org's own governance gate is failing repos on.

**Suggested resolution:** (already suggested in Tomas's report, reconfirmed here with the added corroboration) shorten or invalidate the register cache on fresh-scan completion for the affected repo, or visibly re-label register rows as a point-in-time snapshot rather than current-truth.

---

## Finding C — `type: trust` — vercel/next.js D9 "Security" score: "scored 40" vs "scored 20" within the same sentence of the same report

`oliver-qa-lead--drive-testing-maturity.L2.md:71` narrates a live gate-policy test: *"…set `minDimensionFor: {D9: 50}` against `vercel/next.js` (whose D9 **scored 40**) and the gate flipped from `pass:true` to HTTP 422, `pass:false`, with the exact failure message `"D9 Supply Chain & Security **scored 20**, below the required 50."`"*

The parenthetical paraphrase ("scored 40") and the literally-quoted API error string ("scored 20") name two different values for the same fact — vercel/next.js's D9 score — inside one sentence of one report. The quoted API string is the more trustworthy of the two (it's presented as a verbatim response, not a paraphrase), so 20 is the more likely-correct value, but the report itself never reconciles the two numbers, and no other report in this run states a D9 score for `vercel/next.js` specifically to independently arbitrate (the fleet-wide D9 average of 52 in `_L2-shared-pricing-evidence.md` §9 is an average across 6 repos and doesn't resolve which per-repo value is right).

**Impact:** `frequency`: low (single occurrence, internal to one report's narration, not a live user-facing surface); `trust_erosion`: medium — it's exactly the kind of self-contradiction that would undermine confidence in the surrounding "the gate mechanism works end-to-end" claim if a reader checked the numbers, even though the underlying claim (the enforcement mechanism works) is almost certainly still true.

**Suggested resolution:** the report should be corrected to state the score once, sourced from the quoted API string (20), and drop the inconsistent "40" paraphrase; no product-code implication.

---

## Finding D — `type: trust`, minor — D7 dimension mislabeled "Governance" in one illustrative (non-data) example

**Source of truth:** `src/lib/maturity/model.ts:142-143` — `D7 = "Commit & Velocity Signals"` (shorthand "Commits" is used correctly elsewhere, e.g. the fleet heatmap's "Commits 87").

`lena-seed-node-cto--repeated-org-scans-worth-the-price.md:22` gives a made-up illustrative example of a fleet-dimension-provenance sentence: *"e.g. 'D7 Governance +5 drove this quarter'"*. This is explicitly a hypothetical example (not a claimed live data point), but it mislabels D7 with a name ("Governance") that belongs to no dimension in the model — the closest real dimension names are D7 "Commit & Velocity Signals" or D9 "Supply Chain & Security" (sometimes informally called "security/governance" territory in other reports). No other report repeats this example or the wrong label, so this is isolated and low-impact, but it's the same class of definitional drift as Finding A and worth a one-line correction.

**Impact:** negligible — never repeated elsewhere, not a live-user-facing claim, but flagged per the sweep's mandate to record "checked, no mismatch" only for concepts that are actually clean.

---

## Summary

| # | Concept | Surfaces traced | Result |
|---|---|---|---|
| 1 | Pricing table (tiers/scans/seats/retention) | ~20 reports + shared evidence | clean |
| 2 | `SCORE_NOISE_BAND=2` | ~17 citations | clean |
| 3 | Retention days per tier | ~15 citations | clean |
| 4 | Fleet-level vercel numbers (72 / 79 / 59 / dim averages) | dana, elena, shared evidence, camille, tania, sasha, theo | clean |
| 5 | Governance gate pass rate (50%, 3/6) | priya, raj | clean |
| 6 | Usage engine mix (Claude CLI 4·50% / Mock 4·50%) | shared evidence, victor | clean |
| 7 | vercel/ai D4 35→36 trajectory | shared evidence, raj | clean |
| 8 | Product name casing | all | clean (stylistic only) |
| 9 | L4 level name | 8+ correct vs 2 wrong (camille L1, lena L1) | **mismatch — Finding A** |
| 10 | vercel/next.js D4 score | tomas (92 vs 15), raj (15) | **mismatch — Finding B** (strongest; 3-way triangulated) |
| 11 | vercel/next.js D9 score | oliver, self-contradictory | **mismatch — Finding C** |
| 12 | D7 short name | lena (illustrative only) | **mismatch — Finding D** (minor) |
