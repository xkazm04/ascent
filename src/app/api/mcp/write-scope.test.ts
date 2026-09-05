// THE WORK DOOR IS NOT THE READ DOOR (moonshot #3) — at the level a caller can actually observe.
//
// `followups:write` is never implied by `mcp:read`. Two things follow, and both are asserted here
// because a scope constant nobody enforces is a comment:
//   1. `tools/list` does not show the three work tools to a read-only token;
//   2. `tools/call` answers a read-only token's attempt with `Unknown tool` — the SAME answer a
//      genuinely nonexistent tool gets. The door must not become an oracle for what an org has that
//      this token cannot reach, so the refusal is opaque on purpose. A PLAN refusal is stated in
//      words; a SCOPE refusal is not, and the split is deliberate.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init),
  },
}));

let scopes: string[] = ["mcp:read"];

vi.mock("@/lib/db", () => ({
  verifyOrgApiToken: vi.fn(async () => ({ orgSlug: "acme", tokenId: "tok_1", name: "ci", scopes })),
  getCreditState: vi.fn(async () => ({ plan: "team" })),
  workspaceAllowsMemory: vi.fn(async () => true),
  workspaceAllowsSkills: vi.fn(async () => true),
  recordOrgAudit: vi.fn(async () => true),
  isDbConfigured: vi.fn(() => false),
  getOrgId: vi.fn(async () => "org_1"),
  getPrisma: vi.fn(),
}));
vi.mock("@/lib/mcp/handlers", () => ({
  runTool: vi.fn(async () => ({ structuredContent: { ok: true } })),
  toolResultText: (r: { structuredContent: unknown; text?: string }) => r.text ?? JSON.stringify(r.structuredContent, null, 2),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitRequest: vi.fn(() => ({ ok: true, retryAfterSec: 0 })),
  rateLimitKeyed: vi.fn(() => ({ ok: true, retryAfterSec: 0 })),
  tooManyRequests: vi.fn(() => new Response("{}", { status: 429 })),
  GATE_RATE_LIMIT: {},
  MCP_RATE_LIMIT: {},
}));

import { POST } from "./route";
import { runTool } from "@/lib/mcp/handlers";

const WORK_TOOLS = ["claim_followups", "get_fix_brief", "report_attempt"];

/** A conformant request: this revision requires the routing headers to mirror the body. */
const call = async (method: string, params?: Record<string, unknown>) =>
  POST(
    new Request("https://ascent.test/api/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer askl_x",
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        ...(typeof params?.name === "string" ? { "mcp-name": params.name } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );

beforeEach(() => {
  scopes = ["mcp:read"];
  vi.mocked(runTool).mockClear();
});

describe("a read-only token", () => {
  it("is not shown the work tools in tools/list", async () => {
    const body = (await (await call("tools/list")).json()) as { result: { tools: { name: string }[] } };
    const names = body.result.tools.map((t) => t.name);
    for (const t of WORK_TOOLS) expect(names).not.toContain(t);
    // …and still sees the org-standing reads, so this is a scope filter and not an outage.
    expect(names).toContain("get_repo_standing");
  });

  it("gets `Unknown tool` on every work tool — the same answer a fictional tool gets", async () => {
    for (const tool of [...WORK_TOOLS, "no_such_tool_at_all"]) {
      const res = await call("tools/call", { name: tool, arguments: {} });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).toBe(`Unknown tool: ${tool}`);
    }
    expect(runTool).not.toHaveBeenCalled();
  });
});

describe("a token holding followups:write + telemetry:write", () => {
  beforeEach(() => {
    scopes = ["mcp:read", "followups:write", "telemetry:write"];
  });

  it("is shown all three work tools", async () => {
    const body = (await (await call("tools/list")).json()) as { result: { tools: { name: string }[] } };
    const names = body.result.tools.map((t) => t.name);
    for (const t of WORK_TOOLS) expect(names).toContain(t);
  });

  it("reaches the handler with an `agent:<token id>` principal, not the audit label", async () => {
    await call("tools/call", { name: "claim_followups", arguments: { repo: "acme/api" } });
    // The ID, because token names are not unique; the name travels as `label` (display) and as
    // `legacyActor` (the transitional holder form for rows claimed before the change).
    expect(runTool).toHaveBeenCalledWith(
      "claim_followups",
      "acme",
      { repo: "acme/api" },
      { actor: "agent:tok_1", legacyActor: "agent:ci", tokenId: "tok_1", label: "ci" },
    );
  });

  it("passes the principal to a READ tool too — the reads simply ignore it", async () => {
    await call("tools/call", { name: "get_repo_standing", arguments: {} });
    expect(runTool).toHaveBeenCalledWith(
      "get_repo_standing",
      "acme",
      {},
      { actor: "agent:tok_1", legacyActor: "agent:ci", tokenId: "tok_1", label: "ci" },
    );
  });
});

describe("a token holding followups:write but NOT telemetry:write", () => {
  beforeEach(() => {
    scopes = ["mcp:read", "followups:write"];
  });

  it("sees the read half of the protocol and neither of its writes", async () => {
    const body = (await (await call("tools/list")).json()) as { result: { tools: { name: string }[] } };
    const names = body.result.tools.map((t) => t.name);
    // The door's global write scope is a second key, and it is not one this lane's scope replaces:
    // a token may read its own briefs and still be unable to claim or report.
    expect(names).toContain("get_fix_brief");
    expect(names).not.toContain("claim_followups");
    expect(names).not.toContain("report_attempt");
  });
});
