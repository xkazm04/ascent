#!/usr/bin/env node
// KPI reader: sibling-test coverage of one context in context-map.json.
//
//   node scripts/kpi/context-test-coverage.mjs --context "Launch Fleet Map" [--dom] [--json]
//       [--root <checkout dir>] [--map <context-map.json>]
//
// Definition: non-test source files (.ts/.tsx) listed under the named context; share that have a
// sibling test. `--dom` counts only `<name>.dom.test.tsx` siblings (DOM-rendered .tsx components,
// the "Chart component DOM-test coverage" reading); without it any `<name>.test.ts[x]` or
// `<name>.dom.test.tsx` beside the file counts. Generalizes chart-dom-test-coverage.mjs, whose
// reading equals `--context "Score Charts & Visuals" --dom`. Read-only, no dependencies.
// `value: null` means the context has no eligible files (not 0 %).

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(name);

const root = resolve(opt("--root", process.cwd()));
const mapPath = resolve(opt("--map", join(root, "context-map.json")));
const contextName = opt("--context", null);
const domOnly = flag("--dom");
const json = flag("--json");

if (!contextName) {
  console.error('usage: --context "<context name>" [--dom] [--json] [--root dir] [--map file]');
  process.exit(2);
}

const map = JSON.parse(readFileSync(mapPath, "utf8"));
const contexts = [...map.groups.flatMap((g) => g.contexts ?? []), ...(map.ungrouped ?? [])];
const ctx = contexts.find((c) => c.name === contextName);
if (!ctx) {
  console.error(`context not found in ${mapPath}: ${contextName}`);
  process.exit(2);
}

const isTest = (p) => /\.(dom\.)?test\.tsx?$/.test(p);
const eligible = ctx.filePaths.filter((p) => /\.tsx?$/.test(p) && !isTest(p) && (!domOnly || p.endsWith(".tsx")));

const stem = (p) => basename(p).replace(/\.tsx?$/, "");
const hasSibling = (p) => {
  const dir = join(root, dirname(p));
  const s = stem(p);
  const candidates = domOnly
    ? [`${s}.dom.test.tsx`]
    : [`${s}.dom.test.tsx`, `${s}.test.tsx`, `${s}.test.ts`];
  return candidates.some((c) => existsSync(join(dir, c)));
};

const covered = eligible.filter(hasSibling);
const missing = eligible.filter((p) => !hasSibling(p));

let rev = null;
let dirty = null;
try {
  rev = execSync("git rev-parse --short HEAD", { cwd: root, encoding: "utf8" }).trim();
  dirty = execSync("git status --porcelain -- src", { cwd: root, encoding: "utf8" }).trim().length > 0;
} catch {
  /* not a git checkout: rev stays null */
}

const value = eligible.length === 0 ? null : (covered.length / eligible.length) * 100;
const out = {
  kpi: domOnly ? "context DOM-test coverage" : "context sibling-test coverage",
  context: contextName,
  value: value === null ? null : Number(value.toFixed(1)),
  numerator: covered.length,
  denominator: eligible.length,
  covered: covered.map(stem),
  missing: missing.map(stem),
  mapRevision: map.version ?? null,
  root,
  rev,
  dirty,
};

if (json) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`${out.kpi} · ${contextName}: ${out.value ?? "n/a"} % (${out.numerator}/${out.denominator}) @ ${rev ?? "?"}${dirty ? " (dirty)" : ""}`);
  console.log(`covered: ${out.covered.join(", ") || "-"}`);
  console.log(`missing: ${out.missing.join(", ") || "-"}`);
}
