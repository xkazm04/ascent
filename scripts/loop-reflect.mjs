#!/usr/bin/env node
// LOOP REFLECT — read a campaign's run artifacts and print what actually happened across them.
//
// The campaign script (loop-campaign.mjs) prints one block per run as it goes; this reads the same
// `run-NN-*.json` files afterwards and answers the questions a per-run block cannot: is the loop
// still finding work, what the lane LABELS say (backlog / practice / foundation / craft — a mixed
// gap+craft batch is `backlog`, so craft itself is not countable offline), how much finished work
// was thrown away, and is the score trajectory real or measurement noise.
//
// Deliberately dependency-free and read-only: it never talks to the server, so it is safe to run
// against a campaign that is still going.
//
//   node scripts/loop-reflect.mjs [--dir docs/harness/campaign] [--verbose]

import fs from "node:fs";
import path from "node:path";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};
const DIR = arg("dir", path.join("docs", "harness", "campaign"));
const VERBOSE = process.argv.includes("--verbose");

const files = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((n) => /^run-\d+-.*\.json$/.test(n)).sort()
  : [];
if (files.length === 0) {
  console.error(`no run artifacts in ${DIR}`);
  process.exit(1);
}

const short = (full) => full.split("/")[1] ?? full;
const pad = (s, n) => String(s).padEnd(n);

// Per repo: the score trail, what each run did, and the craft rungs climbed.
const repos = new Map();
const kindTally = {};
const stateTally = {};
// Craft cannot be counted offline: a deliverable carries covered recommendation ids, not their
// kind, and a mixed batch is deliberately labelled `backlog`. The old CRAFT AXES line read a field
// deliverables never had and printed "(no craft rungs yet)" for a campaign in which 143 craft
// items were dispatched and every close was a rung — a lie that misdirected a whole reflection.
// What IS in the artifacts and was never surfaced: work the lane produced and then threw away.
let discardedLanes = 0;
let discardedChanges = 0;
let commits = 0;
let closed = 0;
let deliverables = 0;

for (const [i, file] of files.entries()) {
  const d = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
  for (const o of d.outcomes ?? []) {
    const repo = short(o.lane.repoFullName);
    if (!repos.has(repo)) repos.set(repo, { trail: [], runs: [] });
    const r = repos.get(repo);
    const before = o.before?.overallScore ?? null;
    const after = o.after?.overallScore ?? null;
    if (r.trail.length === 0 && before != null) r.trail.push(before);
    if (after != null) r.trail.push(after);

    kindTally[o.kind ?? "backlog"] = (kindTally[o.kind ?? "backlog"] ?? 0) + 1;
    commits += o.commits ?? 0;
    closed += (o.closedFollowUpIds ?? []).length;
    for (const dv of o.deliverables ?? []) {
      deliverables++;
      stateTally[dv.kind] = (stateTally[dv.kind] ?? 0) + 1;
      // A craft rung names its axis in the covered id when the item came from the craft ladder.
    }
    r.runs.push({
      n: i + 1,
      kind: o.kind ?? "backlog",
      commits: o.commits ?? 0,
      closed: (o.closedFollowUpIds ?? []).length,
      delta: before != null && after != null ? after - before : null,
      // An empty batch is the loop running out of work — the signal the craft ladder exists to remove.
      dry: (o.deliverables ?? []).length === 0 && (o.commits ?? 0) === 0,
      // "N change(s) are still uncommitted in the worktree and the lane could not commit them" —
      // the lane did the work and lost it (a rejected commit hook, most often). Real money, no row.
      discarded: (() => {
        const m = (o.lane.log ?? []).map((l) => /(\d+) change\(s\) are still uncommitted/.exec(l)).find(Boolean);
        return m ? Number(m[1]) : 0;
      })(),
      headlines: (o.deliverables ?? []).map((x) => `${x.kind}: ${x.headline}`),
      moved: (o.diff?.dimensions ?? []).filter((x) => x.delta),
      // Movements are emitted ONLY for an attributable verdict, so their presence IS the verdict.
      claimed: (o.diff?.movements ?? []).length > 0,
    });
  }
}

console.log(`# ${files.length} runs · ${commits} commits · ${closed} follow-ups closed · ${deliverables} deliverables\n`);

console.log("LANE KINDS   ", Object.entries(kindTally).map(([k, v]) => `${k} ${v}`).join(" · ") || "—");
console.log("DELIVERABLES ", Object.entries(stateTally).map(([k, v]) => `${k} ${v}`).join(" · ") || "—");
for (const r of repos.values()) for (const run of r.runs) if (run.discarded > 0) { discardedLanes++; discardedChanges += run.discarded; }
console.log("LANE KINDS are labels: a mixed gap+craft batch is `backlog` by design — craft is not countable offline.");
if (discardedLanes > 0) console.log(`DISCARDED    ${discardedLanes} lane(s) did work and could not commit it — ${discardedChanges} change(s) thrown away`);

for (const [repo, r] of repos) {
  const dry = r.runs.filter((x) => x.dry).length;
  console.log(`\n## ${repo}  ${r.trail.join(" → ")}   (${dry} dry of ${r.runs.length})`);
  for (const run of r.runs) {
    const delta = run.delta == null ? "  —" : run.delta > 0 ? `+${run.delta}` : String(run.delta);
    const verdict = run.claimed ? "claimed" : run.commits > 0 ? "refused" : run.discarded > 0 ? "DISCARDED" : "no work";
    console.log(
      `  ${pad(`r${run.n}`, 4)} ${pad(run.kind, 10)} ${pad(`${run.commits}c/${run.closed}x`, 7)} ${pad(delta, 4)} ${pad(verdict, 8)} ${run.headlines[0] ?? (run.discarded > 0 ? `— ${run.discarded} change(s) discarded, not dry —` : run.dry ? "— nothing to dispatch —" : "")}`,
    );
    if (VERBOSE) for (const h of run.headlines.slice(1)) console.log(`${" ".repeat(38)}${h}`);
  }
}

// The two questions a campaign exists to answer.
const allRuns = [...repos.values()].flatMap((r) => r.runs);
const dryRuns = allRuns.filter((x) => x.dry).length;
const craftRuns = allRuns.filter((x) => x.kind === "craft").length;
console.log(
  `\n## verdict\n  work found in ${allRuns.length - dryRuns}/${allRuns.length} lanes` +
    ` · craft lanes ${craftRuns}` +
    ` · claimed movement in ${allRuns.filter((x) => x.claimed).length}`,
);
if (dryRuns > 0) console.log(`  ${dryRuns} lane(s) had nothing to dispatch — the ladder is not carrying yet.`);
