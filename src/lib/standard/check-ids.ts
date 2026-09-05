// #16 — the stable check-id vocabulary for `.ai/doctor.mjs` findings.
//
// Until now a doctor run reported `{score, fails, warns}` and printed its per-check findings to a CI
// log that nobody reads twice. The findings are the valuable half: "which control regressed" is a
// question a score cannot answer. Persisting them needs an id that survives a message rewording, so
// this file is the vocabulary and `parseCheckId` is the only place that knows the id's shape.
//
// IT IS DUPLICATED BY DESIGN. `doctor.ts` embeds these literals verbatim, because the doctor is a
// JavaScript source string with no imports (no backticks, no `${}` — see its header). The ingest, the
// matrix and the doctor must agree on the vocabulary, so `standard.test.ts` asserts every id the
// generated script emits is a member of the set below.

/** The families a check id can belong to. The matrix groups columns by these. */
export const CHECK_FAMILIES = [
  "manifest",
  "structure",
  "pointer",
  "guardrail",
  "capability",
  "control",
  "freshness",
  "context",
  /** #15 — the guidance contract: is each declared projection still a projection of its source? */
  "guidance",
] as const;
export type CheckFamily = (typeof CHECK_FAMILIES)[number];

/** Ids the doctor emits with no repo-specific subject — the fixed spine of the vocabulary. */
export const STATIC_CHECK_IDS = [
  "manifest.missing",
  "manifest.write-back",
  "manifest.todo",
  "structure",
  "structure.schema-version",
  "guardrail.never-commit",
  "capability.declared",
  /** The local-hook presence check itself (prePush controls declared but no hook at all). */
  "control.prepush",
  "control.ci",
  "context.index",
  "freshness.unchecked",
  /** The manifest declares no `guidance` block at all — a repo that has not adopted it is not
   *  failing it, so this is `unchecked`, which is a RESULT and not a silence. */
  "guidance.unchecked",
  /** `guidance.canonical` names a file that does not resolve. */
  "guidance.canonical",
] as const;

/**
 * Templated ids, with `<…>` standing for a slugged repo-specific subject:
 * `pointer.<key>` · `capability.<name>` (placeholder) · `capability.<name>.run` ·
 * `control.prepush.<name>` · `control.prepush.<name>.backing` · `freshness.<path>` ·
 * `context.<path>` · `guidance.<path>` (one per declared projection).
 */
export const TEMPLATED_CHECK_PREFIXES = [
  "pointer.",
  "capability.",
  "control.prepush.",
  "freshness.",
  "context.",
  "guidance.",
] as const;

/** The wire shape of one check id. Ingest rejects anything that does not match. */
export const CHECK_ID_RE = /^[a-z][a-z0-9]*(\.[a-z0-9._/-]+)*$/;
export const CHECK_ID_MAX = 120;

/** The four levels a finding can carry. `unchecked` is a FIRST-CLASS outcome, never an absence. */
export const CHECK_LEVELS = ["pass", "warn", "fail", "unchecked"] as const;
export type CheckLevel = (typeof CHECK_LEVELS)[number];

/**
 * Slug a repo-specific subject into the id charset. Mirrors the `slug()` the doctor template embeds
 * verbatim — if these two diverge, an id the doctor emits stops matching one the matrix expects, so
 * `standard.test.ts` runs the generated script's own version against this one.
 */
export function slugSubject(raw: string): string {
  return String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9._/-]/g, "-")
    .slice(0, 100);
}

/** Build a check id from a family-prefix and a subject, capped at the wire limit. */
export function checkId(prefix: string, subject: string, suffix = ""): string {
  return (prefix + slugSubject(subject) + suffix).slice(0, CHECK_ID_MAX);
}

export function isValidCheckId(id: string): boolean {
  return typeof id === "string" && id.length > 0 && id.length <= CHECK_ID_MAX && CHECK_ID_RE.test(id);
}

/** True when `id` is one this build's doctor could have emitted. Unknown ids are STORED anyway (a
 *  newer reporter is allowed to invent checks — spec principle 3); this only drives grouping. */
export function isKnownCheckId(id: string): boolean {
  if ((STATIC_CHECK_IDS as readonly string[]).includes(id)) return true;
  return TEMPLATED_CHECK_PREFIXES.some((p) => id.startsWith(p) && id.length > p.length);
}

/**
 * Split an id into its family and its repo-specific subject. `subject` is null for a static id, so a
 * caller can tell "the pre-push hook check" from "the pre-push check for `lint`" without string
 * surgery at every call site.
 */
export function parseCheckId(id: string): { family: CheckFamily | "unknown"; subject: string | null } {
  const head = id.split(".")[0] ?? "";
  const family = (CHECK_FAMILIES as readonly string[]).includes(head) ? (head as CheckFamily) : "unknown";
  if ((STATIC_CHECK_IDS as readonly string[]).includes(id)) return { family, subject: null };
  for (const p of TEMPLATED_CHECK_PREFIXES) {
    if (!id.startsWith(p) || id.length === p.length) continue;
    // `capability.<name>.run` and `control.prepush.<name>.backing` carry a trailing qualifier that is
    // part of the CHECK, not part of the subject — strip it so both rows group under one subject.
    const rest = id.slice(p.length);
    const subject = rest.replace(/\.(run|backing)$/, "");
    return { family, subject: subject || null };
  }
  return { family, subject: null };
}

/** Worst-level-wins ordering, used to collapse duplicate ids inside one report. It cannot manufacture
 *  a pass: `fail` beats `warn` beats `unchecked` beats `pass`. */
export const LEVEL_RANK: Record<CheckLevel, number> = { fail: 3, warn: 2, unchecked: 1, pass: 0 };

export function worstLevel(a: CheckLevel, b: CheckLevel): CheckLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}
