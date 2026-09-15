# AI Trust Center — the aggregate-only leak model for a public tenant disclosure

_2026-08-29. Concept doc for moonshot deck item **#7** (`AI Trust Center: opt-in tenant-published
governance scorecard with signed digest`, XL · gate: policy · concept-doc first). Written before code
because the item creates the product's **first surface that publishes tenant data to anonymous
readers** — every other public surface is a lens over the shared public org. The design question is
not "can we render it" (every input exists); it is "what may a published page contain, who decides,
and how is a mistake reversible". No source was changed by this pass._

---

## The question

`/scorecard/[owner]` states the boundary in its own header and declines to cross it:

> "Publishing a TENANT's fleet scorecard would be a genuinely new disclosure and is therefore not
> built at all — it needs a persisted per-org opt-in flag (a schema change), which is deliberately
> out of scope. See the deployment note in docs; if that flag ever lands, the tenant view is the
> thing that must be gated, not this one."
> — `src/app/scorecard/[owner]/page.tsx:10-16`

Accepting #7 means deleting that paragraph. Before that happens, three things need answers a spec
cannot invent: **(a)** the exact allowlist of publishable facts and the floors under them, **(b)**
whether the published page is a live re-render or a frozen artifact, and **(c)** where the numbers
come from once #1's control ledger exists. This doc answers all three and hands the owner a decision
list.

## Ground truth in code today

Verified against the tree on 2026-08-29 (symbol names, not line numbers, are the addresses).

**Premises that held.**

- No opt-in flag exists. `model Organization` (`prisma/schema.prisma:30-75`) has `plan`, `kind`,
  `gatePolicy`, `brandName`/`brandColor`/`logoUrl`, retention overrides — and nothing publication-shaped.
  `grep -rn "trustCenter\|publicScorecard" src prisma` returns nothing.
- The digest/integrity substrate is real and reusable: `briefingFigureDigest` (a sha256 over an
  ordered projection, truncated to 16 hex) and `shareIntegrity` returning
  `"unverifiable" | "unchanged" | "changed"` (`src/lib/briefing-share.ts`). Its header records the
  decision this doc leans on: a live re-render carrying a fingerprint is honest about drift; a
  fingerprint that can only say "unchanged" would be the silent falsehood.
- White-label exists end-to-end: `OrgBranding` (`src/lib/db/branding.ts`), `planAllowsWhiteLabel`
  (`src/lib/plans.ts:390`, Team and up), OG card substrate at `src/lib/og/og-brand.tsx`.
- Public-surface invariants are already written down and tested: `src/lib/register/data.ts` pins every
  query to `DEFAULT_ORG_SLUG` **and** `isPrivate: false`, **re-asserting both on the second id-keyed
  fetch**, and carries mock-engine rows out as `verified: false` so they are never ranked. That header
  is the model this design copies, not merely cites.
- `CHAMPION_MIN_POP = 3` (`src/lib/org/champions.ts:7`), enforced in the **producer**
  (`src/lib/db/org-contributors.ts`, `org-teams.ts`) after JSX-side re-implementations drifted
  (`src/lib/db/teamRollup.test.ts:162`). `src/lib/org/adoption.test.ts:20` already imports the constant
  from that path, so a `src/lib/trust/**` import of it needs no move.
- `selfHosted()` (`src/lib/env.ts:73`) is the deliberate three-state exception with no production
  floor; it turns plan gates off.

**Premises that were FALSE or have moved.**

1. **The badge surfaces are gone.** `src/app/api/badge/**` and `src/app/api/scorecard/[owner]/badge/**`
   were deleted on the current branch (with `docs/features/billing/badge.md`), and `src/lib/badge.ts`
   does not exist. The dossier's "Sonar publishes badges, not governance posture" framing survives;
   its "reuse the badge route" implication does not, and `register/data.ts`'s header still names the
   badge route as a caller — a stale comment this work should fix while it is in that file's
   neighbourhood.
2. **The governance rollup is not aggregate-only and must not be reused wholesale.**
   `GovernanceOverview` (`src/lib/org/governance.ts:26-62`) carries `failures: GovernanceFailure[]` —
   **repo-named rows, worst first** — beside the counts. Pointing a public page at
   `buildGovernanceOverview` would publish a ranked list of a tenant's worst repositories by name.
   The trust read model must be a *projection* with its own type, never a re-export.
3. **The audit trail is actor-named.** `recordAudit` (`src/lib/db/scans-audit.ts:17`) stores
   `actorId`; `/about-org`'s mock trail renders `d.okafor · gate.policy.update`
   (`src/components/about-org/GovernanceEvidence.tsx:30-35`). A published "audit trail" cannot carry
   actor logins at all — that is a per-person disclosure with a population of one.
4. **Audit rows are purgeable**, floor `RETENTION_MIN_AUDIT_DAYS = 7` (`src/lib/db/retention.ts`), so a
   published page that cites "changes since" must state a horizon it can actually honour.

## The leak model (the core of this doc)

A publishable fact must clear **four gates in order**. The list is the contract a
`src/lib/trust/read.test.ts` asserts the way `register/data.test.ts` asserts its two invariants.

**Gate 1 — tenancy re-assertion.** Every row read for a trust page is fetched under the org id
resolved from the *published slug*, and each repo row's `isPrivate` is re-read on the row itself
before it contributes to any counter. "It came back from an org-scoped query" is not proof (the
register header's exact argument). Private repos **do** contribute to aggregates; they may never
contribute an identifier.

**Gate 2 — shape allowlist.** The projection type is a closed list of scalars and enums. Nothing else
may be added without editing the type and its test. Permitted in v1:

| Publishable | Never publishable |
|---|---|
| Per-control pass **counts + denominator** (protected default branch, required review, rulesets, gate policy) | Any repository name, full name, URL, permalink, or count so small it names one (see Gate 3) |
| Fleet maturity **distribution** (repos per level L1–L5) and fleet mean overall/adoption/rigor | Per-repo scores, the `failures[]` list, `closestToGreen`, movers, gainers |
| `assessed` / `incomplete` / `scanned` denominators, verbatim in the rollup's honest three-bucket sense | Any person: actor login, contributor, champion, team, reviewer, `mintedBy` |
| Engine mix as `{provider, count}` (G9 caveat rendered in the body, not a footnote) | Spend, credits, plan, seat counts, backlog, recommendations, goals, memory, skills |
| Gate policy **conditions as text** (`describeGatePolicy`, already public via the gate URL) | Alert sinks, webhook URLs, org member counts, audit rows in any form |
| A control-change **timeline as counts per day**, actor-free, sourced from #1's ledger | Anything derived from a `mock`-engine scan (carried out, never averaged in) |

**Gate 3 — floors, applied in the producer.** Two floors, both computed before rendering:

- `CHAMPION_MIN_POP = 3` on **any people-shaped number**. In v1 the answer is stronger and simpler:
  the projection contains no people-shaped field at all, and the test asserts the *absence* of the
  keys, so the floor cannot be regressed by adding one carelessly.
- `TRUST_MIN_REPOS` on the fleet denominator. Below it, per-control counts are suppressed and the page
  states "fleet too small to publish per-control figures" rather than printing "1 of 2" — which names
  a repo to anyone who can see the org's public repo list. Recommended value **5** (see decision 4).

**Gate 4 — honest nulls.** `unknown ≠ 0`. A control the scanner could not read (`Governance.readable`
false) is `null` and renders "not measured", never a failure; `incomplete` repos stay out of the
pass-rate denominator exactly as the rollup already does. A suppressed figure says it was suppressed.

## Design options

**A — live re-render.** `/trust/<slug>` computes the projection per request; the digest is computed
from the same projection and printed. Cheapest, always current. **Rejected:** publication is a
disclosure act, and here the owner would be publishing bytes they have never seen. A repo going
private, a scan landing, or a retention purge silently changes a public page; the owner's consent was
given to a page that no longer exists. It also makes "unpublish and prove nothing leaked" impossible.

**B — frozen snapshot of record.** Publishing serializes the projection into a `TrustSnapshot` row;
the public page renders **that stored artifact** and nothing else. Preview at publish time is
byte-identical to what ships. Reversible (unpublish = the route 404s; erase = the row is deleted).
**Cost:** the page goes stale, and "audit-ready" staleness is its own dishonesty.

**C — snapshot of record + drift line (recommended).** B, plus the page recomputes the *current*
projection server-side on each render and prints one line comparing digests, reusing the
`shareIntegrity` vocabulary: `unchanged` → "verified against live data at <time>"; `changed` → "the
underlying figures have moved since this page was published on <date>". The published numbers never
change without an owner action; the reader is never allowed to believe a stale page is fresh. This is
the same trade-off `briefingFigureDigest` already chose, and it should not fork.

Trade-offs against the guardrails: **G9** is satisfied by carrying the engine mix in the body of both
the page and `trust.json`. **G4** binds Gate 4 — a suppressed or unmeasured control is labelled, not
zeroed. **G8** is untouched (no sales path; the page is a disclosure, not a funnel gate). **G1/G2/G3**
are not implicated: nothing here rewrites a report.

## Recommendation

Ship **C**, Team-and-up or `selfHosted()`, owner-only, audit-logged on every state change, with the
projection type as the only thing the route may render. Sequence it **after #1 (governance evidence
ledger, lane W3-M)** and read the ledger rather than the live rollup where both can answer:

- Control counts come from #1's `ControlObservation` rows **as of a sealed day**, not from the latest
  scan, so the page states a control's state at a date instead of "whatever the last scan saw".
- The timeline is #1's ledger projected to `{day, control, transitions}` counts — actor-free by
  construction, because the projection drops `actorLogin` rather than being trusted to omit it.
- The integrity line cites #1's daily seal root beside the content digest, so an examiner can check
  the numbers against an export **without the signing secret** — which is the whole point of that
  seal.

Until #1 lands, a scan-sourced fallback (`Governance` on the latest scan) is acceptable **only** if
the page labels the basis as "latest scan per repo", because that is a materially weaker claim than
"observed at merge".

## Decisions for the owner

1. **Snapshot-of-record with a drift line (C), not a live page (A)?** — recommend **yes**.
2. **Ship after #1 merges, reading the control ledger?** — recommend **yes**; a fallback trust page
   built on latest-scan governance is a second basis to maintain and a weaker claim to defend.
3. **Owner-only publish, Team+ or `selfHosted()`?** — recommend **yes**, `requireOrgRole("owner")`,
   with a typed-confirm (the org slug) on first publish, as the erasure dialogs already do.
4. **`TRUST_MIN_REPOS = 5`?** — recommend **5** (A: 5 / B: 3, matching `CHAMPION_MIN_POP`). 5 is the
   conservative choice for a permanent public URL; a 3-repo fleet's per-control counts are close to
   naming repos.
5. **No per-repo rows at all in v1, even for public repos?** — recommend **yes**. A mixed page
   ("public repos named, private counted") invites exactly the boundary mistake this doc exists to
   prevent, and `/scorecard/[owner]` already publishes the public-repo view.
6. **Actor-free timeline (counts per day, no logins, no roles)?** — recommend **yes**.
7. **Is the published slug the org slug, or a separate opaque `trustSlug`?** — recommend a **separate
   slug**, defaulted from the org slug: an org slug can be a customer's internal codename, and a public
   URL is forever. Uniqueness enforced across orgs; reserved words rejected.
8. **`/trust/<slug>` in `sitemap.ts` only when published, and `robots.ts` left alone?** — recommend
   **yes**; `seo.test.ts` asserts sitemap and disallow stay disjoint, so an unpublished slug must be
   absent rather than blocked.
9. **`trust.json` unauthenticated and CORS-open?** — recommend **yes** for GRC connectors, rate-limited,
   with the same digest + `x-ascent-content-sha256` header `/api/audit` and `/api/history` already emit.
10. **`/about-org`'s `GovernanceEvidence` re-pointed at the demo org's live trust page now?** —
    recommend **no**: that is deferred deck item **#37** (data-bound deck diagrams). Ship the trust page
    first; leave the marketing component hardcoded and honestly labelled.

## Preconditions

- **#1 (governance evidence ledger) merged** (lane W3-M, wave 3), including the daily seal, so control
  counts have an as-of date and the timeline has an actor-free source.
- **A schema pass** owns the two additive changes (builders never touch `prisma/schema.prisma`):
  `Organization.trustCenterJson String?` (TEXT, the no-jsonb DSQL contract, parsed at the edge like
  `gatePolicy`) and `model TrustSnapshot { id, orgId, slug @unique, projectionJson String, digest
  String, sealRoot String?, publishedAt DateTime, publishedBy String, unpublishedAt DateTime? }` with
  `@@index([orgId])`. `TrustSnapshotRow` (client-facing) declares `publishedAt`/`unpublishedAt` as
  **`string`** and is added to `src/lib/db/wire-safe-dates.test.ts`.
- **Retention decides before publish:** `purgeExpiredData` and the org erase path must unpublish and
  delete snapshots (a purged tenant with a live public page is the worst failure mode available here),
  and the erase manifest/preview must list them.
- **A legal/ToS line** stating that a published trust page is the owner's disclosure of their own
  tenant data — the one non-engineering blocker.

## Write set if accepted

**New files**
- `src/lib/trust/projection.ts` — the closed projection type + `TRUST_MIN_REPOS`; no I/O.
- `src/lib/trust/read.ts` — `buildTrustProjection(orgSlug, opts)`; tenancy re-assertion, floors,
  honest nulls; reads #1's ledger; never imports `GovernanceOverview`.
- `src/lib/trust/digest.ts` — `trustDigest(p)` + `trustIntegrity(published, rendered)`, mirroring
  `briefingFigureDigest` / `shareIntegrity` shapes.
- `src/lib/db/trust.ts` — `getTrustConfig` / `setTrustConfig` / `publishTrustSnapshot` /
  `unpublishTrustSnapshot` / `getPublishedSnapshot`; audit rows on every one.
- `src/app/trust/[slug]/page.tsx`, `.../trust.json/route.ts`, `.../opengraph-image.tsx`.
- `src/app/api/org/trust/route.ts` — `GET` (preview, `requireOrgRole("admin")`), `POST` publish /
  `DELETE` unpublish (`requireOrgRole("owner")`, same-origin + typed-confirm).
- `src/features/admin/settings/TrustCenterCard.tsx` (+ `TrustPreview.tsx`, `TrustSectionPicker.tsx` —
  200-LOC cap under `src/features/**`, `"use client"` only where hooks are used).
- Tests: `src/lib/trust/read.test.ts` (the leak model, below), `digest.test.ts`,
  `src/app/api/org/trust/route.test.ts`, `src/features/admin/settings/TrustCenterCard.test.tsx`.
- `docs/features/trust/README.md` + `docs/features/trust/trust-center.md`.

**Files to edit**
- `src/app/scorecard/[owner]/page.tsx` — rewrite the header's opt-in paragraph to point at
  `/trust/<slug>` as the gated tenant surface; keep the "this page is still public-corpus-only" claim.
- `src/lib/register/data.ts` — header only: drop the deleted badge route from the caller list.
- `src/app/sitemap.ts` — published trust slugs (dynamic entry, empty when none).
- `src/lib/db/retention.ts` — purge/erase branches for `TrustSnapshot`, and the erase manifest line.
- `src/lib/plans.ts` — a `trustCenter` capability beside `whiteLabel` (Team+).

**Director-owned lines to request (never edited by the builder)**
- `prisma/schema.prisma` + `prisma/init.sql` + PGlite reconcile: the two additions above.
- `src/lib/db/index.ts`: the `trust.ts` barrel exports.
- `src/lib/db/wire-safe-dates.test.ts`: `TrustSnapshotRow`.
- `context-map.json`: a `Trust Center` context under the Marketing Site & Design System group.
- `scripts/docs/feature-doc-map.json`: `{ area: "trust", doc: "docs/features/trust/trust-center.md",
  sourceGlobs: ["src/lib/trust/**", "src/app/trust/**", "src/app/api/org/trust/**"] }`.

**Handoffs**
- To **W3-M (#1)**: the trust read needs an exported, actor-free ledger projection
  (`controlCountsAsOf(orgId, day)` and `controlTransitionCounts(orgId, range)`) plus the seal root
  getter. W3-M owns those files; this lane must not edit `src/lib/alerts.ts` or
  `src/lib/conformance/pack.ts`.
- To the **wave-3 schema pass**: the two models above.

**Tests the design must fail before it passes** — a fixture org with one private repo whose name is a
sentinel string, two contributors, and one mock-engine scan; assert the rendered page HTML, the
projection object and `trust.json` contain the sentinel **nowhere**; assert every key of the projection
is in the allowlist (structural key test, so a future field cannot slip in); assert the fleet under
`TRUST_MIN_REPOS` suppresses counts; assert a mock scan never enters a mean. UAT journey to re-run:
**Tomáš** (procurement-facing evaluation of the public surfaces).

## Out of scope

- **#6 — Signed maturity attestation (in-toto/DSSE) + verify CLI** (deferred). This doc's integrity
  story is a sha256 content digest plus #1's daily seal root: enough to detect drift and deletion,
  and explicitly **not** a signed in-toto envelope with an offline verifier. If the trust page ever
  serves a DSSE envelope it will be because #6 shipped and this page consumes it; nothing here should
  be built in a way that pre-empts that envelope's shape.
- **#37 — Data-bound deck diagrams** (deferred): re-pointing `/about-org`'s `GovernanceEvidence` at a
  live read model is that item, not this one (decision 10).
- **#2 — Open benchmark corpus** (concept-doc): publishing a tenant's percentile against other
  tenants is a *second* disclosure with its own consent question. The trust page publishes the
  tenant's own figures only.
- **#22 — Developer-held credential lane** and **#31 — signed tenant history bundle**: neither is a
  prerequisite; a trust page exporting a scan time series would be #31.
