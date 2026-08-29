# The AI-Native Repo Standard: `.ai/` (spec v0.3.0)

> A small, **vendor-neutral** standard for making a codebase *legible, verifiable, and
> self-maintaining* for coding agents. Ascent authors and versions it; any agent or tool can read
> it. It does not name or require a specific tool.

A conformant repo carries an `.ai/` directory:

```
.ai/
  SPEC.md              # this document, shipped with the foundation so it travels with the repo
  manifest.yaml        # the spine — the agent-facing contract (this spec)
  doctor.mjs           # executable conformance: validates the repo against this spec
  maintain.mjs         # upkeep: flag stale CONTEXT, append memory, reconcile freshness anchors
  memory/              # structured, append-only, agent-written memory (decisions, gotchas, dead-ends)
  context-index.json   # index of co-located CONTEXT.md docs (the module graph)
  guardrails.yaml      # machine-checkable invariants (never-commit patterns, never-touch paths)
```
plus co-located `CONTEXT.md` files inside source directories.

Everything above is **generated**, so a fresh install is already conformant. The standard never
points at a file it does not ship. Subsystems it cannot synthesize from a scan (an eval harness, for
one) are **optional pointers**: declare `paths.evals` when the repo has one and the doctor validates
it; leave it out and the doctor says nothing, because a warning about a subsystem the standard never
scaffolds is noise, not conformance.

## Why this won't outdate (design principles)

1. **Capabilities, not tools.** The manifest declares a capability *name* → the *command* that
   fulfils it (`test → "npm test"`), **never** `framework: vitest`. An agent needs to know a
   capability exists and how to invoke it; which tool is behind it is an implementation detail that
   will change. This is the single most important rule.
2. **Pointers, not embeds.** Heavy subsystems (memory, the context graph, evals, guardrails) are
   *referenced by path*. Their internal format can change with zero impact on this contract.
3. **Open + must-ignore-unknown.** `capabilities` is an open map, and **a reader MUST ignore fields
   it does not recognize**. New capability kinds (`fuzz`, `mutation`, `licenses`, …) need no schema
   migration and don't break old readers.
4. **Semver, additive within a major.** `schemaVersion` is semver. Minor/patch bumps only add
   optional fields. A breaking change bumps the major and is the only time a reader may need updating.
5. **Generated-from, drift-checkable.** `generatedFrom` records the repo files the manifest was
   synthesized from; the doctor flags the manifest as stale when those files change after
   `generatedAt`. The manifest is *regenerable*, not hand-canon.
6. **Vendor-neutral.** The home is `.ai/` (not a brand), the agent registry is `{id, kind,
   entrypoint}` for any agent, and `schema` is a stable id (`ai-manifest`) rather than a URL that can rot.
7. **Declared, then proven — and then read back.** The manifest *claims* (`verified: false`);
   `doctor.mjs` *proves* by running the commands. The truth of a capability is established in-repo,
   pre-push; the maturity check shifts left, out of the remote scanner and into the repo. The loop
   closes because the proof travels: a scan READS this file and scores the repo against the contract
   *the repo itself wrote*, not against a vendor's checklist. See "Read-back" below.

## `manifest.yaml` fields

| Field | Meaning |
|---|---|
| `schema` | Stable id, always `ai-manifest`. |
| `schemaVersion` | Semver of this spec. |
| `spec` | In-repo path to this document (`.ai/SPEC.md`, which ships with the foundation). |
| `generatedAt` / `generatedFrom` | Provenance for drift detection. |
| `repo` | `name`, `purpose`, `languages` (descriptive tags), `archetype`. |
| `capabilities` | Open map of `name → { command, verified }`. Tool-neutral. |
| `paths` | Pointers. `contextIndex`, `memory` and `guardrails` always ship; any other key (e.g. `evals`) is optional and validated only when declared. |
| `context.rule` | The structural rule the doctor enforces for CONTEXT coverage. |
| `boundaries` | `neverTouch` (don't hand-edit) + `secretsFrom` (the vault, not the secrets). |
| `agents` | Vendor-neutral registry: `{ id, kind, entrypoint }`. |
| `controls` | Shift-left placement: `prePush` (primary) vs `ciHardPass` (thin backstop). |

### Recommended capability vocabulary (open, extend at will)

`build`, `test`, `lint`, `typecheck`, `coverage`, `scan-secrets`, `scan-deps`, `sast`, `evals`,
`format`. These are *names*; the command behind each is the repo's choice. The doctor compares the
declared `capabilities` against `controls.prePush` + `controls.ciHardPass` and reports any control
that has no backing capability. That gap is what the onboarding tracks close.

## `guardrails.yaml`: the invariants half

The manifest says what the repo *can do*; `guardrails.yaml` says what an agent *must not do*. It is a
separate file (pointed at by `paths.guardrails`) so it can grow without touching the spine, and it is
deliberately small enough that the doctor can enforce part of it mechanically.

| Field | Meaning |
|---|---|
| `schema` / `schemaVersion` | Stable id `ai-guardrails`, semver. Unknown fields MUST be ignored. |
| `neverTouch` | Globs an agent must never hand-edit (generated, vendored, locked). Mirrors `boundaries.neverTouch`. |
| `secrets.neverCommit` | Globs that must never be tracked by git. **Doctor-enforced** (hard fail). |
| `secrets.from` | Where secrets legitimately come from (a vault/keyring name, never the secret). |
| `review.*` | Change discipline: human approval required, verify before proposing, attribute AI work. |

## Conformance: what `doctor.mjs` checks

`node .ai/doctor.mjs` (zero-dependency, reference implementation) reports, and exits non-zero on a
hard failure:

1. **Structure**: `manifest.yaml` exists and carries the required keys at a supported `schemaVersion`.
2. **Pointers resolve**: every path DECLARED under `paths` exists (a pointer that is not declared is
   not a finding). A `CONTEXT.md` that is still the shipped template (its `<placeholder>` markers
   intact) is reported as unfilled: existence alone is not context.
3. **Capabilities**: each declared command resolves; `--run` actually executes the fast ones and
   reports pass/fail (this is what flips `verified`).
4. **Control placement**: every `controls.prePush` capability is backed by a declared capability and
   wired into a local hook; every `controls.ciHardPass` has a CI workflow. Missing pre-push controls
   are the highest-severity findings (a control that only lives in CI is "too late").
5. **Freshness**: `generatedFrom` files unchanged since `generatedAt`; CONTEXT entries don't
   reference deleted paths; memory entries are well-formed.
6. **Guardrails**: the invariants in `guardrails.yaml` that a machine CAN check are checked: no file
   matching `secrets.neverCommit` may be tracked by git. A violation is a hard failure.
7. **Score**: prints a conformance percentage and the projected maturity delta, so the agent gets a
   tight local feedback loop instead of waiting for a remote scan.

Every check above has **four** possible outcomes, not three: `pass`, `warn`, `fail`, and
`unchecked` — the clause could not be judged in this environment (checks 5 and 6 both need git
history, which a shallow clone or a source tarball does not have). `unchecked` is a **result, not an
absence**: a conformant runner emits it as a finding rather than staying silent, because a run that
skipped a clause and a run that cleared it must not produce the same output.

### Score semantics (read before comparing scores)

The score is a **weighted pass ratio over the SCORABLE findings the run happened to emit**, not a
fixed rubric: `score = round(100 × Σ weight / scored)` with weights `pass = 1`, `warn = 0.5`,
`fail = 0`. Because the denominator is the emitted finding list, the score is only comparable
**between runs with the same shape**:

- `--run` adds one pass/fail finding *per capability*, so the same repo scores differently with and
  without `--run`. Pick one mode for CI and keep it.
- Repos with no hooks/CI skip the per-control wiring findings entirely; a missing manifest is a
  single finding (score 0) while one fail among many passes scores high.
- `unchecked` findings are excluded from **both halves** of the ratio — they are not a fourth
  weight. A clause nobody could judge is not half-true, and giving absent evidence any weight would
  let the environment move the score. They never affect the exit code either.
- Treat `fails` / `warns` as the headline numbers for trends; the percentage is a display heuristic.

**The run's shape is part of its output.** A conformant runner publishes `unchecked` (how many
clauses it declined to judge) and `scored` (the score's actual denominator) beside `score`, `fails`
and `warns`, so the comparability rule above is *checkable* from the payload rather than taken on
trust: two percentages are comparable when their `scored` denominators and `unchecked` counts match.
The reference runner emits them in `--json` and includes `unchecked` in its report-back body.

`--run` executes each capability with a **180-second timeout**, so a legitimately slower command is
reported as FAIL (the reference runner names the timeout in the finding). Split or wrap such
commands, or run them in CI only.

A reimplementation in another language is conformant if it performs checks 1–6 against this spec
and reports each one as `pass` / `warn` / `fail` / `unchecked`.
The check *contract* is language-neutral; `doctor.mjs` is just the reference runner.

## Findings: the per-check contract (v0.3.0)

A run's findings are the half worth keeping. `fails: 3` cannot answer "which control regressed", so
every finding carries a **stable check id** alongside its message — an id that survives a reworded
message, so a receiver can follow one clause across runs.

An id is lower-case and dotted; a repo-specific subject (a capability name, a path) is slugged with
`[^a-z0-9._/-] → -`, truncated to 100 characters, and the whole id is capped at 120. The vocabulary:

| Check id | Judges |
| --- | --- |
| `manifest.missing` | there is no `.ai/manifest.yaml` at all |
| `structure` | the `schema` id is `ai-manifest` |
| `structure.schema-version` | the manifest's major version vs. the runner's |
| `pointer.<key>` | a declared `paths.<key>` resolves (`pointer.contextindex`, `pointer.memory`, …) |
| `guardrail.never-commit` | git does not track a file matching `secrets.neverCommit` |
| `capability.declared` | the manifest declares any capabilities at all |
| `capability.<name>` | that capability's command is still a `<placeholder>` |
| `capability.<name>.run` | `--run` executed the command and it passed |
| `manifest.write-back` | `--run` wrote the `verified` flags back |
| `control.prepush` | prePush controls are declared and a local hook exists at all |
| `control.prepush.<name>` | that control is wired into the local hook |
| `control.prepush.<name>.backing` | that control has a backing capability |
| `control.ci` | ciHardPass controls are declared and CI workflows exist |
| `freshness.<path>` | a `generatedFrom` file changed after `generatedAt` (or is a placeholder) |
| `freshness.unchecked` | freshness could not be judged here (shallow clone, no git) |
| `context.index` | `context-index.json` parses |
| `context.<path>` | a referenced `CONTEXT.md` exists and is not the unfilled template |
| `manifest.todo` | `TODO` placeholders remain |

A conformant runner may invent ids this document does not list — a reader stores what it does not
recognize and declines to group it (principle 3). Two entries with the same id inside one report are
collapsed **worst-level-wins** (`fail > warn > unchecked > pass`), which is deterministic and cannot
manufacture a pass.

The `--json` payload and the report-back body carry `findings: [{ check, level, message }]` plus
`scored`, `specVersion` and `runShape` (`"plain"` | `"run"` — the shape that changes the score's
denominator). All additive: a receiver that does not know them stores the same
`score` / `fails` / `warns` / `unchecked` it always did. A report that arrives with **no** `findings`
is stored as *summary-only*, and every per-check cell for it reads **not judged** — an absent finding
is never a passing control.

**Derived, not signed.** The per-check ledger is derived data. The tamper-evident record of a
conformance report is the signed audit entry the receiver writes on ingest; nothing in the ledger
claims provenance, and it must not be presented as an attestation.

## Read-back: the manifest as a scan input

The contract runs in both directions. A scan **reads** `.ai/manifest.yaml` and keeps what it found as
a *readout* — display-only, never scored beyond the two long-standing D1 awards, and never placed in
an LLM prompt. This is what completes principle 7: the repo declares, its own doctor proves, and the
proof is then legible outside the repo without any of it being re-derived by a vendor.

What a conformant reader takes from the file:

| Read | From | Rule |
| --- | --- | --- |
| capabilities | `capabilities` | name, command, `verified`, and whether the command is still a `<placeholder>` |
| proof | `capabilities.*.verified` | `true` = PROVEN · `false` = ran and FAILED · **absent = not run**, which is not `false` |
| control placement | `controls.prePush` / `controls.ciHardPass` | a capability's placement, plus any control with **no backing capability** |
| pointers | `paths` | read as strings; a reader does not follow them |
| provenance | `generatedAt`, `generatedFrom` | placeholder entries are reported as unfilled, never as fresh |
| identity | `repo.purpose`, `boundaries`, `agents` | carried through regeneration so a human's edit is never reset to a `TODO` seed |

Three rules govern the reader, and each exists because its opposite would be a lie a dashboard tells:

- **Absent, unreadable and empty are three different states.** No manifest in the scan is `absent`;
  a manifest that could not be parsed (bad YAML, or truncated by the fetch byte budget) is
  `unreadable` with a note; a readable manifest that declares nothing is neither. A surface must
  render an unread repo as "not assessed — re-scan" and keep it out of every denominator; `0/0` for
  a repo nobody looked at is a fabricated measurement.
- **A malformed manifest never fails the scan and never scores 0.** Reading is best-effort.
- **A command is repo content, so it is redacted before it is stored.** Any token- or
  `secret=`-shaped run in a declared command is replaced with `«redacted»` and a note is added.
  Commands are shown only inside the owning organization, never on a public or aggregate surface.

**Regeneration is never a downgrade.** When Ascent regenerates the manifest for a repo that already
has one, the repo's own declarations win: corrected commands are not re-guessed from the primary
language, a `verified: true` the doctor proved is not erased by a regeneration that ran nothing, a
capability the repo invented is preserved (the map is open by contract), and a tuned `controls` split
replaces the recommendation wholesale. The generated onboarding skill quotes **the repo's own
commands** and carries a "What this repo has already proven" section; where the repo declared no
readable contract, that section is **absent** rather than empty.

Where the fleet sees it: **Standing › Passports › Capabilities** renders repo × capability as
declared / proven / placeholder / absent with each declaration's control placement, and lists
unassessed repositories in a separate band below the table.

## Versioning policy

- Adding an optional field, capability name, or finding level → **patch/minor**, no reader changes.
  (v0.2.0 added the `unchecked` finding level and the `unchecked` / `scored` summary fields; a v0.1.0
  reader ignores both and reads the same `score` / `fails` / `warns` it always did. v0.3.0 adds check
  ids + `findings[]` to the report payload and the read-back contract above; it introduces no new
  manifest field, so a v0.2.0 manifest is already a conformant v0.3.0 one, and a v0.2.0 reader ignores
  `findings[]` and reads the same summary numbers.)
- Renaming/removing a field or changing a field's type → **major**, and only then.
- A reader at version `X.y` MUST parse any `X.*` manifest by ignoring unknown fields.

_This spec is intentionally small. The discipline is to keep the spine (`manifest.yaml`) thin and let
everything else be a pointer, so the standard grows by reference, not by accretion._

> **`.ai/memory` is now read, not just counted** (moonshot #14): the scan fetches the newest
> entries, parses their frontmatter (`src/lib/standard/memory-read.ts`) and mirrors them into
> Org Memory as untrusted, provenance-stamped candidates. The bodies are quarantined out of the
> assessment prompt by construction.
