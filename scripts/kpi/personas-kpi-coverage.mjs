#!/usr/bin/env node
// KPI reader: the stewardship meter, read from the Personas app database (read-only).
//
//   node scripts/kpi/personas-kpi-coverage.mjs [--db <personas.db>] [--project <id>] [--json]
//
// Readings (all for one project):
//   kpiRowsWithMeasurement   active dev_kpis rows with ≥1 dev_kpi_measurements row (%)
//   contextsWithActiveKpi    dev_contexts rows that have ≥1 active dev_kpis row (%)
//   kpiRowsWithBinding       active rows with a dev_kpi_bindings row (%), informational
// plus the list of contexts still without an active KPI. Uses node:sqlite (Node ≥ 22.5) with the
// database opened read-only; no writes are possible through this script.

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const json = args.includes("--json");
const project = opt("--project", "32c9b23b-9000-4852-b3f4-5300f4d0eaf5");
const dbPath = resolve(opt("--db", `${process.env.APPDATA ?? ""}/com.personas.desktop/personas.db`));
if (!existsSync(dbPath)) {
  console.error(`Personas DB not found: ${dbPath}`);
  process.exit(2);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const one = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const rate = (num, den) =>
  den <= 0 ? { value: null, numerator: num, denominator: den } : { value: Number(((num / den) * 100).toFixed(1)), numerator: num, denominator: den };

const active = one(
  `select count(*) as n,
          sum(exists(select 1 from dev_kpi_measurements m where m.kpi_id = k.id)) as measured,
          sum(exists(select 1 from dev_kpi_bindings b where b.kpi_id = k.id)) as bound
   from dev_kpis k where k.project_id = ? and k.status = 'active'`,
  project,
);
const ctx = one(
  `select count(*) as n,
          sum(exists(select 1 from dev_kpis k where k.context_id = c.id and k.status = 'active')) as covered
   from dev_contexts c where c.project_id = ?`,
  project,
);
const uncovered = all(
  `select c.name from dev_contexts c where c.project_id = ?
     and not exists(select 1 from dev_kpis k where k.context_id = c.id and k.status = 'active') order by c.name`,
  project,
).map((r) => r.name);
const measurements = one(
  `select count(*) as n, max(m.measured_at) as last from dev_kpi_measurements m join dev_kpis k on k.id = m.kpi_id where k.project_id = ?`,
  project,
);
db.close();

const out = {
  measuredAt: new Date().toISOString(),
  db: dbPath,
  project,
  kpiRowsWithMeasurement: rate(Number(active.measured ?? 0), Number(active.n)),
  contextsWithActiveKpi: rate(Number(ctx.covered ?? 0), Number(ctx.n)),
  kpiRowsWithBinding: rate(Number(active.bound ?? 0), Number(active.n)),
  measurementRows: Number(measurements.n),
  lastMeasurementAt: measurements.last,
  contextsWithoutActiveKpi: uncovered,
};

if (json) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`Personas KPI coverage for ${project}`);
  for (const k of ["kpiRowsWithMeasurement", "contextsWithActiveKpi", "kpiRowsWithBinding"]) {
    const v = out[k];
    console.log(`  ${k}: ${v.value ?? "n/a"} % (${v.numerator}/${v.denominator})`);
  }
  console.log(`  measurement rows: ${out.measurementRows} (last ${out.lastMeasurementAt ?? "-"})`);
  console.log(`  contexts without an active KPI: ${uncovered.length ? uncovered.join(", ") : "none"}`);
}
