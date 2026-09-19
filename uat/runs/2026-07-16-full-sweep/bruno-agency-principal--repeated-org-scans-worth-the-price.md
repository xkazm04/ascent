# L1 — Bruno (agency principal) × "Repeated org scans worth the price"

cert_level: L1 (theoretical, static, code-grounded) · date: 2026-07-16

## 1. Surface model (import chain, cited)

### Entry / reachability
Bruno is on **Team**, owner of his agency's single Ascent org (his 8 clients live as **Segments** inside that one org, per his character file). Under `ASCENT_AUTH_BYPASS=1` he resolves as an owner Membership (`src/app/org/[slug]/layout.tsx`), so every `/org/[slug]/*` surface below is reachable — including owner-gated actions (branding write, share-link mint). `planAllowsWhiteLabel`/entitlement checks resolve against `credit.plan === "team"`, so nothing in his path is Enterprise-gated. **Reachable set:** `/org/[slug]` (overview), `/org/[slug]/executive` (+ PDF, + share link), `/org/[slug]/segments`, `/trends`, `/usage`, `/pricing`, `/org/[slug]` schedule controls, `/api/org/alerts`, `/api/cron/digest` (as a recipient, not a caller).

### A. Per-client executive briefing (PDF)
- Trigger: `/org/[slug]/executive` → "Download PDF" link — `src/app/org/[slug]/executive/page.tsx:71-79` builds `href=/api/org/briefing/pdf?org=…&segment=<segmentId>&stack=…`, segment carried from `sp.segment` (`page.tsx:31-34`).
- Route: `src/app/api/org/briefing/pdf/route.ts:23-40` calls `buildExecBriefing(org, period, title, segmentId, techGroupId)` (`src/lib/org/briefing.ts`) — a pure aggregation over stored scan history, not a fresh LLM prompt.
- **White-label wiring:** `route.ts:48-59` re-checks `planAllowsWhiteLabel(credit?.plan)` at read time (not just at branding-write time) before applying `getOrgBranding(org)`; logo resolved server-side via `resolveSafeLogoDataUri` (SSRF-safe) at `route.ts:60-65`. `BriefingDocument` (`src/lib/pdf/briefing-document.tsx:52-63`) uses `branding.brandName` for `Document title`/`author`, the kicker, and the `Footer note` (`"Scored by {brandLabel}"`, line 148) — when branding is set, "Ascent" never appears. Filename is also rebranded: `route.ts:76-78` (`${brandSlug}-briefing-…pdf`, defaulting to `"ascent"` only when unbranded).
- Gate: `planAllowsWhiteLabel` — `src/lib/plans.ts:154-157` → `id === "team" || id === "enterprise"`. **Reachable at Bruno's tier.**

### B. Per-client executive briefing (read-only share link) — the second, equally-prominent export path
- Trigger: same toolbar, "Share read-only link" button next to Download PDF — `src/components/org/executive/BriefingShareButton.tsx:53-66`, rendered only `canShare = briefingShareEnabled() && isOwner` (`executive/page.tsx:56-57`).
- POST `/api/org/briefing/share` (`src/app/api/org/briefing/share/route.ts:14-27`) mints a signed token carrying `segment`/`stack` — correctly scoped to one client.
- Landing page: `src/app/share/briefing/[token]/page.tsx`. **This page never imports `getOrgBranding` or any branding type — grep confirms zero matches.** It hardcodes `<Logo />` in both `ShareHeader` (`page.tsx:23-32`) and `ShareFooter` (`page.tsx:34-43`, plus the tagline "The maturity index for AI-native engineering"). `Logo` (`src/components/Brand.tsx:13-28`) renders the Ascent logo mark and the literal text **"Ascent"** (line 25). No brand override anywhere on this surface.

### C. Segment scoping / client isolation
- `src/lib/db/segments.ts:39-42,107-118,143-152` — every segment lookup is `where: { id: segmentId, orgId }`, i.e. DB-enforced org-scoping; cross-client bleed within Bruno's one Ascent org is structurally prevented, satisfying his "if client A's repos show up in client B's report, I'm done" bar.
- Autoscan cadence is per-segment: `src/app/api/org/schedule/route.ts:23-49` (`setWatchedSchedule(org, schedule, segmentId)`).

### D. Recurring/"new story" surface (replaces the old org-level Movers list per the journey hint)
- `src/app/org/[slug]/page.tsx:5-6,58-69,131` wires `RepoDimensionHeatmap` (`src/components/org/overview/RepoDimensionHeatmap.tsx:35`) + `buildTrajectories` (`src/components/org/overview/repoTrajectory.ts:50-84`) over `getOrgRepoHistories(slug, win, segmentId, techGroupId)` — segment-scoped, so a per-client fleet view exists here too.
- `buildTrajectories` computes `deltaWindow`/`deltaLast` AND a **`deltaCrossesEngine`** flag (`repoTrajectory.ts:38-40,63`) — the code's own guard against reading a mock→live engine swap as real maturity movement, muted in the UI via `tone`.
- Exec briefing also surfaces month-over-month structurally: `priorPeriod` deltas, `topGainers`/`topRegressions`, `valueRealizedLine` (`src/lib/org/briefing.ts:41-47`) — all present in both the PDF (`briefing-document.tsx:112-141`) and the share link (`share/briefing/[token]/page.tsx:145-150`, movement section is however **absent** on the share page — no `topGainers`/`topRegressions` render there, only `priorPeriod`).

### E. Trust check (real signal vs. re-scan noise)
- `forecastConfidenceNote` (`src/lib/org/briefing.ts:33-37`) surfaces `"trend confidence NN% · noisy"` under R²<50, reused identically by the exec page, the PDF (`briefing-document.tsx:83-86`), and the share link (`page.tsx:139-141`).
- `engineMixDegraded`/`engineMixLabel` (`briefing.ts:19-29`) flag a mock-degraded period identically across all three surfaces.
- `isWithinNoise` guardband gates the regression alert detector (`src/lib/alerts.ts:12-14 import`), and `deltaCrossesEngine` (above) is the equivalent guard on the per-repo trajectory read.

### F. Price/cost legibility
- `/pricing`: `PRO_PRICE`/`TEAM_PRICE` are real numeric strings from `planPriceLabel` sourced off `plans.ts` (`src/app/pricing/page.tsx:40-41`) — no "contact us" opacity for Pro/Team.
- **`/usage` has no per-segment/per-client breakdown.** `getUsageSummary(orgSlug, periodDays)` (`src/lib/db/usage.ts:83-86`) takes only an org slug + day window — no `segmentId` parameter anywhere in its signature or query. `/api/usage/route.ts:22-24` reads only `org`/`days`/`format` from the querystring; there is no `?segment=` handling. `UsageDashboard` (`src/app/usage/usageDashboard.tsx:8-29`) renders one whole-org `usage`/`credit`/`billable` figure — Bruno's 8 clients' credit burn is a single undifferentiated number.
- Retention: `plans.ts` — Team = `retentionDays: 365` (matches the journey's "year-over-year arc" expectation for his tier), enforced as a read-floor via `retentionCutoff` (`plans.ts:189-190`).

### G. Digest/alert between logins
- `src/app/api/cron/digest/route.ts:3-8,17-22` — one weekly digest **per org**, built from `getOrgMovers`/`getOrgRollup` over the whole watched set, POSTed to one webhook (`Organization.alertWebhookUrl`). No `segmentId` anywhere in the route or in `src/lib/alerts.ts`. For Bruno this means: one Slack-style push per cycle that blends all 8 clients' movement into a single message — not eight per-client, brand-scoped notifications.

## 2. In-character walkthrough (thought experiment over the model above)

I open `/org/agency-account` the way I do every month-end. Fleet number's there, trajectory's there — fine, that's the same as last time I checked, no surprise.

I click into **Executive** for the client I'm billing this cycle, filter to their segment. Good — the segment filter actually re-scopes everything: maturity, movers, goals. That's step one of my job: client separation holds, I'm not staring at somebody else's repos.

I hit **Download PDF**. If I've set my agency branding (Team tier — I can, no Enterprise wall), the PDF's got my name, my logo, my footer, my filename. I could genuinely hand that to a client CTO. That's the bar clearing — first time in a while a vendor tool has actually nailed "total" white-label instead of leaving one seam.

But right next to Download PDF there's "Share read-only link" — same toolbar, same segment scope carried in the token, same weight as the PDF button. I'd reasonably reach for that instead when a client just wants to click a link rather than open an attachment. I click it, copy the link, open it in a private tab to see what they'd see — and there's the Ascent logo, top and bottom, plus "The maturity index for AI-native engineering" stamped in my footer. No agency name, no accent color, nothing I set in Branding. If I send that link instead of the PDF — which the UI gives me zero reason not to do — the whole resale story is dead on that surface. "If the client sees 'Scored by Ascent,' the whole thing's dead — they'll just buy it direct." That's not a hypothetical; that's this literal page.

Now the money question. I go to Usage to see what this client cost me this month against my Team allotment, so I know my markup. There's a number — but it's my WHOLE account, all eight clients' scans blended into one credit burn. I can't pull "client X burned N credits this month" anywhere in the product. I'd have to cross-reference Segments' repo lists against a CSV export by hand, repo by repo, which is basically back to spreadsheet work for the one number I most need per client.

Digest — I don't log in every day, I rely on the weekly push. But it's one webhook for the whole account. If client A regresses and client B ships a milestone the same week, they land in the same Slack message. That's fine for MY internal ops channel, but it's not something I can forward as "your weekly update" without editing it into eight pieces myself.

Trust: I like that the R² confidence hedge and the mock-engine caveat show up everywhere I looked — PDF, share link, page — same wording. And the per-repo trajectory flags when a delta crosses a mock→live engine boundary, so I won't accidentally narrate a scoring-tool swap as "the team got better." That's a real, specific trust mechanic, not just a vibe.

## 3. Scored acceptance criteria — verdict

- [x] **White-label is total** (PDF) — name/accent/logo/footer/filename/author all rebrand; **confirmed-absent** on the share-link surface — that one still says "Ascent" everywhere, unconditionally.
- [x] **White-label reachable at Team** — `planAllowsWhiteLabel` includes `"team"`.
- [x] **Per-client deliverable exists**, segments keep clients separate — confirmed at the DB layer (`orgId` scoping) across briefing/PDF/share/schedule.
- [~] **Recurring-value check** — mechanism exists (priorPeriod/movers/heatmap/trajectory) and is real math, not decoration; **untestable statically whether it "reads differently" on stable/mature client repos** — defer to L2.
- [x] **Trust check** — R²/noisy hedge + mock-degraded flag + `deltaCrossesEngine` all present and consistently surfaced.
- [ ] **Price-legibility check** — subscription price is visible (`/pricing`); **per-client cost is not** — `/usage` has no segment dimension anywhere in its data path.

## 4. Findings

```json
[
  {
    "id": "L1-BRUNO-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "bruno-agency-principal",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Shared read-only briefing link is not white-labeled — hardcodes the Ascent logo/name",
    "expected": "The 'Share read-only link' export, sitting beside Download PDF on the same per-client briefing toolbar, carries the same agency branding as the PDF (per his white-label reference bar: name+accent+logo+footer, no exceptions).",
    "got": "src/app/share/briefing/[token]/page.tsx never reads org branding; ShareHeader/ShareFooter hardcode <Logo/> (src/components/Brand.tsx:13-28), which renders the literal text \"Ascent\" and the tagline \"The maturity index for AI-native engineering\".",
    "evidence": ["src/app/share/briefing/[token]/page.tsx:23-43", "src/components/Brand.tsx:13-28", "src/app/org/[slug]/executive/page.tsx:83 (BriefingShareButton rendered with equal prominence to Download PDF)"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Live-screenshot the share link a Team-tier branded org mints; confirm the Ascent mark actually renders in browser (not stripped by CSS/theming) and check whether a client opening it would in fact see 'Ascent' before any agency branding."
  },
  {
    "id": "L1-BRUNO-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "bruno-agency-principal",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "No per-client (per-segment) cost breakdown on /usage — only whole-org credit burn",
    "expected": "Per-client cost legible: credits burned per client per month vs. his Team allotment, so he can compute a markup per client.",
    "got": "getUsageSummary(orgSlug, periodDays) (src/lib/db/usage.ts:83-86) and /api/usage (src/app/api/usage/route.ts:22-24) take only org + day window; no segmentId parameter exists anywhere in the usage data path. UsageDashboard renders one blended figure for all 8 clients.",
    "evidence": ["src/lib/db/usage.ts:83-98", "src/app/api/usage/route.ts:1-24", "src/app/usage/usageDashboard.tsx:8-38"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "On a live multi-segment seeded org, confirm there is truly no filter/URL param on /usage that scopes to a segment, and time how long a manual cross-reference (Segments repo list × per-day usage CSV) actually takes as the fallback."
  },
  {
    "id": "L1-BRUNO-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "bruno-agency-principal",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "Weekly digest/alert is whole-org, not per-client — blends all 8 clients into one push",
    "expected": "The 'digest/alert between logins' the journey calls out would let him forward or narrate movement client-by-client.",
    "got": "/api/cron/digest (src/app/api/cron/digest/route.ts) and src/lib/alerts.ts have no segmentId concept; one weekly Block-Kit message per org, to one webhook, mixing every client's movers.",
    "evidence": ["src/app/api/cron/digest/route.ts:3-22", "src/lib/alerts.ts (no segment references)"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm live digest payload content on a multi-segment org to see how unusable/usable the blended message actually is in practice (may be a smaller deal than it looks if he only uses it internally, not client-facing)."
  },
  {
    "id": "L1-BRUNO-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "bruno-agency-principal",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "completion",
    "title": "Shared read-only briefing omits the movers/movement section the PDF and page both have",
    "expected": "The share-link view should carry the same 'movement this period' (topGainers/topRegressions) as the PDF, since it's marketed as the same briefing.",
    "got": "share/briefing/[token]/page.tsx renders priorPeriod deltas but never briefing.topGainers/topRegressions (present in briefing-document.tsx:139-142 and available on the same `briefing` object).",
    "evidence": ["src/app/share/briefing/[token]/page.tsx:96-186 (no topGainers/topRegressions render)", "src/lib/pdf/briefing-document.tsx:139-142"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm live whether this omission is noticeable/matters once BRUNO-01 (branding) is fixed — lower priority than the branding leak."
  }
]
```

### What passed (strengths worth protecting)
- PDF white-label is genuinely total (name/accent/logo/footer/filename/author) and reachable at Team, not paywalled to Enterprise — matches his highest bar exactly.
- Client isolation is DB-enforced (`orgId` on every segment query), not just UI filtering — the "client bleed = breach" fear is structurally addressed.
- Trust mechanics (R²/noisy hedge, mock-engine-degraded flag, cross-engine-delta guard on trajectories) are real, specific, and consistently reused across page/PDF/share-link via shared pure functions — not re-implemented three times to drift apart.
- `/pricing` numbers are single-sourced from the same `plans.ts` the entitlement gate reads — no stale marketing copy risk.
- Team-tier 365-day retention supports the year-over-year arc his criteria ask for.

## Verdict

**L1-conditional** — the job is structurally completable (segment-scoped briefing + PDF export + real trust hedges all exist and are reachable at his tier), but two majors sit directly on his stated JTBD: the share-link export leaks vendor branding on a surface positioned as equal to the (correctly branded) PDF, and per-client cost is invisible, undermining his "see the price I'm marking up from" criterion. Both are code-confirmed, not maybes.

## 5. Character voice — would I adopt it?

"Okay, first the good news: that PDF is real. Logo, my name, my footer, my file name — I could put that in a client's inbox tomorrow and nobody's Googling 'Ascent' off the back of it. That's the bar, and it's cleared, and it's not stuck behind some Enterprise wall I'd have to talk my way into — Team gets it. That's real money: eight reports I'm not hand-writing.

But then I clicked the OTHER button — the share link, right next to Download PDF, same toolbar — and there's my vendor's logo staring back at me. Twice. Header and footer. If I send that instead of the PDF because a client just wants a link, I've just handed them the receipt that says 'go buy this direct.' That's not a rough edge, that's the exact kill-switch I described from the SEO-tool days. Fix that one thing and I stop worrying about which button my account manager clicks.

Second thing — I still can't see what any ONE client actually costs me. Usage page gives me one number for the whole shop. I need client-by-client or I'm back to a spreadsheet for the one number that tells me if this retainer's profitable. That's not a dealbreaker on its own, but paired with the branding leak it tells me the per-client story wasn't finished all the way through — briefing got it, schedule got it, usage didn't.

Trust-wise, I'll say this: the noise hedge is legit. I've been burned by tools that show me a score swing and don't tell me it's just the model wobbling — this one flags it, on the page, the PDF, AND the link. I'd stake a retainer conversation on that number, that part I don't have to double-check myself anymore.

Net: this could be a profit center. Today it's a profit center with a landmine in it — fix the share link and give me per-client cost, and I'd tell a peer 'get this, brand it, bill it.' As it stands I'd tell a peer 'get it, but only ever send the PDF, never the link — and don't ask me what any one client actually costs you, because it can't tell you either.'"
