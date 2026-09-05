#!/usr/bin/env node
// Drift checker for context-map.json — the area taxonomy every scan skill reads to decide where to
// look (/explorer, /architect, /scan-sweep, /conform).
//
// WHY THIS EXISTS. The map is HAND-MAINTAINED in this repo: its `$schema` and `projectId` name an
// external tool, but git history shows contexts renamed and added by hand in ordinary feature commits
// with `generatedAt` untouched. There is no regenerate command. That is a workable arrangement with
// one failure mode, and on 2026-08-29 it had happened: 449 of 1896 source files (24%) belonged to no
// context, including seven whole subsystems shipped after the map was last written — Athena, the loop
// cockpit and observatory, the registry engine, the local autopilot, the governance stance surface,
// MCP and conformance packs. Nothing was WRONG in the map (zero dead paths, zero dead routes); it was
// silently incomplete, and an unmapped subsystem is one no sweep will ever visit. Twenty-five days and
// 266 commits passed before a skill noticed.
//
// So this measures the thing that rots: COVERAGE, not correctness. Two numbers, one of which is a hard
// error and one a budget.
//
// USAGE
//   node scripts/context-map/check-map-drift.mjs            # report; exit 1 past the budget
//   node scripts/context-map/check-map-drift.mjs --json     # machine-readable
//   node scripts/context-map/check-map-drift.mjs --list     # name the unmapped files
//   node scripts/context-map/check-map-drift.mjs --budget N # override the unmapped-percent budget
//
// Deliberately NOT wired to a hook. The doc-sync Stop hook earns its per-turn cost because a doc goes
// stale on the turn that changes the code; a context map goes stale on the turn that adds a DIRECTORY,
// which is rare. Run it when you add a subsystem, or when a sweep skill says the map looks thin.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** Files that are real source but deliberately outside the taxonomy. */
export const SKIP = [
  /(^|\/)generated\//,
  /^src\/app\/_dev-inspector\//, // dev-only overlay, has its own context but ships no product surface
  /\.d\.ts$/,
];

/** What counts as a file the map should account for. */
export function isMappable(p) {
  if (!/\.(ts|tsx)$/.test(p)) return p === "prisma/schema.prisma";
  if (!p.startsWith("src/")) return false;
  return !SKIP.some((re) => re.test(p));
}

/** Normalize a map path (the map has carried Windows separators). */
export const norm = (p) => p.replace(/\\/g, "/");

/**
 * The whole analysis, as data. Exported so the test can drive it on fixtures rather than on the repo.
 * `tracked` is the list of git-tracked paths; `map` is the parsed context-map.
 */
export function analyze(map, tracked) {
  const mapped = new Map(); // file -> [context names]
  const dead = [];
  for (const g of map.groups ?? []) {
    for (const c of g.contexts ?? []) {
      for (const f of c.filePaths ?? []) {
        const p = norm(f);
        if (!tracked.includes(p)) dead.push({ context: c.name, file: p });
        mapped.set(p, [...(mapped.get(p) ?? []), c.name]);
      }
    }
  }

  // A file in two contexts is not automatically wrong — a shared module can genuinely serve two areas
  // — so it is REPORTED, never failed on. Silence about it is what lets a taxonomy blur.
  const shared = [...mapped.entries()].filter(([, ctxs]) => ctxs.length > 1);

  const routeDirs = tracked
    .filter((p) => /^src\/app\/api\/.*\/route\.ts$/.test(p))
    .map((p) => p.replace(/^src\/app/, "").replace(/\/route\.ts$/, ""));
  const deadRoutes = [];
  for (const g of map.groups ?? [])
    for (const c of g.contexts ?? [])
      for (const r of c.apiRoutes ?? []) if (!routeDirs.includes(r)) deadRoutes.push({ context: c.name, route: r });

  const mappable = tracked.filter(isMappable);
  const unmapped = mappable.filter((p) => !mapped.has(p));

  // Directories NOTHING owns are the signal that matters: a scattered unmapped file is bookkeeping, a
  // whole unowned directory is a subsystem no sweep will ever visit.
  const ownedDirs = new Set([...mapped.keys()].map((p) => path.posix.dirname(p)));
  const orphanDirs = new Map();
  for (const p of unmapped) {
    const d = path.posix.dirname(p);
    if (!ownedDirs.has(d)) orphanDirs.set(d, (orphanDirs.get(d) ?? 0) + 1);
  }

  return {
    contexts: (map.groups ?? []).reduce((n, g) => n + (g.contexts?.length ?? 0), 0),
    groups: (map.groups ?? []).length,
    mappable: mappable.length,
    mapped: mapped.size,
    unmapped,
    unmappedPct: mappable.length ? (unmapped.length / mappable.length) * 100 : 0,
    dead,
    deadRoutes,
    shared,
    orphanDirs: [...orphanDirs.entries()].sort((a, b) => b[1] - a[1]),
  };
}

/**
 * The budget for unmapped files, as a percentage.
 *
 * A budget rather than zero, deliberately. Reaching zero would mean assigning every shared module in
 * `src/lib/db/` and `src/lib/org/` — directories a dozen contexts each draw from — to exactly one
 * context, and forcing that choice would make the map LESS true, not more. 10% is set just above the
 * ~7% that remains after the 2026-08-29 repair, so the number that trips it is a new subsystem
 * arriving unmapped, not the standing ambiguity.
 */
export const UNMAPPED_BUDGET_PCT = 10;

function main(argv) {
  const json = argv.includes("--json");
  const list = argv.includes("--list");
  const bi = argv.indexOf("--budget");
  const budget = bi >= 0 ? Number(argv[bi + 1]) : UNMAPPED_BUDGET_PCT;

  const root = process.cwd();
  const map = JSON.parse(fs.readFileSync(path.join(root, "context-map.json"), "utf8"));
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\n")
    .filter(Boolean);

  const r = analyze(map, tracked);
  if (json) {
    console.log(JSON.stringify({ ...r, budget, unmapped: r.unmapped.length }, null, 2));
  } else {
    console.log(`context-map: ${r.groups} groups · ${r.contexts} contexts · ${r.mapped}/${r.mappable} files mapped`);
    console.log(`unmapped: ${r.unmapped.length} (${r.unmappedPct.toFixed(1)}%, budget ${budget}%)`);
    if (r.dead.length) {
      console.log(`\nDEAD file paths (${r.dead.length}) — the map names a file git does not track:`);
      for (const d of r.dead) console.log(`  ${d.context}: ${d.file}`);
    }
    if (r.deadRoutes.length) {
      console.log(`\nDEAD api routes (${r.deadRoutes.length}):`);
      for (const d of r.deadRoutes) console.log(`  ${d.context}: ${d.route}`);
    }
    if (r.orphanDirs.length) {
      console.log(`\nUNOWNED directories (${r.orphanDirs.length}) — no context owns anything here:`);
      for (const [d, n] of r.orphanDirs.slice(0, 20)) console.log(`  ${String(n).padStart(4)}  ${d}/`);
      if (r.orphanDirs.length > 20) console.log(`  ...and ${r.orphanDirs.length - 20} more`);
    }
    if (r.shared.length) console.log(`\n${r.shared.length} file(s) claimed by 2+ contexts (reported, not an error)`);
    if (list) {
      console.log(`\nUnmapped files:`);
      for (const p of r.unmapped) console.log(`  ${p}`);
    }
  }

  const fail = r.dead.length > 0 || r.deadRoutes.length > 0 || r.unmappedPct > budget;
  if (fail && !json) {
    console.log(
      `\nFAIL: ${r.dead.length ? "the map names files that no longer exist; " : ""}` +
        `${r.deadRoutes.length ? "the map names routes that no longer exist; " : ""}` +
        `${r.unmappedPct > budget ? `unmapped ${r.unmappedPct.toFixed(1)}% exceeds the ${budget}% budget; ` : ""}` +
        `repair context-map.json (it is hand-maintained — see this file's header).`,
    );
  }
  return fail ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("check-map-drift.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
