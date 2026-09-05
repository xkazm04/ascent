import { describe, expect, it } from "vitest";
import { MCP_TOOLS, TOOLS_CACHE_SCOPE, toolsForScopes, toWireTool } from "./tools";
import type { SkillTokenScope } from "@/lib/db";

describe("the tool catalog", () => {
  // The revision asks servers to return tools deterministically so clients can cache the list and
  // an LLM's prompt cache stays warm across calls. Alphabetical is the cheapest stable order.
  it("is in a deterministic, stable order", () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(names).toEqual([...names].sort());
  });

  it("has unique names within the documented character set", () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
  });

  it("gives every tool a valid object inputSchema", () => {
    for (const t of MCP_TOOLS) {
      expect(t.inputSchema).toBeTypeOf("object");
      expect((t.inputSchema as { type?: string }).type).toBe("object");
    }
  });

  // A description is what the model reads to decide whether to call the tool at all. A thin one is
  // a silently unused tool.
  it("describes each tool in enough detail to choose it", () => {
    for (const t of MCP_TOOLS) {
      expect(t.description.length).toBeGreaterThan(80);
      expect(t.title.length).toBeGreaterThan(0);
    }
  });

  it("requires mcp:read on every tool — the door scope is never optional", () => {
    for (const t of MCP_TOOLS) expect(t.scopes).toContain("mcp:read");
  });

  // A `planGate` the route cannot resolve would silently never open. The catalog and the resolver
  // must agree on the family names, and there are exactly two.
  it("names only plan gates the door knows how to resolve", () => {
    for (const t of MCP_TOOLS) {
      if (t.planGate) expect(["memory", "skills"]).toContain(t.planGate);
    }
  });

  // Every tool over a plan-gated resource must DECLARE the gate. A skills tool that forgot to would
  // serve the org's curated library on a plan that does not include it — the hole #17 closed.
  it("plan-gates every tool that reads a plan-gated resource", () => {
    for (const t of MCP_TOOLS) {
      if (t.scopes.includes("memory:read")) expect(t.planGate).toBe("memory");
      if (t.scopes.includes("skills:read")) expect(t.planGate).toBe("skills");
    }
  });

  it("marks exactly the tools that write, and gives each one telemetry:write", () => {
    const writes = MCP_TOOLS.filter((t) => t.mutates).map((t) => t.name);
    expect(writes).toEqual(["cite_memory", "claim_followups", "report_attempt", "report_skill_invoke"]);
    for (const t of MCP_TOOLS) expect(t.scopes.includes("telemetry:write")).toBe(Boolean(t.mutates));
  });

  // MOONSHOT #3. `get_fix_brief` is scoped with the write tools and marked with the reads, and the
  // combination is deliberate rather than an oversight: it MUTATES NOTHING (so no marker, no
  // telemetry:write, no policy row — the write gate's own structural equivalence would break) but it
  // is only ever answerable for rows the caller HOLDS, and only a token that can claim can hold one.
  it("keeps get_fix_brief a read, gated by the scope that lets a token hold a row", () => {
    const brief = MCP_TOOLS.find((t) => t.name === "get_fix_brief")!;
    expect(brief.mutates).toBeUndefined();
    expect(brief.scopes).toEqual(["mcp:read", "followups:write"]);
  });

  it("does not plan-gate the work queue — every scanned org has a Follow-ups ledger", () => {
    for (const name of ["claim_followups", "get_fix_brief", "report_attempt"]) {
      expect(MCP_TOOLS.find((t) => t.name === name)!.planGate).toBeUndefined();
    }
  });
});

describe("toolsForScopes", () => {
  const door: SkillTokenScope[] = ["mcp:read"];

  it("gives a door-only token the org-standing tools", () => {
    const names = toolsForScopes(door).map((t) => t.name);
    expect(names).toContain("get_repo_standing");
    expect(names).toContain("get_gate_verdict");
    expect(names).toContain("get_ai_stance");
  });

  // Least privilege in both directions, and the reason each tool declares its own resource scope.
  it("withholds memory recall from a token that holds only the door", () => {
    expect(toolsForScopes(door).map((t) => t.name)).not.toContain("recall_org_memory");
  });

  it("grants memory recall once the memory scope is present too", () => {
    expect(toolsForScopes(["mcp:read", "memory:read"]).map((t) => t.name)).toContain("recall_org_memory");
  });

  it("withholds the skills tools from a token holding only the door", () => {
    const names = toolsForScopes(door).map((t) => t.name);
    expect(names).not.toContain("find_skills");
    expect(names).not.toContain("get_governing_subject");
  });

  it("withholds every write tool from a token with no telemetry:write", () => {
    const names = toolsForScopes(["mcp:read", "memory:read", "skills:read"]).map((t) => t.name);
    expect(names).not.toContain("cite_memory");
    expect(names).not.toContain("report_skill_invoke");
    // …and grants them once the write scope is present too.
    const withWrite = toolsForScopes(["mcp:read", "memory:read", "telemetry:write"]).map((t) => t.name);
    expect(withWrite).toContain("cite_memory");
    expect(withWrite).not.toContain("report_skill_invoke"); // needs skills:read, not memory:read
  });

  it("gives a memory-only token NOTHING — holding a resource scope is not holding the door", () => {
    expect(toolsForScopes(["memory:read"])).toEqual([]);
  });

  it("gives an unscoped token nothing", () => {
    expect(toolsForScopes([])).toEqual([]);
  });
});

describe("toWireTool", () => {
  // `scopes` is a server-side authorization fact. Leaking it would tell a caller which scopes exist
  // and which it is missing — an enumeration aid, not a capability.
  it("never puts the server-side scopes on the wire", () => {
    for (const t of MCP_TOOLS) {
      expect(Object.keys(toWireTool(t)).sort()).toEqual(["description", "inputSchema", "name", "title"]);
    }
  });
});

describe("caching hints", () => {
  // The list varies by the caller's scopes, so a shared intermediary caching one caller's list and
  // serving it to another would leak which tools that org's token reaches.
  it("marks the tool list private, never public", () => {
    expect(TOOLS_CACHE_SCOPE).toBe("private");
  });
});
