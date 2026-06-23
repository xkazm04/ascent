// Node-only embedded-PGlite boot. Imported ONLY from src/instrumentation.ts, and ONLY when
// process.env.NEXT_RUNTIME === "nodejs" (via a guarded dynamic import) — so its node: + native
// imports never reach the Edge-runtime compile of instrumentation.ts (which would warn).
//
// Creates an in-process PGlite (Postgres-in-WASM), bootstraps the schema once from the test-enforced
// prisma/init.sql (no `prisma migrate` → avoids advisory locks PGlite lacks), and stashes a Prisma
// driver adapter on globalThis for src/lib/db/client.ts to use. See memory: local-dev-db-pglite.

import { resolve } from "node:path";
import { readFileSync, mkdirSync } from "node:fs";

export async function bootPglite(dataDir: string): Promise<void> {
  const g = globalThis as unknown as { __ascentPgliteAdapter?: unknown };
  if (g.__ascentPgliteAdapter) return; // already initialized (survives HMR)

  try {
    const { PGlite } = await import("@electric-sql/pglite");
    const { PrismaPGlite } = await import("pglite-prisma-adapter");

    const dir = resolve(process.cwd(), dataDir);
    mkdirSync(dir, { recursive: true }); // PGlite.create won't make missing parent dirs
    const pglite = await PGlite.create(dir);

    // Bootstrap once. prisma/init.sql uses plain CREATE TABLE (not IF NOT EXISTS), so gate on a known
    // table: exec only when the database is empty (first boot / after a wipe).
    const probe = await pglite.query(`SELECT to_regclass('public."Organization"') AS t`);
    const hasSchema = (probe.rows?.[0] as { t?: unknown } | undefined)?.t != null;
    if (!hasSchema) {
      const sql = readFileSync(resolve(process.cwd(), "prisma", "init.sql"), "utf8");
      await pglite.exec(sql);
      console.log("[pglite] schema bootstrapped from prisma/init.sql");
    }

    g.__ascentPgliteAdapter = new PrismaPGlite(pglite);
    console.log(`[pglite] embedded local DB ready (in-process) at ${dir}`);
  } catch (err) {
    console.error("[pglite] embedded DB init FAILED — falling back to no-DB:", err);
  }
}
