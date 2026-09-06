// POST /api/mcp — the agent door's rate-limit refusal.
//
// This endpoint is driven by MCP clients and agents, which retry on a schedule rather than by
// judgement. A 429 that says only "slow down and try again shortly" gives such a client nothing to
// act on: it cannot tell its OWN budget (back off to the stated rate and it recovers) from the
// FLEET budget (backing off may not clear it at all) from the limiter never having run. The route
// now hands the whole RateLimitResult to `tooManyRequests`, so the refusal names its own scope.
//
// The real helper is used deliberately — a stub would only prove the route calls something.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init),
  },
}));
// The refusal is charged before any token crypto or tool dispatch, so these boundaries are stubbed
// only to keep their (DB / handler) module graphs out of this test.
//
// `getCreditState` + the two plan predicates are the REAL inputs of `resolveMcpGates`, stubbed at the
// db boundary rather than by mocking `./gates` itself: the plan gate is the behaviour under test, so
// mocking the module that decides it would test nothing.
vi.mock("@/lib/db", () => ({
  verifyOrgApiToken: vi.fn(async () => null),
  getCreditState: vi.fn(async () => ({ plan: "team" })),
  workspaceAllowsMemory: vi.fn(async () => true),
  workspaceAllowsSkills: vi.fn(async () => true),
  recordOrgAudit: vi.fn(async () => true),
  // `countTokenWritesToday` short-circuits on `isDbConfigured() === false` and returns null — the
  // honest "not measurable" the ceiling treats as open. That is the right shape for this file: the
  // ceiling's own arithmetic is proven in write-gate.test.ts, against inputs rather than a fake DB.
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
import { recordOrgAudit, verifyOrgApiToken, workspaceAllowsMemory, workspaceAllowsSkills } from "@/lib/db";
import { runTool } from "@/lib/mcp/handlers";
import { rateLimitKeyed, rateLimitRequest } from "@/lib/rate-limit";

const mockLimiter = vi.mocked(rateLimitRequest);
const mockTokenLimiter = vi.mocked(rateLimitKeyed);
const mockVerify = vi.mocked(verifyOrgApiToken);
const mockMemoryPlan = vi.mocked(workspaceAllowsMemory);
const mockSkillsPlan = vi.mocked(workspaceAllowsSkills);

/** No Origin header: a non-browser client, which `originAllowed` permits (the normal agent case). */
function post() {
  return POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer askl_test" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLimiter.mockReturnValue({ ok: true, retryAfterSec: 0 } as never);
  mockTokenLimiter.mockReturnValue({ ok: true, retryAfterSec: 0 } as never);
  mockMemoryPlan.mockResolvedValue(true);
  mockSkillsPlan.mockResolvedValue(true);
});

/** A verified token carrying `scopes`, for the org `acme`. */
function tokenWith(scopes: string[]) {
  mockVerify.mockResolvedValue({ tokenId: "tok_1", orgSlug: "acme", name: "agent", scopes } as never);
}

/** A conformant request: this revision requires the routing headers to mirror the body. */
function call(method: string, params?: Record<string, unknown>) {
  const name = typeof params?.name === "string" ? { "mcp-name": params.name } : {};
  return POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer askl_test",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        ...name,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
}

describe("POST /api/mcp — the 429 names the scope that refused", () => {
  it("per-IP refusal states the scope, the limiter, and the budget the agent must fit", async () => {
    mockLimiter.mockReturnValue({
      ok: false,
      retryAfterSec: 9,
      scope: "ip",
      limiter: "gate",
      limit: 30,
      windowSec: 60,
      evaluated: true,
    } as never);

    const res = await post();

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("9");
    expect(res.headers.get("x-ascent-ratelimit-scope")).toBe("ip");
    expect(await res.json()).toMatchObject({ code: "rate_limited", scope: "ip", limiter: "gate", limit: 30, windowSec: 60 });
    // Charged before any token crypto — a throttled request never reaches token verification.
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("global refusal names the scope and withholds the fleet ceiling", async () => {
    mockLimiter.mockReturnValue({
      ok: false,
      retryAfterSec: 4,
      scope: "global",
      limiter: "gate",
      evaluated: true,
    } as never);

    const res = await post();
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get("x-ascent-ratelimit-scope")).toBe("global");
    expect(body).toMatchObject({ code: "rate_limited", scope: "global" });
    // An agent door is the easiest surface to poll in a loop; disclosing the fleet budget or its
    // headroom here would hand a caller a live capacity meter.
    expect(body.limit).toBeUndefined();
    expect(body.windowSec).toBeUndefined();
    expect(res.headers.get("x-ascent-ratelimit-limit")).toBeNull();
  });

  it("does not refuse a request under the budget", async () => {
    const res = await post();
    expect(res.status).not.toBe(429);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // THE KEY LADDER (Direction 3). The pre-auth per-IP check is the cheap first gate and CANNOT be the
  // real budget: with `trustedProxyHops() === 0` — the default — `clientIp` is the shared "unknown"
  // bucket, so every agent on a self-hosted deployment would share one window. The budget that
  // matters is charged on the VERIFIED token id, after the credential is known.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it("charges the real budget against the token id, after the IP gate", async () => {
    tokenWith(["mcp:read"]);
    await call("tools/list");
    expect(mockLimiter).toHaveBeenCalledTimes(1); // the cheap pre-auth gate still runs
    expect(mockTokenLimiter).toHaveBeenCalledWith("tok_1", expect.objectContaining({ name: "mcp" }));
  });

  it("refuses a token over its own budget with the mcp limiter named", async () => {
    tokenWith(["mcp:read"]);
    mockTokenLimiter.mockReturnValue({
      ok: false,
      retryAfterSec: 3,
      scope: "ip",
      limiter: "mcp",
      limit: 300,
      windowSec: 60,
      evaluated: true,
    } as never);

    const res = await call("tools/list");
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ limiter: "mcp", limit: 300 });
  });

  it("refuses an oversize body as a PROTOCOL error, before any parse", async () => {
    tokenWith(["mcp:read"]);
    const res = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer askl_test",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "tools/list",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", pad: "x".repeat(70_000) }),
      }),
    );
    expect(res.status).toBe(413);
    expect((await res.json()).error.message).toMatch(/exceeds/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE PLAN GATE (moonshot #17). Before this, the door checked scopes and nothing else, so an
// `mcp:read` + `memory:read` token reached an org's Shared Memory on any plan while POST
// /api/org/memory — the same store, the same org — refused it. The looser of two doors is the
// effective policy, so this was the shipped bug, not a missing nicety.
//
// FAIL-BEFORE: delete the `.filter((t) => gateOpen(...))` and the `def.planGate` block in route.ts
// and both assertions below fail — `recall_org_memory` is listed to a free-plan token and a direct
// call dispatches into the handler.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe("POST /api/mcp — plan gates", () => {
  it("withholds a plan-closed tool from tools/list even when the token holds its scopes", async () => {
    tokenWith(["mcp:read", "memory:read"]);
    mockMemoryPlan.mockResolvedValue(false);

    const body = await (await call("tools/list")).json();
    const names = (body.result.tools as { name: string }[]).map((t) => t.name);

    expect(names).not.toContain("recall_org_memory");
    // The ungated tools are unaffected — a closed memory plan is not a closed door.
    expect(names).toContain("get_repo_standing");
  });

  it("lists a plan-open tool the token holds the scopes for", async () => {
    tokenWith(["mcp:read", "memory:read"]);
    const body = await (await call("tools/list")).json();
    expect((body.result.tools as { name: string }[]).map((t) => t.name)).toContain("recall_org_memory");
  });

  it("answers a plan-closed CALL with the reason, and never dispatches the handler", async () => {
    tokenWith(["mcp:read", "memory:read"]);
    mockMemoryPlan.mockResolvedValue(false);

    const res = await call("tools/call", { name: "recall_org_memory", arguments: { query: "postgres" } });
    const body = await res.json();

    // A tool-execution error on a 200: the model should pick another tool, not conclude the server
    // is broken. And the caller holds this org's own token, so it is owed the fixable reason.
    expect(res.status).toBe(200);
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent).toMatchObject({ reason: "plan", gate: "memory" });
    expect(String(body.result.content[0].text)).toMatch(/plan/i);
    expect(vi.mocked(runTool)).not.toHaveBeenCalled();
  });

  it("keeps the OPAQUE refusal for a tool the token lacks the scope for", async () => {
    // The two refusals are deliberately different in kind: a scope refusal must not tell an
    // unauthorized caller which tools this org has that it cannot reach.
    tokenWith(["mcp:read"]);

    const res = await call("tools/call", { name: "recall_org_memory", arguments: { query: "x" } });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.message).toBe("Unknown tool: recall_org_memory");
    expect(body.error.message).not.toMatch(/plan|scope/i);
  });

  it("audits exactly one row for an accepted write, and none for a refused one", async () => {
    tokenWith(["mcp:read", "skills:read", "telemetry:write"]);

    await call("tools/call", { name: "report_skill_invoke", arguments: { skill: "tidy", session: "s1" } });
    expect(vi.mocked(recordOrgAudit)).toHaveBeenCalledTimes(1);
    const [action, org, meta, actor] = vi.mocked(recordOrgAudit).mock.calls[0]!;
    expect(action).toBe("mcp.write.report_skill_invoke");
    expect(org).toBe("acme");
    expect(actor).toBe("token:tok_1");
    // The key SHAPE plus the idempotency key — never the raw argument object. A citation `note` is
    // free text an agent wrote, and the audit trail must not become a second place it is stored and
    // re-read; the idempotency key carries only identifiers, by construction.
    expect(meta).toMatchObject({ tool: "report_skill_invoke", argKeys: ["session", "skill"], tokenId: "tok_1", tokenName: "agent" });
    expect(meta).not.toHaveProperty("args");

    // A write the gate refuses never reaches the handler and never audits: an audit trail of
    // rejected attempts would bury the trail of actual changes.
    vi.mocked(recordOrgAudit).mockClear();
    tokenWith(["mcp:read", "skills:read"]);
    await call("tools/call", { name: "report_skill_invoke", arguments: { skill: "tidy", session: "s1" } });
    expect(vi.mocked(recordOrgAudit)).not.toHaveBeenCalled();
  });

  it("refuses a write whose token lacks telemetry:write, with the reason", async () => {
    // The tool IS offered (its declared scopes are `mcp:read` + `skills:read` + `telemetry:write`,
    // so a token without the write scope never sees it) — this is the belt-and-braces path where a
    // caller names it anyway.
    tokenWith(["mcp:read", "skills:read"]);
    const res = await call("tools/call", { name: "report_skill_invoke", arguments: { skill: "x", session: "s" } });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error.message).toBe("Unknown tool: report_skill_invoke");
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // THE TOKEN ID IS THE IDENTITY (Direction 1). A token's NAME is not unique — `createOrgApiToken`
  // enforces nothing — so keying the audit actor or the work-queue holder on it made two tokens
  // called `ci` one actor with one shared daily ceiling and one shared claim identity. Both keys are
  // now the token id, and the name rides along as a label.
  //
  // FAIL-BEFORE: restore `token:${token.name}` / `agent:${token.name}` in route.ts and both
  // assertions below fail.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it("keys the audit actor and the work-queue holder on the token ID, with the name as a label", async () => {
    tokenWith(["mcp:read", "followups:write", "telemetry:write"]);
    await call("tools/call", { name: "report_attempt", arguments: { id: "rec-1", verdict: "skipped", reason: "r" } });

    const principal = vi.mocked(runTool).mock.calls[0]![3]!;
    expect(principal.actor).toBe("agent:tok_1");
    // The label, carried but never compared. And the TRANSITIONAL name form, so a row claimed before
    // this change is still workable by the token that claimed it.
    expect(principal.label).toBe("agent");
    expect(principal.legacyActor).toBe("agent:agent");
    expect(vi.mocked(recordOrgAudit).mock.calls[0]![3]).toBe("token:tok_1");
  });

  it("gives two tokens with the SAME NAME different actors, so they share no counter and no lease", async () => {
    tokenWith(["mcp:read", "followups:write", "telemetry:write"]);
    await call("tools/call", { name: "report_attempt", arguments: { id: "rec-1", verdict: "skipped", reason: "r" } });
    // Same org, same name `agent`, a different credential.
    mockVerify.mockResolvedValue({
      tokenId: "tok_2",
      orgSlug: "acme",
      name: "agent",
      scopes: ["mcp:read", "followups:write", "telemetry:write"],
    } as never);
    await call("tools/call", { name: "report_attempt", arguments: { id: "rec-1", verdict: "skipped", reason: "r" } });

    const actors = vi.mocked(runTool).mock.calls.map((c) => c[3]!.actor);
    expect(actors).toEqual(["agent:tok_1", "agent:tok_2"]);
    // The daily ceiling counts on this string (`countTokenWritesToday(org, actorId, action)`), so two
    // distinct audit actors are two distinct budgets.
    const auditActors = vi.mocked(recordOrgAudit).mock.calls.map((c) => c[3]);
    expect(auditActors).toEqual(["token:tok_1", "token:tok_2"]);
  });

  it("does not resolve the plan gates for a discovery probe", async () => {
    tokenWith(["mcp:read"]);
    await call("server/discover");
    // `server/discover` names no tool, so charging it a credit-state read would put a DB round trip
    // on the cheapest, most-polled method the protocol has.
    expect(mockMemoryPlan).not.toHaveBeenCalled();
    expect(mockSkillsPlan).not.toHaveBeenCalled();
  });
});
