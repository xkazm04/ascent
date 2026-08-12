#!/usr/bin/env node
// dev-empty — reproducible EMPTY-tenant dev server (`npm run dev:empty`).
//
// Boots a SECOND `next dev` beside the normal one, pointed at a throwaway PGlite data dir, so the
// new-user onboarding flow can be exercised against a schema-only, zero-row database every time:
//
//   port      3005                  (normal dev is 3000; 3001 is reserved by convention — the seed
//                                    scripts `seed-scans.mjs` / `seed-org-extras.mjs` / `proto-shot.mjs`
//                                    all default to localhost:3001 as the POPULATED dev server, and
//                                    must never accidentally seed the empty tenant. Override:
//                                    ASCENT_EMPTY_PORT=…)
//   data dir  .pglite/ascent-empty  (wiped on every launch; the normal .pglite/ascent is NEVER touched.
//                                    src/instrumentation.ts → src/lib/db/pglite-boot.ts re-runs
//                                    prisma/init.sql idempotently on boot, so a freshly wiped dir comes
//                                    up with the full schema and zero rows — no db:push needed, and a
//                                    stale/schema-less dir can't crash boot.)
//   distDir   .next-empty           (next.config.ts switches on ASCENT_EMPTY=1, so the build cache
//                                    never collides with the normal server's .next)
//   env       ASCENT_EMPTY=1        (seed gate — src/lib/dev/empty-gate.ts `emptyTenantEnabled()`;
//                                    any future automatic dev seeding must consult it)
//             PGLITE_DATA_DIR=.pglite/ascent-empty
//                                   (set as REAL process env, which Next's .env loading never
//                                    overrides — .env.local's .pglite/ascent stays inert here)
//
// Reaching "signed-in user with EMPTY org" (the onboarding entry state):
//   .env.local already carries ASCENT_AUTH_BYPASS=1 (synthetic "developer" viewer — every auth gate
//   passes; hard-disabled in production builds, see src/lib/env.ts) and ASCENT_OPEN_ORG_DASHBOARDS=1
//   (org reads open on a DB-on/auth-off box). Both are inherited by this server, so the recommended
//   combo is simply:
//
//       npm run dev:empty          → http://localhost:3005  (signed-in developer, zero orgs/scans)
//       npm run dev:empty -- --keep  → same, but PRESERVES the DB from the last run (second-visit /
//                                      returning-user testing)
//
//   To exercise the REAL Supabase sign-in against the empty tenant instead, set ASCENT_AUTH_BYPASS=0
//   in the environment before launching (Supabase URL/anon key stay configured via .env.local).
//
// Stale-instance reaping: a previous dev:empty that wasn't shut down would hold both the port and
// PGlite's data-dir lock. We kill prior instances by COMMAND-LINE SIGNATURE only (this script's name,
// or `next dev` carrying our port) — never by bare process name, so the normal dev server and other
// node processes are untouched.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const PORT = Number(process.env.ASCENT_EMPTY_PORT) || 3005;
const DATA_DIR_REL = ".pglite/ascent-empty";
const DATA_DIR = resolve(ROOT, DATA_DIR_REL);
const KEEP = process.argv.includes("--keep");

// ── Safety rail: refuse to operate on anything but the throwaway dir ─────────────────────────────
if (!DATA_DIR.endsWith(`${sep}.pglite${sep}ascent-empty`)) {
  console.error(`[dev-empty] refusing to touch unexpected data dir: ${DATA_DIR}`);
  process.exit(1);
}

// ── 1. Reap stale prior dev:empty instances (by command-line signature, never by name) ───────────
function reapStale() {
  const self = String(process.pid);
  if (process.platform === "win32") {
    // Find node processes whose command line carries our signature: this script, or a `next dev`
    // holding our port. taskkill /T takes each one's process tree (next dev spawns a server child).
    const ps = [
      `Get-CimInstance Win32_Process -Filter "Name='node.exe'" |`,
      `Where-Object { $_.ProcessId -ne ${self} -and $_.CommandLine -and (`,
      `  $_.CommandLine -like '*dev-empty.mjs*' -or`,
      `  ($_.CommandLine -like '*next*dev*' -and $_.CommandLine -like '*--port ${PORT}*')`,
      `) } | Select-Object -ExpandProperty ProcessId`,
    ].join(" ");
    const out = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
      encoding: "utf8",
    });
    const pids = (out.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s) && s !== self);
    for (const pid of pids) {
      console.log(`[dev-empty] reaping stale instance pid ${pid}`);
      spawnSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore" });
    }
  } else {
    // POSIX: pkill -f matches the full command line (signature-scoped), never a bare name.
    // Our own process doesn't match either pattern's `node …` prefix requirement is not guaranteed,
    // so exclude self via the port-carrying pattern plus an explicit script-name pattern minus us.
    spawnSync("pkill", ["-f", `next dev --port ${PORT}`], { stdio: "ignore" });
    spawnSync("bash", ["-c", `pgrep -f 'dev-empty\\.mjs' | grep -v '^${self}$' | xargs -r kill -9`], {
      stdio: "ignore",
    });
  }
}
reapStale();

// ── 2. Wipe the throwaway PGlite dir (unless --keep) ─────────────────────────────────────────────
if (KEEP) {
  console.log(`[dev-empty] --keep: preserving ${DATA_DIR_REL} from the previous run`);
} else if (existsSync(DATA_DIR)) {
  try {
    // Retries cover the transient EPERM/EBUSY Windows throws while a just-killed process (or
    // Defender's on-access scan — a known PGlite-dir foot-gun on this machine) still holds handles.
    rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    console.log(`[dev-empty] wiped ${DATA_DIR_REL} (fresh empty tenant)`);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : "";
    console.error(`[dev-empty] could not wipe ${DATA_DIR_REL} (${code}): ${err?.message ?? err}`);
    if (code === "EPERM" || code === "EBUSY") {
      console.error(
        "[dev-empty] a process still holds the dir (a live dev:empty? Defender on-access scan?).\n" +
          "  - close any other dev:empty window and re-run\n" +
          "  - or add a Windows Defender exclusion for the .pglite directory\n" +
          "  - or pass --keep to reuse the existing DB without wiping",
      );
    }
    process.exit(1);
  }
} else {
  console.log(`[dev-empty] ${DATA_DIR_REL} absent — starting from a virgin dir`);
}

// ── 3. Launch next dev on the isolated port/distDir/data dir ─────────────────────────────────────
const nextBin = resolve(ROOT, "node_modules", "next", "dist", "bin", "next");
console.log(`[dev-empty] starting next dev on http://localhost:${PORT}  (distDir .next-empty, db ${DATA_DIR_REL})`);
const child = spawn(process.execPath, [nextBin, "dev", "--port", String(PORT)], {
  cwd: ROOT,
  stdio: "inherit",
  env: {
    ...process.env,
    ASCENT_EMPTY: "1",
    PGLITE_DATA_DIR: DATA_DIR_REL, // real process env → wins over .env.local's .pglite/ascent
  },
});

child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    try {
      child.kill(sig);
    } catch {}
  });
}
