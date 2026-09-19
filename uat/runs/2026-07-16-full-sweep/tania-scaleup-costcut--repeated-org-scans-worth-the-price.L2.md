# L2 report — Tania (scaleup cost-cutter) × "Repeated org scans worth the price"

cert_level: L2 (live, browser-driven evidence — reasoned from `_L2-shared-pricing-evidence.md`, not re-driven)
date: 2026-07-16
source: `uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md` (live `vercel` org, `claude-cli` engine, real 21-day-labeled two-scan history)

---

## 1. Character voice — first-person reaction to the live evidence

"Alright, the live data backs up most of what I found reading the code, and it's genuinely reassuring in one place and worse than I expected in another.

The good news first: the noise band isn't theoretical. `vercel/ai` and `vercel/eve` were re-scanned live 21 days apart against the same commit — Δ0 overall on both — and the fleet rollup renders that as `→0` in a neutral tone, not a fake green hold. That's the 'is the model breathing or did the repo change' distinction I need, and it's confirmed with real numbers, not a demo. The executive briefing's 'Value this period' line is real too — '1 recommendation completed,' '0 of 2 repos moved,' scoped only to repos with enough history to compare, not padded with the single-scan mock repos. And pricing is finally a number I can paste into a sheet: Team is $20/month, derived from the same file the credit gate reads, so it can't drift out from under me. Three tabs, but three *real* tabs — pricing, usage burn, executive actioned-value — and I can build my $/actioned-move line in a few minutes.

Now the bad news, and it's worse than my code read suggested. I go to `/org/vercel/executive` — the exact surface with the 'Download PDF' and 'Copy briefing for LLM' buttons, the one a director forwards to a CFO without opening the app — and the Trajectory line reads 'At risk of slipping to L3 · Augmented in ~4 weeks (≈ 2026-08-13).' A specific date. No confidence line under it. Nothing. And this is the exact same low-data situation (n=2 scans) that the per-repo Trends page for the identical repo handles honestly with 'trend confidence — low data (n=2).' So the org overview handles noise correctly, the per-repo Trends page handles noise correctly, and the one surface that's actually built to leave the building unedited — the board briefing — goes silent instead of honest. That's not a nitpick for me. That is precisely the 'can I tell a real move from the model breathing' question my whole renewal call turns on, and it's on the document I'd literally hand the CFO. If I hadn't checked the per-repo page I'd have taken that dated ETA at face value.

I still can't answer my actual first question either — did a human on my team open this thing since March. Nothing in the live evidence shows a login/session signal appearing anywhere; the usage page is still scans, tokens, cost, credits, badge impressions. Proxy only.

**Verdict: renew (conditional), same call as before the live evidence — but with a more specific caveat.** The actioned-value and noise-band story is real and better than what I've cut in the past. But I'm now flagging the executive briefing's silent low-data ETA as its own line item, not folding it into the general 'no login signal' gap — it's a sharper, board-facing version of the same trust problem, and it's cheap for them to fix. My memo: 'Keeping Ascent on actioned-value evidence. Two open items before next renewal: (1) still no proof a human opened the dashboard, and (2) the exec briefing's ETA needs a low-data caveat before I'd forward it to Finance unedited.'

**Time saved: ~170 minutes per renewal cycle** (my ~3-hour manual reconstruction vs. the ~10 minutes it actually took to pull the three real numbers across pricing/usage/executive) — the bar is met, live, even with the new caveat."

---

## 2. Adversarial verification of L1 findings against live evidence

### L1-TANIA-01 — No human-engagement / last-active-by-a-person signal — **CONFIRMED (carried forward)**
The shared live evidence exercises `/usage`, `/org/vercel`, `/org/vercel/executive`, `/org/vercel/repositories`, `/pricing` in real depth (§1, §6, §7, §8) and never surfaces a login/session/dashboard-open metric anywhere — every number documented live is machine-counted (scans, tokens, cost, credits, badge impressions) or actioned-recommendation counts. Nothing in the live evidence contradicts L1's code-search finding that no `dashboard.viewed`/session-open event type exists. Not independently re-verified against the audit-log UI in this pass (the shared evidence didn't drive that specific screen), so treat the "no session telemetry" claim as carried from L1's static grep, not freshly re-confirmed at the DB layer — but nothing live surfaced to refute it either.
**Verdict: CONFIRMED.**

### L1-TANIA-02 — Cost↔value real but scattered across three screens — **CONFIRMED, live**
Live evidence independently hits all three screens with real numbers: Team $20/mo on `/pricing` (§5), credit burn vs. allotment framing on `/usage` (§6, demonstrated on Free but same `AllotmentPanel` component per L1's citation), and `recsActioned`/points-moved on `/org/vercel/executive` (§8: "1 recommendation completed," specific dimension numbers tying to the live heatmap in §9). No single consolidated screen exists in the live evidence. This matches L1's finding exactly and confirms the assembly is fast enough (a few minutes, well under her 10-minute bar) rather than eating the time-saved budget.
**Verdict: CONFIRMED.**

### Strength (L1, "valueRealizedLine is a well-grounded answer to her #2 criterion") — **CONFIRMED, live**
§8 shows this live and non-templated: the "move to make next" ties to this org's actual weakest dimensions (D4 Agentic 33, D9 Security 52, confirmed against the live heatmap in §9), and "Value this period" only renders when there's something to show. The noise-band `≈` rendering (L1's other strength claim) is also live-confirmed in §3 with a genuine Δ0 21-day-apart pair.
**Verdict: CONFIRMED, strengthened by live data.**

No L1 finding for this character is refuted by the live evidence.

## 3. New finding surfaced by the live evidence (Tania's specific angle)

**[NEW-TANIA-01, major]** — The executive briefing's Trajectory headline (the board/PDF/"copy for LLM" surface) renders a confident, dated ETA with **zero** confidence/low-data caveat when the underlying forecast has only 2 data points — while the per-repo Trends page, fed the identical `lowData` flag off the identical data, renders an honest "trend confidence — low data (n=2)" string for the same situation. Root-caused live to `src/lib/org/briefing.ts:242-248` / `forecastConfidenceNote()` returning `null` (which suppresses the *entire* line) instead of substituting the honest low-data string the per-repo component already has.

This lands squarely on Tania's senior-quality bar: *"flags a score move as real vs. within-noise before letting her count it as value... 'Last scan' dressed up as 'last active' fails it too"* — generalizes directly to "a dated ETA dressed up as a confident forecast fails it too," and it's on the one document (PDF/LLM-export) that leaves the building unedited. This sharpens — but doesn't replace — her general "I need real-vs-noise" criterion 3, which the fleet/repo-level rendering satisfies; the gap is specific to the exec-briefing export path.

**[NEW-TANIA-02, minor, unconfirmed for Team tier]** — §6 documents a `/usage` low-balance banner that fires ("next private scan will be refused") for any org with `creditBalance === 0`, regardless of whether its monthly allowance is untouched — demonstrated live on a Free-tier org. The underlying check (`creditBalance === 0 || (billable > 0 && creditBalance <= billable)`) is not plan-gated in the cited code, so it plausibly also misfires for a Team-tier org that has never purchased prepaid overflow credits (likely true of most Team orgs, including Tania's). Not driven live against a Team-tier org in the shared evidence, so this is a plausible extension, not a confirmed one — flagging as a watch item: if it does fire for Team, it directly contradicts the "Comfortably within your 500/mo Team allotment" copy on the same page and would read to Tania as exactly the kind of alarmist, machine-generated noise she distrusts.

---

## 4. Findings (structured)

```json
[
  {
    "id": "L2-TANIA-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "tania-scaleup-costcut",
    "cert_level": "L2",
    "type": "carried-forward",
    "severity": "major",
    "title": "No human-engagement / last-active-by-a-person signal anywhere in the app",
    "verdict": "CONFIRMED",
    "evidence_source": "_L2-shared-pricing-evidence.md §1,6,7,8 (no login/session metric surfaced across /usage, /org/vercel, /executive, /repositories)",
    "resolution": "open"
  },
  {
    "id": "L2-TANIA-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "tania-scaleup-costcut",
    "cert_level": "L2",
    "type": "carried-forward",
    "severity": "minor",
    "title": "Cost↔value at Team tier real but scattered across three screens (pricing / usage / executive)",
    "verdict": "CONFIRMED",
    "evidence_source": "_L2-shared-pricing-evidence.md §5 (Team $20/mo), §6 (AllotmentPanel), §8 (recsActioned/points)",
    "resolution": "open, under time-saved bar"
  },
  {
    "id": "L2-TANIA-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "tania-scaleup-costcut",
    "cert_level": "L2",
    "type": "new-finding",
    "severity": "major",
    "title": "Executive briefing trajectory ETA renders with zero confidence/low-data caveat on the board/PDF/LLM-export surface, unlike the identical per-repo Trends case",
    "verdict": "CONFIRMED",
    "evidence_source": "_L2-shared-pricing-evidence.md §4 (live /org/vercel/executive, code-confirmed src/lib/org/briefing.ts:242-248)",
    "why_it_matters_to_tania": "Directly violates her senior-quality bar of distinguishing a real score move from noise before it counts as value, on the exact surface (PDF/LLM export) most likely to reach the CFO unedited.",
    "resolution": "open"
  },
  {
    "id": "L2-TANIA-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "tania-scaleup-costcut",
    "cert_level": "L2",
    "type": "new-finding",
    "severity": "minor",
    "title": "Low-balance banner logic (creditBalance===0) is plan-agnostic in code and may misfire for Team-tier orgs with untouched allowance, not just Free",
    "verdict": "PLAUSIBLE",
    "evidence_source": "_L2-shared-pricing-evidence.md §6 (demonstrated on Free only; code not plan-gated)",
    "resolution": "open, not confirmed live for Team tier"
  }
]
```

---

**Verdict: L2-conditional-renew.** The live evidence upholds her actioned-value and noise-band trust criteria and confirms cost↔value is assemblable within her time-saved bar (~170 min saved per cycle). It does not resolve her primary blocker (no human-engagement signal) and surfaces a new, sharper trust gap on the exact board-facing export surface her renewal memo would use. She renews for now, with two flagged items for next cycle.
