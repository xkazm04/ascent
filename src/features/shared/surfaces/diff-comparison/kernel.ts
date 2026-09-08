// The comparison kernel: pure, deterministic, dependency-free. One change-kind vocabulary, one
// normalization ledger (a function, not a policy restated per call site), keyed or positional field
// alignment, a positional line diff, and the budget ladder that decides what a volume degrades to.
// The offload hook (useComparison.ts) runs it; the regions only read its result.

import type { Signal } from "./fixtures";

export type ChangeKind = "added" | "removed" | "changed" | "moved" | "unchanged" | "not-compared";

/** THE vocabulary: glyph + label beside colour, defined once, read by every region and the legend. */
export const CHANGE_KINDS: Record<ChangeKind, { glyph: string; label: string; tone: string }> = {
  added: { glyph: "+", label: "added", tone: "text-tone-rising" },
  removed: { glyph: "−", label: "removed", tone: "text-tone-falling" },
  changed: { glyph: "~", label: "changed", tone: "text-accent-soft" },
  moved: { glyph: "↕", label: "moved", tone: "text-warn" },
  unchanged: { glyph: "=", label: "unchanged", tone: "text-slate-500" },
  "not-compared": { glyph: "?", label: "not compared", tone: "text-slate-400" },
};
export const KIND_ORDER: readonly ChangeKind[] = ["added", "removed", "changed", "moved", "unchanged", "not-compared"];

export type Level = "bytes" | "lines" | "fields";
export type Alignment = "keyed" | "positional";
/** The degradation ladder, top to bottom. The budget picks the rung; the surface discloses it. */
export type Rung = "full" | "capped" | "summary" | "too-large";

export type DiffRow = {
  key: string;
  kind: ChangeKind;
  name: string;
  before: string | null;
  after: string | null;
  /** Why a row is not compared (binary; excluded as volatile). */
  reason?: string;
  /** A move is a heuristic: the displacement it was inferred from travels with the claim. */
  inferred?: string;
};

export type Counts = Record<ChangeKind, number>;
export type DiffResult = {
  level: Level;
  alignment: Alignment;
  rung: Rung;
  /** The window of rows the surface may render (empty at summary / too-large rungs). */
  rows: DiffRow[];
  /** Differences (every kind but unchanged) the kernel found — the predicate is `predicate`. */
  differences: number;
  counts: Counts;
  /** Was the remainder counted? False at `too-large`: a truncated computation cannot claim a count. */
  remainderKnown: boolean;
  predicate: string;
  spurious: number;
  ledgerVersion: number;
};

/** The normalization ledger — every standing assertion "this is not a difference", with its reason.
 *  Reviewed like a contract; `normalize()` is its one implementation. */
export const LEDGER_VERSION = 2;
export const LEDGER: readonly { id: string; why: string }[] = [
  { id: "crlf→lf", why: "line terminators are a platform fact, not an edit" },
  { id: "trailing whitespace", why: "editors strip it on save; a real change never lives there" },
  { id: "volatile: scannedAt", why: "changes on every run by construction — reported as not compared" },
];

export function normalize(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "");
}

/** Budgets, declared on the way in. A ceiling lives in the algorithm, not in a comment. */
export const BUDGET = {
  /** Below this many rows the kernel runs synchronously — offload's latency floor would dominate. */
  fastPathRows: 200,
  /** Up to here every row is aligned and shown (behind a window). */
  fullRows: 1_000,
  /** Up to here rows are aligned; output is capped and the cut is disclosed with its remainder. */
  detailRows: 10_000,
  /** The line level's ceiling: positional text alignment past this is "too large to compare". */
  lineCap: 2_000,
} as const;

export function rungFor(level: Level, n: number): Rung {
  if (level === "bytes") return "full";
  if (level === "lines") return n * 3 > BUDGET.lineCap ? "too-large" : "full";
  if (n <= BUDGET.fullRows) return "full";
  if (n <= BUDGET.detailRows) return "capped";
  return "summary";
}

const zero = (): Counts => ({ added: 0, removed: 0, changed: 0, moved: 0, unchanged: 0, "not-compared": 0 });

function notCompared(s: Signal): string | null {
  if (s.kind === "blob") return "binary — nothing to align";
  if (s.kind === "volatile") return "excluded by the ledger (volatile)";
  return null;
}

/** Field-level diff over the entity's own rows. Keyed alignment matches by `id` (identity survives
 *  the insertions at the head); positional alignment compares index i with index i — the trap, kept
 *  so the surface can count what it would have lied about. */
export function diffFields(base: readonly Signal[], cand: readonly Signal[], alignment: Alignment, window: number): DiffResult {
  const counts = zero();
  const rows: DiffRow[] = [];
  const push = (r: DiffRow) => {
    counts[r.kind] += 1;
    if (rows.length < window) rows.push(r);
  };
  if (alignment === "positional") {
    const n = Math.max(base.length, cand.length);
    for (let i = 0; i < n; i++) {
      const b = base[i];
      const c = cand[i];
      if (!b) push({ key: c!.id, kind: "added", name: c!.name, before: null, after: c!.value });
      else if (!c) push({ key: b.id, kind: "removed", name: b.name, before: b.value, after: null });
      else {
        const same = b.id === c.id && normalize(b.value) === normalize(c.value);
        push({ key: `${b.id}/${c.id}`, kind: same ? "unchanged" : "changed", name: b.id === c.id ? b.name : `${b.name} → ${c.name}`, before: b.value, after: c.value });
      }
    }
  } else {
    const baseById = new Map(base.map((s, i) => [s.id, { s, i }]));
    const candIds = new Set(cand.map((s) => s.id));
    // Shared ids in each side's order: a move is a shared id whose rank moved by more than one slot.
    const baseRank = new Map<string, number>();
    let r = 0;
    for (const s of base) if (candIds.has(s.id)) baseRank.set(s.id, r++);
    let candRank = 0;
    for (const c of cand) {
      const hit = baseById.get(c.id);
      if (!hit) {
        push({ key: c.id, kind: "added", name: c.name, before: null, after: c.value });
        continue;
      }
      const reason = notCompared(c);
      const displacement = Math.abs((baseRank.get(c.id) ?? 0) - candRank++);
      if (reason) push({ key: c.id, kind: "not-compared", name: c.name, before: hit.s.value, after: c.value, reason });
      else if (displacement > 1) push({ key: c.id, kind: "moved", name: c.name, before: hit.s.value, after: c.value, inferred: `inferred from a displacement of ${displacement} slots` });
      else if (normalize(hit.s.value) === normalize(c.value)) push({ key: c.id, kind: "unchanged", name: c.name, before: hit.s.value, after: c.value });
      else push({ key: c.id, kind: "changed", name: c.name, before: hit.s.value, after: c.value });
    }
    for (const b of base) if (!candIds.has(b.id)) push({ key: b.id, kind: "removed", name: b.name, before: b.value, after: null });
  }
  const differences = counts.added + counts.removed + counts.changed + counts.moved;
  return {
    level: "fields",
    alignment,
    rung: rungFor("fields", Math.max(base.length, cand.length)),
    rows,
    differences,
    counts,
    remainderKnown: true,
    predicate: `field level · ${alignment} alignment · ledger v${LEDGER_VERSION}`,
    spurious: 0,
    ledgerVersion: LEDGER_VERSION,
  };
}

/** Positional line diff over two serializations. Cheap, honest about what it is, and the level at
 *  which formatting churn becomes phantom edits. Past `BUDGET.lineCap` it declines to run. */
export function diffLines(a: string, b: string, realDifferences: number, window: number): DiffResult {
  const la = normalize(a).split("\n");
  const lb = normalize(b).split("\n");
  const n = Math.max(la.length, lb.length);
  const counts = zero();
  const rows: DiffRow[] = [];
  if (n > BUDGET.lineCap) {
    return { level: "lines", alignment: "positional", rung: "too-large", rows, differences: 0, counts, remainderKnown: false, predicate: `line level · positional · ${n.toLocaleString("en-US")} lines exceed the ${BUDGET.lineCap.toLocaleString("en-US")}-line budget`, spurious: 0, ledgerVersion: LEDGER_VERSION };
  }
  for (let i = 0; i < n; i++) {
    const x = la[i];
    const y = lb[i];
    const kind: ChangeKind = x === undefined ? "added" : y === undefined ? "removed" : x === y ? "unchanged" : "changed";
    counts[kind] += 1;
    if (rows.length < window) rows.push({ key: `L${i + 1}`, kind, name: `line ${i + 1}`, before: x ?? null, after: y ?? null });
  }
  const differences = counts.added + counts.removed + counts.changed;
  return { level: "lines", alignment: "positional", rung: "full", rows, differences, counts, remainderKnown: true, predicate: `line level · positional · ledger v${LEDGER_VERSION}`, spurious: Math.max(0, differences - realDifferences), ledgerVersion: LEDGER_VERSION };
}

/** Byte level answers one question — identical or not — and is never a presentation level. */
export function diffBytes(a: string, b: string): DiffResult {
  const counts = zero();
  const same = a === b;
  if (!same) counts.changed = 1;
  return { level: "bytes", alignment: "positional", rung: "full", rows: [], differences: same ? 0 : 1, counts, remainderKnown: true, predicate: "byte level · identical-or-not", spurious: 0, ledgerVersion: LEDGER_VERSION };
}
