# L2 report — Camille (DevEx-analytics vendor PMM) × "Repeated org scans worth the price"

cert_level: L2 (live, evidence-grounded against `_L2-shared-pricing-evidence.md`, 2026-07-16 claude-cli run on `vercel` org) · reasoned from shared evidence, no independent browser drive.

---

## 1. Camille's first-person reaction to the live evidence

"I said in my L1 read that this wasn't a churn-vector product on the recurring axis, and mostly the live run backs that up — but it also just handed me the exact wound I'd have written a hypothesis for and then not found: a silent confidence drop on the one surface that leaves the building unedited.

Start with what held. The noise band is real in production, not just a well-commented function — `vercel/ai` and `vercel/eve`, two genuine independent claude-cli scans 21 real days apart on the same commit, render `→0` in a neutral tone on the Fleet rollup, not a fake ▲/▼. That's my #1 pet peeve pre-empted, live, with a real re-scan pair instead of a thought experiment. And the digest/alerts staying quiet on a flat cycle (`digestHasSignal`, `detectRegression` above the noise floor) means the push channel doesn't cry wolf either — that's the harder discipline, and it's confirmed in the same run. Annoyingly, that still retains.

Now the wound. My L1 read assumed the org-level trajectory headline was the one place her confidence number was safe — 'unlike the movers list, the org-level forecast has a `fitQuality` field.' The live run proves that assumption wrong in exactly the case that matters most: at `/org/vercel/executive`, the low-data trajectory ('At risk of slipping to L3 in ~4 weeks, ≈ 2026-08-13') renders with **zero** confidence caveat — not a hedge, not a 'low data' string, nothing. Meanwhile the per-repo `/trends?repo=vercel/ai` page, working off the identical `lowData` flag on the identical two-scan series, correctly prints `trend confidence — low data (n=2)`. Same data, two renderings, one honest and one silent — and the silent one is the board/PDF/LLM-export surface with a Download and a Copy-for-LLM button. That's not a cosmetic gap for me — that's the exact 'can I stake my name on this mover' question my whole criterion turns on, on the one page that's actually going to reach a CFO without a human editing it first. If I were pitching against this product next quarter, that's the screenshot I'd use: 'their board export can't tell you it's guessing.'

Second thing the live run surfaced that I didn't have a hypothesis for: the `/usage` page has a live self-contradiction. It tells a fresh Free-tier org with its full 5/mo allowance untouched — 0 private scans burned — that it's 'Out of private-scan credits, the next scan will be refused,' two inches above a second line saying 'Comfortably within your 5/mo Free allotment.' That's not noise-vs-signal, that's renewal-math-vs-itself. My criterion is 'the per-cycle cost↔value pencils out' — a banner that tells the customer they're about to be locked out when they're not is the opposite of pencils-out; it's the kind of thing that either panic-upgrades someone who didn't need to, or teaches them not to trust any banner on that page, which is worse for renewal math than showing no dollar figure at all.

What I couldn't check from this evidence: the cross-org percentile and the skills-catalog moat weren't exercised live in this run — this was a single-org seed (`vercel` only), so there's no second org to rank against, and nobody hit `/org/vercel/skills`. Those two stay exactly where L1 left them: real code, unconfirmed live. I'm not downgrading or upgrading my confidence in the moat itself off this evidence — I just don't get to cite it as 'verified live' yet.

Verdict for my VP: **renew watch, with two items escalated to 'fix before we stop worrying about it.'** The noise-honesty and the flat-cycle-silence are shipped and proven live — I'd still write 'their benchmark percentile is the one thing you can't out-execute without their tenant count' in the teardown deck. But I'm adding a new line: 'their board-facing trajectory and their usage page both have a live honesty seam right now — watch for a Q3 fix, because if they close it, the moat argument gets stronger, and if they don't, that's a wedge I can quote.' Time saved holds at my declared ~2–3 hrs/cycle for the org that trusts what it's reading — the leverage-moves section is real, specific, and repo-named, which is the new-actioned-decision bar I came in with. I'm just no longer certain every reader trusts what they're reading on the two surfaces that matter most to them."

**Verdict: renew** (watch-list, not full endorsement) — moat + noise-honesty dominate on the surfaces tested, but two live trust-eroding bugs on the highest-stakes surfaces (board export, renewal-math banner) are new churn vectors worth escalating.
**One-line reason:** the recurring read genuinely delivers a new actioned decision each cycle and the noise band is proven live, but the board-facing trajectory silently drops its confidence caveat exactly where a CFO would read it, and the usage page contradicts itself on whether the org is about to be locked out.
**Time saved:** ~2.5 hrs/cycle (within her declared 2–3 hr band; the leverage-moves/benchmark-adjacent read clears her ≥1-new-actioned-decision bar).

---

## 2. Adversarial verification of L1 findings against the live evidence

| L1 finding | L1 claim | Live evidence disposition | Verdict |
|---|---|---|---|
| **L1-CAMILLE-01** (cross-org percentile moat) | Strength — org-vs-org percentile, corpus-floor-gated at 5 peer orgs | Shared evidence's seed is single-org (`vercel` only, imported alone); no `getOrgBenchmark`/percentile output appears anywhere in the live evidence file. The L2-priority ("confirm a thin-corpus seed renders null, confirm multi-org seed differs per org") was **not exercised** — this run had no second org to rank against. | **Not tested — carried forward unverified.** Neither confirmed nor refuted; still a code-level PASS only. |
| **L1-CAMILLE-02** (repo-level movers lack fit-quality/R², implying org-level headline is safer) | Repo movers have no confidence number; org-level trajectory headline does (has `fitQuality`) | Live evidence directly **contradicts the "org-level headline is safer" half** of this finding: §4 shows the org-level trajectory headline itself renders with **zero** confidence note when `lowData` is true — `forecastConfidenceNote()` returns `null` silently instead of the honest "low data (n=X)" string the per-repo Trends page uses for the identical case. So the gap Camille flagged at L1 (repo-level movers lacking a confidence number) turns out to be the *milder* instance of a pattern that also breaks the org-level headline she thought was protected. | **CONFIRMED, and escalated** — worse than L1 assumed. Promoted to major/new in this L2 report (see §3 below). |
| **L1-CAMILLE-03** (/usage→/pricing bridge link hidden under `ASCENT_ALLOW_CREDIT_GRANTS=1`) | The one in-app path from burn-number to $-figure is coded to vanish in the pinned dev config | Shared evidence doesn't drive the `CreditsControl` "See plans →" link directly, so the specific code path isn't re-confirmed live. It DOES confirm the practical consequence is **less severe than L1 implied**: `/pricing` itself is public, unauthenticated, and always reachable with real numbers (§5) — a customer doing renewal math can open a second tab and get real $10/$20/Custom figures without the bridge link. The live evidence also surfaces a **more consequential renewal-math bug** on the same page the bridge link was supposed to help (§6, see new finding below). | **Not directly retested — partially mitigated.** The absence of the bridge link matters less than L1 feared (pricing is independently reachable), but a worse problem lives on the same page. |
| **L1-CAMILLE-04** (skills-catalog viewing-tier gating unclear) | Static read couldn't confirm whether the adoption-count catalog view (not just authoring) is plan-gated | `/org/vercel/skills` is not in the shared evidence's endpoint list or evidence index at all. | **Not tested — carried forward unverified**, exactly as L1 left it. |

**Net:** 1 finding confirmed-and-escalated (L1-CAMILLE-02), 1 partially mitigated but superseded by a worse cousin bug (L1-CAMILLE-03), 2 untestable from this seed (L1-CAMILLE-01, L1-CAMILLE-04, both single-org/skills-page gaps this run's evidence never touched).

---

## 3. Findings

```json
[
  {
    "id": "L2-CAMILLE-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "camille-devtools-vendor",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "NEW/escalated — Executive-briefing trajectory ETA renders with zero confidence caveat on low data, on the board/PDF/LLM-export surface, contradicting L1's assumption the org-level headline was protected",
    "expected": "Per her senior-quality bar, the trajectory she'd stake her name on citing to a VP needs an honest confidence read on thin data — exactly what the per-repo Trends page already does for the identical situation.",
    "got": "Live at /org/vercel/executive: 'At risk of slipping to L3 · Augmented in ~4 weeks (≈ 2026-08-13)' with zero occurrences of 'confidence' anywhere on the page (grep-confirmed). Root cause: src/lib/org/briefing.ts:242-248's forecastConfidence is suppressed to null on lowData, and forecastConfidenceNote() returns null (not an honest string) when confidence is null -- so the {...&&(<p>)} guard in executive/page.tsx:159-161 renders nothing. The identical lowData flag on the per-repo Trends page renders 'trend confidence — low data (n=2)'. The exported briefingMarkdown() (PDF/Copy-for-LLM) has the same null-guard, so the artifact a director forwards unedited is also silent.",
    "evidence": ["src/lib/org/briefing.ts:242-248", "src/app/org/[slug]/executive/page.tsx:159-161", "_L2-shared-pricing-evidence.md §4"],
    "code_check": "confirmed-live",
    "verdict": "CONFIRMED",
    "resolution": "open",
    "note": "Supersedes/escalates L1-CAMILLE-02: L1 assumed the org-level headline carried a confidence number the repo-level movers lacked. Live evidence shows the org-level headline can be equally silent under lowData — the exact surface she'd forward to a CFO."
  },
  {
    "id": "L2-CAMILLE-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "camille-devtools-vendor",
    "cert_level": "L2",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "NEW — /usage low-balance banner contradicts the adjacent allotment copy, directly undermining her price-legibility/renewal-math criterion",
    "expected": "The per-cycle cost↔value read must pencil out consistently on one screen for a customer to model their renewal.",
    "got": "Live at /usage?org=vercel (Free plan, 0 private scans, full 5/mo allowance untouched): a warning banner reads 'Out of private-scan credits — the next private scan will be refused (402) until you top up,' directly above/adjacent to 'Comfortably within your 5/mo Free allotment.' Root cause: usageDashboard.tsx's lowBalance check only inspects the prepaid overflow-credit balance (0 for any org that hasn't bought credits) and ignores usageThisMonth vs the monthly allowance, which is what the actual entitlement logic (plans.ts decideScanCharge) checks first.",
    "evidence": ["src/app/usage/page.tsx:142", "src/app/usage/usageDashboard.tsx:45-51", "_L2-shared-pricing-evidence.md §6"],
    "code_check": "confirmed-live",
    "verdict": "CONFIRMED",
    "resolution": "open",
    "note": "Relevant to L1-CAMILLE-03's territory (renewal-math legibility on /usage) but a distinct, worse bug than the bridge-link gap L1 flagged — a self-contradicting page is a stronger churn signal than a missing link, since /pricing is independently reachable anyway."
  },
  {
    "id": "L2-CAMILLE-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "camille-devtools-vendor",
    "cert_level": "L2",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "Cross-org percentile moat (L1-CAMILLE-01) and skills-catalog tier gating (L1-CAMILLE-04) remain unverified live — this run's seed had no second org and never hit /org/[slug]/skills",
    "expected": "L1's two moat/gating claims confirmed against a live multi-org or skills-page hit.",
    "got": "Shared evidence's live run seeded and scanned only the vercel org (2 live-rescanned repos + 4 mock, single org); no benchmark/percentile output or /org/vercel/skills hit appears anywhere in the evidence. Both L1 items stand exactly where L1 left them — real code, not live-confirmed.",
    "evidence": ["_L2-shared-pricing-evidence.md §1 (single-org seed methodology)", "_L2-shared-pricing-evidence.md evidence index (no skills/benchmark endpoints hit)"],
    "code_check": "not-exercised",
    "verdict": "PLAUSIBLE",
    "resolution": "open",
    "note": "Not a new gap — flagging that the moat claim she'd most want to lead a competitive deck with is still an L1-level claim, not L2-verified, after this run."
  }
]
```

---

## 4. Scored acceptance criteria — L2 disposition

| Criterion | L1 verdict | L2 (live-evidence) verdict |
|---|---|---|
| Recurring-value (anti-plateau) | PASS | **PASS, reconfirmed live** — Executive "Value this period," leverage moves, and digest silence-on-flat all verified live (§8). |
| Noise-vs-signal trust | PASS (with a seam re: repo-mover confidence) | **MIXED** — Overview/movers/digest noise-muting proven live and correctly neutral-toned (§3). But the seam is worse than L1 thought: the org-level headline itself is silently un-hedged on low data on the board surface (§4) — see L2-CAMILLE-01. |
| Non-replicable moat | PASS | **UNTESTED this run** — no benchmark/skills evidence in the single-org seed; claim stands unverified at L2. |
| Price-legibility (renewal math) | CONDITIONAL | **CONDITIONAL, new bug surfaces** — /pricing itself now legible (resolves the older invisibility finding), but /usage's self-contradicting banner is a fresh, more direct renewal-math trust wound (§6) — see L2-CAMILLE-02. |
| Stable-fleet floor | PASS | **PASS, reconfirmed** — Trends page's explicit "low data (n=2)" honest copy verified live (§3), which is exactly what makes the Executive page's silence on the same data (§4) stand out as an inconsistency rather than a universal gap. |

---

## Evidence index
All evidence drawn from `uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md` §§1–9 (live `vercel` org, `claude-cli` engine, 2026-07-16). No independent browser session was driven for this character-specific L2 pass, per instructions.
