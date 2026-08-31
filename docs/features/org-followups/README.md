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

The header intro is **one line** — *"Every gap the scans left open, in one ledger."* (shortened
2026-08-19). It used to spell out the whole hand-off contract, `Ascent-Resolves: <id>` included, in
a paragraph every visit had to scroll past to reach the table. That contract now appears where it is
acted on: inside `FollowupsPromptModal`, on the prompt you are about to paste into an agent.

Shared client model (`followupsModel.ts`, pure, `followupsModel.test.ts`): sort by value (points
desc, then impact highest-first, then effort **cheapest**-first), filters (Repo · Dimension · Impact
· Status · search; empty status = the working set open + handed off), selection arithmetic
(count · repos · +pts), the org-wide dimension spread, and `isSelectable` — the one rule for which
rows a batch may act on (the working set; a closed row is never batchable, from either the row
checkbox or select-all).

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

## The protocol: any agent can pull from this queue (moonshot #3)

The ledger stopped being a list you copy a prompt out of and became a **work queue**. A human still
hands a batch off from the browser; a machine — Claude Code, Copilot, Codex, Cursor, a CI job, the
local loop engine — claims from the same queue over the
[MCP work tools](../org-knowledge/skills.md#the-work-protocol-claim--brief--report) with a token
holding `mcp:read + followups:write + telemetry:write`, or through `npx ascent work`
(`scripts/ascent-work.mjs`). **Ascent runs none of the work.** It adjudicates.

```
claim_followups ──▶ get_fix_brief ──▶  your agent, your harness  ──▶ report_attempt
   (a lease)         (gap + the org's                                  (an account,
                      own perimeter)                                    not a verdict)
                                                                             │
                     next scan of the DEFAULT branch ◀──────────────────────┘
                     the only thing that writes `done`
```

### One claim path

`src/lib/db/followup-claims.ts` is the single compare-and-set every worker calls —
`updateMany({ where: { id, status: "open", OR: [{leaseUntil: null}, {leaseUntil: {lt: now}}] } })`,
`count === 1` won, `0` lost. There is no `FollowupClaim` side table on purpose: a second place to ask
"who holds this" is exactly the race the module exists to prevent, and it would need its own
retention rule and erase cascade. `runLane` claims through it too, so the local engine gets the same
refusal a remote agent gets — a lane whose batch is partly held works the rest and logs what it could
not take, instead of stealing rows and having two workers write into the same gap.

### The claim columns on `Recommendation`

| Column | Meaning |
| --- | --- |
| `claimActor` | Who holds it — `agent:<token name>`, `autopilot`, a login. |
| `claimExecutor` | *What* holds it: `local` \| `remote-agent` \| `human`. |
| `leaseUntil` | When the claim lapses. **`null` on an in-progress row means a human took it** — an unleased claim the sweep must never reclaim, and never read as "expired". |
| `needsHuman` | An agent tried and stopped deliberately. An **escalation flag, not a status**: the row stays `in_progress` and stays counted as open. A fifth status would have hidden it from every "what is open" figure in the product. |

`assigneeLogin` is deliberately not reused for any of this. It is the human planning layer — who is
*accountable*, over a sprint — and an agent holding a row for forty minutes is a different fact.
Collapsing the two would let a lease expiry silently un-assign a person.

Leases expire **lazily**: `sweepExpiredLeases` runs at the top of a claim, the same precedent
`markStaleRunsStopped` sets on `GET /api/org/loop`. No cron entry is needed, and a claim path that
required a scheduler to be correct would be wrong on any deployment whose scheduler was down.

### Who may claim

`claimability()` gates a **remote agent** on the repo's **effective** autonomy tier:
**T0 refused**, **no assessed tier refused** (unknown is not green), **T1/T2 allowed and flagged for
human review**, **T3 allowed**; a repo inside a declared no-AI zone is refused whatever its tier.
`local` and `human` executors are unaffected.

**The effective tier is the RECORDED decision, not the derived grade** (since 2026-08-31; UAT
`PRIYA-L2-C4`). `repoGate` in `work-tools.ts` reads `getRepoAdmission(org, repo)` beside the passport
facts and applies the admission compiler's own precedence: where a tier was *assessed*
(`derivedTier !== null`) the `grantedTier` wins, so an owner may raise T0 → T2 and the claim door
honours it; where nothing was assessed, a grant is a seed nobody measured and compiles nothing. Until
this landed the door read only the derived tier, so moonshot #8's *"recorded, **overridable** per-repo
decision"* was invisible to the one gate that acts on it — live, a correctly-scoped org token was
refused *"xkazm04/kp is at autonomy tier T0"* on a repo whose owner could have decided otherwise.

**The `mode` lowers, independently of the tier.** An admission recorded as `assisted-only` or
`blocked` refuses the claim outright — reason `admission-blocked`, with a sentence saying the tier is
not the obstacle — because "how much supervision has this repo earned" and "may an agent open work
here at all" are two questions. An **absent** decision refuses nothing: an org that has recorded
none is gated exactly as it was.

The gate is still one pure function over one input struct; the admission read is best-effort, so an
unreadable governance table falls back to the derived tier rather than reporting no queue.

### Nothing in the protocol closes a row

This is load-bearing, and the section below ("Only the trailer and title-disappearance close a row")
is what makes it true. `report_attempt` writes a `RecommendationEvent` and clears a lease:

| Verdict | Effect |
| --- | --- |
| `resolved` | Stays `in_progress`, lease cleared. The rescan owns it now. |
| `skipped` | Back to `open`, unclaimed. Whoever comes next may take it. |
| `needs_human` | Stays `in_progress`, `needsHuman = true`, lease cleared. |

`status: "done"` is reachable only from `decideInProgress` at carry-forward. An agent's "I fixed it"
is exactly as much of a claim as the trailer it also wrote — and every claim and attempt is audited
(`followup.claim`, `followup.attempt`) with the org resolved, so both show in the audit viewer.

## Key files

| File | Role |
| --- | --- |
| `src/lib/org/followups.ts` (+ `.test.ts`, `followups-lease.test.ts`) | Trailer, resolve rule, prompt builder, and the pure lease/`claimability` layer + `buildAgentBrief`. |
| `src/lib/db/followup-claims.ts` (+ `.test.ts`) | **The one claim path**: compare-and-set claim, release, lazy sweep, attempt. |
| `src/lib/mcp/work-tools.ts` (+ `handlers-write.test.ts`) | `claim_followups` / `get_fix_brief` / `report_attempt`. |
| `scripts/ascent-work.mjs` · `examples/ascent-work.action.yml` | The zero-dep client and a reference Action (outside `.github/`, so it never runs here). |
| `src/lib/scoring/engine.ts` | Collects `resolvedFollowUpIds` from the commit sample. |
| `src/lib/db/scans-persist.ts` (+ `.test.ts`, "follow-up feedback") | Applies the rule at carry-forward; writes resolved rows + events. |
| `src/app/api/org/followups/handoff/route.ts` | The hand-off write. |
| `src/components/org/followups/` | `FollowupsTab` (server; renders `PersonalBacklog` for a personal workspace) · `FollowupsWorklist` · `FollowupsPromptModal` · `FollowupsFilterBar` · `FollowupChips` · `FollowupHistory` · `followupsModel.ts`. |
| `src/app/api/org/backlog/route.ts` | The ledger's read API (`getOrgBacklog`), kept from the retired tab for automation. |

## The resolve rule, tightened (2026-08-26)

`decideInProgress` now takes the dimension's score on both scans (`movement`) and treats the
trailer as a **hint**. The full rule:

| Rescan says | Trailer | Score moved | Decision |
| --- | --- | --- | --- |
| still restates the gap | any | any | **keep** (`restated`, or `claimed-but-restated` with a note that the claim was made) |
| no longer restates it | any | **did not rise** | **keep** (`no-movement`, with the before → after in the note) |
| no longer restates it | yes | rose, or unknown | done (`trailer`) |
| no longer restates it | no | rose, or unknown | done (`not-restated`) |

Why: the autopilot's *agent* writes the trailer, so an unconditional close was self-certification;
and restatement is title-only while titles are not stable across scans, so a reworded gap used to
read as a resolved one. A kept row that matched nothing on the new scan is copied forward as
`in_progress` with a same-status event carrying the reason, so the ledger explains itself instead of
losing the row. `docs/features/org-planning/live.md` has the loop-side view.

### And the movement has to be ATTRIBUTABLE (2026-08-28)

"It moved" is not the same claim as "the repository changed", so when the caller can name the two
scans' engines (`decideInProgress`'s optional `engines` argument) the movement is run through the
same `attributeDelta` the cockpit ledger uses, and two further cases keep the row open:

| Movement | Decision |
| --- | --- |
| either end came from the deterministic **mock floor** (or a degraded engine) | **keep** (`mock-scan`) — the two scans are not on the same ruler, so no distance between them is evidence |
| a real pair, but the rise is inside `SCORE_NOISE_BAND` | **keep** (`within-noise`) — a re-run of the same measurement, which is exactly what the plain `after > before` test used to accept as repair |

Omitting `engines` keeps the pre-attribution rule: a caller with no provenance in hand (a legacy row,
a unit fixture) gets the strict-movement test above, never a verdict invented from absent data. Each
kept case writes its own `keepNote`, so the timeline says which bar the claim failed.

## Known gaps

- **Only the trailer and title-disappearance close a row.** A fix that lands without a trailer and
  leaves the dimension's *wording* similar enough to restate keeps the row handed off until the
  user resolves it by hand. The prompt asks for the trailer for exactly this reason.
- **The `openBatch` path a loop lane takes now carries more than the prompt.** `buildFixPrompt` is
  still Ascent's words, and the human paste prompt is byte-identical to what it always was — but it
  now branches on `commitPolicy: "lane"`, adding the **capability rule** (no shell, no network: an
  item needing either is `SKIPPED`, never an adjacent artefact called `RESOLVED`), and a local-mode
  lane appends the organization's own standard
  to it — active playbooks with their versions, the pattern mined from its own repositories,
  procedural Org Memory, matching registry skills, and the last scan's stored evidence and gaps for
  the batch's dimensions. See `docs/features/org-planning/live.md` → *The lane brief*. A cloud
  draft-PR dispatch still sends the prompt alone.
- **Nothing WRITES `assigneeLogin` / `targetDate` any more.** Both columns remain on
  `Recommendation` and the retired Backlog tab wrote them; no surface here sets either. `targetDate`
  is fully unread. `assigneeLogin` is not: the backlog read still carries it onto every row, the
  expanded row renders it (`owner <login>`, `FollowupsWorklist.tsx`), and the CSV export has an
  `owner` column — so on a fleet imported before the retirement those values are still on screen with
  nothing able to change them. Drop the columns, or bring owners back, is a later decision.
  *(Corrected 2026-08-28: this entry read "nothing here reads or writes them", which was true of
  `targetDate` and false of `assigneeLogin` — the kind of confidently-stated non-limitation
  `docs/DOC-DRIFT.md` singles out as worse than an absent doc.)*
