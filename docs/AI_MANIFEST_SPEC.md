# The AI-Native Repo Standard — `.ai/` (spec v0.1.0)

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

Everything above is **generated**, so a fresh install is already conformant — the standard never
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
7. **Declared, then proven.** The manifest *claims* (`verified: false`); `doctor.mjs` *proves* by
   running the commands. The truth of a capability is established in-repo, pre-push — the maturity
   check shifts left, out of the remote scanner and into the repo.

## `manifest.yaml` fields

| Field | Meaning |
|---|---|
| `schema` | Stable id, always `ai-manifest`. |
| `schemaVersion` | Semver of this spec. |
| `spec` | In-repo path to this document (`.ai/SPEC.md` — it ships with the foundation). |
| `generatedAt` / `generatedFrom` | Provenance for drift detection. |
| `repo` | `name`, `purpose`, `languages` (descriptive tags), `archetype`. |
| `capabilities` | Open map of `name → { command, verified }`. Tool-neutral. |
| `paths` | Pointers. `contextIndex`, `memory` and `guardrails` always ship; any other key (e.g. `evals`) is optional and validated only when declared. |
| `context.rule` | The structural rule the doctor enforces for CONTEXT coverage. |
| `boundaries` | `neverTouch` (don't hand-edit) + `secretsFrom` (the vault, not the secrets). |
| `agents` | Vendor-neutral registry: `{ id, kind, entrypoint }`. |
| `controls` | Shift-left placement: `prePush` (primary) vs `ciHardPass` (thin backstop). |

### Recommended capability vocabulary (open — extend at will)

`build`, `test`, `lint`, `typecheck`, `coverage`, `scan-secrets`, `scan-deps`, `sast`, `evals`,
`format`. These are *names*; the command behind each is the repo's choice. The doctor compares the
declared `capabilities` against `controls.prePush` + `controls.ciHardPass` and reports any control
that has no backing capability — that gap is what the onboarding tracks close.

## `guardrails.yaml` — the invariants half

The manifest says what the repo *can do*; `guardrails.yaml` says what an agent *must not do*. It is a
separate file (pointed at by `paths.guardrails`) so it can grow without touching the spine, and it is
deliberately small enough that the doctor can enforce part of it mechanically.

| Field | Meaning |
|---|---|
| `schema` / `schemaVersion` | Stable id `ai-guardrails`, semver. Unknown fields MUST be ignored. |
| `neverTouch` | Globs an agent must never hand-edit (generated, vendored, locked). Mirrors `boundaries.neverTouch`. |
| `secrets.neverCommit` | Globs that must never be tracked by git. **Doctor-enforced** (hard fail). |
| `secrets.from` | Where secrets legitimately come from — a vault/keyring name, never the secret. |
| `review.*` | Change discipline: human approval required, verify before proposing, attribute AI work. |

## Conformance — what `doctor.mjs` checks

`node .ai/doctor.mjs` (zero-dependency, reference implementation) reports, and exits non-zero on a
hard failure:

1. **Structure** — `manifest.yaml` exists and carries the required keys at a supported `schemaVersion`.
2. **Pointers resolve** — every path DECLARED under `paths` exists (a pointer that is not declared is
   not a finding). A `CONTEXT.md` that is still the shipped template — its `<placeholder>` markers
   intact — is reported as unfilled: existence alone is not context.
3. **Capabilities** — each declared command resolves; `--run` actually executes the fast ones and
   reports pass/fail (this is what flips `verified`).
4. **Control placement** — every `controls.prePush` capability is backed by a declared capability and
   wired into a local hook; every `controls.ciHardPass` has a CI workflow. Missing pre-push controls
   are the highest-severity findings (a control that only lives in CI is "too late").
5. **Freshness** — `generatedFrom` files unchanged since `generatedAt`; CONTEXT entries don't
   reference deleted paths; memory entries are well-formed.
6. **Guardrails** — the invariants in `guardrails.yaml` that a machine CAN check are checked: no file
   matching `secrets.neverCommit` may be tracked by git. A violation is a hard failure.
7. **Score** — prints a conformance percentage and the projected maturity delta, so the agent gets a
   tight local feedback loop instead of waiting for a remote scan.

### Score semantics (read before comparing scores)

The score is a **weighted pass ratio over the findings the run happened to emit**, not a fixed
rubric: `score = round(100 × Σ weight / findings)` with weights `pass = 1`, `warn = 0.5`,
`fail = 0`. Because the denominator is the emitted finding list, the score is only comparable
**between runs with the same shape**:

- `--run` adds one pass/fail finding *per capability*, so the same repo scores differently with and
  without `--run` — pick one mode for CI and keep it.
- Repos with no hooks/CI skip the per-control wiring findings entirely; a missing manifest is a
  single finding (score 0) while one fail among many passes scores high.
- Treat `fails` / `warns` as the headline numbers for trends; the percentage is a display heuristic.

`--run` executes each capability with a **180-second timeout** — a legitimately slower command is
reported as FAIL (the reference runner names the timeout in the finding). Split or wrap such
commands, or run them in CI only.

A reimplementation in another language is conformant if it performs checks 1–6 against this spec.
The check *contract* is language-neutral; `doctor.mjs` is just the reference runner.

## Versioning policy

- Adding an optional field or capability name → **patch/minor**, no reader changes.
- Renaming/removing a field or changing a field's type → **major**, and only then.
- A reader at version `X.y` MUST parse any `X.*` manifest by ignoring unknown fields.

_This spec is intentionally small. The discipline is to keep the spine (`manifest.yaml`) thin and let
everything else be a pointer, so the standard grows by reference, not by accretion._
