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

    // Bootstrap idempotently on EVERY boot. The old gate ran init.sql only when the "Organization"
    // table was absent (a virgin DB), so any LATER schema change — a new table or index added to
    // init.sql — never reached an existing local .pglite dir, and the next query against it threw
    // "relation does not exist" with nothing pointing at the cause (the only cure was wiping the data
    // dir). init.sql uses plain CREATE TABLE / CREATE INDEX; rewrite those to "... IF NOT EXISTS" so the
    // script is safe to re-run, then exec it every boot. Existing tables/indexes and the public-org seed
    // (already ON CONFLICT DO NOTHING) are untouched; newly-added tables + indexes now appear WITHOUT a
    // wipe. (A new COLUMN on an existing table still needs a wipe — CREATE TABLE IF NOT EXISTS skips the
    // table — but new tables/indexes were the dominant foot-gun.)
    const rawSql = readFileSync(resolve(process.cwd(), "prisma", "init.sql"), "utf8");
    const sql = rawSql
      .replace(/CREATE TABLE (?!IF NOT EXISTS)/g, "CREATE TABLE IF NOT EXISTS ")
      .replace(/CREATE UNIQUE INDEX (?!IF NOT EXISTS)/g, "CREATE UNIQUE INDEX IF NOT EXISTS ")
      .replace(/CREATE INDEX (?!IF NOT EXISTS)/g, "CREATE INDEX IF NOT EXISTS ");
    const probe = await pglite.query(`SELECT to_regclass('public."Organization"') AS t`);
    const firstBoot = (probe.rows?.[0] as { t?: unknown } | undefined)?.t == null;
    await pglite.exec(sql);
    console.log(
      firstBoot
        ? "[pglite] schema bootstrapped from prisma/init.sql"
        : "[pglite] schema ensured from prisma/init.sql (idempotent; new tables/indexes applied)",
    );

    g.__ascentPgliteAdapter = new PrismaPGlite(pglite);
    console.log(`[pglite] embedded local DB ready (in-process) at ${dir}`);
  } catch (err) {
    console.error("[pglite] embedded DB init FAILED — falling back to no-DB:", err);
  }
}
