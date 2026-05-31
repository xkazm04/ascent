#!/usr/bin/env node
// Maturity gate for CI — fail the build when a repo is below the maturity bar.
//
//   node scripts/maturity-gate.mjs owner/repo [options]
//   ASCENT_URL=https://your-deploy node scripts/maturity-gate.mjs owner/repo
//
// Options (all optional; unset ones fall back to the archetype-aware default policy):
//   --min-level L3        minimum overall maturity level
//   --min-overall 60      minimum overall score (0..100)
//   --min-dimension 40    no dimension may score below this
//   --no-ungoverned       fail if the posture is "ungoverned" (heavy AI, light guardrails)
//   --live                score with the configured LLM instead of the deterministic mock
//
// Exit codes: 0 = pass, 1 = fail (below the bar), 2 = error. Hits GET /api/gate, which
// already returns 200/422 — this wrapper just turns that into a clean CI exit + summary.

const argv = process.argv.slice(2);
const repo = argv.find((a) => !a.startsWith("--"));
if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
  console.error("Usage: node scripts/maturity-gate.mjs owner/repo [--min-level L3] [--min-dimension 40] [--no-ungoverned] [--live]");
  process.exit(2);
}

const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const base = (process.env.ASCENT_URL || "http://localhost:3000").replace(/\/$/, "");
const qs = new URLSearchParams();
if (opt("min-level")) qs.set("min_level", opt("min-level"));
if (opt("min-overall")) qs.set("min_overall", opt("min-overall"));
if (opt("min-dimension")) qs.set("min_dimension", opt("min-dimension"));
if (flag("no-ungoverned")) qs.set("no_ungoverned", "1");
if (flag("live")) qs.set("mock", "0");

const url = `${base}/api/gate/${repo}${qs.toString() ? `?${qs}` : ""}`;

try {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (res.status >= 500) {
    console.error(`✖ Gate error (${res.status}): ${body.error ?? "unknown"}`);
    process.exit(2);
  }
  const head = `${repo} — ${body.level ?? "?"} (${body.overallScore ?? "?"}/100), posture ${body.posture ?? "?"}`;
  if (body.pass) {
    console.log(`✓ Maturity gate PASSED — ${head}`);
    process.exit(0);
  }
  console.error(`✖ Maturity gate FAILED — ${head}`);
  for (const f of body.failures ?? []) console.error(`  - ${f.message}`);
  process.exit(1);
} catch (err) {
  console.error(`✖ Could not reach ${url}: ${err?.message ?? err}`);
  process.exit(2);
}
