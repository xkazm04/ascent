// Pins the ASCENT_SEED_SECRET gate shared by the four /api/dev/seed-* routes. Three properties are
// load-bearing:
//   (1) FAIL-CLOSED IN PRODUCTION with no secret configured — this is the only thing stopping an
//       anonymous caller from reseeding a deployed instance's fleet;
//   (2) the credential is compared with crypto.timingSafeEqual, never `===` — the four routes each
//       open-coded `provided === secret`, and the secret is reachable over the network by design
//       (it exists so a seeder can be run once against a deployment). Mirrors the same assertion in
//       src/lib/cron-auth.test.ts;
//   (3) ASCENT_EMPTY refuses seed writes even with a valid secret — the empty tenant stays empty.
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const crypto = vi.hoisted(() => ({ timingSafeEqual: vi.fn() }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  crypto.timingSafeEqual.mockImplementation(actual.timingSafeEqual);
  return { ...actual, timingSafeEqual: crypto.timingSafeEqual };
});

const { seedRequestAuthorized, seedForbiddenMessage, SEED_SECRET_HEADER } = await import("./seed-auth");

const SECRET = "s3ed-secret-value";

function req(opts: { header?: string; query?: string } = {}) {
  const url = opts.query === undefined ? "http://x/api/dev/seed-fleet" : `http://x/api/dev/seed-fleet?secret=${encodeURIComponent(opts.query)}`;
  const headers = new Headers();
  if (opts.header !== undefined) headers.set(SEED_SECRET_HEADER, opts.header);
  return { url, headers } as unknown as import("next/server").NextRequest;
}

const ORIGINAL_ENV = {
  secret: process.env.ASCENT_SEED_SECRET,
  node: process.env.NODE_ENV,
  empty: process.env.ASCENT_EMPTY,
};
afterAll(() => {
  if (ORIGINAL_ENV.secret === undefined) delete process.env.ASCENT_SEED_SECRET;
  else process.env.ASCENT_SEED_SECRET = ORIGINAL_ENV.secret;
  if (ORIGINAL_ENV.empty === undefined) delete process.env.ASCENT_EMPTY;
  else process.env.ASCENT_EMPTY = ORIGINAL_ENV.empty;
  vi.stubEnv("NODE_ENV", ORIGINAL_ENV.node ?? "test");
});

beforeEach(() => {
  crypto.timingSafeEqual.mockClear();
  delete process.env.ASCENT_SEED_SECRET;
  delete process.env.ASCENT_EMPTY;
  vi.stubEnv("ASCENT_EMPTY", "");
  vi.stubEnv("NODE_ENV", "development");
});

describe("seedRequestAuthorized — no secret configured", () => {
  it("allows outside production", () => {
    expect(seedRequestAuthorized(req())).toBe(true);
  });

  it("REFUSES in production, so a bare prod deploy can't be seeded by anyone", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(seedRequestAuthorized(req())).toBe(false);
  });

  it("an empty/whitespace secret counts as unset (and still refuses in production)", () => {
    process.env.ASCENT_SEED_SECRET = "   ";
    vi.stubEnv("NODE_ENV", "production");
    expect(seedRequestAuthorized(req({ header: "   " }))).toBe(false);
  });
});

describe("seedRequestAuthorized — secret configured", () => {
  beforeEach(() => {
    process.env.ASCENT_SEED_SECRET = SECRET;
  });

  it("accepts the header form", () => {
    expect(seedRequestAuthorized(req({ header: SECRET }))).toBe(true);
  });

  it("accepts the ?secret= query form", () => {
    expect(seedRequestAuthorized(req({ query: SECRET }))).toBe(true);
  });

  it("rejects a wrong credential, an absent one, and the empty string", () => {
    expect(seedRequestAuthorized(req({ header: `${SECRET}x` }))).toBe(false);
    expect(seedRequestAuthorized(req())).toBe(false);
    expect(seedRequestAuthorized(req({ header: "" }))).toBe(false);
  });

  it("a configured secret is required even outside production (the env floor doesn't re-open it)", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(seedRequestAuthorized(req({ header: "nope-nope-nope-nope" }))).toBe(false);
  });

  it("compares with crypto.timingSafeEqual, never `===`", () => {
    expect(seedRequestAuthorized(req({ header: SECRET }))).toBe(true);
    expect(crypto.timingSafeEqual).toHaveBeenCalledTimes(1);
    const [a, b] = crypto.timingSafeEqual.mock.calls[0] as [Buffer, Buffer];
    expect(a.toString()).toBe(SECRET);
    expect(b.toString()).toBe(SECRET);
  });

  it("uses timingSafeEqual for an equal-length WRONG credential too (the timing case that matters)", () => {
    const wrong = "x".repeat(SECRET.length);
    expect(seedRequestAuthorized(req({ header: wrong }))).toBe(false);
    expect(crypto.timingSafeEqual).toHaveBeenCalledTimes(1);
  });

  it("skips timingSafeEqual on a LENGTH mismatch (it throws on unequal buffers) and still refuses", () => {
    expect(seedRequestAuthorized(req({ header: "short" }))).toBe(false);
    expect(crypto.timingSafeEqual).not.toHaveBeenCalled();
  });
});

describe("seedRequestAuthorized — ASCENT_EMPTY", () => {
  it("REFUSES when the empty-tenant flag is on, even outside production", () => {
    vi.stubEnv("ASCENT_EMPTY", "1");
    expect(seedRequestAuthorized(req())).toBe(false);
    expect(seedForbiddenMessage()).toBe("forbidden: seed writes are refused while ASCENT_EMPTY is on");
  });

  it("REFUSES even with a valid secret, so a seeder pointed at the empty tenant cannot populate it", () => {
    process.env.ASCENT_SEED_SECRET = SECRET;
    vi.stubEnv("ASCENT_EMPTY", "1");
    expect(seedRequestAuthorized(req({ header: SECRET }))).toBe(false);
    expect(crypto.timingSafeEqual).not.toHaveBeenCalled();
  });

  it("REFUSES in production too (restriction, not an escape hatch — no production floor)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ASCENT_EMPTY", "1");
    process.env.ASCENT_SEED_SECRET = SECRET;
    expect(seedRequestAuthorized(req({ header: SECRET }))).toBe(false);
  });

  it("still allows outside production when the flag is off", () => {
    expect(seedRequestAuthorized(req())).toBe(true);
    expect(seedForbiddenMessage()).toMatch(/ASCENT_SEED_SECRET/);
  });
});
