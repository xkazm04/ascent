# L1 — Owen (HIPAA platform eng) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional.** Since the last L1 pass on this pair (`uat/runs/2026-06-20-pricing20/`), the codebase gained a real, in-product, self-serve **BYOM Bedrock settings page** (`/org/[slug]/settings`) — the single biggest gap the prior run flagged ("Bedrock is deployment-level Phase-2, no per-org toggle") is now **resolved in code**. The recurring-value machinery (trajectory/movers, guardbanded blend, engine provenance) remains engine-agnostic and honestly labeled. What keeps this off a clean pass: **`/pricing`'s own feature bullets never name BYOM/Bedrock** as the thing Enterprise buys (he'd have to already know to look in Settings), and there is still **no self-host/on-prem/open-weight option** for repos too sensitive even for a Bedrock BAA — mock is the only zero-egress floor, and it's thin.

## Reachable surface set (tier-honest)

Under `ASCENT_AUTH_BYPASS=1` on a populated `/org/<slug>` (second visit → local owner `Membership` seeded, `src/app/org/[slug]/layout.tsx`), Owen reaches the full `/org/*` set as a synthetic **owner** — including `/org/[slug]/settings`, which is owner-gated (`src/app/org/[slug]/settings/page.tsx:17` `hasOrgRole(slug, "owner")`) but visible in the nav to everyone (`OrgNav.tsx:118`, under "Govern"). This is load-bearing: it means an L1 model that only reads his declared `surface_binding` (`/connect`, `/org/[slug]`, `/trends`, `/usage`, `/pricing`, `ReportHeader`) would **miss the exact surface his JTBD #3 ("decide Pro vs Enterprise") points at** — Settings isn't in his binding list but is precisely where that decision resolves. Recorded as a surface-model note, not held against him.

- **Reachable & relevant:** `/connect` privacy notice, `/org/[slug]` Overview (per-repo trajectories + heatmap), `/org/[slug]/settings` (BYOM Bedrock config), `/trends`, `/usage` (credits + provider-mix), `/pricing`, the per-report engine chip.
- **Plan-gated but visibly so:** BYOM is Enterprise-only (`src/lib/plans.ts:177-180` `planAllowsByom`) and the Settings UI itself says so plainly with an upsell, not a dead control (`LlmProviderSettings.tsx:126-129`).
- **The real gate is no longer "does per-org Bedrock exist" — it's "is it advertised where he'd decide to pay for it."** `/pricing`'s Enterprise feature list (`plans.ts:69-80`) is `["Unlimited scans", "Unlimited members", "Custom retention", "Priority support"]` — **BYOM/Bedrock is absent from the list that's supposed to sell the tier**, even though it's the one feature this Character's entire JTBD hinges on.

## Surface-model notes (recurring-value + privacy affordances → file:line)

- **Inference-hop disclosure, in-product, per-engine, separated from persistence.** `ConnectPrivacyNotice` (`src/components/connect/PrivacyNotice.tsx:31-60`): "a budgeted sample of your repository's file contents (≤32 files) is sent to {provider}" with a precise `WHERE` map (`:15-23`) — Bedrock = "stays within the AWS boundary and is never used for model training," `claude-cli` = "stays on this machine," mock = "nowhere." Explicitly separates inference from persistence ("Ascent persists only the derived scores and evidence — never your source," `:40`). Ingestion cap: `MAX_FILES = 50` (`src/lib/github/source.ts:43`; the disclosure's "≤32" language is a documented rounder-number, the code cap is currently 50 — a small drift, noted below). **Strength.**
- **BYOM Bedrock is now a real per-org, self-serve control — the prior run's biggest gap is closed in code.** `src/app/org/[slug]/settings/page.tsx` renders `LlmProviderSettings` (`src/components/org/settings/LlmProviderSettings.tsx:118-224`): model/region/AWS-key form, write-only credentials (never round-tripped, `:4-6`), **test-connection-before-save** (`:67-95`, hits `/api/org/llm-provider/test`), enable checkbox, disable-and-clear. Plan-gated with an honest inline upsell string, not a silently-disabled ghost control (`:126-129`). Server side: `resolveByomProvider`/`isByomActive` (`src/lib/db/org-llm.ts:219-240`) fail closed — an active-but-unresolvable BYOM config **throws rather than silently falling back to the platform provider** (`src/lib/llm/index.ts:218-233`), so private source can never leak to the platform's own account by a decrypt failure. **Major strength, directly answers his JTBD #3.**
- **Engine-honest recurring read, reinforced at the per-repo level.** `engineProvider` persists per scan (`src/lib/db/scans-persist.ts:272`) and reads back through the comparable shape (`src/lib/db/scans-read.ts:186,211,366,945`); `/usage` groups by `engineProvider` for a provider-mix panel (`src/lib/db/usage.ts:138`, rendered `src/app/usage/usageDashboard.tsx:163-166`); the report chip shows `engine: {provider} · {model}` or a distinct **"Demo · deterministic rubric"** badge for mock (`src/components/report/ReportHeader.tsx:65-85`). The Overview's per-repo trajectory model goes further than the old org-wide movers list: `buildTrajectories` (`src/components/org/overview/repoTrajectory.ts:52-86`) computes `deltaCrossesEngine` per repo (`:61`, true when the window's first/last point used different engines) and `movedRepos`/`avgRealMove` **explicitly exclude** those deltas from "real movement" (`:162-173`) — so a mock→live (or provider-swap) transition can't get counted as maturity movement in the fleet aggregate. **This is stronger than the June-20 surface model recorded** (that pass only confirmed engine visibility, not this movement-integrity guard). Strength.
- **Recurring value is engine-agnostic — survives the swap.** The blend (`src/lib/scoring/engine.ts:70-106`) guardbands the LLM to the deterministic signal, coverage-weighted; a detector that failed or a dimension the LLM didn't score falls back to the signal floor rather than a fake 0. Trajectory is computed off persisted score history, not off a live model call. So Bedrock, mock, and cloud Claude all produce a renormalized number — confirmed unchanged from the prior pass.
- **No HIPAA over-claim.** `docs/features/scanning/llm-providers.md:1-11,63-68`: Bedrock is candidly labeled **Phase 2** infra, "Gemini ≠ enterprise path." `docs/ARCHITECTURE.md:149-163`: Bedrock is "in scope for SOC, ISO, GDPR, HIPAA, and FedRAMP High" (AWS's own compliance-program language about the *service*, not an Ascent "HIPAA-compliant" claim) and explicitly notes customers still own IAM/KMS/VPC. No instance of "HIPAA-compliant" found anywhere in docs or product copy. Clears his no-over-claim bar.
- **Price legibility improved for Pro/Team, still opaque for the tier that matters to him.** `/pricing` (`src/app/pricing/page.tsx:40-41`) now derives real `$10`/`$20` Pro/Team prices from `plans.ts` (no drift possible — same source the entitlement gate reads). But **Enterprise — the plan that actually gates BYOM — stays "Custom"/contact** (`plans.ts:74` `monthlyPrice: null`, `planPriceLabel` → "Custom, contact us"), and its own feature bullets don't even name the capability he'd be paying for.
- **Retention is not his binding constraint.** `retentionCutoff` (`src/lib/plans.ts:189-`) clamps org-rollup/history reads per plan (`src/lib/db/org-rollup.ts:396,557`): 180d (Pro) / 365d (Team) / unlimited (Enterprise). For a monthly cadence, 180 days is ~6 trajectory points — plenty.
- **Remaining gap: no self-host/on-prem/open-weight path.** Providers are `gemini | bedrock | openai | openrouter | claude-cli | mock` (`src/lib/llm/index.ts:1-22`). `openai` is an OpenAI-*compatible* endpoint (could technically point at a self-hosted gateway) but it's undocumented as a privacy option and the disclosure's enterprise guidance names only Bedrock (`PrivacyNotice.tsx:47-54`). `claude-cli` keeps code local but runs under a **personal Claude subscription** he can't put under a BAA and throws in production builds anyway (`llm/index.ts:39-60`). So for repos too sensitive even for a Bedrock BAA, the only zero-egress option remains the deterministic mock floor.
- **Mock floor: honest, but thin.** Labeled "Demo · deterministic rubric" unambiguously (`ReportHeader.tsx:65-71`), and dimensions fall back to `signalScore` with no LLM narrative. Repeatable and truthfully labeled, but at low repo velocity this is "the same signal numbers re-rendered," which is exactly the risk his Motivation section calls out.

## Findings

```json
[
  {
    "id": "owen-byom-settings-live",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "owen-healthtech-privacy",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "STRENGTH — BYOM Bedrock is now a real, self-serve, per-org control, resolving the prior run's core reachability gap",
    "expected": "As a 60-eng buyer I want to connect MY OWN Bedrock account for scans, in-product, without a sales call to just try it — and I want a misconfiguration to fail closed, not silently leak to the platform's shared engine.",
    "got": "src/app/org/[slug]/settings/page.tsx renders an owner-gated LlmProviderSettings form: model/region/AWS keys (write-only, never echoed back), test-connection-before-save, enable/disable. Server-side resolveByomProvider/isByomActive fail closed — an active-but-unresolvable BYOM config throws rather than falling back to the platform provider (src/lib/llm/index.ts:218-233). This directly closes the June-20 finding 'owen-bedrock-phase2-unreachable-at-pro' (Bedrock was deployment-level only).",
    "evidence": ["src/app/org/[slug]/settings/page.tsx:1-40", "src/components/org/settings/LlmProviderSettings.tsx:118-224", "src/lib/db/org-llm.ts:219-240", "src/lib/llm/index.ts:218-233"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "As an Enterprise-plan org, save+test real Bedrock creds via /org/<slug>/settings, run a private scan, and confirm the report's engine chip shows 'AWS Bedrock' and the org's own account/region — not the platform's shared Bedrock account."
  },
  {
    "id": "owen-pricing-omits-byom",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "owen-healthtech-privacy",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "/pricing's Enterprise feature list never names BYOM/Bedrock — the one feature his entire renewal decision hinges on is invisible on the page built to justify the spend",
    "expected": "When I open /pricing to decide Pro vs Enterprise, the Enterprise card should say the thing that actually unlocks my use case ('bring your own Bedrock / in-your-AWS-account inference') — not force me to already know to dig into org Settings to discover it exists.",
    "got": "PLAN_FEATURES.enterprise.features = ['Unlimited scans', 'Unlimited members', 'Custom retention', 'Priority support'] (src/lib/plans.ts:69-80). No mention of BYOM, Bedrock, or 'your own AWS account' anywhere on /pricing. The capability is real and well-built (see owen-byom-settings-live) but undiscoverable from the page whose entire job is to answer 'what does this tier buy me.'",
    "evidence": ["src/lib/plans.ts:69-80", "src/app/pricing/page.tsx:62-108"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Load /pricing fresh (no prior org visit) and confirm a HIPAA-context buyer has no way to learn BYOM/Bedrock exists without navigating into an org's Settings tab first.",
    "suggested_acceptance": "Add a bullet to Enterprise's feature list naming the BYOM/Bedrock capability (even just 'Bring your own Bedrock (BAA-ready)') so the privacy path is legible at the decision point, not just inside the product."
  },
  {
    "id": "owen-engine-honest-trend-reinforced",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "owen-healthtech-privacy",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH — per-repo trajectory now excludes mock↔live engine transitions from 'real movement,' not just labels the engine",
    "expected": "A repo whose score jumped only because it switched from the mock floor to a live engine must not be counted as fleet improvement — that's an engine artifact, not code getting better.",
    "got": "buildTrajectories computes deltaCrossesEngine per repo (repoTrajectory.ts:61); movedRepos/avgRealMove explicitly filter it out of the 'improving/slipping' denominator and the average-move aggregate (repoTrajectory.ts:162-173). Beyond just labeling the engine, the fleet-level movement stat itself can't be laundered by an engine swap.",
    "evidence": ["src/components/org/overview/repoTrajectory.ts:52-86", "src/components/org/overview/repoTrajectory.ts:162-173"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Seed one repo with a mock scan then a live re-scan; confirm the Overview's fleet 'improving' count and avg-move do NOT include that repo's engine-transition delta."
  },
  {
    "id": "owen-no-selfhost-beyond-bedrock",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "owen-healthtech-privacy",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "high" },
    "dimension": "missing",
    "title": "No self-host/on-prem/open-weight inference path for repos too sensitive even for a Bedrock BAA — mock is the only zero-egress floor",
    "expected": "For the handful of repos where even a signed Bedrock BAA isn't enough (max-sensitivity, PHI-adjacent core), I want an air-gapped or self-hosted-model option so I still get LLM nuance without any third-party network hop.",
    "got": "Providers remain gemini/bedrock/openai/openrouter/claude-cli/mock (llm/index.ts:1-22). 'openai' is OpenAI-compatible (could point at a self-hosted gateway) but is undocumented as a privacy path and unmentioned by the disclosure's enterprise guidance, which names only Bedrock. claude-cli is personal-subscription, non-BAA-able, and throws in production. So for max-sensitivity repos the only no-leak choice is the deterministic mock floor.",
    "evidence": ["src/lib/llm/index.ts:1-22", "src/components/connect/PrivacyNotice.tsx:47-54", "src/lib/llm/index.ts:39-60"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Confirm whether the openai-compatible provider is documented/supported as a self-hosted-gateway privacy path anywhere in-product; if not, this remains an open gap for max-sensitivity repos."
  },
  {
    "id": "owen-max-files-disclosure-drift",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "owen-healthtech-privacy",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "Privacy notice says '≤32 files'; the actual ingestion cap is MAX_FILES=50 — a precision claim that no longer matches the code it's meant to disclose",
    "expected": "Owen quotes exact numbers back ('≤32 files of what, sent where?') — a disclosure whose one hard number is stale reads as evasive to him even if directionally honest, because he WILL check it against source.ts.",
    "got": "ConnectPrivacyNotice.tsx:39 states '(≤32 files)'. src/lib/github/source.ts:43 sets MAX_FILES = 50, and workflow files get a RESERVED quota ON TOP of that cap (source.ts:699-708) — so the true per-scan ceiling can exceed 50 files, not 32.",
    "evidence": ["src/components/connect/PrivacyNotice.tsx:39", "src/lib/github/source.ts:43", "src/lib/github/source.ts:699-708"],
    "code_check": "present-but-broken",
    "verdict": "confirmed",
    "l2_priority": "Trigger a private scan on a workflow-heavy repo and count the files actually fetched (via logs/telemetry) to confirm it exceeds 32 and matches the true cap; then check whether the disclosure copy was updated after this run."
  },
  {
    "id": "owen-mock-floor-thin",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "owen-healthtech-privacy",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "senior-quality",
    "title": "Mock floor is honest but thin — fine as a labeled demo, not as the ONLY zero-egress engine for max-sensitivity repos",
    "expected": "If mock is genuinely my only no-leak option for the most sensitive repos, the recurring read there should still surface something new each cycle, or I should clearly understand I'm paying for a repeatable-but-flat number.",
    "got": "Mock derives every dimension from signalScore with no LLM narrative/discrepancy-catch; badge is unambiguous ('Demo · deterministic rubric', ReportHeader.tsx:65-71). Honestly labeled, by design — but at low repo velocity this is literally the same signal numbers re-rendered cycle over cycle.",
    "evidence": ["src/components/report/ReportHeader.tsx:65-71", "src/lib/scoring/engine.ts:104-107"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Re-scan an unchanged repo twice under mock; confirm the score is byte-stable and the demo label is unmissable, so a hollow-but-stable score can't read as senior LLM analysis."
  }
]
```

## Character feedback (Owen, first person)

"Same opening question every time: where does my code go, and who can train on it. `/connect` still answers that in-product — ≤32 files, named provider, inference kept separate from the persistence promise. Good — except I went and checked `source.ts` and the real cap is 50, not 32, with workflow files getting a reserved slot on top of that. That's a small thing, but it's exactly the kind of drift I flag pilots for: don't quote me a number you're not enforcing.

Here's the actual news since I last looked at this: **there's a real Settings page now.** `/org/<slug>/settings` — 'Bring your own model (Bedrock). Run scans on your org's own Amazon Bedrock — inference stays in your AWS account and region, billed to your AWS account. Enterprise plan.' Model ID, region, access key, secret key, a test-connection button that actually round-trips before I save, and if the config goes stale it *fails the scan*, it doesn't quietly fall back to the shared platform engine and leak my source there. That's the correct failure mode. Last time I looked at this app the honest verdict was 'the privacy story holds structurally but Bedrock is a deployment-level thing I can't reach as a buyer' — that gap is closed. This is now a product I could actually greenlight the Enterprise track for, in-product, without a six-week infra conversation first.

So why isn't this a clean pass? Because I only found the Settings page because I already knew, from the ARCHITECTURE doc and the code, that it should exist. If I were doing my Pro-vs-Enterprise budget review the way the journey says — sitting on `/pricing`, cold, deciding whether to renew — the Enterprise card tells me 'unlimited scans, unlimited members, custom retention, priority support.' It does not tell me 'bring your own Bedrock.' The one feature that actually gates my decision is invisible on the page whose entire job is to justify my decision. That's not a trust violation like an over-claim would be — it's a missed sale, and it means I'd have had to already trust the product enough to go digging before I found the reason to trust it more. Fix the order of operations: tell me on `/pricing`, then let Settings prove it.

The recurring-value machinery itself: still solid, actually reinforced. Every scan carries its engine, `/usage` shows me the provider mix, and now the per-repo trajectory explicitly throws out any delta that crosses an engine boundary — so a repo that jumped because it went mock-to-live doesn't get counted as the fleet 'improving.' That's a more careful guard than I noticed last time. I trust a move is real.

What's still missing, and probably always will be for me: something below Bedrock. For the two or three repos in our fleet that are genuinely too sensitive for even a signed BAA, my only zero-egress option is the deterministic floor — honestly labeled, repeatable, but it's not the senior read I'd pay a subscription for.

**Verdict: upgrade to Enterprise — and now with a real in-product path to get there, not just a promise.** Fix the pricing-page gap (name BYOM there) and I'd call this a clean recommendation to a regulated peer. As is: 'the machinery earned my trust, the settings page earned my confidence, but I had to already trust you to find the feature that justifies the price.'"

## Grounding score · time-saved · verdict

- **Grounding score: 7 / 9.** Recurring-value + privacy sources reaching the decision: (1) inference-hop disclosure per engine, (2) per-scan engine provenance + provider-mix, (3) engine-agnostic trajectory, (4) guardbanded blend (move-is-real defense), (5) per-repo movement excludes engine-transition deltas, (6) **reachable, self-serve BYOM Bedrock at his actual tier** (newly present this run), (7) honest HIPAA-eligible-not-compliant framing. **Missing:** (8) the capability isn't advertised on `/pricing` where the renewal decision happens, (9) no self-host/on-prem option below Bedrock for max-sensitivity repos.
- **Per-cycle time-saved (number): ~16 hours per monthly cycle** — replaces a ~2–3-day by-hand AI-adoption security/architecture memo with a ~15–20-minute review of the org overview + engine chip, unlocking a monthly cadence the manual process can't sustain. **Less conditional than the prior run:** the privacy-safe engine (Bedrock via BYOM) is now demonstrably reachable in-product at Enterprise, not just documented as existing — so the saving is closer to "real if he upgrades" rather than "real only in theory." Still zero if he's stuck on the mock floor for his most sensitive repos.
- **Renew/downgrade/churn/upgrade: UPGRADE (to Enterprise), less conditionally than before.** One-line reason: the privacy path he needs now has a real, fail-closed, self-serve on-ramp (BYOM Settings) — the prior run's core reachability blocker is resolved in code — but he'd only find it by already trusting the product enough to dig past `/pricing`, which is the one place that gap should close next.

## l2_priority carry-forward

1. **BYOM end-to-end:** on an Enterprise-plan org, save + test real Bedrock creds via `/org/<slug>/settings`, run a private scan, confirm the report's engine chip shows the org's own Bedrock account/region (not the platform's).
2. **Fail-closed on BYOM breakage:** simulate an unresolvable BYOM config (bad `ENCRYPTION_KEY` rotation) and confirm the scan throws rather than silently routing through the platform provider.
3. **Movement-integrity guard:** seed one repo mock-then-live; confirm the Overview's "improving" count and avg-move exclude that repo's engine-crossing delta.
4. **File-cap disclosure:** trigger a scan on a workflow-heavy repo and count files actually fetched; confirm it exceeds the disclosed "≤32" and check whether the copy has since been corrected to match `MAX_FILES=50`.
5. **`/pricing` cold read:** load `/pricing` with no prior org visit and confirm there is genuinely no mention of BYOM/Bedrock before Settings.
6. **Mock floor stability:** re-scan an unchanged repo twice under mock; confirm byte-stable score and an unmissable demo label.
