// POST /api/mcp - org-authored tool results leave the agent door credential-redacted.
//
// Athena fences and redacts the same handler results in-process (src/lib/athena/grounding.ts); the
// external door used to serialize them verbatim, so a token an agent pasted into a lesson travelled
// to every third-party coding agent (and its model vendor) that read the lesson. These cases pin the
// door: org-authored results are redacted with additive, namespaced `_meta`, computed results are
// byte-identical to what the door returned before.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init),
  },
}));
vi.mock("@/lib/db", () => ({
  verifyOrgApiToken: vi.fn(async () => null),
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
  toolResultText: (r: { structuredContent: unknown; text?: string }) =>
    r.text ?? JSON.stringify(r.structuredContent, null, 2),
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    rateLimitRequest: vi.fn(() => ({ ok: true, retryAfterSec: 0 })),
    rateLimitKeyed: vi.fn(() => ({ ok: true, retryAfterSec: 0 })),
    tooManyRequests: actual.tooManyRequests,
    GATE_RATE_LIMIT: {},
    MCP_RATE_LIMIT: { name: "mcp", perIp: 300, global: 3_000, windowMs: 60_000, basis: "inherited" },
  };
});

import { POST } from "./route";
import { verifyOrgApiToken } from "@/lib/db";
import { runTool } from "@/lib/mcp/handlers";
import { ok } from "@/lib/mcp/protocol";
import { MCP_TOOLS } from "@/lib/mcp/tools";

const TOKEN = `ghp_${"a1B2c3D4e5".repeat(3)}abcdef`; // ghp_ + 36 alnum
const ALL_SCOPES = ["mcp:read", "memory:read", "skills:read"];

function call(name: string, args: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer askl_test",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        "mcp-name": name,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }),
  );
}

function handlerReturns(structuredContent: unknown) {
  vi.mocked(runTool).mockResolvedValue({ structuredContent } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyOrgApiToken).mockResolvedValue({ tokenId: "tok_1", orgSlug: "acme", name: "agent", scopes: ALL_SCOPES } as never);
});

describe("POST /api/mcp - org-authored results are redacted at the agent door", () => {
  it("redacts a GitHub token inside a stored lesson body, in both renderings, and counts it", async () => {
    expect(TOKEN).toMatch(/^ghp_[A-Za-z0-9]{36}$/);
    handlerReturns({
      skill: "tidy",
      count: 1,
      lessons: [{ versionUsed: "1.0.0", learnedOn: null, project: null, heading: "h", body: `used ${TOKEN} to debug`, registryPath: "skills/tidy/LESSONS.md" }],
    });
    const body = await (await call("get_skill_lessons", { name: "tidy" })).json();
    expect(body.result.structuredContent.lessons[0].body).toContain("[REDACTED]");
    expect(body.result.structuredContent.lessons[0].body).not.toContain(TOKEN);
    expect(body.result.content[0].text).toContain("[REDACTED]");
    expect(body.result.content[0].text).not.toContain(TOKEN);
    expect(body.result._meta["ascent.dev/redactions"]).toBe(1);
    expect(body.result._meta["ascent.dev/provenance"]).toBe("org-authored");
    // Additive: the server identity the protocol stamps on every result is still there.
    expect(body.result._meta["io.modelcontextprotocol/serverInfo"]).toBeTruthy();
  });

  it("masks the credentials of a connection string in recalled memory and keeps the frame", async () => {
    handlerReturns({ query: "db", count: 1, entries: [{ id: "m1", content: "db url postgres://app:s3cretpass@db:5432/x", tags: [] }] });
    const body = await (await call("recall_org_memory", { query: "db" })).json();
    expect(body.result.structuredContent.entries[0].content).toContain("postgres://[REDACTED]@db");
    expect(JSON.stringify(body)).not.toContain("s3cretpass");
  });

  it("redacts a skill body but leaves contentHash, and the redaction count tells the caller why it no longer hashes", async () => {
    handlerReturns({ name: "tidy", content: `export TOKEN=${TOKEN}`, contentHash: "sha256-n1:abc", origin: "hosted" });
    const body = await (await call("get_skill", { name: "tidy" })).json();
    expect(body.result.structuredContent.contentHash).toBe("sha256-n1:abc");
    expect(body.result.structuredContent.content).not.toContain(TOKEN);
    expect(body.result.structuredContent.content).toContain("[REDACTED]");
    expect(body.result._meta["ascent.dev/redactions"]).toBeGreaterThanOrEqual(1);
  });

  it("stamps org-authored provenance on every org-authored tool and none on a computed one", async () => {
    const orgTools = MCP_TOOLS.filter((d) => d.resultTrust === "org-authored");
    expect(orgTools).toHaveLength(5);
    for (const t of orgTools) {
      handlerReturns({ fine: "nothing secret here" });
      const body = await (await call(t.name, { name: "x", query: "x", path: "x" })).json();
      expect(body.result._meta["ascent.dev/provenance"], t.name).toBe("org-authored");
      expect(body.result._meta["ascent.dev/redactions"], t.name).toBe(0);
    }
    handlerReturns({ level: 3 });
    const body = await (await call("get_repo_standing", {})).json();
    expect(body.result._meta).not.toHaveProperty("ascent.dev/provenance");
    expect(body.result._meta).not.toHaveProperty("ascent.dev/redactions");
  });

  // guard (green before): a computed result is untouched, down to the byte - even one that holds a
  // credential-shaped string, because the policy is keyed on who authored the text, not on its shape.
  it("returns get_repo_standing byte-identical to the pre-egress serialization", async () => {
    const sc = { repo: "acme/api", level: 3, dims: [{ id: "D1", score: 61.5, note: `ref ${TOKEN}` }], fleet: null, ok: true };
    handlerReturns(sc);
    const res = await call("get_repo_standing", { repo: "acme/api" });
    const expected = JSON.stringify(
      ok(1, { content: [{ type: "text", text: JSON.stringify(sc, null, 2) }], structuredContent: sc, isError: false }),
    );
    expect(await res.text()).toBe(expected);
  });
});
