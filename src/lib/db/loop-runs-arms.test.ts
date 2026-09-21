// THE ARM COLUMNS, AS A SHAPE (spark local-model-lanes, 2026-09-21).
//
// The migration's one promise is that every existing row keeps its exact current meaning: nothing is
// backfilled, nothing is defaulted, and a reader that finds no arm reads UNKNOWN rather than a
// fabricated "claude". That promise lives in two places — the SQL, and the projection that turns a
// row into the record every surface reads — so it is asserted in both.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toLaneRecord, toRunRecord, asModelPolicy } from "@/lib/db/loop-runs-types";

const MIGRATION = join(process.cwd(), "prisma", "migrations", "20260921120000_add_arms_and_transports", "migration.sql");

const runRow = (over: Record<string, unknown> = {}) => ({
  id: "r1", orgId: "o1", createdBy: null, phase: "done", reposJson: JSON.stringify(["a/b"]),
  concurrency: 2, maxCycles: 3, cycle: 1, curated: false,
  startedAt: new Date("2026-09-21T00:00:00Z"), endedAt: null, error: null, createdAt: new Date("2026-09-21T00:00:00Z"),
  ...over,
});

const laneRow = (over: Record<string, unknown> = {}) => ({
  id: "l1", runId: "r1", repoFullName: "a/b", cycle: 1, phase: "done", branch: null,
  batchIdsJson: "[]", closedIdsJson: "[]", commits: 1, beforeScanId: null, afterScanId: null,
  stage: null, log: "", error: null, startedAt: null, endedAt: null,
  ...over,
});

describe("the migration", () => {
  // SPLIT ON `\r?\n`, NOT `\n`. The blob is LF, but `core.autocrlf` checks this file out CRLF on
  // Windows, so a `\n` split left a trailing `\r` on every line and the `TEXT;$` anchor below could
  // not match on the author's own machine while CI (Linux) stayed green — the exact failure mode
  // `.gitattributes` in this repo was written about. Asserted the same way; read portably.
  const sql = readFileSync(MIGRATION, "utf8").replace(/\r\n/g, "\n");

  it("adds every new column NULLABLE — no NOT NULL, no DEFAULT, no backfill", () => {
    const adds = sql.split("\n").filter((l) => l.trim().startsWith("ALTER TABLE"));
    expect(adds).toHaveLength(7);
    for (const line of adds) {
      expect(line).toMatch(/ADD COLUMN "[A-Za-z]+" TEXT;$/);
      expect(line).not.toMatch(/NOT NULL|DEFAULT/);
    }
    expect(sql).not.toMatch(/UPDATE |INSERT /);
  });

  it("names exactly the columns the wire contract booked", () => {
    for (const col of ["armsJson", "armPolicy", "probeJson", "transport", "armId", "planModel", "voidReason"]) {
      expect(sql).toContain(`ADD COLUMN "${col}" TEXT;`);
    }
  });

  it("stores JSON as TEXT — there is no jsonb on DSQL", () => {
    // The DDL only; the header comment names the type in order to rule it out.
    const ddl = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(ddl).not.toMatch(/jsonb/i);
  });
});

describe("a row written BEFORE the columns", () => {
  it("reads back as a pre-arms run: no arms, no policy, no probe, and its old policy intact", () => {
    const rec = toRunRecord(runRow({ modelPolicy: "ab", modelsJson: JSON.stringify(["sonnet", "opus"]) }));
    expect(rec.arms).toEqual([]);
    expect(rec.armPolicy).toBeNull();
    expect(rec.probeJson).toBeNull();
    // An `ab` row stays `ab` forever — it is not rewritten into the generalization.
    expect(rec.modelPolicy).toBe("ab");
    expect(rec.models).toEqual(["sonnet", "opus"]);
  });

  it("reads back as a lane of unknown configuration — never defaulted to `claude`", () => {
    const rec = toLaneRecord(laneRow({ model: "sonnet" }));
    expect(rec.transport).toBeNull();
    expect(rec.armId).toBeNull();
    expect(rec.planModel).toBeNull();
    expect(rec.voidReason).toBeNull();
    // What it DID record is untouched.
    expect(rec.model).toBe("sonnet");
  });
});

describe("a row written WITH arms", () => {
  const arms = [
    { id: "claude", label: "claude", transport: "claude", model: "sonnet" },
    { id: "split", label: "split", transport: "pi", model: "qwen3.8:27b", plan: { transport: "claude", model: "sonnet" } },
  ];

  it("reads its arms back whole, including the planning half", () => {
    const rec = toRunRecord(runRow({ modelPolicy: "compare", armPolicy: "compare", armsJson: JSON.stringify(arms) }));
    expect(rec.armPolicy).toBe("compare");
    expect(rec.modelPolicy).toBe("compare");
    expect(rec.arms?.map((a) => a.id)).toEqual(["claude", "split"]);
    expect(rec.arms?.[1]?.plan).toEqual({ transport: "claude", model: "sonnet" });
  });

  it("a MALFORMED armsJson reads as [] — never a fabricated single arm", () => {
    expect(toRunRecord(runRow({ armsJson: "{not json" })).arms).toEqual([]);
    expect(toRunRecord(runRow({ armsJson: JSON.stringify([{ id: "x" }]) })).arms).toEqual([]);
  });

  it("an unreadable armPolicy reads as null, and an unreadable modelPolicy as `single`", () => {
    expect(toRunRecord(runRow({ armPolicy: "whatever" })).armPolicy).toBeNull();
    expect(asModelPolicy("whatever")).toBe("single");
    expect(asModelPolicy("compare")).toBe("compare");
  });

  it("a lane carries its transport, its arm and — when it planned — the model that planned", () => {
    const rec = toLaneRecord(laneRow({ transport: "pi", armId: "split", model: "qwen3.8:27b", planModel: "sonnet" }));
    expect(rec).toMatchObject({ transport: "pi", armId: "split", model: "qwen3.8:27b", planModel: "sonnet" });
  });

  it("an unreadable transport reads as null rather than being floored to `claude`", () => {
    expect(toLaneRecord(laneRow({ transport: "gpt-cli" })).transport).toBeNull();
  });

  it("a VOID lane carries its phase and its reason together", () => {
    const rec = toLaneRecord(laneRow({ phase: "void", voidReason: "It edited a test file it is scored on." }));
    expect(rec.phase).toBe("void");
    expect(rec.voidReason).toBe("It edited a test file it is scored on.");
  });
});
