# Follow-ups: the ledger, the prompt, and the scan that closes the loop

**Status (2026-08-17): SHIPPED.** The item-first "Worklist" direction won a two-variant prototype
round (the repo-first "Sessions" cards and the switcher were deleted). The Backlog and Plan tabs
were retired the same day; what fitted a mass-scan world was ported here (see *Ported*). The
retirement record is in [org-planning/plan.md](../org-planning/plan.md).

## The problem this replaces

Ascent produced gaps in several places — the report roadmap, the Backlog tab (owners, due dates,
owner/due grouping, bulk assign), the Plan tab (goals, initiatives, simulator, program) — planning
machinery sized for a quarter. But the work a gap describes is usually one Claude Code session:
"take these five things about this repo and fix them". None of the surfaces produced *the thing
you paste into that session*, and none of them learned from it afterwards; a fixed gap stayed
open until someone clicked it closed.

## The loop

```
scan ──▶ Recommendation rows (open) ──▶ Follow-ups ledger ──▶ pick a batch
                                                                  │
   next scan of the DEFAULT branch  ◀── commit(s) with trailer ◀── ONE fix prompt → local agent
   ├─ trailer names the id ─────────────▶ done  ("resolved by commit trailer")
   ├─ gap no longer restated ───────────▶ done  ("no longer raised by scan …")
   └─ gap restated, no trailer ─────────▶ stays handed off
```

Three moving parts, all in `src/lib/org/followups.ts` (pure, tested):

| Part | What it is |
| --- | --- |
| **The prompt** — `buildFixPrompt(items, ctx)` | One section per repository (a prompt is for one codebase), ordered by projected points; each item as the scan wrote it: title, dimension, impact/effort, "why it matters", "explore first" questions, and its **id**. A rules block asks for small verifiable changes, one repo at a time on a branch, and a trailer per resolving commit. Deterministic. |
| **The trailer** — `Ascent-Resolves: <id>` (`FOLLOWUP_TRAILER`, `parseResolvedIds`) | A commit-message trailer naming the follow-up(s) a commit resolves. The scan already reads recent commit messages (AI-attribution trailers), so this is a positive, deterministic signal that costs the agent one line. The engine collects the ids into `ScanReport.resolvedFollowUpIds`. |
| **The resolve rule** — `decideInProgress`, `isRestated` | On the next scan of the repo, an in-progress row is **done** when a trailer names it, or when the new assessment no longer restates it (title match, tiers 1–2 only); it **stays in progress** when restated without a trailer. |

### Why tier-3 matching is excluded for claimed rows

Carry-forward (`matchRecommendations`) pairs old and new roadmap items in three tiers; the third
pairs *the lone unmatched item in a dimension* on each side. That is right for open rows. It is
wrong for a row someone took on: since rubric r6 every below-green dimension always has *some*
item, so a fixed gap would be paired with whatever new gap the dimension produced next and "in
progress" would ride onto work nobody claimed. A claimed row is carried by its title or not at
all; if the scan does not say it again, the claim is honoured as resolved.

### Where resolution is written

`persistScanReport` (`src/lib/db/scans-persist.ts`): resolved in-progress rows are copied onto
the **new** scan as `done`, with a system `RecommendationEvent` (`fromValue in_progress →
toValue done`, note naming the mechanism and the commit). So the archive reads off each repo's
latest scan like every other rollup — no cross-scan query. The un-restated new item is a fresh
`open` row (never inherits the claim).

**Only default-branch scans persist.** A scoped scan (`ref`/`subPath`) is deliberately not
written as the repo's standing (see [scan.md](../scanning/scan.md)), so resolution happens when
the fix *lands* — the honest semantics: resolved = merged and rescanned. The prompt says so.

## The tab (`?tab=followups`, Standing)

`FollowupsTab` (server) makes **one** read — `getOrgBacklog(slug, segment, now, stack,
{ includeClosed: true })` — flattens it (`rowsFromBacklog`, pure) and hands the rows to the client
view. The resolved archive is the same rows filtered, never a second round-trip. Header:
`N open · M handed off · +P pts on the table` (projected points = engine-true gain if the gap
closes, from the backlog read).

Shared client model (`followupsModel.ts`, pure): sort by value (points desc, impact, effort),
filters (Repo · Dimension · Impact · Status · search; empty status = the working set open +
handed off), selection arithmetic (count · repos · +pts), the org-wide dimension spread.

**The view** (`FollowupsWorklist`): item-first — one ranked table of every follow-up in the fleet
(biggest projected gain first), tick across any repos, a sticky bulk bar totals the batch
(`N selected · R repos · +P pts`) and offers its three actions: **Generate fix prompt →**,
**Resolve N**, **Dismiss N** (counts on every button). A row expands in place for the rationale,
the explore questions, per-row resolve/dismiss/reopen, and its timeline. `?dim=Dn` deep-links seed
the Dimension filter (the Delivery ROI quadrant and Tech-stack playbook surfaces emit them).

### Ported from the retired tabs

| From | What | Why it fits 10–20 items per repo |
| --- | --- | --- |
| Backlog bulk bar | **Resolve N / Dismiss N** (`patchStatuses`: one PATCH per row, bounded concurrency, one refresh) | rows are not closed one at a time |
| Plan gap decomposition | **`org-wide N/M`** tag on the row + an **org-wide** filter chip (`dimensionSpread`: the dimension has an active follow-up in ≥ half the fleet's repos) | that is the batch-shape decision — fix once as a practice, not N tickets |
| Backlog row history | **timeline on expand** (`FollowupHistory`, `GET /api/recommendations/:id/events`) | the archive must say HOW a row closed (trailer vs no-longer-raised) or the loop isn't trusted |

The prompt modal `FollowupsPromptModal` (brand `Modal`, `reading` width): the prompt in a `<pre>`, **Copy
prompt**, and **Hand off** — `POST /api/org/followups/handoff { org, ids }` marks the *open* ids
`in_progress` with a timeline note ("Handed off: fix prompt generated from the Follow-ups
ledger"), then `router.refresh()`. Already-handed-off items are included in the prompt and not
re-marked; closed items are skipped and reported. Tenancy: `requireOrgAccess(org)`, every id must
belong to the org (whole-request 403 otherwise), public funnel refused, ≤ 50 ids per hand-off.

Row vocabulary (`FollowupChips.tsx`): impact/effort as one-letter chips (`IMPACT_CLASS` /
`EFFORT_CLASS`), status pill (`open` · `handed off` with the live-dot · `resolved` · `dismissed`),
`+pts`, and **resolve / dismiss / reopen** by hand via the per-item PATCH — the human half of the
feedback loop, for fixes a scan can't see.

## Key files

| File | Role |
| --- | --- |
| `src/lib/org/followups.ts` (+ `.test.ts`) | Trailer, resolve rule, prompt builder. |
| `src/lib/scoring/engine.ts` | Collects `resolvedFollowUpIds` from the commit sample. |
| `src/lib/db/scans-persist.ts` (+ `.test.ts`, "follow-up feedback") | Applies the rule at carry-forward; writes resolved rows + events. |
| `src/app/api/org/followups/handoff/route.ts` | The hand-off write. |
| `src/components/org/followups/` | `FollowupsTab` (server; renders `PersonalBacklog` for a personal workspace) · `FollowupsWorklist` · `FollowupsPromptModal` · `FollowupsFilterBar` · `FollowupChips` · `FollowupHistory` · `followupsModel.ts`. |
| `src/app/api/org/backlog/route.ts` | The ledger's read API (`getOrgBacklog`), kept from the retired tab for automation. |

## Known gaps

- **Only the trailer and title-disappearance close a row.** A fix that lands without a trailer and
  leaves the dimension's *wording* similar enough to restate keeps the row handed off until the
  user resolves it by hand. The prompt asks for the trailer for exactly this reason.
- **The prompt is Ascent's words, not the repo's.** It carries the scan's rationale and explore
  questions, not file paths or evidence excerpts; the agent is told to read the repo's own guidance
  first. Grounding it in the dimension's stored evidence is the obvious next step.
- **The ledger ignores `assigneeLogin` / `targetDate`.** The columns remain on `Recommendation`
  (the retired Backlog wrote them); nothing here reads or writes them. Drop them, or bring owners
  back, is a later decision.
