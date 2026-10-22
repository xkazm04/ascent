// GET /api/health per-job cron readiness (`crons`), derived from the one table in src/lib/cron-jobs.ts.
// Internal callers (the CRON_SECRET bearer) see every scheduled job's state, missing prerequisites and
// the fix; `autoscan` stays the rescan projection (the docs/DEPLOY.md contract); an anonymous caller
// sees neither. The bearer check is cron-auth.ts's cronSecretMatches, not a second copy.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockIsDb, mockIsApp, mockMatches } = vi.hoisted(() => ({
  mockIsDb: vi.fn(() => true),
  mockIsApp: vi.fn(() => true),
  mockMatches: vi.fn<(a: string, b: string) => boolean>(),
}));

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({
  dbHealthCheck: vi.fn(async () => ({ ok: true, reconnected: false })),
  isDbConfigured: mockIsDb,
  getDbMode: () => "postgres",
  pgliteBootError: () => null,
}));
vi.mock("@/lib/github/app", () => ({ isAppConfigured: mockIsApp }));
vi.mock("@/lib/cron-auth", async (orig) => {
  const real = await orig<typeof import("@/lib/cron-auth")>();
  mockMatches.mockImplementation(real.cronSecretMatches);
  return { ...real, cronSecretMatches: mockMatches };
});

import { GET } from "./route";

const CRON = "cron-secret";
let saved: string | undefined;
const get = async (auth?: string) => {
  const res = await GET(new Request("http://localhost/api/health", auth ? { headers: { authorization: auth } } : undefined));
  return (await res.json()) as Record<string, unknown>;
};

beforeEach(() => {
  saved = process.env.CRON_SECRET;
  process.env.CRON_SECRET = CRON;
  mockIsDb.mockReturnValue(true);
  mockIsApp.mockReturnValue(true);
  mockMatches.mockClear();
});
afterEach(() => {
  if (saved === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved;
});

describe("GET /api/health crons", () => {
  it("internal caller: crons keyed by job name with {state, missing, remedy}", async () => {
    const body = await get(`Bearer ${CRON}`);
    const crons = body.crons as Record<string, { state: string; missing: string[]; remedy: string }>;
    expect(Object.keys(crons).sort()).toEqual(["athena", "digest", "probe", "purge", "rescan"]);
    for (const job of Object.values(crons)) {
      expect(job.state).toBe("ready");
      expect(job.missing).toEqual([]);
      expect(typeof job.remedy).toBe("string");
    }
  });

  it("App missing: rescan degraded in crons, and autoscan equals the rescan projection", async () => {
    mockIsApp.mockReturnValue(false);
    const body = await get(`Bearer ${CRON}`);
    const crons = body.crons as Record<string, { state: string }>;
    expect(crons.rescan.state).toBe("degraded");
    expect(crons.purge.state).toBe("ready");
    expect(body.autoscan).toEqual({ ready: false, cronSecret: true, githubApp: false, db: true });
  });

  it("DB missing: every job blocked, the remedy names DATABASE_URL but carries no value", async () => {
    mockIsDb.mockReturnValue(false);
    const body = await get(`Bearer ${CRON}`);
    const crons = body.crons as Record<string, { state: string; remedy: string }>;
    for (const job of Object.values(crons)) {
      expect(job.state).toBe("blocked");
      expect(job.remedy).toContain("DATABASE_URL");
    }
    expect(JSON.stringify(body)).not.toContain(CRON);
    expect(body.autoscan).toEqual({ ready: false, cronSecret: true, githubApp: true, db: false });
  });

  it("anonymous caller sees neither crons nor autoscan", async () => {
    const body = await get();
    expect("crons" in body).toBe(false);
    expect("autoscan" in body).toBe(false);
  });

  it("the internal-caller check goes through cronSecretMatches", async () => {
    await get(`Bearer ${CRON}`);
    expect(mockMatches).toHaveBeenCalledWith(`Bearer ${CRON}`, `Bearer ${CRON}`);
  });

  it("a same-length wrong bearer and a prefix-matching shorter bearer are both anonymous", async () => {
    const sameLength = await get(`Bearer ${"x".repeat(CRON.length)}`);
    const prefix = await get(`Bearer ${CRON.slice(0, 4)}`);
    for (const body of [sameLength, prefix]) {
      expect("crons" in body).toBe(false);
      expect("autoscan" in body).toBe(false);
    }
  });
});
