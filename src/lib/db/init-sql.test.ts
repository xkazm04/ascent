// Schema-drift guard for the documented psql bootstrap (biz-bug-scan-2026-06-11, persistence #4):
// prisma/init.sql declares itself a mirror of prisma/schema.prisma, but three 2026-06 waves left it
// six tables and two columns behind — the bootstrap built a database that 500'd the org dashboard
// and made the credit meter read a missing column as "out of credits". Pure file parse, no DB:
// every model in schema.prisma must have its CREATE TABLE in init.sql, and the public-org seed the
// app depends on (ensureOrgId reads instead of upserting the hot row) must survive regeneration.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
const initSql = readFileSync(join(root, "prisma", "init.sql"), "utf8");

const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]!);

describe("prisma/init.sql mirrors prisma/schema.prisma", () => {
  it("finds models to check (sanity)", () => {
    expect(models.length).toBeGreaterThanOrEqual(20);
    expect(models).toContain("Organization");
  });

  it.each(models)("has CREATE TABLE for model %s", (model) => {
    expect(initSql).toContain(`CREATE TABLE "${model}"`);
  });

  it("declares no table that schema.prisma lacks (a dropped model must leave the mirror too)", () => {
    const tables = [...initSql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]!);
    expect(tables.sort()).toEqual([...models].sort());
  });

  it("keeps the columns the 2026-06 drift lost", () => {
    expect(initSql).toMatch(/"scanCredits" INTEGER NOT NULL DEFAULT 0/);
    expect(initSql).toMatch(/"githubLogin"/);
  });

  // The 4 hardcoded column assertions above (scanCredits/githubLogin/alertWebhookUrl/externalId) only
  // catch the specific columns a PAST drift lost — the exact column-drift CLASS this suite exists to stop
  // (a NEW field added to schema.prisma but forgotten in init.sql) stays green for any OTHER column. Close
  // it with a generic per-model loop mirroring the index-parity checks: derive the expected columns from
  // schema.prisma (every scalar/enum field; relation fields emit NO column under relationMode="prisma")
  // and assert each appears inside that model's CREATE TABLE block in init.sql. (database-client-schema #4)
  it("mirrors every scalar column of every model into its CREATE TABLE block in init.sql", () => {
    const modelBlocks = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
    const modelSet = new Set(models);
    const missing: string[] = [];
    let checkedColumns = 0;

    for (const [, model, body] of modelBlocks) {
      // The model's CREATE TABLE column list — everything between the opening "(" and the closing ");".
      const tableMatch = new RegExp(`CREATE TABLE "${model}" \\(([\\s\\S]*?)\\n\\);`).exec(initSql);
      if (!tableMatch) {
        missing.push(`${model}: no CREATE TABLE block`);
        continue;
      }
      const tableBody = tableMatch[1]!;

      for (const rawLine of body!.split("\n")) {
        const line = rawLine.trim();
        if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
        const m = /^(\w+)\s+(\S+)/.exec(line);
        if (!m) continue;
        const field = m[1]!;
        // Strip nullability/array markers to the base type: `String?` `Membership[]` `OrgLlmConfig?`.
        const baseType = m[2]!.replace(/\?$/, "").replace(/\[\]$/, "").replace(/\?$/, "");
        // A relation field (type is another model, or the line carries @relation) emits NO column under
        // relationMode="prisma"; only the scalar FK field (e.g. `orgId String`) becomes a column.
        if (modelSet.has(baseType) || /@relation\b/.test(line)) continue;
        // Honor @map("col") if ever introduced (column name != field name); default is the field name.
        const mapped = /@map\("([^"]+)"\)/.exec(line);
        const column = mapped ? mapped[1]! : field;
        checkedColumns++;
        // Column names are emitted quoted (`"col" TYPE`), so a quoted match is exact (no prefix collision).
        if (!tableBody.includes(`"${column}"`)) missing.push(`${model}.${column}`);
      }
    }

    // Sanity: a parser regression matching no fields must not make this assertion vacuously pass.
    expect(checkedColumns).toBeGreaterThan(100);
    expect(missing).toEqual([]);
  });

  // The loop above checks column NAMES only, so a column present with the wrong type, wrong
  // nullability, or a lost DEFAULT (e.g. `"scanCredits" INTEGER` dropping its `DEFAULT 0` — the exact
  // symptom family of the original incident: credits initializing NULL, inserts failing NOT NULL)
  // stayed green. This closes the attribute half of the drift class (database-client-schema 07-16 #2):
  // map each Prisma scalar to its expected SQL type, assert `?`-ness ↔ NOT NULL, and assert a
  // representable `@default` (literal / now()) emits a DEFAULT. Client-side defaults (uuid()/cuid()/
  // autoincrement) emit NO SQL DEFAULT and are skipped, as is `@updatedAt` (maintained by the client).
  it("mirrors each column's TYPE, nullability, and DEFAULT into init.sql (attribute parity)", () => {
    const SQL_TYPE: Record<string, string> = {
      String: "TEXT",
      Int: "INTEGER",
      Boolean: "BOOLEAN",
      DateTime: "TIMESTAMP(3)",
      Float: "DOUBLE PRECISION",
      BigInt: "BIGINT",
    };
    const modelBlocks = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
    const modelSet = new Set(models);
    const problems: string[] = [];
    let checked = 0;

    for (const [, model, body] of modelBlocks) {
      const tableMatch = new RegExp(`CREATE TABLE "${model}" \\(([\\s\\S]*?)\\n\\);`).exec(initSql);
      if (!tableMatch) continue; // absence is already reported by the name-parity tests above
      const tableBody = tableMatch[1]!;

      for (const rawLine of body!.split("\n")) {
        const line = rawLine.trim();
        if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
        const m = /^(\w+)\s+(\S+)/.exec(line);
        if (!m) continue;
        const field = m[1]!;
        const rawType = m[2]!;
        const optional = /\?$/.test(rawType);
        const baseType = rawType.replace(/\?$/, "").replace(/\[\]$/, "").replace(/\?$/, "");
        if (modelSet.has(baseType) || /@relation\b/.test(line)) continue; // relation → no column
        const sqlType = SQL_TYPE[baseType];
        if (!sqlType) continue; // unmapped scalar (none today) — name parity above still covers it
        const mapped = /@map\("([^"]+)"\)/.exec(line);
        const column = mapped ? mapped[1]! : field;

        const colLine = tableBody
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l.startsWith(`"${column}" `));
        if (!colLine) continue; // missing column is already reported above
        checked++;

        // TYPE: the declaration must be exactly `"col" <SQLTYPE>` at the head of the line.
        if (!colLine.startsWith(`"${column}" ${sqlType}`)) {
          problems.push(`${model}.${column}: expected type ${sqlType} in: ${colLine}`);
        }
        // NULLABILITY: a required field must carry NOT NULL; an optional one must not.
        const hasNotNull = colLine.includes("NOT NULL");
        if (optional && hasNotNull) problems.push(`${model}.${column}: optional in schema but NOT NULL in init.sql`);
        if (!optional && !hasNotNull) problems.push(`${model}.${column}: required in schema but missing NOT NULL`);
        // DEFAULT: a representable @default (literal or now()) must emit a SQL DEFAULT. uuid()/cuid()/
        // autoincrement()/dbgenerated are client-/engine-side and emit none.
        const def = /@default\(([^)]*)\)/.exec(line);
        if (def && !/^(uuid|cuid|autoincrement|dbgenerated)\(/.test(def[1]!.trim())) {
          if (!colLine.includes("DEFAULT")) {
            problems.push(`${model}.${column}: @default(${def[1]}) in schema but no DEFAULT in init.sql`);
          }
        }
      }
    }

    // Sanity: a parser/mapping regression checking nothing must not vacuously pass.
    expect(checked).toBeGreaterThan(100);
    expect(problems).toEqual([]);
  });

  it("mirrors the per-org alert sink column (additive, 2026-06-12)", () => {
    // \s+ not a single space: `prisma format` column-aligns field types, so the gap width varies.
    expect(schema).toMatch(/alertWebhookUrl\s+String\?/);
    expect(initSql).toMatch(/"alertWebhookUrl" TEXT/);
  });

  it("mirrors the CreditLedger idempotency key column (Polar billing, additive)", () => {
    // The CreditLedger_externalId_key UNIQUE index itself is now covered by the generic
    // inline-@unique parity check below (no model-specific allow-listing).
    expect(schema).toMatch(/externalId\s+String\?\s+@unique/);
    expect(initSql).toMatch(/"externalId" TEXT/);
  });

  it("keeps the idempotent public-org seed regeneration must re-apply", () => {
    expect(initSql).toContain(`'public', 'Public Scans', 'free'`);
    expect(initSql).toContain(`ON CONFLICT ("slug") DO NOTHING`);
  });

  // relationMode="prisma" emits NO foreign keys, so indexes are the only thing making relation lookups
  // fast — a missing CREATE INDEX in the psql bootstrap degrades silently to a full-table scan with no
  // error. The table/column parity above never checked indexes; this closes that gap (finding #2).
  it("mirrors every @@index/@@unique into a matching CREATE INDEX in init.sql", () => {
    const modelBlocks = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
    const missing: string[] = [];
    for (const [, model, body] of modelBlocks) {
      const decls = [
        ...[...body!.matchAll(/@@index\(\[([^\]]+)\](?:,\s*(?:name|map):\s*"([^"]+)")?\)/g)].map(
          (m) => ({ cols: m[1]!, name: m[2], kind: "idx" as const }),
        ),
        ...[...body!.matchAll(/@@unique\(\[([^\]]+)\](?:,\s*(?:name|map):\s*"([^"]+)")?\)/g)].map(
          (m) => ({ cols: m[1]!, name: m[2], kind: "key" as const }),
        ),
      ];
      for (const d of decls) {
        const cols = d.cols.split(",").map((c) => c.trim());
        // Prisma's deterministic index-name convention: Table_col1_col2_idx / _key (unless overridden).
        const idxName = d.name ?? `${model}_${cols.join("_")}_${d.kind}`;
        if (!initSql.includes(`"${idxName}"`)) {
          missing.push(`${model}.@@${d.kind === "key" ? "unique" : "index"}([${cols.join(", ")}]) -> "${idxName}"`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  // The loop above only matches BLOCK-level @@index([...])/@@unique([...]). Prisma also emits a
  // CREATE UNIQUE INDEX for every INLINE single-field `@unique` field attribute (Organization.slug,
  // User.email, User.githubLogin, Invite.token, Subscription.orgId, CreditLedger.externalId) — the
  // identity-uniqueness + webhook-idempotency constraints. The old test never parsed inline @unique,
  // so a regenerated init.sql could silently drop e.g. Invite_token_key (webhook double-create) or
  // Organization_slug_key (breaking the public-org seed's ON CONFLICT) and stay green. This closes
  // that half of the drift hole with the SAME no-allow-listing rule as the block-level check (#2).
  it("mirrors every inline single-field @unique into a matching CREATE UNIQUE INDEX in init.sql", () => {
    const modelBlocks = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
    const inlineUniques: { model: string; field: string }[] = [];
    for (const [, model, body] of modelBlocks) {
      for (const line of body!.split("\n")) {
        const trimmed = line.trim();
        // Skip block-level @@unique([...]) / @@index([...]) — those are covered above.
        if (trimmed.startsWith("@@")) continue;
        // An inline field declaration carrying @unique: `field Type ... @unique` (and not @@unique).
        const m = /^(\w+)\s+\S+.*\B@unique\b/.exec(trimmed);
        if (m && !/@@unique/.test(trimmed)) {
          inlineUniques.push({ model: model!, field: m[1]! });
        }
      }
    }

    // Sanity: the 7 known inline @unique attributes must be discovered, so a parser regression that
    // matches nothing can't make this assertion vacuously pass. Adding one here is deliberate — a
    // single-field @unique is a schema invariant, and the point of pinning the list is that it
    // cannot grow without someone confirming the matching CREATE UNIQUE INDEX reached init.sql.
    expect(inlineUniques.map((u) => `${u.model}.${u.field}`).sort()).toEqual(
      [
        "CreditLedger.externalId",
        "Invite.token",
        "Organization.slug",
        "Subscription.orgId",
        // W1c: one transition programme per org — the constraint that makes "the org's current
        // commitment" a fact of the schema rather than a convention the read layer hopes for.
        "TransitionProgram.orgId",
        "User.email",
        "User.githubLogin",
      ].sort(),
    );

    const missing: string[] = [];
    for (const { model, field } of inlineUniques) {
      // Prisma's deterministic name for a single-field @unique: "<Model>_<field>_key".
      const idxName = `${model}_${field}_key`;
      const created = new RegExp(
        `CREATE UNIQUE INDEX "${idxName}" ON "${model}"\\("${field}"\\)`,
      ).test(initSql);
      if (!created) missing.push(`${model}.${field} -> CREATE UNIQUE INDEX "${idxName}"`);
    }
    expect(missing).toEqual([]);
  });

  it("makes the Scan dedup constraint a UNIQUE index (cross-instance same-commit backstop)", () => {
    expect(schema).toMatch(/@@unique\(\[repoId, headSha\]\)/);
    expect(initSql).toMatch(/CREATE UNIQUE INDEX "Scan_repoId_headSha_key" ON "Scan"\("repoId", "headSha"\)/);
  });
});
