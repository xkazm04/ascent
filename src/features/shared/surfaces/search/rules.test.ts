// The typed-filter language is proven by what it refuses: the validity table runs through the one
// door, every negative row must be refused with a verdict that names the offending node, and every
// accepted rule evaluates on the hot path without a type failure.

import { describe, expect, it } from "vitest";
import { repoRows } from "./fixtures";
import { compileRule, toRuleRow } from "./rules";
import { SEED_RULES, VALIDITY_TABLE } from "./ruleTable";

describe("typed filter language", () => {
  it("admits and refuses exactly per the validity table", () => {
    for (const row of VALIDITY_TABLE) {
      const v = compileRule(row.src);
      expect(v.ok, `${row.src} — ${row.why}`).toBe(row.verdict === "ok");
      if (!v.ok) {
        expect(v.message.length).toBeGreaterThan(0);
        expect(v.at[1]).toBeGreaterThanOrEqual(v.at[0]); // the verdict points at a span
      }
    }
  });

  it("names the offending node in the verdict", () => {
    const v = compileRule('status == "fail" and tags < 5');
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.snippet).toBe("tags < 5");
      expect(v.message).toMatch(/compare ints/);
    }
    const u = compileRule('tier == "gold"');
    if (!u.ok) expect(u.message).toBe('unknown identifier "tier"');
  });

  it("a well-typed non-boolean root is still refused: a program that is not a filter", () => {
    const v = compileRule('owner + "-" + lang');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.message).toBe("expected bool but got string");
  });

  it("an accepted rule evaluates across the whole corpus without a type failure", () => {
    const rows = repoRows(5_000).map(toRuleRow);
    const v = compileRule('(status == "fail" or status == "warn") and level < 3 and not archived and tags contains "core"');
    expect(v.ok).toBe(true);
    if (v.ok) {
      const kept = rows.filter(v.run);
      expect(kept.length).toBeGreaterThan(0);
      for (const r of kept) expect(r.level).toBeLessThan(3);
    }
  });

  it("a persisted rule saved under a retired field fails at load, at the same door", () => {
    const verdicts = SEED_RULES.map((r) => compileRule(r.src));
    expect(verdicts.filter((v) => v.ok)).toHaveLength(2);
    const broken = verdicts.find((v) => !v.ok);
    expect(broken && !broken.ok ? broken.snippet : "").toBe("tier");
  });

  it("regex and string mechanics", () => {
    const v = compileRule('name matches /^auth/ and name startswith "auth"');
    expect(v.ok && v.run(toRuleRow(repoRows(50)[0]))).toBe(true);
    expect(compileRule("name matches /(/").ok).toBe(false);
  });
});
