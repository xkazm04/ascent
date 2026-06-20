# L1 — Bruno (agency principal) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional** — the recurring machinery is strong and the *internal* per-cycle read is genuinely good, but Bruno's specific job (resell a **per-client, fully white-labelled** monthly artifact at a markup, on **Team**) is blocked by three code-grounded gaps: white-label is **Enterprise-only**, the exported deliverable carries **residual "Ascent" branding** even when branded, and the briefing/PDF/share are **whole-org only — never segment-scoped**, so a single client's report can't be produced. Completes, L2-eligible, but with majors on the resell facet.

## Reachable surface set (tier-honest, Bruno = Team, synthetic owner under ASCENT_AUTH_BYPASS=1)
- **Reachable & job-relevant:** `/org/[slug]` overview, `/org/[slug]/segments` (per-client cards + A/B compare + per-segment scan/cadence), `/org/[slug]/executive` Briefing tab, **Download PDF**, **Copy briefing for LLM**, **Briefing share** (owner-gated, *not* tier-gated), `/trends`, `/usage`, `/pricing`. Scheduled autoscans + alerts + segments are all **Team**-included, so cadence machinery is his.
- **Reachable route, but tier-blocked entitlement (the upsell):** **Briefing branding / white-label** — the `BrandingSettings` form renders only when `credit.unlimited` (Enterprise). On Team, `canBrand` is false → the form never appears, and the API hard-rejects (`"Briefing branding is an enterprise feature."`). This is the single most load-bearing surface for Bruno and it is **unreachable at his tier**.
- **Does not exist for his job (not just unreachable):** a **segment-scoped briefing / PDF / share**. `buildExecBriefing` has no segment parameter; the export and share carry no segment. A *per-client* deliverable is absent in code, not paywalled.

## Surface-model notes (recurring-value affordances → file:line, resell-facet emphasis)
- **White-label gating (Enterprise-only).** `src/app/org/[slug]/executive/page.tsx:46` — `const canBrand = isOwner && !!credit?.unlimited;` and `:230` renders `BrandingSettings` only when `canBrand`. API enforcement: `src/app/api/org/branding/route.ts:24` — `if (!credit?.unlimited) return … "Briefing branding is an enterprise feature." (403)`. Bruno is Team (`includedCredits: 500, unlimited: false` — `src/lib/plans.ts:45`), so he can never brand. The component itself even labels the section `enterprise` (`src/components/org/BrandingSettings.tsx:43`).
- **Residual vendor branding in the exported artifact (even WITH white-label).** The PDF footer is hard-coded: `src/lib/pdf/briefing-document.tsx:180` — `<Text>Scored by Ascent · AI-native engineering maturity</Text>` (a `fixed` footer on every page, **not** overridden by `branding`). The download filename is hard-coded `ascent-briefing-…`: `src/app/api/org/briefing/pdf/route.ts:55`. The brand override only reaches the kicker/title/logo/accent + doc author (`briefing-document.tsx:86–93`). So even an Enterprise reseller hands the client a PDF stamped "Scored by Ascent" in the footer and saved as `ascent-briefing-*.pdf` — the white-label is partial.
- **Briefing/PDF/share are whole-org, never per-client.** `src/lib/org/briefing.ts:89` — `buildExecBriefing(orgSlug, window?, periodTitle)` takes **no segmentId**; internally it calls `getOrgRollup(orgSlug, window)` (`:104–110`) with no segment. The data layer *supports* segment scope (`src/lib/db/org-rollup.ts:147` — `getOrgRollup(orgSlug, window?, segmentId?)`, `:155 segmentScope(segmentId)`), but the briefing never passes one. The exec page (`executive/page.tsx:28`), the PDF route (`pdf/route.ts:32`), and the share (no segment param in `BriefingShareButton`) all assemble the **blended org**. Bruno's 8 clients are segments *inside one org*, so his only "report" mixes all clients.
- **What DOES work for him (strengths).** Per-client **separation and read** exists on the Segments tab: per-segment rollup cards with adopt/rigor/posture and per-segment scan + cadence (`src/app/org/[slug]/segments/page.tsx:16–37, 64–73`; `src/components/org/SegmentActions.tsx:29–78` → `POST /api/org/schedule {segmentId}` + segment-scoped scan). A/B compare keeps two clients visually separate (`segments/page.tsx:96, 120–168`). The recurring *story* engine is real: movers + **"vs previous period"** per-dimension deltas (`briefing.ts:96–151, 228–237`) and a forecast/ETA with **R² as trend confidence** and a `FLAT_PER_WEEK=0.5` noise floor (`src/lib/maturity/forecast.ts:63–64, 130–131, 283–296`). Share without an account (HMAC token, 14-day TTL) is owner-gated only, so it's reachable on Team (`src/lib/briefing-share.ts:10, 17`).

## Findings
```json
[
  {
    "id": "BRUNO-L1-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "bruno-agency-principal",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "blocker",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "missing",
    "title": "White-label is Enterprise-only — Bruno (Team) can never brand the resold report",
    "expected": "On Team (which already includes segments/comparisons for per-client work), the reseller can put his agency's name/logo/accent on the exported briefing — white-label is the whole reason to resell.",
    "got": "Branding renders/persists only when credit.unlimited (Enterprise). Team's plan has unlimited:false, so the BrandingSettings form never appears and POST /api/org/branding 403s with 'Briefing branding is an enterprise feature.'",
    "evidence": ["src/app/org/[slug]/executive/page.tsx:46", "src/app/org/[slug]/executive/page.tsx:230", "src/app/api/org/branding/route.ts:24", "src/lib/plans.ts:45", "src/components/org/BrandingSettings.tsx:43"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Confirm on a Team-plan org the Briefing branding form is absent and the branding API 403s; confirm the PDF renders unbranded (Ascent kicker/title).",
    "suggested_acceptance": "White-label branding is available on Team (or a dedicated agency/reseller tier), not only Enterprise."
  },
  {
    "id": "BRUNO-L1-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "bruno-agency-principal",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "missing",
    "title": "Exported briefing still says 'Scored by Ascent' (footer + filename) even when white-labelled",
    "expected": "A resold deliverable carries ONLY the agency's brand end to end — footer, filename, doc metadata — so the client can't see the underlying vendor (per white-label reporting norms).",
    "got": "PDF footer is hard-coded 'Scored by Ascent · AI-native engineering maturity' on every page (fixed, not overridden by branding); download filename is hard-coded 'ascent-briefing-<org>-<date>.pdf'. Branding only reaches kicker/title/logo/accent/author. The vendor leaks in the artifact even for Enterprise resellers.",
    "evidence": ["src/lib/pdf/briefing-document.tsx:180", "src/app/api/org/briefing/pdf/route.ts:55", "src/lib/pdf/briefing-document.tsx:86"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "l2_priority": "Set branding on an Enterprise org, download the PDF, and inspect: does the footer still read 'Scored by Ascent' and the filename still start 'ascent-briefing-'? Both expected true.",
    "suggested_acceptance": "When branding is set, the PDF footer text, the download filename, and doc author/title all use the brand name — no 'Ascent' string remains in the deliverable."
  },
  {
    "id": "BRUNO-L1-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "bruno-agency-principal",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "No per-client (per-segment) briefing — the resold report can only be the whole-org blend",
    "expected": "Bruno generates ONE briefing/PDF per client (segment), so each client's report shows only that client's repos. The data layer already supports segment-scoped rollups.",
    "got": "buildExecBriefing(orgSlug, window, periodTitle) takes no segmentId and calls getOrgRollup(orgSlug, window) unscoped; the exec page, PDF route, and share all assemble the blended org. getOrgRollup DOES accept segmentId (org-rollup.ts:147) but the briefing never passes it. So all 8 clients are mixed into one artifact — there is no single-client deliverable.",
    "evidence": ["src/lib/org/briefing.ts:89", "src/lib/org/briefing.ts:104", "src/lib/db/org-rollup.ts:147", "src/app/api/org/briefing/pdf/route.ts:32", "src/app/org/[slug]/executive/page.tsx:28"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "On a multi-segment org, try to get an executive briefing/PDF scoped to one segment via URL params; confirm there is no such param and the PDF reflects the whole fleet.",
    "suggested_acceptance": "Briefing/PDF/share accept an optional segmentId and produce a single-segment (single-client) artifact; segment data never crosses into another segment's report."
  },
  {
    "id": "BRUNO-L1-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "bruno-agency-principal",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "No visible subscription price or per-client cost — can't compute a markup",
    "expected": "A reseller needs a per-client monthly cost (credits/client × cycles vs. the 500 allotment) AND a subscription dollar figure to mark up and quote the client.",
    "got": "Pricing shows only 'Prepaid — credits, 1 per private scan'; no subscription $ for Pro/Team (it lives in Polar, not the app). /usage shows credit burn but the markup math needs a price the app never displays. Bruno can size credit consumption but cannot see what he pays, so he cannot price the resale.",
    "evidence": ["src/lib/plans.ts:45", "src/app/org/[slug]/executive/page.tsx:43"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Confirm /pricing shows no subscription dollar amount for Team and /usage exposes credit burn but not a unit price to mark up.",
    "suggested_acceptance": "A reseller can see a per-private-scan price and a Team subscription price in-app, enough to compute cost-per-client-per-month."
  },
  {
    "id": "BRUNO-L1-05",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "bruno-agency-principal",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "Trend confidence (R²) isn't surfaced on the exec briefing where the move is narrated",
    "expected": "Before Bruno narrates 'you climbed +4 this month' to a client, the report should let him tell real movement from re-scan/guardband wobble — the forecast computes R² and a flat-floor for exactly this.",
    "got": "forecast.ts computes fitQuality (R²) and a FLAT_PER_WEEK=0.5 noise floor, and forecastHeadline collapses flat trends to 'Holding around N'. But the exec briefing renders only the headline string; R²/confidence is not shown next to the period delta or the movers, so a small move reads as signal even when the fit is weak.",
    "evidence": ["src/lib/maturity/forecast.ts:64", "src/lib/maturity/forecast.ts:291", "src/app/org/[slug]/executive/page.tsx:99", "src/app/org/[slug]/executive/page.tsx:112"],
    "code_check": "present-but-missed",
    "verdict": "uncertain",
    "l2_priority": "Re-scan an unchanged client repo twice under claude-cli; does the overall move within the ±25 guardband / 60-40 blend, and does the briefing flag it as low-confidence or present it as a real move?",
    "suggested_acceptance": "Where a period delta or mover is shown, surface the fit confidence (R²/flat-floor) so a noise-level move is visibly distinguished from real movement."
  },
  {
    "id": "BRUNO-L1-06",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "bruno-agency-principal",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "time-saved",
    "title": "STRENGTH — 'vs previous period' + movers + forecast give a genuinely new monthly story",
    "expected": "Each cycle should read differently from the last or the retainer feels static.",
    "got": "The briefing assembles a prior-equal-length-window comparison (per-dimension now/prior/delta), top gainers/regressions, a forecast headline/ETA, and a named 'recommended next move' (the weakest dimension). At the ORG level this is a real, narratable monthly delta — the recurring engine works; the gap is only that it can't be scoped per-client or rebranded.",
    "evidence": ["src/lib/org/briefing.ts:96", "src/lib/org/briefing.ts:128", "src/lib/org/briefing.ts:258", "src/app/org/[slug]/executive/page.tsx:112"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Across two seeded cycles, confirm the 'vs previous period' block and movers change content cycle-over-cycle (not a re-dated copy)."
  },
  {
    "id": "BRUNO-L1-07",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "bruno-agency-principal",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "completion",
    "title": "STRENGTH — per-client separation + account-free share are reachable on Team",
    "expected": "Clients must stay separate, and Bruno wants to send a client a read without provisioning a login.",
    "got": "Segments give per-client rollup cards, segment-scoped scan/cadence, and A/B compare that keeps two clients visually distinct (Team-included). The briefing share mints an HMAC token (14-day TTL) and is owner-gated, not tier-gated, so it's reachable on Team — a client can view without an account.",
    "evidence": ["src/app/org/[slug]/segments/page.tsx:35", "src/components/org/SegmentActions.tsx:29", "src/lib/briefing-share.ts:10", "src/app/org/[slug]/executive/page.tsx:42"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Confirm the share link renders a read-only briefing without auth and that segment cards never show another segment's repos."
  }
]
```

## Character feedback (Bruno, first person)

"Okay, let me run my actual play here. I've got eight clients, I want eight branded reports a month, billed. First question — can I put my logo on it? On Team, no. The branding form doesn't even show up; the API tells me white-label is an *enterprise* feature. So the one thing that makes this a resold product instead of my cost is paywalled two tiers above where the per-client segments live. That's backwards — you gave me segments to slice my clients on Team but won't let me brand the thing I'd hand them until Enterprise.

Say I bite the bullet and go Enterprise. I download the PDF and there it is in the footer of every page: 'Scored by Ascent.' And it saves as `ascent-briefing-acme.pdf`. So my client opens *my* report and sees *your* name and your filename. That's not white-label, that's a co-brand I didn't agree to — and the second a client Googles 'Ascent' they buy it direct and fire me. Half a white-label is worse than none.

And the part that actually kills the deliverable: there's no per-client report. The briefing is the whole org — all eight clients blended into one number. I can *look* at a client on the Segments tab, fine, the cards keep them separate and the compare is clean. But the thing I export and send? It's the blend. I can't hand client A a report that has client B's repos averaged into it — that's a confidentiality problem, not just a feature gap. The plumbing's right there — your rollup takes a segment id — you just never wired it into the briefing.

What I *do* like, credit where it's due: each month genuinely says something new. The 'vs previous period' block, the movers, the trajectory with an ETA, a named next move — that's a real story I could narrate to a client every cycle, not a re-dated page. If I could scope it to one client and stamp my brand on it, I'd sell this tomorrow. The share link without a login is nice too.

Trust-wise — I'm narrating '+4 this month' to a paying client, so I need to know it's real and not the model breathing. The forecast computes a confidence number and a flat-floor, but the briefing only shows me the headline sentence; it doesn't tell me *this* move is low-confidence. I'll want to watch that.

And I can't see what I pay. 'Prepaid credits' and 'contact us' — there's no subscription number to mark up. I can count credits on /usage but I can't quote a client a margin off a price I can't see.

Would I renew at Team? No — Team can't produce my product. Would I churn? Not yet — the engine underneath is good and the segments are exactly my client model. This is an **upgrade-gated-but-incomplete**: the path is Enterprise, and even Enterprise hands me a half-branded, whole-org artifact. Fix the per-client scope and rip 'Scored by Ascent' out of the footer/filename, and I'm a reseller. Until then I'm still writing the reports by hand."

## Grounding score (recurring-context sources reaching the read) — **3 / 6**
- ✅ **Trajectory needs real history** — forecast renders org-level (forecast.ts; surfaced on exec page).
- ✅ **Movers / period deltas vs previous scan** — "vs previous period" + gainers/regressions assembled (briefing.ts:96–151).
- ✅ **Recurring depth tier-gated** — Team buys 365-day retention + 500 credits + segments (plans.ts:45); legible.
- ❌ **Real-vs-noise surfaced where the move is shown** — R²/flat-floor computed but not rendered next to deltas/movers on the briefing (forecast.ts:64 vs executive/page.tsx:112).
- ❌ **Per-client (segment) provenance into the deliverable** — briefing/PDF/share never segment-scoped (briefing.ts:89); the resold artifact can't reflect a single client.
- ❌ **Brand provenance in the deliverable** — white-label tier-blocked on Team AND partial even on Enterprise (footer/filename leak "Ascent"; branding/route.ts:24, briefing-document.tsx:180).

## Per-cycle time-saved (if it all worked)
~**3.5 hours saved per client per cycle** (manual ~4 hrs/client → ~20–30 min review-and-send), ≈ **28 hours/month** reclaimed across 8 clients — **but only realized if** the three resell blockers are fixed. As shipped on Team, realized time-saved is **~0 for the resell job**: he'd have to de-Ascent the footer, re-scope away the client blend (impossible from the artifact), and rebrand by hand — slower than just writing it.

## Renew / downgrade / churn / upgrade verdict
**Upgrade-blocked (lean churn-risk).** Reason: Team — the tier whose segments fit his per-client model — structurally cannot produce his deliverable (no per-client briefing, no white-label), and the only upgrade path (Enterprise) still hands him a whole-org PDF stamped "Scored by Ascent." He stays only because the underlying recurring engine and segment separation are good; he resells nothing until per-segment briefings + total white-label ship. The price he'd mark up from isn't even visible, so he can't quote a client today.

## l2_priority carry-forward (top first)
1. **Per-client scope:** on a multi-segment org, attempt a briefing/PDF/share scoped to one segment — confirm it's impossible and the export is the whole-org blend (BRUNO-L1-03).
2. **White-label completeness:** set branding on an Enterprise org, download the PDF — confirm the footer still reads "Scored by Ascent" and the filename still starts `ascent-briefing-` (BRUNO-L1-02); confirm the branding form/API is absent/403 on Team (BRUNO-L1-01).
3. **Real-vs-noise:** re-scan an unchanged client repo twice under `claude-cli` — does the overall wobble within the ±25 guardband / 60-40 blend, and does the briefing flag the move as low-confidence or present it as real (BRUNO-L1-05)?
4. **New-story-each-cycle:** across two seeded cycles confirm "vs previous period" + movers change content, not a re-dated copy (BRUNO-L1-06).
