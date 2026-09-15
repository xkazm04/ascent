// STRUCTURAL GUARD: every fleet-rollup producer is reached by something a person can see.
//
// The org-*.ts family is an aggregation layer, so its whole value is downstream: a function here
// that nothing calls is not dormant code, it is a fleet number the product paid to compute and never
// showed anyone. That failure is invisible by construction — the producer typechecks, its unit tests
// pass, and the barrel re-export in org.ts makes it look consumed. Measured on 2026-09-06, two of
// them had been dead for long enough that TWO earlier sweep rounds had landed correctness fixes
// INSIDE them ("fleet-rollups-insights #5" and "#6" are both in getOrgGapAnalysis's blast radius),
// hardening output no surface renders.
//
// So the ground truth is derived, not listed: this walks the family for exported producers and
// checks each against every non-test file in src/ that is not itself part of the family or one of
// its barrels. A producer with no reader must be named in UNWIRED below, with a reason — which makes
// "computed but not surfaced" a deliberate, reviewed state instead of a silent one, and makes the
// next one impossible to add by accident.
//
// This is the derived-list discipline the repo already applies to the audit-action registry
// (AuditLogCells.actions.test.ts) and to org [id] route gating (id-routes-gated.test.ts): the
// population comes from the code, never from a hand-kept list the code can drift away from.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(process.cwd(), "src");

/** The aggregation family this guard covers — the context's own producer modules. */
const FAMILY = [
  "lib/db/org-rollup.ts",
  "lib/db/org-insights.ts",
  "lib/db/org-signals.ts",
  "lib/db/org-teams.ts",
  "lib/db/org-contributors.ts",
  "lib/org/teamStandings.ts",
].map((p) => path.join(SRC, p));

/** Barrels re-export the whole family, so a mention there proves nothing about being rendered. */
const BARRELS = ["lib/db/org.ts", "lib/db/index.ts"].map((p) => path.join(SRC, p));

/**
 * Producers that legitimately have no reader yet. Each entry is a claim someone made on purpose, and
 * the reason is the half that matters — an entry with no plan is a deletion argument, not an
 * exemption. Removing a name from this list when it gets wired is the point.
 */
const UNWIRED: Record<string, string> = {
  // Computed, tested (org-gap-analysis.test.ts, 5 describes) and rendered nowhere. Separates a
  // SYSTEMIC fleet gap ("fix once, roll out") from a repo lagging what the org already handles —
  // the headline cross-repo question the dashboard cannot currently answer. Backlogged for a
  // surface; the wiring lives outside this context's paths.
  getOrgGapAnalysis: "no surface renders the common-vs-repo-specific split yet (backlogged 2026-09-06)",
  // Aggregates the LLM auditor's suspected detector misses across the fleet into a prioritized
  // detector backlog — the calibration loop for the core IP. Also rendered nowhere.
  getOrgDiscrepancies: "no surface renders the detector-calibration backlog yet (backlogged 2026-09-06)",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.(ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

/**
 * The family's PUBLIC READS — `getX` / `listX` / `explainX`. Deliberately not `computeX`: those are
 * pure internal transforms (computeCohortMovement, computeWindowDeltas, computeDimDeltas), exported
 * so they can be unit-tested against a hand-built cohort rather than a database, and called by a
 * producer in this same family a few lines down. Their output DOES reach a person, through their
 * caller — so a "nobody calls this" verdict on them would be false, and a guard that cries wolf on
 * three known-good helpers is a guard someone switches off.
 */
function producersIn(file: string): string[] {
  const text = fs.readFileSync(file, "utf8");
  const names: string[] = [];
  for (const m of text.matchAll(/^export (?:async )?function ((?:get|list|explain)[A-Z]\w*)/gm)) {
    names.push(m[1]!);
  }
  return names;
}

const allFiles = walk(SRC);
const familySet = new Set(FAMILY.map((f) => path.normalize(f)));
const barrelSet = new Set(BARRELS.map((f) => path.normalize(f)));
/** Everything that could RENDER or SERVE a fleet number: not the family, not its barrels, not tests. */
const consumers = allFiles.filter((f) => {
  const n = path.normalize(f);
  return !familySet.has(n) && !barrelSet.has(n);
});
const consumerText = consumers.map((f) => [f, fs.readFileSync(f, "utf8")] as const);

describe("the org rollup family reaches a consumer", () => {
  const producers = FAMILY.flatMap((f) => producersIn(f).map((name) => ({ name, file: f })));

  it("finds the family's producers at all (the walk itself must not silently return nothing)", () => {
    // Without this, a renamed directory or a changed export style turns the whole guard into a
    // vacuous pass — the failure mode a derived check has to defend against first.
    expect(producers.length).toBeGreaterThan(15);
    expect(producers.map((p) => p.name)).toContain("getOrgRollup");
  });

  it("every producer is either called outside the family, or declared UNWIRED with a reason", () => {
    const dead: string[] = [];
    for (const p of producers) {
      if (p.name in UNWIRED) continue;
      const re = new RegExp(`\\b${p.name}\\b`);
      if (!consumerText.some(([, t]) => re.test(t))) dead.push(`${path.relative(SRC, p.file)} → ${p.name}`);
    }
    expect(dead, "computed but rendered nowhere — wire it, delete it, or add it to UNWIRED with a reason").toEqual([]);
  });

  it("every UNWIRED entry still exists and is still unwired (the list cannot outlive its reason)", () => {
    const names = new Set(producers.map((p) => p.name));
    for (const [name, reason] of Object.entries(UNWIRED)) {
      expect(names.has(name), `UNWIRED names ${name}, which the family no longer exports`).toBe(true);
      expect(reason.length).toBeGreaterThan(20);
      const re = new RegExp(`\\b${name}\\b`);
      const readers = consumerText.filter(([, t]) => re.test(t)).map(([f]) => path.relative(SRC, f));
      expect(readers, `${name} is wired now — remove it from UNWIRED`).toEqual([]);
    }
  });
});
