// Route test for /api/athena/threads. What it pins is the ORDER of the preamble and the two product
// decisions the route alone owns:
//
//   db-configured → org present → PUBLIC_ORG refused → authz gate → tenant id resolved → work
//
//   • The public funnel org is refused EXPLICITLY. It would otherwise sail through the authz gate,
//     which lets `public` read by design, and open a conversation nobody owns.
//   • POST calls NO model. "She does not speak first" is a spend decision, so it is tested as one:
//     the assertion is that no runner is resolved and no loop is run, not that the reply looks right.
//
// next/server is faked as a Response subclass; the gate's collaborators are mocked so the ORDER is
// genuinely exercised rather than stubbed away behind a mocked gate.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: { status?: number }) {
      return new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
  },
}));

const h = vi.hoisted(() => ({
  dbGuard: vi.fn(() => null as unknown),
  requireOrgRead: vi.fn(async () => null as unknown),
  requireOrgAccess: vi.fn(async () => null as unknown),
  canReadOrg: vi.fn(async () => true),
  getOrgId: vi.fn(async () => "org-1"),
  getCreditState: vi.fn(async () => ({ plan: "team" })),
  workspaceAllowsMemory: vi.fn(async () => true),
  candidateOrgMemories: vi.fn(async () => []),
  listAthenaThreads: vi.fn(async () => []),
  listAthenaTurns: vi.fn(async () => []),
  listThreadAthenaProposals: vi.fn(async () => []),
  createAthenaThread: vi.fn(async () => ({ id: "th1", orgId: "org-1", title: "", createdAt: "t", updatedAt: "t" })),
  appendAthenaTurn: vi.fn(async () => null),
  getAthenaIdentityPair: vi.fn(async () => ({ constitution: null, selfModel: null })),
  writeAthenaEpisode: vi.fn(async () => null),
  resolveLegRunnerForOrg: vi.fn(async () => ({ engine: "openai", model: "gpt-test", call: vi.fn() })),
  supportsToolCalling: vi.fn(() => true),
  runToolLoop: vi.fn(async () => null),
  runTool: vi.fn(async () => ({ structuredContent: {} })),
}));

vi.mock("@/lib/auth", () => ({ PUBLIC_ORG: "public" }));
vi.mock("@/lib/api/orgPlan", () => ({ dbGuard: h.dbGuard }));
vi.mock("@/lib/authz", () => ({
  requireOrgRead: h.requireOrgRead,
  requireOrgAccess: h.requireOrgAccess,
  canReadOrg: h.canReadOrg,
}));
vi.mock("@/lib/db", () => ({
  getOrgId: h.getOrgId,
  getCreditState: h.getCreditState,
  workspaceAllowsMemory: h.workspaceAllowsMemory,
  candidateOrgMemories: h.candidateOrgMemories,
}));
vi.mock("@/lib/db/athena", () => ({
  listAthenaThreads: h.listAthenaThreads,
  listAthenaTurns: h.listAthenaTurns,
  listThreadAthenaProposals: h.listThreadAthenaProposals,
  createAthenaThread: h.createAthenaThread,
  appendAthenaTurn: h.appendAthenaTurn,
  getAthenaIdentityPair: h.getAthenaIdentityPair,
  writeAthenaEpisode: h.writeAthenaEpisode,
  getAthenaThread: vi.fn(),
}));
vi.mock("@/lib/llm/text-org", () => ({ resolveLegRunnerForOrg: h.resolveLegRunnerForOrg }));
vi.mock("@/lib/llm/config", () => ({ supportsToolCalling: h.supportsToolCalling }));
vi.mock("@/lib/llm/tool-loop", () => ({ runToolLoop: h.runToolLoop }));
vi.mock("@/lib/mcp/handlers", () => ({ runTool: h.runTool, toolResultText: (r: { text?: string }) => r.text ?? "" }));

const { GET, POST } = await import("@/app/api/athena/threads/route");

const get = (qs: string) => GET(new Request(`http://x/api/athena/threads${qs}`));
const post = (body: unknown) => POST(new Request("http://x/api/athena/threads", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  h.dbGuard.mockReturnValue(null);
  h.requireOrgRead.mockResolvedValue(null);
  h.requireOrgAccess.mockResolvedValue(null);
  h.getOrgId.mockResolvedValue("org-1");
  h.listAthenaThreads.mockResolvedValue([]);
  h.resolveLegRunnerForOrg.mockResolvedValue({ engine: "openai", model: "gpt-test", call: vi.fn() });
  h.createAthenaThread.mockResolvedValue({ id: "th1", orgId: "org-1", title: "", createdAt: "t", updatedAt: "t" });
});

describe("the preamble, in order", () => {
  it("503s with no database, before the org is even read", async () => {
    h.dbGuard.mockReturnValue(new Response(JSON.stringify({ error: "no db" }), { status: 503 }));
    expect((await get("?org=acme")).status).toBe(503);
    expect(h.requireOrgRead).not.toHaveBeenCalled();
  });

  it("400s on a missing org", async () => {
    expect((await get("")).status).toBe(400);
    expect(h.requireOrgRead).not.toHaveBeenCalled();
  });

  it("refuses the public funnel org EXPLICITLY, before the authz gate lets it through", async () => {
    const res = await get("?org=public");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("public corpus") });
    expect(h.requireOrgRead).not.toHaveBeenCalled();
  });

  it("returns the read gate's own refusal verbatim, and touches no store", async () => {
    h.requireOrgRead.mockResolvedValue(new Response(JSON.stringify({ error: "nope" }), { status: 403 }));
    expect((await get("?org=acme")).status).toBe(403);
    expect(h.listAthenaThreads).not.toHaveBeenCalled();
  });

  it("404s an org that does not exist, rather than querying with a null tenant", async () => {
    h.getOrgId.mockResolvedValue(null);
    expect((await get("?org=ghost")).status).toBe(404);
    expect(h.listAthenaThreads).not.toHaveBeenCalled();
  });

  it("lowercases the slug it authorizes", async () => {
    await get("?org=ACME");
    expect(h.requireOrgRead).toHaveBeenCalledWith("acme");
  });
});

describe("GET is ONE boot request", () => {
  it("returns the ledger AND the newest thread's transcript and open proposals", async () => {
    h.listAthenaThreads.mockResolvedValue([
      { id: "th-new", orgId: "org-1", title: "Fleet", createdAt: "a", updatedAt: "b" },
      { id: "th-old", orgId: "org-1", title: "Older", createdAt: "a", updatedAt: "a" },
    ]);
    h.listAthenaTurns.mockResolvedValue([{ id: "t1", threadId: "th-new", role: "user", content: "hi", meta: {}, inputTokens: null, outputTokens: null, legs: null, createdAt: "c" }]);
    h.listThreadAthenaProposals.mockResolvedValue([
      { id: "p1", status: "open", orgId: "org-1", threadId: "th-new", turnId: "t1", kind: "identity_diff", payload: {}, resolvedAt: null, resolvedBy: null, createdAt: "c" },
      { id: "p2", status: "accepted", orgId: "org-1", threadId: "th-new", turnId: "t1", kind: "identity_diff", payload: {}, resolvedAt: "d", resolvedBy: "me", createdAt: "c" },
    ]);

    const body = await (await get("?org=acme")).json();
    expect(body.threads).toHaveLength(2);
    expect(body.thread.id).toBe("th-new");
    expect(body.turns).toHaveLength(1);
    // Only what is still awaiting an answer — a resolved proposal is already transcript.
    expect(body.proposals.map((p: { id: string }) => p.id)).toEqual(["p1"]);
    expect(h.listAthenaTurns).toHaveBeenCalledWith("org-1", "th-new");
  });

  it("does not query a transcript when the org has no threads yet", async () => {
    const body = await (await get("?org=acme")).json();
    expect(body.thread).toBeNull();
    expect(body.turns).toEqual([]);
    expect(h.listAthenaTurns).not.toHaveBeenCalled();
  });

  it("reports the engine WITHOUT calling it", async () => {
    const body = await (await get("?org=acme")).json();
    expect(body.degraded).toBe(false);
    expect(body.engine).toMatchObject({ engine: "openai", model: "gpt-test", grounding: "tools" });
    expect(h.runToolLoop).not.toHaveBeenCalled();
  });

  it("flags degraded when no engine resolves", async () => {
    h.resolveLegRunnerForOrg.mockResolvedValue(null);
    const body = await (await get("?org=acme")).json();
    expect(body.degraded).toBe(true);
    expect(body.engine.engine).toBeNull();
  });

  it("names the cause when an org's BYOM is configured but unresolvable", async () => {
    h.resolveLegRunnerForOrg.mockRejectedValue(new Error("BYOM credentials could not be resolved"));
    const body = await (await get("?org=acme")).json();
    expect(body.degraded).toBe(true);
    expect(body.engine.reason).toContain("BYOM credentials");
  });

  it("says prefetched when the resolved provider cannot carry tools", async () => {
    h.supportsToolCalling.mockReturnValue(false);
    expect((await (await get("?org=acme")).json()).engine.grounding).toBe("prefetched");
  });
});

describe("POST — she does not speak first", () => {
  it("creates an empty thread and calls NO model", async () => {
    const res = await post({ org: "acme" });
    expect(res.status).toBe(201);
    expect((await res.json()).thread.title).toBe("");
    expect(h.createAthenaThread).toHaveBeenCalledWith("org-1");
    // The whole decision, as an assertion: no runner resolved, no loop run, no turn written.
    expect(h.resolveLegRunnerForOrg).not.toHaveBeenCalled();
    expect(h.runToolLoop).not.toHaveBeenCalled();
    expect(h.appendAthenaTurn).not.toHaveBeenCalled();
  });

  it("uses the MEMBER gate, not the read gate", async () => {
    await post({ org: "acme" });
    expect(h.requireOrgAccess).toHaveBeenCalledWith("acme");
    expect(h.requireOrgRead).not.toHaveBeenCalled();
  });

  it("refuses the public org here too", async () => {
    expect((await post({ org: "public" })).status).toBe(403);
    expect(h.createAthenaThread).not.toHaveBeenCalled();
  });
});
