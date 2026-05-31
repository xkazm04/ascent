#!/usr/bin/env node
// Calibration / eval harness — runs the labeled benchmark set (bench/repos.json) through
// a RUNNING Ascent server and reports agreement with expected maturity levels + the
// per-dimension score distribution. Supports persisting runs and diffing two runs so you
// can measure whether a change improved the output.
//
// Modes:
//   npm run bench                       # mock mode (deterministic, signal-only)
//   npm run bench -- --live             # use the server's configured provider (gemini / claude-cli / bedrock)
//   npm run bench -- --live --save      # also write the run to bench/results/<engine>-<ts>.json
//   npm run bench -- --strict           # exit 1 if within-1-level agreement < 80%
//   npm run bench -- --compare a.json b.json   # diff two saved runs
//   BENCH_URL=https://… npm run bench
//
// For subscription-based eval (no API credits): run the server with `LLM_PROVIDER=claude-cli`
// (and the `claude` CLI logged in), then `npm run bench -- --live --save`. See docs/CALIBRATION.md.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const BASE = process.env.BENCH_URL || argv.find((a) => a.startsWith("http")) || "http://localhost:3000";
const STRICT = has("--strict");
const LIVE = has("--live");
const SAVE = has("--save");
const lvlNum = (id) => parseInt(String(id).slice(1), 10) || 0;
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "—");

// ---- compare mode ----------------------------------------------------------
if (has("--compare")) {
  const i = argv.indexOf("--compare");
  const [fa, fb] = [argv[i + 1], argv[i + 2]];
  if (!fa || !fb) {
    console.error("Usage: npm run bench -- --compare <runA.json> <runB.json>");
    process.exit(1);
  }
  compare(JSON.parse(readFileSync(fa, "utf8")), JSON.parse(readFileSync(fb, "utf8")), fa, fb);
  process.exit(0);
}

// ---- run mode --------------------------------------------------------------
const { repos } = JSON.parse(readFileSync(join(ROOT, "bench", "repos.json"), "utf8"));
const mode = LIVE ? "live (server provider)" : "mock";
console.log(`\nAscent eval · ${repos.length} repos · server ${BASE} · ${mode}\n`);
console.log("repo".padEnd(38), "exp", "got", "score", "Δ");
console.log("-".repeat(64));

const rows = [];
const dimTotals = {};
let errors = 0;
let engine = "unknown";

for (const r of repos) {
  try {
    const qs = LIVE ? "" : "&mock=1";
    const res = await fetch(`${BASE}/api/scan?url=${encodeURIComponent(r.repo)}${qs}`);
    if (!res.ok) {
      errors++;
      console.log(r.repo.padEnd(38), r.expected, "ERR", String(res.status));
      continue;
    }
    const report = await res.json();
    engine = `${report.engine?.provider}:${report.engine?.model}`;
    const got = report.level.id;
    const delta = Math.abs(lvlNum(got) - lvlNum(r.expected));
    const dims = Object.fromEntries(report.dimensions.map((d) => [d.id, d.score]));
    rows.push({ repo: r.repo, expected: r.expected, got, score: report.overallScore, delta, dims });
    for (const d of report.dimensions) {
      dimTotals[d.id] = dimTotals[d.id] || { name: d.name, sum: 0, n: 0 };
      dimTotals[d.id].sum += d.score;
      dimTotals[d.id].n += 1;
    }
    const flag = delta === 0 ? "✓" : delta === 1 ? "~" : "✗";
    console.log(r.repo.padEnd(38), r.expected, got, String(report.overallScore).padStart(3), `${flag}${delta || ""}`);
  } catch (e) {
    errors++;
    console.log(r.repo.padEnd(38), r.expected, "ERR", String(e.message || e).slice(0, 30));
  }
}

const summary = metrics(rows);
console.log("\n" + "=".repeat(64));
console.log(`Engine:           ${engine}`);
console.log(`Scored:           ${rows.length}/${repos.length}${errors ? `  (${errors} errors)` : ""}`);
console.log(`Exact level:      ${summary.exact}/${rows.length}  (${pct(summary.exact, rows.length)})`);
console.log(`Within 1 level:   ${summary.within1}/${rows.length}  (${pct(summary.within1, rows.length)})`);
console.log(`Mean |level Δ|:   ${summary.mae.toFixed(2)}`);

console.log("\nPer-dimension mean score (distribution health):");
for (const id of Object.keys(dimTotals).sort()) {
  const d = dimTotals[id];
  const avg = d.sum / d.n;
  console.log(`  ${id} ${d.name.padEnd(28)} ${String(Math.round(avg)).padStart(3)}  ${"█".repeat(Math.round(avg / 4))}`);
}

if (SAVE) {
  mkdirSync(join(ROOT, "bench", "results"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeEngine = engine.replace(/[^a-z0-9]+/gi, "-");
  const file = join(ROOT, "bench", "results", `${safeEngine}-${stamp}.json`);
  writeFileSync(file, JSON.stringify({ meta: { at: stamp, base: BASE, live: LIVE, engine }, summary, rows }, null, 2));
  console.log(`\nSaved run → ${file}`);
}
console.log("");

if (STRICT && rows.length > 0 && summary.within1 / rows.length < 0.8) {
  console.error(`STRICT: within-1-level ${pct(summary.within1, rows.length)} < 80% — calibration needed.`);
  process.exit(1);
}

function metrics(rs) {
  const n = rs.length;
  const exact = rs.filter((r) => r.delta === 0).length;
  const within1 = rs.filter((r) => r.delta <= 1).length;
  const mae = n ? rs.reduce((a, r) => a + r.delta, 0) / n : 0;
  return { n, exact, within1, mae };
}

function compare(a, b, fa, fb) {
  const mapB = new Map(b.rows.map((r) => [r.repo, r]));
  console.log(`\nCompare  A=${fa}  vs  B=${fb}`);
  console.log(`  A engine: ${a.meta?.engine}   B engine: ${b.meta?.engine}\n`);
  console.log("repo".padEnd(38), "exp", "A", "B", "scoreΔ", "closer");
  console.log("-".repeat(72));
  let improved = 0;
  let regressed = 0;
  for (const ra of a.rows) {
    const rb = mapB.get(ra.repo);
    if (!rb) continue;
    const aDelta = Math.abs(lvlNum(ra.got) - lvlNum(ra.expected));
    const bDelta = Math.abs(lvlNum(rb.got) - lvlNum(rb.expected));
    const closer = bDelta < aDelta ? "B↑" : bDelta > aDelta ? "A↑" : "=";
    if (bDelta < aDelta) improved++;
    if (bDelta > aDelta) regressed++;
    console.log(
      ra.repo.padEnd(38),
      ra.expected,
      `${ra.got}/${ra.score}`.padEnd(7),
      `${rb.got}/${rb.score}`.padEnd(7),
      String(rb.score - ra.score).padStart(6),
      closer,
    );
  }
  const sa = metrics(a.rows);
  const sb = metrics(b.rows);
  console.log("\n" + "=".repeat(72));
  console.log(`A within-1: ${pct(sa.within1, sa.n)}  exact ${pct(sa.exact, sa.n)}  MAE ${sa.mae.toFixed(2)}`);
  console.log(`B within-1: ${pct(sb.within1, sb.n)}  exact ${pct(sb.exact, sb.n)}  MAE ${sb.mae.toFixed(2)}`);
  console.log(`Repos closer to expected in B: ${improved} · regressed: ${regressed}`);
  console.log("");
}
