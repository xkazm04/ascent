// GET /api/org/loop/pulse — the passive screen's one read. Pinned: the access gate runs before any read,
// the public funnel org is refused, the body is `{ pulse }` (null = nothing to report from), a failed
// read is a 500 rather than a pulse of zeros, and no response is ever cacheable.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

const gates = vi.hoisted(() => ({ access: null as Response | null }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => gates.access) }));
vi.mock("@/lib/db/loop-pulse", () => ({ getLoopPulse: vi.fn() }));

import { GET } from "./route";
import { requireOrgAccess } from "@/lib/authz";
import { getLoopPulse } from "@/lib/db/loop-pulse";

const get = (qs: string) => GET(new Request(`http://localhost/api/org/loop/pulse?${qs}`));
const PULSE = { org: "acme", at: "2026-09-18T10:00:00.000Z", runner: null, run: null, lanes: [], waiting: [], needsYou: { plans: 0, pausedRepos: 0, runnerPaused: false }, today: { verifiedCloses: 0, landed: 0, liftPoints: null, spendMicros: 0 }, latest: [] };

beforeEach(() => {
  vi.clearAllMocks();
  gates.access = null;
  vi.mocked(getLoopPulse).mockResolvedValue(PULSE);
});

describe("GET /api/org/loop/pulse", () => {
  it("returns { pulse } for a member, uncacheable", async () => {
    const res = await get("org=Acme");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ pulse: PULSE });
    // The slug is canonicalized before the gate and the read see it.
    expect(requireOrgAccess).toHaveBeenCalledWith("acme");
    expect(getLoopPulse).toHaveBeenCalledWith("acme");
  });

  it("gates BEFORE reading — a non-member gets the gate's answer and no pulse is assembled", async () => {
    gates.access = new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    const res = await get("org=acme");
    expect(res.status).toBe(403);
    expect(getLoopPulse).not.toHaveBeenCalled();
  });

  it("refuses a missing org and the public funnel org", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("org=public")).status).toBe(400);
    expect(requireOrgAccess).not.toHaveBeenCalled();
  });

  it("says { pulse: null } when there is nothing to report from", async () => {
    vi.mocked(getLoopPulse).mockResolvedValue(null);
    expect(await (await get("org=acme")).json()).toEqual({ pulse: null });
  });

  it("answers a failed read with a 500 — never a pulse of zeros a screen would render as an empty day", async () => {
    vi.mocked(getLoopPulse).mockRejectedValue(new Error("db down"));
    const res = await get("org=acme");
    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).not.toHaveProperty("pulse");
  });
});
