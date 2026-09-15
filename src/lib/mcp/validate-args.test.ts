// THE SCHEMAS ARE ENFORCED — one test per rule the catalog actually uses.
//
// Before `validate-args.ts` the only consumer of `inputSchema` was `toWireTool`: every rule below was
// advertised to the model and checked by nothing. Each case here is a rule the catalog declares, so a
// keyword that stops being enforced fails a test rather than quietly becoming decoration.

import { describe, expect, it } from "vitest";
import { validateArgs } from "@/lib/mcp/validate-args";
import { MAX_CLAIM_COUNT, MCP_TOOLS } from "@/lib/mcp/tools";

const schemaOf = (name: string) => MCP_TOOLS.find((t) => t.name === name)!.inputSchema;

describe("validateArgs — the rules the catalog declares", () => {
  it("required: names the missing argument", () => {
    expect(validateArgs(schemaOf("get_gate_verdict"), {})).toMatch(/`repo` is required/);
    expect(validateArgs(schemaOf("get_gate_verdict"), { repo: "acme/api" })).toBeNull();
  });

  it("type: refuses the wrong one and says which type it wanted", () => {
    expect(validateArgs(schemaOf("get_gate_verdict"), { repo: 7 })).toMatch(/`repo` must be a string/);
    expect(validateArgs(schemaOf("cite_memory"), { id: "m1", session: "s", used: "yes" })).toMatch(
      /`used` must be a boolean/,
    );
    expect(validateArgs(schemaOf("recall_org_memory"), { query: "x", limit: 2.5 })).toMatch(/`limit` must be an integer/);
  });

  it("additionalProperties: false — an undeclared argument is refused, and the tool's own are listed", () => {
    const bad = validateArgs(schemaOf("get_repo_standing"), { repo: "acme/api", branch: "main" });
    expect(bad).toMatch(/`branch` is not an argument of this tool/);
    expect(bad).toMatch(/`repo`/);
  });

  it("minimum / maximum: both bounds are kept, and the number sent is echoed", () => {
    expect(validateArgs(schemaOf("recall_org_memory"), { query: "x", limit: 0 })).toMatch(/at least 1; you sent 0/);
    expect(validateArgs(schemaOf("list_open_recommendations"), { limit: 500 })).toMatch(/at most 50; you sent 500/);
    // The lease floor the handler used to ignore: `leaseMinutes: 0` was read as "give me the default".
    expect(validateArgs(schemaOf("claim_followups"), { repo: "acme/api", leaseMinutes: 0 })).toMatch(
      /`leaseMinutes` must be at least 5/,
    );
  });

  it("enum: names every accepted value", () => {
    const bad = validateArgs(schemaOf("report_attempt"), { id: "r1", verdict: "done", reason: "r" });
    expect(bad).toMatch(/`verdict` must be one of/);
    expect(bad).toMatch(/"needs_human"/);
    // `done` is precisely the verdict no worker may report — the door refuses it by the schema now.
    expect(validateArgs(schemaOf("report_attempt"), { id: "r1", verdict: "skipped", reason: "r" })).toBeNull();
  });

  it("maxItems: an over-long list is REFUSED by name, never silently truncated", () => {
    const ids = Array.from({ length: MAX_CLAIM_COUNT + 1 }, (_, i) => `rec-${i}`);
    const bad = validateArgs(schemaOf("claim_followups"), { repo: "acme/api", ids });
    expect(bad).toMatch(new RegExp(`at most ${MAX_CLAIM_COUNT} items; you sent ${ids.length}`));
    expect(bad).toMatch(/second call/);
    expect(validateArgs(schemaOf("claim_followups"), { repo: "acme/api", ids: ids.slice(0, MAX_CLAIM_COUNT) })).toBeNull();
  });

  it("items: an array's element type is checked, and the failing index is named", () => {
    expect(validateArgs(schemaOf("get_fix_brief"), { ids: ["rec-1", 2] })).toMatch(/`ids\[1\]` must be a string/);
  });

  it("minLength, when a schema declares one", () => {
    const schema = { type: "object", properties: { q: { type: "string", minLength: 3 } } };
    expect(validateArgs(schema, { q: "ab" })).toMatch(/at least 3 characters long/);
    expect(validateArgs(schema, { q: "abc" })).toBeNull();
  });

  it("reports ONE violation, deterministically — a model fixes one argument and calls again", () => {
    const args = { repo: 1, zzz: true, aaa: true };
    // The extra-property complaint is sorted, so the same call always produces the same sentence.
    expect(validateArgs(schemaOf("get_repo_standing"), args)).toMatch(/`aaa` is not an argument/);
    expect(validateArgs(schemaOf("get_repo_standing"), args)).toBe(validateArgs(schemaOf("get_repo_standing"), args));
  });

  it("conforming arguments pass every tool in the catalog's own schema", () => {
    expect(validateArgs(schemaOf("get_practice_shape"), {})).toBeNull();
    expect(validateArgs(schemaOf("cite_memory"), { id: "m1", used: true, session: "s", actor: "codex" })).toBeNull();
    expect(validateArgs(undefined, { anything: 1 })).toBeNull();
  });
});
