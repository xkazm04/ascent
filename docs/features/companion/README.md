# Athena — the resident companion

_Status: **in build** (2026-08-25). This document covers WP2 (the persistence layer: the schema, the
identity store, the anchored-diff engine, the episode feed, the erase path) and WP3 (the turn, its
grounding, the block contract, the prompt and the HTTP routes). **The UI is a separate work package
and is not described here** - nothing below has a rendered surface yet._

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

## The turn is a function that returns events; the transport is an adapter

`runAthenaTurn(input): AsyncIterable<AthenaEvent>` (`src/lib/athena/turn.ts`) is one exchange.
Everything that decides what she says lives there. The SSE route renames those events into `event:`
frames and carries **no turn logic at all**.

```ts
type AthenaEvent =
  | { type: "phase"; phase: "recalling" | "grounding" | "thinking" }
  | { type: "recall"; chips: { insight: string }[] }
  | { type: "tool"; name: string }
  | { type: "settled"; turn: AthenaTurnRecord }
  | { type: "error"; message: string };
```

The union deliberately has **room for `{ type: "delta"; text: string }`**. Token streaming is not
implemented (`runToolLoop` resolves with a whole completion), but the client is written against this
union rather than against "wait for `settled`", so adding `delta` later touches the turn and the
renderer only - and a client that does not know the event still renders correctly from `settled`.
That is also why `settled` carries the FULL turn rather than "the rest of it".

Every dependency is **injected as a function** (`AthenaTurnDeps`): recall, identity, history,
grounding, the model loop, persistence, the episode write, and the clock. So a whole turn runs in
`src/lib/athena/turn.test.ts` with **no database, no network and no Next.js** - the fakes stand in for
the world, never for the logic under test. If a rule about how she answers were only reachable through
an HTTP request, that test could not exist.

Order of work in one turn: persist the question -> `recalling` -> `recall` (only when a chip survives)
-> `grounding` -> `thinking` -> the loop (emitting `tool` per call) -> parse blocks -> write the
episode -> persist the answer -> `settled`. **The episode is written before `settled` is yielded** on
purpose: a generator suspends at a yield, so a consumer that stops at the answer would leave the write
permanently unrun.

## Grounding: the MCP tools, in-process, behind a stricter gate

`src/lib/athena/grounding.ts` builds her tool list from `MCP_TOOLS` (`src/lib/mcp/tools.ts`) and
dispatches through `runTool` (`src/lib/mcp/handlers.ts`). One catalog, one set of handlers, one
serializer - an agent asking the MCP endpoint and Athena answering from the dashboard cannot disagree
about the fleet, because neither owns a copy.

**`runTool` performs no tenancy check.** Its own comment says scope enforcement happens in the route,
and `org` goes straight into `getOrgRollup(org)` / `getActiveOrgStance(org)` /
`candidateOrgMemories(org, ...)`. So the turn carries its own gate:

| Gate | When | On refusal |
| --- | --- | --- |
| `canReadOrg(org)` | before **any** tool runs, in `createAthenaGrounding` | returns `null`; the turn stops **before any model spend** |
| `workspaceAllowsMemory(org, plan)` | before `recall_org_memory` specifically | the tool is not offered, and a direct call is answered with the plan reason |

The memory plan gate is the one `POST /api/org/memory` enforces and **the MCP door does not** - an
`mcp:read` + `memory:read` token reaches an org's memory on any plan. **That is a separate finding
about the MCP route and it is not fixed here.** What is decided here is only that Athena is the
stricter of the two doors.

`toolResultText(r)` was **lifted out of the MCP route** into `handlers.ts` so both doors render a tool
result into text identically. That is the only change WP3 made to the MCP module.

### Memory is untrusted on every path it travels

Memory content is written by org members, harvested from scanned repositories, and written by their
agents. The recall route and the MCP tool both return it **raw** today; Athena is a new consumer and
does not inherit that hole. Both paths it can reach her by are wrapped with `neutralize` +
`wrapUntrusted` (`src/lib/llm/untrusted.ts`), under `MEMORY_UNTRUSTED_BOUNDARY` stated once in the
system prompt - the same posture as `src/lib/memory/consolidation.ts` and `reflection.ts`:

- **prefetched recall** - quoted inside the block in `buildAthenaPrompt`;
- **the `recall_org_memory` tool result** - wrapped before it is handed back to the loop.

Replayed history is neutralized but **not** wrapped: quoting the operator's own words inside an
untrusted block would tell the model to disregard the request it is answering. The `neutralize` is
still needed there, because her own prior reply may quote a memory body - that is the laundering path
back in.

### The recall strip: what is stored is never filtered, what is SHOWN is

`selectRecallChips` (pure) decides what appears above the answer. It drops **near-echoes** of the
current message (a memory that repeats the question back says nothing) and **fragments** (a first
sentence like "See the runbook." advertises recall and delivers a shrug), derives the `insight`
**mechanically** from the first sentence - no second model call - and shows **at most two**. When
nothing survives, **nothing is shown**. An empty strip beats echoing the operator's own question back
at them.

## The block contract

She may emit two structured shapes, fenced, inline. `parseAthenaBlocks` (`src/lib/athena/blocks.ts`)
lifts them out and returns the prose that is left.

`````````
```athena:table
{"title":"Fleet standing","columns":["Repository","Level","Overall"],"rows":[["acme/api","Practicing","62"]]}
```

```athena:chart
{"title":"Overall by month","chart":"line","labels":["Apr","May","Jun"],"series":[{"name":"Fleet average","values":[54,58,62]}]}
```
`````````

**The asymmetry is the whole design:**

- **Structurally wrong -> dropped WHOLE, and counted.** A chart whose series is shorter than its axis
  is not "a chart with a gap"; rendered, it asserts something the data never said. A half-drawn chart
  is a lie with a picture attached. Ragged table rows, non-numeric chart values, unparseable JSON and
  an unterminated fence are all drops. The count reaches the turn's `meta.droppedBlocks` - a block
  that vanishes silently is indistinguishable from one the model never emitted, and only one of those
  is worth fixing.
- **Merely too long -> truncated, and KEPT.** Eight rows of a ten-row answer is still the answer.

| Cap | Value | Constant |
| --- | --- | --- |
| Table columns | 4 | `ATHENA_TABLE_MAX_COLUMNS` |
| Table rows | 8 | `ATHENA_TABLE_MAX_ROWS` |
| Chart x-values | 8 | `ATHENA_CHART_MAX_POINTS` |
| Chart series | 2 | `ATHENA_CHART_MAX_SERIES` |
| Blocks per reply | 2 | `ATHENA_MAX_BLOCKS` |

The caps are **exported** so the renderer imports them: a renderer that lays out five columns against
a validator that permits four is a bug nobody sees until a model finally emits five.

Two more rules that are easy to get wrong:

- **The prose budget is applied AFTER the fences come out.** Cutting first slices a fence in half and
  turns one valid table into a dropped block *plus* a paragraph of raw JSON shown to the operator.
- **A completion that was only blocks gets a deterministic one-line lead-in.** A blank bubble above a
  table reads as a rendering bug, and the reader's first instinct is to distrust the table under it.

**Nothing in `blocks.ts` throws.** It sits between the model and the user, so an exception there does
not cost the block - it costs the prose too. The contract is fuzzed against deliberate garbage in
`blocks.test.ts` rather than asserted in a comment.

## The prompt

`buildAthenaPrompt` (`src/lib/athena/prompt.ts`) composes: **constitution -> self-model -> tone
contract -> block contract -> recall -> grounding mode -> the last `ATHENA_HISTORY_TURNS` turns -> the
message.** Identity and the contracts come first and stay byte-identical across turns, which is also
what keeps a provider's prompt cache warm.

The **tone contract is checkable rules, not adjectives** - "be concise and helpful" cannot be checked,
so a model drifts back to headings and sign-offs within a few turns and nothing notices. Each rule is
a property someone could grep a reply for: lead with the answer in one or two sentences; never restate
the question; no paragraph over three sentences; every number carries its unit or the noun it counts;
no headings; no sign-off; and **three or more comparable items always go in a block**, never a
sentence-list. That last rule is what pays for `blocks.ts`.

## Routes

| Route | Gate | Notes |
| --- | --- | --- |
| `GET /api/athena/threads?org=` | `requireOrgRead` | **One boot request**: the ledger PLUS the newest thread's turns, its open proposals, and the engine state. A second hop for what the first query already named is a wasted round trip. |
| `POST /api/athena/threads` | `requireOrgAccess` | Starts a conversation. **No opener, no LLM call** - see below. |
| `POST /api/athena/[id]/message` | `requireOrgAccess` | One exchange, **SSE** (`SSE_HEADERS` / `makeSseSend`). Frames are named after the event's own `type`, plus a final `done`. |

Every route runs the same preamble, in this order: `dbGuard` -> `org` present -> **`PUBLIC_ORG`
refused explicitly** -> the authz gate -> resolve the tenant id. The public funnel org would otherwise
sail through the read gate (anyone may read the public corpus) and open a conversation nobody owns.

**She does not speak first.** `POST /api/athena/threads` creates an empty, untitled thread and calls
no model: an opener would spend the org's tokens on a greeting nobody asked for, and at creation time
she has nothing to answer. The first spend happens when someone actually says something - which is
also when the thread gets its title, since titles are derived from the first user message.

### The trap in the SSE route

`next/headers` cookies are **not readable inside a `ReadableStream`'s `start()`** - `getViewer()`
there returns `null`. The viewer, the read decision and the plan are therefore resolved in **request
scope, above `new ReadableStream`**, and closed over (`resolveAthenaGates`,
`src/app/api/athena/gate.ts`). The precedent is `src/app/api/scan/stream/route.ts`.

Getting this wrong fails **quietly**: the stream still opens, she still answers, and every tool
refuses - so the operator gets a fluent, confident, completely ungrounded reply with no error
anywhere. The route test asserts the ordering literally, by timestamping `ReadableStream`
construction.

## Degrade modes

| Mode | What she does | What the payload says |
| --- | --- | --- |
| **No engine** (`resolveLegRunner` -> `null`) | Answers in ONE quiet line naming the fixable thing, and **writes no episode** | `meta.degraded = "no_engine"`, `meta.grounding = "none"`; the boot payload carries `degraded: true` |
| **BYOM unresolvable** | Refuses to fall back to the platform provider (fail-closed, from `resolveLegRunnerForOrg`) | `engine.reason` names the credential problem |
| **Provider without tool calling** | Answers from the prompt alone | `grounding: "prefetched"` on the turn and in the boot payload |
| **Loop budget exceeded** | Returns what it has, never a fabricated ending | `meta.truncated = true` |
| **Read gate refuses** | Nothing is answered and no model is called | an `error` event; the question is still recorded, no answer is invented |
| **No database** | The answer still reaches the operator | `turn.id === ""` and `meta.persisted = false` - there is no row, so nothing can address it later |

"She remembered nothing" and "she may not remember" are different facts about a deployment, and only
one of them is something an operator can fix - so the no-engine line says which of the two happened
rather than apologising vaguely.

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
- **No UI.** The routes and the turn exist; nothing renders them yet.
- **No token streaming.** The event union has room for `delta`, and `runToolLoop` does not surface
  partials, so every reply lands whole at `settled`.
- **She raises no proposals yet.** `AthenaProposal` is written and read by the store and returned by
  the boot payload, but nothing in the turn creates one - the completion is parsed for blocks, not for
  asks.
- **One episode per answered turn.** That is a lot of rows for a chatty thread. Consolidating at
  thread close (or gating on whether the turn was actually grounded) is the obvious next move, and is
  not done.
- **The MCP door still has no memory plan gate.** Athena carries one; `POST /api/mcp` does not. Fixing
  the MCP route is a separate change, deliberately not made here.
