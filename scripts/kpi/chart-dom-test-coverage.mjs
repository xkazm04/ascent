#!/usr/bin/env node
// Measurement source for the KPI "Chart component DOM-test coverage" (context: Score Charts & Visuals).
//
// Definition: of the non-test `.tsx` files listed under the context in context-map.json, the share that
// has a sibling `<name>.dom.test.tsx` on disk. A DOM test is the only test kind that exercises what a
// chart IS (rendered SVG/labels/hover); a pure `.test.ts` beside a helper is counted as "unit" and does
// not satisfy the KPI. The map is the roster on purpose: the KPI moves when a chart gains a DOM test
// OR when the context roster changes, and both are visible in the output (`mapRevision`).
//
// Output is the same shape as src/lib/db/kpi-metrics.ts: `value` plus the counts that produced it, so a
// reader can audit the cohort. `value` is null (not 0) when the cohort is empty.
//
// Usage:
//   node scripts/kpi/chart-dom-test-coverage.mjs                  # repo root = cwd, human summary + JSON
//   node scripts/kpi/chart-dom-test-coverage.mjs --json           # JSON only (for a Personas codebase KPI)
//   node scripts/kpi/chart-dom-test-coverage.mjs --root <path> --context "Score Charts & Visuals"
//
// Read-only. No dependencies. Exit 0 on a measurement, 2 when the map or the context cannot be found.

import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const KPI_NAME = "Chart component DOM-test coverage";
const DEFAULT_CONTEXT = "Score Charts & Visuals";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const root = resolve(arg("--root", process.cwd()));
const contextName = arg("--context", DEFAULT_CONTEXT);
const jsonOnly = process.argv.includes("--json");

const mapPath = join(root, "context-map.json");
if (!existsSync(mapPath)) {
  console.error(`context-map.json not found under ${root}`);
  process.exit(2);
}
const map = JSON.parse(readFileSync(mapPath, "utf8"));
const context = (map.groups ?? []).flatMap((g) => g.contexts ?? []).find((c) => c.name === contextName);
if (!context) {
  console.error(`context "${contextName}" not found in ${mapPath}`);
  process.exit(2);
}

const isTest = (f) => /\.(dom\.)?test\.tsx?$/.test(f);
const components = (context.filePaths ?? []).filter((f) => f.endsWith(".tsx") && !isTest(f));

const covered = [];
const missing = [];
for (const file of components) {
  const base = file.replace(/\.tsx$/, "");
  const domTest = `${base}.dom.test.tsx`;
  if (existsSync(join(root, domTest))) {
    covered.push({ file, test: domTest });
  } else {
    const unit = [`${base}.test.tsx`, `${base}.test.ts`].find((t) => existsSync(join(root, t))) ?? null;
    missing.push({ file, unitTest: unit });
  }
}

const denominator = components.length;
const numerator = covered.length;
const value = denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;

const result = {
  kpi: KPI_NAME,
  context: contextName,
  unit: "%",
  direction: "up",
  value,
  numerator,
  denominator,
  measuredAt: new Date().toISOString(),
  mapRevision: map.revision ?? null,
  mapGeneratedAt: map.generatedAt ?? null,
  covered: covered.map((c) => c.file),
  missing,
};

if (!jsonOnly) {
  console.log(`${KPI_NAME} — ${contextName}`);
  console.log(`  ${numerator}/${denominator} chart components have a .dom.test.tsx → ${value ?? "n/a"}%`);
  for (const m of missing) console.log(`  missing: ${m.file}${m.unitTest ? ` (unit test only: ${m.unitTest})` : ""}`);
  console.log("");
}
console.log(JSON.stringify(result, null, 2));
