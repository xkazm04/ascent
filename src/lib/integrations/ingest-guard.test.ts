// The public-ingest hardening: a hard body cap (413) and the shared rate limiter (429), plus the
// order the two run in relative to token verification. Nothing is mocked — this exercises the real
// limiter from src/lib/rate-limit.ts and the real HMAC from ingest-token.ts, because the point of the
// file is to prove the guards actually fire, not that a stub was called.
//
// Both the limiter config and the token secret are captured at module load, so the module is imported
// dynamically after the env is stubbed.

import { describe, it, expect, beforeAll, vi } from "vitest";

// The ONLY stub in this file is the stored-epoch lookup — it is a DB read, and there is no DB here.
// The HMAC, the limiter and the cap all run for real, so the revocation cases below prove the actual
// token path rejects a superseded token rather than proving a mock was called.
const db = vi.hoisted(() => ({ epoch: 0 as number | null }));
vi.mock("@/lib/db/integrations", () => ({ getIngestTokenEpoch: vi.fn(async () => db.epoch) }));

const SECRET = "test-ingest-secret-do-not-use";

type GuardModule = typeof import("./ingest-guard");
type TokenModule = typeof import("./ingest-token");
let guard: GuardModule;
let tokens: TokenModule;

beforeAll(async () => {
  process.env.INTEGRATIONS_INGEST_SECRET = SECRET;
  // A tiny window makes the limiter observable in a handful of requests. The real ceiling is derived
  // from Claude Code's export cadence (see INGEST_RATE_LIMIT) and is far too high to test directly.
  process.env.RATE_LIMIT_INGEST_PER_IP = "3";
  process.env.RATE_LIMIT_INGEST_GLOBAL = "1000";
  guard = await import("./ingest-guard");
  tokens = await import("./ingest-token");
});

function mkReq(opts: { body?: string; auth?: string | null; contentLength?: string; ip?: string } = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.auth) headers.authorization = opts.auth;
  if (opts.contentLength) headers["content-length"] = opts.contentLength;
  if (opts.ip) headers["x-real-ip"] = opts.ip;
  return new Request("http://localhost/api/integrations/ingest/v1/metrics", { method: "POST", headers, body: opts.body });
}

describe("INGEST_RATE_LIMIT — the one DERIVED limit in the codebase", () => {
  it("declares basis 'derived', which asserts the comment above it shows the arithmetic", () => {
    // Every budget in src/lib/rate-limit.ts is 'inherited'; this one is computed from Claude Code's
    // real push cadence (13 pushes/min/machine x 200 seats = 2,600/min -> perIp 3,000). Flipping
    // this to a plain number without redoing that multiplication is the regression this guards.
    expect(guard.INGEST_RATE_LIMIT.basis).toBe("derived");
  });
});

describe("readCappedBody", () => {
  it("returns the whole body when it is under the cap", async () => {
    const res = await guard.readCappedBody(mkReq({ body: '{"resourceMetrics":[]}' }));
    expect(res).toEqual({ ok: true, text: '{"resourceMetrics":[]}' });
  });

  it("returns an empty string for a bodyless request (the connect page's Test probe)", async () => {
    const res = await guard.readCappedBody(mkReq({}));
    expect(res).toEqual({ ok: true, text: "" });
  });

  it("refuses a body over the cap by streamed byte count", async () => {
    const res = await guard.readCappedBody(mkReq({ body: "x".repeat(200) }), 100);
    expect(res.ok).toBe(false);
  });

  it("refuses early on a declared content-length over the cap, without reading the stream", async () => {
    const req = mkReq({ body: "x".repeat(10), contentLength: String(guard.MAX_BODY + 1) });
    const res = await guard.readCappedBody(req);
    expect(res.ok).toBe(false);
    expect(req.bodyUsed).toBe(false); // short-circuited — the payload was never pulled into memory
  });

  it("counts BYTES, not characters (a lying multi-byte payload can't sneak past)", async () => {
    // 60 × 4-byte emoji = 240 bytes but only 120 UTF-16 code units.
    const res = await guard.readCappedBody(mkReq({ body: "🙂".repeat(60) }), 200);
    expect(res.ok).toBe(false);
  });

  it("payloadTooLarge is a 413 JSON response naming the cap", async () => {
    const res = guard.payloadTooLarge();
    expect(res.status).toBe(413);
    expect((await res.json()) as { error: string }).toMatchObject({ error: expect.stringContaining(String(guard.MAX_BODY)) });
  });
});

describe("guardIngest — rate limit runs before token verification", () => {
  it("accepts a valid token and returns the org slug", async () => {
    const res = await guard.guardIngest(mkReq({ auth: `Bearer ${tokens.ingestToken("acme")}`, ip: "10.0.0.1" }));
    expect(res).toEqual({ slug: "acme" });
  });

  it("401s a forged token (real HMAC — not a mock)", async () => {
    const res = await guard.guardIngest(mkReq({ auth: "Bearer asc_otel.acme.deadbeefdeadbeefdeadbeefdeadbeef", ip: "10.0.0.2" }));
    expect(res.deny?.status).toBe(401);
  });

  it("401s a missing token", async () => {
    const res = await guard.guardIngest(mkReq({ ip: "10.0.0.3" }));
    expect(res.deny?.status).toBe(401);
  });

  it("429s once the per-IP burst cap trips, with a Retry-After header", async () => {
    const ip = "10.0.0.99"; // a bucket no other case in this file touches
    const auth = `Bearer ${tokens.ingestToken("acme")}`;
    const statuses: (number | "ok")[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await guard.guardIngest(mkReq({ auth, ip }));
      statuses.push(res.deny ? res.deny.status : "ok");
    }
    // perIp = 3 for this run: three admitted, then refused.
    expect(statuses).toEqual(["ok", "ok", "ok", 429, 429]);
    const last = await guard.guardIngest(mkReq({ auth, ip }));
    expect(last.deny?.headers.get("retry-after")).toBeTruthy();
  });

  it("the 429 NAMES the limit, the window and the layer that refused", async () => {
    // A naked 429 leaves an exporter unable to tell "you exceeded YOUR budget" (raise the export
    // interval / split the egress) from "the instance-wide budget is exhausted" (not fixable here).
    const ip = "10.0.0.97";
    const auth = `Bearer ${tokens.ingestToken("acme")}`;
    for (let i = 0; i < 3; i++) await guard.guardIngest(mkReq({ auth, ip }));
    const res = (await guard.guardIngest(mkReq({ auth, ip }))).deny!;

    expect(res.status).toBe(429);
    expect(res.headers.get("x-ascent-ratelimit-scope")).toBe("ip");
    expect(res.headers.get("x-ascent-ratelimit-limit")).toBe("3"); // the per-IP cap for this run
    expect(res.headers.get("x-ascent-ratelimit-window")).toBe("60");
    const body = (await res.json()) as { code: string; scope: string; limiter: string; limit: number };
    expect(body.code).toBe("rate_limited");
    expect(body.scope).toBe("ip");
    expect(body.limiter).toBe("integrations-ingest");
    expect(body.limit).toBe(3);
  });

  it("refuses an over-limit caller with 429 even when the token is bad (limit precedes crypto)", async () => {
    const ip = "10.0.0.98";
    for (let i = 0; i < 3; i++) await guard.guardIngest(mkReq({ auth: `Bearer ${tokens.ingestToken("acme")}`, ip }));
    const res = await guard.guardIngest(mkReq({ auth: "Bearer nonsense", ip }));
    expect(res.deny?.status).toBe(429);
  });
});

describe("guardIngest — per-org revocation epoch", () => {
  const ip = () => `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const call = (token: string) => guard.guardIngest(mkReq({ auth: `Bearer ${token}`, ip: ip() }));

  it("accepts an epoch-0 (pre-rotation) token while the org has never rotated", async () => {
    db.epoch = 0;
    expect(await call(tokens.ingestToken("acme"))).toEqual({ slug: "acme" });
  });

  it("401s the OLD token and accepts the NEW one the instant the epoch bumps", async () => {
    const before = tokens.ingestToken("acme", 0);
    db.epoch = 0;
    expect(await call(before)).toEqual({ slug: "acme" }); // works before the bump

    db.epoch = 1; // the owner hit "Regenerate token"
    const denied = await call(before);
    expect(denied.deny?.status).toBe(401);
    expect(((await denied.deny!.json()) as { error: string }).error).toMatch(/regenerated/i);

    expect(await call(tokens.ingestToken("acme", 1))).toEqual({ slug: "acme" }); // the new one works
  });

  it("keeps rejecting every superseded epoch after repeated rotations", async () => {
    db.epoch = 3;
    for (const stale of [0, 1, 2]) expect((await call(tokens.ingestToken("acme", stale))).deny?.status).toBe(401);
    expect(await call(tokens.ingestToken("acme", 3))).toEqual({ slug: "acme" });
  });

  it("accepts a token minted ABOVE the stored epoch (a rotation this instance hasn't read yet)", async () => {
    db.epoch = 1;
    expect(await call(tokens.ingestToken("acme", 2))).toEqual({ slug: "acme" });
  });

  it("503s when the epoch can't be read — 'revocation state unknown' never resolves to 'accept'", async () => {
    db.epoch = null;
    const res = await call(tokens.ingestToken("acme"));
    expect(res.deny?.status).toBe(503);
    expect(res.deny?.headers.get("retry-after")).toBe("30");
    db.epoch = 0;
  });
});
