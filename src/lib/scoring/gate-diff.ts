// What a gate-policy WRITE actually did to the org's bar — field by field, in the vocabulary the
// rest of the product already uses.
//
// Why this exists (UAT 2026-08-30, NADIA-L1-07 / PRIYA-L1-01): the policy editor posts the whole
// policy, so a field the form does not render was REPLACED AWAY on any unrelated save. The audit row
// the product wrote for that save carried the deleted field under `previousPolicy` and said nothing
// about it in `policy` or in the human-readable `status` — "the system knows precisely what it
// destroyed and the operator is never told". `useGatePolicyEditor` now round-trips unmodelled fields
// so the wipe cannot happen from the form, but the form is not the only writer (the admission
// overlay, the API, a future editor), and a control that can vanish silently is worth exactly
// nothing to an auditor. So every write is DIFFED against the stored bar and the drop is named.
//
// Pure, no I/O — the route composes it, the tests pin it.

import { describeGatePolicy, type GatePolicy } from "@/lib/scoring/gate";

/**
 * Every policy field, labelled. A total `Record` on purpose, the same guard `describeGatePolicy` and
 * `tightenGatePolicy` carry: adding a field to `GatePolicy` without deciding how a drop of it reads
 * is a compile error here, not a silent hole in the audit trail.
 */
const FIELD_LABELS: Record<keyof GatePolicy, string> = {
  minLevel: "minimum level",
  minOverall: "min overall score",
  minDimension: "min per-dimension score",
  minDimensionFor: "per-dimension floors",
  forbidPostures: "forbidden postures",
  requireProtectedBranch: "protected-branch requirement",
  minAiGovernedRate: "AI-review bar",
  forbidAiAuthorship: "AI-authorship block",
  requireChecks: "required controls",
};

const FIELDS = Object.keys(FIELD_LABELS) as (keyof GatePolicy)[];

export interface GatePolicyFieldChange {
  field: keyof GatePolicy;
  /** Human label for the field ("required controls"). */
  label: string;
  kind: "added" | "changed" | "removed";
  /** The field's canonical `describeGatePolicy` sentence before the write (null when unset). */
  before: string | null;
  /** …and after (null when the write left it unset). */
  after: string | null;
}

/** Is this field's value "not set"? Mirrors sanitizeGatePolicy: an empty list/map is not a bar. */
function unset(v: unknown): boolean {
  if (v == null || v === false) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

/**
 * The field's own conditions as `describeGatePolicy` renders them — so the audit row, the editor
 * warning and the dashboard can never disagree about what a bar said. One field can produce several
 * rows (`minDimensionFor`), which is why this joins rather than taking `[0]`.
 */
function say(p: GatePolicy | null, field: keyof GatePolicy): string | null {
  const v = p?.[field];
  if (unset(v)) return null;
  const text = describeGatePolicy({ [field]: v } as GatePolicy)
    .map((c) => c.text)
    .join("; ");
  return text || null;
}

/**
 * Field-level diff of a gate-policy write. Ordered by `GatePolicy`'s own field order so two writes of
 * the same shape always read the same way.
 */
export function diffGatePolicy(prev: GatePolicy | null, next: GatePolicy | null): GatePolicyFieldChange[] {
  const out: GatePolicyFieldChange[] = [];
  for (const field of FIELDS) {
    const before = say(prev, field);
    const after = say(next, field);
    if (before === after) continue;
    out.push({
      field,
      label: FIELD_LABELS[field],
      kind: before == null ? "added" : after == null ? "removed" : "changed",
      before,
      after,
    });
  }
  return out;
}

/** Just the drops — the half that used to be invisible. */
export function droppedGatePolicyFields(prev: GatePolicy | null, next: GatePolicy | null): GatePolicyFieldChange[] {
  return diffGatePolicy(prev, next).filter((c) => c.kind === "removed");
}

/**
 * The clause the audit row's human-readable `status` carries after the bar bits. Empty string when a
 * write neither dropped nor loosened anything — an added bar already shows up in the bits themselves,
 * so repeating it would bury the one line that matters.
 *
 * Reads like: ` — dropped required controls (Reported controls must not be failing: a, b)`.
 */
export function summarizeGatePolicyDiff(changes: GatePolicyFieldChange[]): string {
  const parts: string[] = [];
  for (const c of changes) {
    if (c.kind === "removed") parts.push(`dropped ${c.label} (${c.before})`);
    else if (c.kind === "changed") parts.push(`${c.label}: ${c.before} → ${c.after}`);
  }
  return parts.length ? ` — ${parts.join("; ")}` : "";
}
