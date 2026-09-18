// THE PLAN CONTRACT'S READER — strict `LanePlan` v1 out of a planning session's final message
// (spark theater-upgrade, 2026-09-18; WP3).
//
// FAIL CLOSED, NEVER REPAIR. The reader returns null — and null classifies the whole plan MAJOR with
// `clsReason: "unreadable"` — on anything that is not exactly the contract. In particular:
//   • only the LAST fenced ```json block counts (a planner that drafts a plan, reconsiders and emits a
//     second one meant the second one; an earlier draft must never win by position);
//   • an unknown move kind, a move missing the endpoint its kind requires, or a path with a `..`
//     segment voids the WHOLE plan. Dropping the one bad move would let a plan declare an architecture
//     move in a vocabulary the engine does not speak and then have it silently vanish from the fence;
//   • COUNT bounds (≤ 20 items, ≤ 40 files and ≤ 10 moves per item, ≤ 40 modules) are rejections, not
//     truncations, for the same reason — a truncated move list is an undeclared move;
//   • STRING bounds are caps: every string is trimmed, stripped of control characters and cut to its
//     limit (intent 600). A verbose sentence is not a reason to wake the operator.
// `validatePlan` is exported so the db layer can re-validate a stored `planJson` with the same rules.

import { ARCHITECTURE_MOVE_KINDS, type ArchitectureMove, type ArchitectureMoveKind, type LanePlan, type PlanItem } from "@/lib/local/runner-types";

export const PLAN_BOUNDS = {
  intent: 600,
  approach: 1_200,
  check: 600,
  path: 300,
  recId: 200,
  listItem: 300,
  items: 20,
  files: 40,
  moves: 10,
  modules: 40,
  list: 20,
  /** The JSON block itself — a plan is a page, not a dump. */
  block: 128 * 1024,
} as const;

/** Drop C0 control characters (tab, newline and carriage return kept) and DEL. */
function stripControl(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) continue;
    out += ch;
  }
  return out;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** A trimmed, cleaned, capped string; null when `v` is not a string. */
function str(v: unknown, cap: number): string | null {
  if (typeof v !== "string") return null;
  return stripControl(v).trim().slice(0, cap);
}

/** A repo-relative path-ish string, or null when it escapes the repository (a `..` segment). */
function pathStr(v: unknown): string | null {
  const s = str(v, PLAN_BOUNDS.path);
  if (s == null) return null;
  if (s.replace(/\\/g, "/").split("/").includes("..")) return null;
  return s;
}

/** A bounded list of strings. Null (→ unreadable) on a non-array, a non-string or an over-long list. */
function strList(v: unknown, max: number, each: (x: unknown) => string | null): string[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: string[] = [];
  for (const x of v) {
    const s = each(x);
    if (s == null) return null;
    if (s) out.push(s);
  }
  return out;
}

const KINDS = new Set<string>(ARCHITECTURE_MOVE_KINDS);

/** Which endpoints each kind must name. */
const NEEDS: Record<ArchitectureMoveKind, { from: boolean; to: boolean }> = {
  "module-created": { from: false, to: true },
  "module-removed": { from: true, to: false },
  "module-split": { from: true, to: false },
  "module-merged": { from: false, to: true },
  "cross-module-move": { from: true, to: true },
};

function validateMove(raw: unknown): ArchitectureMove | null {
  if (!isObj(raw) || typeof raw.kind !== "string" || !KINDS.has(raw.kind)) return null;
  const kind = raw.kind as ArchitectureMoveKind;
  const end = (v: unknown): string | null | undefined => {
    if (v == null) return null;
    const p = pathStr(v);
    return p == null ? undefined : p || null;
  };
  const from = end(raw.from);
  const to = end(raw.to);
  if (from === undefined || to === undefined) return null;
  if ((NEEDS[kind].from && !from) || (NEEDS[kind].to && !to)) return null;
  return { kind, from, to };
}

function validateItem(raw: unknown): PlanItem | null {
  if (!isObj(raw)) return null;
  const recommendationId = str(raw.recommendationId, PLAN_BOUNDS.recId);
  const approach = str(raw.approach, PLAN_BOUNDS.approach);
  if (!recommendationId || approach == null) return null;
  const files = strList(raw.files, PLAN_BOUNDS.files, pathStr);
  if (!files || !Array.isArray(raw.moves) || raw.moves.length > PLAN_BOUNDS.moves) return null;
  const moves: ArchitectureMove[] = [];
  for (const m of raw.moves) {
    const move = validateMove(m);
    if (!move) return null;
    moves.push(move);
  }
  return { recommendationId, approach, files, moves };
}

/** Strict v1 validation of an already-parsed value. Null = unreadable. */
export function validatePlan(raw: unknown): LanePlan | null {
  if (!isObj(raw) || raw.v !== 1) return null;
  const intent = str(raw.intent, PLAN_BOUNDS.intent);
  const check = str(raw.check, PLAN_BOUNDS.check);
  if (!intent || !check) return null;
  if (!Array.isArray(raw.items) || raw.items.length === 0 || raw.items.length > PLAN_BOUNDS.items) return null;
  const items: PlanItem[] = [];
  const seen = new Set<string>();
  for (const it of raw.items) {
    const item = validateItem(it);
    if (!item || seen.has(item.recommendationId)) return null;
    seen.add(item.recommendationId);
    items.push(item);
  }
  const modules = strList(raw.modules, PLAN_BOUNDS.modules, pathStr);
  if (!modules) return null;
  // `risks` / `notDoing` are informational: absent reads as an empty list, a wrong type does not.
  const listOf = (v: unknown) => (v === undefined ? [] : strList(v, PLAN_BOUNDS.list, (x) => str(x, PLAN_BOUNDS.listItem)));
  const risks = listOf(raw.risks);
  const notDoing = listOf(raw.notDoing);
  if (!risks || !notDoing) return null;
  return { v: 1, intent, items, modules, check, risks, notDoing };
}

/** The content of the LAST ```json fenced block, or null when there is none (or it never closes). */
export function lastJsonBlock(text: string): string | null {
  let last: string | null = null;
  for (const m of text.matchAll(/```[ \t]*json[ \t]*\r?\n([\s\S]*?)```/gi)) last = m[1]!;
  return last;
}

/** Parse the ONE fenced ```json block of a planning session's final message. Null = unreadable. */
export function parsePlan(text: string): LanePlan | null {
  if (typeof text !== "string" || !text) return null;
  const block = lastJsonBlock(text);
  if (block == null || block.length > PLAN_BOUNDS.block) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(block);
  } catch {
    return null;
  }
  return validatePlan(raw);
}
