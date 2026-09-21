// The ledger's presence stamp: it writes, so it is same-origin-gated; it names an org, so it is
// access-gated; and it moves ONLY the caller's own anchor — the login comes from the session, and a
// login smuggled into the body is ignored.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

const h = vi.hoisted(() => ({
  sameOrigin: true,
  denied: null as Response | null,
  login: "alice" as string | null,
  stamped: true,
}));

vi.mock("@/lib/auth", () => ({
  PUBLIC_ORG: "public",
  requireSameOrigin: () => (h.sameOrigin ? null : new Response(JSON.stringify({ error: "Cross-origin request rejected." }), { status: 403 })),
}));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => h.login) }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => h.denied) }));
vi.mock("@/lib/db/live-seen", () => ({ markLiveSeen: vi.fn(async () => h.stamped) }));

import { POST } from "./route";
import { requireOrgAccess } from "@/lib/authz";
import { markLiveSeen } from "@/lib/db/live-seen";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/org/loop/seen", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  h.sameOrigin = true;
  h.denied = null;
  h.login = "alice";
  h.stamped = true;
});

describe("POST /api/org/loop/seen", () => {
  it("refuses a cross-origin request before reading anything", async () => {
    h.sameOrigin = false;
    expect((await post({ org: "acme" })).status).toBe(403);
    expect(requireOrgAccess).not.toHaveBeenCalled();
    expect(markLiveSeen).not.toHaveBeenCalled();
  });

  it("needs an org", async () => {
    expect((await post({})).status).toBe(400);
  });

  it("propagates the access denial and stamps nothing", async () => {
    h.denied = new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 });
    expect((await post({ org: "acme" })).status).toBe(403);
    expect(requireOrgAccess).toHaveBeenCalledWith("acme");
    expect(markLiveSeen).not.toHaveBeenCalled();
  });

  it("stamps the CALLER's own membership — a login in the body is ignored", async () => {
    const res = await post({ org: "Acme", login: "victim" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; seen: boolean; seenAt?: string };
    expect(body).toMatchObject({ ok: true, seen: true });
    expect(typeof body.seenAt).toBe("string");
    expect(markLiveSeen).toHaveBeenCalledTimes(1);
    expect(vi.mocked(markLiveSeen).mock.calls[0]![0]).toBe("acme");
    expect(vi.mocked(markLiveSeen).mock.calls[0]![1]).toBe("alice");
  });

  it("is a clean no-op with no identity, on the public org, or with no membership row", async () => {
    h.login = null;
    expect(await (await post({ org: "acme" })).json()).toEqual({ ok: true, seen: false });
    expect(markLiveSeen).not.toHaveBeenCalled();

    h.login = "alice";
    expect(await (await post({ org: "public" })).json()).toEqual({ ok: true, seen: false });
    expect(markLiveSeen).not.toHaveBeenCalled();

    h.stamped = false;
    expect(await (await post({ org: "acme" })).json()).toEqual({ ok: true, seen: false });
  });
});
