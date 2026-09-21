// POST /api/org/local/probe — the gate order, the validation, and the one property the route exists
// for: it PROBES and refuses, and it arms nothing.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

const gates = { selfHosted: true, role: null as unknown };
const roleCalls: [string, string][] = [];

vi.mock("@/lib/auth", () => ({ PUBLIC_ORG: "public" }));
vi.mock("@/lib/api/self-host", () => ({
  selfHostGuard: () => (gates.selfHosted ? null : new Response(JSON.stringify({ error: "Not found." }), { status: 404 })),
}));
vi.mock("@/lib/authz", () => ({
  requireOrgRole: vi.fn(async (org: string, role: string) => {
    roleCalls.push([org, role]);
    return gates.role;
  }),
}));

const probed: { transport: string; endpoint: unknown }[] = [];
const probe = {
  result: { transport: "claude", ok: true, findings: [], at: "2026-09-21T00:00:00.000Z", zeroToken: true },
  refusal: null as string | null,
};
vi.mock("@/lib/local/transport/probe", () => ({
  probeTransport: vi.fn(async (transport: string, endpoint: unknown) => {
    probed.push({ transport, endpoint });
    return probe.result;
  }),
  probeRefusal: () => probe.refusal,
}));

const { POST } = await import("./route");

const post = (body: unknown) => POST(new Request("http://x/api/org/local/probe", { method: "POST", body: JSON.stringify(body) }));

const ENDPOINT = { baseUrl: "http://localhost:11434", model: "qwen3:27b", token: "ollama", contextTokens: 65_536 };

beforeEach(() => {
  gates.selfHosted = true;
  gates.role = null;
  roleCalls.length = 0;
  probed.length = 0;
  probe.refusal = null;
});

describe("the gate", () => {
  it("404s on managed cloud before it reads the body", async () => {
    gates.selfHosted = false;
    expect((await post({ org: "acme", transport: "claude" })).status).toBe(404);
    expect(roleCalls).toHaveLength(0);
    expect(probed).toHaveLength(0);
  });

  it("refuses the public funnel org", async () => {
    expect((await post({ org: "public", transport: "claude" })).status).toBe(403);
  });

  it("requires OWNER — this route spawns a subprocess with the deployment's environment", async () => {
    await post({ org: "acme", transport: "claude" });
    expect(roleCalls).toEqual([["acme", "owner"]]);
  });

  it("hands back the role guard's own refusal and probes nothing", async () => {
    gates.role = new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 });
    expect((await post({ org: "acme", transport: "claude" })).status).toBe(403);
    expect(probed).toHaveLength(0);
  });
});

describe("the body", () => {
  it("400s on a missing org or an unknown transport", async () => {
    expect((await post({ transport: "claude" })).status).toBe(400);
    expect((await post({ org: "acme", transport: "ollama" })).status).toBe(400);
  });

  it("rejects a baseUrl that is not http(s), and a model that a shell could re-parse", async () => {
    expect((await post({ org: "acme", transport: "claude", endpoint: { ...ENDPOINT, baseUrl: "file:///etc" } })).status).toBe(400);
    expect((await post({ org: "acme", transport: "claude", endpoint: { ...ENDPOINT, model: "q; rm -rf /" } })).status).toBe(400);
    expect((await post({ org: "acme", transport: "claude", endpoint: { ...ENDPOINT, contextTokens: 0 } })).status).toBe(400);
    expect(probed).toHaveLength(0);
  });

  it("probes without an endpoint when none was sent", async () => {
    await post({ org: "acme", transport: "claude" });
    expect(probed).toEqual([{ transport: "claude", endpoint: null }]);
  });

  it("normalizes the endpoint and passes it through", async () => {
    await post({ org: "acme", transport: "claude", endpoint: { ...ENDPOINT, baseUrl: "http://localhost:11434/" } });
    expect(probed[0]!.endpoint).toEqual({ baseUrl: "http://localhost:11434", model: "qwen3:27b", token: "ollama", contextTokens: 65_536 });
  });
});

describe("the answer", () => {
  it("returns the probe and a null refusal when it passed", async () => {
    const body = (await (await post({ org: "acme", transport: "claude", endpoint: ENDPOINT })).json()) as Record<string, unknown>;
    expect(body.refusal).toBeNull();
    expect((body.probe as { zeroToken: boolean }).zeroToken).toBe(true);
  });

  it("returns 200 WITH the refusal sentence on a miss — the caller decides, this route arms nothing", async () => {
    probe.refusal = "Refusing to arm the claude arm: its context check failed (observed 4096 tokens).";
    const res = await post({ org: "acme", transport: "claude", endpoint: ENDPOINT });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { refusal: string }).refusal).toContain("4096 tokens");
  });
});
