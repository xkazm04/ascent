// The TypeScript reader for `.ai/manifest.yaml` (moonshot #13) — pure, no IO, and it NEVER throws.
//
// Why this is a re-implementation and not a shared parser: `.ai/doctor.mjs` is a JavaScript SOURCE
// STRING in doctor.ts, authored with no backticks and no `${}` so it embeds verbatim in a template
// literal and in SKILL.md. It cannot import, and it cannot be imported. So the doctor's regex-YAML
// subset is re-expressed here and PINNED TO IT by a parity test (read.test.ts): the two parsers are
// allowed to exist twice, they are not allowed to drift.
//
// The subset is deliberately the same one the doctor reads — `kv`, `sub`, `flow`, the `capabilities`
// block scan, and the `paths:`-scoped pointer read — because a reader that understood MORE YAML than
// the doctor would score a repo on a contract its own doctor cannot check.

import { MANIFEST_SCHEMA_VERSION } from "./types";
import type { CapabilityReadout, ControlPlacement, ManifestReadout } from "./readout";

const MAX_NOTES = 10;

/** A secret-shaped run inside a repo-authored command. See `redactCommand`. */
const TOKEN_RUN = /\b(gh[pousr]_|sk-|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/g;
const ASSIGNED_SECRET = /(token|secret|password|api[-_]?key)=\S+/gi;

/**
 * A capability command is REPO CONTENT, and repo content can embed a credential
 * (`curl -H "Authorization: ghp_…"`). The readout is persisted and rendered in the org dashboard, so
 * every command passes through here first. Redaction is lossy on purpose: a command that has been
 * redacted is still legible as a shape, and the alternative — storing the secret in Ascent's database
 * because a maintainer pasted it into their own manifest — is not a trade worth making.
 */
export function redactCommand(command: string): { command: string; redacted: boolean } {
  const out = command.replace(TOKEN_RUN, "«redacted»").replace(ASSIGNED_SECRET, (m) => `${m.split("=")[0]!}=«redacted»`);
  return { command: out, redacted: out !== command };
}

// ── the doctor's regex-YAML subset, re-expressed ─────────────────────────────────────────────────

/** Top-level `key: value` (the doctor's `kv`). */
function kv(text: string, key: string): string | null {
  const m = text.match(new RegExp("^" + key + ":\\s*(.+)$", "m"));
  return m ? unquote(m[1]!.trim()) : null;
}

/** An indented `key: value` inside a block (the doctor's `sub`). */
function sub(text: string, key: string): string | null {
  const m = text.match(new RegExp("^\\s+" + key + ":\\s*(.+)$", "m"));
  return m ? unquote(m[1]!.trim()) : null;
}

/** A flow list `key: [a, b, c]` (the doctor's `flow`). */
function flow(text: string, key: string): string[] {
  const m = text.match(new RegExp("^\\s*" + key + ":\\s*\\[([^\\]]*)\\]", "m"));
  return m
    ? m[1]!
        .split(",")
        .map((s) => unquote(s.trim()))
        .filter(Boolean)
    : [];
}

function unquote(v: string): string {
  return v.replace(/^"|"$/g, "");
}

/** The `paths:` block, scoped so a like-named capability cannot shadow a pointer (doctor check 2). */
function pathsBlock(text: string): string {
  return (text.split(/\npaths:\n/)[1] || "").split(/\n[a-z]/i)[0] ?? "";
}

/**
 * The `capabilities:` block. The command is `JSON.stringify`'d by the serializer, so the value may
 * contain escaped quotes — match the full quoted string and JSON-parse it back, exactly as the doctor
 * does, so a command containing a `"` round-trips instead of truncating at the escape.
 *
 * Returns null (not `{}`) when the block is ABSENT, which is how a truncated manifest is told apart
 * from one that declares nothing.
 */
function capabilityLines(text: string): { name: string; command: string; verified: boolean | null }[] | null {
  const block = text.split(/\ncapabilities:\n/)[1];
  if (block === undefined) return null;
  const out: { name: string; command: string; verified: boolean | null }[] = [];
  for (const line of block.split("\n")) {
    const m = line.match(/^\s{2}([\w-]+):\s*\{\s*command:\s*("(?:[^"\\]|\\.)*")/);
    if (m) {
      let command: string;
      try {
        command = JSON.parse(m[2]!) as string;
      } catch {
        command = unquote(m[2]!);
      }
      // The doctor's `--run` write-back targets `verified:\s*(true|false)` on this same one-line
      // shape. ABSENT is a third state and stays null: "not run" is not "ran and failed" (G4).
      const v = line.match(/verified:\s*(true|false)\b/);
      out.push({ name: m[1]!, command, verified: v ? v[1] === "true" : null });
    } else if (/^[^\s#]/.test(line)) break;
  }
  return out;
}

/** The `agents:` block — the flow-mapping-per-line shape the serializer emits. */
function agentLines(text: string): { id: string; kind: string; entrypoint: string }[] {
  const block = text.split(/\nagents:\n/)[1];
  if (block === undefined) return [];
  const out: { id: string; kind: string; entrypoint: string }[] = [];
  for (const line of block.split("\n")) {
    if (/^[^\s#]/.test(line)) break;
    const m = line.match(/^\s*-\s*\{\s*id:\s*([^,}]+),\s*kind:\s*([^,}]+),\s*entrypoint:\s*([^}]+)\}/);
    if (m) out.push({ id: unquote(m[1]!.trim()), kind: unquote(m[2]!.trim()), entrypoint: unquote(m[3]!.trim()) });
  }
  return out;
}

// ── the reader ───────────────────────────────────────────────────────────────────────────────────

/**
 * Read a repo's `.ai/manifest.yaml` into the display-only `ManifestReadout`.
 *
 * `readAt` is left as the empty string here — this module is pure and stamps no clock;
 * `buildManifestReadout` fills it in at compose time. Never throws: a malformed manifest yields
 * `status: "unreadable"` with a note, and a malformed manifest must never fail a scan.
 */
export function readManifestYaml(text: string | undefined): ManifestReadout {
  const notes: string[] = [];
  const note = (s: string) => {
    if (notes.length < MAX_NOTES) notes.push(s);
  };

  const base: ManifestReadout = {
    status: "unreadable",
    readAt: "",
    generatedAt: null,
    schemaVersion: null,
    schemaAhead: false,
    capabilities: [],
    controls: { prePush: [], ciHardPass: [] },
    paths: {},
    agents: [],
    placeholders: [],
    unbacked: [],
    notes,
  };

  if (!text || !text.trim()) {
    note("the manifest file is empty");
    return base;
  }

  const schema = kv(text, "schema");
  const caps = capabilityLines(text);
  // "ok" needs BOTH the schema id and a capabilities block. A manifest truncated by the fetch budget
  // keeps its head and loses its tail, so "schema present, capabilities block gone" is exactly the
  // truncation shape — and calling that `ok` with zero capabilities would read as a repo that
  // declares nothing, which is a different and false statement about the repo.
  if (schema !== "ai-manifest") {
    note(schema ? `schema id is "${schema}", not "ai-manifest"` : "no `schema:` key — this is not an .ai manifest");
    return base;
  }
  if (caps === null) {
    note("no `capabilities:` block — the manifest is truncated or not in the readable subset");
    return base;
  }

  const schemaVersion = kv(text, "schemaVersion");
  const major = (v: string | null) => (v ?? "0").split(".")[0] ?? "0";
  const schemaAhead = schemaVersion != null && major(schemaVersion) !== major(MANIFEST_SCHEMA_VERSION);
  if (schemaAhead)
    note(`manifest major v${major(schemaVersion)} differs from this reader (v${major(MANIFEST_SCHEMA_VERSION)}) — read leniently`);

  const controls = { prePush: flow(text, "prePush"), ciHardPass: flow(text, "ciHardPass") };
  const placementOf = (name: string): ControlPlacement[] => {
    const at: ControlPlacement[] = [];
    if (controls.prePush.includes(name)) at.push("prePush");
    if (controls.ciHardPass.includes(name)) at.push("ciHardPass");
    return at;
  };

  let redactions = 0;
  const capabilities: CapabilityReadout[] = caps.map((c) => {
    const r = redactCommand(c.command);
    if (r.redacted) redactions += 1;
    return {
      name: c.name,
      command: r.command,
      verified: c.verified,
      placeholder: /<.*>/.test(c.command),
      wiredAt: placementOf(c.name),
    };
  });
  if (redactions) note(`${redactions} capability command(s) contained a secret-shaped run and were redacted`);

  const declaredNames = new Set(capabilities.map((c) => c.name));
  const unbacked = [...new Set([...controls.prePush, ...controls.ciHardPass])].filter((c) => !declaredNames.has(c));

  const paths: Record<string, string> = {};
  for (const line of pathsBlock(text).split("\n")) {
    const m = line.match(/^\s+([\w-]+):\s*(.+)$/);
    if (m) paths[m[1]!] = unquote(m[2]!.trim());
  }

  const generatedFrom = flow(text, "generatedFrom");
  const placeholders = generatedFrom.filter((f) => /<.*>/.test(f));

  return {
    ...base,
    status: "ok",
    generatedAt: kv(text, "generatedAt"),
    schemaVersion,
    schemaAhead,
    capabilities,
    controls,
    paths,
    agents: agentLines(text),
    placeholders,
    unbacked,
  };
}

/**
 * Read `.ai/guardrails.yaml`'s two machine-checkable lists. Returns null when the text is absent or
 * is not a guardrails document — the caller then says "not declared", never "declares nothing".
 *
 * `neverCommit` is nested under `secrets:`, so it is read with the same indented-flow-list rule the
 * doctor uses (`flow` is indentation-tolerant by design).
 */
export function readGuardrailsYaml(text: string | undefined): { neverCommit: string[]; neverTouch: string[] } | null {
  if (!text || !text.trim()) return null;
  if (kv(text, "schema") !== "ai-guardrails") return null;
  return { neverCommit: flow(text, "neverCommit"), neverTouch: flow(text, "neverTouch") };
}

/** Exposed for the doctor-parity test only — the subset helpers, so the test can diff them 1:1. */
export const __readerInternals = { kv, sub, flow, pathsBlock, capabilityLines, agentLines };
