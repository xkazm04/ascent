// Sweep door: a failed GitHub visibility check answers 502 "couldn't reach GitHub" (distinct from the
// 404 "isn't public") and is now logged by name and reported rather than swallowed.

import { describe, it, expect, vi } from "vitest";

const { report } = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("@/lib/api/respond", () => ({ reportHandledError: report }));
vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });
    }
  },
}));
vi.mock("@/lib/access", () => ({ getViewer: async () => ({ login: "Me", name: "Me" }) }));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true, countPersonalWatched: async () => 0, setRepoWatch: vi.fn(), PERSONAL_WATCH_LIMIT: 20,
}));
vi.mock("@/lib/db/members", () => ({ ensureOwnerMembership: vi.fn() }));

import { POST } from "./route";

describe("POST /api/me/watch visibility check", () => {
  it("answers 502, warns and reports when the GitHub call throws", async () => {
    const boom = new Error("ECONNRESET");
    vi.stubGlobal("fetch", vi.fn(async () => { throw boom; }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(new Request("http://localhost/api/me/watch", { method: "POST", body: JSON.stringify({ repo: "acme/app", watched: true }) }));
    expect(res.status).toBe(502);
    expect(String(warn.mock.calls[0]?.[0])).toContain("me/watch github visibility check failed");
    expect(report).toHaveBeenCalledWith(boom, expect.anything());
    vi.unstubAllGlobals();
  });
});
