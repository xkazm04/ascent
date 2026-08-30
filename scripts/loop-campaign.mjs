#!/usr/bin/env node
// LOOP CAMPAIGN — drive N sequential loop runs against a running dev server and print one compact
// reflection block per run.
//
// WHY THIS EXISTS. The improvement loop has no CLI: `startLoopRun` reaches the db barrel, which is
// `import "server-only"`, so it cannot be required from a plain node process. HTTP is the only path
// in, and on a self-hosted box with ASCENT_AUTH_BYPASS set it is an unauthenticated owner path. The
// drive (`/api/org/local/drive`) is the wrong tool for a deliberate campaign: DRIVE_MAX_RUNS_CAP is
// 8 and its `dry` stop halts the chain the first time a run fails to move debt — which is exactly
// the run a campaign wants to look at rather than stop on.
//
// SEQUENCING. `startLoopRun` refuses a second concurrent run per org, so runs are strictly serial.
// Repos inside ONE run are parallel lanes, so `--repos a,b --runs 20` yields 20 runs and 20 lane
// outcomes per repo — half the wall-clock of 40 single-repo runs for the same evidence.
//
// Output: a per-run JSON artifact plus an appended text log under docs/harness/ (gitignored).
//
//   node scripts/loop-campaign.mjs --org kiro --repos xkazm04/kp,xkazm04/systedo-case --runs 20
//   node scripts/loop-campaign.mjs --org kiro --repos xkazm04/kp --runs 1 --plan   # print, don't run

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const CFG = {
  base: flag("base", "http://localhost:3000"),
  org: flag("org", "kiro"),
  repos: (flag("repos", "") || "").split(",").map((s) => s.trim()).filter(Boolean),
  runs: Number(flag("runs", "20")),
  model: flag("model", "opus"),
  effort: flag("effort", null),
  maxCycles: Number(flag("max-cycles", "1")),
  concurrency: Number(flag("concurrency", "2")),
  // A run is long: an agent session alone is capped at 20 minutes per lane, and a rescan follows it.
  runTimeoutMs: Number(flag("run-timeout-min", "75")) * 60_000,
  pollMs: Number(flag("poll-sec", "15")) * 1000,
  // 0 = never stop early. Otherwise: stop after this many consecutive runs that committed nothing
  // AND closed nothing across every lane — the honest "the loop has nothing left to give" signal.
  stopAfterDry: Number(flag("stop-after-dry", "0")),
  outDir: flag("out", path.join("docs", "harness", "campaign")),
  plan: has("plan"),
  // `owner/name=C:/path,…` — LAND each lane's branch into that checkout's current branch after the
  // run. Without this a campaign is Sisyphean: the loop commits to a throwaway `ascent/loop-*`
  // branch and never merges it, so every run starts from the same HEAD, rediscovers the same gap and
  // writes the same file again (observed: three runs, three branches, one identical
  // `.github/workflows/ai-review.yml`). Landing is what makes run N+1 start where run N finished.
  // Campaign-only on purpose — the product's own landing decision belongs to the sheet's review gate.
  paths: Object.fromEntries(
    (flag("land", "") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((pair) => {
        const at = pair.indexOf("=");
        return [pair.slice(0, at), pair.slice(at + 1)];
      }),
  ),
};

if (CFG.repos.length === 0) {
  console.error("usage: node scripts/loop-campaign.mjs --org <slug> --repos <owner/name,...> [--runs 20] [--model opus] [--plan]");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

/** fetch + JSON, tolerant of a dev-server restart (the embedded PGlite lives in that process). */
async function api(pathname, init, tries = 5) {
  let lastErr = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(`${CFG.base}${pathname}`, init);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(`${res.status} ${body?.error ?? res.statusText}`);
      return body;
    } catch (err) {
      lastErr = err;
      // ECONNREFUSED / socket hangup while `next dev` recompiles or restarts — wait and retry.
      const transient = /ECONNREFUSED|fetch failed|socket hang up|ETIMEDOUT/i.test(String(err));
      if (!transient || attempt === tries) break;
      await sleep(3000 * attempt);
    }
  }
  throw lastErr;
}

const fmtDelta = (n) => (n == null ? "—" : n > 0 ? `+${n}` : String(n));
const shortRepo = (full) => full.split("/")[1] ?? full;

/** One lane, as the reflection step wants to read it. */
function laneBlock(outcome) {
  const { lane, before, after, diff, commits, closedFollowUpIds = [], deliverables = [], kind } = outcome;
  const lines = [];
  const score = before && after ? `${before.overallScore} → ${after.overallScore}` : "not measured";
  const moved = (diff?.dimensions ?? [])
    .filter((d) => d.delta != null && d.delta !== 0)
    .map((d) => `${d.id} ${fmtDelta(d.delta)}`)
    .join(" · ");
  lines.push(
    `  ${shortRepo(lane.repoFullName)} [${kind ?? "backlog"}] ${lane.phase} · ${score}` +
      ` · ${commits} commits · ${closedFollowUpIds.length} closed${moved ? ` · ${moved}` : ""}`,
  );
  for (const d of deliverables) lines.push(`      ${d.kind.padEnd(9)} ${d.headline}${d.dimId ? ` (${d.dimId})` : ""}`);
  if (deliverables.length === 0) lines.push("      (no deliverables recorded)");
  for (const m of diff?.movements ?? []) lines.push(`      · ${m}`);
  if (lane.error) lines.push(`      ERROR ${lane.error}`);
  const tail = (lane.log ?? []).slice(-1)[0];
  if (tail && commits === 0) lines.push(`      log: ${tail}`);
  return lines.join("\n");
}

function runBlock(index, detail) {
  const { run, outcomes = [], economics } = detail;
  const commits = outcomes.reduce((n, o) => n + (o.commits ?? 0), 0);
  const closed = outcomes.reduce((n, o) => n + (o.closedFollowUpIds?.length ?? 0), 0);
  const head = `RUN ${index}/${CFG.runs} · ${run.id} · ${run.phase} · ${run.model ?? "?"}${run.effort ? `/${run.effort}` : ""} · ${commits} commits · ${closed} closed`;
  const econ = economics
    ? `  cost $${((economics.costMicros ?? 0) / 1e6).toFixed(2)} · verified points ${economics.verifiedPoints ?? "—"}`
    : null;
  return [head, ...outcomes.map(laneBlock), econ].filter(Boolean).join("\n");
}

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/**
 * Merge each lane's branch into its checkout's current branch.
 *
 * `--ff-only` by choice: a lane branch is cut from the checkout's own HEAD moments earlier, so a
 * clean run IS a fast-forward. If it is not — the branch diverged, or the merge would overwrite a
 * file the owner is editing — git refuses and we say so rather than resolving someone's tree for
 * them. That refusal is also the honest signal that two runs collided.
 */
function landRun(detail, say) {
  for (const o of detail.outcomes ?? []) {
    const repo = o.lane.repoFullName;
    const dir = CFG.paths[repo];
    const branch = o.lane.branch;
    if (!dir || !branch || (o.commits ?? 0) === 0) continue;
    try {
      const before = git(dir, "rev-parse", "--short", "HEAD");
      git(dir, "merge", "--ff-only", branch);
      const after = git(dir, "rev-parse", "--short", "HEAD");
      say(`  landed ${shortRepo(repo)} ${branch} → ${git(dir, "rev-parse", "--abbrev-ref", "HEAD")} (${before}..${after})`);
    } catch (err) {
      const msg = String(err?.stderr ?? err?.message ?? err).split("\n")[0];
      say(`  LAND FAILED ${shortRepo(repo)} ${branch}: ${msg}`);
    }
  }
}

/**
 * Land every `ascent/loop-*` branch that is still a fast-forward, oldest first.
 *
 * Idempotent by construction: once a branch is merged the next `--ff-only` on it is a no-op, and a
 * branch that has been superseded simply refuses and is skipped. This is what makes an interrupted
 * campaign resumable — the work its last run committed is merged before the next one is dispatched.
 */
function landPending(say) {
  for (const [repo, dir] of Object.entries(CFG.paths)) {
    let landed = 0;
    let branches = [];
    try {
      branches = git(dir, "branch", "--list", "ascent/loop-*", "--format=%(refname:short)").split("\n").filter(Boolean).sort();
    } catch {
      say(`  (no git checkout at ${dir})`);
      continue;
    }
    for (const branch of branches) {
      try {
        if (git(dir, "rev-list", "--count", `HEAD..${branch}`) === "0") continue;
        git(dir, "merge", "--ff-only", branch);
        landed++;
      } catch {
        /* superseded or would touch a modified file — leave it alone and say so in the total */
      }
    }
    if (landed > 0) say(`  landed ${landed} pending branch(es) into ${shortRepo(repo)} @ ${git(dir, "rev-parse", "--short", "HEAD")}`);
  }
}

async function waitForIdle(deadline) {
  for (;;) {
    if (Date.now() > deadline) return { timedOut: true, active: null };
    const status = await api(`/api/org/loop?org=${encodeURIComponent(CFG.org)}`);
    if (!status.active) return { timedOut: false, active: null };
    await sleep(CFG.pollMs);
  }
}

async function main() {
  fs.mkdirSync(CFG.outDir, { recursive: true });
  const logPath = path.join(CFG.outDir, `campaign-${stamp().replace(/[:]/g, "-")}.log`);
  const say = (text) => {
    console.log(text);
    fs.appendFileSync(logPath, `${text}\n`);
  };

  say(`# loop campaign ${stamp()}`);
  say(`org=${CFG.org} repos=${CFG.repos.join(",")} runs=${CFG.runs} model=${CFG.model} maxCycles=${CFG.maxCycles} concurrency=${CFG.concurrency}`);
  if (CFG.plan) {
    say("(--plan: nothing dispatched)");
    return;
  }

  const status = await api(`/api/org/loop?org=${encodeURIComponent(CFG.org)}`);
  if (!status.enabled) throw new Error("The loop is not enabled on this deployment (self-hosted + ASCENT_AUTOPILOT).");
  // A run already in flight is NOT an error: a campaign restarted after an interruption should queue
  // behind the run it left behind rather than refuse to start (one run per org is the engine's rule).
  if (status.active) {
    say(`waiting for the in-flight run ${status.active.id} to finish…`);
    const { timedOut } = await waitForIdle(Date.now() + CFG.runTimeoutMs);
    if (timedOut) throw new Error("The in-flight run never finished — stop it before starting a campaign.");
  }
  // Land anything an earlier, interrupted campaign left unmerged, oldest first, so run 1 of this
  // campaign starts from the true accumulated state rather than re-doing work already committed.
  if (Object.keys(CFG.paths).length > 0) landPending(say);

  let dryStreak = 0;
  for (let i = 1; i <= CFG.runs; i++) {
    const started = Date.now();
    let detail = null;
    try {
      const { run } = await api("/api/org/loop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "start",
          org: CFG.org,
          repos: CFG.repos,
          maxCycles: CFG.maxCycles,
          concurrency: CFG.concurrency,
          model: CFG.model,
          ...(CFG.effort ? { effort: CFG.effort } : {}),
        }),
      });
      const { timedOut } = await waitForIdle(started + CFG.runTimeoutMs);
      if (timedOut) say(`RUN ${i}: TIMED OUT after ${Math.round(CFG.runTimeoutMs / 60000)} min — leaving it and moving on`);
      detail = await api(`/api/org/loop/${encodeURIComponent(run.id)}?org=${encodeURIComponent(CFG.org)}`);
    } catch (err) {
      say(`RUN ${i}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
      await sleep(5000);
      continue;
    }

    fs.writeFileSync(path.join(CFG.outDir, `run-${String(i).padStart(2, "0")}-${detail.run.id}.json`), JSON.stringify(detail, null, 2));
    say("");
    say(runBlock(i, detail));
    if (Object.keys(CFG.paths).length > 0) landRun(detail, say);
    say(`  (${Math.round((Date.now() - started) / 60000)} min)`);

    const moved = (detail.outcomes ?? []).some((o) => (o.commits ?? 0) > 0 || (o.closedFollowUpIds?.length ?? 0) > 0);
    dryStreak = moved ? 0 : dryStreak + 1;
    if (CFG.stopAfterDry > 0 && dryStreak >= CFG.stopAfterDry) {
      say(`\nSTOPPING: ${dryStreak} consecutive runs moved nothing.`);
      break;
    }
  }
  say(`\n# done ${stamp()} · artifacts in ${CFG.outDir}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
