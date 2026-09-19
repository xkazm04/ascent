# ADR 2026-09-07 — One import convention for `src/lib/db`

**Status:** Accepted
**Deciders:** architecture review
**Supersedes:** nothing. **Superseded by:** nothing.
**Constrains:** every import of a persistence function or row type in `src/`.

---

## Context

`src/lib/db/` holds **122 non-test modules** (221 files including co-located
tests). Two import conventions coexist with no rule choosing between them:

| Convention | Files | Value import lines | Type-only import lines |
| --- | ---: | ---: | ---: |
| Root barrel — `@/lib/db` | 399 | 272 | 105 |
| Deep path — `@/lib/db/<module>` | 480 | 580 | 194 |

Neither is a minority practice, so neither can be called the deviation. That is
the actual problem: **the same symbol is reachable by several paths, and nothing
says which one is right.**

### The barrel is not a partition — it is a second, overlapping one

`src/lib/db/index.ts` is 439 lines and 69 export blocks, aggregating **65** of the
122 modules (not all of them — the other 57 are reachable only by deep path).
Eight of those blocks are `export *`, so the root barrel's public surface cannot
be enumerated by reading the root barrel.

Crucially, the root barrel does not sit *above* the domain barrels that already
exist — it reaches *around* them. `src/lib/db/org.ts` is a documented thin barrel
over 12 `org-*` sub-modules (`AGENTS.md` cites it and `scans.ts` as "the pattern").
`index.ts` re-exports `org.ts` wholesale via `export *` at line 172 **and
separately** re-exports from `org-rollup`, `org-foundation`, `org-memory`,
`org-nav-counts` and others that `org.ts` already owns or should.

The result, measured on one symbol:

> `getOrgRollup` is imported by **35 files by three different paths** —
> 28 via `@/lib/db`, 1 via `@/lib/db/org`, 6 via `@/lib/db/org-rollup`.

All three work. All three are current practice. A reader grepping for callers of
`getOrgRollup` by import path finds a third of them.

### The change-amplifier cost is real but is not the biggest one

Editing `index.ts` invalidates 399 importers for typecheck and bundling. That is
a build-time tax worth removing, but the durable cost is comprehension: "who reads
this table" requires three greps, and a reviewer who checks one path passes a
change that broke another.

### The `server-only` guard is already 55% leaked

`index.ts:4` imports `server-only`, so a client component that pulls a **value**
from `@/lib/db` fails the build naming that module. That guard is real and this
ADR does not reopen it.

But `index.ts` is the **only** module in `src/lib/db/` that imports `server-only`
— all 122 others carry nothing. The 480 files on deep paths are outside the guard
entirely. Today that is latent rather than broken: an audit of every client
component importing a deep db path found they are `import type` (erased, so
`server-only` would never fire anyway) except one deliberate value import,
`dbModeLabel` from the pure `@/lib/db/mode`. So the boundary holds by luck and
review, not by structure — and **freezing the root barrel without moving the guard
down would convert a 55% leak into a 100% one.**

### There is already a rule, and it says something narrower than it appears

`eslint.config.mjs` carries gate `[A4]`, attributed to the registry subject
`software-engineering/data-access/layering-rules`, whose comment states that
everything above the data layer "imports the `@/lib/db` barrel and speaks
repository functions."

Read literally that settles this ADR in favour of the root barrel. It does not,
for two reasons:

1. **What the rule enforces is one path, not the convention.** Its
   `no-restricted-imports` entry names exactly `@/lib/db/client`, with an 11-file
   grandfather list. It is a *layering* gate — don't reach the raw Prisma handle
   from above the layer — and it is silent on which entry point inside the layer a
   caller should use.
2. **The governing standard prescribes the opposite of a mega-barrel.** The
   `layering-rules` technique names this failure directly:

   > **The god-module trap**: one module accretes every operation for every table.
   > The stable middle: partition the layer by aggregate — the cluster of tables
   > that change together under one consistency boundary — with one module per
   > aggregate owning all statements that touch its tables. Cross-aggregate reads
   > (reporting joins) get a home of their own rather than a guest room in
   > whichever aggregate came first.

So the registry standard and the lint rule agree with each other and with this
ADR: the data layer must have **one door from above**, and that door should be
**per aggregate**, not one door for all 122 modules.

---

## Decision

**Per-domain barrels are the convention. The root `index.ts` is frozen.**

1. **A caller above the data layer imports from a domain barrel** —
   `@/lib/db/org`, `@/lib/db/scans`, `@/lib/db/loop`, … — and never from a module
   behind one. The domain barrel is that aggregate's whole public surface.

2. **`src/lib/db/index.ts` is frozen, not deleted.** No new export may be added to
   it. Its 272 existing value-import lines migrate opportunistically (see
   *Migration*), not in one commit. A frozen barrel that shrinks is a working
   convention; a deleted barrel is a 399-file change nobody will review honestly.

3. **`server-only` moves down to every domain barrel** as each is established.
   This is a precondition of the freeze, not a follow-up: the guard currently
   exists only on the module we are steering callers away from.

4. **Cross-aggregate reads get their own home,** per the standard — they are not
   guests in whichever aggregate came first. `org-rollup` is the live example: a
   reporting join over scans + repos + org, currently re-exported by *both*
   `org.ts` and `index.ts`, which is exactly the guest-room shape the standard
   warns about.

5. **Type-only imports follow the same rule.** `import type { OrgRollup } from
   "@/lib/db/org"` is correct; the deep path is not. `import type` is erased, so
   this costs a client component nothing and keeps one address per symbol.
   (It also means `server-only` never fires on a type import — which is why the
   rule has to be a convention and a lint, not just the guard.)

6. **`@/lib/db/client` stays data-layer-internal,** exactly as `[A4]` already
   enforces. Nothing here relaxes it, and the grandfather list stays a ratchet.

### The initial domain set

Anchored on the two barrels that already exist and on the module-name clusters
already present. This is the starting partition, not a final taxonomy — an
aggregate is "tables that change together", so the boundaries move when the schema
does.

| Domain barrel | Covers | Modules |
| --- | --- | ---: |
| `@/lib/db/org` | org identity, watchlist, scheduling, insights, teams, gates | 32 |
| `@/lib/db/org-registry` | registry mirror, conformance, dispatch, proposals, subjects | 9 |
| `@/lib/db/org-memory` | org + repo memory, citations, lifecycle | 4 |
| `@/lib/db/org-skills` | skills, skill lessons, traces, usage samples, history | 5 |
| `@/lib/db/scans` | scan persist/read/audit/recommendations, jobs, digest | 9 |
| `@/lib/db/loop` | loop runs, baselines, lessons, lanes, drives | 10 |
| `@/lib/db/athena` | companion threads, episodes, identity, proposals | 5 |
| `@/lib/db/personal` | personal workspace, backlog, passports, security | 4 |
| `@/lib/db/billing` | usage, usage events, showback, credits, quota, plan | 9 |
| `@/lib/db/tenancy` | tenants, members, invites, sessions, installations | 8 |
| `@/lib/db/audit` | audit health, integrity, webhook deliveries | 3 |
| `@/lib/db/practices` | practice adoption, playbooks, house patterns, improvement | 6 |
| `@/lib/db/reads` | **cross-aggregate reporting joins** — rollups, nav counts, standings, delivery trend | ~5 |
| `@/lib/db/client` | *data-layer-internal.* Runtime, PGlite boot, mode, wire-safe | 5 |

Exact per-module assignment is the first migration step, not part of this
decision — the counts above are approximate on purpose.

---

## Alternatives considered

**A. Root barrel only; delete the deep paths.** This is the literal reading of the
`[A4]` comment, and it has one genuine advantage: a single `server-only` import
guards everything. Rejected because it requires the god-module the governing
standard names as a trap, it makes the amplifier worse (all 879 importers, not
399), and the barrel is already unenumerable through its eight `export *` lines.
It also cannot serve client type imports without either dragging every client
through a server-only module or keeping a parallel types entry point — i.e. two
conventions again, wearing a different hat.

**B. Deep paths only; delete the barrel.** Honest — one module, one address, no
aggregation layer, and it is already the plurality practice at 480 files.
Rejected because it deletes the aggregate boundary entirely: every caller binds to
a file name, so splitting `org-insights.ts` in two becomes a caller-visible
change, which is the pressure that produced 122 modules in the first place. It
also has nowhere to put `server-only`.

**C. Leave it; document both.** Rejected. Documenting two addresses for one symbol
does not make the third grep unnecessary.

**D. Per-domain barrels, root frozen.** Chosen.

---

## Consequences

**Accepted costs.**

- A long-lived deprecation. 399 files import the root barrel and they will not all
  move soon. For the duration, three paths are readable and only one is writable —
  strictly better than today's "all three writable", but not clean.
- ~13 new barrel files, each a change-amplifier for its own domain. That is the
  point: the blast radius becomes the aggregate instead of the layer.
- Domain assignment is a judgement call, and some modules (`scan-quota` — scans or
  billing?) have a real claim on two. The tiebreaker is the standard's: which
  tables change together.

**What gets better.**

- One symbol, one address, so "who reads this table" is one grep.
- Editing `org.ts` typechecks against `org`'s importers, not 399 files.
- The `server-only` guard ends up on ~13 modules that callers actually import,
  instead of on one they are being steered away from.

**What must not silently rot.** This ADR is a convention until it is a gate, and a
convention in a 122-module directory decays. The enforcement work is listed below
as migration, but the specific hazard is worth naming: `AGENTS.md` records that a
source-scanning guard in this repo once stopped biting and reported a clean
codebase in a voice indistinguishable from success. Any lint added for this rule
must ship with a seeded violation proving it still fails.

---

## Migration

Not part of this decision; sequenced so each step is independently reviewable.

1. **Assign every one of the 122 modules to a domain** and record the table in
   this ADR's successor or in `docs/ARCHITECTURE.md`. Ambiguous cases get a
   one-line reason.
2. **Create the domain barrels**, each with `import "server-only"` and a header
   comment naming its aggregate. Pure client-safe leaves (`mode.ts`) are called
   out as deliberate exceptions.
3. **Freeze the root barrel in the lint**, not just in prose: extend `[A4]` so
   `@/lib/db` is restricted for new files, and correct its message — it currently
   tells the reader to do the thing this ADR deprecates.
4. **Migrate by domain, one commit per domain**, deep paths and root-barrel
   callers together.
5. **Delete `index.ts`** when its importer count reaches zero.

Steps 3–5 are the ones that convert this from a document into a property of the
build. Until step 3 lands, the decision is only as strong as review.
