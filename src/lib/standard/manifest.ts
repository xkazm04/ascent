// The `.ai/manifest.yaml` generator — the spine of the standard. Maps a ScanReport to a structured
// ManifestData, then serializes it as YAML (a human/diff-friendly VIEW of the object; the object is
// the contract). Pure and deterministic. See docs/features/onboarding/ai-manifest-spec.md for the versioned contract.

import type { ScanReport } from "@/lib/types";
import { commandsFor, type LangCommands } from "@/lib/practice-artifact";
import { type GeneratedFile, type ManifestData, MANIFEST_SCHEMA_VERSION } from "./types";
// The spec ships INSIDE the foundation (.ai/SPEC.md), so this pointer resolves in the adopting repo —
// it used to name a path that only exists in Ascent's own repo.
import { SPEC_PATH } from "./spec";
import type { ManifestReadout } from "./readout";

/** A `TODO:`/`<placeholder>` string is a seed, not an answer — treat it as absent. */
function nonPlaceholder(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t && !/^TODO/.test(t) && !/<.*>/.test(t) ? t : null;
}

/**
 * Language-manifest file a repo's commands derive from — the doctor drift-checks it.
 *
 * Keyed on `ci`, which the extended families (Ruby, PHP, the JVM three, Swift, Dart, Elixir) all set
 * to "generic" so the exhaustive maps here and in tracks.ts keep compiling. That made this map, and
 * TYPECHECK below, collapse every one of them onto the generic row: measured before this fix, 6 of 10
 * sampled languages got `generatedFrom: ["<your build manifest>"]`. `commandsFor` now carries a
 * `sourceFile` for those families and it wins over this map — see the fallback in buildManifestData.
 */
const SOURCE_FILE: Record<LangCommands["ci"], string> = {
  node: "package.json",
  python: "pyproject.toml",
  go: "go.mod",
  rust: "Cargo.toml",
  generic: "<your build manifest>",
};

/** Typecheck isn't in commandsFor (which is build/test/lint/install); map it per language family. */
const TYPECHECK: Record<LangCommands["ci"], string | null> = {
  node: "npx tsc --noEmit",
  python: "mypy .",
  go: "go vet ./...",
  rust: "cargo check",
  generic: null,
};

/**
 * Build the manifest for a repo — optionally REGENERATING over what the repo already declares.
 *
 * Without `opts.observed` this is byte-for-byte the original generator: a first install has nothing
 * to read back. With a readable observed readout (#13) the repo's own contract wins over every guess:
 * a command the maintainer corrected is not re-guessed from the primary language, a `verified: true`
 * the doctor PROVED is not erased by a regeneration that never ran anything, and the blocks the
 * generator seeds with `TODO` markers (purpose, boundaries, agents) keep the human's answer.
 *
 * The rule behind all of it: regeneration must never be a downgrade. A tool that silently discards
 * the edits a maintainer made to its output only gets run once.
 */
export function buildManifestData(report: ScanReport, opts?: { observed?: ManifestReadout | null }): ManifestData {
  const cmd = commandsFor(report.repo.primaryLanguage);
  const typecheck = TYPECHECK[cmd.ci];
  // Only a READABLE manifest is allowed to win. An `absent` or `unreadable` readout carries no
  // information about the repo's intent, so falling back to the guess is the honest move — merging a
  // half-parsed document would be worse than regenerating from scratch.
  const observed = opts?.observed?.status === "ok" ? opts.observed : null;
  const seen = new Map((observed?.capabilities ?? []).map((c) => [c.name, c]));
  /** The observed command/verified pair for a capability, else the freshly guessed one. */
  const cap = (name: string, guess: string): { command: string; verified: boolean } => {
    const o = seen.get(name);
    // A placeholder that survived in the repo is not an edit worth preserving — the guess is better.
    if (!o || o.placeholder) return { command: guess, verified: o?.verified === true };
    return { command: o.command, verified: o.verified === true };
  };

  const capabilities: ManifestData["capabilities"] = {
    build: cap("build", cmd.build),
    test: cap("test", cmd.test),
    lint: cap("lint", cmd.lint),
  };
  if (typecheck) capabilities.typecheck = cap("typecheck", typecheck);
  // Capabilities the repo invented that this generator knows nothing about. Dropping them would make
  // regeneration a deletion, which is the one thing an open map must never be.
  for (const [name, o] of seen)
    if (!(name in capabilities)) capabilities[name] = { command: o.command, verified: o.verified === true };

  return {
    schema: "ai-manifest",
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    spec: SPEC_PATH,
    generatedAt: report.scannedAt.slice(0, 10),
    // The family's own build manifest when it has one, else the `ci`-keyed row. The placeholder is
    // the last resort (an unrecognized language, or C#, whose project file name is repo-specific) —
    // and the doctor now reports it rather than skipping it silently.
    generatedFrom: [cmd.sourceFile ?? SOURCE_FILE[cmd.ci]],
    repo: {
      name: report.repo.name,
      // The human's own sentence outranks GitHub's description, which outranks the TODO seed.
      purpose:
        nonPlaceholder(observed?.purpose) ??
        (report.repo.description?.trim() || "TODO: one line on what this repo is for"),
      languages: report.repo.primaryLanguage ? [report.repo.primaryLanguage.toLowerCase()] : [],
      archetype: report.archetype,
    },
    capabilities,
    // ONLY pointers the foundation ships. The doctor validates every path declared here, so a
    // pointer to something we never generate (the old `evals: "evals/"`) was a guaranteed warn on
    // every fresh install for a subsystem a scan cannot synthesize. Declare `evals` when you have one.
    paths: {
      contextIndex: observed?.paths.contextIndex ?? ".ai/context-index.json",
      memory: observed?.paths.memory ?? ".ai/memory/",
      guardrails: observed?.paths.guardrails ?? ".ai/guardrails.yaml",
      // Pointers the repo added itself (an `evals:` it grew, or a key it invented) — carried through
      // so regeneration never quietly un-declares a subsystem the doctor was already checking.
      ...Object.fromEntries(
        Object.entries(observed?.paths ?? {}).filter(([k]) => !["contextIndex", "memory", "guardrails"].includes(k)),
      ),
    },
    context: { rule: "every module directory over 12 files has a CONTEXT.md" },
    boundaries: {
      // TODO: generated/vendored paths the agent must not hand-edit — kept once the human fills it.
      neverTouch: observed?.boundaries.neverTouch ?? [],
      secretsFrom:
        nonPlaceholder(observed?.boundaries.secretsFrom) ??
        "TODO: where secrets legitimately come from (a vault/keyring name)",
    },
    // TODO: register any coding agents (id/kind/entrypoint), vendor-neutral. A repo that registered
    // its agents keeps them: re-emitting `[]` here would delete a human's registry on every re-scan.
    agents: observed?.agents ?? [],
    // Recommended shift-left placement — fast checks pre-push, slow/clean-room ones in CI. The agent
    // still runs tests in its verify step regardless of where the GATE lives; this is about gates.
    // TUNE per repo: a small test suite can move to prePush; a huge one stays in CI. The doctor
    // reports which prePush controls lack a backing capability or aren't wired into the local hook.
    //
    // `typecheck` is listed ONLY when this language has one. The doctor reports a prePush control
    // with no backing capability so an onboarding track can close the gap — that is real signal for
    // `scan-secrets` (a track adds the gitleaks hook). It was noise for `typecheck` on every
    // extended family: TYPECHECK has no row for them, no track supplies one, and the kit offers no
    // way to fill it, so the warn was permanent and unfixable. Same rule the `evals` pointer and the
    // `<run tests>` placeholders were fixed under: never emit a finding the reader cannot act on.
    // TUNED placement is a decision, not a default: once the repo has one, it wins outright.
    controls: observed?.controls.prePush.length || observed?.controls.ciHardPass.length
      ? { prePush: observed.controls.prePush, ciHardPass: observed.controls.ciHardPass }
      : {
          prePush: ["lint", ...(typecheck ? ["typecheck"] : []), "scan-secrets"],
          ciHardPass: ["test", "sast", "merge-gate"],
        },
  };
}

// ---- YAML serialization (a regular, regex-friendly subset the doctor can read zero-dep) ---------

/**
 * Tokens that are legal in the plain-scalar character class below but are NOT strings to a YAML
 * parser: the YAML 1.1 booleans and nulls, and anything number-shaped.
 *
 * The manifest's whole premise is that "an arbitrary tool must be able to read it", so the on-disk
 * form has to survive a real YAML parser and not just the doctor's own regex reader (which treats
 * every value as text and so never saw this). A repository may legally be named `on`, `No`, `true`
 * or `1.0` — GitHub allows all of them — and `name: on` parses as the boolean true in YAML 1.1
 * (PyYAML, libyaml, most Ruby/Go readers). Quote those, leave everything else bare.
 */
const YAML_AMBIGUOUS =
  /^(y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF|null|Null|NULL|~)$/;
const NUMBER_SHAPED = /^[-+]?(\d[\d_]*(\.[\d_]*)?|\.[\d_]+|0x[\dA-Fa-f]+|0o?[0-7]+)([eE][-+]?\d+)?$/;

/** Quote a scalar only when needed, so simple tokens stay clean and diff-friendly. */
export function yamlScalar(v: string): string {
  const plain = /^[\w./@-]+$/.test(v) && !YAML_AMBIGUOUS.test(v) && !NUMBER_SHAPED.test(v);
  return plain ? v : JSON.stringify(v);
}

const scalar = yamlScalar;

function flowList(items: string[]): string {
  return `[${items.map(scalar).join(", ")}]`;
}

export function serializeManifestYaml(d: ManifestData): string {
  const caps = Object.entries(d.capabilities)
    .map(([name, c]) => `  ${name}: { command: ${JSON.stringify(c.command)}, verified: ${c.verified} }`)
    .join("\n");
  const agents = d.agents.length
    ? d.agents
        .map((a) => `  - { id: ${scalar(a.id)}, kind: ${scalar(a.kind)}, entrypoint: ${JSON.stringify(a.entrypoint)} }`)
        .join("\n")
    : "  [] # TODO: register coding agents (id/kind/entrypoint), vendor-neutral";

  return `# .ai/manifest.yaml: the agent-facing contract for this repo.
# Generated by Ascent. Capabilities are tool-NEUTRAL (a name -> the command that fulfils it), the
# heavy subsystems are referenced by path, and unknown fields MUST be ignored, so this survives
# tool churn and schema growth. Full contract: ${d.spec}
schema: ${d.schema}
schemaVersion: ${d.schemaVersion}
spec: ${scalar(d.spec)}
generatedAt: ${JSON.stringify(d.generatedAt)}
generatedFrom: ${flowList(d.generatedFrom)}

repo:
  name: ${scalar(d.repo.name)}
  purpose: ${JSON.stringify(d.repo.purpose)}
  languages: ${flowList(d.repo.languages)}
  archetype: ${scalar(d.repo.archetype)}

# Capabilities, not tools. Add keys freely; older readers ignore unknown ones.
# \`verified\` is a claim the doctor's --run writes back: true once it has actually run the command
# and it passed, false when the run fails (a stale true never outlives a broken command).
capabilities:
${caps}

# Pointers: these subsystems can change format underneath without breaking this contract. Every
# path DECLARED here must exist (the doctor checks it); a pointer you don't declare is not a finding.
# Add optional ones as the repo grows them, e.g.:
#   evals: evals/
paths:
${Object.entries(d.paths)
  .filter((e): e is [string, string] => typeof e[1] === "string")
  .map(([k, v]) => `  ${k}: ${scalar(v)}`)
  .join("\n")}

context:
  rule: ${JSON.stringify(d.context.rule)}

boundaries:
  neverTouch: ${flowList(d.boundaries.neverTouch)}
  secretsFrom: ${JSON.stringify(d.boundaries.secretsFrom)}

agents:
${agents}

# The control model (shift-left): where each capability is PRIMARILY enforced. CI is the thin
# backstop for hard passes only. TUNE this split for your repo: fast checks pre-push; slow suites
# (full tests, full-tree SAST) in CI. The agent runs tests in its verify step regardless of placement.
controls:
  prePush: ${flowList(d.controls.prePush)}
  ciHardPass: ${flowList(d.controls.ciHardPass)}
`;
}

export function buildManifest(report: ScanReport): GeneratedFile {
  return {
    path: ".ai/manifest.yaml",
    body: serializeManifestYaml(buildManifestData(report)),
    purpose: "The agent-facing contract: capabilities, pointers, boundaries, control placement.",
    lang: "yaml",
  };
}
