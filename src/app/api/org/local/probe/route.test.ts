// POST /api/org/local/probe — the gate order, the validation, and the property the route exists for:
// it probes WHAT WILL ACTUALLY RUN, arm by arm and half by half, and it arms nothing.
//
// The criterion this file is mostly about is the one the route was rewritten to satisfy. It used to
// take a bare transport, which cannot resolve an endpoint (a `claude` arm is local or hosted
// depending on its MODEL), so the endpoint, model, context and server-version checks never ran and
// the reply was green on any machine with the CLI installed. `probeTransport` is stubbed here and the
// assertions are about WHAT IT IS HANDED — a real endpoint for a local half, and none for a hosted
// one — because that argument is the whole difference between a probe and a rubber stamp.
//
// `@/lib/local/endpoint` is NOT stubbed: it is the one place the local/hosted rule lives, and a test
// that mocked it would prove the route calls something rather than that the rule is applied.

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

interface ProbeCall {
  transport: string;
  endpoint: { baseUrl: string; model: string; contextTokens: number } | null;
}
const probed: ProbeCall[] = [];
/** Model tokens the stubbed probe should fail on. Everything else passes. */
const failing = new Set<string>();

vi.mock("@/lib/local/transport/probe", () => ({
  probeTransport: vi.fn(async (transport: string, endpoint: ProbeCall["endpoint"]) => {
    probed.push({ transport, endpoint: endpoint ?? null });
    const ok = !(endpoint && failing.has(endpoint.model));
    return {
      transport,
      ok,
      at: "2026-09-21T00:00:00.000Z",
      zeroToken: true,
      findings: [
        { check: "binary", ok: true, observed: `${transport} 1.0.0` },
        ...(endpoint
          ? [
              { check: "endpoint", ok: true, observed: endpoint.baseUrl },
              { check: "model", ok: true, observed: endpoint.model },
              {
                check: "context",
                ok,
                observed: ok ? "65536 tokens (loaded)" : "32768 tokens",
                required: "at least 65536 tokens",
                ...(ok ? {} : { remedy: "Restart the inference server with OLLAMA_CONTEXT_LENGTH=65536." }),
              },
              { check: "server-version", ok: true, observed: "0.33.0" },
            ]
          : []),
        { check: "auth", ok: true, observed: "logged in" },
      ],
    };
  }),
  probeRefusal: (r: { ok: boolean; transport: string }) =>
    r.ok ? null : `Refusing to arm the ${r.transport} arm: its context check failed (observed 32768 tokens).`,
}));

const { POST } = await import("./route");

const post = (body: unknown) => POST(new Request("http://x/api/org/local/probe", { method: "POST", body: JSON.stringify(body) }));

interface Reply {
  arms: {
    armId: string;
    label: string;
    ok: boolean;
    refusal: string | null;
    halves: { role: string; transport: string; model: string; endpoint: string | null; probe: number }[];
  }[];
  probes: { transport: string; ok: boolean; findings: { check: string; ok: boolean; observed?: string | null }[] }[];
  refusal: string | null;
}

const reply = async (body: unknown): Promise<Reply> => (await (await post(body)).json()) as Reply;

const HOSTED = { id: "hosted", label: "claude:sonnet", transport: "claude", model: "sonnet", plan: null };
const LOCAL = { id: "local", label: "pi:qwen3.8:27b", transport: "pi", model: "qwen3.8:27b", plan: null, belowFloor: true };
const SPLIT = {
  id: "split",
  label: "claude:sonnet plan -> pi:qwen3.8:27b",
  transport: "pi",
  model: "qwen3.8:27b",
  plan: { transport: "claude", model: "sonnet" },
};

beforeEach(() => {
  gates.selfHosted = true;
  gates.role = null;
  roleCalls.length = 0;
  probed.length = 0;
  failing.clear();
});

describe("the gate", () => {
  it("404s on managed cloud before it reads the body", async () => {
    gates.selfHosted = false;
    expect((await post({ org: "acme", arms: [HOSTED] })).status).toBe(404);
    expect(roleCalls).toHaveLength(0);
    expect(probed).toHaveLength(0);
  });

  it("refuses the public funnel org", async () => {
    expect((await post({ org: "public", arms: [HOSTED] })).status).toBe(403);
  });

  it("requires OWNER — this route spawns a subprocess with the deployment's environment", async () => {
    await post({ org: "acme", arms: [HOSTED] });
    expect(roleCalls).toEqual([["acme", "owner"]]);
  });

  it("hands back the role guard's own refusal and probes nothing", async () => {
    gates.role = new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 });
    expect((await post({ org: "acme", arms: [HOSTED] })).status).toBe(403);
    expect(probed).toHaveLength(0);
  });
});

describe("the body", () => {
  it("400s on a missing org or missing arms", async () => {
    expect((await post({ arms: [HOSTED] })).status).toBe(400);
    expect((await post({ org: "acme" })).status).toBe(400);
  });

  it("validates with normalizeArmSet — an unknown transport, a shell-reparseable model and a bad plan all 400", async () => {
    expect((await post({ org: "acme", arms: [{ ...HOSTED, transport: "ollama" }] })).status).toBe(400);
    expect((await post({ org: "acme", arms: [{ ...HOSTED, model: "q; rm -rf /" }] })).status).toBe(400);
    expect((await post({ org: "acme", arms: [{ ...HOSTED, plan: { transport: "claude" } }] })).status).toBe(400);
    expect(probed).toHaveLength(0);
  });

  it("enforces the policy's cardinality, and reads an absent policy off the set's own length", async () => {
    expect((await post({ org: "acme", armPolicy: "single", arms: [HOSTED, LOCAL] })).status).toBe(400);
    expect((await post({ org: "acme", armPolicy: "compare", arms: [HOSTED] })).status).toBe(400);
    expect((await post({ org: "acme", arms: [HOSTED] })).status).toBe(200);
    expect((await post({ org: "acme", arms: [HOSTED, LOCAL] })).status).toBe(200);
  });
});

describe("what actually gets probed", () => {
  // CRITERION 1. The bug this package exists for: with a bare transport none of these four ran.
  it("resolves a real endpoint for a local arm, so the endpoint/model/context/server-version checks run", async () => {
    const body = await reply({ org: "acme", arms: [LOCAL] });
    expect(probed).toHaveLength(1);
    expect(probed[0]!.transport).toBe("pi");
    expect(probed[0]!.endpoint).toMatchObject({ model: "qwen3.8:27b", contextTokens: 65_536 });
    expect(probed[0]!.endpoint!.baseUrl).toMatch(/^https?:\/\//);
    expect(body.probes[0]!.findings.map((f) => f.check)).toEqual([
      "binary",
      "endpoint",
      "model",
      "context",
      "server-version",
      "auth",
    ]);
  });

  // CRITERION 2.
  it("probes both halves of a split arm, and a failure in either blocks the arm", async () => {
    failing.add("qwen3.8:27b");
    const body = await reply({ org: "acme", arms: [SPLIT] });
    expect(probed).toHaveLength(2);
    expect(probed.map((p) => p.transport).sort()).toEqual(["claude", "pi"]);
    expect(body.arms[0]!.halves.map((h) => h.role)).toEqual(["execute", "plan"]);
    // The plan half is Claude on a hosted seat: no endpoint at all.
    expect(body.arms[0]!.halves.find((h) => h.role === "plan")!.endpoint).toBeNull();
    expect(body.arms[0]!.ok).toBe(false);
    expect(body.arms[0]!.refusal).toContain("execute half");
    expect(body.arms[0]!.refusal).toContain("32768");
  });

  it("names the PLAN half when that is the one that failed", async () => {
    // Claude plans with a local model here — the inversion — so the plan half is the local one.
    failing.add("qwen3.8:27b");
    const inverted = { id: "inv", label: "local plan", transport: "claude", model: "sonnet", plan: { transport: "pi", model: "qwen3.8:27b" }, belowFloor: true };
    const body = await reply({ org: "acme", arms: [inverted] });
    expect(body.arms[0]!.ok).toBe(false);
    expect(body.arms[0]!.refusal).toContain("plan half");
  });

  // CRITERION 3.
  it("passes an all-hosted arm, with a finding that STATES no endpoint applied", async () => {
    const body = await reply({ org: "acme", arms: [HOSTED] });
    expect(body.arms[0]!.ok).toBe(true);
    expect(body.refusal).toBeNull();
    // One probe: the two halves of a non-split arm ask an identical question.
    expect(probed).toEqual([{ transport: "claude", endpoint: null }]);
    const note = body.probes[0]!.findings.find((f) => f.check === "endpoint")!;
    expect(note.ok).toBe(true);
    expect(note.observed).toContain("no local endpoint");
    expect(note.observed).toContain("do not apply");
  });

  // CRITERION 4.
  it("probes once for two arms that ask the same question, and still reports BOTH", async () => {
    failing.add("qwen3.8:27b");
    const twin = { ...LOCAL, id: "local-2", label: "the same server again" };
    const body = await reply({ org: "acme", arms: [LOCAL, twin] });
    expect(probed).toHaveLength(1);
    expect(body.arms.map((a) => a.armId)).toEqual(["local", "local-2"]);
    expect(body.arms.every((a) => !a.ok)).toBe(true);
    expect(body.arms.map((a) => a.halves[0]!.probe)).toEqual([0, 0]);
    expect(body.refusal).toContain("the same server again");
    expect(body.refusal).toContain("pi:qwen3.8:27b");
  });

  it("does NOT share a probe between two arms naming different models on the same server", async () => {
    await post({ org: "acme", arms: [LOCAL, { ...LOCAL, id: "other", model: "llama3.2:3b" }] });
    expect(probed.map((p) => p.endpoint?.model)).toEqual(["qwen3.8:27b", "llama3.2:3b"]);
  });
});

describe("the answer", () => {
  it("returns 200 WITH the refusal sentence on a miss — the caller decides, this route arms nothing", async () => {
    failing.add("qwen3.8:27b");
    const res = await post({ org: "acme", arms: [LOCAL] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Reply).refusal).toContain("32768 tokens");
  });

  it("joins one refusal per blocked arm and leaves the passing ones out of it", async () => {
    failing.add("qwen3.8:27b");
    const body = await reply({ org: "acme", arms: [HOSTED, LOCAL] });
    expect(body.arms.map((a) => a.ok)).toEqual([true, false]);
    expect(body.refusal!.match(/Refusing to arm/g)).toHaveLength(1);
  });
});
