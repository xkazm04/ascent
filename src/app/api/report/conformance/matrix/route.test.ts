// #16 — the org control-matrix read. Three things must hold and each has burned somebody before:
// a non-member gets the gate's denial verbatim (and no query runs), a DB-less deployment says 503
// rather than returning an empty-and-reassuring matrix, and an `unchecked` cell survives to the wire
// instead of being normalized into something that reads as a pass.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      const headers = new Headers(init?.headers);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
      return new Response(JSON.stringify(body), { ...init, headers });
    }
  },
}));
vi.mock("@/lib/db", () => ({ isDbConfigured: vi.fn() }));
vi.mock("@/lib/db/org-conformance", () => ({ loadControlMatrix: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn() }));

import { GET } from "./route";
import { isDbConfigured } from "@/lib/db";
import { loadControlMatrix } from "@/lib/db/org-conformance";
import { requireOrgRead } from "@/lib/authz";

const mockDb = vi.mocked(isDbConfigured);
const mockLoad = vi.mocked(loadControlMatrix);
const mockGate = vi.mocked(requireOrgRead);

const get = (url: string) => GET(new Request(`http://localhost${url}`));

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.mockReturnValue(true);
  mockGate.mockResolvedValue(null);
  mockLoad.mockResolvedValue([]);
});

describe("GET /api/report/conformance/matrix", () => {
  it("returns the read-gate's denial verbatim and never queries", async () => {
    const denial = new Response(JSON.stringify({ error: "denied" }), { status: 403 });
    mockGate.mockResolvedValue(denial);
    const res = await get("/api/report/conformance/matrix?org=acme");
    expect(res).toBe(denial);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it("gates BEFORE reading, so a non-member cannot even time the query", async () => {
    await get("/api/report/conformance/matrix?org=acme");
    expect(mockGate).toHaveBeenCalledWith("acme");
  });

  it("503s without a database, and 400s without an org", async () => {
    mockDb.mockReturnValue(false);
    expect((await get("/api/report/conformance/matrix?org=acme")).status).toBe(503);
    mockDb.mockReturnValue(true);
    expect((await get("/api/report/conformance/matrix")).status).toBe(400);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it("distinguishes 'unavailable' (null -> 503) from 'nothing reported yet' ([] -> 200)", async () => {
    mockLoad.mockResolvedValue(null);
    expect((await get("/api/report/conformance/matrix?org=acme")).status).toBe(503);
    mockLoad.mockResolvedValue([]);
    const res = await get("/api/report/conformance/matrix?org=acme");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ org: "acme", rows: [] });
  });

  it("carries an `unchecked` cell through unchanged — silence is never rendered as a pass", async () => {
    mockLoad.mockResolvedValue([
      {
        repoFullName: "acme/api",
        reportedAt: "2026-06-10T00:00:00.000Z",
        summaryOnly: false,
        specVersion: "0.3.0",
        checks: [
          { check: "guardrail.never-commit", family: "guardrail", subject: null, level: "unchecked", since: null, message: "git unavailable" },
        ],
      },
    ]);
    const body = await (await get("/api/report/conformance/matrix?org=acme")).json();
    expect(body.rows[0].checks[0].level).toBe("unchecked");
    expect(body.rows[0].checks[0].since).toBeNull();
  });

  it("bounds and validates an optional repo narrowing rather than passing it through", async () => {
    await get("/api/report/conformance/matrix?org=acme&repos=acme/api,not a repo,acme/web");
    expect(mockLoad).toHaveBeenCalledWith("acme", { repos: ["acme/api", "acme/web"] });
  });
});
