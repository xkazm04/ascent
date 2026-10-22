// The pure half of the migration-chain convergence guard (src/lib/db/migration-chain.test.ts).
//
// Ascent has two roads to its schema: prisma/init.sql (embedded PGlite in dev, the psql bootstrap)
// and the committed prisma/migrations chain (`prisma migrate deploy`: self-hosting and the production
// buildCommand). init-sql.test.ts holds init.sql to schema.prisma, but nothing held the chain to
// either, so 26 models reached the schema with no migration and a fresh `migrate deploy` halted at
// 20260831120000. These helpers are what the guard compares with: a static "every model has a
// CREATE TABLE in some migration" check, an additivity check for catch-up steps, and a normalized
// schema dump so two databases built by the two roads can be diffed line by line.
// No I/O and no database here; the test owns the PGlite stores.

/** Remove `-- line` and block comments, so prose that names a table or a verb never counts. */
export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

/** Blank out single-quoted literals (a DEFAULT 'drop' must not read as DROP). */
export function stripSqlLiterals(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}

/** Code only: comments stripped first (a quote inside a comment cannot open a literal), then literals. */
export function sqlCode(sql: string): string {
  return stripSqlLiterals(stripSqlComments(sql));
}

/** Model names declared in schema.prisma, in declaration order. */
export function schemaModels(schema: string): string[] {
  return [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]!);
}

/** Tables some migration creates, read from code only (comments and literals stripped). */
export function migratedTables(migrationSql: string): Set<string> {
  const code = sqlCode(migrationSql);
  return new Set([...code.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"(\w+)"/gi)].map((m) => m[1]!));
}

/** Models with no CREATE TABLE anywhere in the chain: each one is a table `migrate deploy` never builds. */
export function modelsWithoutMigration(schema: string, migrationSql: string): string[] {
  const tables = migratedTables(migrationSql);
  return schemaModels(schema).filter((m) => !tables.has(m));
}

/**
 * Statements a catch-up step must never carry. A catch-up runs against databases that already have
 * some or all of its objects, so it may only ADD; anything that rewrites, removes or tightens is a
 * different kind of migration and belongs in its own reviewed step.
 */
export const CATCH_UP_BANNED: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: "DROP", re: /\bDROP\b/i },
  { label: "DELETE", re: /\bDELETE\b/i },
  { label: "UPDATE", re: /\bUPDATE\b/i },
  { label: "TRUNCATE", re: /\bTRUNCATE\b/i },
  { label: "SET DEFAULT", re: /\bSET\s+DEFAULT\b/i },
  { label: "ADD CONSTRAINT", re: /\bADD\s+CONSTRAINT\b/i },
  { label: "ALTER ... TYPE", re: /\bALTER\s+(?:COLUMN\s+)?(?:"\w+"|\w+)\s+(?:SET\s+DATA\s+)?TYPE\b/i },
  { label: "ALTER TYPE", re: /\bALTER\s+TYPE\b/i },
];

/** Labels of every banned statement kind present in the code of `sql` (comments and literals ignored). */
export function additivityViolations(sql: string): string[] {
  const code = sqlCode(sql);
  return CATCH_UP_BANNED.filter(({ re }) => re.test(code)).map(({ label }) => label);
}

/** CREATE TABLE / CREATE INDEX / ADD COLUMN statements that lack IF NOT EXISTS (not safe to re-run). */
export function nonIdempotentStatements(sql: string): string[] {
  return sqlCode(sql)
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => /^(CREATE (UNIQUE )?INDEX|CREATE TABLE)\b/i.test(s) || /\bADD COLUMN\b/i.test(s))
    .filter((s) => !/\bIF NOT EXISTS\b/i.test(s))
    .map((s) => s.slice(0, 120));
}

/** The three catalog reads a schema dump is built from (public schema only). */
export const SCHEMA_DUMP_QUERIES = {
  tables: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  columns: `SELECT table_name, column_name, udt_name, is_nullable, column_default, character_maximum_length, numeric_precision, datetime_precision
            FROM information_schema.columns WHERE table_schema = 'public'`,
  indexes: `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`,
} as const;

type Row = Record<string, unknown>;
export interface SchemaDumpRows {
  tables: Row[];
  columns: Row[];
  indexes: Row[];
}

const s = (v: unknown) => (v === null || v === undefined ? "-" : String(v));

/**
 * One sorted line per table, column (type, nullability, default, precision) and index (name and
 * definition). Order-free on purpose: the two roads add columns in different orders, and column
 * position is not part of the contract the app reads.
 */
export function formatSchemaDump(rows: SchemaDumpRows): string {
  const lines = [
    ...rows.tables.map((r) => `table ${s(r.table_name)}`),
    ...rows.columns.map(
      (r) =>
        `column ${s(r.table_name)}.${s(r.column_name)} ${s(r.udt_name)}` +
        ` len=${s(r.character_maximum_length)} prec=${s(r.numeric_precision)} dt=${s(r.datetime_precision)}` +
        ` null=${s(r.is_nullable)} default=${s(r.column_default)}`,
    ),
    ...rows.indexes.map((r) => `index ${s(r.indexname)} ${s(r.indexdef)}`),
  ];
  return lines.sort().join("\n");
}

/** Lines only in `a` (prefixed "-") and only in `b` (prefixed "+"). Empty means the two converge. */
export function diffSchemaDumps(a: string, b: string): string[] {
  const left = new Set(a.split("\n"));
  const right = new Set(b.split("\n"));
  return [
    ...[...left].filter((l) => !right.has(l)).map((l) => `- ${l}`),
    ...[...right].filter((l) => !left.has(l)).map((l) => `+ ${l}`),
  ];
}
