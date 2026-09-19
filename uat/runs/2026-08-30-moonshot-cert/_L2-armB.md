# L2 — Arm B (SEEDED / AUTHED), run 2026-08-30-moonshot-cert

Base `http://localhost:3000` — the **shared** dev server, reused, never restarted.
Identity asserted before any evidence was trusted: `GET /api/health` →
`{"status":"ok","db":"up","reconnected":false,"dbMode":"pglite","autoscan":{"ready":false,"cronSecret":false,"githubApp":false,"db":true}}`
— Ascent's shape (`dbMode` + `autoscan`), not a foreign app.

Drivers (new this arm, alongside arm A's): `uat/driver/drive-armB-tabs.mjs` (multi-route capture in one
session), `drive-armB-copybrief.mjs` (clipboard read of "Copy briefing for LLM"),
`drive-armB-gatepolicy.mjs` (the NADIA-L1-07 before/after experiment), `drive-armB-click.mjs`
(navigate + click one tab). Shots in `uat/runs/2026-08-30-moonshot-cert/shots/`.

---

## Journal

- **Fixture survey first.** `/org` 302s to `/org/public` — a **48-repo, 93-scan seeded org already
  exists**, with genuine multi-day history (`/api/usage?org=public` daily buckets: 08-10 ×1, 08-14 ×2,
  **08-22 ×25, 08-23 ×10**). The preflight's "⚠ KNOWN FIXTURE GAP — no seeded org can produce a
  forecast" is **stale on this host**: `public` produces one, and a second org, **`kiro`**, carries two
  priced usage lanes. Both were left over from earlier work — treated as found data, provenance noted,
  never as something I made.
- **The window is the fixture.** I could not backdate `scannedAt` (CLI `DATABASE_URL` does not reach
  the embedded PGlite, and the dev server holds an exclusive lock). I didn't need to: the org shell
  already accepts `?range=custom&from=&to=`, so I *selected* a window containing exactly the two scan
  days 08-22 and 08-23. That is the smallest possible fixture for the low-data forecast checks — zero
  rows written.
- **Two tabs, one click apart, disagreeing.** With that window: Briefing says "Climbing at +35/wk";
  Delivery says "Not enough history to project: 2 distinct scan days". Same org, same period, same
  session. I stopped and re-ran both to be sure I hadn't mixed up windows. I hadn't.
- **The gate-policy experiment was the sharpest 90 seconds of the arm.** Set `requireChecks` by API,
  saw the product *render* it, changed one unrelated number in the editor, and watched it vanish. The
  audit row the app wrote for its own save names the deleted field in `previousPolicy` — the system
  knows exactly what it destroyed and tells the operator nothing.
- **Where I was wrong to expect absence.** Two of Victor's checks were briefed as "expect absence".
  Per-lane spend is *not* absent — it is on screen, and it is what exposes a much worse number.
- **Honest limits.** No GitHub App on this host (`isAppConfigured()` false), so `POST /api/org/watch`
  is unreachable, so `recordConformance` returns `recorded:false`, so **no `ControlObservation` row
  can be created through any app path**. Nadia's populated-controls-table arm dies there. And the
  seeded org's slug is literally `public`, which `meter.ts:219` uses as the anonymous-funnel sentinel
  — every non-scan model call for it is unmetered *by design*, so my minted LLM turn could not land a
  `UsageEvent` there. I moved that arm to `kiro` rather than call it refuted.
- **Restored.** `public`'s gate policy was `null` when I arrived and is `null` again.

---

## Per-check verdicts

### 1. DANA-L1-013 — forecast basis / compaction coverage — **confirmed** (with a correction)

`forecastBasis` still has **zero non-test callers** (`grep -rn forecastBasis src` → `forecast.ts:384`
definition + `forecast.test.ts` only). Its own doc comment at `forecast.ts:382` asserts a caller that
does not exist:

> `(Called by the executive briefing's trajectory clause — moonshot #26.)`

Live, on the 90-day Briefing tab:

```
- heading "Trajectory" [level=2]
- paragraph: Declining at -2/wk, staying within L4 · Integrated for now.
- paragraph: trend confidence 34% · noisy
```
`shots/armB-exec.aria.yaml:82-84` · `shots/armB-exec.png`

No "fit over N scan days across M days" anywhere on the tab, in the PDF, or in the LLM markdown.
Compaction coverage likewise never renders (`compactedPoints` reaches no consumer outside
`forecastBasis`).

**Correction to the surface model L1 carried:** "every forecast Dana reads" is one forecast. The
`Trajectory` card in `src/features/standing/overview/` is **not rendered on the Overview tab at all** —
its only importers are `src/app/trends/TrajectoryPanel.tsx` and `src/components/org/PersonalOverview.tsx`.
The org **Overview** tab (`shots/armB-orgpicker.text.txt`, full capture) contains no trajectory,
forecast, ETA or confidence string. The fleet trajectory exists on **Briefing only**, via
`ExecutiveTrajectoryCard`. Screenshot of the surface where a basis should live: `shots/armB-exec.png`.

### 2. DANA-L1-001 / DANA-L1-002 — the low-data hedge is deleted, and no presentability gate is consulted — **confirmed**, both, on one screen

Fixture: `?range=custom&from=2026-08-21&to=2026-08-24` over `public` — a window whose only scan days
are 08-22 and 08-23, so `forecastTrajectory` returns `points: 2` → `lowData: true`. No rows written.

**The same object, rendered by two functions, in one session:**

| Window | Briefing trajectory clause (clipboard, "Copy briefing for LLM") |
|---|---|
| `range=90d` (n ≥ 3) | `- Trajectory: Declining at -2/wk, staying within L4 · Integrated for now. (trend confidence 34%, noisy)` |
| `custom 08-21→08-24` (n = 2) | `- Trajectory: Climbing at +35/wk, staying within L4 · Integrated for now.` |

`shots/armB-brief-90d.md:10` · `shots/armB-brief-lowdata.md:10`

**The less trustworthy fit renders more confidently.** The hedge is not weakened on `lowData` — it is
*removed*, because `briefing.ts:383` nulls `forecastConfidence` and both the markdown (`:554`) and the
board PDF (`briefing-document.tsx:127`) gate the whole hedge on that value being non-null. And
`+35/wk` is a two-point blip extrapolated to a weekly rate with nothing on screen to say so.
Screen confirms: `shots/armB-exec-lowdata.aria.yaml:82-83` has `heading "Trajectory"` → `paragraph:
Climbing at +35/wk…` and then goes straight to `heading "vs previous period"`. No confidence line at all.

Board PDF: both windows download 200 (`content-disposition: attachment;
filename="ascent-briefing-public-2026-08-30.pdf"`), 6982 B (90d) vs **6597 B** (low-data) —
`shots/armB-briefing-90d.pdf`, `shots/armB-briefing-lowdata.pdf`. @react-pdf subsets its fonts so the
text is not extractable here; the *conditional* is the identical one the markdown exercises
(`briefing-document.tsx:127`), and the markdown is the one artifact I could read verbatim.

**DANA-L1-002 — the presentability gate.** `MIN_FORECAST_POINTS = 3`, `MIN_FORECAST_SPAN_DAYS = 14`
(`forecast.ts:349,352`). Neither `isProjectable` nor `forecastInsufficiency` appears anywhere on the
briefing path. Proof by contradiction, live, one click apart on the same org and window:

```
Briefing  →  Climbing at +35/wk, staying within L4 · Integrated for now.
Delivery  →  Not enough history to project: 2 distinct scan days
             (a line through ≤ 2 points fits perfectly no matter how noisy the data).   ×3
```
`shots/armB-exec-lowdata.aria.yaml:83` · `shots/armB-delivery-lowdata.text.txt:41,43,45`

Delivery renders `forecastInsufficiency` verbatim (`DeliveryFitReadout.tsx:19`) and independently
confirms `points = 2`. The board deliverable projects from a sample the product's own Delivery tab
refuses to project from. That is not a missing caveat; it is the product contradicting itself in
writing, and the version that goes to the board is the confident one.

### 3. DANA-L1-017 — briefing export + shared composed lines — **confirmed (STRENGTH)**, loop-proof line unexercised

The PDF **generates**: `HTTP 200`, `content-type: application/pdf`, `cache-control: private, max-age=300`,
6982 B for 90d. Every scope-bearing line the L1 credited is on the artifact, and every one states its
denominator (`shots/armB-brief-lowdata.md`):

```
- Value this period: fleet +2 pts across 48 scanned repos · 1 repo leveled up
- 1 of 1 repos with a comparable prior scan moved (of 48 scanned)
  ... the widest shared gap across the fleet (D1 …, shared by 2 of the 48 scanned repositories)
```

Three different denominators — *scanned*, *comparable*, *sharing the gap* — each named in place. This
is the reconciliation DANA-L1-010/011/012 asked for, and it travels because it lives in
`movementLine` / `valueRealizedLine` / `nextMoveLine`, which the screen, PDF, share page and markdown
all call. Senior bar: **passed** on reconciliation; **failed** on trajectory honesty (check 2), which
is the same artifact.

**The loop proof line does not appear** in either window's markdown. That is the honest-absence
contract (`briefingProofLine` returns null rather than "0 · 0"), not a bug — this org has no rollout
proof data. So the "all four renderers got the fix at once" claim is verified for the reconciliation
lines and **unexercised for the loop-proof line on this host**. Fixture to close it: an org with
practice-application + loop-run rows.

### 4. NADIA-L1-07 — `requireChecks` erased by an unrelated edit — **confirmed**, and worse than stated

Precondition built by API (owner session, bypass viewer `developer`):

```
POST /api/org/gate-policy {"org":"public","policy":{"minLevel":"L3","minOverall":50,"minDimension":40,
   "requireChecks":["control.prepush.lint","guardrail.never-commit"]}}
→ {"ok":true,"policy":{…,"requireChecks":["control.prepush.lint","guardrail.never-commit"]}}
```

**The product renders it read-only.** Governance → Active policy, before:

```
▸ Minimum overall level L3
▸ Overall score ≥ 50
▸ Every dimension ≥ 40
▸ Reported controls must not be failing: control.prepush.lint, guardrail.never-commit
```
`shots/armB-nadia07-before.text.txt:73-80` · `shots/armB-nadia07-before.png`

Then, in the browser, I changed **one unrelated field** — Min overall 50 → 55 — and clicked
**Save policy**. After:

```
▸ Minimum overall level L3
▸ Overall score ≥ 55
▸ Every dimension ≥ 40
EDIT POLICY
```
`shots/armB-nadia07-after.text.txt:73-79` · `POLICY AFTER : {"policy":{"minLevel":"L3","minOverall":55,"minDimension":40}}`

The merge bar is gone. No confirmation, no warning, no diff, no toast. **And the app's own audit row
proves it knew:**

```json
{"action":"org.gate_policy","actorId":"developer","at":"2026-08-30T20:01:19.596Z","meta":{
  "action":"set",
  "status":"min L3 · min overall 55 · no dim < 40",
  "policy":{"minLevel":"L3","minOverall":55,"minDimension":40},
  "previousPolicy":{"minLevel":"L3","minOverall":50,"minDimension":40,
                    "requireChecks":["control.prepush.lint","guardrail.never-commit"]}}}
```
`GET /api/audit?org=public`

`previousPolicy` carries the field; `policy` and the human-readable `status` do not mention its
removal. The ledger records the deletion of a merge-blocking control and the operator is never told.

**Refinement to Priya's L1-01 and Nadia's L1-07:** it is not true that "no UI surface mentions the
field exists" — `describeGatePolicy` renders it in the Active-policy summary, above the editor that
cannot set it and will silently delete it. That combination (visible, unsettable, destroyed by an
adjacent save) is strictly worse than invisible.

### 5. NADIA controls table / `truncated` / ledger CSV — **split**

- **`truncated` flag at the UI — confirmed unread.** `GET /api/org/controls?org=public` →
  `{"timeline":[],"coverage":[],"truncated":false,"limit":200}`. `grep -rn truncated src/features/standing/governance`
  finds no consumer; nothing on the tab renders a cap disclosure. Absence confirmed live, but on an
  *empty* ledger, so the cap itself is untested.
- **NADIA-L1-04, no ledger CSV — confirmed.** `GET /api/org/controls?org=public&format=csv` →
  `200 application/json` — the param is ignored, JSON comes back. The only CSVs on the tab are the
  change-management evidence pack (`/api/org/conformance-pack?…&file=manifest|sample|findings`,
  `shots/armB-nadia07-after.aria.yaml:252-259`), which is a different population. Meanwhile
  `/api/audit/verify` **publishes the full `SEAL_RECIPE`** (row digest field order, day-root
  construction, UTC day rule) — a recipe you are told how to compute and given no rows to compute it
  over.
- **Observation states in the table — `uncertain — not reproducible on this host.`** The org has zero
  `ControlObservation` rows. I tried to build the fixture: `POST /api/report/conformance` with a
  5-finding doctor payload (`control.prepush.lint` fail, `guardrail.never-commit` fail,
  `security.published-advisories` warn, `repo.visibility` pass, `control.ci.tests` unchecked) for
  `vercel/swr` and `prisma/prisma` → `{"ok":true,"recorded":false,"stale":false}` both times, because
  neither repo is a **watched** repo, and `POST /api/org/watch` is hard-gated on
  `isAppConfigured() && isDbConfigured()` — and `autoscan.githubApp` is `false` on this host.
  **Fixture that would close it:** an installed GitHub App (so a repo can be watched), or a direct
  `WatchedRepo` insert, then the same conformance POST. Not `refuted` — the code path is intact, the
  precondition is unbuildable here.

### 6. NADIA-L1-05/06 — any UI affordance to seal, or to view seals — **confirmed absent**

Live governance tab, Control observations card:

```
- heading "Control observations" [level=2]
- paragraph: "What each control was, when it changed, and — where a GitHub event named one — who
  changed it. Scan- and probe-sourced rows carry no actor: nobody performed those in a way we observed."
- paragraph: No control observations yet. They accumulate as this org's repositories are scanned and
  probed; an installed GitHub App also adds the actor behind each change.
```
`shots/armB-nadia07-after.aria.yaml:261-263` · `shots/armB-nadia07-after.png`

There is **no button, no link, no seal list, no chain-status indicator** anywhere in the product. The
sole mention of verification in the entire UI is a non-interactive `<code>` string —
`ControlTimelineCard.tsx:135`, `Verify this ledger's integrity at /api/audit/verify?org={slug}` — and
it lives inside the card's **non-empty** branch, so on an empty ledger (the state a new org is in) a
user is never told the ledger is verifiable at all.

Lazy sealing confirmed reachable, and confirmed to be the only way seals ever come into existence:

```
GET /api/audit/verify?org=public
→ {"org":"public","chainOk":true,"seals":[],"unsealedDays":[],"sealedOnThisRequest":[], "recipe":{…}}
```

The call wrote an audit row (`{"action":"controls.verify","meta":{"days":0,"chainOk":true,"sealedNow":0,"tampered":[]}}`),
which is itself the tell: sealing happens as a side effect of a URL nobody is shown.

**Naming hazard L1 missed:** the Governance tab already uses the word **SEALED** for something else
entirely — the AI-stance perimeter's *"Repos and paths closed to AI authorship"*
(`shots/armB-nadia07-after.text.txt:388-390`). An appsec lead reading this tab meets "SEALED" as a
posture control, and the tamper-evident ledger seal — the thing an examiner cares about — is the one
with no word on screen at all.

### 7. VICTOR — per-lane cost visibility — **REFUTED as briefed, and it exposes a bigger defect**

Per-lane spend is **not** absent. It is on `/usage`, and it is what makes the headline wrong.

On `/usage?org=kiro`, one page, one 30-day window (`shots/armB-usage-kiro.text.txt:100-137`,
`shots/armB-usage-kiro.png`):

```
EST. COST
$25.90
last 30d · built-in rates (approx.)
…
Spend by lane · model calls · last 30d
Scan · $25.90            43 · 45%
Local agent · $89.38     53 · 55%
34 of 53 calls could not be priced (no rate for the model, your own provider account, or no tokens reported).
…
Spend by team · code owners · last 30d
Org-wide (no repo) · $115.28    96 · 100%
```

**The headline tile understates the page's own total by 78 %.** `$25.90` is the scan lane alone;
the lane panel sums to `$115.28`, and the team panel prints that number in full three rows below the
tile. Nothing on the tile says it counts one lane. Corroborated by the API:
`estimatedCostUsd: 25.89913` at top level while `byLane` sums to `115.276653`. And even `$115.28` is a
floor — 34 of 53 local calls are unpriced. A FinOps director reads the big number first; the big
number is the small one.

**Minting a `UsageEvent` live: done, and it recorded nothing — for a reason worth naming.** I ran a
real memory-check turn against `public`:
`POST /api/org/memory/check` → `{"recommendation":"duplicate","engine":"claude-cli","comparedCount":2,
"summary":"prisma/prisma maturity promoted from L4 Integrated to L5 Autonomous, overall 78 to 87."}`,
12.1 s wall clock, `llmUnavailable:false` — a genuine Claude CLI call that read two of the org's
memories. `byLane` afterwards: unchanged, `[{lane:"scan",…}]` only. The cause is
`src/lib/llm/meter.ts:219`:

```ts
if (!orgSlug || orgSlug === "public") return;
```

The seeded org's slug is literally `public`, the reserved anonymous-funnel sentinel, so **every
non-scan model call against it is dropped from the ledger by design**. That is defensible for the real
anonymous funnel and a live trap for a seeded demo tenant that happens to own that slug: it burns
subscription inference and shows `$0` for it forever. `kiro` (a normal slug) proves the lane path
works. Verdict for the `public`-org arm: `uncertain — not reproducible on that org`, fixture named
(any non-`public` slug); verdict for the check as asked: **refuted**, per-lane cost is shown.

### 8. VICTOR — showback CSV — **confirmed absent as an affordance; present as an endpoint**

The export exists and works:

```
GET /api/usage?org=kiro&view=showback
scope,lane,team,calls,estimatedCostUsd,unpricedCalls
lane,scan,,43,25.899130,0
lane,local,,53,89.377523,34
team,,Org-wide (no repo),96,115.276653,
```

It is exactly the artifact Victor needs — lanes, teams, unpriced counts, reconciling to `$115.28`.
And `grep -rn showback src/app src/components src/features` returns **only `src/app/api/usage/route.ts`
itself**. The `/usage` page offers `EXPORT CSV` and `EXPORT JSON` (`shots/armB-usage-before.text.txt`),
and `?format=csv` yields `date,billable,free,total` — scan counts, no money, no lanes. So the finished
showback artifact is reachable only by reading the source. Sharper than "the feature is missing": the
feature is built, correct, and unlinked.

### 9. SAM-L1-09 — measured-outcome roadmap — **observation confirmed, diagnosis refuted, measured arm uncertain**

`GET /api/recommendations?repo=vercel/next.js` (`shots/armB-sam-recs.json`) returns 3 persisted rows
whose keys are
`id, title, dimension, impact, effort, rationale, explore, levelUnlock, status, assigneeLogin,
targetDate, projectedPoints, unlocks, expectedLift` — `expectedLift` **is** on the wire, and is `null`
on all three. `&sort=measured` returns `sort:"priority"`.

The rendered Roadmap tab (`shots/armB-sam-roadmap.text.txt`, `shots/armB-sam-roadmap.png`,
`/report/vercel/next.js?tab=roadmap`) carries **no** measured clause and **no** priority/measured
toggle — `grep -ci "measured|expected lift|sort by" → 0`.

But L1's inference — *"proving the data exists and only the UI seam is missing"* — is **wrong**. The
seam exists: `src/components/report/ExpectedLiftBasis.tsx:29` renders `expectedLiftClause`, and
`RecommendationTracker.tsx:79-81` holds a `sortMode` state with
`const anyMeasured = items.some(…) ; sortRoadmap(items, lifts, anyMeasured ? sortMode : "priority")`
— the toggle is deliberately conditional on at least one publishable basis. Both the API's
`sort:"priority"` downgrade and the UI's hidden toggle are the *same* designed refusal to order by
zero measurements. What is absent is the **data**, not the seam.

Measured arm: `uncertain — not reproducible on this host`. `expectedLiftClause` returns null below
`OUTCOME_MIN_SAMPLES`; no seeder produces outcome rows and there is no app path to insert them.
**Fixture:** ≥3 `kind:"recommendation"` outcome rows sharing one `recommendationMatchKey` and one
instrument.

*Aside, not my brief but on screen:* SAM-L1-05 is visible in this capture — every roadmap row's
concrete move is inside a rationale paragraph ("AI Tooling & Conventions scored 65/100. Substantive,
machine-readable guidance … is what lets an AI contribution land consistently and on-spec."); the only
non-prose fields are `impact: high`, `effort: low`, `↑ up to +6 pts`.

### 10. PRIYA-L1-01 (l2_priority HIGH) — `requireChecks` un-settable — **confirmed**

Full field list of the Governance policy editor, read from the rendered page
(`shots/armB-gov.text.txt:81-110`, `shots/armB-gov.png`):

```
EDIT POLICY
  Minimum level                  any | L1 | L2 | L3 | L4 | L5
  Min overall
  Min per-dimension
  Security floor (D9 ≥)
  Forbid "ungoverned" posture
  Require a protected default branch
  OTHER DIMENSION FLOORS  (Enforced by the gate; not exposed as a CI input.)
    Add a floor →  D1 … D8
  [Save policy]  [Reset to default]
```

No control for `requireChecks`. Confirmed. See check 4 for the two aggravating facts L1 did not have:
the field **is** displayed read-only in the Active-policy summary directly above the editor, and the
editor **deletes** it on any save.

### 11. PRIYA-L1-02 (l2_priority MEDIUM) — structurally-impossible `0 repos` — **confirmed**, under the strongest possible conditions

Captured while `requireChecks: ["control.prepush.lint","guardrail.never-commit"]` was **actively set**
and printed in the Active-policy summary six rows above:

```
Where the fleet fails — Repos failing each gate condition (counted once per repo).
  Below required level                       8 repos
  A dimension below floor                   33 repos
  Ungoverned posture                         0 repos
  Below overall score                       15 repos
  Unprotected default branch                 0 repos
  AI changes merged without human review     0 repos
  AI authorship in a blocked repository      0 repos
  A required control is failing              0 repos      ← structural, not measured
  Scored nothing — not judged                0 repos
```
`shots/armB-nadia07-before.text.txt:118-136` · aria `shots/armB-nadia07-after.aria.yaml:112-113`

Four of those nine rows (`control`, `admission`, AI-review, AI-authorship) are pinned to 0 by
construction — `evaluateGateLite` has no ledger or PR inputs — and they render as identical live
meter rows beside five genuinely measured ones. A lead who has just set two required controls reads
"A required control is failing: 0 repos" as *the fleet is clean*. `governance.ts`'s comment
("these stay 0 honestly, because the criteria were never DUE here") is exactly right and never
reaches the screen.

---

## Residue — everything this arm created or changed

| # | What | State now |
|---|---|---|
| 1 | `Organization.gatePolicy` for org `public` | **Restored.** Was `null` on arrival; I set it three times (last: `minLevel L3 · minOverall 55 · minDimension 40`, requireChecks erased by the UI save) and then `POST {"policy":null}` → `GET` confirms `{"policy":null}`. |
| 2 | 4 × `AuditLog action:"org.gate_policy"` rows on org `public` (2026-08-30T20:00–20:04Z, `actorId:"developer"`) | **Permanent.** Audit rows are append-only by design; not deletable through any app path. |
| 3 | 1 × `AuditLog action:"controls.verify"` row (2026-08-30T20:03:48Z, `meta.sealedNow:0`) | **Permanent**, same reason. No `ControlLedgerSeal` row was created (0 unsealed days). |
| 4 | 2 × `POST /api/report/conformance` for `vercel/swr`, `prisma/prisma` | **No rows persisted** — both returned `{"recorded":false,"stale":false}` (repos not watched). No `ConformanceReport`, no `ControlObservation`. |
| 5 | 2 × `POST /api/org/memory/check` on org `public` | **No rows written** — `check` is analysis-only and never persists a memory. The second call spent one real claude-cli turn (12.1 s) against the user's subscription. No `UsageEvent` (see check 7). |
| 6 | 2 × `GET /api/org/briefing/pdf` | Read-only. PDFs saved to the run dir, not to the app. |
| 7 | New driver files: `uat/driver/drive-armB-tabs.mjs`, `drive-armB-copybrief.mjs`, `drive-armB-gatepolicy.mjs`, `drive-armB-click.mjs` | Uncommitted working-tree files, reusable by later arms. |
| 8 | Shots + artifacts under `uat/runs/2026-08-30-moonshot-cert/shots/`: `armB-orgpicker`, `armB-exec`, `armB-exec-lowdata`, `armB-gov`, `armB-delivery-lowdata`, `armB-security`, `armB-practices`, `armB-passports`, `armB-nadia07-{before,after}`, `armB-usage-before`, `armB-usage-kiro`, `armB-sam-report`, `armB-sam-roadmap` (`.png`/`.aria.yaml`/`.text.txt` each), `armB-brief-{90d,lowdata}.md`, `armB-briefing-{90d,lowdata}.pdf`, `armB-sam-recs.json` | Run artifacts. |
| 9 | **Nothing** created: no org, no scan, no watched repo, no memory, no member, no API token, no credit grant. The `:3000` server was never restarted. | — |

**Pre-existing data I used but did not make** (provenance flagged per the residue rule): org `public`
(48 repos, 93 scans, history on 08-10/08-14/08-22/08-23) and org `kiro` (43 scans + 53 `local`-lane
`UsageEvent` rows, 34 unpriced). Both predate this arm; I treated them as found fixtures.
