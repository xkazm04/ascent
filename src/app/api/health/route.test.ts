// GET /api/health — the unauthenticated liveness endpoint. Two security-grade invariants here:
//   1. No-error-leak: the route's own comment forbids spreading the `dbHealthCheck()` result into the
//      public body because `result.error` carries the raw DB error string (Prisma/Postgres/DSQL
//      internals, connection host/port, IAM-auth failure text) and the endpoint has NO auth gate.
//   2. Topology gating (app-shell-seo #4): the DETAILED fields — `dbMode` (the specific backend) and
//      `autoscan` readiness (which operational secrets/config are present) — describe deployment
//      topology and are exposed ONLY to an internal caller presenting the CRON_SECRET bearer. An
//      anonymous probe gets the minimal liveness shape. When no CRON_SECRET is configured (dev/demo)
//      there's nothing to protect, so details stay open.
//
// We mock the db check to (a) succeed → 200 / db:"up", and (b) throw a DB error whose message embeds
// secret-ish substrings. We then assert the serialized body NEVER contains those substrings, that the
// status is the degraded 503, and that the body shape is exactly the safe liveness shape — minimal for
// anonymous, detailed for internal. next/server is mocked with a tiny NextResponse whose .json()
// returns a real Response; @/lib/db and @/lib/github/app are mocked so no real DB / GitHub App config
// is touched — dbHealthCheck is fully under test control.

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
  // The route reports the active backend to internal callers; a fixed safe value keeps the no-leak
  // assertions honest (getDbMode only ever returns the mode enum — never the endpoint/credentials).
  getDbMode: () => "postgres",
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

const CRON = "cron-secret";
const ENV_KEYS = ["CRON_SECRET", "DATABASE_URL", "DSQL_ENDPOINT"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  vi.clearAllMocks();
  // Default to a fully-configured, healthy deployment with CRON_SECRET set (so anonymous callers get
  // the gated/minimal shape); individual tests override.
  process.env.CRON_SECRET = CRON;
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

function request(auth?: string) {
  return new Request("http://localhost/api/health", auth ? { headers: { authorization: auth } } : {});
}
async function callGet(auth?: string) {
  const res = await GET(request(auth));
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as Record<string, unknown> };
}
// An internal caller presents the CRON_SECRET bearer; anonymous callers omit it.
const callInternal = () => callGet(`Bearer ${CRON}`);

describe("GET /api/health — healthy DB", () => {
  it("anonymous: 200 with the MINIMAL liveness shape (no dbMode / autoscan topology)", async () => {
    mockDbHealthCheck.mockResolvedValue({ ok: true, reconnected: false });
    const { status, body } = await callGet();
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.db).toBe("up");
    expect(body.reconnected).toBe(false);
    // The topology fields are gated out for an anonymous probe.
    expect("dbMode" in body).toBe(false);
    expect("autoscan" in body).toBe(false);
    expect(Object.keys(body).sort()).toEqual(["db", "reconnected", "status"]);
  });

  it("internal (CRON_SECRET bearer): 200 with the detailed shape including dbMode + autoscan", async () => {
    const { status, body } = await callInternal();
    expect(status).toBe(200);
    expect(body.db).toBe("up");
    expect(body.dbMode).toBe("postgres");
    expect(body.autoscan).toBeTypeOf("object");
  });

  it("works with no auth — an anonymous GET still resolves a Response", async () => {
    await expect(GET(request())).resolves.toBeInstanceOf(Response);
  });
});

describe("GET /api/health — DB check fails (the no-leak invariant)", () => {
  it("internal: degraded 503 / db:'down' but the body NEVER contains the raw DB error or connection string", async () => {
    mockDbHealthCheck.mockResolvedValue({ ok: false, reconnected: true, error: LEAKY_ERROR });

    const { status, text, body } = await callInternal();

    expect(status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.db).toBe("down");

    // THE INVARIANT: no secret-ish substring of the DB error leaks into the serialized body.
    for (const secret of SECRET_SUBSTRINGS) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain(LEAKY_ERROR);

    // No field is derived from result.error — the internal body has only the safe keys.
    expect(Object.keys(body).sort()).toEqual(["autoscan", "db", "dbMode", "reconnected", "status"]);
    expect("error" in body).toBe(false);
  });

  it("anonymous: degraded 503 with the minimal shape and no leak, no topology", async () => {
    mockDbHealthCheck.mockResolvedValue({ ok: false, reconnected: true, error: LEAKY_ERROR });

    const { status, text, body } = await callGet();

    expect(status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.db).toBe("down");
    for (const secret of SECRET_SUBSTRINGS) {
      expect(text).not.toContain(secret);
    }
    expect(Object.keys(body).sort()).toEqual(["db", "reconnected", "status"]);
  });

  it("when dbHealthCheck THROWS, the route catches it and returns a generic 503 with NO leaked error", async () => {
    // The real `dbHealthCheck()` catches internally and ALWAYS resolves, but the route must not RELY on
    // that — it wraps the call in try/catch and emits the generic degraded shape so a rejection never
    // reaches the framework's error serializer (a leak on this unauthenticated endpoint).
    mockDbHealthCheck.mockRejectedValue(new Error(LEAKY_ERROR));

    const { status, text, body } = await callInternal();

    expect(status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.db).toBe("down");
    for (const secret of SECRET_SUBSTRINGS) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain(LEAKY_ERROR);
    expect(Object.keys(body).sort()).toEqual(["autoscan", "db", "dbMode", "reconnected", "status"]);
    expect("error" in body).toBe(false);
  });
});

describe("GET /api/health — persistence disabled", () => {
  it("anonymous: 200 / db:'disabled' with the minimal shape (no dbMode) and no dbHealthCheck call", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const { status, body } = await callGet();
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.db).toBe("disabled");
    expect("dbMode" in body).toBe(false);
    expect(mockDbHealthCheck).not.toHaveBeenCalled();
  });

  it("internal: 200 / db:'disabled' still reports dbMode for a monitor", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const { body } = await callInternal();
    expect(body.db).toBe("disabled");
    expect(body.dbMode).toBe("postgres");
  });
});

describe("GET /api/health — topology gating (app-shell-seo #4)", () => {
  it("a wrong/missing bearer is treated as anonymous — no topology leaks", async () => {
    const { body: wrong } = await callGet("Bearer nope");
    expect("dbMode" in wrong).toBe(false);
    expect("autoscan" in wrong).toBe(false);

    const { body: none } = await callGet();
    expect("dbMode" in none).toBe(false);
  });

  it("when CRON_SECRET is unset (dev/demo), there's nothing to gate — details are open to anyone", async () => {
    delete process.env.CRON_SECRET;
    const { body } = await callGet();
    expect(body.dbMode).toBe("postgres");
    expect(body.autoscan).toBeTypeOf("object");
  });
});

describe("GET /api/health — autoscan readiness tripwire", () => {
  it("ready === (cronSecret && githubApp && db), and each sub-flag mirrors its source", async () => {
    const combos = [0, 1, 2, 3, 4, 5, 6, 7];
    for (const mask of combos) {
      const cron = Boolean(mask & 1);
      const app = Boolean(mask & 2);
      const db = Boolean(mask & 4);

      if (cron) process.env.CRON_SECRET = CRON;
      else delete process.env.CRON_SECRET;
      mockIsAppConfigured.mockReturnValue(app);
      mockIsDbConfigured.mockReturnValue(db);
      mockDbHealthCheck.mockResolvedValue({ ok: true, reconnected: false });

      // Always present the bearer: when cron is set it authenticates; when cron is unset the endpoint
      // is open — either way this caller sees the autoscan detail so the tripwire is observable.
      const { body } = await callGet(`Bearer ${CRON}`);
      const autoscan = body.autoscan as Record<string, boolean>;
      expect(autoscan.cronSecret).toBe(cron);
      expect(autoscan.githubApp).toBe(app);
      expect(autoscan.db).toBe(db);
      expect(autoscan.ready).toBe(cron && app && db);
    }
  });
});
