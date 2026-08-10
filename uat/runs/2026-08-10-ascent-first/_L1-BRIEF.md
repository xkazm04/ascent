# L1 brief — 2026-08-10 · first run under `/uat` v1.2

## Scope note (read this first — the run's framing was corrected)

The run was commissioned as ascent's **first** `/uat` outing, with an `init` that would author
three fresh Characters. That premise was **false and was corrected before any work landed**:
ascent already carries a mature `uat/` overlay — **30 Characters, 11 journeys, 5 prior runs**
(`2026-06-19-L1`, `2026-06-19-L2`, `2026-06-20-pricing20`, `2026-07-16-full-sweep`,
`2026-07-16-recertify`). What *is* new is the **engine version**: `/uat` v1.2 was installed here
on 2026-08-10 (`f6862608`), and every prior ascent run predates it. So this is the **first run
under v1.2**, not the first run.

Authoring three duplicate Characters into a 30-Character roster would have been pure pollution.
Instead this run **selects three existing Characters** — matching the requested shape exactly
(core internal roles + at least one external/buyer) — and does an `update`-shaped overlay
refresh for the two v1.2/v1.1 obligations ascent's overlay never received: a **shared grounding
denominator** (§grounding in `env.md`) and a **port-identity preflight** (§App+server).

## Selection

| Character | Journey | Why |
|---|---|---|
| **Sam (Staff Engineer)** — `uat/characters/sam-staff-engineer.md` | `scan-my-repo-get-a-roadmap` | Core internal technical user; the public single-repo scan is the product's central AI surface — the grounding audit's sweet spot. |
| **Dana (VP Engineering)** — `uat/characters/dana-vp-engineering.md` | `prove-and-track-fleet-maturity` | Core internal leadership user; binds `/org/[slug]` + Executive Briefing, which is where the prior run's #1 finding lived. |
| **Tomáš (prospective buyer)** — `uat/characters/tomas-prospective-buyer.md` | `evaluate-whether-to-adopt` | The required external/buyer perspective; judges the public funnel + pricing + one self-serve scan. |

## Environment (this run)

- **Port 3002** — 3000 and 3001 were occupied by a *different* app on this host. See
  `uat/env.md` §"Port is NOT guaranteed to be 3000". `BASE_URL=http://localhost:3002`.
- `LLM_PROVIDER=claude-cli` (real Claude output, subscription), PGlite persistence live,
  `ASCENT_AUTH_BYPASS=1`, `ASCENT_OPEN_ORG_DASHBOARDS=1`.
- **Fixtures verified live:** `/org/vercel` (147KB rendered) and `/org/acme` (227KB) are
  populated; `/org/ascent` and `/org/demo` are empty shells (~42KB) — do not bind to them.
  `/api/history?repo=vercel/next.js` returns real prior scans.

## Recurrence leads (v1.2 ranks `recurrence` above convergence and above impact arithmetic)

The 2026-07-16 sweep's top findings. Check whether each is still live; if a gap returns
unchanged, set `recurrence: 2` — it has now cost a Character trust twice.

1. **Executive Briefing trajectory ETA rendered with no low-data caveat** (`src/lib/org/briefing.ts`),
   found by 14 of 20 Characters last run. **Partially fixed** — `briefing.ts:284-289` now
   suppresses the *confidence number* when `forecast.lowData`, with a comment citing
   `forecast.ts`'s warning. But `briefing.ts:393` still renders `forecastHeadline`
   **unconditionally**, and the code comment concedes it: *"the trajectory headline still
   renders, just without a bogus confidence."* → **Dana must judge whether a dated ETA headline
   with the confidence stripped is honest or worse** (a number with no hedge reads *more*
   confident, not less). Candidate `recurrence: 2` at narrowed scope.
2. **`/usage` low-balance banner false-fires** off `creditBalance === 0` alone, contradicting
   adjacent "within your allotment" text. Dana may reach `/usage`.
3. **Public-funnel scan forgotten on reload** (report + trend + tracker). Sam's and Tomáš's
   surface. Note `persistScanReport` now dedups per commit-SHA and upgrades mock→live
   (`src/lib/db/scans-persist.test.ts`); `src/lib/db/improvement.ts:513` still comments that a
   "scan row may never exist". Verify what actually persists for an anonymous public scan.
4. Governance dashboard vs `/api/gate` can disagree for the same repo — out of these 3 journeys.
5. `vercel/next.js` D4 scored 92 (stale cached discovery register) vs 15 (fresh scan).

## Method obligations for every walker (v1.2)

- **Shared grounding denominator** — score every AI surface against the canonical list in
  `uat/env.md` §grounding. **Never invent your own denominator.** Segment-specific sources you
  think matter are recorded as *named additions*, not a changed denominator.
- **Reachability BEFORE judging** — compute the Character's actually-reachable surface set
  (auth bypass, org fixture presence, plan/tier gating). Tag out-of-set findings `unreachable`.
- **Enumerate every branch of a shared mapping** — convergence is NOT coverage. If a finding
  lands inside a switch/map/lookup serving sibling cases, audit *every* branch and say which
  are clean.
- **`l2_priority` must declare its environment precondition** — keys present/absent, provider
  (`claude-cli` vs `mock`), DB on/off, org fixture, auth bypass. L2 preflights these; anything
  unsatisfiable resolves `uncertain — not reproducible on this host`, never `refuted`.
- **Impact over label** — `impact: {frequency, reachability, trust_erosion}` drives rank;
  `severity` is the headline word derived from it.
- **Execute, don't eyeball** — when a claim hinges on a regex/parser/branch, run it.
- Every report opens with a `sources:` list of the files the surface model was built from.
