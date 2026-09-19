// THE ONE DOOR, pinned.
//
// What this file tests is not "does the route work" but the four properties that make an Accept button
// safe to put in front of an operator:
//
//   1. NOTHING RUNS TWICE. The claim is a compare-and-set; a second caller gets 409 and no executor.
//   2. NOTHING RUNS THAT THIS BUILD NO LONGER CARRIES. A retired action declines cleanly, with a
//      `retired` outcome, rather than sitting as an Accept button that can never succeed.
//   3. A REFUSAL IS A RESOLUTION; A THROW IS NOT. A refusal is stamped and the row closes. A throw
//      releases the claim so the row goes back to open and the operator can try again.
//   4. EVERY ACCEPT IS AUDITED, and the role it was gated on came from the catalog.
//
// `@/lib/athena/actions` is deliberately NOT mocked — the re-validation at the door is the derivation
// under test, so it runs for real against the real catalog.

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

type Proposal = {
  id: string;
  orgId: string;
  threadId: string;
  turnId: string;
  kind: string;
  payload: Record<string, unknown>;
  status: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
};

const h = vi.hoisted(() => ({
  gateAthenaOrg: vi.fn(async () => ({ org: "acme", orgId: "org-1" }) as unknown),
  resolveViewerLogin: vi.fn(async () => "dev" as string | null),
  requireOrgRole: vi.fn(async () => null as unknown),
  recordOrgAudit: vi.fn(async () => true),
  getActiveOrgStance: vi.fn(async () => null as unknown),
  getAthenaProposal: vi.fn(),
  claimAthenaProposal: vi.fn(),
  stampAthenaProposal: vi.fn(),
  releaseAthenaProposal: vi.fn(async () => true),
  resolveAthenaProposal: vi.fn(),
  executeAthenaAction: vi.fn(),
}));

vi.mock("@/app/api/athena/gate", () => ({
  gateAthenaOrg: h.gateAthenaOrg,
  refused: (v: unknown) => v instanceof Response,
}));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: h.resolveViewerLogin }));
vi.mock("@/lib/authz", () => ({ requireOrgRole: h.requireOrgRole }));
vi.mock("@/lib/db/scans-audit", () => ({ recordOrgAudit: h.recordOrgAudit }));
vi.mock("@/lib/db/org-stance", () => ({ getActiveOrgStance: h.getActiveOrgStance }));
vi.mock("@/lib/db/athena", () => ({
  IDENTITY_DIFF_KIND: "identity_diff",
  getAthenaProposal: h.getAthenaProposal,
  claimAthenaProposal: h.claimAthenaProposal,
  stampAthenaProposal: h.stampAthenaProposal,
  releaseAthenaProposal: h.releaseAthenaProposal,
  resolveAthenaProposal: h.resolveAthenaProposal,
}));
vi.mock("@/lib/athena/actions-execute", () => ({ executeAthenaAction: h.executeAthenaAction }));

const { POST } = await import("@/app/api/athena/proposals/[id]/resolve/route");

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: "p1",
  orgId: "org-1",
  threadId: "th1",
  turnId: "t1",
  kind: "rule_on_finding",
  payload: {
    params: { module: "security", itemKey: "acme/api::bp", ruling: "dismissed", rationale: "mirror of upstream" },
  },
  status: "open",
  resolvedAt: null,
  resolvedBy: null,
  createdAt: "c",
  ...over,
});

const post = (decision: unknown, id = "p1") =>
  POST(
    new Request(`http://x/api/athena/proposals/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ org: "acme", decision }),
    }),
    { params: Promise.resolve({ id }) },
  );

const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  h.gateAthenaOrg.mockResolvedValue({ org: "acme", orgId: "org-1" });
  h.resolveViewerLogin.mockResolvedValue("dev");
  h.requireOrgRole.mockResolvedValue(null);
  h.getActiveOrgStance.mockResolvedValue(null);
  h.getAthenaProposal.mockResolvedValue(proposal());
  h.claimAthenaProposal.mockImplementation(async () => proposal({ status: "accepted" }));
  h.stampAthenaProposal.mockImplementation(async () => proposal({ status: "accepted", resolvedAt: "now" }));
  h.resolveAthenaProposal.mockImplementation(async () => proposal({ status: "declined", resolvedAt: "now" }));
  h.executeAthenaAction.mockResolvedValue({ ok: true, kind: "ruled", detail: "Dismissed.", data: { decisionId: "d1" } });
});

describe("accept — claim → run → stamp", () => {
  it("runs the action once and stamps the outcome onto the row", async () => {
    const res = await post("accept");
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({ id: "p1", status: "accepted", outcome: { ok: true, kind: "ruled" } });
    // The summary is resolved from the spec at render time, not read off the stored payload.
    expect(body.summary).toBe("Dismiss acme/api::bp (security)");
    expect(h.claimAthenaProposal).toHaveBeenCalledTimes(1);
    expect(h.executeAthenaAction).toHaveBeenCalledTimes(1);
    expect(h.stampAthenaProposal).toHaveBeenCalledWith("org-1", "p1", expect.objectContaining({ kind: "ruled" }));
  });

  it("claims BEFORE it runs — a failed accept can never be left marked done", async () => {
    const order: string[] = [];
    h.claimAthenaProposal.mockImplementation(async () => {
      order.push("claim");
      return proposal({ status: "accepted" });
    });
    h.executeAthenaAction.mockImplementation(async () => {
      order.push("run");
      return { ok: true, kind: "ruled", detail: "ok" };
    });
    h.stampAthenaProposal.mockImplementation(async () => {
      order.push("stamp");
      return proposal({ status: "accepted", resolvedAt: "now" });
    });
    await post("accept");
    expect(order).toEqual(["claim", "run", "stamp"]);
  });

  it("hands the executor the authorized tenant and the named human", async () => {
    await post("accept");
    expect(h.executeAthenaAction).toHaveBeenCalledWith(
      { id: "rule_on_finding", params: { module: "security", itemKey: "acme/api::bp", ruling: "dismissed", rationale: "mirror of upstream" } },
      { org: "acme", orgId: "org-1", actor: "dev" },
    );
  });

  it("WRITES AN AUDIT ROW on every accept", async () => {
    await post("accept");
    expect(h.recordOrgAudit).toHaveBeenCalledWith(
      "athena_proposal.accepted",
      "acme",
      expect.objectContaining({ proposalId: "p1", kind: "rule_on_finding", outcome: "ruled", ok: true }),
      "dev",
    );
  });

  it("stamps a REFUSAL too — it ran and declined to act, which is a resolution", async () => {
    h.executeAthenaAction.mockResolvedValue({ ok: false, kind: "refused", detail: "Already done." });
    const res = await post("accept");
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ status: "accepted", outcome: { ok: false, kind: "refused" } });
    expect(h.stampAthenaProposal).toHaveBeenCalled();
    expect(h.releaseAthenaProposal).not.toHaveBeenCalled();
    expect(h.recordOrgAudit).toHaveBeenCalledWith(
      "athena_proposal.accepted",
      "acme",
      expect.objectContaining({ ok: false }),
      "dev",
    );
  });

  it("RELEASES the claim when the work THROWS — the card goes back to open", async () => {
    h.executeAthenaAction.mockRejectedValue(new Error("connection reset"));
    const res = await post("accept");
    expect(res.status).toBe(500);
    expect(h.releaseAthenaProposal).toHaveBeenCalledWith("org-1", "p1");
    expect(h.stampAthenaProposal).not.toHaveBeenCalled();
  });
});

describe("nothing runs twice", () => {
  it("409s on a proposal that is already resolved, without running anything", async () => {
    h.getAthenaProposal.mockResolvedValue(proposal({ status: "accepted", resolvedAt: "then" }));
    const res = await post("accept");
    expect(res.status).toBe(409);
    expect(h.claimAthenaProposal).not.toHaveBeenCalled();
    expect(h.executeAthenaAction).not.toHaveBeenCalled();
  });

  it("409s when the CLAIM loses the race — the double-click that reads open twice", async () => {
    h.claimAthenaProposal.mockResolvedValue(null);
    const res = await post("accept");
    expect(res.status).toBe(409);
    expect(h.executeAthenaAction).not.toHaveBeenCalled();
  });

  it("409s when the stamp finds the row already resolved", async () => {
    h.stampAthenaProposal.mockResolvedValue(null);
    expect((await post("accept")).status).toBe(409);
  });

  it("409s a second decline", async () => {
    h.resolveAthenaProposal.mockResolvedValue(null);
    expect((await post("decline")).status).toBe(409);
  });
});

describe("re-validation at the door", () => {
  it("DECLINES a retired action with a `retired` outcome instead of erroring", async () => {
    h.getAthenaProposal.mockResolvedValue(proposal({ kind: "shut_down_the_cluster", payload: { params: {} } }));
    const res = await post("accept");
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ status: "declined", outcome: { ok: false, kind: "retired" } });
    expect(h.claimAthenaProposal).not.toHaveBeenCalled();
    expect(h.executeAthenaAction).not.toHaveBeenCalled();
    expect(h.resolveAthenaProposal).toHaveBeenCalledWith(
      "org-1",
      "p1",
      "declined",
      "dev",
      expect.objectContaining({ kind: "retired" }),
    );
  });

  it("DECLINES a payload that no longer satisfies the declared shape", async () => {
    // Stored before `rationale` was required, or hand-edited. Either way it can never succeed.
    h.getAthenaProposal.mockResolvedValue(
      proposal({ payload: { params: { module: "security", itemKey: "k", ruling: "dismissed" } } }),
    );
    const res = await post("accept");
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ status: "declined", outcome: { kind: "invalid" } });
    expect(h.executeAthenaAction).not.toHaveBeenCalled();
  });

  it("drops an undeclared param from a stored payload rather than handing it to the executor", async () => {
    h.getAthenaProposal.mockResolvedValue(
      proposal({
        payload: {
          params: { module: "security", itemKey: "k", ruling: "dismissed", rationale: "r", org: "someone-else" },
        },
      }),
    );
    await post("accept");
    expect(h.executeAthenaAction).toHaveBeenCalledWith(
      { id: "rule_on_finding", params: { module: "security", itemKey: "k", ruling: "dismissed", rationale: "r" } },
      expect.anything(),
    );
  });

  it("refuses an identity diff at this door rather than auto-declining another surface's offer", async () => {
    h.getAthenaProposal.mockResolvedValue(proposal({ kind: "identity_diff", payload: {} }));
    const res = await post("accept");
    expect(res.status).toBe(409);
    expect(h.resolveAthenaProposal).not.toHaveBeenCalled();
  });
});

describe("gating", () => {
  it("gates on the role READ OFF THE SPEC", async () => {
    await post("accept");
    expect(h.requireOrgRole).toHaveBeenCalledWith("acme", "member");
  });

  it("returns the gate's own refusal and never claims", async () => {
    h.requireOrgRole.mockResolvedValue(new Response("nope", { status: 403 }));
    expect((await post("accept")).status).toBe(403);
    expect(h.claimAthenaProposal).not.toHaveBeenCalled();
  });

  it("inherits the org's stance: requireHumanApproval means the accept must be attributable", async () => {
    h.getActiveOrgStance.mockResolvedValue({ stance: { provenance: { requireHumanApproval: true } } });
    h.resolveViewerLogin.mockResolvedValue(null);
    expect((await post("accept")).status).toBe(403);
    expect(h.claimAthenaProposal).not.toHaveBeenCalled();
  });

  it("allows an anonymous accept when the org has published no such requirement", async () => {
    h.resolveViewerLogin.mockResolvedValue(null);
    expect((await post("accept")).status).toBe(200);
  });

  it("passes the gate's refusal through from the preamble", async () => {
    h.gateAthenaOrg.mockResolvedValue(new Response("no", { status: 403 }));
    expect((await post("accept")).status).toBe(403);
  });

  it("404s a proposal that is not in this tenant", async () => {
    h.getAthenaProposal.mockResolvedValue(null);
    expect((await post("accept")).status).toBe(404);
  });

  it("400s a decision that is neither accept nor decline", async () => {
    for (const d of ["ACCEPT", "maybe", 1, null]) expect((await post(d)).status).toBe(400);
  });
});

describe("decline", () => {
  it("resolves and audits without running anything", async () => {
    const res = await post("decline");
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ status: "declined", outcome: { kind: "declined" } });
    expect(h.executeAthenaAction).not.toHaveBeenCalled();
    expect(h.requireOrgRole).not.toHaveBeenCalled();
    expect(h.recordOrgAudit).toHaveBeenCalledWith(
      "athena_proposal.declined",
      "acme",
      expect.objectContaining({ proposalId: "p1" }),
      "dev",
    );
  });

  it("declines a kind this build cannot run at all", async () => {
    h.getAthenaProposal.mockResolvedValue(proposal({ kind: "identity_diff", payload: {} }));
    expect((await post("decline")).status).toBe(200);
  });
});
