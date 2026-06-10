# The AI-Native Repo Standard — `.ai/` (spec v0.1.0)

> A small, **vendor-neutral** standard for making a codebase *legible, verifiable, and
> self-maintaining* for coding agents. Ascent authors and versions it; any agent or tool can read
> it. It does not name or require a specific tool.

A conformant repo carries an `.ai/` directory:

```
.ai/
  manifest.yaml        # the spine — the agent-facing contract (this spec)
  doctor.mjs           # executable conformance: validates the repo against this spec
  memory/              # structured, append-only, agent-written memory (decisions, gotchas, dead-ends)
  context-index.json   # index of co-located CONTEXT.md docs (the module graph)
  guardrails.yaml      # machine-checkable invariants (optional in v0)
```
plus co-located `CONTEXT.md` files inside source directories.

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
| `spec` | In-repo path to this document. |
| `generatedAt` / `generatedFrom` | Provenance for drift detection. |
| `repo` | `name`, `purpose`, `languages` (descriptive tags), `archetype`. |
| `capabilities` | Open map of `name → { command, verified }`. Tool-neutral. |
| `paths` | Pointers: `contextIndex`, `memory`, `evals`, `guardrails`. |
| `context.rule` | The structural rule the doctor enforces for CONTEXT coverage. |
| `boundaries` | `neverTouch` (don't hand-edit) + `secretsFrom` (the vault, not the secrets). |
| `agents` | Vendor-neutral registry: `{ id, kind, entrypoint }`. |
| `controls` | Shift-left placement: `prePush` (primary) vs `ciHardPass` (thin backstop). |

### Recommended capability vocabulary (open — extend at will)

`build`, `test`, `lint`, `typecheck`, `coverage`, `scan-secrets`, `scan-deps`, `sast`, `evals`,
`format`. These are *names*; the command behind each is the repo's choice. The doctor compares the
declared `capabilities` against `controls.prePush` + `controls.ciHardPass` and reports any control
that has no backing capability — that gap is what the onboarding tracks close.

## Conformance — what `doctor.mjs` checks

`node .ai/doctor.mjs` (zero-dependency, reference implementation) reports, and exits non-zero on a
hard failure:

1. **Structure** — `manifest.yaml` exists and carries the required keys at a supported `schemaVersion`.
2. **Pointers resolve** — `paths.*` and `context-index.json` exist.
3. **Capabilities** — each declared command resolves; `--run` actually executes the fast ones and
   reports pass/fail (this is what flips `verified`).
4. **Control placement** — every `controls.prePush` capability is backed by a declared capability and
   wired into a local hook; every `controls.ciHardPass` has a CI workflow. Missing pre-push controls
   are the highest-severity findings (a control that only lives in CI is "too late").
5. **Freshness** — `generatedFrom` files unchanged since `generatedAt`; CONTEXT entries don't
   reference deleted paths; memory entries are well-formed.
6. **Score** — prints a conformance percentage and the projected maturity delta, so the agent gets a
   tight local feedback loop instead of waiting for a remote scan.

A reimplementation in another language is conformant if it performs checks 1–5 against this spec.
The check *contract* is language-neutral; `doctor.mjs` is just the reference runner.

## Versioning policy

- Adding an optional field or capability name → **patch/minor**, no reader changes.
- Renaming/removing a field or changing a field's type → **major**, and only then.
- A reader at version `X.y` MUST parse any `X.*` manifest by ignoring unknown fields.

_This spec is intentionally small. The discipline is to keep the spine (`manifest.yaml`) thin and let
everything else be a pointer, so the standard grows by reference, not by accretion._
