// Local dev launcher: runs the embedded PGlite server (scripts/pglite-server.mjs) alongside
// `next dev`, so a single `npm run dev:local` gives a working DB-backed app with no Postgres install.
// Next connects to the DB lazily, so a short head start is enough for the socket to be listening.

import { spawn } from "node:child_process";

const procs = [];
let shuttingDown = false;

function run(cmd, args, name) {
  const p = spawn(cmd, args, { stdio: "inherit", shell: true });
  procs.push(p);
  p.on("exit", (code) => {
    if (!shuttingDown) {
      process.stderr.write(`[dev-local] ${name} exited (${code}); shutting down.\n`);
      shutdown();
    }
  });
  return p;
}

function shutdown() {
  shuttingDown = true;
  for (const p of procs) {
    try { p.kill(); } catch {}
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

run("node", ["scripts/pglite-server.mjs"], "pglite");
setTimeout(() => run("npx", ["next", "dev"], "next"), 1500);
