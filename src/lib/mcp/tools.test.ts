import { describe, expect, it } from "vitest";
import {
  MCP_TOOLS,
  TOOLS_CACHE_SCOPE,
  TOOLS_LIST_SCOPE_COPY,
  TOOLS_LIST_SCOPE_META_KEY,
  toolsForScopes,
  toolsListEnvelope,
  toWireTool,
} from "./tools";
import type { SkillTokenScope } from "@/lib/db";
import { META } from "./protocol";

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

describe("tools/list scope-model copy", () => {
  function readOnlyListPayload() {
    return toolsListEnvelope(1, toolsForScopes(["mcp:read"]));
  }

  // FAIL-BEFORE: a door-only list was tools + ttlMs + cacheScope + a nameless serverInfo, so an
  // agent holding only mcp:read could not tell that memory:read / skills:read exist.
  it("documents on an mcp:read-only list that memory:read and skills:read exist", () => {
    const payload = JSON.stringify(readOnlyListPayload());
    expect(payload).toContain("memory:read");
    expect(payload).toContain("skills:read");
    expect(TOOLS_LIST_SCOPE_COPY).toContain("memory:read");
    expect(TOOLS_LIST_SCOPE_COPY).toContain("skills:read");
    expect(TOOLS_LIST_SCOPE_COPY).toMatch(/recall_org_memory/);
    expect(TOOLS_LIST_SCOPE_COPY).toMatch(/find_skills/);
    expect(TOOLS_LIST_SCOPE_COPY).toMatch(/telemetry:write/);
  });

  it("stamps the copy on _meta and serverInfo.description, not as per-tool scopes", () => {
    const result = readOnlyListPayload().result as {
      tools: Record<string, unknown>[];
      _meta: Record<string, unknown>;
    };
    expect(result._meta[TOOLS_LIST_SCOPE_META_KEY]).toBe(TOOLS_LIST_SCOPE_COPY);
    expect(result._meta[META.serverInfo]).toMatchObject({
      name: "ascent",
      description: TOOLS_LIST_SCOPE_COPY,
    });
    for (const t of result.tools) expect(t).not.toHaveProperty("scopes");
  });

  it("still withholds recall and skills tools from a door-only list", () => {
    const names = toolsForScopes(["mcp:read"]).map((t) => t.name);
    expect(names).not.toContain("recall_org_memory");
    expect(names).not.toContain("find_skills");
    const listed = (
      readOnlyListPayload().result as { tools: { name: string }[] }
    ).tools.map((t) => t.name);
    expect(listed).toEqual(names);
    expect(listed).toContain("get_repo_standing");
  });

  it("uses the same catalog-level copy for every caller, not a per-token leak", () => {
    const door = JSON.stringify(toolsListEnvelope(1, toolsForScopes(["mcp:read"])));
    const full = JSON.stringify(
      toolsListEnvelope(1, toolsForScopes(["mcp:read", "memory:read", "skills:read", "telemetry:write", "followups:write"])),
    );
    expect(door).toContain(TOOLS_LIST_SCOPE_COPY);
    expect(full).toContain(TOOLS_LIST_SCOPE_COPY);
  });
});
