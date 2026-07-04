// Shared aggregation for the Top blockers panel (P3) and its prototype variants: passport blocker
// strings counted across the repos in view, ranked by how many repos each one blocks. Blockers are
// deterministic canonical strings from buildPassport, so exact-match counting is sound; the one
// variable string (the self-verify missing-scripts list) is normalized into a single bucket.

import type { PassportRow } from "@/components/org/PassportTable";

export interface BlockedRepo {
  name: string;
  fullName: string;
}

export interface Agg {
  label: string;
  axis: "automation" | "production";
  repos: BlockedRepo[];
}

export const SELF_VERIFY_BUCKET = "Agent can't self-verify (missing build/test/lint/typecheck scripts).";

export function aggregateBlockers(rows: PassportRow[]): Agg[] {
  const byLabel = new Map<string, Agg>();
  const add = (label: string, axis: Agg["axis"], repo: BlockedRepo) => {
    const key = label.startsWith("Agent can't self-verify") ? SELF_VERIFY_BUCKET : label;
    const agg = byLabel.get(key) ?? { label: key, axis, repos: [] };
    agg.repos.push(repo);
    byLabel.set(key, agg);
  };
  for (const r of rows) {
    for (const b of r.detail.autoBlockers) add(b, "automation", { name: r.name, fullName: r.fullName });
    for (const b of r.detail.prodBlockers) add(b, "production", { name: r.name, fullName: r.fullName });
  }
  return [...byLabel.values()].sort((a, b) => b.repos.length - a.repos.length);
}

/** Axis palette — mirrors the scatter's vocabulary: automation = the accent, production = the
 *  "automatable, not prod-ready" amber. */
export const AXIS_TONE: Record<Agg["axis"], { label: string; color: string }> = {
  automation: { label: "auto", color: "#3b9eff" },
  production: { label: "prod", color: "#d97706" },
};
