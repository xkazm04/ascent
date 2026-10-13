#!/usr/bin/env node
// /infinite - the block driver for Ascent's endless improvement loop, for ANY paired project.
// Generalised from the 2026-10-09..12 weekend rig (ascent-cycles/cycle.mjs, Personas-only).
//
//   node infinite.mjs rig --wt <ascent worktree> [--port 3200] [--org kiro]   record the rig once (rig.json)
//   node infinite.mjs projects                                             known projects + overall/level, as JSON
//   node infinite.mjs init --project owner/name [--path C:/abs] [--base main]  pair (if needed), state dir, baseline
//   node infinite.mjs block --project owner/name [--rounds 10] [--model opus] [--effort <e>] [--ceiling 0]
//                        [--label "..."] [--backoff-wait-min 0] [--stall-min 120] [--max-hours 12]
//                        [--agent-timeout-min N] [--verify-timeout-min 3] [--smoke]
//   node infinite.mjs metrics <blockDir> --project owner/name
//   node infinite.mjs trend --project owner/name
//   node infinite.mjs ledger <blockDir> --project owner/name
//   node infinite.mjs server status|start|stop|restart
//   node infinite.mjs status [--project owner/name]
//   node infinite.mjs sweep <blockDir>
//
// `--base` is the target's git branch (init only). The runner server's URL is `--server-url`, default
// http://localhost:<port>; the two shared one flag until 2026-10-12, so `init --base master` asked the
// server at the URL "master".
//
// State lives outside every repo: $INFINITE_HOME (default ~/.personas/infinite)/
//   rig.json                       { wt, port, org } - the Ascent worktree that serves the runner
//   next-dev.pid                   the server this script started (it never kills anything else)
//   projects/<owner__name>/project.json, LEDGER.md, blocks/<NNN>/   one ledger per project
//
// A BLOCK = one `scripts/runner-rounds.mjs` invocation against the worktree's `next dev`. It RETURNS
// EARLY instead of hanging when the runner stops being able to make a round (dry-backoff, a breaker,
// a repo pause, --max-hours). The dry-backoff pause (1 h / 4 h / 12 h) is PER DRIVE, so the loop does not
// wait it out: the skill reflects, pivots and starts the next block, which is a new drive.
//
// Exit codes: 0 all rounds done | 10 returned early on dry-backoff | 11 paused by a breaker/repo pause
//             | 12 stall, drive ended, or max-hours | 2 usage | 3 preflight failed | 4 another drive live
//             | 1 unexpected error.
//
// Read-only toward the target project: it only reads `refs/heads/ascent/runner` with git. The runner is
// the only writer of that ref, and nothing merges back without the operator. Node 24 built-ins only.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";

const argOf = (name) => { const a = process.argv; const i = a.indexOf(`--${name}`); return i >= 0 && a[i + 1] != null && !a[i + 1].startsWith("--") ? a[i + 1] : null; };
const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
const HOME = process.env.INFINITE_HOME || path.join(os.homedir(), ".personas", "infinite");
const RIG_FILE = path.join(HOME, "rig.json");
const RIG = readJson(RIG_FILE) ?? {};
const WT = path.resolve(argOf("wt") ?? RIG.wt ?? path.join(HOME, "ascent-wt"));
const ORG = argOf("org") ?? RIG.org ?? "kiro";
const PORT = Number(argOf("port") ?? RIG.port ?? 3200);
const PID_FILE = path.join(HOME, "next-dev.pid");
const RUNNER_REF = "refs/heads/ascent/runner";
const REPO = argOf("project");
const SLUG = REPO ? REPO.replace(/[^A-Za-z0-9._-]+/g, "__") : null;
const PDIR = SLUG ? path.join(HOME, "projects", SLUG) : null;
const PROJECT_CFG = PDIR ? readJson(path.join(PDIR, "project.json")) ?? {} : {};
const TARGET = PROJECT_CFG.path ?? null;
const BLOCKS = PDIR ? path.join(PDIR, "blocks") : null;
const LEDGER = PDIR ? path.join(PDIR, "LEDGER.md") : null;
function requireProject() {
  if (!REPO) throw Object.assign(new Error("--project owner/name is required"), { exitCode: 2 });
  if (!TARGET) throw Object.assign(new Error(`${REPO} has no project.json yet: run  node infinite.mjs init --project ${REPO}`), { exitCode: 3 });
}
const BASE_BRANCH = PROJECT_CFG.base ?? "master";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] != null && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);
const BASE = flag("server-url", `http://localhost:${PORT}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = () => new Date().toISOString();
const pad3 = (n) => String(n).padStart(3, "0");
const round2 = (n) => (n == null || Number.isNaN(n) ? null : Math.round(n * 100) / 100);
const mins = (a, b) => (a && b ? round2((Date.parse(b) - Date.parse(a)) / 60000) : null);

// ── HTTP ─────────────────────────────────────────────────────────────────────────────────────────
async function api(pathname, init = {}, tries = 6) {
  let last = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(`${BASE}${pathname}`, { ...init, signal: AbortSignal.timeout(120_000) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(`${res.status} ${body?.error ?? res.statusText}`);
      return body;
    } catch (err) {
      last = err;
      // `next dev` answers 500 while it recompiles; a refused socket is a restart in progress.
      const transient = /ECONNREFUSED|fetch failed|socket hang up|ETIMEDOUT|aborted|timeout|^Error: 5\d\d /i.test(String(err));
      if (!transient || attempt === tries) break;
      await sleep(3000 * attempt);
    }
  }
  throw last;
}
const postDrive = (body) =>
  api("/api/org/local/drive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ org: ORG, ...body }) });
const listDrives = async () => (await api(`/api/org/local/drive?org=${ORG}`)).drives ?? [];
const LIVE_PHASES = ["running", "paused", "idle"];

// ── processes (Windows) ──────────────────────────────────────────────────────────────────────────
function ps(command) {
  try {
    return execFileSync("powershell", ["-NoProfile", "-Command", command], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}
const cmdlineOf = (pid) => ps(`(Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}').CommandLine`);
const childrenOf = (pid) =>
  ps(`Get-CimInstance Win32_Process -Filter 'ParentProcessId=${Number(pid)}' | ForEach-Object { \"$($_.ProcessId)\`t$($_.CommandLine)\" }`)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => ({ pid: Number(l.split("\t")[0]), cmd: l.split("\t").slice(1).join("\t") }));
const listenerPid = () => Number(ps(`(Get-NetTCPConnection -State Listen -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`)) || null;
const readPid = () => (fs.existsSync(PID_FILE) ? Number(fs.readFileSync(PID_FILE, "utf8").trim()) || null : null);

// ── leak sweep: belt and braces for the guard's tree kill (experiment commit 46ade06a) ───────────────
// A lane runs the repository's own commands inside a temp worktree `%TEMP%\ascent-loop-XXXXXX`. Before
// 46ade06a a timed-out `npm test` left its vitest tree alive after the lane ended (2026-10-09: two trees,
// ~23 GB, the machine starved). After every round this sweep ends the trees of processes whose COMMAND
// LINE names the worktree dir of a lane THIS block ran and that has ENDED.
//   - "ours" needs positive evidence: the dir was a registered worktree of the Personas checkout on a
//     lane branch read from this block's own run detail while the round ran (blocks/<id>/lane-dirs.json);
//   - "ended" = that run has `endedAt`, plus SWEEP_GRACE_MS so the engine's own cleanup goes first;
//   - matching is by the dir as a path segment of the command line, never by process name; the kill is
//     `taskkill /PID <pid> /T /F` on the top-most matching pids only. Nothing outside those dirs is touched.
const LOOP_DIR_RE = /^ascent-loop-[A-Za-z0-9]+$/;
const SWEEP_GRACE_MS = 60_000;
const dirBase = (dir) => String(dir).replace(/[\\/]+$/, "").split(/[\\/]/).pop();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Personas' registered worktrees, read-only: [{dir, branch}]. */
function personasWorktrees() {
  const out = git(["worktree", "list", "--porcelain"]) ?? "";
  return out
    .split(/\r?\n\r?\n/)
    .map((b) => ({ dir: /^worktree (.+)$/m.exec(b)?.[1]?.trim() ?? null, branch: /^branch refs\/heads\/(.+)$/m.exec(b)?.[1]?.trim() ?? null }))
    .filter((w) => w.dir);
}

/** Every process whose command line names one of `bases` as a path segment: [{pid, ppid, cmd, base}]. */
function processesInDirs(bases) {
  if (process.platform !== "win32" || bases.length === 0) return [];
  const raw = ps(
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*ascent-loop-*' } | ` +
      `ForEach-Object { \"$($_.ProcessId)\`t$($_.ParentProcessId)\`t$($_.CommandLine)\" }`,
  );
  const res = bases.map((b) => [b, new RegExp(`[\\\\/]${escapeRe(b)}(?=[\\\\/"' ]|$)`, "i")]);
  const found = [];
  for (const line of raw.split(/\r?\n/).filter(Boolean)) {
    const [pid, ppid, ...rest] = line.split("\t");
    const cmd = rest.join("\t");
    // Never this script, never the query itself.
    if (Number(pid) === process.pid || /Get-CimInstance/i.test(cmd)) continue;
    const hit = res.find(([, re]) => re.test(cmd));
    if (hit && Number(pid) > 0) found.push({ pid: Number(pid), ppid: Number(ppid), cmd, base: hit[0] });
  }
  return found;
}

/** End the trees rooted at the top-most matching processes (a match whose parent also matches is reached
 *  by its parent's `/T`). By pid, through execFile, never a shell and never by name. */
function endTrees(procs) {
  const pids = new Set(procs.map((p) => p.pid));
  return procs
    .filter((p) => !pids.has(p.ppid))
    .map((p) => {
      try {
        execFileSync("taskkill", ["/PID", String(p.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        return { pid: p.pid, ok: true };
      } catch (e) {
        return { pid: p.pid, ok: false, status: e.status ?? null };
      }
    });
}

/** Sweep `bases` (ended lanes' dirs), log what was found and ended, append a record to sweep.jsonl. */
function sweepDirs(bases, log, blockDir, why) {
  const procs = processesInDirs(bases);
  if (procs.length === 0) {
    log(`sweep (${why}): no leftover process names ${bases.join(", ")}`);
    return { found: 0 };
  }
  for (const p of procs) log(`sweep (${why}): LEFTOVER pid ${p.pid} (parent ${p.ppid}) in ${p.base}: ${p.cmd.replace(/\s+/g, " ").slice(0, 220)}`);
  const killed = endTrees(procs);
  const left = processesInDirs(bases);
  log(`sweep (${why}): taskkill /T /F ended ${killed.filter((k) => k.ok).length}/${killed.length} tree(s) by pid; ${left.length} process(es) still name those dirs`);
  fs.appendFileSync(
    path.join(blockDir, "sweep.jsonl"),
    `${JSON.stringify({ at: iso(), why, dirs: bases, processes: procs.map(({ pid, ppid, base, cmd }) => ({ pid, ppid, base, cmd: cmd.slice(0, 500) })), killed, survivors: left.map((p) => p.pid) })}\n`,
  );
  return { found: procs.length, killed, survivors: left.length };
}

/** OURS = the PID file's process is `next dev -p <PORT>` launched from the rig worktree (its own command line
 *  says so; its start-server child names the worktree path). Never kill anything else. */
function ownServer() {
  const pid = readPid();
  if (!pid) return { pid: null, ours: false, why: "no next-dev.pid" };
  const cl = cmdlineOf(pid);
  if (!cl) return { pid, ours: false, why: "PID not running" };
  const kids = childrenOf(pid);
  const okSelf = new RegExp(String.raw`next[\\/]dist[\\/]bin[\\/]next"?\s+dev\s+-p\s+${PORT}\b`).test(cl) || new RegExp(String.raw`next\s+dev\s+-p\s+${PORT}\b`).test(cl);
  const wtl = WT.toLowerCase();
  const okKid = kids.some((k) => k.cmd.toLowerCase().includes(wtl) || k.cmd.toLowerCase().includes(wtl.replace(/\\/g, "/")));
  return { pid, ours: okSelf && okKid, cmd: cl, kids, why: okSelf && okKid ? "ok" : `command line does not match (${cl.slice(0, 120)})` };
}

async function httpCode(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    return r.status;
  } catch {
    return 0;
  }
}

async function serverStart() {
  if (listenerPid()) {
    console.log(`port ${PORT} already has a listener (PID ${listenerPid()}); not starting a second server.`);
    return true;
  }
  // Logs and the pid file live in HOME and the server runs from the rig's worktree. (The weekend rig kept
  // all three beside its script; carried over as-is, `server start` launched in a directory that does
  // not exist and wrote its pid where `server stop` never looks.)
  fs.mkdirSync(HOME, { recursive: true });
  for (const f of ["next-dev.log", "next-dev.err.log"]) {
    const p = path.join(HOME, f);
    if (fs.existsSync(p)) fs.renameSync(p, path.join(HOME, f.replace(".log", `.${iso().replace(/[:.]/g, "-")}.log`)));
  }
  const H = HOME.replace(/\//g, "\\");
  const W = WT.replace(/\//g, "\\");
  const P = PID_FILE.replace(/\//g, "\\");
  // stdio "ignore" on purpose: Start-Process with redirection creates the child with inherited
  // handles, so a PIPE handed to powershell would be held open by `next dev` for its whole life and
  // execFileSync would wait for EOF forever (it did, 2026-10-09). The PID comes back via the file.
  if (fs.existsSync(PID_FILE)) fs.rmSync(PID_FILE);
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `$p = Start-Process -FilePath 'node.exe' -ArgumentList 'node_modules/next/dist/bin/next','dev','-p','${PORT}' ` +
        `-WorkingDirectory '${W}' -WindowStyle Hidden -RedirectStandardOutput '${H}\\next-dev.log' ` +
        `-RedirectStandardError '${H}\\next-dev.err.log' -PassThru; Set-Content -Path '${P}' -Value $p.Id -NoNewline`,
    ],
    { stdio: "ignore", windowsHide: true },
  );
  console.log(`started next dev, PID ${readPid() ?? "(pid file missing)"}`);
  for (let i = 0; i < 60; i++) {
    const code = await httpCode(`${BASE}/`);
    if (code === 200) {
      console.log(`HTTP 200 on ${BASE}`);
      return true;
    }
    await sleep(5000);
  }
  console.log("server did not answer 200 within 5 min; see next-dev.log / next-dev.err.log");
  return false;
}

async function serverStop() {
  const s = ownServer();
  if (!s.ours) {
    console.log(`refusing to stop: ${s.why}. Listener on ${PORT}: ${listenerPid() ?? "none"}. Kill nothing you did not start.`);
    return !listenerPid();
  }
  const live = (await listDrives().catch(() => [])).filter((d) => LIVE_PHASES.includes(d.phase));
  if (live.length) console.log(`WARNING: ${live.length} live drive(s) (${live.map((d) => d.id).join(", ")}): stopping the server orphans their run; the boot sweep marks it interrupted.`);
  try {
    execFileSync("taskkill", ["/PID", String(s.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    /* already gone */
  }
  for (let i = 0; i < 30 && listenerPid(); i++) await sleep(1000);
  console.log(listenerPid() ? `port ${PORT} still has a listener (PID ${listenerPid()})` : `stopped (tree of PID ${s.pid}); port ${PORT} free`);
  return !listenerPid();
}

async function serverStatus() {
  const s = ownServer();
  const code = await httpCode(`${BASE}/`);
  console.log(JSON.stringify({ pidFile: s.pid, ours: s.ours, why: s.why, listener: listenerPid(), http: code }, null, 2));
  return code === 200;
}

// ── git (read-only on Personas) ──────────────────────────────────────────────────────────────────
function git(args, cwd = TARGET) {
  if (!cwd) return null;
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}
const runnerTip = () => git(["rev-parse", "-q", "--verify", RUNNER_REF]) || null;
function promptVersion() {
  const sha = git(["rev-parse", "--short=10", "HEAD"], WT);
  const subject = git(["log", "-1", "--format=%s"], WT);
  const dirty = (git(["status", "--porcelain", "--", "src", "scripts"], WT) ?? "").split(/\r?\n/).filter(Boolean);
  return { branch: git(["branch", "--show-current"], WT), sha, subject, dirtyFiles: dirty };
}

// ── metrics ──────────────────────────────────────────────────────────────────────────────────────
const DIMS = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"];
/** Hook output (lefthook) arrives with 24-bit colour codes and box drawing; keep the words only. */
const clean = (s) =>
  s == null ? s : String(s).replace(/\x1b\[[0-9;]*m/g, "").replace(/[╭╮╰╯─│┃]+/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
function snapshot(scan) {
  if (!scan) return null;
  const dims = {};
  for (const d of scan.dimensions ?? []) dims[d.dimId] = d.score ?? null;
  return { scanId: scan.id ?? null, scannedAt: scan.scannedAt ?? null, overall: scan.overallScore ?? null, level: scan.level ?? null, dims };
}

/** The repo's LATEST scan as the app shows it (9 reads of /api/org/repo-dimension). Independent of the
 *  lane outcomes, so a block whose lanes errored before measuring still gets a before/after. */
async function apiSnapshot() {
  const dims = {};
  let head = null;
  for (const d of DIMS) {
    try {
      const j = await api(`/api/org/repo-dimension?org=${ORG}&repo=${encodeURIComponent(REPO)}&dim=${d}`, {}, 3);
      head ??= { scannedAt: j.scannedAt ?? null, overall: j.overall ?? null, level: j.level?.id ?? j.level ?? null };
      dims[d] = j.dimension?.score ?? null;
    } catch {
      dims[d] = null;
    }
  }
  return head ? { ...head, dims } : null;
}

function computeMetrics(dir, extra = {}) {
  const files = fs.readdirSync(dir).filter((n) => /^round-\d+-.*\.json$/.test(n)).sort();
  const rounds = [];
  let firstBefore = null;
  let lastAfter = null;
  for (const f of files) {
    const { record: r = {}, detail: d = null } = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const econ = new Map((d?.economics ?? []).map((e) => [e.laneId, e]));
    const outcomes = new Map((d?.outcomes ?? []).map((o) => [o.lane?.id, o]));
    const lanes = (d?.lanes ?? []).map((l) => {
      const o = outcomes.get(l.id);
      const e = econ.get(l.id);
      if (o?.before && !firstBefore) firstBefore = o.before;
      if (o?.after) lastAfter = o.after;
      return {
        id: l.id,
        repo: l.repoFullName,
        phase: l.phase,
        kind: o?.kind ?? null,
        commits: l.commits ?? 0,
        // A lane with commits and no landedAt is HELD: its work sits on its own ascent/loop-* branch and
        // never reached ascent/runner (personas-web block 001: 7 of 10 lanes, verify skipped).
        landed: l.landedAt != null,
        branch: l.branch ?? null,
        // The architecture/containment hold moves the commits to ascent/held/<id> and RESETS the lane, so
        // `commits` reads 0; only the log names the ref (personas-web block 002).
        heldRef: (l.log ?? []).map((x) => /ascent\/held\/[0-9a-f-]{8,}/.exec(String(x))?.[0]).find(Boolean) ?? null,
        closed: (l.closedIds ?? []).length,
        verifyVerdict: l.verifyVerdict ?? null,
        verifyRung: l.verifyRung ?? null,
        verifyCommand: l.verifyCommand ?? null,
        voidReason: l.voidReason ?? null,
        error: clean(l.error) ?? null,
        model: l.model ?? null,
        // `costMicros` on a lane is MICRO-CENTS (MICROS_PER_USD = 1e8, agent-envelope.ts:23), and it is
        // the CLI's notional API-price figure, not subscription spend.
        costUsd: l.costMicros != null ? round2(l.costMicros / 1e8) : null,
        verifiedPoints: e?.verifiedPoints ?? null,
        byDim: e?.byDim ?? [],
        agentMinutes: l.agentDurationMs != null ? round2(l.agentDurationMs / 60000) : null,
        planMinutes: l.planDurationMs != null ? round2(l.planDurationMs / 60000) : null,
        deliverables: (o?.deliverables ?? l.deliverables ?? []).map((x) => `${x.kind}: ${x.headline}`),
        lastLog: clean((l.log ?? []).slice(-1)[0]) ?? null,
      };
    });
    rounds.push({
      n: Number(/^round-(\d+)-/.exec(f)[1]),
      file: f,
      runId: r.runId ?? d?.run?.id ?? null,
      startedAt: r.startedAt ?? null,
      endedAt: r.endedAt ?? null,
      minutes: mins(r.startedAt, r.endedAt),
      verifiedCloses: r.verifiedCloses ?? null,
      landed: r.landed ?? null,
      debtBefore: r.debtBefore ?? null,
      debtAfter: r.debtAfter ?? null,
      runError: clean(d?.run?.error) ?? null,
      dry: (r.verifiedCloses ?? 0) === 0,
      costUsd: round2(lanes.reduce((s, l) => s + (l.costUsd ?? 0), 0)),
      verifiedPoints: lanes.reduce((s, l) => s + (l.verifiedPoints ?? 0), 0),
      lanes,
    });
  }
  const allLanes = rounds.flatMap((r) => r.lanes);
  // Held = committed work that did not reach ascent/runner: unlanded commits on the lane branch, or
  // commits the guard moved to ascent/held/<id>.
  const isHeld = (l) => (l.commits > 0 && !l.landed) || Boolean(l.heldRef);
  const before = snapshot(firstBefore);
  const after = snapshot(lastAfter);
  const delta =
    before && after
      ? {
          overall: after.overall != null && before.overall != null ? after.overall - before.overall : null,
          dims: Object.fromEntries(DIMS.map((k) => [k, after.dims[k] != null && before.dims[k] != null ? after.dims[k] - before.dims[k] : null])),
        }
      : null;
  const closes = rounds.map((r) => r.verifiedCloses ?? 0);
  const totalCloses = closes.reduce((a, b) => a + b, 0);
  return {
    ...extra,
    roundsCompleted: rounds.length,
    totals: {
      verifiedCloses: totalCloses,
      closesPerRound: rounds.length ? round2(totalCloses / rounds.length) : null,
      verifiedClosesByRound: closes,
      verifiedPoints: rounds.reduce((s, r) => s + r.verifiedPoints, 0),
      landed: rounds.reduce((s, r) => s + (r.landed ?? 0), 0),
      laneCommits: allLanes.reduce((s, l) => s + l.commits, 0),
      heldLanes: allLanes.filter(isHeld).length,
      closesOnHeldLanes: allLanes.filter(isHeld).reduce((s, l) => s + l.closed, 0),
      heldBranches: allLanes.filter(isHeld).map((l) => l.heldRef ?? l.branch).filter(Boolean),
      // By cause, because the remedies differ: `fence` = the plan/containment guard moved the commits to
      // ascent/held/<id> (the plan must declare what the executor creates); `unverified` = verify was
      // skipped and delivery refused (the repository needs a declared gate); `other` = anything else.
      heldByCause: allLanes.filter(isHeld).reduce(
        (m, l) => {
          const cause = l.heldRef ? "fence" : l.verifyVerdict === "skipped" ? "unverified" : "other";
          m[cause] += 1;
          return m;
        },
        { fence: 0, unverified: 0, other: 0 },
      ),
      dryRounds: rounds.filter((r) => r.dry).length,
      voidedLanes: allLanes.filter((l) => l.voidReason).length,
      voidReasons: allLanes.filter((l) => l.voidReason).map((l) => l.voidReason),
      rejectedLanes: allLanes.filter((l) => l.verifyVerdict === "rejected").length,
      erroredLanes: allLanes.filter((l) => l.error || l.phase === "error").length,
      verifyVerdicts: allLanes.reduce((m, l) => ((m[l.verifyVerdict ?? "none"] = (m[l.verifyVerdict ?? "none"] ?? 0) + 1), m), {}),
      verifyRungs: [...new Set(allLanes.map((l) => l.verifyRung).filter(Boolean))],
      costUsd: round2(rounds.reduce((s, r) => s + (r.costUsd ?? 0), 0)),
      roundMinutes: round2(rounds.reduce((s, r) => s + (r.minutes ?? 0), 0)),
    },
    maturity: {
      before,
      after,
      delta,
      source: "first lane `before` scan -> last lane `after` scan in this block",
      latestScanBefore: extra.latestScanBefore ?? null,
      latestScanAfter: extra.latestScanAfter ?? null,
    },
    errors: [
      ...rounds.filter((r) => r.runError).map((r) => `round ${r.n}: ${r.runError}`),
      ...rounds.flatMap((r) => r.lanes.filter((l) => l.error).map((l) => `round ${r.n} lane ${l.id.slice(0, 8)}: ${l.error}`)),
      ...(extra.blockErrors ?? []),
    ],
    rounds,
  };
}

/** loop-reflect.mjs reads `run-NN-*.json` with `outcomes` at the TOP level; runner-rounds writes
 *  `round-NN-*.json` as {record, detail}. Bridge it with copies instead of patching the script. */
function writeReflectView(dir) {
  const view = path.join(dir, "loop-reflect");
  fs.mkdirSync(view, { recursive: true });
  for (const f of fs.readdirSync(dir).filter((n) => /^round-\d+-.*\.json$/.test(n))) {
    const { detail } = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    if (detail) fs.writeFileSync(path.join(view, f.replace(/^round-/, "run-")), JSON.stringify(detail, null, 2));
  }
  try {
    const out = execFileSync(process.execPath, [path.join(WT, "scripts", "loop-reflect.mjs"), "--dir", view, "--verbose"], {
      cwd: WT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    fs.writeFileSync(path.join(dir, "loop-reflect.txt"), out);
  } catch (e) {
    fs.writeFileSync(path.join(dir, "loop-reflect.txt"), `loop-reflect failed: ${e.stderr || e.message}`);
  }
}

const LEDGER_HEAD = [
  `# /infinite ledger - ${REPO}`,
  "",
  "One section per block, appended by `node infinite.mjs block`; the reflection subagent appends its",
  "`### Reflection` under the block it reflected on (references/reflect.md). Cross-block table:",
  "`node infinite.mjs trend --project <owner/name>`.",
  "",
  "Columns: `closes` = verified closes (rows the rescan adjudicated closed). `pts` = verified points.",
  "`overall` = the project's maturity, first lane `before` scan -> last lane `after` scan (else the latest",
  "scan). `stop` = why the block ended. `$` = the CLI's notional API-price cost, not subscription spend.",
  "",
].join("\n");

const TABLE_HEAD =
  "| block | kind | prompt sha | rounds | stop | closes by round | closes/rd | pts | overall | dims moved | runner commits | void | rej | err | $ | min |\n" +
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n";

function ledgerRow(m) {
  const t = m.totals;
  const mat = m.maturity;
  const b = mat.before ?? mat.latestScanBefore;
  const a = mat.after ?? mat.latestScanAfter;
  const overall = b && a ? `${b.overall}->${a.overall}` : b ? `${b.overall}->?` : "n/a";
  const moved = mat.delta ? Object.entries(mat.delta.dims).filter(([, v]) => v).map(([k, v]) => `${k}${v > 0 ? "+" : ""}${v}`).join(" ") || "none" : "n/a";
  const cell = (s) => String(s ?? "").replace(/\|/g, "/").replace(/\r?\n/g, " ");
  const row = [
    m.block,
    m.kind,
    `${m.promptVersion?.sha ?? "?"}${m.promptVersion?.dirtyFiles?.length ? "*" : ""}`,
    `${m.roundsCompleted}/${m.config?.rounds ?? "?"}`,
    m.stopReason,
    t.verifiedClosesByRound.join(",") || "-",
    t.closesPerRound ?? "-",
    t.verifiedPoints,
    overall,
    moved,
    m.runnerBranch?.commitsAdded ?? "?",
    t.voidedLanes,
    t.rejectedLanes,
    t.erroredLanes,
    t.costUsd ?? "-",
    m.wallMinutes,
  ].map(cell);
  return `| ${row.join(" | ")} |\n`;
}

function appendLedger(m) {
  if (!fs.existsSync(LEDGER)) fs.writeFileSync(LEDGER, LEDGER_HEAD);
  const when = `${(m.startedAt ?? "").slice(0, 16).replace("T", " ")}Z -> ${(m.endedAt ?? "").slice(11, 16)}Z`;
  fs.appendFileSync(
    LEDGER,
    `\n## Block ${m.block} (${m.kind}) · ${when} · prompt ${m.promptVersion?.sha} "${m.promptVersion?.subject ?? ""}"\n\n` +
      TABLE_HEAD +
      ledgerRow(m) +
      `\n${m.label ? `label: ${m.label}  \n` : ""}exit ${m.exitCode} · drive ${m.driveId ?? "-"} · verify ${JSON.stringify(m.totals.verifyVerdicts)} rungs ${m.totals.verifyRungs.join(",") || "-"}` +
      ` · held lanes ${m.totals.heldLanes ?? "?"} ${m.totals.heldByCause ? JSON.stringify(m.totals.heldByCause) : ""} (closes on held ${m.totals.closesOnHeldLanes ?? "?"})` +
      `${m.errors?.length ? `  \nerrors: ${m.errors.slice(0, 5).map((e) => String(e).replace(/\s*\n\s*/g, " / ").slice(0, 240)).join(" ;; ")}` : ""}\n`,
  );
}

function trend() {
  const dirs = fs.existsSync(BLOCKS) ? fs.readdirSync(BLOCKS).filter((x) => /^(\d{3}|smoke-\d{3})$/.test(x) && x !== "000").sort() : [];
  let out = TABLE_HEAD;
  for (const d of dirs) {
    const f = path.join(BLOCKS, d, "metrics.json");
    if (fs.existsSync(f)) out += ledgerRow(JSON.parse(fs.readFileSync(f, "utf8")));
  }
  console.log(out);
}

function nextBlockDir(smoke) {
  fs.mkdirSync(BLOCKS, { recursive: true });
  const names = fs.readdirSync(BLOCKS);
  if (smoke) {
    const n = names.filter((x) => /^smoke-\d{3}$/.test(x)).map((x) => Number(x.slice(6)));
    return `smoke-${pad3((n.length ? Math.max(...n) : 0) + 1)}`;
  }
  const n = names.filter((x) => /^\d{3}$/.test(x)).map(Number).filter((x) => x > 0);
  return pad3((n.length ? Math.max(...n) : 0) + 1);
}

// ── the block ────────────────────────────────────────────────────────────────────────────────────
async function block() {
  requireProject();
  const cfg = {
    rounds: Number(flag("rounds", "10")),
    model: flag("model", "opus"),
    effort: flag("effort", null),
    ceiling: Number(flag("ceiling", "100")),
    backoffWaitMin: Number(flag("backoff-wait-min", "0")),
    stallMin: Number(flag("stall-min", "120")),
    maxHours: Number(flag("max-hours", "12")),
    // THE VERIFY CHOICE, fixed for every block (it decides which rung verifies, so it is part of the
    // instrument). Personas' ladder comes from its committed .ai/manifest.yaml and cannot be changed
    // without a Personas commit: `npm test` (ciHardPass) -> `npx tsc --noEmit` (typecheck) -> `npm run
    // lint`. The smoke lane spent ~11.3 min in its baseline: `npm test` ran into the 10-min cap, then a
    // cold `tsc` (57 s measured) passed. 3 min cuts the doomed full suite early and still leaves a 3x
    // margin for the cold typecheck, so every lane is guarded by the typecheck rung, labelled NARROWED.
    verifyTimeoutMin: flag("verify-timeout-min", String(PROJECT_CFG.verifyTimeoutMin ?? 3)),
    agentTimeoutMin: flag("agent-timeout-min", null),
    base: BASE,
  };
  if (!Number.isInteger(cfg.rounds) || cfg.rounds < 1) {
    console.error("--rounds must be a positive integer");
    return 2;
  }
  const smoke = has("smoke");
  const label = flag("label", smoke ? "smoke" : "");

  // PREFLIGHT: the server answers, Personas is paired, no drive is live (one run slot per org).
  let projects;
  try {
    projects = await api(`/api/org/local/projects?org=${ORG}`, {}, 3);
  } catch (e) {
    console.error(`preflight: ${BASE} is not answering (${e.message}). Run: node infinite.mjs server start`);
    return 3;
  }
  const p = (projects.projects ?? []).find((x) => x.fullName === REPO);
  if (!p?.localPath) {
    console.error(`preflight: ${REPO} is not paired in org ${ORG}.`);
    return 3;
  }
  const live = (await listDrives()).filter((d) => LIVE_PHASES.includes(d.phase));
  if (live.length) {
    console.error(`preflight: drive(s) already live: ${live.map((d) => `${d.id} (${d.phase})`).join(", ")}. Stop them first.`);
    return 4;
  }

  const id = nextBlockDir(smoke);
  const dir = path.join(BLOCKS, id);
  fs.mkdirSync(dir, { recursive: true });
  const startedAt = iso();
  const tipBefore = runnerTip();
  const pv = promptVersion();
  const latestScanBefore = await apiSnapshot();
  const log = (t) => {
    const line = `[cycle ${new Date().toISOString().slice(11, 19)}] ${t}`;
    console.log(line);
    fs.appendFileSync(path.join(dir, "cycle.log"), `${line}\n`);
  };
  log(`block ${id} (${smoke ? "smoke" : "block"}) rounds=${cfg.rounds} model=${cfg.model}${cfg.effort ? ` effort=${cfg.effort}` : ""} prompt=${pv.sha} "${pv.subject}" runner tip=${tipBefore ?? "(none yet)"}`);

  // LEAK SWEEP state (see processesInDirs): the lane worktrees this block's runs created, by basename.
  const laneDirs = new Map();
  const runBranches = new Map();
  const lanesFile = path.join(dir, "lane-dirs.json");
  async function trackLaneDirs(d) {
    for (const r of d?.runs ?? []) {
      if (r.endedAt && runBranches.has(r.runId)) continue;
      try {
        const det = await api(`/api/org/loop/${r.runId}?org=${ORG}`, {}, 2);
        runBranches.set(r.runId, new Set((det?.lanes ?? []).map((l) => l.branch).filter(Boolean)));
      } catch {
        /* next poll */
      }
    }
    const runOf = new Map();
    for (const [runId, set] of runBranches) for (const b of set) runOf.set(b, runId);
    let added = false;
    for (const w of personasWorktrees()) {
      const base = dirBase(w.dir);
      if (!LOOP_DIR_RE.test(base) || !w.branch || !runOf.has(w.branch) || laneDirs.has(base.toLowerCase())) continue;
      laneDirs.set(base.toLowerCase(), { dir: w.dir, base, branch: w.branch, runId: runOf.get(w.branch), seenAt: iso(), sweptAt: null });
      added = true;
      log(`lane worktree ${base} (${w.branch}, run ${runOf.get(w.branch).slice(0, 8)})`);
    }
    if (added) fs.writeFileSync(lanesFile, JSON.stringify([...laneDirs.values()], null, 2));
  }
  function sweepEnded(d, final = false) {
    const ended = new Map((d?.runs ?? []).filter((r) => r.endedAt).map((r) => [r.runId, Date.parse(r.endedAt)]));
    const due = [...laneDirs.values()].filter((l) => !l.sweptAt && ended.has(l.runId) && (final || Date.now() - ended.get(l.runId) >= SWEEP_GRACE_MS));
    if (due.length === 0) return;
    const n = (d.runs ?? []).findIndex((r) => r.runId === due[0].runId) + 1;
    sweepDirs(due.map((l) => l.base), log, dir, final ? "block end" : `after round ${n}`);
    const at = iso();
    for (const l of due) l.sweptAt = at;
    fs.writeFileSync(lanesFile, JSON.stringify([...laneDirs.values()], null, 2));
  }

  const args = [
    path.join("scripts", "runner-rounds.mjs"),
    "--org", ORG, "--repos", REPO, "--rounds", String(cfg.rounds), "--base", BASE,
    "--model", cfg.model, "--ceiling", String(cfg.ceiling), "--out", dir, "--stall-min", String(cfg.stallMin),
  ];
  if (cfg.effort) args.push("--effort", cfg.effort);
  if (cfg.verifyTimeoutMin) args.push("--verify-timeout-min", cfg.verifyTimeoutMin);
  if (cfg.agentTimeoutMin) args.push("--agent-timeout-min", cfg.agentTimeoutMin);

  const child = spawn(process.execPath, args, { cwd: WT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const childLog = fs.createWriteStream(path.join(dir, "runner-rounds.stdout.log"), { flags: "a" });
  let driveId = null;
  let childExit = null;
  const onData = (buf) => {
    const s = buf.toString();
    childLog.write(s);
    process.stdout.write(s);
    const m = /^drive (\S+) phase=/m.exec(s);
    if (m && !driveId) driveId = m[1];
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  const exited = new Promise((res) => child.on("exit", (code) => res((childExit = code))));

  let stopReason = null;
  let exitCode = 0;
  const pauses = [];
  const errors = [];
  const deadline = Date.now() + cfg.maxHours * 3_600_000;
  let lastDrive = null;

  // WATCH the drive alongside runner-rounds. It never decides a round; it only decides to give up.
  while (childExit === null) {
    await Promise.race([exited, sleep(30_000)]);
    if (childExit !== null || !driveId) continue;
    let d;
    try {
      d = (await listDrives()).find((x) => x.id === driveId);
    } catch (e) {
      log(`drive read failed: ${e.message}`);
      continue;
    }
    if (!d) continue;
    lastDrive = d;
    try {
      await trackLaneDirs(d);
      sweepEnded(d);
    } catch (e) {
      log(`sweep bookkeeping failed: ${e.message}`);
    }
    const rs = (d.repoState ?? []).find((r) => r.repo === REPO);
    let giveUp = null;
    if (d.phase === "paused") {
      giveUp = { reason: `paused:${d.pausedReason ?? "?"}`, code: 11, note: `runner paused (${d.pausedReason}) until ${d.pausedUntil ?? "the operator resumes it"}` };
    } else if (rs?.paused === "dry-backoff") {
      const waitMin = rs.pausedUntil ? (Date.parse(rs.pausedUntil) - Date.now()) / 60000 : Infinity;
      if (waitMin > cfg.backoffWaitMin) giveUp = { reason: "dry-backoff", code: 10, note: `${rs.note ?? ""} pausedUntil=${rs.pausedUntil} dryStreak=${rs.dryStreak}` };
    } else if (rs?.paused) {
      giveUp = { reason: `repo-paused:${rs.paused}`, code: 11, note: rs.note ?? "" };
    } else if (Date.now() > deadline) {
      giveUp = { reason: "max-hours", code: 12, note: `block exceeded ${cfg.maxHours} h` };
    }
    if (giveUp) {
      stopReason = giveUp.reason;
      exitCode = giveUp.code;
      pauses.push({ at: iso(), reason: giveUp.reason, note: giveUp.note, repoState: rs ?? null });
      log(`RETURNING EARLY: ${giveUp.reason} - ${giveUp.note}`);
      try {
        await postDrive({ action: "stop", id: driveId });
        log("stop requested");
      } catch (e) {
        log(`stop failed: ${e.message}`);
        errors.push(`stop failed: ${e.message}`);
      }
      // runner-rounds notices phase=stopped on its next poll (20 s) and exits; give it 5 min.
      const t = await Promise.race([exited.then(() => "exited"), sleep(300_000).then(() => "timeout")]);
      if (t === "timeout") {
        log("runner-rounds did not exit after the stop; killing the child this script started");
        child.kill();
        await Promise.race([exited, sleep(10_000)]);
      }
      break;
    }
  }
  await exited.catch(() => {});
  childLog.end();

  // Classify what runner-rounds itself said, when we did not stop it.
  const roundsLog = fs.existsSync(path.join(dir, "runner-rounds.stdout.log")) ? fs.readFileSync(path.join(dir, "runner-rounds.stdout.log"), "utf8") : "";
  if (!stopReason) {
    if (/reached \d+ rounds/.test(roundsLog)) stopReason = "completed";
    else if (/STALL:/.test(roundsLog)) [stopReason, exitCode] = ["stall", 12];
    else if (/drive ended: phase=(\S+)/.test(roundsLog)) [stopReason, exitCode] = [`drive-ended:${/drive ended: phase=(\S+)/.exec(roundsLog)[1]}`, 12];
    else [stopReason, exitCode] = [`runner-rounds exit ${childExit}`, childExit === 0 ? 0 : 1];
  }
  // A backoff that lands AFTER the last requested round is not an early return: the block is complete.
  const savedRounds = fs.readdirSync(dir).filter((n) => /^round-\d+-.*\.json$/.test(n)).length;
  if (exitCode !== 0 && savedRounds >= cfg.rounds && /reached \d+ rounds/.test(roundsLog)) {
    pauses.push({ at: iso(), reason: `${stopReason} after the last round (not an early return)` });
    [stopReason, exitCode] = ["completed", 0];
  }
  if (childExit && childExit !== 0) errors.push(`runner-rounds exited ${childExit}`);

  // MAKE SURE the drive is not left running, then BACKFILL any ended run runner-rounds did not save.
  if (driveId) {
    try {
      let d = (await listDrives()).find((x) => x.id === driveId);
      if (d && LIVE_PHASES.includes(d.phase)) {
        log(`drive still ${d.phase}; requesting stop`);
        await postDrive({ action: "stop", id: driveId }).catch((e) => errors.push(`final stop failed: ${e.message}`));
        for (let i = 0; i < 18 && d && LIVE_PHASES.includes(d.phase); i++) {
          await sleep(10_000);
          d = (await listDrives()).find((x) => x.id === driveId);
        }
      }
      lastDrive = d ?? lastDrive;
      const saved = new Set(fs.readdirSync(dir).map((n) => /^round-\d+-(.+)\.json$/.exec(n)?.[1]).filter(Boolean));
      const ended = (d?.runs ?? []).filter((r) => r.endedAt);
      let n = saved.size;
      for (const r of ended) {
        if (saved.has(r.runId)) continue;
        let detail = null;
        try {
          detail = await api(`/api/org/loop/${r.runId}?org=${ORG}`);
        } catch (e) {
          errors.push(`backfill detail ${r.runId}: ${e.message}`);
        }
        // A run the drive opened AFTER the last requested round is one our own stop aborted (personas-web
        // block 004: round 11 opened 1 s after round 10 and was force-failed at $0). It is kept as evidence
        // under a name the round regex does not match, so it never counts as a round, a dry round or an
        // errored lane.
        if (n >= cfg.rounds) {
          fs.writeFileSync(path.join(dir, `aborted-by-stop-${r.runId}.json`), JSON.stringify({ record: r, detail }, null, 2));
          log(`run ${r.runId} started after round ${cfg.rounds} and was aborted by the stop; kept as aborted-by-stop, not counted`);
          continue;
        }
        n++;
        fs.writeFileSync(path.join(dir, `round-${String(n).padStart(2, "0")}-${r.runId}.json`), JSON.stringify({ record: r, detail }, null, 2));
        log(`backfilled round ${n} (${r.runId})`);
      }
      if (d) fs.writeFileSync(path.join(dir, "drive.json"), JSON.stringify(d, null, 2));
    } catch (e) {
      errors.push(`drive finalize: ${e.message}`);
    }
    // FINAL SWEEP: every ended lane of this block not swept yet, after the engine's grace.
    try {
      await trackLaneDirs(lastDrive);
      const lastEnd = Math.max(0, ...(lastDrive?.runs ?? []).filter((r) => r.endedAt).map((r) => Date.parse(r.endedAt)));
      const wait = SWEEP_GRACE_MS - (Date.now() - lastEnd);
      if (lastEnd && wait > 0) await sleep(wait);
      sweepEnded(lastDrive, true);
      const unended = [...laneDirs.values()].filter((l) => !l.sweptAt).map((l) => l.base);
      if (unended.length) log(`sweep: NOT swept (their run has no endedAt): ${unended.join(", ")}`);
    } catch (e) {
      errors.push(`final sweep: ${e.message}`);
    }
  }

  const tipAfter = runnerTip();
  const range = tipBefore ? `${tipBefore}..${RUNNER_REF}` : `${BASE_BRANCH}..${RUNNER_REF}`;
  const commitLog = tipAfter ? (git(["log", "--oneline", "--no-decorate", range]) ?? "").split(/\r?\n/).filter(Boolean) : [];
  const latestScanAfter = await apiSnapshot();
  const endedAt = iso();
  const metrics = computeMetrics(dir, {
    latestScanBefore,
    latestScanAfter,
    block: id,
    kind: smoke ? "smoke" : "block",
    label,
    startedAt,
    endedAt,
    wallMinutes: mins(startedAt, endedAt),
    config: cfg,
    promptVersion: pv,
    driveId,
    stopReason,
    exitCode,
    pauses,
    blockErrors: errors,
    driveFinalPhase: lastDrive?.phase ?? null,
    repoStateAtEnd: (lastDrive?.repoState ?? []).find((r) => r.repo === REPO) ?? null,
    runnerBranch: {
      ref: RUNNER_REF,
      before: tipBefore,
      after: tipAfter,
      range: tipAfter ? range : null,
      commitsAdded: commitLog.length,
      nonMergeCommitsAdded: tipAfter ? Number(git(["rev-list", "--count", "--no-merges", range]) ?? 0) : 0,
      aheadOfBase: tipAfter ? Number(git(["rev-list", "--count", `${BASE_BRANCH}..${RUNNER_REF}`]) ?? 0) : 0,
      log: commitLog,
    },
  });
  fs.writeFileSync(path.join(dir, "metrics.json"), JSON.stringify(metrics, null, 2));
  writeReflectView(dir);
  appendLedger(metrics);
  log(
    `DONE ${id}: ${stopReason} · ${metrics.roundsCompleted}/${cfg.rounds} rounds · closes ${metrics.totals.verifiedClosesByRound.join(",") || "-"} · ` +
      `runner +${metrics.runnerBranch.commitsAdded} commits · exit ${exitCode}`,
  );
  if (metrics.totals.heldLanes > 0) {
    log(
      `WARNING ${id}: ${metrics.totals.heldLanes} lane(s) committed work that never reached ascent/runner ` +
        `(${metrics.totals.closesOnHeldLanes} closes counted on them): ${metrics.totals.heldBranches.join(", ")}`,
    );
  }
  return exitCode;
}

async function status() {
  await serverStatus();
  const live = (await listDrives().catch(() => [])).filter((d) => LIVE_PHASES.includes(d.phase));
  console.log(`live drives: ${live.length ? live.map((d) => `${d.id} ${d.phase}`).join(", ") : "none"}`);
  console.log(`project: ${REPO ?? "(none: pass --project owner/name)"}${TARGET ? ` at ${TARGET}, base ${BASE_BRANCH}` : ""}`);
  if (TARGET) console.log(`runner tip: ${runnerTip() ?? "(no ascent/runner ref)"}`);
  const pv = promptVersion();
  console.log(`prompt: ${pv.branch} ${pv.sha} ${pv.subject}${pv.dirtyFiles.length ? ` (DIRTY: ${pv.dirtyFiles.length} files)` : ""}`);
  if (LEDGER && fs.existsSync(LEDGER)) console.log(`last ledger row: ${fs.readFileSync(LEDGER, "utf8").trim().split(/\r?\n/).pop()}`);
}


// ── rig / projects / init (the /infinite additions) ─────────────────────────────────────────────
function rigCmd() {
  const wt = argOf("wt");
  if (!wt) { console.error("usage: node infinite.mjs rig --wt <ascent worktree> [--port 3200] [--org kiro]"); return 2; }
  if (!fs.existsSync(path.join(wt, "scripts", "runner-rounds.mjs"))) { console.error(`${wt} has no scripts/runner-rounds.mjs: not an Ascent worktree.`); return 3; }
  fs.mkdirSync(HOME, { recursive: true });
  const rig = { wt: path.resolve(wt), port: PORT, org: ORG, recordedAt: iso() };
  fs.writeFileSync(RIG_FILE, JSON.stringify(rig, null, 2) + "\n");
  console.log(JSON.stringify({ ok: true, rigFile: RIG_FILE, rig }, null, 2));
  return 0;
}

/** Every project the org knows, with its overall and level (one repo-dimension read each). */
async function projectsCmd() {
  let list;
  try { list = await api(`/api/org/local/projects?org=${ORG}`, {}, 3); }
  catch (e) { console.error(`${BASE} is not answering (${e.message}). Run: node infinite.mjs server start`); return 3; }
  const green = new Map((list.green?.repos ?? []).map((r) => [r.fullName, r]));
  const out = [];
  for (const p of list.projects ?? []) {
    let overall = null, level = null, scannedAt = null;
    try { const j = await api(`/api/org/repo-dimension?org=${ORG}&repo=${encodeURIComponent(p.fullName)}&dim=D1`, {}, 2); overall = j.overall ?? null; level = j.level?.id ?? j.level ?? null; scannedAt = j.scannedAt ?? null; } catch { /* unscanned */ }
    const g = green.get(p.fullName);
    const slug = p.fullName.replace(/[^A-Za-z0-9._-]+/g, "__");
    out.push({
      fullName: p.fullName, localPath: p.localPath ?? null, watched: p.watched, overall, level, scannedAt,
      debt: g?.debt ?? null, openGapDims: (g?.gaps ?? []).map((x) => x.dimId), unmeasurable: g?.unmeasurable ?? [], contested: g?.contested ?? [],
      initialised: fs.existsSync(path.join(HOME, "projects", slug, "project.json")),
      blocks: fs.existsSync(path.join(HOME, "projects", slug, "blocks")) ? fs.readdirSync(path.join(HOME, "projects", slug, "blocks")).filter((d) => /^\d{3}$/.test(d) && d !== "000").length : 0,
    });
  }
  console.log(JSON.stringify({ org: ORG, base: BASE, projects: out }, null, 2));
  return 0;
}

/** Pair the project if a path is given and it is not paired yet, write project.json, and record blocks/000. */
async function initCmd() {
  if (!REPO) { console.error("usage: node infinite.mjs init --project owner/name [--path C:/abs] [--base main]"); return 2; }
  let list;
  try { list = await api(`/api/org/local/projects?org=${ORG}`, {}, 3); }
  catch (e) { console.error(`${BASE} is not answering (${e.message}). Run: node infinite.mjs server start`); return 3; }
  let p = (list.projects ?? []).find((x) => x.fullName === REPO);
  const wantPath = argOf("path");
  if (!p?.localPath && wantPath) {
    const res = await api("/api/org/local/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ org: ORG, url: REPO, path: wantPath }) });
    const r = (res.results ?? [])[0];
    if (r?.error) { console.error(`pairing refused: ${r.error}`); return 3; }
    list = await api(`/api/org/local/projects?org=${ORG}`, {}, 3);
    p = (list.projects ?? []).find((x) => x.fullName === REPO);
  }
  if (!p?.localPath) { console.error(`${REPO} is not paired in org ${ORG}. Pass --path <absolute checkout path>.`); return 3; }
  const target = p.localPath;
  const detected = (git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], target) ?? "").replace(/^origin\//, "") || git(["branch", "--show-current"], target) || "master";
  const base = argOf("base") ?? detected;
  fs.mkdirSync(path.join(PDIR, "blocks", "000"), { recursive: true });
  // Re-init (after a rescan) refreshes the baseline and keeps what the operator and the loop recorded:
  // verifyTimeoutMin is part of the instrument, and operatorDecisions/techMetrics/tier are decisions.
  const cfg = { ...PROJECT_CFG, repo: REPO, org: ORG, path: target, base: argOf("base") ?? PROJECT_CFG.base ?? base, initialisedAt: iso() };
  fs.writeFileSync(path.join(PDIR, "project.json"), JSON.stringify(cfg, null, 2) + "\n");
  const snap = await (async () => { const dims = {}; let head = null; for (const d of DIMS) { try { const j = await api(`/api/org/repo-dimension?org=${ORG}&repo=${encodeURIComponent(REPO)}&dim=${d}`, {}, 3); head ??= { scannedAt: j.scannedAt ?? null, overall: j.overall ?? null, level: j.level?.id ?? j.level ?? null }; dims[d] = j.dimension?.score ?? null; } catch { dims[d] = null; } } return head ? { ...head, dims } : null; })();
  const prompt = (() => { const sha = git(["rev-parse", "--short=10", "HEAD"], WT); const subject = git(["log", "-1", "--format=%s"], WT); return { sha, subject, branch: git(["branch", "--show-current"], WT) }; })();
  fs.writeFileSync(path.join(PDIR, "blocks", "000", "baseline.json"), JSON.stringify({ at: iso(), snapshot: snap, prompt }, null, 2) + "\n");
  if (!fs.existsSync(path.join(PDIR, "LEDGER.md"))) {
    const dimsLine = snap ? DIMS.map((d) => `${d} ${snap.dims[d] ?? "-"}`).join(" · ") : "no scan yet - run a rescan first";
    fs.writeFileSync(path.join(PDIR, "LEDGER.md"), LEDGER_HEAD + `Baseline (blocks/000, ${iso().slice(0, 10)}): ${REPO} ${snap?.level ?? "?"}, overall ${snap?.overall ?? "?"} - ${dimsLine}. Prompt surface = ${prompt.branch} ${prompt.sha}.\n\n`);
  }
  console.log(JSON.stringify({ ok: true, projectDir: PDIR, project: cfg, baseline: snap, prompt }, null, 2));
  return 0;
}

async function main() {
  switch (cmd) {
    case "rig":
      return rigCmd();
    case "projects":
      return projectsCmd();
    case "init":
      return initCmd();
    case "block":
      return block();
    case "metrics": {
      requireProject();
      const dir = path.resolve(argv[1] ?? "");
      const prev = fs.existsSync(path.join(dir, "metrics.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "metrics.json"), "utf8")) : {};
      const { rounds: _r, totals: _t, maturity: _m, roundsCompleted: _c, errors: oldErrors = [], ...extra } = prev;
      extra.blockErrors ??= oldErrors.filter((e) => !String(e).startsWith("round "));
      const m = computeMetrics(dir, {
        ...extra,
        latestScanBefore: prev.maturity?.latestScanBefore ?? null,
        latestScanAfter: prev.maturity?.latestScanAfter ?? null,
      });
      fs.writeFileSync(path.join(dir, "metrics.json"), JSON.stringify(m, null, 2));
      writeReflectView(dir);
      console.log(JSON.stringify(m.totals, null, 2));
      return 0;
    }
    case "server": {
      const sub = argv[1];
      if (sub === "status") return (await serverStatus()) ? 0 : 3;
      if (sub === "start") return (await serverStart()) ? 0 : 3;
      if (sub === "stop") return (await serverStop()) ? 0 : 3;
      if (sub === "restart") return (await serverStop()) && (await serverStart()) ? 0 : 3;
      break;
    }
    case "status":
      await status();
      return 0;
    case "sweep": {
      // Manual leak sweep of one block: its recorded lane dirs that are no longer registered worktrees of
      // the Personas checkout (the lane ended and its worktree was removed or abandoned).
      const dir = path.resolve(argv[1] ?? "");
      const f = path.join(dir, "lane-dirs.json");
      if (!fs.existsSync(f)) {
        console.error(`no ${f}: this block recorded no lane worktrees`);
        return 2;
      }
      const live = new Set(personasWorktrees().map((w) => dirBase(w.dir).toLowerCase()));
      const bases = JSON.parse(fs.readFileSync(f, "utf8")).map((l) => l.base).filter((b) => LOOP_DIR_RE.test(b) && !live.has(b.toLowerCase()));
      const log = (t) => {
        const line = `[cycle ${new Date().toISOString().slice(11, 19)}] ${t}`;
        console.log(line);
        fs.appendFileSync(path.join(dir, "cycle.log"), `${line}\n`);
      };
      if (bases.length === 0) {
        console.log("nothing to sweep: every recorded lane dir is still a registered worktree, or none was recorded");
        return 0;
      }
      sweepDirs(bases, log, dir, "manual");
      return 0;
    }
    case "trend":
      requireProject();
      trend();
      return 0;
    case "ledger": {
      requireProject();
      // Re-append a block's section from its metrics.json (a block killed before it wrote one).
      const f = path.join(path.resolve(argv[1] ?? ""), "metrics.json");
      if (!fs.existsSync(f)) break;
      appendLedger(JSON.parse(fs.readFileSync(f, "utf8")));
      return 0;
    }
  }
  console.error("usage: node infinite.mjs block [--rounds 10] [--smoke] | metrics <dir> | trend | ledger <dir> | server status|start|stop|restart | status | sweep <dir>");
  return 2;
}

// Exit by setting exitCode, not process.exit(): exiting while a fetch socket is still closing tripped a
// libuv assertion after `server start` printed "HTTP 200" (the server stayed up; the caller saw a crash).
// The unref'd timer still ends a process that some handle would otherwise keep alive.
const finish = (code) => {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 2000).unref();
};
main().then(
  (code) => finish(code ?? 0),
  (e) => {
    console.error(e);
    finish(1);
  },
);
