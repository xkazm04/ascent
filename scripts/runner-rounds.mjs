#!/usr/bin/env node
// RUNNER ROUNDS — start the STANDING RUNNER (continuous drive: the thing `/theater/<slug>` watches),
// let it run N rounds headless, print one reflection block per round, then stop it.
//
// WHY THIS EXISTS. `loop-campaign.mjs` drives plain loop runs and lands lane branches itself; it never
// exercises the runner (plan-first lanes, the per-repo `ascent/runner` branch, breakers, the craft
// ladder). The runner has no run cap by design, so "N rounds" is a driver concern: poll the drive,
// count runs that ended, and POST stop when the count is reached. A round = one run of the runner
// (every repo that may run, as parallel lanes).
//
//   node scripts/runner-rounds.mjs --org kiro --repos xkazm04/garden-vr,xkazm04/mage-arena,xkazm04/firetv \
//        --rounds 20 --base http://localhost:3100 [--model opus] [--ceiling 100] [--plan]
//
// Output: stdout + docs/harness/games/rounds-<stamp>.log (gitignored) and one JSON per round.

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
  rounds: Number(flag("rounds", "20")),
  model: flag("model", "opus"),
  effort: flag("effort", null),
  concurrency: Number(flag("concurrency", "3")),
  ceilingUsd: Number(flag("ceiling", "100")),
  maxCycles: Number(flag("max-cycles", "1")),
  batchSize: flag("batch-size", null),
  agentTimeoutMin: flag("agent-timeout-min", null),
  verifyTimeoutMin: flag("verify-timeout-min", null),
  rescan: flag("rescan", null),
  pollMs: Number(flag("poll-sec", "20")) * 1000,
  // Give up on a drive that makes no progress at all (no run ends, no pause is named) for this long.
  stallMs: Number(flag("stall-min", "120")) * 60_000,
  outDir: flag("out", path.join("docs", "harness", "games")),
  resume: flag("resume", null), // an existing drive id to keep counting rounds on
  plan: has("plan"),
};

if (CFG.repos.length === 0 && !CFG.resume) {
  console.error("usage: node scripts/runner-rounds.mjs --org <slug> --repos a/b,c/d --rounds 20 --base http://localhost:3100");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

async function api(pathname, init, tries = 8) {
  let lastErr = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(`${CFG.base}${pathname}`, init);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(`${res.status} ${body?.error ?? res.statusText}`);
      return body;
    } catch (err) {
      lastErr = err;
      // A 5xx is transient here too: `next dev` answers 500 while it recompiles a module mid-run.
      const transient = /ECONNREFUSED|fetch failed|socket hang up|ETIMEDOUT|^Error: 5\d\d /i.test(String(err));
      if (!transient || attempt === tries) break;
      await sleep(3000 * attempt);
    }
  }
  throw lastErr;
}
const post = (body) =>
  api("/api/org/local/drive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ org: CFG.org, ...body }) });

const short = (full) => full.split("/")[1] ?? full;
const delta = (n) => (n == null ? "—" : n > 0 ? `+${n}` : String(n));

function laneBlock(o) {
  const { lane, before, after, diff, commits, closedFollowUpIds = [], deliverables = [], kind } = o;
  const score = before && after ? `${before.overallScore} → ${after.overallScore}` : "not measured";
  const moved = (diff?.dimensions ?? []).filter((d) => d.delta).map((d) => `${d.id} ${delta(d.delta)}`).join(" · ");
  const out = [`  ${short(lane.repoFullName)} [${kind ?? "backlog"}] ${lane.phase} · ${score} · ${commits} commits · ${closedFollowUpIds.length} closed${moved ? ` · ${moved}` : ""}`];
  for (const d of deliverables) out.push(`      ${String(d.kind).padEnd(9)} ${d.headline}${d.dimId ? ` (${d.dimId})` : ""}`);
  if (lane.error) out.push(`      ERROR ${lane.error}`);
  const tail = (lane.log ?? []).slice(-1)[0];
  if (tail && !commits) out.push(`      log: ${tail}`);
  return out.join("\n");
}

async function main() {
  fs.mkdirSync(CFG.outDir, { recursive: true });
  const tag = stamp().replace(/:/g, "-");
  const logPath = path.join(CFG.outDir, `rounds-${tag}.log`);
  const say = (t) => { console.log(t); fs.appendFileSync(logPath, `${t}\n`); };

  say(`# runner rounds ${stamp()} org=${CFG.org} repos=${CFG.repos.join(",")} rounds=${CFG.rounds} model=${CFG.model} ceiling=$${CFG.ceilingUsd}`);
  if (CFG.plan) return say("(--plan: nothing started)");

  let drive;
  if (CFG.resume) {
    drive = (await api(`/api/org/local/drive?org=${CFG.org}`)).drives.find((d) => d.id === CFG.resume);
    if (!drive) throw new Error(`no drive ${CFG.resume}`);
  } else {
    const dials = {};
    if (CFG.batchSize) dials.batchSize = Number(CFG.batchSize);
    if (CFG.agentTimeoutMin) dials.agentTimeoutMs = Number(CFG.agentTimeoutMin) * 60_000;
    if (CFG.verifyTimeoutMin) dials.verifyTimeoutMs = Number(CFG.verifyTimeoutMin) * 60_000;
    if (CFG.rescan) dials.rescanCadence = CFG.rescan;
    dials.verifyMode = "on";
    drive = (await post({
      action: "start", mode: "continuous", repos: CFG.repos, concurrency: CFG.concurrency, maxCycles: CFG.maxCycles,
      model: CFG.model, ...(CFG.effort ? { effort: CFG.effort } : {}), spendCeilingUsd: CFG.ceilingUsd, dials,
    })).drive;
  }
  say(`drive ${drive.id} phase=${drive.phase}`);

  const seen = new Set();
  let lastProgress = Date.now();
  let lastEventCount = 0;
  for (;;) {
    await sleep(CFG.pollMs);
    const cur = (await api(`/api/org/local/drive?org=${CFG.org}`)).drives.find((d) => d.id === drive.id);
    if (!cur) throw new Error("drive vanished");
    for (const ev of (cur.events ?? []).slice(lastEventCount)) say(`  event ${ev.at} ${ev.event}${ev.repo ? ` ${short(ev.repo)}` : ""}${ev.reason ? ` [${ev.reason}]` : ""} ${ev.note}`);
    lastEventCount = (cur.events ?? []).length;
    for (const r of cur.runs.filter((x) => x.endedAt && !seen.has(x.runId))) {
      seen.add(r.runId);
      lastProgress = Date.now();
      const n = seen.size;
      let detail = null;
      try { detail = await api(`/api/org/loop/${r.runId}?org=${CFG.org}`); } catch (e) { say(`  (detail read failed: ${e.message})`); }
      fs.writeFileSync(path.join(CFG.outDir, `round-${String(n).padStart(2, "0")}-${r.runId}.json`), JSON.stringify({ record: r, detail }, null, 2));
      const outcomes = detail?.outcomes ?? [];
      say(`ROUND ${n}/${CFG.rounds} · ${r.runId} · ${r.verifiedCloses ?? "?"} verified closes · ${r.landed ?? "?"} landed · debt ${r.debtBefore}→${r.debtAfter ?? "?"}${r.note ? ` · ${r.note}` : ""}`);
      for (const o of outcomes) say(laneBlock(o));
    }
    if (seen.size >= CFG.rounds) { say(`reached ${CFG.rounds} rounds — stopping the runner`); break; }
    if (!["running", "paused", "idle"].includes(cur.phase)) { say(`drive ended: phase=${cur.phase} ${cur.error ?? ""}`); break; }
    if (Date.now() - lastProgress > CFG.stallMs) { say(`STALL: no round ended for ${CFG.stallMs / 60000} min (phase=${cur.phase}, paused=${cur.pausedReason ?? "-"})`); break; }
  }
  try { await post({ action: "stop", id: drive.id }); say("stop requested"); } catch (e) { say(`stop failed: ${e.message}`); }
}

main().catch((e) => { console.error(e); process.exit(1); });
