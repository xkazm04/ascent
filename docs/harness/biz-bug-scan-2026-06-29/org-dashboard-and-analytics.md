# Biz+Bug Scan — Org Dashboard & Analytics — ascent — 2026-06-29

> Combined business-visionary + bug-hunter scan over 6 contexts.
> Total: 30 findings — Critical: 0, High: 6, Medium: 16, Low: 8  (bug: 18, business: 12)

---

## Org Branding & White-label

### 1. Logo URL is a residual server-side SSRF vector (DNS rebinding)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: input-validation / SSRF
- **File**: src/lib/db/branding.ts:34-36, src/lib/db/branding.ts:47
- **Scenario**: An org owner saves `logoUrl = https://internal.attacker.com/x.png` where `internal.attacker.com` resolves to `169.254.169.254` or a private IP. `isSafePublicHttpsUrl` validates the *hostname string* at write time, but @react-pdf fetches the image SERVER-SIDE at every PDF render, re-resolving DNS — so a rebind lands the fetch inside the app's network.
- **Root cause / Rationale**: Validation happens once, at write, on the literal URL; the actual egress fetch happens later at a different layer (@react-pdf) with no resolve-and-pin. The code comment itself flags this as an un-closed follow-up.
- **Impact**: Server-side request forgery against internal/metadata endpoints from a trusted (Team+, owner-gated) but still attacker-controllable input.
- **Fix sketch**: Resolve-and-pin the host at fetch time (reject if the resolved IP is private/link-local/CGNAT), or proxy the logo through a fetch wrapper that re-validates the resolved address; cache the validated bytes rather than the URL.

### 2. Rejected logo/colour silently saved as null while UI claims success
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / success-theater
- **File**: src/lib/db/branding.ts:45-49, src/components/org/BrandingSettings.tsx:27-29
- **Scenario**: Owner enters `http://acme.com/logo.png` (http, not https) or an oddly-formatted colour. `setOrgBranding` normalizes the bad value to `null` and still returns `true`; the route returns `{ ok: true }`; the UI shows "Saved — the next briefing PDF uses your brand." The logo was silently dropped.
- **Root cause / Rationale**: "Store-as-null rather than reject" was chosen to keep the PDF always-rendering, but the response carries no signal of *which* fields were normalized away, so the client can't tell the user.
- **Impact**: User believes their branding is applied; the next PDF ships Ascent defaults. Erodes trust in a paid feature.
- **Fix sketch**: Return the persisted `OrgBranding` from the route and reflect it in the form (or return per-field `rejected: [...]`), so the UI can warn "logo URL ignored — must be an https image URL."

### 3. White-label persists after a plan downgrade (entitlement not re-checked on read)
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: monetization
- **File**: src/lib/db/branding.ts:17-25, src/app/api/org/branding/route.ts:25-28
- **Scenario**: An org on Team sets branding (write path correctly gates on `planAllowsWhiteLabel`), then downgrades to a free/Solo plan. `getOrgBranding` does no plan check, so any consumer (briefing/security PDF) keeps rendering their custom brand for free.
- **Root cause / Rationale**: Entitlement is enforced only at write time; reads assume the stored row is still entitled.
- **Impact**: Revenue leak — a paid white-label feature continues working indefinitely after the customer stops paying for it.
- **Fix sketch**: Gate `getOrgBranding` (or the PDF render that consumes it) on the current `planAllowsWhiteLabel(credit?.plan)`; return defaults when the plan no longer entitles it.

### 4. Extend white-label into a full agency / reseller mode
- **Severity**: High
- **Lens**: business-visionary
- **Category**: monetization / differentiation
- **File**: src/components/org/BrandingSettings.tsx:3-4 (today only the briefing PDF)
- **Scenario**: The code's own rationale ("so a reseller on Team can brand the reports they hand to clients") points at MSPs/agencies, but branding only touches the briefing PDF. Resellers want branded *shareable report pages, badges, the org dashboard, and a custom domain* — the surfaces clients actually see.
- **Root cause / Rationale**: White-label is the natural up-sell wedge for agencies managing many client orgs; today it's a single PDF cosmetic.
- **Impact**: A defensible higher tier ("Agency/Partner") with per-client branding, custom domain, and a partner portal — recurring revenue Snyk/SonarCloud don't target for boutique consultancies.
- **Fix sketch**: Apply `OrgBranding` to the shareable `/report` + `/org` OG images and badges behind an "Agency" entitlement; add a `brandDomain` column and a partner-org grouping.

### 5. Branding changes are not written to the audit trail
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure / compliance
- **File**: src/app/api/org/branding/route.ts:30-36, src/components/org/AuditLogViewer.tsx:17-30
- **Scenario**: Every other owner-gated org mutation calls `recordOrgAudit`; the branding POST does not, and `branding.*` isn't in the audit viewer's `ACTIONS` list. A silent change to what every client-facing PDF says goes unrecorded.
- **Root cause / Rationale**: Route was added without the audit tail the other org mutations share.
- **Impact**: Gap in the "who changed what" trail the audit feature sells as complete.
- **Fix sketch**: Call `recordOrgAudit("org.branding", slug, { ...changedFields }, actorId)` after a successful write and add the action to `ACTIONS`.

---

## Security Posture & Audit Log

### 1. Audit CSV export silently truncates at 10,000 rows
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure / data-integrity
- **File**: src/app/api/audit/route.ts:20, src/app/api/audit/route.ts:30-51
- **Scenario**: An org with >10k matching audit entries downloads the "compliance evidence" CSV. The cursor loop stops at `total < CSV_MAX_ROWS`, emitting only the newest 10k rows with no truncation marker — and the `x-ascent-content-sha256` header signs the *incomplete* file, lending false integrity confidence.
- **Root cause / Rationale**: A safety cap was added to bound the loop, but there is no "truncated" signal in the body, headers, or filename.
- **Impact**: Auditors receive an incomplete record believing it is the full trail; the missing rows are the *oldest* ones (most likely needed for an incident lookback).
- **Fix sketch**: When the cap is hit, add a trailing `# TRUNCATED at 10000 rows — narrow the date range` comment row and an `x-ascent-truncated: true` header; ideally stream without a cap or paginate the export by date window.

### 2. Supply-chain card is whole-fleet while the rest of the page is scoped
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-inconsistency
- **File**: src/app/org/[slug]/security/page.tsx:30-33, src/lib/security/supply-chain.ts:112-117
- **Scenario**: User selects a tech-stack scope (e.g. "Frontend"). `buildSecurityOverview` is scoped by `techGroupId` (and period), but `getOrgSupplyChain(slug)` takes only the slug — no window, no stack. The Supply-chain card then says "Open Dependabot advisories across N repos" with a different N and different repos than every other tile on the page.
- **Root cause / Rationale**: `getOrgSupplyChain` predates the scope filters and its module-level cache is keyed on `orgSlug` alone, so it can't reflect a scope even if passed one.
- **Impact**: Misleading security reporting — advisory counts don't match the filtered fleet the user is looking at.
- **Fix sketch**: Thread `techGroupId`/period into `getOrgSupplyChain` and the cache key; or label the card "(whole fleet)" explicitly when a scope is active.

### 3. Invalid `since`/`until` returns 500 instead of 400
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: input-validation
- **File**: src/app/api/audit/route.ts:84-89, src/lib/db/scans-audit.ts:151-154
- **Scenario**: A client passes `?since=lastweek`. `new Date("lastweek")` is `Invalid Date`; the Prisma `gte: Invalid Date` filter throws, caught as a generic 500 "Failed to load audit log."
- **Root cause / Rationale**: Raw query strings flow into `new Date()` without validation.
- **Impact**: Bad UX / noisy 500s; a malformed bookmark looks like a server outage.
- **Fix sketch**: Validate the date params (reject `Number.isNaN(d.getTime())`) and return 400 with a clear message before querying.

### 4. Activate the dormant supply-chain / SBOM scanner as a premium security module
- **Severity**: High
- **Lens**: business-visionary
- **Category**: monetization / market-fit
- **File**: src/lib/security/supply-chain.ts:1-101 (full GitHub provider, default `off`)
- **Scenario**: A complete Dependabot-alerts provider exists behind `SUPPLY_CHAIN_PROVIDER` but ships `off`; the live security signal users expect (vs Snyk/Dependabot/Scorecard) is invisible by default.
- **Root cause / Rationale**: Built but unwired — the most directly competitive security feature is dark.
- **Impact**: Turning it on (plus SBOM and a "security score trend") is the clearest way to charge for a "Security" tier and close the gap with Snyk on the one axis Ascent currently only describes.
- **Fix sketch**: Default `github` once the App has "Dependabot alerts: read"; gate org-wide live scanning behind Team+, keep `mock` for demos; add a fleet advisory trend + alerting on new criticals.

### 5. Package the audit trail as a Compliance/Enterprise add-on
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: monetization / differentiation
- **File**: src/lib/db/scans-audit.ts:22-37 (per-row HMAC), src/app/api/audit/route.ts:60-63 (file SHA)
- **Scenario**: Tamper-evident, signed, CSV-exportable audit logs are exactly the evidence a SOC2/ISO buyer needs, but they're surfaced as a plain dashboard tab with no retention policy, scheduled export, or SIEM sink.
- **Root cause / Rationale**: The hard part (signing, keyset pagination, integrity headers) is done; the packaging that lets you charge for it isn't.
- **Impact**: An "Enterprise/Compliance" tier: configurable retention, scheduled signed exports, webhook/SIEM streaming, legal-hold — high-ACV, low marginal build.
- **Fix sketch**: Add retention config + a scheduled export job reusing `exportCsv`, and an audit-event webhook; gate behind an Enterprise plan.

---

## Repositories & Segments

### 1. createSegment auto-creates the org (phantom-org / data-pollution)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: input-validation / data-integrity
- **File**: src/lib/db/segments.ts:63-74, src/app/api/org/segments/route.ts:38-42
- **Scenario**: On an auth-off deployment `requireOrgAccess` is permissive; `POST /api/org/segments { org: "anything", name: "x" }` hits `createSegment`, which `upsert`s the Organization — materializing a brand-new org row for an arbitrary slug. Every *other* segment function (`listSegments`, `setRepoSegment`, …) no-ops/returns `[]` on an unknown org.
- **Root cause / Rationale**: `createSegment` uniquely uses `organization.upsert` instead of resolving an existing org, diverging from the rest of the module's "unknown org → no-op" contract.
- **Impact**: Unbounded creation of junk org rows (and `name: orgSlug`) by any caller on open deployments; inconsistent behavior vs sibling endpoints.
- **Fix sketch**: Resolve the org via `resolveOrgId` and return 404 when absent (match the other functions); never create an org as a side effect of segment creation.

### 2. deleteSegment is not transactional
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: state-corruption
- **File**: src/lib/db/segments.ts:89-95
- **Scenario**: `deleteMany(repoSegment)` succeeds, then `segment.delete` fails (transient DB error). Membership rows are gone but the now-empty segment remains (repoCount 0), and a retry can't restore the memberships.
- **Root cause / Rationale**: Two sequential awaits with no `$transaction` (relationMode="prisma" means no DB cascade to rely on).
- **Impact**: Orphaned/empty segments and lost tag data on partial failure.
- **Fix sketch**: Wrap both deletes in `prisma.$transaction([...])`.

### 3. Segments page runs N sequential full rollups (N+1 latency landmine)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: latent-failure / performance
- **File**: src/lib/db/segments.ts:242-252, src/lib/db/segments.ts:255-256
- **Scenario**: `listSegmentSummaries` loops every segment and `await`s `summarizeSegment` → `getOrgRollup` one at a time. Each rollup is 2-3 DB round trips. The comment says "Sequential since N is small" — but nothing bounds N, and an org that creates 30-50 segments serializes 30-50 full rollups on the Segments tab's TTFB.
- **Root cause / Rationale**: An "N is small" assumption with no enforced cap; segments are user-created and unbounded.
- **Impact**: Segments tab TTFB degrades linearly; a heavy segment user gets multi-second loads or a function timeout.
- **Fix sketch**: `mapPool` the summaries with bounded concurrency, or compute all segment rollups from a single fleet query in memory rather than one rollup per segment.

### 4. Ship one-click auto-segmentation
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: activation / retention
- **File**: src/app/api/org/segments/[id]/repos/bulk/route.ts:1-4 (backend exists), src/components/org/RepoSegmentsPanel.tsx
- **Scenario**: The bulk-tag backend was built "for auto-segments (by language)", but segmenting is entirely manual today — a leader must tick repos by hand. Activation suffers because the comparison/segment value only appears after tedious setup.
- **Root cause / Rationale**: The plumbing for auto-grouping exists; the one-click action doesn't.
- **Impact**: Faster time-to-value for the segment/compare features (a core analytics differentiator); fills the "platform vs legacy" story instantly.
- **Fix sketch**: Add "Auto-segment by language / tech-stack / CODEOWNERS team" buttons that derive sets and call the existing bulk endpoint.

### 5. Make the segment the unit of governance + billing
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: monetization
- **File**: src/lib/db/segments.ts:277-300 (compareSegments), src/app/org/[slug]/segments/page.tsx
- **Scenario**: Segments already scope every aggregate; the next step enterprises pay for is per-segment *policy* — a "platform" segment held to a stricter gate, per-segment scheduled exports, and per-business-unit reporting/chargeback.
- **Root cause / Rationale**: Segments are read-only slices today; turning them into policy + reporting boundaries matches how large orgs buy.
- **Impact**: A Team+/Enterprise lever (per-segment SLAs, scheduled segment digests) that maps to real org structure.
- **Fix sketch**: Allow attaching a `GatePolicy` and an alert/export schedule to a segment; surface a per-segment pass-rate on the segment card.

---

## Practices, Governance & Adoption

### 1. Every generated practice PR carries a dead attribution link
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: correctness / growth-surface defect
- **File**: src/lib/practice-artifact.ts:306
- **Scenario**: The PR body ends `Generated by [Ascent](https://github.com/)` — the href is GitHub's homepage, not the Ascent app or repo. Every draft PR Ascent opens into a customer repo (a surface other engineers read) links nowhere useful.
- **Root cause / Rationale**: Placeholder URL never filled in.
- **Impact**: These PRs are Ascent's most organic distribution channel; a broken/placeholder link wastes the viral surface and looks unfinished in customers' repos.
- **Fix sketch**: Point the link at the deployment's public URL / report for the repo (thread the base URL into `buildArtifact`), turning each PR into a real inbound funnel.

### 2. Owner case-normalization is inconsistent across the apply path
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: input-validation / tenant-scoping
- **File**: src/app/api/practices/apply/route.ts:41-54, src/app/api/practices/apply-batch/route.ts:62-81
- **Scenario**: A repo entered as `MyOrg/Repo`. `requireOrgAccess(parsed.owner)` and `getInstallationIdForOwner(parsed.owner)` receive the original mixed case, but `getOrgId(parsed.owner.toLowerCase())` is lowercased. If org slugs/memberships are stored lowercase, the tenant gate and install lookup can resolve differently from the audit `orgId`.
- **Root cause / Rationale**: Ad-hoc `.toLowerCase()` applied to only one of three owner-keyed lookups.
- **Impact**: Best case, the audit entry gets a null `orgId` (lost FK); worst case a mixed-case owner mis-passes/mis-fails the gate vs the install.
- **Fix sketch**: Normalize `owner` once (lowercase) at parse and use that single value for the gate, install lookup, and `getOrgId`.

### 3. apply-batch drops the helpful "file already exists" hint
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: error-handling
- **File**: src/app/api/practices/apply-batch/route.ts:96-104 vs src/app/api/practices/apply/route.ts:69-75
- **Scenario**: Single-apply maps a 409 to "That file already exists — Ascent won't overwrite it." Batch-apply collapses everything that isn't 403 to "GitHub rejected the write," so a fleet rollout where most repos already have the file gives an opaque, identical error per repo.
- **Root cause / Rationale**: The batch worker's error mapping omits the 409 case the single route handles.
- **Impact**: Confusing batch results; users can't tell "already adopted" from "real failure."
- **Fix sketch**: Mirror the single route's 409 → "file already exists" mapping in the batch worker.

### 4. Turn remediation-as-PR into a measured ROI loop (and gate the fleet rollout)
- **Severity**: High
- **Lens**: business-visionary
- **Category**: monetization / differentiation
- **File**: src/app/api/practices/apply-batch/route.ts:1-7, src/components/org/PracticeApply.tsx:177-217
- **Scenario**: "Open draft PRs across the whole fleet to close a practice gap" is a standout differentiator (Snyk fixes deps; Ascent fixes *engineering practice* gaps). But there's no tracking of opened→merged→maturity-lift, and fleet rollout isn't a paid capability.
- **Root cause / Rationale**: The action exists but its business value (proven lift) and gating aren't captured.
- **Impact**: A concrete ROI dashboard ("12 PRs opened → 9 merged → +6 avg maturity") justifies the price and retention; batch rollout is a natural Team+ gate.
- **Fix sketch**: Record opened PRs in the audit/DB, correlate the next scan's dimension delta, surface "practices applied → lift," and gate `apply-batch` behind Team+.

### 5. Benchmark AI adoption against the corpus
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: differentiation / retention
- **File**: src/lib/org/adoption.ts:30-57
- **Scenario**: `buildAdoptionOverview` computes an org's AI-commit share and champions but shows it only in isolation. The compelling question for a leader is "are we ahead or behind comparable orgs on AI adoption?"
- **Root cause / Rationale**: The org benchmark percentile already exists for maturity (`getOrgBenchmark`); adoption has no equivalent.
- **Impact**: An "AI-native adoption percentile" is a unique, re-engaging metric no competitor (security-focused) offers — a reason to keep scanning.
- **Fix sketch**: Extend the corpus benchmark to AI-commit share and render an adoption percentile on the Adoption tab and in the brief.

---

## People & Delivery Analytics

### 1. Contributor PII is exported raw and world-readable on the public org
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: privacy / data-exposure
- **File**: src/app/org/[slug]/contributors/page.tsx:72 (ExportCsvLink), src/app/org/[slug]/contributors/page.tsx:89-111
- **Scenario**: The Individual Involvement table + CSV expose per-person login, name, commit counts, AI-commit share, and last-active. For the shared `public` org (auth-off deployments), `canReadOrg("public")` is open, so any visitor can read/export named contributors' activity.
- **Root cause / Rationale**: The UI is carefully framed as "not performance evaluation," but the data layer hands out identifiable per-person metrics with no opt-out or aggregation threshold on the public surface.
- **Impact**: GDPR/PII exposure and a performance-scoreboard misuse risk despite the framing; named individuals' commit behavior leaks on public deployments.
- **Fix sketch**: Suppress per-individual rows/CSV for the public org (and behind a small-population threshold), and add a per-contributor opt-out / aggregation floor.

### 2. Concentration table renders unbounded rows
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case / performance
- **File**: src/app/org/[slug]/contributors/page.tsx:147-168
- **Scenario**: The contributors table caps at `slice(0, 50)`, but `ConcentrationTable` maps *every* repo in `insights.concentration`. A fleet with hundreds of repos renders a giant table with no cap or pagination.
- **Root cause / Rationale**: A cap was applied to one table but not the sibling.
- **Impact**: Heavy DOM / slow render for large fleets.
- **Fix sketch**: Cap + "show all" the concentration rows the same way the contributor table is capped.

### 3. Knowledge-leader tile mixes two metrics
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: correctness / UX
- **File**: src/app/org/[slug]/teams/page.tsx:176-181
- **Scenario**: The "Knowledge leader" tile displays `aiCommitShare%` as its value but colors it with `scoreHex(knowledgeLeader.knowledgeScore)` — value and color come from different metrics, so a team can show a low % in green (or vice versa).
- **Root cause / Rationale**: Two related-but-distinct scores conflated in one tile.
- **Impact**: Misleading at-a-glance read of the headline tile.
- **Fix sketch**: Color by the same metric shown (`aiCommitShare`), or label the color's basis explicitly.

### 4. Productize bus-factor / key-person risk as an "Org Resilience" module
- **Severity**: High
- **Lens**: business-visionary
- **Category**: monetization / market-fit
- **File**: src/app/org/[slug]/contributors/page.tsx:121-171 (concentration, bus factor, solo-maintainer)
- **Scenario**: The fleet already computes bus-factor, top-share concentration, and solo-maintainer flags — a CTO's "where will we get hurt if someone leaves" question — but it sits in a passive table with no alerting or trend.
- **Root cause / Rationale**: A high-anxiety, high-value risk signal is computed but not packaged or proactive.
- **Impact**: An "Org Resilience/Risk" premium view (alerts when a critical repo hits bus-factor 1, trend of concentration) is a distinct enterprise narrative competitors don't touch.
- **Fix sketch**: Add a Risk tab with thresholds + email/webhook alerts on key-person risk changes; gate behind Team+.

### 5. Stand up a DORA-style Delivery module
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: market-fit / differentiation
- **File**: src/app/org/[slug]/delivery/page.tsx:81-117 (PR signals, time-to-merge, review coverage)
- **Scenario**: Time-to-merge, review coverage, merge rate, and AI-involved-PR rates are already surfaced — most of a DORA/flow dashboard — but there's no trend, no cycle-time, and it's not positioned against LinearB/DX/Sleuth.
- **Root cause / Rationale**: The signals exist as point-in-time tiles, not a tracked delivery product.
- **Impact**: Bundling delivery flow with the AI-adoption angle is a differentiated "AI delivery" story and a paid Delivery module.
- **Fix sketch**: Add period-over-period trends to the existing PR signals and a cycle-time breakdown; market it alongside adoption as "AI's effect on delivery."

---

## Org Overview & Standing

### 1. Peripheral fetches can 500 the entire overview
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: error-handling / resilience
- **File**: src/app/org/[slug]/page.tsx:112-119
- **Scenario**: The overview's `Promise.all` runs six queries; `getOrgBenchmark` and `listGoals` are peripheral (a Standing card and goal chips), but neither is `.catch`-wrapped. A transient failure in either rejects the whole `Promise.all` and throws the user to `error.tsx` — blanking the entire dashboard over a non-core widget. (`generateMetadata` correctly uses `.catch(() => null)`.)
- **Root cause / Rationale**: Core and peripheral fetches share one all-or-nothing `Promise.all`.
- **Impact**: A flaky benchmark/goals read takes down the whole landing tab.
- **Fix sketch**: Wrap the non-core fetches in `.catch(() => null)` and degrade those sections individually, like the metadata path already does.

### 2. Social-unfurl metadata runs a full un-windowed rollup per crawl
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: performance
- **File**: src/app/org/[slug]/page.tsx:34-41
- **Scenario**: `generateMetadata` calls `getOrgRollup(slug)` (full, all-time) on every request, including link-unfurl/crawler hits. For a large fleet that's a heavy multi-query rollup duplicated for SEO/unfurl traffic, separate from the page's own rollup.
- **Root cause / Rationale**: Metadata reuses the heavy rollup just to print one average.
- **Impact**: Extra DB load on crawler/unfurl bursts; slower unfurls.
- **Fix sketch**: Use a cached/cheap single-value lookup (or short `unstable_cache`) for the headline number in metadata rather than the full rollup.

### 3. Dimension-average deep-links can scroll to a missing anchor under tech-stack scope
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case / UX
- **File**: src/components/org/DimensionAverages.tsx:31-39, src/app/org/[slug]/practices/page.tsx:24-30
- **Scenario**: A dimension row links to `/practices#practice-<id>`, but the Practices page scopes its mined library by tech-stack. If that practice isn't in the scoped library (or `getOrgPractices` returns none for the active scope), the anchor target doesn't exist and the click scrolls nowhere.
- **Root cause / Rationale**: The deep-link assumes the target practice card is always rendered; the practices page's scoping/empty-state can omit it.
- **Impact**: Dead-end navigation from the Overview's most-glanced chart.
- **Fix sketch**: Link with an explicit `?` that clears any stack scope, or fall back to the Practice Library top when the targeted card isn't present.

### 4. Ship a public, embeddable org scorecard + badge
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: growth / virality
- **File**: src/app/org/[slug]/page.tsx:29-48 (OG metadata already exists)
- **Scenario**: The org page already builds rich OG/Twitter cards, but there's no *public* org-level scorecard or README badge (the OpenSSF Scorecard adoption loop). Per-repo value stays private; nothing pulls new orgs in.
- **Root cause / Rationale**: The shareable surface is half-built (OG image) without a public landing page or badge to embed.
- **Impact**: A public "fleet maturity: L3 · 72/100" badge in READMEs is a low-cost inbound/virality loop directly competitive with Scorecard badges.
- **Fix sketch**: Add an opt-in public org scorecard route + an SVG badge endpoint; the OG card already proves the data path and privacy gating.

### 5. Use the Trajectory ETA for proactive re-engagement
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: retention / re-engagement
- **File**: src/components/org/Trajectory.tsx:72-104 (ETA to next level), src/app/org/[slug]/page.tsx:225
- **Scenario**: The forecast already computes "ETA → L4 in ~3 weeks." That milestone is a perfect re-engagement trigger, but it lives only on a page the user must visit.
- **Root cause / Rationale**: A computed predictive hook isn't connected to the email/notification system.
- **Impact**: "You're ~2 weeks from Level 4 — here's the one move to get there" emails (tied to the existing leverage-moves) drive return visits and scan cadence.
- **Fix sketch**: When `forecast.eta.kind === "promotion"` and fit isn't low-data, queue a milestone email referencing the top leverage move; gate frequency to avoid noise.
