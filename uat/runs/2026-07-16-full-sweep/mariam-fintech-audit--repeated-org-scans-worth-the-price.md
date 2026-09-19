# L1 — Mariam (fintech audit lead) × repeated-org-scans-worth-the-price

**Run date:** 2026-07-16. **Prior L1:** `uat/runs/2026-06-20-pricing20/mariam-fintech-audit--repeated-org-scans-worth-the-price.md` (2026-06-20). This run re-derives the surface model from current code — three of the five prior majors moved (two partially fixed, one confirmed still-open with sharper evidence), so this is a fresh, code-grounded pass, not a copy.

**Verdict: L1-conditional** — the recurring fleet read completes and is more defensible than it was a month ago (tamper-evidence and read-side retention enforcement both landed), but the control she'd actually cite to an examiner — the per-dimension D9 move — still renders with **no noise defense at the exact surface she'd look**, and the artifact she'd file (the CSV export) is **not** bounded by her tier's retention. Both remain major, both L2-eligible.

## Reachable surface set (tier-honest, Team)

Under `ASCENT_AUTH_BYPASS=1` on a populated org she renders as a synthetic owner, so every `/org/*` route paints. At **Team**: 500 private scans/mo (`includedCredits:500`, `src/lib/plans.ts:60`), segments+comparisons, playbooks+planning, 10 seats, **365-day retention** (`plans.ts:65`), **$20/mo** (`plans.ts:62`, now a real number — see MAR-L1-04). Reachable & tier-included:
- **Overview** `/org/[slug]` — fleet number, posture quadrant, **Trajectory** (`Trajectory.tsx` ← `forecast.ts`), **repos × time heatmap** (`RepoDimensionHeatmap.tsx`) with per-repo trajectories (`buildTrajectories`, `repoTrajectory.ts:52-86`), and the **per-dimension drill-in modal** (`RepoDimensionModal.tsx` → `/api/org/repo-dimension` → `DimensionDetail.tsx`) — this is where she'd check D9 specifically.
- **Executive** `/org/[slug]/executive` + **Briefing share**.
- **Trends** `/trends` + **history CSV export** `/api/history?format=csv` — the rear-view artifact she'd attach.
- **Audit** `/audit` (`AuditLogViewer.tsx`) + **audit CSV export** `/api/audit?format=csv`.
- **Segments + comparisons** (Team-included); **Usage/spend** `/usage`; **Pricing** `/pricing`.
- Cadence machinery (scheduled rescans, alerts, digest) — Pro+, so tier-included for her.

**By-tier / not-her-decision:** Enterprise "custom retention" (`retentionDays:null`, `plans.ts:77`) is the upsell she's weighing — see MAR-L1-01: it's now *partially* real, but the real-vs-air line doesn't fall cleanly on the Team/Enterprise boundary the way the pricing page implies.

## Surface-model notes (recurring-value affordances → file:line, grounding-audit emphasis)

- **Retention is now a real (partial) read floor — but not what she'd file, and not what governs deletion.** `retentionCutoff(plan, nowMs)` (`plans.ts:189-192`) is a genuine non-destructive read floor, now **consumed** by the org trend/trajectory query (`org-rollup.ts:396-397`) and the per-repo trajectory/heatmap history (`org-rollup.ts:557-558`, feeding `buildTrajectories`). So the **Overview trajectory and the heatmap's per-repo history are honestly clamped to her tier's window** — a real improvement over the June run. But: (a) **the CSV export she'd actually attach to the evidence pack** — `getRepositoryHistory` (`src/lib/db/scans-read.ts:227-270`), which backs `/api/history?format=csv` — applies **only a row-count clamp** (`Math.max(1, Math.min(200, …))`, `scans-read.ts:238`), no `retentionCutoff` import, no plan lookup; (b) the **real destructive purge** (`retention.ts:81-90` `resolveRetention`) still reads only `Organization.retentionMaxScans`/`retentionAuditDays` — a wholly separate, opt-in, default-0-keep-everything policy — never `retentionDays`. So nothing is actually *deleted* per the pricing page's per-tier window on any plan, and the filed artifact isn't bounded by it either. The "365 vs custom" axis is real for two on-screen reads and phantom for the export and the purge.
- **D9 (Supply Chain & Security) is still well-specified and evidence-anchored** — `model.ts:162-170`: weight 0.09, axis rigor, criteria enumerate SAST/SCA/secret-scan/container-scan/SBOM/signing/SECURITY.md as concrete repo signals. Unchanged from June, still examiner-grade as a *definition*.
- **The org built a real noise-defense primitive since June — and then missed the one surface she'd use.** `src/lib/maturity/noise.ts` (`SCORE_NOISE_BAND = 2`, `isWithinNoise`, `classifyDelta`) is now the canonical "is this a real move" primitive, wired into `alerts.ts:63,268`, the weekly digest (`cron/digest/route.ts:152-158`), `PeriodSummary`, and `repoTrajectory.ts` (`toneFor(deltaWindow)`). But the **per-dimension "since last scan" delta** — the exact number she'd read to judge whether D9 moved — is rendered by `DimensionDetail.tsx:22,31-35`: `delta = d.score - prevScore`, then `delta > 0 ? "▲+" green : "▼" red` for **any** nonzero delta, **not routed through `classifyDelta`/`fmtDelta`/`isWithinNoise`** even though those are one import away and used everywhere else in the same release. A D9 move of +1 (well inside the documented ±2 noise band, `noise.ts:6-8` cites a real re-scan measurement of ±1/dimension) reads as a confident green "regression fixed" or red "regression" in the one place she'd actually look — `RepoDimensionModal` → `DimensionDetail`, reached from the Repositories heatmap (`RepoDimensionHeatmap.tsx:118-127`).
- **Tamper-evidence is now real, not absent — with a ceiling.** `src/lib/db/audit-integrity.ts` adds a per-row HMAC (`_sig`, folded into `AuditLog.meta`, keyed by `AUDIT_SIGNING_SECRET`/`AUTH_SECRET`) written by `recordAudit`/`claimOrgAuditOnce` (`scans-audit.ts:29,112`), plus a file-level SHA-256 digest on both CSV exports (`x-ascent-content-sha256`: `api/history/route.ts:100-102`, `api/audit/route.ts:76`) and honest truncation headers (`api/audit/route.ts:58-80`, `x-ascent-truncated`/`x-ascent-row-cap`). Real progress: an examiner-defensible integrity story now exists in code. **Ceiling:** (a) signing is **inert without a configured secret** — `auditSecret()` returns null and `_sig` is silently omitted (`audit-integrity.ts:16-19`), the same silent-degrade shape as the old retention gap, and `AUDIT_SIGNING_SECRET` isn't mentioned in `uat/env.md`'s pinned `.env.local` set, so whether it's on in a given deployment is invisible from the surface model; (b) `verifyAudit` (`audit-integrity.ts:76-87`) exists and is unit-tested but is **called from no route or UI** — there is no self-serve "verify this export" affordance, so she can see a `_sig` blob in the raw meta JSON but has no way to independently confirm it herself; verification would be vendor-side only.
- **Price-legibility is meaningfully better.** `/pricing` now derives real numbers from `plans.ts`: Pro **$10/mo**, Team **$20/mo** (`plans.ts:50,62`, `planPriceLabel`, `pricing/page.tsx:40-41,45,56`) — the deciding Team number is no longer hidden behind "Prepaid — credits." Enterprise stays "Custom — contact us" (`plans.ts:74`, `pricing/page.tsx:25-28`), which is reasonable for a negotiated tier and no longer the *only* visible number on the page.
- **Period deltas are still honest** — cohort-matched window deltas (unchanged since June) so onboarding repos don't fabricate movement. Genuine strength, still holds.

## Findings

```json
[
  {
    "id": "MAR-L1-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "mariam-fintech-audit",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "The per-dimension 'since last scan' delta (where she'd read D9's move) skips the app's OWN noise-band classifier",
    "expected": "Where D9's per-cycle move is shown, it's classified against the documented ±2 noise band (src/lib/maturity/noise.ts) the same way the trajectory tone, digest regressions, and PeriodSummary already are, so a ±1 wobble never wears a confident green/red arrow.",
    "got": "DimensionDetail.tsx:22,31-35 computes `delta = d.score - prevScore` and renders `delta > 0 ? \"▲+\" (emerald) : \"▼\" (red)` for ANY nonzero delta. It does not import classifyDelta/fmtDelta/isWithinNoise, unlike alerts.ts:63,268, cron/digest/route.ts:152-158, and repoTrajectory.ts:80 (toneFor(deltaWindow)) which all route through the shared noise.ts primitive added since the prior run. This is the exact drill-in a Repositories-heatmap D9 cell click opens (RepoDimensionHeatmap.tsx:118-127 -> RepoDimensionModal.tsx -> DimensionDetail.tsx), so the one place she'd verify a D9 move is real is also the one place in the current codebase that DOESN'T apply the noise mute the team already built and shipped everywhere else.",
    "evidence": [
      "src/components/report/DimensionDetail.tsx:22,31-36",
      "src/lib/maturity/noise.ts:1-27",
      "src/components/ui/format.ts:33-44",
      "src/lib/alerts.ts:63,268",
      "src/app/api/cron/digest/route.ts:152-158",
      "src/components/org/overview/repoTrajectory.ts:80"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Re-scan an unchanged fintech repo twice under claude-cli; open its D9 cell in the Repositories heatmap and confirm whether a ±1 D9 wobble renders with the confident colored arrow (bug) or muted (fixed).",
    "suggested_acceptance": "Route DimensionDetail's delta through classifyDelta/fmtDelta so a within-noise per-dimension move mutes to the same '≈' slate treatment the trajectory/digest/PeriodSummary already use."
  },
  {
    "id": "MAR-L1-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "mariam-fintech-audit",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "retentionDays is a real read floor for two on-screen surfaces, but NOT for the CSV export she'd file, and NOT for what's actually purged — the tier boundary she's buying is inconsistent across the exact paths that matter",
    "expected": "Her tier's retentionDays (365 on Team) governs how far EVERY recurring surface she relies on can look back — including the filed CSV artifact — and/or what's purged, as one enforced, attestable control.",
    "got": "retentionCutoff() (plans.ts:189-192) is now a real, consumed read floor for the org trend/trajectory (org-rollup.ts:396-397) and per-repo trajectory/heatmap history (org-rollup.ts:557-558) — genuine progress since the June run. But getRepositoryHistory, the source of /api/history?format=csv (the artifact she'd attach to an evidence pack), applies only a row-count clamp (scans-read.ts:238, 1-200 default 30) with no retentionCutoff import or plan lookup. And the real destructive purge (retention.ts:81-90 resolveRetention) reads only Organization.retentionMaxScans/retentionAuditDays — an unrelated, opt-in, default-0-keep-everything policy — never retentionDays. So Team's '365-day history' bounds two dashboard reads, doesn't bound the file she'd hand an examiner, and governs no deletion on any tier — Enterprise's 'custom retention' buys nothing different in what's actually kept or purged.",
    "evidence": [
      "src/lib/plans.ts:189-192",
      "src/lib/db/org-rollup.ts:396-397,557-558",
      "src/lib/db/scans-read.ts:227-270 (esp. 238)",
      "src/lib/db/retention.ts:81-90",
      "src/app/api/history/route.ts:87"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "On a populated Team org with a >365-day-old scan: confirm the Overview trajectory clamps it (should — new fix) AND confirm the /api/history CSV export still includes it (should still leak — open gap) AND confirm it is not purged (should still not be purged — separate open gap).",
    "suggested_acceptance": "Thread retentionCutoff into getRepositoryHistory (or reject requests for a window beyond the plan's retention with a clear message), and either wire the destructive purge to retentionDays or stop implying the pricing page's window is what governs deletion."
  },
  {
    "id": "MAR-L1-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "mariam-fintech-audit",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "Tamper-evidence now exists (HMAC row signatures + SHA-256 export digests) but is silently inert without a configured secret, and has no self-serve verify path",
    "expected": "The recurring evidence (audit trail + history/audit CSV) carries integrity protection she can independently confirm wasn't altered.",
    "got": "src/lib/db/audit-integrity.ts adds a per-row HMAC (_sig in AuditLog.meta, scans-audit.ts:29,112) and a SHA-256 content digest header on both CSV exports (api/history/route.ts:100-102, api/audit/route.ts:76), plus honest truncation headers on the audit CSV (api/audit/route.ts:58-80) — real, substantive progress since June. Ceiling: auditSecret() (audit-integrity.ts:16-19) silently returns null (no signature written) when neither AUDIT_SIGNING_SECRET nor AUTH_SECRET is set, and that secret isn't in uat/env.md's pinned set, so whether it's live in a given deployment isn't visible from the surface model alone. verifyAudit() (audit-integrity.ts:76-87) is fully implemented and unit-tested but is called from NO route or UI — there is no button/endpoint she can hit to confirm a row's _sig actually verifies; she can only see the opaque _sig string in the raw meta JSON.",
    "evidence": [
      "src/lib/db/audit-integrity.ts:16-19,76-87",
      "src/lib/db/scans-audit.ts:17-50,91-129",
      "src/app/api/history/route.ts:100-102",
      "src/app/api/audit/route.ts:58-80",
      "uat/env.md (AUDIT_SIGNING_SECRET absent from the pinned .env.local list)"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Confirm AUDIT_SIGNING_SECRET/AUTH_SECRET is actually set in the running environment, export an audit CSV, and confirm a row's _sig recomputes correctly by hand (or via a to-be-added verify endpoint) — proving the control is live, not just coded.",
    "suggested_acceptance": "Pin AUDIT_SIGNING_SECRET in the deployment's required env (fail loudly if unset in prod, not silently degrade), and add a lightweight `/api/audit/verify` (or a verified-badge in the viewer) so she can confirm integrity herself instead of taking it on faith."
  },
  {
    "id": "MAR-L1-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "mariam-fintech-audit",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Price legibility improved — Team's $20/mo is now a real number; Enterprise stays Custom (by design)",
    "expected": "Concrete enough price/retention legibility to decide the Team→Enterprise upgrade self-serve.",
    "got": "plans.ts now carries monthlyPrice (Pro $10, Team $20) and /pricing renders it via planPriceLabel (pricing/page.tsx:40-41,45,56) instead of the prior 'Prepaid — credits' placeholder. Enterprise remains 'Custom — contact us' (plans.ts:74, pricing/page.tsx:25-28), reasonable for a negotiated tier. Combined with MAR-L1-01, she can now see her own tier's price but still can't verify the retention upgrade is real before a sales call.",
    "evidence": ["src/app/pricing/page.tsx:40-41,45,56", "src/lib/plans.ts:50,62,74"],
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
    "title": "STRENGTH: D9 definition, cohort-matched period deltas, and the new noise/tamper-evidence machinery are genuinely examiner-grade where they're wired",
    "expected": "—",
    "got": "D9 (model.ts:162-170) still enumerates concrete supply-chain signals. Cohort-matched window deltas remain honest. The org built two real pieces of infrastructure since June that directly answer her acceptance criteria in principle — a shared noise-band classifier (noise.ts) and cryptographic audit tamper-evidence (audit-integrity.ts) — and wired the noise classifier into most delta surfaces (alerts, digest, PeriodSummary, repo trajectories). The machinery is sound; the defects are two specific unwired/unenforced spots (MAR-L1-01, MAR-L1-03), not the underlying design.",
    "evidence": ["src/lib/maturity/model.ts:162-170", "src/lib/maturity/noise.ts", "src/lib/db/audit-integrity.ts", "src/lib/db/org-rollup.ts:130-145 (cohort-matched deltas, unchanged)"],
    "code_check": "by-design",
    "verdict": "confirmed"
  }
]
```

## Character feedback (first person, in her voice)

Would I renew Team? Yes — more confidently than last time, actually. Would I *upgrade* to Enterprise for "custom retention"? Still no, and here's why it's more frustrating this time, not less: someone clearly went and did real work since I last looked. There's a genuine read-floor now — my Overview trajectory and the heatmap history actually stop at 365 days for Team, I can see the code path. But then I go to export the thing I'd actually *file* — the history CSV — and it's still unbounded, row-count only. So the control I'm paying to extend on Enterprise governs two screens I look at and not the one document I hand to an examiner. That's worse than a clean phantom, it's a *half-enforced* one — I now have to remember which surfaces are trustworthy and which aren't, and nothing on the page tells me that.

Is each cycle telling me something new? Structurally, yes — same as before. Do I trust a move is real? Here's my sharpest complaint: you built the noise classifier. It's right there, `noise.ts`, ±2 band, wired into the digest and the trajectory tone and the period summary. I can see the commit history of care in this codebase. And then the one place I'd click — a D9 cell in the repo heatmap, to see "did this move since last scan" — renders a raw delta with a green arrow for +1. You solved this problem and then didn't apply the solution to the surface that matters most to my job. That's not a missing feature, that's an inconsistency, and inconsistency is worse for trust than absence — it tells me the fix landed by accident of which ticket touched which file, not by a principle someone enforced everywhere.

Can I attest the record wasn't altered? Better news here — there's a real HMAC per row now, and a SHA-256 over the export bytes. That's the right shape. But I can't verify it myself. There's no endpoint, no button — `verifyAudit` exists in your test file and nowhere else. So I'm back to trusting your word that the secret is configured and the signature is real, which is exactly the "trust me" posture the 2026 TSC bar exists to eliminate. It's a control I'd *describe* to an examiner as "vendor-attested," not "self-verifiable" — that's a real, but smaller, gap than before.

Net: the per-cycle read is a stronger pre-read than it was a month ago, and I'd say that to a peer. But I still wouldn't sign it as the examiner artifact. Ascent saves me maybe 4-6 hours now — up from 2 — but not the 14 I need, because the two things standing between "pretty read" and "audit evidence" are precise and both still open: the D9 move I'd cite can be noise wearing a green arrow, and the file I'd attach isn't bounded by the control I'm buying.

## Grounding score · time-saved · pricing verdict

- **Grounding: 5/6** (up from 4/6 in June). Sources: trajectory/forecast (✔), cohort-matched movers/deltas (✔), D9 evidence-cited definition (✔), tier retention as an enforced read floor (✔ for two surfaces, ✘ for the filed export — counted as a partial ✔ since the mechanism is now real), tamper-evidence on the recurring record (✔ present, ceiling: unverifiable self-serve). **Still missing:** (✘) noise defense at the specific per-dimension surface she reads D9 from.
- **Per-cycle time-saved (number): ~4-6 hours** as it actually stands today (a stronger pre-read than June's ~2h, reflecting the retention read-floor and tamper-evidence landing) — versus the **~14 hours** the design *promises* if MAR-L1-01 and MAR-L1-03 close (retention consistent end-to-end + D9 delta noise-muted). Design-promise number for this run: **840 minutes (14h)**.
- **Verdict: renew Team, do NOT upgrade to Enterprise yet.** One line: the fleet read is now closer to defensible than it was — real retention enforcement and real tamper-evidence both shipped — but the exact surface she'd cite (D9's per-cycle move) still isn't noise-checked, and the artifact she'd file still isn't retention-bounded, so it's still a strong pre-read, not yet an examiner artifact.

## l2_priority carry-forward
1. **(top)** Open a D9 cell in the Repositories heatmap on a repo re-scanned twice with no code change; confirm whether the "since last scan" delta shows the raw colored arrow (bug, MAR-L1-03) or the muted "≈" treatment (fixed).
2. On a populated Team org with a >365-day-old scan: confirm the Overview trajectory clamps it (should, per the new fix) but the `/api/history` CSV export still includes it (should still leak, MAR-L1-01) and it's still not purged (separate open gap, same finding).
3. Confirm `AUDIT_SIGNING_SECRET`/`AUTH_SECRET` is actually set live, and that an exported row's `_sig` recomputes correctly — proving MAR-L1-02's tamper-evidence is on, not just coded.
