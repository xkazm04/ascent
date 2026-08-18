# Shared Org Memory

A per-org store of durable knowledge that members (and, via the scan pipeline,
Ascent itself) write, recall under a character budget, and correct over time
via supersede rather than edit-in-place. Reads are open to any org member;
writes are plan-gated.

## UI entry point

`src/app/org/[slug]/memory/page.tsx` (server component, `dynamic =
"force-dynamic"`). It resolves the viewer's login first (so private rows can
be scoped to their author), then in parallel loads the memory list, the
distinct namespaces in use, credit/plan state, membership/admin role, whether
the org is a personal workspace, and a coverage summary (`getMemoryCoverage`,
degrades to `null` on failure rather than breaking the page).

Above the memory list, `MemoryCoverageStrip` (`src/app/org/[slug]/memory/
MemoryCoverageStrip.tsx`) renders three tiles: "Memory coverage" (percentage
of the org's tracked repos with a fresh memory), "Repos with fresh memory"
(`fresh/total`), and "Going quiet" (count of repos with no recent memory),
plus up to 5 stale-repo chips. It only renders when the org has at least one
tracked repo. A repo counts as "fresh" if it has at least one active memory
whose `namespace` matches the repo's full name and whose `updatedAt` is within
30 days (`FRESH_WINDOW_DAYS`, `src/lib/memory/coverage.ts`). The denominator is
every tracked repo, not just repos that already have memory, so the strip
cannot show a flattering 100% just because nothing has been recorded yet.

Below the strip, `MemoryPanel` (`src/features/shared/memory/MemoryPanel.tsx`, client)
is the orchestrator: filter bar, list, and author form. Under it sit the two
lifecycle surfaces: **MemoryRecallPanel** (value-ranked recall, a read, any
member) and **MemoryReflectPanel** (propose/apply consolidation, gated as a
write).

## Memory kinds

Defined in `src/lib/org/memory-kinds.ts`:

| Kind | Meaning |
| --- | --- |
| `episodic` | What happened: an event, an incident, a decision made on a date. |
| `semantic` | A durable fact about the org, its systems, or its conventions. |
| `procedural` | What worked: a workflow, a tool sequence, a runbook step. |
| `summary` | A rollup that consolidates several other memories. |

The default kind is `semantic`; an unrecognized kind is coerced back to it.
`summary` is produced only by the reflect/apply flow (below); nothing else in
the codebase creates one, and a `summary` row can never itself become a
cluster member of a future reflection.

Each memory also carries:

- **Visibility**: `shared` (any org member can read it) or `private`
  (author-only; used for agent/personal scratch notes). Schema default is
  `shared`; the memory page passes `defaultVisibility="private"` for personal
  workspaces.
- **Confidence**: a 0–1 float. The author form offers three bands: High
  (1.0, "verified/decided"), Medium (0.6, "probable, unverified"), Low (0.3,
  "a hunch, needs checking").
- **Source**: free text provenance (e.g. "RFC-14, incident #92"), or the
  constant `"scan-pipeline"` for memories auto-fed by scans (rendered as an
  "auto · scan" badge in the UI).

## Primary user flows

### Browse and filter

`MemoryPanel` debounces (250ms) a server-side refetch of `GET
/api/org/memory` on search text, namespace, kind, or sort changes (sort:
"recent" / "confidence" / "recalls"). Rows render in a table; clicking a row
expands a `MemoryCard` beneath it (one expanded row at a time). `MemoryCard`
shows kind/namespace/confidence badges, a `private` badge if applicable, an
"auto · scan" badge for scan-pipeline rows, a `v{n}` version badge if the
memory has been edited/corrected more than once, author, source, recall
count, last-updated date, and an `expires` badge if the row has a TTL. Its
"Copy" button fires a background `POST /api/org/memory/:id/recall` to record
that the memory was used.

### Author a memory (check → save)

The author form (`MemoryPanel.AuthorForm.tsx`) is a two-step flow:

1. **Check for duplicates** (optional): `POST /api/org/memory/check` runs a
   write-intelligence pass (see below) and renders a verdict banner
   (`MemoryPanel.CheckVerdict.tsx`): `novel` (save as-is), `supersede`
   (something existing looks like an earlier/rougher version of this), or
   `duplicate` (already known). If the verdict is `supersede`, the top match
   is pre-selected as the supersede target; the UI never auto-arms supersede
   for a merely-related match. A "Keep both" option is always available.
2. **Save**: `POST /api/org/memory` with content, kind, namespace,
   visibility, confidence, source, tags, and (if chosen) `supersedeId`. Save
   is never blocked on the check step: a slow or unavailable model must not
   prevent a write.

If `supersedeId` is present, the write is a correction, not a plain insert:
in one transaction, the new row's `version` is set to `target.version + 1`,
and the target row (matched by `id` + `orgId`, requiring it isn't already
superseded) is stamped `supersededBy = <new id>`. If the target can't be
found in this org or was already superseded by a concurrent write, the whole
transaction is rejected and the route returns 400.

### Archive

An admin can archive a memory (soft-delete: `archived: true`, never a hard
delete) via `DELETE /api/org/memory/:id`. The UI removes it optimistically
and rolls back on failure.

## Write-intelligence: the check verdict

`src/lib/memory/consolidation.ts` backs `POST /api/org/memory/check`. It runs
in two layers, always attempted in order:

1. **Deterministic prefilter**: content is tokenized (lowercased, punctuation
   stripped, stopwords and single-character tokens dropped) and scored
   against up to 100 same-namespace candidates the viewer can see, using the
   **overlap coefficient** `|A∩B| / min(|A|,|B|)` (deliberately not Jaccard,
   so a short correction can score high against the long memory it corrects).
   Candidates below a floor are dropped; the top 6 form a shortlist. This
   shortlist is also the whole answer when no LLM is reachable: a heuristic
   verdict maps a top overlap ≥0.75 to `duplicate`, ≥0.35 to `supersede`,
   else `novel`.
2. **LLM judgment**: the shortlist is sent to whichever provider
   `LLM_PROVIDER` selects (see "Which model runs these passes" below), which
   returns a recommendation plus per-candidate `{ similarity, relation,
   reason }` (relation ∈ `duplicate | refines | contradicts | unrelated`).
   The parsed response is hardened against hallucination: any returned id not
   in the shortlist is dropped, similarity is clamped to 0–1 (falling back to
   the deterministic overlap score if missing), and a `supersede`/`duplicate`
   recommendation with zero surviving matches is downgraded to `novel`: the
   UI must never offer a Supersede action with nothing to supersede.

If the LLM path throws, returns non-JSON, or isn't configured, the route
falls back to the deterministic heuristic and reports `llmUnavailable: true`;
it never turns into a 500 and never blocks the author.

## Which model runs these passes

Both memory passes (the check verdict and reflect) go through
`resolveMemoryRunner` (`src/lib/memory/consolidation-engine.ts`) →
`resolveTextRunner` (`src/lib/llm/text.ts`), a "prompt in → model text out"
seam over the **same** provider selection the scan pipeline uses
(`resolveProviderChoice()` + `providerAvailable()`), so "which provider, and
is it usable here?" has exactly one answer in the codebase.

- An explicit `LLM_PROVIDER` wins. If that provider's prerequisite is absent,
  the runner is `null`, never a silent substitution of a provider the
  operator did not choose.
- `auto`/unset resolves to Gemini when a key is present, else `null`.
- `mock` and (on a production host) `claude-cli` resolve to `null`: there is
  no honest deterministic text for a judgment call.
- Per-call timeout is `MEMORY_CHECK_TIMEOUT_MS` (default 90s), far below the
  scan budget, because a human is waiting on a button.

`null` means **no engine**, and both passes report it: the check verdict falls
back to the deterministic heuristic (`llmUnavailable: true`, `engine:
"heuristic"`) and reflect proposes nothing (`llmUnavailable: true`, `engine:
"none"`). `engine` names the provider that actually answered.

Until 2026-07-29 the only wired engine was the local `claude` CLI, which is
local-dev-only by construction, so in **any** deployment reflect returned
zero proposals on every call and the `summary` kind was unreachable. Hosted
providers now serve both passes.

**Cost is bounded by construction, not by a quota**: nothing runs implicitly
on write. A propose is one explicit click that issues exactly ONE model call
covering at most `MAX_CLUSTERS` (4) clusters, each member excerpt capped at
800 chars, over a working set capped at 400 rows; applying is a second
explicit click that touches no model at all.

## The untrusted-content boundary on both memory prompts

Memory content is written by org members, harvested from scanned
repositories, and written by **agents**: an agent that read a poisoned
README and stored what it "learned" is the ordinary way an injection reaches
this store, with no human in that loop. Both memory prompts (the check
verdict and the reflect proposal) therefore quote every foreign-authored
fragment inside the shared untrusted-content boundary,
`src/lib/llm/untrusted.ts`, the same implementation the scoring prompt uses,
extracted rather than re-implemented, because a second copy of a security
control is the defect and not the fix.

Concretely, per prompt: a boundary statement written for the memory task
(instructions inside the block have no authority; an instruction found there
is text whose *meaning* is being judged), then the proposed content, the
candidate/cluster excerpts and the caller-supplied kind/namespace wrapped in
a single `<untrusted_repo_data>` block with forged boundary markers stripped
and triple-backtick runs defused. The task statement and the JSON output
contract stay outside the block.

What this protects is specific: a verdict or proposal **names memory ids**,
and a named id is superseded. Prompt-level hardening is the outer layer only:
the parse-time guards (an id must belong to the shortlist/cluster we asked
about, or the whole proposal is rejected) and the org-scoped database writes
remain the load-bearing ones.

## Reflect: consolidating memories into a summary

`POST /api/org/memory/reflect` supports two distinct call shapes on the same
route:

- **Propose** (`{ org, namespace?, decay?, dryRun? }`): a read-only pass.
  Candidate memories are clustered by pairwise **Jaccard similarity**
  (`|A∩B|/|A∪B|`, deliberately different from the check verdict's overlap
  coefficient because clustering wants two-way similarity, not
  correction-covers-original) via union-find at a similarity threshold of
  0.3. Only clusters of at least 3 members qualify: a pair of similar
  memories is better handled by supersede, not a rollup, since a summary that
  replaces only two rows usually loses more nuance than it saves. Up to 4
  clusters are sent to the model in one call; its proposed summaries are
  hardened the same way as the check verdict (a foreign member id rejects the
  whole proposal, fewer than 2 surviving members rejects it, blank summaries
  are rejected, and a proposal's confidence is capped at the highest
  confidence among its own members: a rollup may never be more certain than
  the most certain thing it consolidates). **If no LLM is reachable, reflect
  returns zero proposals rather than falling back to a heuristic rollup**
  (`llmUnavailable: true`); unlike the check verdict, there is no honest
  non-LLM way to synthesize a summary, and a deterministic concatenation
  would still supersede its sources. A caller must not read that as "nothing
  to consolidate"; see the outcome table below.
- **Apply** (`{ org, apply: { summaryContent, memberIds (≥2), confidence?,
  namespace? } }`): a second, explicit call that actually writes: in one
  transaction it creates a new `summary`-kind memory (`source: "reflection"`,
  tag `"auto-reflection"`, version = highest member version + 1) and stamps
  every named member `supersededBy = <new id>`. If the live member set
  doesn't match what was requested (race, wrong org, already superseded), the
  whole transaction is rejected and the route returns 400.

Passing `decay: true` to the propose call additionally runs the forget pass
(below) in the same request; `dryRun: true` reports what would be archived
without archiving it.

### Where a user triggers it

`/org/[slug]/memory` renders **MemoryReflectPanel** under the memory list.
"Propose consolidation" runs the read-only propose call; each returned
proposal renders its summary, the cluster's cohesion, the capped confidence,
and, expandable, the full list of memories it would supersede, with its own
"Apply rollup" button. Applying is therefore always a second, per-proposal
click, and never happens implicitly on write.

The panel is gated exactly as the route is (member + Team plan, or a personal
workspace); a read-only viewer sees the explanation and no button rather than
a control that 403s.

An empty result is never rendered as a blank list. The three outcomes get
three different sentences, because they ask three different things of the
reader:

| Response | What the panel says |
| --- | --- |
| `llmUnavailable: true` | No model engine is available, so nothing was proposed; configure `LLM_PROVIDER`. Nothing was changed. |
| `clusterCount: 0` | Nothing to consolidate: N memories compared, no family of three restated one subject. |
| `clusterCount > 0`, no proposals | N families found, none worth rolling up: the model read them and declined. |

## Recall: scoring and budget packing

`GET`/`POST /api/org/memory/recall` is the surface an agent or integration
uses to pull relevant memories into context. Any org member (session) can
call it, and, since 2026-08-14, so can a **machine caller holding an org
API token with the `memory:read` scope** (`Authorization: Bearer askl_…`,
the same `authorizeOrgApi` seam the Skills routes use; minted on the Skills
tab's API-tokens panel). A token principal carries no GitHub identity, so it
reads as an anonymous member: **shared memories only**, never anyone's
private scratch. The route fetches the org's active, visible memories
(namespace/kind filters allowed, unknown kind values silently dropped) and
scores each one:

```
score = confidence × 0.5^(ageDays / halfLife(kind)) × (1 + 0.25·ln(1 + accessCount))
```

- **Half-life by kind** (days until the decay term halves): `episodic` 30,
  `semantic` 180, `procedural` 365, `summary` 120; an unrecognized kind falls
  back to 180.
- **Access bonus** is sub-linear (natural log), so repeated recall raises a
  score but can't dominate it: the code's own estimate is roughly +60% at 10
  recalls and +115% at 100.
- Age is computed from `updatedAt` against an injected "now" (never read from
  the system clock inside the scoring function itself), clamped to zero so a
  future timestamp can't inflate a score.

Before scoring, rows are filtered to exclude archived, superseded
(`supersededBy != null`), and expired (`expiresAt` in the past) memories.
Scored memories are then packed into a character budget (default 6,000,
clamped between 200 and 60,000) greedily by descending score; an
oversized single memory is skipped rather than truncated, so smaller
lower-ranked memories can still fill the remaining budget. Only the memories
that end up selected have their `accessCount` incremented. A separate `POST
/api/org/memory/:id/recall` bumps a single row's `accessCount` directly (used
by the "Copy" button in `MemoryCard`).

### Response shape: the winners AND the losers

```
{ memories:   [{ ...row, score, ageDays }],   // packed, strongest first
  omitted:    [{ ...row, score, ageDays }],   // scored, ranked, budget-bound
  ineligible: [{ ...row, reason }],           // never recallable: superseded | expired | filtered
  usedChars, charBudget, consideredCount, omittedCount }
```

`omitted` and `ineligible` are the same fact split by which lever moves it: a
budget-bound memory is admitted by raising `charBudget`, while a superseded or
expired one never is, at any budget. Reporting only `omittedCount` (as this
route used to) tells a reader something was left out without telling them what
to do about it. Both lists are derived in the route adapter from the pure
core's own eligibility predicate; the scoring core is not involved.

### Where a user triggers it

`/org/[slug]/memory` renders **MemoryRecallPanel** below the memory list,
the surface that makes recall different from browse (the list above is sorted
by date; recall is sorted by value). It offers a character budget, an optional
namespace and an optional kind, then shows:

- the packed set with each row's server-computed `score` and `ageDays`
  (rendered verbatim, never recomputed client-side, so the number shown is
  the number that ranked the row) plus a budget-fill bar;
- **"ranked but left out: budget"**, the same rows rendered the same way,
  muted, with the note that packing is whole-item and greedy;
- **"not recallable"**, with the reason per row.

Reads are ungated (any org member), matching the route. Because it calls the
real route, packed memories have their `accessCount` incremented; the panel
says so, since it is a genuine recall and not a preview.

## Decay (forgetting)

`src/lib/memory/decay.ts` reuses the same scoring function as recall. A
memory is archived only if **all four** hold:

1. score < 0.15
2. age > 60 days
3. confidence ≤ 0.3 (the "low" band only)
4. kind is not `procedural` (procedural memories are never auto-forgotten)

Because the access-count term is part of the same score, a low-confidence
memory that is still recalled often can stay above the floor: usage acts as
a veto on forgetting. Each pass is capped at 50 archived rows. Decay is not
its own route; it only runs as part of `POST /api/org/memory/reflect` when
`decay: true` is passed. I did not find a scheduled/cron trigger for it in
the files read; whether it also runs unattended on a schedule, versus only
when explicitly requested, is not established from the code examined.

## Scan feed: how scan results become memories

`src/lib/memory/scan-feed.ts` auto-writes `episodic`, `shared`,
`source: "scan-pipeline"`, `confidence: 1.0` memories from the scan pipeline,
namespaced to the repo's full name:

- **Regression**: when a scan's regression check flags a drop, a memory
  records the overall-score move and severity.
- **Level change**: when a fresh scan's overall score crosses a maturity
  band (L1–L5) relative to the previous scan, a memory records the promotion
  or demotion. Both directions are recorded, not just demotions.
- **Recommendation closed**: when a recommendation's status becomes `done`
  (not `dismissed`, which means "decided not to do this" rather than "the gap
  closed"), a memory records the closure.

All three funnel through one write path that checks the last 25 same-
namespace scan-pipeline memories for an exact content match or a ≥0.95
overlap score, and silently skips the write if a near-duplicate is found:
these are machine-templated lines where a genuine repeat is near-identical
but a different event (different scores) should still get recorded. Every
writer wraps its database call in try/catch and returns `null` on failure
without throwing: a memory write is treated as decoration on a scan that
already succeeded, never something that can break it.

## API surface

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/org/memory` | `POST` | Create a memory (optionally as a supersede). |
| `/api/org/memory` | `GET` | List/filter/sort memories (`namespace`, `kind`, `search`, `sort`). |
| `/api/org/memory/check` | `POST` | Write-intelligence pass: duplicate/supersede/novel verdict. |
| `/api/org/memory/recall` | `GET`/`POST` | Score + budget-pack memories for agent context. |
| `/api/org/memory/reflect` | `POST` | Propose consolidation clusters, or apply an approved one. |
| `/api/org/memory/[id]` | `GET` | Fetch one memory (404s if the viewer can't see a private row). |
| `/api/org/memory/[id]` | `PATCH` | Edit a memory (member, Team+); bumps `version`. |
| `/api/org/memory/[id]` | `DELETE` | Archive a memory (admin-only, soft-delete). |
| `/api/org/memory/[id]/recall` | `POST` | Record a recall/use of a single memory. |

All routes resolve the memory's owning org from its id before authorizing, so
guessing an id from another org 404s rather than leaking existence via a
403.

## Data model

`OrgMemory` (`prisma/schema.prisma`):

| Field | Notes |
| --- | --- |
| `orgId` | Owning organization. |
| `namespace` | Optional grouping tag (e.g. a repo full name); `null` = org-wide. |
| `content` | Capped at 20,000 chars at the write layer. |
| `kind` | `episodic` \| `semantic` \| `procedural` \| `summary`; default `semantic`. |
| `visibility` | `shared` \| `private`; default `shared`. |
| `source` | Free-text provenance, or `"scan-pipeline"`. |
| `confidence` | Float 0–1, default 1.0. |
| `tags` | JSON string array stored as text (not `jsonb`), capped at 20 tags × 40 chars. |
| `supersededBy` | Bare id of the replacing memory, or `null`; not a modeled Prisma relation. |
| `version` | Starts at 1, incremented on edit or supersede. |
| `archived` | Soft-delete flag; never a hard delete. |
| `accessCount` | Denormalized recall/copy tally. |
| `expiresAt` | Optional TTL for ephemeral memory. |
| `createdBy` | GitHub login of the author, or `null` for scan-fed rows. |

Indexes: `[orgId, archived]`, `[orgId, namespace]`, `[orgId, kind]`.

## Tier gating

`planAllowsMemory(plan)` in `src/lib/plans.ts` returns `true` only for `team`
and `enterprise` plans; reads are not gated by it at all (any member can
read/recall/search).

The gate actually applied on every write route is `workspaceAllowsMemory`
(`src/lib/db/personal.ts`): `planAllowsMemory(plan) || isPersonalOrg(slug)`.
A personal workspace can write regardless of plan, but is capped at 100 live
(non-archived, non-superseded) memories; archived/superseded rows don't
count against the cap. A Team+ org has no such row cap. Attempting to write
without either condition returns `403` ("Shared Org Memory is a Team-plan
feature."); exceeding the personal cap returns `402`.

## Known gaps

- No scheduled/cron job invoking decay or reflection automatically was found
  in the files read; decay only runs as a side effect of an explicit
  `POST /api/org/memory/reflect { decay: true }` call.

## Registry-backed state (UC2, 2026-08-18)

This tab is a **consumer of the org's registry repo** (`docs/features/org-registry/README.md`). One
loader, `src/lib/org/registry-sync.ts`, answers "where does this content live?", and one component,
`src/features/shared/registry/RegistrySyncStrip.tsx`, says it identically here, on Skills and on
Practices — so the three tabs cannot drift in what they claim.

| Registry | What the tab shows |
| --- | --- |
| Not mapped | A pointer strip: "Nothing is backed by a registry yet — … lives only in ascent," linking to the Registry tab. It is a pointer, **not a gate**: hosted rows and the author form render below exactly as before, and nothing on screen names a repo that may not exist. |
| Mapped | The strip becomes the live status — the repo (linked), `indexed <relative time>` (or "mapped, not indexed yet" before the first pass), and the counts the last index pass read out of the repo. |

Per row, once a registry is mapped, an origin marker (`src/features/shared/registry/RegistryOriginTag.tsx`)
distinguishes the two worlds, and the affordances follow it:

- `origin: "hosted"` — ascent's own row; every in-app affordance (edit, archive) is unchanged.
- `origin: "registry"` — a mirror of a file in a repo the customer owns. In-app archive is **replaced**
  by **Open in registry** (a blob deep link built from `registryPath`, rendered only when the indexer
  actually recorded a path, so the link cannot 404 by construction). Editing here would be overwritten
  by the next index pass, so it is not offered.

Before a registry is mapped the marker is not rendered at all — every row is hosted, and "hosted" is
only news once the other world exists.

## Key files

| File | Role |
| --- | --- |
| `src/app/api/org/memory/route.ts` | Create + list. |
| `src/app/api/org/memory/check/route.ts` | Write-intelligence verdict. |
| `src/app/api/org/memory/recall/route.ts` | Scored, budget-packed recall. |
| `src/app/api/org/memory/reflect/route.ts` | Propose/apply consolidation. |
| `src/app/api/org/memory/[id]/route.ts` | Get/patch/archive one memory. |
| `src/app/api/org/memory/[id]/recall/route.ts` | Record a single recall. |
| `src/lib/memory/recall.ts` | Pure scoring + budget packing core. |
| `src/lib/memory/decay.ts` | Forget-pass eligibility + selection. |
| `src/lib/memory/consolidation.ts` | Check-verdict overlap scoring + LLM prompt/parse. |
| `src/lib/memory/reflection.ts` | Cluster detection + proposal hardening. |
| `src/lib/memory/scan-feed.ts` | Scan-pipeline memory writers. |
| `src/lib/memory/coverage.ts` | Per-repo memory freshness for the coverage strip. |
| `src/lib/db/org-memory.ts` | CRUD + supersede transaction, visibility scoping. |
| `src/lib/db/org-memory-lifecycle.ts` | `applyReflection`, `archiveOrgMemories`. |
| `src/lib/org/memory-kinds.ts` | Kind/visibility/confidence-band constants. |
| `src/features/shared/memory/MemoryPanel.tsx` | Client orchestrator. |
| `src/features/shared/memory/MemoryRecallPanel.tsx` | Value-ranked recall surface. |
| `src/features/shared/memory/MemoryRecallRows.tsx` | Packed / omitted / ineligible rows. |
| `src/features/shared/memory/memoryRecall.ts` | Client fetch helper + omission-reason copy. |
| `src/features/shared/memory/MemoryReflectPanel.tsx` | Reflect propose/apply surface. |
| `src/features/shared/memory/MemoryReflectProposal.tsx` | One proposal + what it would supersede. |
| `src/features/shared/memory/memoryReflect.ts` | Client fetch helpers + the three-outcome copy. |
| `src/lib/memory/consolidation-engine.ts` | Resolves the provider-backed prompt runner. |
| `src/lib/llm/text.ts` | Shared "prompt in → text out" seam over the provider selection. |
| `src/lib/llm/untrusted.ts` | The shared untrusted-content boundary. |
| `src/features/shared/memory/memoryCheck.ts` | Client fetch helper + copy for the check verdict. |
| `src/app/org/[slug]/memory/page.tsx` | Page composition. |
| `src/app/org/[slug]/memory/MemoryCoverageStrip.tsx` | Fleet-wide freshness strip. |
