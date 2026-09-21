#!/usr/bin/env node
// ARMS — drive and read a transport-armed loop run (a "theater cycle") from a terminal, with no UI.
//
// WHY THIS EXISTS. The cockpit's Arms panel is the only way to arm a comparison run, and a browser
// is the wrong instrument for a measurement that takes hours and whose whole output is a table. This
// is the same control surface the panel drives — the same validator, the same probe, the same route —
// reachable from a session that can then read the numbers back and act on them.
//
// WHY HTTP AND NOT A DIRECT IMPORT. `startLoopRun` reaches the db barrel, which is `server-only`, and
// in local dev the database is an embedded PGlite living INSIDE the dev server's process. A second
// node process opening the same data dir fights it for a single-writer file, and it would keep its
// own live-run registry besides — so the UI's next poll would mark this script's run stale. HTTP is
// not a compromise here; it is the only door that leads to the same state the UI sees.
//
// AUTH. On a self-hosted box with ASCENT_AUTH_BYPASS=1 these routes are an unauthenticated owner
// path, which is why no credential appears below. None of the routes used here carries a same-origin
// guard (the ones that do — loop/plans/[id], loop/lessons, loop/[id]/pr — are not used). With the
// bypass off there is NO token path for the loop routes, and this script cannot work; say so rather
// than inventing a credential.
//
//   node scripts/arms.mjs probe  --org kiro --arms "claude:sonnet,claude:sonnet>claude:qwen3.8:27b-64k"
//   node scripts/arms.mjs propose --org kiro --repos xkazm04/kp
//   node scripts/arms.mjs run    --org kiro --repos xkazm04/kp --arms "..." --batch-size 2
//   node scripts/arms.mjs report --org kiro --id <runId>
//   node scripts/arms.mjs watch  --org kiro
//
// ARM SPEC GRAMMAR (one comma-separated entry per arm):
//
//   [<id>=] [<planTransport>:<planModel> >] <execTransport>:<execModel>
//
//   claude:sonnet                               Claude plans and executes on the seat
//   claude:sonnet>claude:qwen3.8:27b-64k        Claude plans, the local model executes
//   local=claude:qwen3.8:27b-64k                the local model does both (below the floor)
//   pi:qwen3.8:27b-64k                          the Pi transport
//
// The transport/model split is on the FIRST colon, because a model id contains colons of its own.

import fs from "node:fs";
import path from "node:path";
import { formatComparison, formatLanes, formatProbe } from "./arms/format.mjs";

const argv = process.argv.slice(2);
const command = argv[0] ?? "";
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const CFG = {
  base: flag("base", "http://localhost:3000"),
  org: flag("org", process.env.ASCENT_LOCAL_ORG || "kiro"),
  repos: (flag("repos", "") || "").split(",").map((s) => s.trim()).filter(Boolean),
  arms: flag("arms", ""),
  id: flag("id", null),
  batchSize: flag("batch-size", null),
  maxCycles: flag("max-cycles", "1"),
  delivery: flag("delivery", null),
  verifyMode: flag("verify", null),
  agentTimeoutMin: flag("agent-timeout-min", null),
  runTimeoutMs: Number(flag("run-timeout-min", "180")) * 60_000,
  pollMs: Number(flag("poll-sec", "20")) * 1000,
  outDir: flag("out", path.join("docs", "harness", "arms")),
  plan: has("plan"),
  json: has("json"),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

/** fetch + JSON, tolerant of a dev-server recompile (the embedded PGlite lives in that process). */
async function api(pathname, init, tries = 5) {
  let lastErr = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(`${CFG.base}${pathname}`, init);
      const text = await res.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        // A dev-server error page is HTML, not JSON. Say that, rather than "unexpected token <".
        if (!res.ok) throw new Error(`${res.status} ${res.statusText} — the server returned a page, not JSON. Is the dev server healthy?`);
      }
      if (!res.ok) throw new Error(`${res.status} ${body?.error ?? res.statusText}`);
      return body;
    } catch (err) {
      lastErr = err;
      const transient = /ECONNREFUSED|fetch failed|socket hang up|ETIMEDOUT/i.test(String(err));
      if (!transient || attempt === tries) break;
      await sleep(3000 * attempt);
    }
  }
  throw lastErr;
}

const post = (pathname, body) =>
  api(pathname, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// ── arm parsing ──────────────────────────────────────────────────────────────────────────────────

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "arm";

/** `transport:model` → `{transport, model}`, split on the FIRST colon (a model id has its own). */
function half(text, what) {
  const at = text.indexOf(":");
  if (at <= 0 || at === text.length - 1) {
    throw new Error(`Cannot read the ${what} half of "${text}" — expected <transport>:<model>, e.g. claude:sonnet.`);
  }
  return { transport: text.slice(0, at).trim(), model: text.slice(at + 1).trim() };
}

/** The closed Claude alias list, mirrored ONLY to decide whether an arm is below the floor. The
 *  server re-derives this itself; getting it wrong here costs a label, never a routing decision. */
const CLAUDE_ALIASES = new Set(["haiku", "sonnet", "opus"]);

export function parseArms(spec) {
  const out = [];
  for (const raw of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    let rest = raw;
    let id = null;
    const eq = rest.indexOf("=");
    // An `=` before any `:` is an explicit id, not part of a model name.
    if (eq > 0 && (rest.indexOf(":") === -1 || eq < rest.indexOf(":"))) {
      id = slug(rest.slice(0, eq));
      rest = rest.slice(eq + 1).trim();
    }
    const gt = rest.indexOf(">");
    const exec = half(gt >= 0 ? rest.slice(gt + 1).trim() : rest, "execute");
    const plan = gt >= 0 ? half(rest.slice(0, gt).trim(), "plan") : null;
    const planning = plan ?? exec;
    // BELOW THE FLOOR is judged on the PLANNING half, because that is where the floor was recorded:
    // the plan contract fails closed, so an unreadable plan parks the whole batch rather than doing
    // bad work. A Claude-plans / local-executes arm is therefore NOT below it.
    const belowFloor = !(planning.transport === "claude" && CLAUDE_ALIASES.has(planning.model));
    out.push({
      id: id ?? slug(plan ? `${plan.transport}-${plan.model}-x-${exec.transport}-${exec.model}` : `${exec.transport}-${exec.model}`),
      transport: exec.transport,
      model: exec.model,
      ...(plan ? { plan } : {}),
      ...(belowFloor ? { belowFloor: true } : {}),
    });
  }
  const ids = new Set(out.map((a) => a.id));
  if (ids.size !== out.length) throw new Error("Two arms resolved to the same id — give one an explicit `id=` prefix.");
  return out;
}

// ── commands ─────────────────────────────────────────────────────────────────────────────────────

async function cmdProbe(arms) {
  const policy = arms.length > 1 ? "compare" : "single";
  const reply = await post("/api/org/local/probe", { org: CFG.org, arms, armPolicy: policy });
  if (CFG.json) return console.log(JSON.stringify(reply, null, 2));
  console.log(formatProbe(reply));
  return reply;
}

async function cmdPropose() {
  const qs = new URLSearchParams({ org: CFG.org, repos: CFG.repos.join(",") });
  if (CFG.batchSize) qs.set("batchSize", CFG.batchSize);
  const body = await api(`/api/org/loop/propose?${qs}`);
  if (CFG.json) return console.log(JSON.stringify(body, null, 2));
  const proposals = body.proposals ?? [];
  for (const p of proposals) {
    console.log(`\n${p.repo} — ${p.items?.length ?? 0} item(s) would be armed${p.kind ? ` [${p.kind}]` : ""}`);
    for (const it of p.items ?? []) {
      console.log(`  ${(it.dimId ?? "—").padEnd(4)} ${(it.impact ?? "?").padEnd(6)} ${(it.effort ?? "?").padEnd(6)} ${it.title ?? it.id}`);
    }
    if (!p.items?.length) console.log("  (nothing open — a run would arm a foundation lane instead)");
  }
  if (!proposals.length) console.log("no proposals returned for these repos");
  // The ids are what `--batch` would pin, so print them when asked; a comparison wants every arm
  // working the SAME curated batch, which is what `curated: true` on the start body preserves.
  return body;
}

async function cmdRun(arms) {
  const policy = arms.length > 1 ? "compare" : "single";
  // The engine refuses `concurrency × arms > 4`. Compute it here so a typo is a local message rather
  // than a 409 after the round trip. Also capped by the repo count: a lane exists per (repo, arm), so
  // asking for more slots than there are repos reserves capacity nothing can use.
  const concurrency = Math.max(1, Math.min(CFG.repos.length, Math.floor(4 / arms.length)));
  const body = {
    action: "start",
    org: CFG.org,
    repos: CFG.repos,
    arms,
    armPolicy: policy,
    concurrency,
    maxCycles: Number(CFG.maxCycles),
    curated: true,
    ...(CFG.batchSize ? { batchSize: Number(CFG.batchSize) } : {}),
    ...(CFG.delivery ? { delivery: CFG.delivery } : {}),
    ...(CFG.verifyMode ? { verifyMode: CFG.verifyMode } : {}),
    ...(CFG.agentTimeoutMin ? { agentTimeoutMs: Number(CFG.agentTimeoutMin) * 60_000 } : {}),
  };

  console.log(`arms (${policy}, concurrency ${concurrency}, ${arms.length * concurrency} lanes in flight):`);
  for (const a of arms) {
    const p = a.plan ? `${a.plan.transport}:${a.plan.model}` : `${a.transport}:${a.model}`;
    console.log(`  ${a.id.padEnd(28)} plan ${p.padEnd(28)} exec ${a.transport}:${a.model}${a.belowFloor ? "   [below floor]" : ""}`);
  }

  // PREFLIGHT, always — the same refusal the cockpit shows. A comparison run costs hours, and the
  // two failures it catches (a truncating context, a server below the cache fix) produce a RESULT
  // rather than an error, which is the most expensive wrong answer available here.
  console.log("\npreflight:");
  const probe = await post("/api/org/local/probe", { org: CFG.org, arms, armPolicy: policy });
  console.log(formatProbe(probe));
  if (probe.refusal) {
    console.error("\nREFUSED — not arming. Fix the above, or re-run with the arm removed.");
    process.exit(3);
  }

  if (CFG.plan) {
    console.log("\n--plan given; not arming. Request body:\n" + JSON.stringify(body, null, 2));
    return null;
  }

  const started = await post("/api/org/loop", body);
  const runId = started.run.id;
  console.log(`\nrun ${runId} armed at ${stamp()}`);
  return pollRun(runId);
}

/** Poll until the run leaves the active slot, printing each lane's phase as it moves. */
async function pollRun(runId) {
  const t0 = Date.now();
  const seen = new Map();
  for (;;) {
    if (Date.now() - t0 > CFG.runTimeoutMs) {
      console.error(`\ntimeout after ${Math.round(CFG.runTimeoutMs / 60000)} min — stopping the run`);
      await post("/api/org/loop", { action: "stop", org: CFG.org, id: runId }).catch(() => null);
      break;
    }
    const status = await api(`/api/org/loop?org=${encodeURIComponent(CFG.org)}`);
    const detail = await api(`/api/org/loop/${runId}?org=${encodeURIComponent(CFG.org)}`);
    for (const lane of detail.lanes ?? []) {
      const key = `${lane.id}`;
      const now = `${lane.phase}/${lane.stage ?? ""}/${lane.commits ?? 0}`;
      if (seen.get(key) !== now) {
        seen.set(key, now);
        const arm = lane.armId ? ` [${lane.armId}]` : "";
        const where = lane.transport ? ` via ${lane.transport}:${lane.model ?? "?"}` : "";
        console.log(
          `  ${stamp()} ${lane.repoFullName}${arm}${where} — ${lane.phase}${lane.stage ? ` (${lane.stage})` : ""}` +
            `${lane.commits ? ` · ${lane.commits} commits` : ""}${lane.voidReason ? " · VOID" : ""}`,
        );
      }
    }
    if (!status.active || status.active.id !== runId) {
      console.log(`\nrun settled at ${stamp()}`);
      return report(runId);
    }
    await sleep(CFG.pollMs);
  }
  return report(runId);
}

async function report(runId) {
  const detail = await api(`/api/org/loop/${runId}?org=${encodeURIComponent(CFG.org)}`);
  if (CFG.json) {
    console.log(JSON.stringify(detail, null, 2));
  } else {
    console.log(formatLanes(detail));
    console.log(formatComparison(detail.comparison));
  }
  fs.mkdirSync(CFG.outDir, { recursive: true });
  const file = path.join(CFG.outDir, `${runId}.json`);
  fs.writeFileSync(file, JSON.stringify(detail, null, 2));
  console.log(`\nartifact: ${file}`);
  return detail;
}

async function cmdWatch() {
  console.log(`watching ${CFG.org} — ctrl-c to stop`);
  const seen = new Map();
  for (;;) {
    const { pulse } = await api(`/api/org/loop/pulse?org=${encodeURIComponent(CFG.org)}`);
    if (!pulse) {
      console.log(`${stamp()} no pulse (no active run)`);
    } else {
      for (const lane of pulse.lanes ?? []) {
        const key = lane.laneId;
        const now = `${lane.phase}|${lane.diffStat?.files ?? 0}|${lane.turns ?? 0}`;
        if (seen.get(key) !== now) {
          seen.set(key, now);
          const arm = lane.arm ? ` [${lane.arm.label ?? lane.arm.id}]` : "";
          const files = lane.filesEdited?.length ? ` · ${lane.filesEdited.length} edited` : "";
          console.log(`${stamp()} ${lane.repo}${arm} — ${lane.phase}${files}${lane.turns ? ` · ${lane.turns} turns` : ""}`);
        }
      }
    }
    await sleep(CFG.pollMs);
  }
}

// ── entry ────────────────────────────────────────────────────────────────────────────────────────

const USAGE = `usage:
  node scripts/arms.mjs probe   --org <slug> --arms "<spec>[,<spec>...]"
  node scripts/arms.mjs propose --org <slug> --repos <owner/name,...> [--batch-size n]
  node scripts/arms.mjs run     --org <slug> --repos <owner/name,...> --arms "<spec>,..." [--batch-size n]
                                [--max-cycles 1] [--delivery branch|land|pr] [--verify on|off] [--plan]
  node scripts/arms.mjs report  --org <slug> --id <runId>
  node scripts/arms.mjs watch   --org <slug> [--poll-sec 20]

arm spec: [id=][planTransport:planModel>]execTransport:execModel
  claude:sonnet                          seat plans and executes
  claude:sonnet>claude:qwen3.8:27b-64k   Claude plans, the local model executes
  local=claude:qwen3.8:27b-64k           local does both (below the recorded floor)
  pi:qwen3.8:27b-64k                     the Pi transport`;

try {
  if (command === "probe") await cmdProbe(parseArms(CFG.arms));
  else if (command === "propose") await cmdPropose();
  else if (command === "run") await cmdRun(parseArms(CFG.arms));
  else if (command === "report") await report(CFG.id);
  else if (command === "watch") await cmdWatch();
  else {
    console.error(USAGE);
    process.exit(2);
  }
} catch (err) {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
