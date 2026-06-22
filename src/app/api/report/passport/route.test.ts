// Route test for /api/report/passport (Passport P1). Pins the disclosure boundary the route owns: the
// owning org is resolved from the repo owner, then the read is gated exactly like the report exports —
// a denied (private) read returns the gate verbatim and NEVER reads the passport. Plus the 400/404/503
// envelope and the optional download header. next/server is faked; db/auth/authz are mocked.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: { status?: number }) {
      return new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { "content-type": "application/json" } });
    }
  },
}));

const h = vi.hoisted(() => ({
  isDbConfigured: vi.fn(),
  getRepoPassport: vi.fn(),
  readableOrgForOwner: vi.fn(),
  requireOrgRead: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ isDbConfigured: h.isDbConfigured, getRepoPassport: h.getRepoPassport }));
vi.mock("@/lib/auth", () => ({ readableOrgForOwner: h.readableOrgForOwner }));
vi.mock("@/lib/authz", () => ({ requireOrgRead: h.requireOrgRead }));

import { GET } from "./route";

const req = (qs: string) => new Request(`http://t/api/report/passport${qs}`);
const samplePassport = { passport: "app-passport", identity: { name: "web" }, automationReadiness: { level: "L4" }, productionReadiness: { band: "beta" } };

beforeEach(() => {
  vi.clearAllMocks();
  h.isDbConfigured.mockReturnValue(true);
  h.readableOrgForOwner.mockResolvedValue("acme");
  h.requireOrgRead.mockResolvedValue(null); // allowed
  h.getRepoPassport.mockResolvedValue(samplePassport);
});

describe("GET /api/report/passport", () => {
  it("503 when DB off", async () => {
    h.isDbConfigured.mockReturnValue(false);
    expect((await GET(req("?repo=acme/web"))).status).toBe(503);
  });

  it("400 on missing / malformed repo", async () => {
    expect((await GET(req(""))).status).toBe(400);
    expect((await GET(req("?repo=notarepo"))).status).toBe(400);
  });

  it("gates the read on the owning org — a DENIED private read returns the gate verbatim, no passport read", async () => {
    h.requireOrgRead.mockResolvedValue(Response.json({ error: "no access" }, { status: 403 }));
    const res = await GET(req("?repo=acme/web"));
    expect(res.status).toBe(403);
    expect(h.readableOrgForOwner).toHaveBeenCalledWith("acme");
    expect(h.getRepoPassport).not.toHaveBeenCalled();
  });

  it("404 when the repo has no stored passport", async () => {
    h.getRepoPassport.mockResolvedValue(null);
    expect((await GET(req("?repo=acme/web"))).status).toBe(404);
  });

  it("returns the passport JSON on the happy path (passing the resolved org + sha)", async () => {
    const res = await GET(req("?repo=acme/web@abc123"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(samplePassport);
    expect(h.getRepoPassport).toHaveBeenCalledWith("acme", "web", { orgSlug: "acme", headSha: "abc123" });
    expect(res.headers.get("content-disposition")).toBeNull(); // no download by default
  });

  it("sets a sanitized download filename with ?download", async () => {
    const res = await GET(req("?repo=acme/web&download"));
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="acme-web.passport.json"');
  });
});
