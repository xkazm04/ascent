// The migration chain must BUILD the schema init.sql builds (db-client, challenge 2026-10-22f).
//
// Two roads reach Ascent's schema: prisma/init.sql (dev PGlite, psql bootstrap) and the committed
// prisma/migrations chain (`prisma migrate deploy`: self-hosting and the production buildCommand).
// init-sql.test.ts guards only the first, so 26 models reached schema.prisma with no migration and a
// fresh deploy halted at 20260831120000 ("LaneItemOutcome" does not exist), 56 columns and 4 indexes
// short. This file replays the WHOLE chain from empty into an in-process PGlite, builds a second store
// from init.sql, and diffs normalized schema dumps. Nothing here touches a real database.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  additivityViolations,
  diffSchemaDumps,
  formatSchemaDump,
  modelsWithoutMigration,
  nonIdempotentStatements,
  SCHEMA_DUMP_QUERIES,
} from "./migration-chain-model";

const root = process.cwd();
const migrationsDir = join(root, "prisma", "migrations");
const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
const initSql = readFileSync(join(root, "prisma", "init.sql"), "utf8");
const steps = readdirSync(migrationsDir)
  .filter((d) => existsSync(join(migrationsDir, d, "migration.sql")))
  .sort();
const stepSql = (d: string) => readFileSync(join(migrationsDir, d, "migration.sql"), "utf8");
const CATCH_UPS = ["20260831115900_catch_up_unmigrated_tables", "20261024120000_catch_up_unmigrated_columns"];

async function dump(db: PGlite): Promise<string> {
  const [tables, columns, indexes] = await Promise.all([
    db.query<Record<string, unknown>>(SCHEMA_DUMP_QUERIES.tables),
    db.query<Record<string, unknown>>(SCHEMA_DUMP_QUERIES.columns),
    db.query<Record<string, unknown>>(SCHEMA_DUMP_QUERIES.indexes),
  ]);
  return formatSchemaDump({ tables: tables.rows, columns: columns.rows, indexes: indexes.rows });
}

async function fromInitSql(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(initSql);
  return db;
}

let chainDump = "";
let initDump = "";
const replayFailures: string[] = [];

beforeAll(async () => {
  const chain = new PGlite();
  for (const d of steps) {
    try {
      await chain.exec(stepSql(d));
    } catch (err) {
      replayFailures.push(`${d}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  chainDump = await dump(chain);
  initDump = await dump(await fromInitSql());
  await chain.close();
}, 180_000);

describe("the migration chain builds the schema init.sql builds", () => {
  it("replays every migration in name order from an empty database without a failing step", () => {
    expect(steps.length).toBeGreaterThan(80);
    expect(replayFailures).toEqual([]);
  });

  it("dumps the same tables, columns and indexes from the chain as from init.sql", () => {
    expect(chainDump.split("\n").filter((l) => l.startsWith("table ")).length).toBeGreaterThan(80);
    expect(diffSchemaDumps(initDump, chainDump)).toEqual([]);
  });

  it("names a seeded missing column (the comparison bites)", async () => {
    const db = await fromInitSql();
    await db.exec(`ALTER TABLE "Repository" DROP COLUMN "forge"`);
    const diff = diffSchemaDumps(chainDump, await dump(db));
    await db.close();
    expect(diff.some((l) => l.startsWith("- column Repository.forge "))).toBe(true);
    expect(diff.some((l) => l.startsWith("- index Repository_orgId_forge_idx "))).toBe(true);
  }, 60_000);
});

describe("every schema model has a CREATE TABLE in the chain", () => {
  const chainSql = steps.map(stepSql).join("\n");

  it("leaves no model without a migration", () => {
    expect(modelsWithoutMigration(schema, chainSql)).toEqual([]);
  });

  it("reports a seeded model with no migration (the matcher bites)", () => {
    const seeded = `${schema}\nmodel Foo {\n  id String @id\n}\n`;
    expect(modelsWithoutMigration(seeded, chainSql)).toEqual(["Foo"]);
  });

  it("does not count a CREATE TABLE that only appears in a comment", () => {
    expect(modelsWithoutMigration("model Bar {\n}\n", `-- CREATE TABLE "Bar" (`)).toEqual(["Bar"]);
  });
});

describe("the catch-up steps are additive and re-runnable", () => {
  it.each(CATCH_UPS)("%s exists and sorts where the chain needs it", (d) => {
    expect(steps).toContain(d);
  });

  it("dates the table catch-up before the first step that ALTERs one of its tables", () => {
    expect(steps.indexOf(CATCH_UPS[0]!)).toBe(steps.indexOf("20260831120000_add_lane_outcome_verified_at") - 1);
    expect(steps.at(-1)! >= CATCH_UPS[1]!).toBe(true);
  });

  it.each(CATCH_UPS)("%s carries no DROP / DELETE / UPDATE / TRUNCATE / SET DEFAULT / ADD CONSTRAINT / ALTER TYPE", (d) => {
    expect(additivityViolations(stepSql(d))).toEqual([]);
    expect(nonIdempotentStatements(stepSql(d))).toEqual([]);
  });

  it("the additivity check rejects each banned kind and ignores prose and literals", () => {
    expect(additivityViolations(`ALTER TABLE "A" DROP COLUMN "b";`)).toEqual(["DROP"]);
    expect(additivityViolations(`ALTER TABLE "A" ALTER COLUMN "b" SET DEFAULT 1;`)).toEqual(["SET DEFAULT"]);
    expect(additivityViolations(`ALTER TABLE "A" ADD CONSTRAINT "c" UNIQUE ("b");`)).toEqual(["ADD CONSTRAINT"]);
    expect(additivityViolations(`ALTER TABLE "A" ALTER COLUMN "b" TYPE INTEGER;`)).toEqual(["ALTER ... TYPE"]);
    expect(additivityViolations(`ALTER TYPE "Kind" ADD VALUE 'x';`)).toEqual(["ALTER TYPE"]);
    expect(additivityViolations(`DELETE FROM "A"; UPDATE "A" SET b = 1; TRUNCATE "A";`)).toEqual([
      "DELETE",
      "UPDATE",
      "TRUNCATE",
    ]);
    expect(additivityViolations(`-- DROP TABLE "A"\nALTER TABLE "A" ADD COLUMN IF NOT EXISTS "b" TEXT DEFAULT 'drop';`)).toEqual([]);
    expect(nonIdempotentStatements(`CREATE TABLE "A" (x TEXT); CREATE INDEX "i" ON "A"(x);`)).toHaveLength(2);
  });

  it("running both catch-ups TWICE on an init.sql-built database leaves the schema dump byte-identical", async () => {
    const db = await fromInitSql();
    const before = await dump(db);
    for (let pass = 0; pass < 2; pass++) {
      for (const d of CATCH_UPS) await db.exec(stepSql(d));
    }
    const after = await dump(db);
    await db.close();
    expect(after).toBe(before);
  }, 60_000);
});
