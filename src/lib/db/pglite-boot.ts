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
    // It now REPAIRS the drift it can (nullable / defaulted columns) instead of only naming it, and
    // still reports NOT-NULL-without-default columns for a human — those are the ones a blind ALTER
    // would fail on, which was the original reason to detect only. Running before the exec also means
    // the repair lands ahead of the index that would otherwise throw 42703.
    // Best-effort: a reconcile failure never breaks boot.
    if (!firstBoot) await reconcileColumnDrift(pglite, rawSql, dir);

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
    // console. (NOTE: a NEW COLUMN added to init.sql does NOT reach an existing .pglite dir through this
    // exec — the boot rewrites CREATE TABLE → CREATE TABLE IF NOT EXISTS, which skips the existing table.
    // reconcileColumnDrift above now ADDs the nullable/defaulted ones for you; a NOT-NULL-without-default
    // column still needs a data-dir wipe or a hand-written ALTER, and says so by name.)
    const message = err instanceof Error ? err.message : String(err);
    g.__ascentPgliteBootError = message;
    console.error("[pglite] embedded DB init FAILED — running as NO-DB (reads will be empty):", err);
  }
}

/**
 * Reconcile the columns `prisma/init.sql` declares against the columns the data dir actually has:
 * ADD the ones that are safe to add, and name the ones that aren't. Called BEFORE the idempotent exec
 * so the repair lands ahead of an exec that would otherwise die on an index over a missing column —
 * see the call site for why that ordering matters.
 *
 * WHY THIS ADDS COLUMNS AND NOT JUST A WARNING. `CREATE TABLE IF NOT EXISTS` skips a table that
 * already exists, so every column added to init.sql after a data dir was created is invisible to the
 * exec. The old behavior printed an accurate diagnosis and stopped there, which meant a stale dev DB
 * kept serving `column X does not exist` on every request until someone read the log and hand-wrote an
 * ALTER. The failure it produces is badly misleading, too: an index over the missing column throws
 * 42703, the adapter never installs, and the app reports "P1001 Can't reach database server" about a
 * database it is already connected to.
 *
 * SAFE means nullable, or NOT NULL with a DEFAULT — the two shapes Postgres can add to a populated
 * table without inventing values. A NOT-NULL-without-default column is left alone and reported: there
 * is no correct value to backfill, and guessing one would put fabricated data in a dev DB. That was
 * the original objection to reconciling here, and it is still right — it just doesn't apply to the
 * nullable columns that are the overwhelming majority of what drifts.
 *
 * Best-effort by contract: any failure inside is swallowed with a warning rather than taking down a
 * boot that would otherwise have succeeded.
 */
async function reconcileColumnDrift(
  pglite: { query: (sql: string) => Promise<{ rows: unknown[] }> },
  rawSql: string,
  dir: string,
): Promise<void> {
  try {
    // name → the rest of its declaration (type + modifiers), so a missing column can be re-declared
    // verbatim rather than guessed at.
    const expected = new Map<string, Map<string, string>>();
    for (const t of rawSql.matchAll(/CREATE TABLE "(\w+)" \(([\s\S]*?)\n\);/g)) {
      // Column declaration lines start with a quoted identifier; CONSTRAINT lines don't match.
      const cols = new Map<string, string>();
      for (const c of t[2]!.matchAll(/^\s*"(\w+)"[ \t]+([^\n]*?),?[ \t]*$/gm)) cols.set(c[1]!, c[2]!.trim());
      expected.set(t[1]!, cols);
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

    const added: string[] = [];
    const manual: string[] = [];
    for (const [table, cols] of expected) {
      const have = actual.get(table);
      if (!have) continue; // a missing table is the class the re-exec already handles
      for (const [col, decl] of cols) {
        if (have.has(col)) continue;
        // Nullable, or NOT NULL with a DEFAULT — anything else has no value to backfill.
        const safe = !/\bNOT\s+NULL\b/i.test(decl) || /\bDEFAULT\b/i.test(decl);
        if (!safe) {
          manual.push(`"${table}"."${col}" (${decl})`);
          continue;
        }
        try {
          await pglite.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${col}" ${decl}`);
          added.push(`"${table}"."${col}"`);
        } catch (alterErr) {
          manual.push(`"${table}"."${col}" (ALTER failed: ${alterErr instanceof Error ? alterErr.message : String(alterErr)})`);
        }
      }
    }

    if (added.length) {
      console.warn(`[pglite] schema drift repaired — added ${added.join(", ")} to ${dir}.`);
    }
    if (manual.length) {
      console.error(
        `[pglite] SCHEMA DRIFT needs a hand: ${manual.join("; ")}. These are NOT-NULL columns without a ` +
          `default, so there is no value to backfill on an existing row. Apply the pending migration(s) ` +
          `under prisma/migrations/ to ${dir} yourself, or wipe the data dir and re-seed. Until then the ` +
          `boot may abort on an index over the missing column (42703), which surfaces as a misleading ` +
          `"P1001 Can't reach database server".`,
      );
    }
  } catch (probeErr) {
    console.warn("[pglite] column-drift reconcile failed (non-fatal):", probeErr);
  }
}
