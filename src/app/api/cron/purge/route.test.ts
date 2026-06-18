// Route test for the data-retention purge cron (GET /api/cron/purge). This endpoint runs an
// unattended, fleet-wide `deleteMany` over scans/dimensions/recommendations/recommendation-events
// and audit entries — the single highest blast-radius surface in the app. Its only protection is
// CRON_SECRET, and that gate has ALREADY regressed to fail-open once (the in-file comment documents
// the old opt-in `if (secret)` shape that a forgotten env var silently disabled). A test is the only
// thing that keeps that regression from shipping again, so we pin the gate shut from every side:
//   (1) missing/empty CRON_SECRET → 503 (fail CLOSED) and purgeExpiredData is NEVER called;
//   (2) wrong bearer / wrong ?key= / no credential → 401 and purgeExpiredData is NEVER called;
//   (3) correct `Bearer ${secret}` AND correct `?key=${secret}` → purge proceeds (called once);
//   (4) a throw from purgeExpiredData surfaces as 500, not a 200 with partial/implied success.
// The next/server + @/lib/db boundaries are mocked so we can assert exactly when the destructive
// primitive (purgeExpiredData) fires — and, more importantly, when it must NOT.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => true),
  purgeExpiredData: vi.fn(),
}));

import { GET } from "./route";
import { isDbConfigured, purgeExpiredData } from "@/lib/db";

const mockIsDb = vi.mocked(isDbConfigured);
const mockPurge = vi.mocked(purgeExpiredData);

const SECRET = "purge-secret-xyz";

// A non-null "nothing was deleted" summary so the happy path returns a normal 200 body.
const emptySummary = () =>
  ({
    orgsProcessed: 0,
    scansDeleted: 0,
    dimensionsDeleted: 0,
    recommendationsDeleted: 0,
    recommendationEventsDeleted: 0,
    auditDeleted: 0,
    results: [],
    errors: [],
  }) as Awaited<ReturnType<typeof purgeExpiredData>>;

function req(opts: { auth?: string; key?: string } = {}) {
  const url = opts.key
    ? `http://localhost/api/cron/purge?key=${opts.key}`
    : "http://localhost/api/cron/purge";
  return new Request(url, {
    method: "GET",
    headers: opts.auth ? { authorization: opts.auth } : {},
  });
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("GET /api/cron/purge — auth gate (fail-closed) + error surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    mockIsDb.mockReturnValue(true);
    mockPurge.mockResolvedValue(emptySummary());
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  // ---- (1) FAIL CLOSED when CRON_SECRET is missing/empty ------------------

  it("fails CLOSED with 503 when CRON_SECRET is UNSET — and never runs the purge", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    expect(res.status).toBe(503);
    // The whole point: a forgotten env var must NOT leave a DELETE-everything route open.
    expect(mockPurge).not.toHaveBeenCalled();
  });

  it("fails CLOSED with 503 when CRON_SECRET is EMPTY — and never runs the purge", async () => {
    process.env.CRON_SECRET = "";
    const res = await GET(req({ auth: "Bearer " }));
    expect(res.status).toBe(503);
    expect(mockPurge).not.toHaveBeenCalled();
  });

  // ---- (2) REJECT bad credentials ----------------------------------------

  it("rejects a wrong Bearer with 401 — and never runs the purge", async () => {
    const res = await GET(req({ auth: "Bearer wrong-secret" }));
    expect(res.status).toBe(401);
    expect(mockPurge).not.toHaveBeenCalled();
  });

  it("rejects a wrong ?key= with 401 — and never runs the purge", async () => {
    const res = await GET(req({ key: "nope" }));
    expect(res.status).toBe(401);
    expect(mockPurge).not.toHaveBeenCalled();
  });

  it("rejects a request with NO credential at all with 401 — and never runs the purge", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockPurge).not.toHaveBeenCalled();
  });

  it("does NOT accept the secret as a raw bearer (must be the `Bearer ${secret}` shape)", async () => {
    // Pins that the comparison is against the full `Bearer ${secret}` literal, not a substring/prefix.
    const res = await GET(req({ auth: SECRET }));
    expect(res.status).toBe(401);
    expect(mockPurge).not.toHaveBeenCalled();
  });

  // ---- (3) ACCEPT correct credentials → purge proceeds -------------------

  it("accepts a correct Bearer secret and runs the purge exactly once", async () => {
    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    expect(res.status ?? 200).toBe(200);
    expect(mockPurge).toHaveBeenCalledTimes(1);
  });

  it("accepts a correct ?key= secret and runs the purge exactly once", async () => {
    const res = await GET(req({ key: SECRET }));
    expect(res.status ?? 200).toBe(200);
    expect(mockPurge).toHaveBeenCalledTimes(1);
  });

  // ---- (4) DB-not-configured short-circuit (still requires auth first) ----

  it("authorizes first, then skips (no purge) when the DB is not configured", async () => {
    mockIsDb.mockReturnValue(false);
    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    const body = await bodyOf(res);
    expect(res.status ?? 200).toBe(200);
    expect(body.skipped).toBeDefined();
    expect(mockPurge).not.toHaveBeenCalled();
  });

  // ---- (5) A thrown purge → 500, never a 200 implying success ------------

  it("surfaces a thrown purge as 500 (not a 200 with partial/implied success)", async () => {
    mockPurge.mockRejectedValue(new Error("boom"));
    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    const body = await bodyOf(res);
    expect(res.status).toBe(500);
    expect(body.error).toBeDefined();
  });

  it("returns the summary body on success", async () => {
    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    const body = await bodyOf(res);
    expect(body).toMatchObject({ orgsProcessed: 0, errors: [] });
  });
});
