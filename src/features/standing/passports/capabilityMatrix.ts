// #13 — the fleet capability matrix: repo × capability, declared vs proven vs wired.
//
// Pure aggregation over the cached rollup rows (no fetch, no db). The one rule that shapes every
// decision here: a repo whose latest scan read NO manifest is `unassessed` — it is counted, listed,
// and kept out of every denominator. Folding it in as `0/0` would make "we have not looked" and "this
// repo declares nothing" the same number, which is exactly the honest-null failure (G4) the rest of
// the product spends its effort avoiding.

import type { ControlPlacement, ManifestReadout } from "@/lib/standard/readout";

/** One repo's state for one capability. `absent` = this repo does not declare it at all. */
export type CapabilityState = "verified" | "declared" | "placeholder" | "absent";

export interface CapabilityCell {
  state: CapabilityState;
  /** Where the capability is enforced, from the repo's own `controls`. `[]` = declared nowhere. */
  wiredAt: ControlPlacement[];
  /** The declared command, redacted at read time. Null for an `absent` cell. */
  command: string | null;
  /** `verified: false` — the doctor RAN this and it failed. Distinct from "not run" (state stays
   *  `declared` either way, so a cell can say which without inventing a fourth column). */
  failed: boolean;
}

export interface CapabilityMatrixRow {
  fullName: string;
  name: string;
  cells: Record<string, CapabilityCell>;
  /** Capabilities this repo declares that the doctor has PROVEN. */
  verified: number;
  /** Capabilities this repo declares at all (the denominator for `verified`). */
  declared: number;
  /** The manifest's own `generatedAt`, or null — never substituted with the scan date. */
  generatedAt: string | null;
  /** Controls declared with no backing capability — the declared-vs-declared gap. */
  unbacked: string[];
}

export interface CapabilityMatrix {
  /** Column order: the recommended vocabulary first, then whatever the repos invented, alphabetically. */
  capabilities: string[];
  rows: CapabilityMatrixRow[];
  /** Repos with NO readable manifest. Counted and listed; never folded into a denominator. */
  unassessed: { fullName: string; name: string; reason: "not assessed" | "unreadable" }[];
  /** Fleet headline numbers, computed over ASSESSED repos only. */
  totals: { repos: number; declared: number; verified: number; wired: number };
}

/** The capability names the standard itself recommends — the stable left-hand columns. */
export const RECOMMENDED_CAPABILITIES = ["build", "test", "lint", "typecheck"] as const;

/** The rollup fields this aggregation needs. Structural, so a caller passes `OrgRepoRow` directly. */
export interface CapabilityMatrixInput {
  fullName: string;
  name: string;
  manifest: ManifestReadout | null;
}

function cellFor(cap: { command: string; verified: boolean | null; placeholder: boolean; wiredAt: ControlPlacement[] }): CapabilityCell {
  return {
    // A placeholder outranks "verified" deliberately: a `<run tests>` command cannot have been
    // proven, and if a manifest ever claims both, the honest reading is the unfillable one.
    state: cap.placeholder ? "placeholder" : cap.verified === true ? "verified" : "declared",
    wiredAt: cap.wiredAt,
    command: cap.command,
    failed: cap.verified === false,
  };
}

/** The cell a repo gets for a capability it does not declare. Exported so the grid renders ONE
 *  absent cell rather than each view inventing its own empty shape. */
export const ABSENT_CELL: CapabilityCell = { state: "absent", wiredAt: [], command: null, failed: false };

/**
 * Build the fleet matrix. Repos are split, not merged: `rows` describes repos whose contract was
 * actually read, `unassessed` names the rest, and `totals` is computed over `rows` alone.
 */
export function buildCapabilityMatrix(repos: CapabilityMatrixInput[]): CapabilityMatrix {
  const rows: CapabilityMatrixRow[] = [];
  const unassessed: CapabilityMatrix["unassessed"] = [];
  const invented = new Set<string>();

  for (const r of repos) {
    const m = r.manifest;
    if (!m || m.status !== "ok") {
      // `unreadable` and "never read" are different facts about the run, so the band can say which.
      unassessed.push({
        fullName: r.fullName,
        name: r.name,
        reason: m?.status === "unreadable" ? "unreadable" : "not assessed",
      });
      continue;
    }
    const cells: Record<string, CapabilityCell> = {};
    for (const c of m.capabilities) {
      cells[c.name] = cellFor(c);
      if (!(RECOMMENDED_CAPABILITIES as readonly string[]).includes(c.name)) invented.add(c.name);
    }
    rows.push({
      fullName: r.fullName,
      name: r.name,
      cells,
      verified: m.capabilities.filter((c) => c.verified === true).length,
      declared: m.capabilities.length,
      generatedAt: m.generatedAt,
      unbacked: m.unbacked,
    });
  }

  const capabilities = [...RECOMMENDED_CAPABILITIES, ...[...invented].sort((a, b) => a.localeCompare(b))];
  rows.sort((a, b) => b.verified - a.verified || a.fullName.localeCompare(b.fullName));
  unassessed.sort((a, b) => a.fullName.localeCompare(b.fullName));

  return {
    capabilities,
    rows,
    unassessed,
    totals: {
      repos: rows.length,
      declared: rows.reduce((s, r) => s + r.declared, 0),
      verified: rows.reduce((s, r) => s + r.verified, 0),
      wired: rows.reduce((s, r) => s + Object.values(r.cells).filter((c) => c.wiredAt.length > 0).length, 0),
    },
  };
}

/**
 * The fleet verified ratio as a percentage, or NULL when nothing was assessed. Null is the point:
 * a caller that renders `0%` for an unassessed fleet is asserting a measurement it never took.
 */
export function verifiedRatio(matrix: CapabilityMatrix): number | null {
  if (matrix.totals.declared === 0) return null;
  return Math.round((100 * matrix.totals.verified) / matrix.totals.declared);
}
