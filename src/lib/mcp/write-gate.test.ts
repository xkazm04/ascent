// The write door's policy table — the structural half (the table cannot drift from the catalog) and
// the behavioural half (each gate refuses what it says it refuses).
//
// The structural tests are the ones that matter over time. A write tool is added by a lane that is
// not thinking about this file, and the failure mode is silent: a `mutates` tool with no policy row
// would reach `assertWriteAllowed`, find nothing, and — depending on how the route was written that
// day — either fail closed or write ungated. These assertions make the pair mandatory at commit time.

import { describe, expect, it } from "vitest";
import { assertWriteAllowed, WRITE_TOOL_POLICY, writeToolNames, type WriteGateInput } from "./write-gate";
import { MCP_TOOLS } from "./tools";
import type { SkillTokenScope } from "@/lib/db";

const OPEN = { memory: true, skills: true };

function input(over: Partial<WriteGateInput> = {}): WriteGateInput {
  return {
    tool: "cite_memory",
    scopes: ["mcp:read", "memory:read", "telemetry:write"] as SkillTokenScope[],
    gates: OPEN,
    tokenId: "tok_1",
    writesToday: 0,
    ...over,
  };
}

describe("WRITE_TOOL_POLICY — the table cannot drift from the catalog", () => {
  it("has a catalog entry for every policy row", () => {
    for (const name of writeToolNames()) {
      expect(MCP_TOOLS.map((t) => t.name)).toContain(name);
    }
  });

  it("marks every policy row's tool `mutates`", () => {
    for (const name of writeToolNames()) {
      expect(MCP_TOOLS.find((t) => t.name === name)?.mutates).toBe(true);
    }
  });

  // The direction that actually catches the mistake: a new write tool added to the catalog without a
  // policy row. Without this, such a tool would be dispatched by a route that had no rule for it.
  it("has a policy row for every `mutates` tool in the catalog", () => {
    for (const t of MCP_TOOLS.filter((t) => t.mutates)) {
      expect(Object.keys(WRITE_TOOL_POLICY)).toContain(t.name);
    }
  });

  it("requires telemetry:write on every mutating tool, and on no other", () => {
    for (const t of MCP_TOOLS) {
      expect(t.scopes.includes("telemetry:write")).toBe(Boolean(t.mutates));
    }
  });

  it("declares the same resource scope and plan gate the catalog entry declares", () => {
    for (const [name, policy] of Object.entries(WRITE_TOOL_POLICY)) {
      const def = MCP_TOOLS.find((t) => t.name === name)!;
      expect(def.scopes).toContain(policy.resourceScope);
      expect(def.planGate ?? null).toBe(policy.planGate);
    }
  });

  it("gives every write its own audit action, so a per-tool ceiling is countable", () => {
    const actions = Object.values(WRITE_TOOL_POLICY).map((p) => p.auditAction);
    expect(new Set(actions).size).toBe(actions.length);
    for (const a of actions) expect(a.startsWith("mcp.write.")).toBe(true);
  });
});

describe("assertWriteAllowed", () => {
  it("allows a fully-scoped, plan-open, under-ceiling write", () => {
    expect(assertWriteAllowed(input())).toBeNull();
  });

  it("refuses a token holding the resource scope but not telemetry:write", () => {
    const denial = assertWriteAllowed(input({ scopes: ["mcp:read", "memory:read"] as SkillTokenScope[] }));
    expect(denial?.denied).toMatch(/telemetry:write/);
  });

  // The case named in the spec: reading a resource never implies the right to write evidence about it.
  it("refuses cite_memory to a telemetry:write token with no memory:read", () => {
    const denial = assertWriteAllowed(input({ scopes: ["mcp:read", "telemetry:write"] as SkillTokenScope[] }));
    expect(denial?.denied).toMatch(/memory:read/);
  });

  it("refuses a write to a resource the workspace's plan does not include", () => {
    const denial = assertWriteAllowed(input({ gates: { memory: false, skills: true } }));
    expect(denial?.denied).toMatch(/plan/);
  });

  it("refuses an unattributable write", () => {
    expect(assertWriteAllowed(input({ tokenId: null }))?.denied).toMatch(/token/);
  });

  it("denies the write that would exceed the daily ceiling, and states the number", () => {
    const max = WRITE_TOOL_POLICY.cite_memory!.perTokenDailyMax;
    expect(assertWriteAllowed(input({ writesToday: max - 1 }))).toBeNull();
    const denial = assertWriteAllowed(input({ writesToday: max }));
    expect(denial?.denied).toContain(String(max));
    // The refusal must be actionable: it says the ceiling resets and that nothing already reported
    // was lost, so an agent does not treat it as a permanent failure and stop reporting altogether.
    expect(denial?.denied).toMatch(/resets/);
  });

  // An honest null, not a zero. With no persistence there is no row to inflate, so the ceiling has
  // nothing to protect — and passing 0 would have been a fabricated measurement.
  it("does not apply the ceiling when the count could not be measured", () => {
    expect(assertWriteAllowed(input({ writesToday: null }))).toBeNull();
  });

  it("fails CLOSED for a tool with no policy row", () => {
    expect(assertWriteAllowed(input({ tool: "not_a_write_tool" }))?.denied).toMatch(/not a registered write tool/);
  });

  it("uses each tool's own scope and plan family, not a shared one", () => {
    const skillWrite = input({
      tool: "report_skill_invoke",
      scopes: ["mcp:read", "memory:read", "telemetry:write"] as SkillTokenScope[],
    });
    // memory:read is the wrong resource scope for a skills write, however generous it looks.
    expect(assertWriteAllowed(skillWrite)?.denied).toMatch(/skills:read/);
    expect(
      assertWriteAllowed({ ...skillWrite, scopes: ["mcp:read", "skills:read", "telemetry:write"] as SkillTokenScope[] }),
    ).toBeNull();
  });
});

describe("idempotencyKey", () => {
  it("names the store's own unique key when the arguments carry one", () => {
    expect(WRITE_TOOL_POLICY.cite_memory!.idempotencyKey("acme", { id: "m1", session: "s1" })).toBe(
      "acme/memory/m1#s1",
    );
    expect(WRITE_TOOL_POLICY.report_skill_invoke!.idempotencyKey("acme", { skill: "tidy", session: "s1" })).toBe(
      "acme/skill/tidy#s1",
    );
  });

  // Null means "this call has no natural key", which is a fact the audit row should carry rather
  // than a key invented to fill the field.
  it("is null when an argument the key needs is missing", () => {
    expect(WRITE_TOOL_POLICY.cite_memory!.idempotencyKey("acme", { id: "m1" })).toBeNull();
  });
});
