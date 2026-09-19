# The App Readiness Passport: design document (v0.4.0)

> A small, **descriptive, tool-naming** JSON fingerprint you drop into every app so you can
> cross-compare a whole portfolio **on first sight**: what the app *is*, what it's *built on*, how
> ready it is for **full LLM-automated development**, and how ready it is for **production**.
>
> Companion files in this folder:
> - [`app-passport.schema.json`](./app-passport.schema.json): the JSON Schema (validate any passport against it).
> - [`app-passport.example.json`](./app-passport.example.json): Ascent's own filled passport, from real repo facts.

---

## 1. Why this exists, and why it's a *sibling* to what Ascent already ships

Ascent already defines a standard for "is this repo ready for coding agents": the vendor-neutral
[`.ai/manifest.yaml`](./docs/features/onboarding/ai-manifest-spec.md). Its single most important rule is **"capabilities,
not tools"**: it declares `test → "npm test"`, **never** `framework: vitest`. That's correct *for an
agent*: an agent needs to know an ability exists and how to invoke it; which tool is behind it is an
implementation detail that will churn.

But that rule makes the manifest **useless for portfolio comparison**, which is exactly what you asked
for. You can't answer "which of my 20 apps have no error tracking?" or "which still run on a database I
want to retire?" from a file that refuses to name tools. So the Passport is the **deliberate opposite**
of the manifest, and the two are designed to coexist:

| | `.ai/manifest.yaml` (exists) | `app-passport.json` (this design) |
|---|---|---|
| **Audience** | A coding **agent**, in-repo | A **human** comparing a portfolio |
| **Stance** | Prescriptive: *how to act & verify* | Descriptive: *what this is & how ready* |
| **Tools** | **Hidden** (capabilities, not tools) | **Named** (Next, Prisma, Sentry, Polar…) |
| **Scope** | One repo, deep | One row in a fleet table, shallow |
| **Lifespan of a value** | Stable (a capability endures) | Snapshot (a stack/score as-of a date) |
| **Question it answers** | "Can the agent build/test/lint here?" | "Which apps are production-ready? Which share a stack?" |

The Passport **points at** the manifest (`links.manifest`) rather than duplicating it. Keep the spine
thin; reference the deep stuff.

**One JSON object, two headline numbers, named metadata.** That's the whole idea.

---

## 2. The two readiness axes (your core ask)

You asked for "state of readiness for full automation" and "state of readiness for production." These
are genuinely **different axes**: an app can be highly automatable but not production-ready (a
well-instrumented prototype) or production-grade but hostile to agents (a battle-tested service with no
docs, no `CLAUDE.md`, no fast local verify). Conflating them hides exactly the gap you want to see, so
the Passport keeps them separate, each with a **0–100 score** (sortable) and an **ordinal band**
(comparable).

### 2a. `automationReadiness`: ready for full LLM-automated development

Reuses Ascent's existing **L1–L5 ladder** so it plugs straight into the maturity model
([`docs/features/scanning/maturity-model.md`](./docs/features/scanning/maturity-model.md)):

| Level | Name | What it means for autonomy |
|---|---|---|
| **L1** | Manual | Ad-hoc AI use, no machine-readable guidance. Agent output is risky to merge. |
| **L2** | Assisted | AI tools adopted; basic guardrails (some tests, a linter, CI runs). |
| **L3** | Augmented | Shared agent guidance + solid guardrails. Agent code is *safe to merge*. |
| **L4** | Integrated | Agents in the loop (review/CI steps, auto-fix); strong docs & reliable CI compound autonomy. |
| **L5** | Autonomous | Agents propose, test, doc, and ship; humans supervise at the policy level. |

The level is driven by three observable things:
- **`artifacts`**, the agent-facing *inputs*: `agentInstructions` (CLAUDE.md/AGENTS.md/…), a
  `contextGraph` (none/partial/full), **`memory` and `skills` as graded ladders** (§2c), an agent
  `manifest`, `evals`.
- **`selfVerify`**: which of `build`/`test`/`lint`/`typecheck` an agent can run **locally** to prove a
  change *before* a human looks. This is the single biggest determinant of safe autonomy: it's the
  difference between "the agent guesses" and "the agent knows it didn't break the build."
- **`aiInWorkflow`**: evidence AI is *actually used* (AI co-author trailers, agent-authored PRs), not
  merely configured.

### 2b. `productionReadiness`: ready to be trusted in production

A 0–100 score in five bands: `prototype` (0–24), `internal` (25–44), `beta` (45–64),
`production` (65–84), `hardened` (85–100), backed by **five ordinal sub-scales**. Each sub-scale is a
short enum so a fleet sorts trivially:

| Component | Scale (escalating) |
|---|---|
| **`ci.level`** | `none → build → checks → gated → delivery → progressive` |
| **`tests.level`** | `none → smoke → partial → substantial → comprehensive` (+ `coveragePct`, `frameworks`) |
| **`security.level`** | `none → policy → scanning → gated → supply-chain` |
| **`observability.level`** | `none → logs → errors → metrics → tracing` |
| **`delivery`** | `migrations: none/scripted/versioned`, `iac: bool`, `rollback: bool` |

> The key distinction baked into every scale is **"present" vs "enforced."** `checks` means CI runs the
> tests; `gated` means a failing test actually *blocks the merge*. `scanning` means a SAST tool exists;
> `gated` means it stops a release. That present-vs-enforced line is where most "looks ready, isn't"
> surprises live; these enums make it explicit, which is exactly your "CI level / test coverage level"
> ask, generalized.

---

### 2c. Graded artifact ladders (0.2.0): `memory` and `skills`

In 0.1.0 both were **booleans**, and `true` was nearly meaningless: a repo with one stale `NOTES.md`
under `.ai/memory/` scored the same as one running a superseded-fact memory library with a CI check.
A boolean also can't show *movement*: the thing a portfolio owner actually wants to see. So 0.2.0
replaces them with the same four-rung ordinal ladder used everywhere else in the passport:

| Rung | Means | `memory` criteria | `skills` criteria |
|---|---|---|---|
| **`none`** | Absent | No path under `.ai/memory[.md]` or `.claude/memory[.md]` | No path under `.claude/skills/` or `skills/` |
| **`adhoc`** | Present but unstructured | The home exists but isn't a library: a single flat memory file, or one lone entry | Skills exist but aren't a library: loose files, or a single named skill |
| **`curated`** | Structured / maintained | **≥2** per-fact entry files under the memory dir, **or** an index (`index/memory/readme.*`) plus ≥1 entry | **≥2** distinct skills that each carry their own definition file (`<name>/SKILL.md`) |
| **`governed`** | Curated **+ process** | Curated **and** one of: a supersede lineage link (`supersedes:` / `superseded-by:` / `replaces:`) inside a fetched entry, a `schema`/`policy`/`conventions` file in the memory tree, or a CI job that references `.ai/memory` \| `.claude/memory` | Curated **and** one of: a registry/index at the skills root, a CI job that references the skills tree, or a package script that lints/validates skills |

Two honesty rules, inherited from the **present-vs-enforced** cap that already governs `ci`/`security`:

1. **Only fetched content can prove `governed`.** A snapshot that *lists* a memory tree but whose files
   weren't fetched within the byte budget caps at `curated`. We never claim a rung the evidence can't
   support.
2. **When two rungs are arguable, score the lower one.** The ladder is a floor, not a guess.

A `none` on either rung now emits an automation `blocker`, which is exactly the kind of gap an owner may
legitimately **decline by choice** (§2d).

### 2d. Declined by choice (0.2.0): the passport as decision memory

A blocker an owner has read and deliberately accepted is *not* the same as an unread finding, but 0.1.0
had no way to say so: every re-scan re-surfaced it, and the reader re-litigated it. 0.2.0 lets the owner
mark specific field paths as **declined by choice**, with an optional reason:

```jsonc
// PATCH /api/report/passport/overrides
{ "repo": "acme/web",
  "declined": { "stack.monitoring.errorTracking": { "reason": "Internal cron worker; failures page via the platform." } } }
```

The rules that make this decision *memory* rather than decoration:

- **It never moves a score.** Choosing to skip a gap is a decision, not a fix. `productionReadiness.score`
  is identical before and after. A fleet comparison stays honest.
- **It re-renders, it doesn't hide.** The matching `blockers` line is retired from the blocker list and
  re-emitted under top-level `declined[]` as `{ path, label, reason?, blocker? }`, annotated as a
  decision, with the original blocker text preserved for audit.
- **A re-scan cannot clear it.** Declines live in `Repository.passportOverridesJson`, keyed by field path,
  and are applied as a **read-time overlay**. A scan writes `passportJson` and never touches the overrides
  column, so the choice survives every regeneration, including one where the passport shape changed.
- **Only allow-listed paths.** `DECLINABLE_PATHS` (see `src/lib/analyze/passport-overlay.ts`) enumerates
  what an owner may decline: the monitoring vendors, the production sub-scales, `delivery.iac`/`rollback`,
  and the automation artifacts. Deliberately **not** declinable: the tokenless "enforcement not observable"
  caveat. That is a limitation of the *evidence*, and letting an owner silence it would let a trade-off
  annotation launder a blind spot.
- **It joins on a minted id, never on the rendered sentence** (0.4.0 — see §2e).
- **It expires** (0.4.0 — see §2f).

### 2e. Findings: every blocker carries a minted id (0.4.0)

Through 0.3.0 the blocker lists were bare strings, and *everything that had to point at a blocker pointed
at its prose*: a decline matched the builder's sentence with a regex, and the fleet rollup grouped by exact
string with one hand-written normalization for the single blocker whose wording varies. That is a join key
a copy edit can change. Rewording one sentence silently detached every decline made against it — the
accepted gap reappeared as an open blocker, the owner's stated reason was orphaned, and nothing anywhere
noticed — and split one portfolio bucket into two, so the Pareto under-reported the org's most common
structural problem.

0.4.0 adds `automationReadiness.findings[]` / `productionReadiness.findings[]`:

```jsonc
{ "id": "prod.zero-observability",  // the CAUSE, axis-scoped. The join key. Stable across rewordings.
  "code": "zero-observability",     // the id without its axis - the fleet rollup bucket key
  "text": "Zero observability: no error tracking, structured logs, metrics, or tracing.",
  "severity": "block" }             // info | warn | block | critical (ordinal)
```

**`blockers[]` is unchanged** - it is now the rendered projection `findings.map(f => f.text)`, kept
verbatim so every pre-0.4.0 reader keeps working. The rule the two express together:

> **A persisted judgment attaches to a minted id; the rendered string is payload.**

`severity` is what makes 2f possible. `critical` is never emitted by a scan: it is what a `block` finding
*becomes* once the owner marks the repo business/mission-critical or GA (the P4 fields in section 4).

### 2f. A decline expires (0.4.0)

Before 0.4.0 a decline persisted by field path indefinitely and `at` was display-only. A team declines
"no dependency/secret/SAST scanning" while the repo is an internal prototype; the repo later starts
handling customer data and the decline still silently suppresses the blocker. The accepted risk was
accepted about a *different repo than the one that exists now*.

A decline is therefore re-surfaced - the blocker **stays in `blockers[]`** and the decision is rendered
with `needsReconfirm: true` plus a `reconfirmReason` - on exactly three triggers:

| Trigger | Test | Why this one |
|---|---|---|
| **Kind changed** | the stored `code` differs from the current finding's `code` | the same field path is now reporting a different gap |
| **Severity rose** | the current (escalated) severity outranks the stored one | the prototype -> GA / business-critical transition |
| **Aged out** | `at` is more than `DECLINE_MAX_AGE_DAYS` (**365**) before `generatedAt` | an accepted risk deserves one look a year |

And on **nothing else** - emphatically not on a rewording, and not on score jitter. That restraint is the
whole design: re-surfacing eagerly trains owners to re-decline reflexively, which destroys the signal
value of a decline entirely. Minted ids (2e) are what make "ignore rewordings" implementable at all.

Ageing is measured against the passport's own `generatedAt`, never a clock, so the overlay stays pure and
two readers of the same stored pair always agree.

A decline recorded *before* 0.4.0 carries no `code`/`severity` baseline. That absence reads as **unknown**:
those two comparisons are skipped rather than resolved to a fabricated "unchanged" (which would let a real
escalation ride) or a fabricated "changed" (which would re-open every decision in the fleet at once). The
age rule still applies, because `at` was always recorded.

### 2g. Named vs. capability, and per-field evidence (0.4.0)

Two more conflations - one in `stack`, one in `evidence` - fixed the same way: give each fact its own
encoding instead of overloading one slot.

**Three-valued named fields.** `stack.monitoring.*` and `stack.hosting` used `null` for two different
facts: "this app has no error tracking" and "the scan could not determine whether it has error tracking".
The difference lived in a whole-artifact `evidence.notes[]` caveat, which does not survive a portfolio
query - so a fleet statement like "43 repos have no error tracking" was built on a conflation, and a
coverage problem in *our* scan was reported as a real gap in the *customer's* stack. Since 0.4.0:

| Value | Means |
|---|---|
| a vendor name (`"sentry"`) | observed |
| `null` | the scan looked, and the app has none |
| `"unknown"` | the scan **could not look** - the evidence (a readable `package.json`, a tree index) was outside the snapshot |

It is an in-band string rather than an omitted key on purpose: the distinction has to survive the query,
and an omitted key does not. Every consumer that derives a rung from a named field goes through
`isNamed()` - a bare truthiness test reads `"unknown"` as a vendor and fabricates a level nothing
observed. When monitoring is unclassifiable the builder emits `prod.observability-unassessable` (severity
`info`, an evidence limitation) *instead of* `prod.zero-observability` (severity `block`, a real gap).

**Per-field evidence.** `evidence.confidence` is one 0..1 figure for the whole artifact, so a stack entry
inferred from a dependency declaration and one inferred from an observed command carried identical
apparent authority, and portfolio filtering on confidence filtered whole passports rather than weak
fields. 0.4.0 adds `evidence.fields`, keyed by the same dotted paths `declined[]` uses - one vocabulary,
not two - with **four fixed rungs**, because a scale whose meaning is not stated becomes decorative and
consumers threshold on it inconsistently:

| Basis | Confidence | Claims |
|---|---|---|
| `observed` | 1.0 | the artifact itself was read (file **content** fetched, command present) |
| `declared` | 0.8 | a dependency/config declaration names it; nothing shows it running |
| `inferred` | 0.5 | derived from a path/name heuristic over the tree index |
| `unobserved` | 0 | the evidence was not in the snapshot - the field reads `"unknown"` |

`fields` is **deliberately not exhaustive**: rating every field roughly doubles the artifact, which is the
stated cost of per-field confidence, so only the named/heuristic fields are rated. A reader filtering on
strength MUST prefer `fields[path]` and fall back to `evidence.confidence` only when the path is absent
(a pre-0.4.0 row, or a field the builder does not rate).

---

## 3. The metadata block (`stack`): your "Monitoring tool, Persistence, Language framework, integrations"

This is the part that names tools, on purpose, because it's what makes a first-sight comparison
possible. Every field you proposed maps directly:

| You asked for | Passport field | Shape |
|---|---|---|
| Language / framework | `stack.languages`, `stack.runtime`, `stack.frameworks` | named + versioned (`next@16`) |
| Persistence | `stack.persistence[]` | `{ kind, engine, orm, migrations, required }` |
| Monitoring tool | `stack.monitoring` | `{ errorTracking, logs, metrics, tracing, uptime }`: **`null` is meaningful** ("absent") |
| Type of integrations | `stack.integrations[]` | `{ name, kind, direction, auth }` where `kind` ∈ `llm/vcs/auth/payments/email/storage/queue/analytics/…` |
| (added) Hosting | `stack.hosting` | named (`vercel`, `aws-ecs`, `self-hosted`) |
| (added) Secrets origin | `stack.secretsFrom` | the vault/keyring, never the secrets |

Two deliberate modelling choices:
1. **The comparable axis on an integration is `kind`, not `name`.** "How many apps have a `payments`
   integration?" sorts cleanly; the vendor (`Polar`, `Stripe`) is the detail you read after sorting.
2. **`null`/empty is a first-class answer.** `monitoring.errorTracking: null` and `persistence: []`
   (stateless) are *facts you want to compare*, not missing data. Don't omit them.

---

## 4. Identity & provenance: the rest of "basic information"

- **`identity`**: `name`, `slug` (your portfolio sort key), `purpose` (one line), `repo`, `owner`,
  `archetype` (solo/team/org, the same lens Ascent uses to weight scores), `lifecycle`
  (prototype→ga→maintenance), `visibility`, `license` (an SPDX id, or `"none"` which is a *legal*
  blocker), and `criticality` (experimental→mission-critical, which tells a reader **how hard to judge
  the scores**: a prototype at `beta` readiness is fine; a mission-critical app at `beta` is an alarm).
- **`evidence`**: `confidence` (0..1, how much could be inspected), `source` (`static-scan` /
  `manual-audit` / `ci-export`), and `files` (what it was synthesized from). Without this a reader can't
  tell a calibrated scan from a guess. Ascent's own report carries a `confidence` already; mirror it.

---

## 5. Design principles (inherited from the manifest spec, kept on purpose)

1. **Stable id, semver'd.** `passport: "app-passport"` is a constant, not a URL that can rot;
   `passportVersion` is semver. Minor/patch only *add* optional fields.
2. **Must-ignore-unknown.** A reader at `0.y` parses any `0.*` passport by ignoring fields it doesn't
   recognize. New integration kinds, new sub-scales, new metadata → **no schema migration, no broken
   readers**. (`additionalProperties: true` throughout enforces this.)
   **Corollary: migrate on READ, never backfill.** A passport is persisted at scan time and read back
   months later; there is no rewrite pass and no guaranteed re-scan. When a field's *type* changes (0.2.0's
   booleans → ladders), `upgradePassport()` lifts the stored object at every read path
   (`src/lib/analyze/passport-migrate.ts`, wired into `parsePassportJson`). A lifted object is **tagged**
   with `migratedFrom` and an `evidence.notes` caveat, because a migrated ordinal is a *floor implied by
   the old shape*, not a measurement: a reader must be able to tell the two apart.
3. **Pointers, not embeds.** The heavy artifacts (the agent manifest, the context map, the full report)
   are referenced from `links`, never inlined. The passport stays one screen long.
4. **Snapshot, with provenance.** A passport is true *as of* `generatedAt`. `evidence.files` is the
   drift set: when those change, the passport is stale and should be regenerated.
5. **Ordinal-first.** Every comparable dimension is a short ordinal enum, not free text, so a portfolio
   table is `sort()`-able and a dashboard can render it without parsing prose.
6. **No consumer branches on a vendor name.** The passport *names* tools (section 3) - that is the point
   of the metadata block - but **nothing downstream may make a decision because of the name**. Concretely:
   no rung criterion, no score, no band, no tier predicate may test for `"sentry"`, `"vercel"`,
   `"github-actions"` or any other product. Score on the **ordinal rung**; the vendor is read *after*, by
   a human. The moment one score pays out for a named tool, a repo scores differently for choosing a
   different tool that does the same job, and the artifact stops being portable across stacks - which is
   its entire premise. Through 0.3.0 this held only because `src/lib/analyze/passport-score.ts` happened
   to behave, and was stated nowhere, so the next contributor wanting a vendor-keyed criterion had nothing
   to be refused by. It is now stated here and enforced by `passport-score.test.ts`, which reads that
   module's source. The guard is scoped to the **scoring** module, not the repo: the detection layer in
   `passport.ts` legitimately must know vendor names - naming is its job, scoring on the name is not.
7. **Two facts never share one encoding.** Absent is not unclassified (2g); an unread finding is not an
   accepted one (2d); a rendered string is not an identity (2e). Every time this design has been wrong, it
   has been because one slot carried two meanings and the reader could not tell which one they had.

---

## 6. How you actually use it across apps

1. **Drop one file per app.** Canonical home: `.ai/passport.json` (co-located with the agent standard)
   , or root `app-passport.json` if you prefer it visible. Validate against the schema in CI.
2. **Roll up the fleet** with a few lines, since every comparable field is a plain enum or number:
   ```bash
   # "Which apps have no error tracking?"
   jq -r 'select(.stack.monitoring.errorTracking == null) | .identity.name' */app-passport.json

   # Portfolio table: name, automation level, prod band, CI level, test level
   jq -r '[.identity.name, .automationReadiness.level, .productionReadiness.band,
           .productionReadiness.ci.level, .productionReadiness.tests.level] | @tsv' */app-passport.json
   ```
3. **Spot the gap that matters: automatable but not production-ready (or vice-versa).** Sorting the two
   scores side by side is the whole payoff: it's the view neither the agent manifest nor a CI badge can
   give you.
4. **Regenerate, don't hand-maintain.** The fields are deliberately the same signals Ascent already
   extracts in a scan. The natural next step is to have the scanner **emit a passport** (see §8), so it
   stays honest instead of drifting.

---

## 7. Worked example: Ascent's own passport (the "final state" to evaluate)

The full object is in [`app-passport.example.json`](./app-passport.example.json), filled from the real
repo (CI workflow, committed Prisma migrations, `package.json`, `docs/archive/2026-audits/PRODUCTION_READINESS.md`). The
headline:

- **Automation readiness: `L4` (Integrated), 76.** Has `CLAUDE.md`/`AGENTS.md`, a full `context-map.json`
  graph, reusable skills, and all four `selfVerify` capabilities are CI-gated. Capped below L5 by a
  telling **dogfood gap**: Ascent generates the `.ai/` standard *for other repos* but doesn't carry one
  itself (no in-repo `manifest`/`memory`), and nothing AI gates its own PRs.
- **Production readiness: `beta`, 64.** CI **gates** merges on lint+typecheck+test+build; tests are
  `substantial` with critical paths covered; migrations are `versioned` and committed; LICENSE present.
  Held at `beta` by **zero observability** (`observability.level: none`, no error tracking, no
  structured logs), no automated deploy/e2e in CI, and (ironically for a security-scoring tool) no
  SAST/secret scanning in its *own* CI (`security.level: policy`).

That single example shows the design earning its keep: two honest, comparable scores, named metadata,
and the gaps surfaced as explicit `blockers` you can sort and act on.

---

## 8. Open decisions for you (where I made a call you may want to change)

1. **Filename & home.** I chose `app-passport.json` at root for visibility and `.ai/passport.json` as
   the co-located canonical. Pick one as the standard. (Alt names considered: `readiness.json`,
   `app-fingerprint.json`.)
2. **Production band cutoffs.** I aligned the bands to the same 0/25/45/65/85 boundaries as the L1–L5
   ladder for consistency. If "production" should require observability outright (so no app with
   `observability: none` can exceed `beta`), that's a one-line rule I can add to a scoring helper.
3. **Score derivation.** Right now `score`/`level`/`band` are authored values. The robust version
   **derives** them from the sub-scales with a documented formula (the way Ascent blends signals), so two
   people scoring the same app agree. Say the word and I'll add `scripts/score-passport.mjs`.
4. **Auto-generation.** The biggest force-multiplier: teach Ascent's scanner to emit a passport
   alongside its report (it already computes ~90% of these signals). That turns "drop a file in each
   app" into "every scan produces one." Flag it and I'll scope it against `src/lib/scoring/`.

---

## 9. Version history

### 0.4.0: identity, and the end of two-facts-in-one-slot

| Change | Through 0.3.0 | 0.4.0 |
|---|---|---|
| Blocker identity | the rendered string was the join key | `findings[]` with a minted `id`/`code`/`severity`; `blockers[]` is its text projection (2e) |
| Decline lifetime | forever; `at` display-only | re-confirmed on kind change / severity rise / `DECLINE_MAX_AGE_DAYS` (2f) |
| Named stack fields | `null` meant absent **or** unclassifiable | three-valued: name / `null` / `"unknown"` (2g) |
| Detection strength | one whole-artifact `evidence.confidence` | plus `evidence.fields[path]` on four fixed rungs (2g) |
| Vendor-name branching | held by convention, stated nowhere | design principle 6, enforced by a source-reading test |
| New optional fields | - | `findings[]`, `evidence.fields`, `declined[].findingId`/`.at`/`.needsReconfirm`/`.reconfirmReason` |
| Schema `$id` | `app-passport-0.2.json` | `app-passport-0.4.json` |

**Why ids.** Everything the passport persists a *judgment* against - an owner's decline, a fleet rollup
bucket - was pointed at a sentence a copy edit could change. The fix is the general rule in 2e, not a
better regex.

**Why an expiry.** A decline is a decision about the repo as it was. Left permanent it keeps suppressing a
finding about the repo as it now is. The three triggers, and the deliberate refusal to add a fourth, are in
2f.

**Migration (automatic, no action needed).** `upgradePassport()` mints ids for a stored row's blockers by
matching each line back to the cause that produced it, and stops there. It does **not** rewrite named
`null`s to `"unknown"` (the stored value is ambiguous and rewriting it would erase every genuine "no error
tracking" finding in the fleet - the `null` floor is the honest read), and it does **not** synthesize
`evidence.fields` (that scan never rated a field; absent reads as unknown, and a reader falls back to the
whole-artifact confidence exactly as before). A legacy blocker line matching no known cause gets an id
marked `unclassified` and suffixed by position - **intentionally not durable**, because inventing a stable
identity for prose we cannot classify is the very defect ids exist to fix. Existing declines are keyed by
field path and are therefore not orphaned by any of this.

### 0.3.0: the autonomy tier

Structured `artifacts.sandbox` / `artifacts.hooks` booleans and a derived `autonomy` block (T0-T3 ladder
with per-tier unlock checklists), documented in `docs/features/scanning/scan.md`. Migration honesty rule
established here and reused by 0.4.0: a detector that postdates a stored row leaves its field **absent**
(unknown) rather than writing a fabricated `false`.

### 0.2.0: from display artifact to **decision memory**

Two patterns proven in the sibling **Personas** project, brought over intact.

| Change | 0.1.0 | 0.2.0 |
|---|---|---|
| `automationReadiness.artifacts.memory` | `boolean` | ordinal `none \| adhoc \| curated \| governed` (§2c) |
| `automationReadiness.artifacts.skills` | `boolean` | ordinal `none \| adhoc \| curated \| governed` (§2c) |
| Owner "I've accepted this gap" | *nothing*: every re-scan re-surfaced it | top-level `declined[]`, keyed by field path in the overrides store (§2d) |
| Stored-passport reads | parsed as-is | lifted by `upgradePassport()` at every read path, tagged `migratedFrom` |
| New optional fields | — | `migratedFrom`, `declined[]`, `evidence.notes[]` |
| Schema `$id` | `app-passport-0.1.json` | `app-passport-0.2.json` |

**Why the ladders.** A boolean answered "does a file exist?", which is not the question. It couldn't
distinguish a stray note from a governed memory library, and (worse for a portfolio) it couldn't show
*movement*: a team investing all quarter in their agent memory saw the same `true` on day 1 and day 90.
The four-rung ladder is the vocabulary the rest of the passport already uses (`ci`, `tests`, `security`,
`observability`), so it sorts and charts with everything else.

**Why declines.** The passport's whole value is that a reader trusts its blockers. A blocker the owner has
consciously accepted poisons that trust: it trains the reader to skim. Declining moves it out of the
"unread findings" list and into an explicit, reasoned, *auditable* decision, **without touching the
score**, and (because it is stored beside the scan rather than inside it) it survives every re-scan.

**Migration (automatic, no action needed).** Stored 0.1.0 rows are lifted on read: `memory`/`skills`
`true → "adhoc"`, `false → "none"`. `adhoc` is the honest ceiling for a boolean `true`, which only ever
proved presence. Every lifted passport carries `migratedFrom: "0.1.0"` and an `evidence.notes` entry, so a
migrated `adhoc` is never mistaken for an assessed one. Re-scan to get a real grade.

### 0.1.0: initial

Two readiness axes (`automationReadiness` L1–L5, `productionReadiness` band/score), the tool-naming
`stack` block, `identity`/`links`/`evidence`, and the derived production score. Owner overrides (P4) for
the three facts a scan can't observe: `criticality`, `lifecycle`, `rollback`.

---

_Keep the spine thin: two scores, named metadata, pointers for the rest. The discipline that keeps the
agent manifest durable (stable id, semver, ignore-unknown, pointers-not-embeds) is the same discipline
that will keep this passport reusable across every app you point it at._
