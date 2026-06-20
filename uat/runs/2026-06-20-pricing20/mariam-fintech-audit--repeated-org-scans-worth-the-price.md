# L1 — Mariam (fintech audit lead) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional** — the recurring fleet read completes and is genuinely useful, but the one control she's deciding the upgrade on (**`retentionDays`**) is **dead metadata**, and the audit/history export is **not tamper-evident** — both major for an examiner-evidence job, both L2-eligible.

## Reachable surface set (tier-honest, Team)

Under `ASCENT_AUTH_BYPASS=1` on a populated org she renders as a synthetic owner, so every `/org/*` route paints. At **Team** her entitlements are: 500 private scans/mo (`includedCredits:500`, `plans.ts:52`), segments+comparisons, playbooks+planning, 10 seats, **365-day retention** (`plans.ts:51`). Reachable & tier-included:
- **Overview** `/org/[slug]` — fleet number, posture quadrant, **Trajectory** (`Trajectory.tsx` ← `forecast.ts`), **movers/period deltas** (`PeriodSummary.tsx`, `org-rollup.ts`), D9 dim average.
- **Executive** `/org/[slug]/executive` + **Briefing share** (`briefing-share.ts` — the one HMAC-signed surface).
- **Trends** `/trends` + **history CSV export** `/api/history?format=csv` — the rear-view artifact she'd attach.
- **Segments + comparisons** (Team-included) — fleet slicing for the pack.
- **Usage/spend** `/usage` — credit burn (P×C); **Pricing** `/pricing`.
- Cadence machinery (scheduled rescans, alerts, digest) — Pro+, so tier-included for her.

**By-tier / not-her-decision:** Enterprise "custom retention" (`retentionDays:null`, `plans.ts:61`) is the upsell she's weighing — but see finding MAR-L1-01: it's phantom on *both* tiers.

## Surface-model notes (recurring-value affordances → file:line, grounding-audit emphasis)

- **Retention is decorative — the deciding control does not exist in code.** `retentionDays` is declared per tier (`plans.ts:31,41,51,61` = 30/180/365/null) and rendered on `/pricing`, but **no query or purge job reads it.** The real purge (`retention.ts:70-79` `resolveRetention`) reads only `Organization.retentionMaxScans` / `retentionAuditDays` — a **count-per-repo** policy (keep newest N scans) + an **audit-days** policy, both env/per-org, **opt-in, default 0 = keep everything** (`retention.ts:13,60-61,231`). The purge route confirms it (`cron/purge/route.ts:6-7`). Meanwhile the read paths apply only a **row-count** clamp, no plan-derived date floor: org trend/forecast `org-rollup.ts:220-227` (window comes from the UI, not the plan), per-repo history `scans-read.ts:138` (`Math.max(1, Math.min(200, … || 30))`). So Team's "365-day history" neither *limits* lookback (any tier sees as far back as data exists, capped at 200 rows) nor is *enforced* as a floor. The "365 vs custom" upgrade axis is buying air on both sides.
- **D9 (Supply Chain & Security) is well-specified and evidence-anchored** — `model.ts:147-156`: weight 0.09, axis rigor, criteria enumerate SAST/SCA/secret-scan/container-scan/SBOM/signing/SECURITY.md as concrete repo signals. The *definition* is examiner-grade; whether the *score* is stable across re-scans is the open L2 question (it rides the ±25 LLM guardband like every dimension).
- **Move-is-real defense exists but is thin and not co-located with D9.** `forecast.ts` needs ≥2 distinct calendar days, returns null otherwise, with `FLAT_PER_WEEK=0.5` noise floor + R² as "trend confidence." That R²/flat-floor is the *only* signal separating real movement from guardband wobble — and it lives on the Overview trajectory, not on the per-dimension D9 read she'd cite. A D9 score that breathes ±25 on an unchanged repo has nothing flagging it as noise where she'd look.
- **Period deltas are honest** — `computeWindowDeltas` (`org-rollup.ts:130-145`) is cohort-matched (only repos on both sides of the window), so onboarding repos don't fabricate movement. Good machinery; a genuine strength for the recurring read.
- **Audit trail is append-by-convention, NOT tamper-evident.** `AuditLog` (`schema.prisma:382-396`) is a plain table: `id, orgId, actorId, action, meta(JSON), at` — **no hash, no prev-hash chain, no signature, no integrity column.** `recordAudit` (`scans-audit.ts:14-40`) just inserts a row. The history CSV export (`api/history/route.ts:104-112`) is unsigned `text/csv`. The only HMAC in the recurring set is the *briefing share token* (`briefing-share.ts:33-36`), which signs a share link, not the evidence. Per the 2026 TSC bar (hash + append-only), an examiner could reject the export as un-attestable.

## Findings

```json
[
  {
    "id": "MAR-L1-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "mariam-fintech-audit",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "`retentionDays` is dead metadata — the 365-day/custom retention she's upgrading for is enforced by NO code path",
    "expected": "Her tier's retentionDays (365 on Team) governs how far the trajectory/history can look back and/or what's purged — an enforced, attestable control she can put in an examiner pack and a real differentiator for the Enterprise 'custom retention' upgrade.",
    "got": "retentionDays is declared in PLAN_FEATURES and shown on /pricing but read by no query or purge. Real purge (resolveRetention) reads only Organization.retentionMaxScans (count-per-repo) and retentionAuditDays — opt-in, default 0 = keep everything. Read paths apply only a row-count clamp (200), no plan-derived date floor. So '365-day history' neither limits lookback nor is enforced; Team and Enterprise are indistinguishable on the one axis she's deciding.",
    "evidence": [
      "src/lib/plans.ts:31,41,51,61",
      "src/lib/db/retention.ts:13,60-61,70-79,231",
      "src/lib/db/org-rollup.ts:220-227",
      "src/lib/db/scans-read.ts:138",
      "src/app/api/cron/purge/route.ts:6-7"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "On a populated org with a >365-day-old scan, confirm it still enters the Team trajectory fit AND is not purged — proving retentionDays gates nothing in either direction.",
    "suggested_acceptance": "Either enforce retentionDays as a date floor in the history/trend/purge queries (so Team really caps at 365 and Enterprise really extends), or remove the per-tier 'N-day history' / 'custom retention' claims from /pricing so the control she's buying is honest."
  },
  {
    "id": "MAR-L1-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "mariam-fintech-audit",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Audit log + history export are append-by-convention, not tamper-evident — examiner can't attest the recurring record wasn't altered",
    "expected": "The recurring evidence (audit trail + history CSV) carries integrity protection — per-entry hash / append-only / signature — so a re-pulled artifact is defensible to an examiner per the 2026 TSC tamper-evident-logging bar.",
    "got": "AuditLog is a plain mutable table (id, orgId, actorId, action, meta, at) with no hash, prev-hash chain, or signature; recordAudit just inserts a row. The history CSV export is unsigned text/csv. The only HMAC in the recurring set signs the briefing SHARE LINK, not the evidence. Any DB-level mutation of meta/at is undetectable.",
    "evidence": [
      "prisma/schema.prisma:382-396",
      "src/lib/db/scans-audit.ts:14-40",
      "src/app/api/history/route.ts:104-112",
      "src/lib/briefing-share.ts:33-36"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Export the history CSV and the audit log; confirm there is no integrity field/signature anyone could verify the artifact wasn't edited after the fact.",
    "suggested_acceptance": "Add per-entry integrity to AuditLog (hash chain or signed rows) and a signature/checksum to the history export, OR document explicitly that the artifact is not examiner-grade evidence."
  },
  {
    "id": "MAR-L1-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "mariam-fintech-audit",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "No noise defense co-located with the D9 score — a re-scan wobble within ±25 reads as a real supply-chain regression in the evidence pack",
    "expected": "Where the D9 (Supply Chain & Security) score and its per-cycle move are shown, the read distinguishes real movement from LLM guardband noise (R²/flat-floor or provenance), so she doesn't cite a phantom regression to an examiner.",
    "got": "The R²/flat-floor noise defense lives only on the Overview trajectory (forecast.ts, FLAT_PER_WEEK=0.5, R² as 'trend confidence'); the per-dimension D9 read carries no such signal. The score is LLM-guardbanded ±25 and blended 60/40, so an unchanged repo's D9 can move with nothing flagging it as the model breathing.",
    "evidence": [
      "src/lib/maturity/forecast.ts",
      "src/lib/scoring/engine.ts",
      "src/lib/maturity/model.ts:147-156"
    ],
    "code_check": "present-but-missed",
    "verdict": "uncertain",
    "l2_priority": "Re-scan an unchanged fintech repo twice under claude-cli; measure D9 movement and confirm whether anything in the UI flags it as noise vs. a real change. This is the crux of whether the cycle is evidence or weather.",
    "suggested_acceptance": "Surface the flat-floor/confidence (or a re-scan delta-vs-noise band) on the per-dimension move, not just the overall trajectory."
  },
  {
    "id": "MAR-L1-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "mariam-fintech-audit",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "Subscription $ for Team→Enterprise is invisible, and the one axis she's deciding on (retention) is 'Custom — contact us'",
    "expected": "Concrete enough price/retention legibility to decide the Team→Enterprise upgrade self-serve.",
    "got": "Pro/Team show only 'Prepaid — credits, 1 per private scan'; Enterprise retention is 'Custom — contact us'. Combined with MAR-L1-01, she can neither see the price nor verify the retention upgrade is real before a sales call.",
    "evidence": ["src/app/pricing/page.tsx", "src/lib/plans.ts:55-64"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "n-a (pricing display is intentional; fold into the upgrade verdict)."
  },
  {
    "id": "MAR-L1-05",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "mariam-fintech-audit",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "STRENGTH: D9 definition + cohort-matched period deltas are genuinely examiner-grade",
    "expected": "—",
    "got": "D9 (model.ts:147-156) enumerates concrete supply-chain signals (SAST/SCA/secret/SBOM/signing/SECURITY.md) — a defensible criteria narrative. computeWindowDeltas (org-rollup.ts:130-145) is cohort-matched so onboarding repos don't fabricate fleet movement, and the history append-only immutability + ETag (api/history/route.ts:116-128) is well-reasoned. The machinery she'd cite is sound — the defects are enforcement/tamper-evidence around it, not the read itself.",
    "evidence": ["src/lib/maturity/model.ts:147-156", "src/lib/db/org-rollup.ts:130-145", "src/app/api/history/route.ts:116-128"],
    "code_check": "by-design",
    "verdict": "confirmed"
  }
]
```

## Character feedback (first person, in her voice)

Would I renew Team? Probably — the fleet read is real and the D9 criteria are something I could put in front of an examiner. But would I *upgrade* to Enterprise for "custom retention"? **No — and that's the headline.** I went to verify the one control I'm buying, and `retentionDays` is a marketing string. Nothing reads it. The actual purge keeps the newest N *scans per repo* and defaults to keeping everything; my "365-day history" doesn't cap anything and Enterprise's "custom" doesn't extend anything that Team didn't already have. I'd be paying for air on both tiers. That's not a feature gap, that's a phantom control — and it makes me re-audit every other claim on the page.

Is each cycle telling me something new? Yes, structurally — cohort-matched deltas and a trajectory that needs real history are honest, and I respect that onboarding repos don't fake a climb. Do I trust a move is real? On the overall line, the R²/flat-floor gives me a defense. On the D9 score I'd actually cite — no. It can breathe ±25 on an unchanged repo and nothing tells me it's the model, not my supply chain. I'm not putting "security posture regressed 18 points" in an examiner pack when it might be weather.

Can I attest the record wasn't altered? No. The audit log is a plain table and the export is an unsigned CSV — the only signature in the whole product is on a share *link*. An examiner rejects that on sight; the 2026 TSC bar wants a hash chain or append-only with integrity. So the time-saving is illusory: I'd still hand-build the defensible version. Ascent saves me a couple hours as a pre-read, not the 14 I need to justify the line item. Would I tell a peer? "Great fleet read, but don't buy it as audit evidence yet, and don't pay up for retention — it's not enforced."

## Grounding score · time-saved · pricing verdict

- **Grounding: 4/6.** Of the recurring-context sources the read should use: trajectory/forecast (✔ renders, needs ≥2 days), cohort-matched movers/deltas (✔), D9 evidence-cited definition (✔), history/trends rear-view (✔ but row-count-bounded, not retention-bounded). **Missing the two she most needs:** (✘) tier retention as an enforced lookback/purge floor — phantom; (✘) tamper-evidence on the recurring record — absent.
- **Per-cycle time-saved (number): ~2 hours** *as it actually stands* (a useful pre-read), vs the **~14 hours** the design *promises* if retention were enforced and the export were defensible (her ~16h quarterly pack → ~2h). The gap between 2 and 14 is exactly MAR-L1-01 + MAR-L1-02.
- **Verdict: renew Team, do NOT upgrade.** One line: the Team fleet read earns its keep as a pre-read, but the Enterprise "custom retention" upsell is unenforced in code, so the upgrade buys nothing — and until the trail is tamper-evident, none of it is the examiner-grade artifact she's actually hiring it for.

## l2_priority carry-forward
1. **(top)** Confirm `retentionDays` gates nothing: on a populated org, a >365-day-old scan should still enter the Team trajectory and not be purged — proving the upgrade axis is phantom (MAR-L1-01).
2. Re-scan an unchanged fintech repo twice under `claude-cli`; measure **D9** movement and whether anything surfaces it as noise vs. a real regression (MAR-L1-03) — is the cycle evidence or weather?
3. Export the history CSV + audit log; verify there is no integrity field anyone could use to attest the artifact wasn't edited (MAR-L1-02).
