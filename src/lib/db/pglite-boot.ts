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
  const g = globalThis as unknown as { __ascentPgliteAdapter?: unknown; __ascentPgliteBootError?: string };
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

    // Column-drift DETECTION runs BEFORE the exec, and that ordering is the whole point
    // (database-client-schema 07-16 #5, corrected 2026-07-29). The idempotent re-exec below fixes
    // new-TABLE/new-INDEX drift, but a NEW COLUMN on an existing table is skipped by CREATE TABLE IF
    // NOT EXISTS. Worse, an index that init.sql declares ON that column is NOT skipped — it runs and
    // throws 42703 `column "X" does not exist`, which aborts this whole function. The drift probe used
    // to sit AFTER the exec, so in the exact failure it exists to explain it never ran: the developer
    // saw a raw 42703, then — because the adapter below is never assigned and Prisma silently falls
    // back to the dummy DATABASE_URL — a totally misleading `P1001 Can't reach database server at
    // 127.0.0.1:5432`. Probing first means the cause is named even when the exec dies.
    // Detection only — the no-auto-ALTER decision stands (a blind ALTER of a NOT-NULL-without-default
    // column would itself fail on a populated dev table). Best-effort: a probe failure never breaks boot.
    if (!firstBoot) await reportColumnDrift(pglite, rawSql, dir);

    await pglite.exec(sql);
    console.log(
      firstBoot
        ? "[pglite] schema bootstrapped from prisma/init.sql"
        : "[pglite] schema ensured from prisma/init.sql (idempotent; new tables/indexes applied)",
    );

    g.__ascentPgliteAdapter = new PrismaPGlite(pglite);
    g.__ascentPgliteBootError = undefined; // a prior failed boot (if any) is now healed
    console.log(`[pglite] embedded local DB ready (in-process) at ${dir}`);
  } catch (err) {
    // database-client-schema #5: a swallowed console.error alone let the app run as a confusing NO-DB build
    // (every DB read silently empty) behind one log line — easy to miss and hard to diagnose. Record the
    // failure on globalThis so it is OBSERVABLE (a health endpoint / diagnostic can read
    // __ascentPgliteBootError and report "local DB failed to boot" instead of "no data"), and shout on the
    // console. (NOTE: a NEW COLUMN added to init.sql still won't reach an EXISTING .pglite dir — the boot
    // rewrites CREATE TABLE → CREATE TABLE IF NOT EXISTS, which skips the existing table; that column-level
    // reconcile is left out deliberately, since a blind ALTER … ADD COLUMN of a NOT-NULL-without-default
    // column would itself fail on a populated dev table. The cure remains a data-dir wipe or a hand-written
    // ALTER, as documented on the exec above.)
    const message = err instanceof Error ? err.message : String(err);
    g.__ascentPgliteBootError = message;
    console.error("[pglite] embedded DB init FAILED — running as NO-DB (reads will be empty):", err);
  }
}

/**
 * Compare the columns `prisma/init.sql` declares against the columns the data dir actually has, and
 * name any that are missing. Called BEFORE the idempotent exec so the diagnosis survives an exec that
 * dies on an index over a missing column — see the call site for why that ordering matters.
 *
 * Best-effort by contract: this is a diagnostic, so any failure inside it is swallowed with a warning
 * rather than taking down a boot that would otherwise have succeeded.
 */
async function reportColumnDrift(
  pglite: { query: (sql: string) => Promise<{ rows: unknown[] }> },
  rawSql: string,
  dir: string,
): Promise<void> {
  try {
    const expected = new Map<string, string[]>();
    for (const t of rawSql.matchAll(/CREATE TABLE "(\w+)" \(([\s\S]*?)\n\);/g)) {
      // Column declaration lines start with a quoted identifier; CONSTRAINT lines don't match.
      expected.set(t[1]!, [...t[2]!.matchAll(/^\s*"(\w+)"/gm)].map((c) => c[1]!));
    }
    const res = await pglite.query(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
    );
    const actual = new Map<string, Set<string>>();
    for (const row of res.rows as { table_name: string; column_name: string }[]) {
      let set = actual.get(row.table_name);
      if (!set) actual.set(row.table_name, (set = new Set()));
      set.add(row.column_name);
    }
    const drift: string[] = [];
    for (const [table, cols] of expected) {
      const have = actual.get(table);
      if (!have) continue; // a missing table is the class the re-exec already handles
      const missing = cols.filter((c) => !have.has(c));
      if (missing.length) drift.push(`"${table}" is missing [${missing.join(", ")}]`);
    }
    if (drift.length) {
      console.error(
        `[pglite] SCHEMA DRIFT: ${drift.join("; ")} — column(s) added to prisma/init.sql AFTER this ` +
          `data dir was created (CREATE TABLE IF NOT EXISTS skips existing tables). Apply the pending ` +
          `migration(s) under prisma/migrations/ to ${dir} with ALTER TABLE ... ADD COLUMN IF NOT EXISTS, ` +
          `or wipe the data dir. Until then the boot itself may abort: an index declared over a missing ` +
          `column throws 42703, which leaves the adapter uninstalled and surfaces as a misleading ` +
          `"P1001 Can't reach database server".`,
      );
    }
  } catch (probeErr) {
    console.warn("[pglite] column-drift probe failed (non-fatal):", probeErr);
  }
}
