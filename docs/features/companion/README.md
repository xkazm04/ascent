# Athena — the resident companion

_Status: **in build** (2026-08-25). This document covers WP2, the persistence layer: the schema, the
identity store, the anchored-diff engine, the episode feed, and the erase path. The conversation
runtime, the API routes and the UI are separate work packages and are not described here._

Athena is a resident chat companion who lives inside an Ascent organization. She is not a per-user
assistant and not a per-repo one: she is **org-scoped — one mind per organization**. Every member of
an org talks to the same Athena, she remembers the same things for all of them, and her identity is a
property of the org, enforced in the schema by `@@unique([orgId, tier])` on `AthenaIdentity`.

## The name is shared with kp's companion. The substrate is not.

The kp/registry companion is also called Athena, and this is deliberate: the registry's
`one-mind-many-mouths` doctrine says an operator should meet **one** companion across their tools
rather than a different assistant per product.

**Here that doctrine is honoured in name and not in fact, and the doc says so rather than glossing
it.** kp's Athena is a folder of markdown files on the operator's own machine. Ascent's Athena is
rows in Ascent's database, scoped to an organization that may have dozens of members. They share
vocabulary — constitution, self-model, episodes, proposals — and they share none of their storage.
Nothing written to one is visible to the other, and there is no sync, no export and no import today.

What the schema does preserve is the **possibility** of that seam later: `AthenaIdentity.content` is
kept **document-shaped** (markdown with stable `## ` sections), not a JSON blob of fields. A future
export can hand the document to another substrate unchanged, and the anchored-diff engine already
speaks the same anchored-edit language a file-backed companion would.

## The four tables (and the one that is deliberately absent)

All four are additive, org-scoped, and JSON-in-TEXT per the schema's no-`jsonb` DSQL contract
(`prisma/schema.prisma`, migration `20260825120000_add_athena`).

| Model | What it holds |
| --- | --- |
| `AthenaThread` | One conversation. `@@index([orgId, updatedAt])` serves the rail. |
| `AthenaTurn` | One message: `role`, `content`, `metaJson`, token counts, `legs`. |
| `AthenaProposal` | Something she asked for that a human has not answered. `open` \| `accepted` \| `declined`. |
| `AthenaIdentity` | Two tiers per org: `constitution` and `self_model`. |

**Episodes have no table.** What she remembers is written into the org's existing memory store as
`OrgMemory` rows with exactly `namespace: "athena"`, `kind: "episodic"`, `source: "athena"`,
`createdBy: null`, `visibility: "shared"` (`src/lib/db/athena-episodes.ts`). An episode is precisely
what that store already models; a second episodic store would fork "what do we know about this org"
into two answers. Those writes never throw — a memory failure must not fail the turn that produced it
(the same posture as `writeScanMemory`, `src/lib/memory/scan-feed.ts`).

Her **identity**, by contrast, could not live there, for three concrete reasons:

- `updateOrgMemory` (`src/lib/db/org-memory.ts`) patches any id it is handed — there is no write-ACL
  a constitution could hide behind.
- `normalizeMemoryKind` (`src/lib/org/memory-kinds.ts`) coerces an unknown `kind` to `"semantic"`, so
  a `"constitution"` kind would silently become an ordinary fact.
- `selectDecayed` (`src/lib/memory/decay.ts`) scores, ages and archives any row whose kind is not in
  `DECAY_EXEMPT_KINDS`. A constitution that can be forgotten is not a constitution.

### Titles are derived, never typed

`AthenaThread.title` comes from the first user message (`deriveThreadTitle`,
`src/lib/db/athena-threads.ts`) and there is **no setter**. A "name this conversation" box charges the
operator a chore before they have said anything, and the thing they were about to say *is* the title.

### Token counts are nullable, and `0` never means "unknown"

`inputTokens` / `outputTokens` / `legs` are nullable columns. A provider that reports no usage (a
local model, a degraded fallback) has told us **nothing**, and a `0` written there would be summed
and averaged downstream as if it had been measured. Unknown is not a value; `null` says so. A
*reported* zero is still written as `0` — that one is a measurement.

## Identity: how she is allowed to change

`AthenaIdentity` has two tiers.

**`constitution` — who she is and what she may never do. Write-locked to the agent BY
CONSTRUCTION.** `src/lib/db/athena-identity.ts` exports **no function that can update a constitution
row at all**. Not a guarded one — an absent one. The only mutating export is `updateSelfModel`, which
hardcodes `tier: "self_model"` into its own where-clause, so there is no parameter a caller could aim
elsewhere and no request body that could carry one. `seedAthenaIdentity` can *create* a constitution
(a row has to exist) but is create-only: handed an org that already has one, it returns the existing
row untouched.

The reason it is absence rather than a runtime check: a guard is a line of code, and a line of code
has a future in which someone reads `if (tier === "constitution") throw` as defensive noise around an
otherwise-general function and simplifies it away. There is nothing here to simplify. Making the
constitution editable requires writing a new function and being seen doing it.

**`self_model` — what she has learned about this org.** Mutable, but only through the anchored-diff
engine and only after a human accepts an `identity_diff` proposal.

### Anchored diffs (`src/lib/athena/identity-diff.ts`)

Pure and dependency-free (no Prisma import), so the engine that decides what an identity becomes is
unit-testable without a database. Three operations, and no fourth:

```ts
{ op: "append";  section: string; line: string }
{ op: "replace"; section: string; anchor: string; line: string }
{ op: "remove";  section: string; anchor: string }
```

The rules are registry doctrine `anchored-identity-diffs`, and none of them is negotiable:

1. **The anchor is exact CONTENT, never a line number.** The document changes on every accepted
   proposal, so a positional anchor is correct only until something above it moves — and then it is
   silently wrong, editing the wrong line with full confidence.
2. **A mismatch fails loudly** with `{ ok: false, reason }` and **there is no fallback to appending at
   the end.** That fallback is the failure that looks like success: the edit "lands", nobody is told
   it missed, and the document slowly fills with orphaned restatements of changes that were meant to
   *replace* something.
3. **An anchor matching more than once is `anchor-ambiguous`, not a coin flip.** So is a duplicated
   `## ` heading.

Only the named section is touched, and there is **no operation that rewrites the whole document**. A
sequence of diffs is all-or-nothing: the first refusal aborts and nothing is written.

## Proposals: nothing happens until a person says so

A proposal is the seam between "she said something" and "something happened". `kind` is an action id
or `"identity_diff"`; `status` starts `open`. `resolveAthenaProposal` is a compare-and-set on
`status: "open"`, so two accepts racing cannot run the action twice.

**The outcome is merged into `payloadJson`, and there is deliberately no `outcome` column.** An
outcome is kind-shaped — a run id for one action, an anchored-diff result for `identity_diff`, a
refusal reason for a diff that missed — so a dedicated column would be either a second JSON blob or a
lowest-common-denominator string that throws away the half a reader needs.

## Erasure

`eraseOrgAthena` (`src/lib/db/retention.ts`) removes everything of hers on an org-scoped erase:
**proposals → turns → threads → identity**, then the `OrgMemory` rows she wrote. Children before
parents, written by hand because `relationMode = "prisma"` emits no FK cascades. It is cursor-paged,
polls the wall-clock budget at the top of every page, and its `dryRun` counts over the **same
predicates the delete uses**, so the number an operator is shown before confirming is the number the
confirmed run removes. Five counters (`athenaThreadsDeleted`, `athenaTurnsDeleted`,
`athenaProposalsDeleted`, `athenaIdentityDeleted`, `athenaMemoriesDeleted`) appear on `EraseResult`,
in the dry-run return, in the real return, and in the `data.erased` audit meta.

A repo-scoped erase never reaches any of it — a thread is not a repo's row.

### The memory-sweep caveat, stated plainly

Before this, **`retention.ts` covered no `OrgMemory` row at all** (`grep -c orgMemory` returned 0):
neither the retention cron nor the on-demand erase touched the org's memory store. This is the first
memory sweep in the module, and it is **deliberately scoped to Athena's own writes** — the predicate
is `{ orgId, source: "athena" }`.

**Human-authored memories, the scan-pipeline feed (`source: "scan-pipeline"`) and registry-mirrored
notes are still not covered by any erase path.** That is a real, open gap. This function is not a fix
for it, and `athenaMemoriesDeleted` must not be read as "the org's memory was erased" — it counts
only the episodes Athena wrote.

## Known gaps

- No export/import seam to kp's Athena (see above); the document shape is the only preparation.
- The wider `OrgMemory` erase gap described directly above.
- Retention (the daily purge) does not age Athena's threads at all — only erasure removes them.
