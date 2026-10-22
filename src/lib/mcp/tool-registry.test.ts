// THE ONE TOOL REGISTRY - what binds a catalog name to its handler and to whether it needs a holder.
//
// Two authorities on "which tools exist" (the catalog in tools.ts and a dispatch switch in
// handlers.ts) were the recorded deviation from mcp-tools. These tests pin the join: every catalog
// name has exactly one binding, every binding is a catalog name, and needing a named holder is a
// declared property of the tool rather than a ternary repeated per switch arm.

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const bumped: string[][] = [];
type Mem = { id: string; kind: string; namespace: string | null; content: string; tags: string[]; source: string; confidence: number; accessCount: number; citedCount: number; notUsefulCount: number; updatedAt: string };
let memories: Mem[] = [];

vi.mock("@/lib/db", () => ({
  recallPopulation: vi.fn(async (_org: string, opts: { terms?: string[] }) => {
    const terms = opts.terms ?? [];
    const hit = memories.filter((m) => terms.some((t) => `${m.content} ${m.tags.join(" ")}`.toLowerCase().includes(t)));
    return { rows: hit, notConsidered: 0 };
  }),
  bumpMemoryAccessCounts: vi.fn(async (_org: string, ids: string[]) => {
    bumped.push(ids);
    return ids.length;
  }),
}));

const { MCP_TOOL_BINDINGS } = await import("@/lib/mcp/tool-registry");
const { runTool } = await import("@/lib/mcp/handlers");
const { MCP_TOOLS, toolsListEnvelope } = await import("@/lib/mcp/tools");

const memory = (id: string, content: string): Mem => ({
  id,
  kind: "semantic",
  namespace: null,
  content,
  tags: [],
  source: "human",
  confidence: 0.8,
  accessCount: 0,
  citedCount: 0,
  notUsefulCount: 0,
  updatedAt: "2026-09-01T00:00:00.000Z",
});

beforeEach(() => {
  bumped.length = 0;
  memories = [];
});

describe("MCP_TOOL_BINDINGS is keyed by the catalog, and only by the catalog", () => {
  it("binds exactly the catalog's names", () => {
    expect(Object.keys(MCP_TOOL_BINDINGS).sort()).toEqual(MCP_TOOLS.map((t) => t.name).sort());
  });

  it("declares holder:true for exactly claim_followups, get_fix_brief and report_attempt", () => {
    const holders = Object.entries(MCP_TOOL_BINDINGS)
      .filter(([, b]) => b.holder)
      .map(([n]) => n)
      .sort();
    expect(holders).toEqual(["claim_followups", "get_fix_brief", "report_attempt"]);
  });

  // CRITIC REVISE: the three tools that need a holder TODAY, pinned by name, so a future edit that
  // flips one of them to holder:false fails here even if another tool gains the flag.
  it.each(["claim_followups", "get_fix_brief", "report_attempt"])("marks %s as needing a named holder", (name) => {
    expect((MCP_TOOL_BINDINGS as Record<string, { holder: boolean }>)[name]?.holder).toBe(true);
  });
});

describe("runTool dispatches through the registry", () => {
  // guard (green before): the fail-closed refusal for a holder tool reached with no principal.
  it("refuses get_fix_brief with no principal, naming the missing holder", async () => {
    const res = await runTool("get_fix_brief", "acme", { ids: ["r1"] });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/named holder/);
  });

  it("answers an unknown name in-band rather than throwing", async () => {
    const res = await runTool("delete_everything", "acme", {});
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Unknown tool "delete_everything"/);
  });

  // guard (green before): the MCP door counts deliveries, once, for exactly what it returned.
  it("counts recall deliveries by default, once, with the delivered ids", async () => {
    memories = [memory("m1", "We chose postgres."), memory("m2", "Unrelated note.")];
    await runTool("recall_org_memory", "acme", { query: "postgres" });
    expect(bumped).toEqual([["m1"]]);
  });

  it("does not count deliveries when the caller asks it not to", async () => {
    memories = [memory("m1", "We chose postgres.")];
    const res = await runTool("recall_org_memory", "acme", { query: "postgres" }, undefined, { countDeliveries: false });
    expect((res.structuredContent as { count: number }).count).toBe(1);
    expect(bumped).toEqual([]);
  });
});

// guard (green before): the wire contract. tools/list is consumed by external agents, so the
// registry refactor must leave it byte-identical. The digest was taken on e3d11f2b before the change.
describe("the tools/list wire format is unchanged", () => {
  it("serializes the full catalog to the pinned digest", () => {
    const wire = JSON.stringify(toolsListEnvelope(1, MCP_TOOLS));
    expect(createHash("sha256").update(wire).digest("hex")).toBe("3976e711ccde53dd7120b6e2c77fc5d92e8d78cb5fde1a338419c4d17e3366ee");
  });
});
