// Sort ordinals for the fleet passport table. Extracted from PassportTable.tsx (200-LOC cap under
// src/features/**) — pure data, no React, so the table file keeps only its chrome and state.
//
// Every sortable column is an ENUM rendered as a word, so sorting on the rendered string would order
// "checks" before "gated" alphabetically and lie about which repo is further along. Each enum
// therefore carries its own ladder here and sorts by its INDEX in that ladder.

export type SortKey = "name" | "autoScore" | "prodScore" | "ci" | "tests" | "security" | "observability";

export const CI_ORDER = ["none", "build", "checks", "gated", "delivery", "progressive"];
export const TEST_ORDER = ["none", "smoke", "partial", "substantial", "comprehensive"];
export const SEC_ORDER = ["none", "policy", "scanning", "gated", "supply-chain"];
export const OBS_ORDER = ["none", "logs", "errors", "metrics", "tracing"];

import { isRungHeld } from "@/lib/analyze/passport-score";
import type { PassportFinding } from "@/lib/types";

const rank = (order: string[], v: string) => order.indexOf(v);

/** The shape `ordinalOf` reads — structural, so `PassportRow` satisfies it without importing it back. */
export interface SortableRow {
  name: string;
  autoScore: number;
  prodScore: number;
  ci: string;
  tests: string;
  security: string;
  observability: string;
  /** The coverage findings a HELD CI/security rung is read from (isRungHeld). */
  detail?: { prodFindings?: readonly Pick<PassportFinding, "id" | "code">[] | null };
}

/** `null` = a HELD rung (workflow files not read in full): its level is a floor, not a measurement,
 *  so it has no place on the ladder. */
export function ordinalOf(r: SortableRow, key: SortKey): number | string | null {
  switch (key) {
    case "name": return r.name.toLowerCase();
    case "autoScore": return r.autoScore;
    case "prodScore": return r.prodScore;
    case "ci": return isRungHeld("ci", r.ci, r.detail?.prodFindings) ? null : rank(CI_ORDER, r.ci);
    case "tests": return rank(TEST_ORDER, r.tests);
    case "security": return isRungHeld("security", r.security, r.detail?.prodFindings) ? null : rank(SEC_ORDER, r.security);
    case "observability": return rank(OBS_ORDER, r.observability);
  }
}

/** Table comparator. A held rung sorts after every assessed row in EITHER direction: ranked by its
 *  floor it would be filed among the weakest pipelines, which is the "scored low" it is not. */
export function compareRows(a: SortableRow, b: SortableRow, key: SortKey, dir: "asc" | "desc"): number {
  const av = ordinalOf(a, key);
  const bv = ordinalOf(b, key);
  if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
  const cmp = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : Number(av) - Number(bv);
  return dir === "asc" ? cmp : -cmp;
}

export type ThSort = { key: SortKey; dir: "asc" | "desc"; onSort: (k: SortKey) => void };
