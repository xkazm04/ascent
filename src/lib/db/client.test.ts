import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDsqlUrl,
  dbReadSafe,
  isAuthExpiryError,
  isDbUnavailableError,
  isSerializationConflictError,
  readDsqlConfig,
  runWithReconnect,
  withDb,
  withRetry,
} from "@/lib/db/client";

const ENV_KEYS = [
  "DSQL_ENDPOINT",
  "DSQL_REGION",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "DSQL_USER",
  "DSQL_DATABASE",
  "DSQL_PORT",
  "DSQL_SSLMODE",
  "DSQL_TOKEN_TTL_SECONDS",
  "DSQL_REFRESH_MARGIN_SECONDS",
] as const;

describe("readDsqlConfig", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("returns null in static mode (no DSQL_ENDPOINT)", () => {
    expect(readDsqlConfig(process.env)).toBeNull();
  });

  it("throws when the endpoint is set but no region can be resolved", () => {
    process.env.DSQL_ENDPOINT = "abc.dsql.us-east-1.on.aws";
    expect(() => readDsqlConfig(process.env)).toThrow(/region/i);
  });

  it("falls back to AWS_REGION for the region", () => {
    process.env.DSQL_ENDPOINT = "abc.dsql.us-east-1.on.aws";
    process.env.AWS_REGION = "us-east-1";
    expect(readDsqlConfig(process.env)?.region).toBe("us-east-1");
  });

  it("applies sensible defaults", () => {
    process.env.DSQL_ENDPOINT = "abc.dsql.us-east-1.on.aws";
    process.env.DSQL_REGION = "eu-west-1";
    const cfg = readDsqlConfig(process.env);
    expect(cfg).toMatchObject({
      endpoint: "abc.dsql.us-east-1.on.aws",
      region: "eu-west-1",
      user: "admin",
      database: "postgres",
      port: 5432,
      sslmode: "require",
      ttlSeconds: 900,
      refreshMarginSeconds: 120,
    });
  });

  it("honors overrides and clamps invalid numbers to the defaults", () => {
    process.env.DSQL_ENDPOINT = "abc.dsql.us-east-1.on.aws";
    process.env.DSQL_REGION = "us-east-1";
    process.env.DSQL_USER = "readonly";
    process.env.DSQL_PORT = "not-a-number";
    process.env.DSQL_TOKEN_TTL_SECONDS = "300";
    const cfg = readDsqlConfig(process.env);
    expect(cfg?.user).toBe("readonly");
    expect(cfg?.port).toBe(5432); // invalid -> default
    expect(cfg?.ttlSeconds).toBe(300);
  });
});

describe("buildDsqlUrl", () => {
  const cfg = {
    endpoint: "abc.dsql.us-east-1.on.aws",
    region: "us-east-1",
    user: "admin",
    database: "postgres",
    port: 5432,
    sslmode: "require",
    ttlSeconds: 900,
    refreshMarginSeconds: 120,
  };

  it("injects user, host, db, and sslmode", () => {
    const url = new URL(buildDsqlUrl(cfg, "plaintoken"));
    expect(url.protocol).toBe("postgresql:");
    expect(url.username).toBe("admin");
    expect(url.hostname).toBe("abc.dsql.us-east-1.on.aws");
    expect(url.port).toBe("5432");
    expect(url.pathname).toBe("/postgres");
    expect(url.searchParams.get("sslmode")).toBe("require");
  });

  it("percent-encodes a token containing url-special characters", () => {
    const token = "Action=Connect&X-Amz-Signature=ab/cd+ef=";
    const url = new URL(buildDsqlUrl(cfg, token));
    // The serialized password is percent-encoded (so `=`, `/` etc. don't break URL parsing)...
    expect(url.password).toContain("%3D");
    expect(url.password).toContain("%2F");
    // ...and a downstream parser (pg/Prisma) recovers the exact token via decodeURIComponent.
    expect(decodeURIComponent(url.password)).toBe(token);
  });
});

describe("isAuthExpiryError", () => {
  it("matches Postgres and Prisma auth codes", () => {
    expect(isAuthExpiryError({ code: "28000" })).toBe(true);
    expect(isAuthExpiryError({ code: "28P01" })).toBe(true);
    expect(isAuthExpiryError({ code: "P1000" })).toBe(true);
    expect(isAuthExpiryError({ code: "P1010" })).toBe(true);
    expect(isAuthExpiryError({ meta: { code: "28P01" } })).toBe(true);
  });

  it("matches auth/expiry messages case-insensitively", () => {
    expect(isAuthExpiryError(new Error("password authentication failed for user"))).toBe(true);
    expect(isAuthExpiryError(new Error("The security token included in the request is expired"))).toBe(
      true,
    );
    expect(isAuthExpiryError({ message: "Invalid authorization specification" })).toBe(true);
  });

  it("is false for unrelated errors and nullish input", () => {
    expect(isAuthExpiryError(null)).toBe(false);
    expect(isAuthExpiryError(undefined)).toBe(false);
    expect(isAuthExpiryError(new Error("unique constraint violated"))).toBe(false);
    expect(isAuthExpiryError({ code: "23505" })).toBe(false);
  });
});

describe("isDbUnavailableError", () => {
  it("matches the PrismaClientInitializationError class by name", () => {
    const err = Object.assign(new Error("Can't reach database server at `localhost:5432`"), {
      name: "PrismaClientInitializationError",
    });
    expect(isDbUnavailableError(err)).toBe(true);
  });

  it("matches the Prisma connection SQLSTATEs", () => {
    expect(isDbUnavailableError({ code: "P1001" })).toBe(true); // can't reach
    expect(isDbUnavailableError({ code: "P1002" })).toBe(true); // reach timeout
    expect(isDbUnavailableError({ code: "P1008" })).toBe(true); // op timeout
    expect(isDbUnavailableError({ code: "P1011" })).toBe(true); // TLS
    expect(isDbUnavailableError({ code: "P1017" })).toBe(true); // server closed
    expect(isDbUnavailableError({ meta: { code: "P1001" } })).toBe(true);
  });

  it("matches connection-down messages case-insensitively", () => {
    expect(isDbUnavailableError(new Error("Can't reach database server at `localhost:5432`"))).toBe(true);
    expect(isDbUnavailableError(new Error("connect ECONNREFUSED 127.0.0.1:5432"))).toBe(true);
    expect(isDbUnavailableError({ message: "Connection refused" })).toBe(true);
  });

  it("is false for live-DB query errors and nullish input", () => {
    expect(isDbUnavailableError(null)).toBe(false);
    expect(isDbUnavailableError(undefined)).toBe(false);
    expect(isDbUnavailableError({ code: "P2002" })).toBe(false); // unique constraint — a real bug
    expect(isDbUnavailableError({ code: "23505" })).toBe(false);
    expect(isDbUnavailableError(new Error("unique constraint violated"))).toBe(false);
  });
});

describe("dbReadSafe", () => {
  it("returns the read result when it succeeds", async () => {
    expect(await dbReadSafe(async () => "rows", null)).toBe("rows");
  });

  it("degrades to the fallback when the database is unreachable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = Object.assign(new Error("Can't reach database server at `localhost:5432`"), {
      name: "PrismaClientInitializationError",
    });
    const result = await dbReadSafe<string | null>(async () => {
      throw err;
    }, null);
    expect(result).toBeNull();
    vi.restoreAllMocks();
  });

  it("re-throws a real query error against a live database (not swallowed as 'no data')", async () => {
    await expect(
      dbReadSafe(async () => {
        throw { code: "P2002", message: "Unique constraint failed" };
      }, null),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("runWithReconnect", () => {
  const clientA = { id: "A" } as never;
  const clientB = { id: "B" } as never;

  it("returns the op result without reconnecting on success", async () => {
    let reconnects = 0;
    const result = await runWithReconnect(async (c) => (c as { id: string }).id, {
      getClient: () => clientA,
      reconnect: async () => {
        reconnects++;
        return clientB;
      },
    });
    expect(result).toBe("A");
    expect(reconnects).toBe(0);
  });

  it("reconnects and retries once on an auth-expiry error", async () => {
    let calls = 0;
    let reconnects = 0;
    const result = await runWithReconnect(
      async (c) => {
        calls++;
        if ((c as { id: string }).id === "A") {
          throw { code: "28P01", message: "token expired" };
        }
        return (c as { id: string }).id;
      },
      {
        getClient: () => clientA,
        reconnect: async () => {
          reconnects++;
          return clientB;
        },
      },
    );
    expect(result).toBe("B");
    expect(calls).toBe(2);
    expect(reconnects).toBe(1);
  });

  it("does not retry (or reconnect) on a non-auth error", async () => {
    let reconnects = 0;
    await expect(
      runWithReconnect(
        async () => {
          throw new Error("unique constraint violated");
        },
        {
          getClient: () => clientA,
          reconnect: async () => {
            reconnects++;
            return clientB;
          },
        },
      ),
    ).rejects.toThrow(/unique constraint/);
    expect(reconnects).toBe(0);
  });

  it("propagates the error if the retry also fails", async () => {
    await expect(
      runWithReconnect(
        async () => {
          throw { code: "28P01", message: "still expired" };
        },
        {
          getClient: () => clientA,
          reconnect: async () => clientB,
        },
      ),
    ).rejects.toMatchObject({ code: "28P01" });
  });
});

// Pins persistence 06-11 #1: inside the refresh margin the cached client's token is still VALID,
// so a transient IAM-mint failure during withDb's PROACTIVE refresh must fall through to the
// cached client instead of failing the op (which lost scan persists and triggered cron backoffs
// during STS blips). The mint failure here is real: @aws-sdk/dsql-signer is deliberately not
// installed in this repo, so refresh() rejects exactly like a prod mint outage.
describe("withDb — proactive refresh is best-effort while a client is cached", () => {
  const g = globalThis as unknown as {
    __ascentPrisma?: { client: unknown; expiresAt: number };
    __ascentPrismaRefresh?: Promise<unknown>;
  };
  const savedEnv: Record<string, string | undefined> = {};
  let savedState: typeof g.__ascentPrisma;

  beforeEach(() => {
    for (const k of ["DSQL_ENDPOINT", "DSQL_REGION", "DATABASE_URL"]) savedEnv[k] = process.env[k];
    process.env.DSQL_ENDPOINT = "test.dsql.us-east-1.on.aws";
    process.env.DSQL_REGION = "us-east-1";
    savedState = g.__ascentPrisma;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    // Let the single-flighted background refresh kicked by getPrisma() settle before restoring.
    await g.__ascentPrismaRefresh?.catch(() => {});
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    g.__ascentPrisma = savedState;
    vi.restoreAllMocks();
  });

  it("runs the op on the cached client when the proactive mint fails inside the margin", async () => {
    const cached = { id: "cached" } as never;
    g.__ascentPrisma = { client: cached, expiresAt: 0 }; // stale → refresh attempted → mint fails
    const result = await withDb(async (client) => {
      expect(client).toBe(cached);
      return "persisted";
    });
    expect(result).toBe("persisted");
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("proactive DSQL token refresh failed"),
      expect.any(String),
    );
  });

  it("still fails when no client exists at all (nothing usable to fall back on)", async () => {
    g.__ascentPrisma = undefined;
    delete process.env.DATABASE_URL;
    await expect(withDb(async () => "unreachable")).rejects.toThrow(/dsql-signer/i);
  });
});

describe("isSerializationConflictError", () => {
  it("matches the Postgres transaction-rollback SQLSTATEs", () => {
    expect(isSerializationConflictError({ code: "40001" })).toBe(true); // serialization_failure
    expect(isSerializationConflictError({ code: "40P01" })).toBe(true); // deadlock_detected
    expect(isSerializationConflictError({ meta: { code: "40001" } })).toBe(true);
  });

  it("matches Prisma's write-conflict/deadlock code and DSQL OC### codes", () => {
    expect(isSerializationConflictError({ code: "P2034" })).toBe(true);
    expect(isSerializationConflictError({ code: "OC000" })).toBe(true);
    expect(isSerializationConflictError({ code: "OC001" })).toBe(true);
    expect(isSerializationConflictError({ code: "oc000" })).toBe(true); // case-insensitive
  });

  it("matches serialization/conflict messages case-insensitively", () => {
    expect(
      isSerializationConflictError(
        new Error("could not serialize access due to read/write dependencies among transactions"),
      ),
    ).toBe(true);
    expect(isSerializationConflictError(new Error("deadlock detected"))).toBe(true);
    expect(
      isSerializationConflictError(new Error("change conflicts with another transaction, please retry: (OC000)")),
    ).toBe(true);
    expect(isSerializationConflictError({ message: "write conflict, please retry the transaction" })).toBe(true);
  });

  it("is false for auth-expiry, unique-violation, and nullish input", () => {
    expect(isSerializationConflictError(null)).toBe(false);
    expect(isSerializationConflictError(undefined)).toBe(false);
    expect(isSerializationConflictError({ code: "28P01" })).toBe(false); // auth expiry, not OCC
    expect(isSerializationConflictError({ code: "23505" })).toBe(false); // unique_violation
    expect(isSerializationConflictError({ code: "P2002" })).toBe(false); // Prisma unique constraint
    expect(isSerializationConflictError(new Error("connection reset"))).toBe(false);
  });

  // A token-expiry error must reconnect (isAuthExpiryError) and an OCC conflict must retry
  // (isSerializationConflictError) — the two classifiers must never both claim the same error.
  it("is disjoint from isAuthExpiryError", () => {
    const occ = { code: "40001", message: "could not serialize access" };
    const auth = { code: "28P01", message: "password authentication failed" };
    expect(isSerializationConflictError(occ) && !isAuthExpiryError(occ)).toBe(true);
    expect(isAuthExpiryError(auth) && !isSerializationConflictError(auth)).toBe(true);
  });
});

describe("withRetry", () => {
  const occ = () => ({ code: "40001", message: "could not serialize access" });
  // Records each backoff so a test can assert the schedule without actually waiting.
  const recordingSleep = () => {
    const delays: number[] = [];
    return { delays, sleep: async (ms: number) => void delays.push(ms) };
  };

  it("returns the result on first success without sleeping", async () => {
    const { delays, sleep } = recordingSleep();
    const fn = vi.fn(async () => "ok");
    expect(await withRetry(fn, { sleep })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it("retries a serialization conflict and then succeeds", async () => {
    const { delays, sleep } = recordingSleep();
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw occ();
        return "recovered";
      },
      { sleep, random: () => 0 },
    );
    expect(result).toBe("recovered");
    expect(calls).toBe(3);
    expect(delays).toHaveLength(2); // slept before each of the two retries
  });

  it("does not retry a non-serialization error", async () => {
    const { delays, sleep } = recordingSleep();
    const fn = vi.fn(async () => {
      throw new Error("unique constraint violated");
    });
    await expect(withRetry(fn, { sleep })).rejects.toThrow(/unique constraint/);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it("exhausts maxAttempts and throws the last error", async () => {
    const { delays, sleep } = recordingSleep();
    const fn = vi.fn(async () => {
      throw occ();
    });
    await expect(withRetry(fn, { sleep, maxAttempts: 3, random: () => 0 })).rejects.toMatchObject({
      code: "40001",
    });
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(delays).toHaveLength(2);
  });

  it("backs off exponentially with full jitter, capped at maxDelayMs", async () => {
    const { delays, sleep } = recordingSleep();
    await expect(
      withRetry(async () => Promise.reject(occ()), {
        sleep,
        maxAttempts: 6,
        baseDelayMs: 10,
        maxDelayMs: 40,
        random: () => 0.5, // half of each attempt's ceiling
      }),
    ).rejects.toBeTruthy();
    // ceilings: 10, 20, 40, 40(capped), 40(capped); ×0.5 (floored) => 5, 10, 20, 20, 20
    expect(delays).toEqual([5, 10, 20, 20, 20]);
  });

  it("honors a custom isRetryable predicate", async () => {
    const { delays, sleep } = recordingSleep();
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 2) throw new Error("transient");
        return "done";
      },
      { sleep, random: () => 0, isRetryable: (e) => e instanceof Error && e.message === "transient" },
    );
    expect(result).toBe("done");
    expect(calls).toBe(2);
    expect(delays).toHaveLength(1);
  });
});
