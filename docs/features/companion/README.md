# Athena — the resident companion

_Status: **in build** (2026-08-25). This document covers WP2 (the persistence layer: the schema, the
identity store, the anchored-diff engine, the episode feed, the erase path), WP3 (the turn, its
grounding, the block contract, the prompt and the HTTP routes) and WP4 (**the surface** - see
[Where she lives](#where-she-lives-the-drawer-absorbed-her) below)._

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

<!-- athena-actions -->

## The action catalog

Athena cannot change anything. What she can do is **offer** — a card with an Accept and a Decline on
it — and nothing happens until a person clicks. Everything she may offer is declared in **one array**,
`ATHENA_ACTIONS` in [`src/lib/athena/actions.ts`](../../../src/lib/athena/actions.ts). Four things
derive from that array and none of them restates it:

| Derivation | Where | How it derives |
| --- | --- | --- |
| The teaching text shipped to the model | `ATHENA_ACTION_CONTRACT`, spliced into the prompt after the block contract | Generated from `athenaActionWire()` — every id, doc, parameter and closed value set is rendered from the array |
| The validator | `coerceAthenaAction()` | Its presence and shape checks read `spec.params`; there is no per-action branch in it |
| The executor binding | `ATHENA_ACTION_EXECUTORS` in `actions-execute.ts` | Typed `Record<AthenaActionId, …>`, so a missing or extra executor does not compile |
| This capability list | the table below | See **How this list stays true**, below |

**The failure this prevents is not a crash — it is asymmetry.** A kind the prompt teaches and the
validator rejects. A kind the validator accepts and no executor performs. A field the executor requires
and the prompt never mentions. Each half is individually correct, so nothing throws and nothing logs;
the model simply gets blamed for hallucinating a capability it was, in fact, taught.

`execute` is deliberately **not** a field on the spec. It is the one part of an action that needs the
database, and the catalog is imported by `turn.ts`, which is documented as having no database, no
network and no Next.js so a whole turn can run against fakes. The `Record<AthenaActionId, …>` binding is
also strictly stronger than a field would be: an optional `execute?` cannot detect an action nobody
performs, whereas the Record makes it un-compilable. A **set-equality test** pins the same fact at
runtime (`actions.test.ts`, "the wire catalog and the executors carry the EXACT same id set").

### What this build carries

Both actions dispatch machinery that already exists. **Neither reaches outside Ascent and neither
spends money** — that is the bar for being in the catalog at all.

| Action | Required role | What accepting it does |
| --- | --- | --- |
| `handoff_followups` | `member` | Claims follow-up items: `open → in_progress`, with a timeline note. Reuses the semantics of `POST /api/org/followups/handoff` — per-id tenancy re-check with a **whole-action refusal** on any foreign id (so ids cannot be enumerated), idempotent, and `done` / `dismissed` are never reopened. It records the claim and nothing else: the fix is a prompt a human runs, and the boundary ends at a string. |
| `rule_on_finding` | `member` | Records the team's ruling on one finding — accept, dismiss, or snooze until a date — carrying the rationale. Reuses `decide()` (`src/lib/db/org-decisions.ts`): a sparse upsert on `(orgId, module, itemKey)`, write-through to Shared Org Memory, already audited. Athena's own findings use the `athena` decision module, added the way `roadmap` was — **one constant, no second store**. |

### How this list stays true

The table above is **checked against the catalog, not maintained beside it.** The test
`actions.test.ts` → "the capability doc lists exactly the actions this build carries" locates the
companion doc by its `<!-- athena-actions -->` marker and asserts set equality between the ids in the
catalog and the ids the doc mentions. Adding an action without documenting it fails the suite; leaving a
retired action documented fails it too. The marker travels with the prose, so the check survives this
section being merged into another file.

## The proposal lifecycle

A proposal row (`AthenaProposal`) is raised by an assistant turn and answered by a human. Its outcome is
**merged into `payloadJson`** — there is deliberately no outcome column, because an outcome is
kind-shaped and a single column would be either a second JSON blob or a lowest-common-denominator string
that throws away the half a reader needs.

**Proposals are written in the same transaction as the turn that offered them.** A proposal whose turn
was never written is an Accept button under nothing; a turn pointing at rows that were never inserted is
a card painted empty. `appendAthenaTurn` writes the turn, the proposals and the turn's `meta.proposalIds`
in one transaction, or none of it. At most **two proposals per reply** — a panel that is mostly buttons
has stopped being a conversation.

Accepting is three guarded steps, because write-then-work leaves a failed accept marked done and
work-then-write runs a double-click twice:

| Step | Guard | What it buys |
| --- | --- | --- |
| **claim** | `status = 'open'` | Exactly one caller wins the compare-and-set; a second gets **409** and no executor runs |
| **run** | — | `execute` performs the action. A **refusal returns an outcome; it never throws** |
| **stamp** | `resolvedAt IS NULL` | Merges the outcome into `payloadJson` and closes the row for good |
| **release** (on a throw) | `status = 'accepted' AND resolvedAt IS NULL` | Can only ever undo a claim, never a resolution — the card goes back to open and the click can be retried |

A refusal (`ok: false`) is a **resolution**: the action ran, looked, and declined to act, and re-offering
it would only refuse again. A **throw** is not a resolution — that is something breaking, so the claim is
released and the operator gets a 500.

**A resolved proposal can never be re-opened, re-stamped or flipped by anything.** Status is read from
the live row rather than from the turn that produced it, which is what makes reopening a conversation
safe: an answered card paints an outcome, not a second Accept button.

## The one door

`POST /api/athena/proposals/[id]/resolve` with `{ org, decision: "accept" | "decline" }`. **Nothing
Athena says executes until a request arrives here.** There is no background worker, no auto-accept, no
"she was confident so we ran it".

And the door **re-validates from scratch**. Everything the proposal asserted is checked again, now:

- the proposal is still open (otherwise **409**);
- its payload still parses, and undeclared keys in it are dropped rather than handed to an executor;
- **its action still exists in the catalog**;
- its params still satisfy the declared shape;
- inside `execute`, the thing it names still exists **in this tenant**.

A proposal-time check is a *claim*; an execution-time check is the *guarantee*. Everything interesting
changes between the reply and the click: an item gets closed, a finding disappears, a snooze date passes,
an action is retired.

**A proposal whose action this build no longer carries is declined on the operator's behalf** with a
`retired` outcome — never left as an Accept button that can never succeed. A payload that no longer
satisfies the current spec is declined the same way, with an `invalid` outcome. An `identity_diff`
proposal is *refused* here rather than auto-declined: it is a different door with a different safety
argument, and declining another surface's offer on the operator's behalf would silently eat a real one.

Gating:

- The role comes from **`spec.requiredRole`**, enforced with `requireOrgRole`. There is no parallel
  gating list anywhere; adding an action declares its own gate.
- The preamble is the shared `gateAthenaOrg` — db guard → org → `PUBLIC_ORG` refused → `requireOrgAccess`
  → tenant id resolved. A proposal id alone never crosses a tenant boundary; `orgId` is ANDed into every
  read.
- The org's **own published AI stance** is consulted rather than duplicated. When
  `provenance.requireHumanApproval` is set, the accept must be attributable to a named human — this click
  *is* the human approval the stance means, and an anonymous one is not.

**Every accept writes an audit row** (`athena_proposal.accepted`, via `recordOrgAudit`), carrying the
proposal, the action, the outcome kind and the summary. Declines are audited too
(`athena_proposal.declined`). This is the bar the companion clears that autopilot does not: autopilot
audits nothing.

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

## Where she lives: the drawer absorbed her

**She has no launcher of her own.** Ascent runs exactly ONE right-edge guidance channel - the
onboarding drawer (`src/components/onboarding/tour/TourChecklist.tsx`, mounted by `OrgShell`) - and
Athena is a **posture** of it, reached by a `Setup | Athena` switch in its header. A floating bubble
beside the drawer would have made two surfaces answering the same question ("what now?"), which is the
same failure the repo already refuses for feedback: *"never a toast that scrolls away from the control
that caused it"* (`src/features/shared/registry/useRegistryMutation.ts:9`). `LiveWarRoomCelebrations`
already owns bottom-right on `?tab=live`; nothing new competes for a corner.

The drawer is a **complementary `<aside>`, not a dialog**: it traps no focus, blocks nothing behind
it, and stays `inert` while collapsed. It widens in her posture (a conversation needs more room than a
checklist) and a table inside scrolls in its own container rather than the page.

**A conversation survives a tab switch** because the drawer is mounted in the org **layout**, beside
`{children}` - `OrgTabChunks.tsx:52` keys on the tab and unmounts everything inside it. Her panel is
also **lazily mounted and then latched**: it boots on the first switch to her (a dashboard nobody asks
her about pays for no request), and afterwards switching back to the checklist HIDES it rather than
unmounting, so glancing at the checklist cannot throw a conversation away.

### `companion` is a posture name, and it is not her

`DrawerPosture` gained `"athena"` beside the existing `"companion"` and `"teaching"`. The existing
`companion` value means *the onboarding drawer opened itself* and predates her entirely; it is
load-bearing across four modules, so the absorb added a value rather than renaming one.

### She is the checklist's voice, never a second opinion

`buildGettingStartedModel` (`src/lib/org/getting-started.ts:79`) and `GETTING_STARTED_ANCHORS` are
**read, not rewritten**. Her resting line is `restingLine(next)`, handed the step the checklist itself
promoted (`nextTask`). Nothing in `src/features/shared/athena/**` re-derives doneness.

`restingLine(null)` deliberately **claims nothing about setup**: `next === null` has three
indistinguishable causes (the payload has not loaded, everything available is done, or this workspace
derives no steps), and a companion whose first line says "setup is complete" while the checklist is
still loading has lied before anyone spoke to her.

### One assistant turn, in reading order

**what she drew -> what she offered -> what she stood on.**

1. **Blocks render FULL-BLEED beneath the bubble**, escaping its width cap (`-mx-4` cancels the
   transcript's own padding). A paragraph needs a ragged edge and an identity gutter; a table is a
   drawing, and every pixel handed back to the gutter is a column it cannot show.
2. **Proposal cards** render from the boot payload's open proposals. This is the DISPLAY half only -
   see the gap below.
3. **At most TWO recall chips**, each a derived sentence and never a raw excerpt, rendered *after* the
   answer. When no chip survived, **nothing** renders: an empty strip beats echoing the operator's own
   question back at them.

### What the surface is built out of

| Concern | What it uses, and why |
| --- | --- |
| Panels / chrome | `Surface`, `Kicker` from `@/components/ui` - never a hand-rolled `border-slate-*` panel |
| The composer | `TextArea` from the `Field` kit. Enter sends, Shift+Enter newlines; the textarea is never disabled mid-turn (that would discard what was being typed while waiting) |
| `athena:table` | `OrgTable` (`src/components/org/shared/ui.tsx:76`) - a table she draws and a table the dashboard draws are the same object. `minWidth` is derived from the column count, not left at 640, so a two-column answer does not force a scrollbar in a 28rem drawer |
| `athena:chart` | Dependency-free inline SVG on `chartScale.ts` + `chartHover.tsx`. **No chart library** - recharts appears in exactly one landing file and must not spread |
| Prose | `MarkdownLite` (`src/components/report/MarkdownLite.tsx`) via an `AthenaProse` sibling that strips fenced regions first. Four inert constructs, no href, no src, no `dangerouslySetInnerHTML` - model output is untrusted, and that posture is repo law |

**The caps are IMPORTED from `blocks.ts`, never re-declared.** `model.ts` re-applies
`ATHENA_TABLE_MAX_*` / `ATHENA_CHART_MAX_*` / `ATHENA_MAX_BLOCKS` on the way OUT of `meta`, which
costs one `slice` and closes the last gap: a block written into the database before a cap existed.

Two chart decisions that look like styling and are not:

- **The domain is shifted, not clamped.** `linScale` clamps into `[0, domainMax]`, which is right for
  a 0..100 score and silently wrong for a series that dips below zero - every negative would flatten
  onto the baseline and assert something the data never said. Values are shifted by the minimum first.
- **Series colours are azure + slate, never the level ramp.** Red->green means L1->L5. Her series are
  arbitrary numbers, and painting a low one red invents a maturity claim out of an axis.

### Waiting is honest, and announcements are not per-beat

The phase strip is driven by the real `phase` / `tool` events - no fake progress, no invented stage.
After **8 seconds** a second line names the actual wait ("her whole reply arrives at once rather than
a word at a time"), because a spinner that has turned for ten seconds tells the operator nothing they
cannot already see.

The pulse exists **only while a turn is in flight** (never idle chrome that breathes) and is
`motion-safe:` gated exactly as `HighlightLayer.tsx:15` is - BRAND.md's "no always-on loops".

The phase strip is `aria-hidden`: those are beats. One polite `role="status"` region announces at the
level of **a decision is waiting** - once per settled turn, naming open proposals when there are any.
Three announcements per answer is how a helpful surface becomes one a screen-reader user turns off.

### Degrading in the panel

The boot payload's `degraded` flag renders **one quiet line that names where the switch is** - a
limitation with no stated remedy reads as a defect - linking to `?tab=settings`, where the org's model
provider is configured. The composer stays usable, and she still answers from what is stored.

A failed boot is not a dead panel either: the composer works and the first send makes its own thread.
A turn that produces no answer keeps the question on screen beside the reason, rather than silently
forgetting the operator said anything.

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

- `identity_diff` proposals have no accept path yet. The anchored-diff engine
  (`src/lib/athena/identity-diff.ts`) exists and `AthenaIdentity` has no writer for the self-model, so an
  identity diff can currently only be *declined*. The resolve route returns 409 on an accept rather than
  auto-declining, so nothing is lost when that door is built.
- The catalog carries two actions. Anything that spends money, reaches outside Ascent, or writes to a
  repository is deliberately absent and is a separate design question, not an omission.

- No export/import seam to kp's Athena (see above); the document shape is the only preparation.
- The wider `OrgMemory` erase gap described directly above.
- Retention (the daily purge) does not age Athena's threads at all — only erasure removes them.
- **A proposal can be READ but not answered.** The cards render the ask and say it is waiting; the
  accept/decline control and the API behind it (`src/app/api/athena/proposals/**`) are a separate work
  package. The card deliberately renders no dead button - a control that looks live and does nothing
  costs more trust than an absent one. (Moot today: nothing in the turn creates a proposal yet, below.)
- **The channel choice is not persisted across a hard reload.** `TourStorageState` is the obvious home
  for it, but `useTourEngine.dom.test.tsx:184`/`:202` assert the stored record deep-equals
  `{ open, index }`. A `?tab=` switch already preserves it, since the drawer lives in the layout.
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
