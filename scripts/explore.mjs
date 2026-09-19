#!/usr/bin/env node
// Exploration harness — scans an unlabeled set of repos through a RUNNING server (live
// provider) and prints a D1–D7 score matrix + headlines + per-dimension distribution,
// saving full reports for deep analysis. For studying detector behavior / criteria
// tuning on a real portfolio (no expected labels).
//
//   LLM_PROVIDER=claude-cli GITHUB_TOKEN=$(gh auth token) npm run start
//   node scripts/explore.mjs --set bench/xkazm04.json --out bench/results/xkazm04.json

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const argv = process.argv.slice(2);
const arg = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : d;
};
const BASE = process.env.BENCH_URL || arg("--base", "http://localhost:3000");
const setFile = arg("--set", "bench/xkazm04.json");
const outFile = arg("--out", "bench/results/explore.json");

const { repos } = JSON.parse(readFileSync(join(ROOT, setFile), "utf8"));
const DIMS = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8"];

console.log(`\nExploring ${repos.length} repos · server ${BASE}\n`);
console.log("repo".padEnd(30), "arch", "L ", "ov", "Ad", "Ri", ...DIMS.map((d) => d.padStart(3)), " posture");
console.log("-".repeat(96));

mkdirSync(join(ROOT, "bench", "results"), { recursive: true });
const results = [];
const dimSum = Object.fromEntries(DIMS.map((d) => [d, { sum: 0, n: 0 }]));

for (const r of repos) {
  const name = r.repo;
  try {
    const res = await fetch(`${BASE}/api/scan?url=${encodeURIComponent(name)}`);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      console.log(name.padEnd(40), "ERR", res.status, e.code || e.error || "");
      results.push({ repo: name, error: e.error || res.status });
      continue;
    }
    const rep = await res.json();
    const byId = Object.fromEntries(rep.dimensions.map((d) => [d.id, d]));
    for (const d of DIMS) {
      if (byId[d]) {
        dimSum[d].sum += byId[d].score;
        dimSum[d].n += 1;
      }
    }
    console.log(
      name.replace("xkazm04/", "").padEnd(30),
      (rep.archetype || "?").slice(0, 4).padEnd(4),
      rep.level.id,
      String(rep.overallScore).padStart(2),
      String(rep.adoptionScore ?? "-").padStart(2),
      String(rep.rigorScore ?? "-").padStart(2),
      ...DIMS.map((d) => String(byId[d]?.score ?? "-").padStart(3)),
      " " + (rep.posture?.id ?? ""),
    );
    results.push({
      repo: name,
      private: rep.repo.isPrivate ?? null,
      language: rep.repo.primaryLanguage ?? null,
      archetype: rep.archetype,
      level: rep.level.id,
      overall: rep.overallScore,
      adoption: rep.adoptionScore,
      rigor: rep.rigorScore,
      posture: rep.posture?.id,
      aiUsage: rep.aiUsage,
      discrepancies: rep.discrepancies ?? [],
      confidence: rep.confidence,
      engine: rep.engine,
      warnings: rep.warnings ?? [],
      headline: rep.headline,
      dims: rep.dimensions.map((d) => ({
        id: d.id,
        score: d.score,
        signal: d.signalScore,
        llm: d.llmScore,
        evidence: d.evidence,
        gaps: d.gaps,
        summary: d.summary,
      })),
      roadmap: rep.roadmap.map((x) => ({ title: x.title, dimension: x.dimension, impact: x.impact, effort: x.effort })),
    });
  } catch (e) {
    console.log(name.padEnd(40), "ERR", String(e.message || e).slice(0, 30));
    results.push({ repo: name, error: String(e.message || e) });
  }
  // write incrementally so partial runs aren't lost
  writeFileSync(join(ROOT, outFile), JSON.stringify({ base: BASE, set: setFile, results }, null, 2));
}

console.log("\nPer-dimension mean (across scored repos):");
for (const d of DIMS) {
  const avg = dimSum[d].n ? dimSum[d].sum / dimSum[d].n : 0;
  console.log(`  ${d} ${String(Math.round(avg)).padStart(3)}  ${"█".repeat(Math.round(avg / 4))}`);
}
const scored = results.filter((r) => !r.error);
console.log(`\nScored ${scored.length}/${repos.length} · saved → ${outFile}\n`);
