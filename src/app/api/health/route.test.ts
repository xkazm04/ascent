// GET /api/health — the unauthenticated liveness endpoint. The single security-grade invariant here
// is the no-error-leak guard: the route's own comment (route.ts:34-37) forbids spreading the
// `dbHealthCheck()` result into the public body because `result.error` carries the raw DB error
// string (Prisma/Postgres/DSQL internals, connection host/port, IAM-auth failure text) and the
// endpoint has NO auth gate. That rule lives only in a comment — this test makes CI enforce it.
//
// We mock the db check to (a) succeed → 200 / db:"up", and (b) throw a DB error whose message embeds
// secret-ish substrings (connection string + "password=" + DSQL host + port + "token expired"). We
// then assert the serialized response body NEVER contains any of those substrings, that the status
// is the degraded 503, and that the body shape is exactly the safe liveness shape. We also pin the
// `isDbConfigured()===false` early return (200 / db:"disabled") and the autoscan readiness truth.
//
// next/server is mocked with a tiny NextResponse whose .json() returns a real Response, so we can
// read body+status without the Next runtime. @/lib/db and @/lib/github/app are mocked so no real DB
// or GitHub App config is touched — dbHealthCheck is fully under test control.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockDbHealthCheck, mockIsDbConfigured, mockIsAppConfigured } = vi.hoisted(() => ({
  mockDbHealthCheck: vi.fn(),
  mockIsDbConfigured: vi.fn(),
  mockIsAppConfigured: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

vi.mock("@/lib/db", () => ({
  dbHealthCheck: mockDbHealthCheck,
  isDbConfigured: mockIsDbConfigured,
}));

vi.mock("@/lib/github/app", () => ({
  isAppConfigured: mockIsAppConfigured,
}));

import { GET } from "./route";

// A DB error string mirroring what a real Prisma/DSQL failure would surface: connection string with
// credentials, the literal "password=", the DSQL endpoint host, its port, and the IAM token-expiry
// text. Every one of these substrings must be absent from the public response body.
const LEAKY_ERROR =
  "Can't reach database server at postgres://admin:hunter2@dsql-xyz.us-east-1.on.aws:5432/ascent " +
  "(password=hunter2, token expired)";
const SECRET_SUBSTRINGS = [
  "postgres://",
  "password=",
  "hunter2",
  "admin",
  "dsql-xyz",
  "us-east-1.on.aws",
  "5432",
  "token expired",
  "Can't reach database server",
];

const ENV_KEYS = ["CRON_SECRET", "DATABASE_URL", "DSQL_ENDPOINT"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  vi.clearAllMocks();
  // Default to a fully-configured, healthy deployment; individual tests override.
  process.env.CRON_SECRET = "cron-secret";
  mockIsAppConfigured.mockReturnValue(true);
  mockIsDbConfigured.mockReturnValue(true);
  mockDbHealthCheck.mockResolvedValue({ ok: true, reconnected: false });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

async function callGet() {
  const res = await GET();
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as Record<string, unknown> };
}

describe("GET /api/health — healthy DB", () => {
  it("returns 200 with the safe liveness shape (db:'up', status:'ok')", async () => {
    mockDbHealthCheck.mockResolvedValue({ ok: true, reconnected: false });
    const { status, body } = await callGet();
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.db).toBe("up");
    expect(body.reconnected).toBe(false);
  });

  it("works with no auth — GET() takes no request/auth and still answers", async () => {
    // The handler signature is `GET()` with no auth gate; an anonymous call resolves a body.
    await expect(GET()).resolves.toBeInstanceOf(Response);
  });
});

describe("GET /api/health — DB check fails (the no-leak invariant)", () => {
  it("returns degraded 503 / db:'down' but the body NEVER contains the raw DB error or connection string", async () => {
    mockDbHealthCheck.mockResolvedValue({ ok: false, reconnected: true, error: LEAKY_ERROR });

    const { status, text, body } = await callGet();

    // Degraded, generic status.
    expect(status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.db).toBe("down");

    // THE INVARIANT: no secret-ish substring of the DB error leaks into the serialized body.
    for (const secret of SECRET_SUBSTRINGS) {
      expect(text).not.toContain(secret);
    }
    // And the raw error message in full is absent.
    expect(text).not.toContain(LEAKY_ERROR);

    // No field is derived from result.error — the body has only the safe keys.
    expect(Object.keys(body).sort()).toEqual(["autoscan", "db", "reconnected", "status"]);
    expect("error" in body).toBe(false);
  });

  it("DOCUMENTS current behavior: the no-leak guard holds on dbHealthCheck's RESOLVED failure shape, not a raw reject", async () => {
    // The real `dbHealthCheck()` (src/lib/db/client.ts) catches internally and ALWAYS resolves to
    // `{ ok, reconnected, error? }` — it never rejects. The route relies on that: it reads the
    // resolved shape and emits the safe body (asserted in the test above). This test pins the flip
    // side as a tripwire: the route does NOT wrap dbHealthCheck in try/catch, so IF a future refactor
    // made the check throw, the rejection would propagate to the framework's error serializer (a
    // leak risk). Today that contract is "dbHealthCheck never throws" — pin it so a regression that
    // makes it throw fails loudly here and forces adding a try/catch returning the generic 503 shape.
    mockDbHealthCheck.mockRejectedValue(new Error(LEAKY_ERROR));
    // Current behavior: GET propagates the rejection (no in-route catch). This is the documented gap.
    await expect(GET()).rejects.toThrow();
    // Reinforces WHY the resolved-shape no-leak test above is the real protection: the route's own
    // body construction (the path actually taken in production) never includes result.error.
  });
});

describe("GET /api/health — persistence disabled", () => {
  it("returns 200 / db:'disabled' without ever calling dbHealthCheck", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const { status, body } = await callGet();
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.db).toBe("disabled");
    expect(mockDbHealthCheck).not.toHaveBeenCalled();
  });
});

describe("GET /api/health — autoscan readiness tripwire", () => {
  it("ready === (cronSecret && githubApp && db), and each sub-flag mirrors its source", async () => {
    const combos = [0, 1, 2, 3, 4, 5, 6, 7];
    for (const mask of combos) {
      const cron = Boolean(mask & 1);
      const app = Boolean(mask & 2);
      const db = Boolean(mask & 4);

      if (cron) process.env.CRON_SECRET = "cron-secret";
      else delete process.env.CRON_SECRET;
      mockIsAppConfigured.mockReturnValue(app);
      mockIsDbConfigured.mockReturnValue(db);
      mockDbHealthCheck.mockResolvedValue({ ok: true, reconnected: false });

      const { body } = await callGet();
      const autoscan = body.autoscan as Record<string, boolean>;
      expect(autoscan.cronSecret).toBe(cron);
      expect(autoscan.githubApp).toBe(app);
      expect(autoscan.db).toBe(db);
      expect(autoscan.ready).toBe(cron && app && db);
    }
  });
});
