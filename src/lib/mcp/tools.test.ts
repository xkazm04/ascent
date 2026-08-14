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
