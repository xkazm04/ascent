# The App Readiness Passport — design document (v0.1.0)

> A small, **descriptive, tool-naming** JSON fingerprint you drop into every app so you can
> cross-compare a whole portfolio **on first sight**: what the app *is*, what it's *built on*, how
> ready it is for **full LLM-automated development**, and how ready it is for **production**.
>
> Companion files in this folder:
> - [`app-passport.schema.json`](./app-passport.schema.json) — the JSON Schema (validate any passport against it).
> - [`app-passport.example.json`](./app-passport.example.json) — Ascent's own filled passport, from real repo facts.

---

## 1. Why this exists, and why it's a *sibling* to what Ascent already ships

Ascent already defines a standard for "is this repo ready for coding agents": the vendor-neutral
[`.ai/manifest.yaml`](./docs/AI_MANIFEST_SPEC.md). Its single most important rule is **"capabilities,
not tools"** — it declares `test → "npm test"`, **never** `framework: vitest`. That's correct *for an
agent*: an agent needs to know an ability exists and how to invoke it; which tool is behind it is an
implementation detail that will churn.

But that rule makes the manifest **useless for portfolio comparison**, which is exactly what you asked
for. You can't answer "which of my 20 apps have no error tracking?" or "which still run on a database I
want to retire?" from a file that refuses to name tools. So the Passport is the **deliberate opposite**
of the manifest, and the two are designed to coexist:

| | `.ai/manifest.yaml` (exists) | `app-passport.json` (this design) |
|---|---|---|
| **Audience** | A coding **agent**, in-repo | A **human** comparing a portfolio |
| **Stance** | Prescriptive — *how to act & verify* | Descriptive — *what this is & how ready* |
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
are genuinely **different axes** — an app can be highly automatable but not production-ready (a
well-instrumented prototype) or production-grade but hostile to agents (a battle-tested service with no
docs, no `CLAUDE.md`, no fast local verify). Conflating them hides exactly the gap you want to see, so
the Passport keeps them separate, each with a **0–100 score** (sortable) and an **ordinal band**
(comparable).

### 2a. `automationReadiness` — ready for full LLM-automated development

Reuses Ascent's existing **L1–L5 ladder** so it plugs straight into the maturity model
([`docs/MATURITY_MODEL.md`](./docs/MATURITY_MODEL.md)):

| Level | Name | What it means for autonomy |
|---|---|---|
| **L1** | Manual | Ad-hoc AI use, no machine-readable guidance. Agent output is risky to merge. |
| **L2** | Assisted | AI tools adopted; basic guardrails (some tests, a linter, CI runs). |
| **L3** | Augmented | Shared agent guidance + solid guardrails. Agent code is *safe to merge*. |
| **L4** | Integrated | Agents in the loop (review/CI steps, auto-fix); strong docs & reliable CI compound autonomy. |
| **L5** | Autonomous | Agents propose, test, doc, and ship; humans supervise at the policy level. |

The level is driven by three observable things:
- **`artifacts`** — the agent-facing *inputs*: `agentInstructions` (CLAUDE.md/AGENTS.md/…), a
  `contextGraph` (none/partial/full), `memory`, an agent `manifest`, `evals`, reusable `skills`.
- **`selfVerify`** — which of `build`/`test`/`lint`/`typecheck` an agent can run **locally** to prove a
  change *before* a human looks. This is the single biggest determinant of safe autonomy — it's the
  difference between "the agent guesses" and "the agent knows it didn't break the build."
- **`aiInWorkflow`** — evidence AI is *actually used* (AI co-author trailers, agent-authored PRs), not
  merely configured.

### 2b. `productionReadiness` — ready to be trusted in production

A 0–100 score in five bands — `prototype` (0–24), `internal` (25–44), `beta` (45–64),
`production` (65–84), `hardened` (85–100) — backed by **five ordinal sub-scales**. Each sub-scale is a
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
> surprises live — these enums make it explicit, which is exactly your "CI level / test coverage level"
> ask, generalized.

---

## 3. The metadata block (`stack`) — your "Monitoring tool, Persistence, Language framework, integrations"

This is the part that names tools, on purpose, because it's what makes a first-sight comparison
possible. Every field you proposed maps directly:

| You asked for | Passport field | Shape |
|---|---|---|
| Language / framework | `stack.languages`, `stack.runtime`, `stack.frameworks` | named + versioned (`next@16`) |
| Persistence | `stack.persistence[]` | `{ kind, engine, orm, migrations, required }` |
| Monitoring tool | `stack.monitoring` | `{ errorTracking, logs, metrics, tracing, uptime }` — **`null` is meaningful** ("absent") |
| Type of integrations | `stack.integrations[]` | `{ name, kind, direction, auth }` where `kind` ∈ `llm/vcs/auth/payments/email/storage/queue/analytics/…` |
| (added) Hosting | `stack.hosting` | named (`vercel`, `aws-ecs`, `self-hosted`) |
| (added) Secrets origin | `stack.secretsFrom` | the vault/keyring, never the secrets |

Two deliberate modelling choices:
1. **The comparable axis on an integration is `kind`, not `name`.** "How many apps have a `payments`
   integration?" sorts cleanly; the vendor (`Polar`, `Stripe`) is the detail you read after sorting.
2. **`null`/empty is a first-class answer.** `monitoring.errorTracking: null` and `persistence: []`
   (stateless) are *facts you want to compare*, not missing data. Don't omit them.

---

## 4. Identity & provenance — the rest of "basic information"

- **`identity`** — `name`, `slug` (your portfolio sort key), `purpose` (one line), `repo`, `owner`,
  `archetype` (solo/team/org — the same lens Ascent uses to weight scores), `lifecycle`
  (prototype→ga→maintenance), `visibility`, `license` (an SPDX id, or `"none"` which is a *legal*
  blocker), and `criticality` (experimental→mission-critical, which tells a reader **how hard to judge
  the scores** — a prototype at `beta` readiness is fine; a mission-critical app at `beta` is an alarm).
- **`evidence`** — `confidence` (0..1, how much could be inspected), `source` (`static-scan` /
  `manual-audit` / `ci-export`), and `files` (what it was synthesized from). Without this a reader can't
  tell a calibrated scan from a guess. Ascent's own report carries a `confidence` already; mirror it.

---

## 5. Design principles (inherited from the manifest spec, kept on purpose)

1. **Stable id, semver'd.** `passport: "app-passport"` is a constant, not a URL that can rot;
   `passportVersion` is semver. Minor/patch only *add* optional fields.
2. **Must-ignore-unknown.** A reader at `0.y` parses any `0.*` passport by ignoring fields it doesn't
   recognize. New integration kinds, new sub-scales, new metadata → **no schema migration, no broken
   readers**. (`additionalProperties: true` throughout enforces this.)
3. **Pointers, not embeds.** The heavy artifacts (the agent manifest, the context map, the full report)
   are referenced from `links`, never inlined. The passport stays one screen long.
4. **Snapshot, with provenance.** A passport is true *as of* `generatedAt`. `evidence.files` is the
   drift set — when those change, the passport is stale and should be regenerated.
5. **Ordinal-first.** Every comparable dimension is a short ordinal enum, not free text, so a portfolio
   table is `sort()`-able and a dashboard can render it without parsing prose.

---

## 6. How you actually use it across apps

1. **Drop one file per app.** Canonical home: `.ai/passport.json` (co-located with the agent standard)
   — or root `app-passport.json` if you prefer it visible. Validate against the schema in CI.
2. **Roll up the fleet** with a few lines — every comparable field is a plain enum or number:
   ```bash
   # "Which apps have no error tracking?"
   jq -r 'select(.stack.monitoring.errorTracking == null) | .identity.name' */app-passport.json

   # Portfolio table: name, automation level, prod band, CI level, test level
   jq -r '[.identity.name, .automationReadiness.level, .productionReadiness.band,
           .productionReadiness.ci.level, .productionReadiness.tests.level] | @tsv' */app-passport.json
   ```
3. **Spot the gap that matters: automatable but not production-ready (or vice-versa).** Sorting the two
   scores side by side is the whole payoff — it's the view neither the agent manifest nor a CI badge can
   give you.
4. **Regenerate, don't hand-maintain.** The fields are deliberately the same signals Ascent already
   extracts in a scan. The natural next step is to have the scanner **emit a passport** (see §8), so it
   stays honest instead of drifting.

---

## 7. Worked example — Ascent's own passport (the "final state" to evaluate)

The full object is in [`app-passport.example.json`](./app-passport.example.json), filled from the real
repo (CI workflow, committed Prisma migrations, `package.json`, `docs/PRODUCTION_READINESS.md`). The
headline:

- **Automation readiness: `L4` (Integrated), 76.** Has `CLAUDE.md`/`AGENTS.md`, a full `context-map.json`
  graph, reusable skills, and all four `selfVerify` capabilities are CI-gated. Capped below L5 by a
  telling **dogfood gap**: Ascent generates the `.ai/` standard *for other repos* but doesn't carry one
  itself (no in-repo `manifest`/`memory`), and nothing AI gates its own PRs.
- **Production readiness: `beta`, 64.** CI **gates** merges on lint+typecheck+test+build; tests are
  `substantial` with critical paths covered; migrations are `versioned` and committed; LICENSE present.
  Held at `beta` by **zero observability** (`observability.level: none` — no error tracking, no
  structured logs), no automated deploy/e2e in CI, and — ironically for a security-scoring tool — no
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

_Keep the spine thin: two scores, named metadata, pointers for the rest. The discipline that keeps the
agent manifest durable — stable id, semver, ignore-unknown, pointers-not-embeds — is the same discipline
that will keep this passport reusable across every app you point it at._
