// ONE ADMISSION, TWO DOORS. Athena dispatches the MCP door's own tools in-process, so the question
// these tests pin is not "does she get the right tools today" (grounding.test.ts answers that) but
// "can the two doors DRIFT apart without anybody editing either door". A companion that is offered a
// tool the MCP door would refuse to every token lacking its scope is a privileged path, and one that
// appears the day a new read tool lands is the kind nobody reviews.
//
// Synthetic tools are pushed onto the live catalog array and removed after each test, so the door
// under test reads exactly the catalog a future lane would ship.

import { afterEach, describe, expect, it } from "vitest";
import type { SkillTokenScope } from "@/lib/db";
import { MCP_TOOLS, toolsForScopes, type McpToolDef } from "@/lib/mcp/tools";
import { gateOpen } from "@/app/api/mcp/gates";
import { athenaToolCatalog } from "@/lib/athena/grounding";

/** The grant Athena's catalog corresponds to: the door, and the two read resources. */
const GRANT: SkillTokenScope[] = ["mcp:read", "memory:read", "skills:read"];

const COMBOS = [
  { memoryAllowed: true, skillsAllowed: true },
  { memoryAllowed: true, skillsAllowed: false },
  { memoryAllowed: false, skillsAllowed: true },
  { memoryAllowed: false, skillsAllowed: false },
];

const catalog = MCP_TOOLS as McpToolDef[];
const pushed: McpToolDef[] = [];
function add(t: Partial<McpToolDef> & { name: string; scopes: SkillTokenScope[] }): void {
  const def: McpToolDef = { title: t.name, description: "synthetic", inputSchema: { type: "object" }, ...t };
  catalog.push(def);
  pushed.push(def);
}
afterEach(() => {
  for (const d of pushed.splice(0)) catalog.splice(catalog.indexOf(d), 1);
});

/** What the MCP door admits for a token holding exactly GRANT, minus the writes Athena never makes. */
function mcpDoorFor(c: { memoryAllowed: boolean; skillsAllowed: boolean }): string[] {
  const gates = { memory: c.memoryAllowed, skills: c.skillsAllowed };
  return toolsForScopes(GRANT)
    .filter((t) => gateOpen(gates, t.planGate))
    .filter((t) => !t.mutates)
    .map((t) => t.name)
    .sort();
}
const athena = (c: { memoryAllowed: boolean; skillsAllowed: boolean }) =>
  athenaToolCatalog(c)
    .map((t) => t.name)
    .sort();

describe("the companion gets no path the MCP door would refuse", () => {
  it("P1: a new read tool behind a scope she was never granted is not offered to her", () => {
    add({ name: "zz_probe_scoped_read", scopes: ["mcp:read", "skills:write"] });
    expect(athena({ memoryAllowed: true, skillsAllowed: true })).not.toContain("zz_probe_scoped_read");
  });

  it("P2: a new read tool behind the door scope alone IS offered (the fix is not a sledgehammer)", () => {
    add({ name: "zz_probe_plain_read", scopes: ["mcp:read"] });
    expect(athena({ memoryAllowed: false, skillsAllowed: false })).toContain("zz_probe_plain_read");
  });

  it("P3: a mis-scoped write is still refused to her (the face may subtract)", () => {
    add({ name: "zz_probe_write", scopes: ["mcp:read"], mutates: true });
    expect(athena({ memoryAllowed: true, skillsAllowed: true })).not.toContain("zz_probe_write");
  });

  it("P4: on the real catalog, both doors admit the same tools for every plan", () => {
    for (const c of COMBOS) expect(athena(c)).toEqual(mcpDoorFor(c));
  });

  it("P5: and they still agree after a scoped read tool lands", () => {
    add({ name: "zz_probe_scoped_read", scopes: ["mcp:read", "skills:write"] });
    for (const c of COMBOS) expect(athena(c)).toEqual(mcpDoorFor(c));
  });
});
