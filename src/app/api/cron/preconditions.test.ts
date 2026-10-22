// Every cron route answers a missing required prerequisite (the database) the same way, through
// cronPrecondition: 503 so a cron monitor turns red, unless that job's opt-in env asks for the quiet
// 200 skip of an intentionally DB-less deployment (purge: RETENTION_ALLOW_NO_DB; the rest: CRON_ALLOW_NO_DB).
// Auth still runs first: these requests carry the correct bearer.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

const { mockIsDb, mockWork } = vi.hoisted(() => ({ mockIsDb: vi.fn(() => false), mockWork: vi.fn() }));

vi.mock("@/lib/db", () => ({
  isDbConfigured: mockIsDb,
  listOrgsWithWatchedRepos: mockWork,
  purgeExpiredData: mockWork,
}));
vi.mock("@/lib/db/scan-jobs", () => ({ enqueueDueRescans: mockWork, enqueueDueProbes: mockWork, queueDepth: mockWork, reapExpiredLeases: mockWork }));
vi.mock("@/lib/db/control-observations", () => ({ sealAllPendingDays: mockWork, controlCoverage: mockWork, listObservationsSince: mockWork }));
vi.mock("@/lib/scan-queue-worker", () => ({ drainLane: mockWork }));
vi.mock("@/lib/github/app", () => ({ isAppConfigured: vi.fn(() => true) }));
vi.mock("@/lib/alert-door", () => ({ deliverAlert: mockWork }));
vi.mock("@/app/api/cron/digest/digest-mail-load", () => ({ digestMailPart: mockWork }));
vi.mock("@/app/api/cron/digest/extra-alerts", () => ({ dispatchExtraAlerts: mockWork }));

import { GET as rescan } from "./rescan/route";
import { GET as probe } from "./probe/route";
import { GET as digest } from "./digest/route";
import { GET as purge } from "./purge/route";

const SECRET = "precond-secret";
const ENV = ["CRON_SECRET", "CRON_ALLOW_NO_DB", "RETENTION_ALLOW_NO_DB"] as const;
let saved: Record<string, string | undefined>;

const authed = (path: string) => new Request(`http://localhost/api/cron/${path}`, { headers: { authorization: `Bearer ${SECRET}` } });
const ROUTES = [
  ["rescan", rescan, "CRON_ALLOW_NO_DB"],
  ["probe", probe, "CRON_ALLOW_NO_DB"],
  ["digest", digest, "CRON_ALLOW_NO_DB"],
  ["purge", purge, "RETENTION_ALLOW_NO_DB"],
] as const;

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.CRON_SECRET = SECRET;
  vi.clearAllMocks();
  mockIsDb.mockReturnValue(false);
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("missing DB on an authorized cron request", () => {
  for (const [name, GET] of ROUTES) {
    it(`${name}: 503 {error}, no work, no em dash`, async () => {
      const res = await GET(authed(name));
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error?: string; skipped?: string };
      expect(body.error).toContain("DATABASE_URL");
      expect(body.error).not.toContain("\u2014");
      expect(body.skipped).toBeUndefined();
      expect(mockWork).not.toHaveBeenCalled();
    });
  }

  for (const [name, GET, optIn] of ROUTES) {
    it(`${name}: ${optIn}=1 keeps the quiet 200 {skipped}`, async () => {
      process.env[optIn] = "1";
      const res = await GET(authed(name));
      expect(res.status).toBe(200);
      expect(((await res.json()) as { skipped?: string }).skipped).toBeDefined();
      expect(mockWork).not.toHaveBeenCalled();
    });
  }

  it("the opt-in is per job: CRON_ALLOW_NO_DB does not quiet the purge", async () => {
    process.env.CRON_ALLOW_NO_DB = "1";
    expect((await purge(authed("purge"))).status).toBe(503);
  });

  it("auth still runs first: a wrong bearer is 401 even with no DB", async () => {
    const res = await digest(new Request("http://localhost/api/cron/digest", { headers: { authorization: "Bearer nope" } }));
    expect(res.status).toBe(401);
  });
});
