// Embedded local-dev Postgres: a file-backed PGlite instance (Postgres-in-WASM) exposed over the
// Postgres wire protocol so Prisma can connect via a normal DATABASE_URL — no Postgres install, no
// Prisma code change. See docs in the plan / BRAND-less infra note.
//
//   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54321/postgres?connection_limit=1
//
// Schema is bootstrapped once from prisma/init.sql (the test-enforced consolidated CREATE TABLE
// script) — avoiding `prisma migrate`, which needs Postgres advisory locks that PGlite lacks.
//
// Usage: node scripts/pglite-server.mjs   (long-running; Ctrl-C to stop)

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readFileSync, mkdirSync } from "fs";
import { resolve } from "path";

const DATA_DIR = resolve(process.cwd(), ".pglite", "ascent");
const PORT = Number(process.env.PGLITE_PORT) || 54321;
const HOST = process.env.PGLITE_HOST || "127.0.0.1";

mkdirSync(resolve(process.cwd(), ".pglite"), { recursive: true });

const db = await PGlite.create(DATA_DIR);

// Bootstrap the schema once. prisma/init.sql uses plain `CREATE TABLE` (not IF NOT EXISTS), so gate on
// a known table: exec only when the database is empty (first boot / after a wipe).
const probe = await db.query(`SELECT to_regclass('public."Organization"') AS t`);
const hasSchema = probe.rows?.[0]?.t != null;
if (!hasSchema) {
  const sql = readFileSync(resolve(process.cwd(), "prisma", "init.sql"), "utf8");
  await db.exec(sql);
  process.stderr.write("[pglite] schema bootstrapped from prisma/init.sql\n");
} else {
  process.stderr.write("[pglite] schema already present\n");
}

const server = new PGLiteSocketServer({ db, port: PORT, host: HOST });
await server.start();
process.stderr.write(`[pglite] listening on ${HOST}:${PORT}  (data: ${DATA_DIR})\n`);

async function shutdown() {
  try { await server.stop(); } catch {}
  try { await db.close(); } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
