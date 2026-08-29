// Pins the ASCENT_SEED_SECRET gate shared by the four /api/dev/seed-* routes. Two properties are
// load-bearing and neither was covered before this file existed:
//   (1) FAIL-CLOSED IN PRODUCTION with no secret configured — this is the only thing stopping an
//       anonymous caller from reseeding a deployed instance's fleet;
//   (2) the credential is compared with crypto.timingSafeEqual, never `===` — the four routes each
//       open-coded `provided === secret`, and the secret is reachable over the network by design
//       (it exists so a seeder can be run once against a deployment). Mirrors the same assertion in
//       src/lib/cron-auth.test.ts.
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const crypto = vi.hoisted(() => ({ timingSafeEqual: vi.fn() }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  crypto.timingSafeEqual.mockImplementation(actual.timingSafeEqual);
  return { ...actual, timingSafeEqual: crypto.timingSafeEqual };
});

const { seedRequestAuthorized, SEED_SECRET_HEADER } = await import("./seed-auth");

const SECRET = "s3ed-secret-value";

function req(opts: { header?: string; query?: string } = {}) {
  const url = opts.query === undefined ? "http://x/api/dev/seed-fleet" : `http://x/api/dev/seed-fleet?secret=${encodeURIComponent(opts.query)}`;
  const headers = new Headers();
  if (opts.header !== undefined) headers.set(SEED_SECRET_HEADER, opts.header);
  return { url, headers } as unknown as import("next/server").NextRequest;
}

const ORIGINAL_ENV = { secret: process.env.ASCENT_SEED_SECRET, node: process.env.NODE_ENV };
afterAll(() => {
  if (ORIGINAL_ENV.secret === undefined) delete process.env.ASCENT_SEED_SECRET;
  else process.env.ASCENT_SEED_SECRET = ORIGINAL_ENV.secret;
  vi.stubEnv("NODE_ENV", ORIGINAL_ENV.node ?? "test");
});

beforeEach(() => {
  crypto.timingSafeEqual.mockClear();
  delete process.env.ASCENT_SEED_SECRET;
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
