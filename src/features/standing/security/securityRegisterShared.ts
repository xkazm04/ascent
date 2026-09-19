// Shared model + helpers for the Security risk-register matrix. The register renders the DETERMINISTIC
// security check battery (src/lib/security/checks.ts) as a control-coverage grid: one grade-colored
// chip per check, posture checks then the exposure check. Kept framework-agnostic (no JSX) so the sort
// and the check taxonomy live in one place.

import type { SecurityRegisterRow, SecurityRowCheck } from "@/lib/org/security";

/** Per-repo open-advisory counts (only present when supply-chain scanning is enabled).
 *  `medium`/`low` are optional so a caller that never measured them does not mint a 0 (G4). */
export interface RegisterAdvisories {
  fullName: string;
  critical: number;
  high: number;
  medium?: number;
  low?: number;
  total: number;
}

export interface AdvisoryChip {
  letter: "C" | "H" | "M" | "L";
  count: number;
  className: string;
}

const ADVISORY_CHIP_META: { key: "critical" | "high" | "medium" | "low"; letter: AdvisoryChip["letter"]; className: string }[] = [
  { key: "critical", letter: "C", className: "text-red-300" },
  { key: "high", letter: "H", className: "text-orange-300" },
  { key: "medium", letter: "M", className: "text-yellow-300" },
  { key: "low", letter: "L", className: "text-slate-400" },
];

/** Measured, non-zero severity chips. Omitted fields are skipped, never shown as 0 (G4). */
export function presentAdvisoryChips(adv: RegisterAdvisories): AdvisoryChip[] {
  const out: AdvisoryChip[] = [];
  for (const meta of ADVISORY_CHIP_META) {
    const n = adv[meta.key];
    if (typeof n === "number" && n > 0) out.push({ letter: meta.letter, count: n, className: meta.className });
  }
  return out;
}

/** Rows shown before the "Show all" toggle expands the fleet. */
export const VISIBLE_DEFAULT = 10;

// Canonical order + short chip labels for the battery's checks, keyed by the parsed check `id`
// (kebab-cased name). Posture checks read left→right as the shift-left pipeline; the exposure check
// (current open vulns) sits last, after a divider.
export const CHECK_ORDER: { id: string; short: string; group: "posture" | "exposure" }[] = [
  { id: "branch-protection", short: "Branch", group: "posture" },
  { id: "dangerous-workflow", short: "Danger", group: "posture" },
  { id: "token-permissions", short: "Tokens", group: "posture" },
  { id: "pinned-dependencies", short: "Pinned", group: "posture" },
  { id: "dependency-updates", short: "Deps", group: "posture" },
  { id: "sast", short: "SAST", group: "posture" },
  { id: "sbom", short: "SBOM", group: "posture" },
  { id: "signed-releases", short: "Signing", group: "posture" },
  { id: "security-policy", short: "Policy", group: "posture" },
  { id: "known-vulnerabilities", short: "Vulns", group: "exposure" },
];

/** A check chip's tone by its 0..10 grade (null = not applicable). */
export function gradeTone(score: number | null): "ok" | "warn" | "bad" | "na" {
  if (score === null) return "na";
  if (score >= 7) return "ok";
  if (score >= 4) return "warn";
  return "bad";
}

/** Count of posture checks a repo is failing (score < 4) — the "rules" sort proxy. */
export function failingChecks(r: SecurityRegisterRow): number {
  return r.checks.filter((c) => c.group === "posture" && c.score !== null && c.score < 4).length;
}

export type SortKey = "risk" | "name" | "score" | "gaps" | "adv";

/** First-click direction per column — the reading a security review reaches for first. */
export const DEFAULT_DIR: Record<SortKey, "asc" | "desc"> = {
  risk: "asc", // riskiest first (the server order)
  name: "asc",
  score: "asc", // weakest first
  gaps: "desc", // most failing controls first
  adv: "desc", // most advisories first
};

/** Sort a copy of the register rows by the chosen column/direction. `risk`+`asc` is the server order
 *  (gate-failing first, then weakest) — returned as-is so the default view is a stable no-op. */
export function sortRows(
  rows: SecurityRegisterRow[],
  sortKey: SortKey,
  dir: "asc" | "desc",
  advByRepo: Map<string, RegisterAdvisories> | null,
): SecurityRegisterRow[] {
  if (sortKey === "risk" && dir === "asc") return rows;
  const riskRank = new Map(rows.map((r, i) => [r.fullName, i]));
  const valueOf = (r: SecurityRegisterRow): number | string => {
    switch (sortKey) {
      case "risk":
        return riskRank.get(r.fullName) ?? 0;
      case "name":
        return r.name.toLowerCase();
      case "score":
        return r.score;
      case "gaps":
        return failingChecks(r);
      case "adv":
        return advByRepo?.get(r.fullName)?.total ?? -1;
    }
  };
  return [...rows].sort((a, b) => {
    const va = valueOf(a);
    const vb = valueOf(b);
    const cmp = typeof va === "string" ? va.localeCompare(vb as string) : va - (vb as number);
    return dir === "asc" ? cmp : -cmp;
  });
}

/** Index a repo's checks by id for O(1) grid lookup. */
export function checksById(checks: SecurityRowCheck[]): Map<string, SecurityRowCheck> {
  return new Map(checks.map((c) => [c.id, c]));
}
