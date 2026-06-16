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

  it("mirrors the per-org alert sink column (additive, 2026-06-12)", () => {
    expect(schema).toMatch(/alertWebhookUrl String\?/);
    expect(initSql).toMatch(/"alertWebhookUrl" TEXT/);
  });

  it("mirrors the CreditLedger idempotency key column + unique index (Polar billing, additive)", () => {
    expect(schema).toMatch(/externalId\s+String\?\s+@unique/);
    expect(initSql).toMatch(/"externalId" TEXT/);
    expect(initSql).toMatch(/CREATE UNIQUE INDEX "CreditLedger_externalId_key" ON "CreditLedger"\("externalId"\)/);
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

  it("makes the Scan dedup constraint a UNIQUE index (cross-instance same-commit backstop)", () => {
    expect(schema).toMatch(/@@unique\(\[repoId, headSha\]\)/);
    expect(initSql).toMatch(/CREATE UNIQUE INDEX "Scan_repoId_headSha_key" ON "Scan"\("repoId", "headSha"\)/);
  });
});
