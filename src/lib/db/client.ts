// Lazy, token-aware PrismaClient singleton. Persistence is OPTIONAL: the MVP runs with no
// database, so importing this module never crashes a keyless/DB-less deployment.
//
// Aurora DSQL note: DSQL speaks the Postgres protocol, but its connection password is a
// SHORT-LIVED IAM auth token (~15 min TTL). A client cached from a single static
// DATABASE_URL therefore becomes unusable minutes after deploy — once the embedded token
// expires, every new connection fails until the process is recycled. To avoid that silent
// 2 AM outage, this module mints/refreshes the IAM token via a connection factory:
//
//   • Static mode (default, local Postgres): behaves exactly like the old lazy singleton —
//     one client built from DATABASE_URL, never expires.
//   • DSQL mode (DSQL_ENDPOINT set): the connection URL is rebuilt from a freshly minted IAM
//     token. getPrisma() proactively kicks a background refresh before the token's TTL
//     elapses, and withDb()/dbHealthCheck() reactively reconnect on an auth-expiry error.
//
// Token minting uses @aws-sdk/dsql-signer, imported lazily so the static/local path never
// pulls in the AWS SDK and the build works without the package installed. See
// docs/ARCHITECTURE.md §3-4.

import { PrismaClient } from "@prisma/client";

// ── DSQL connection config (env-driven; null = static mode) ──────────────────────────────

type DsqlConfig = {
  endpoint: string; // cluster host, e.g. "abc123.dsql.us-east-1.on.aws"
  region: string;
  user: string; // "admin" by default
  database: string;
  port: number;
  sslmode: string;
  ttlSeconds: number; // token lifetime requested from the signer
  refreshMarginSeconds: number; // refresh this many seconds before expiry
};

function positiveIntOr(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Read the Aurora DSQL connection config from the environment. Returns null when DSQL_ENDPOINT
 * is unset (static mode — local Postgres / a fixed DATABASE_URL). Throws only on a genuine
 * misconfiguration (DSQL enabled but no region), so static deployments never hit it.
 */
export function readDsqlConfig(env: NodeJS.ProcessEnv = process.env): DsqlConfig | null {
  const endpoint = env.DSQL_ENDPOINT?.trim();
  if (!endpoint) return null;
  const region = (env.DSQL_REGION || env.AWS_REGION || env.AWS_DEFAULT_REGION || "").trim();
  if (!region) {
    throw new Error(
      "DSQL_ENDPOINT is set but no region — set DSQL_REGION (or AWS_REGION / AWS_DEFAULT_REGION).",
    );
  }
  return {
    endpoint,
    region,
    user: (env.DSQL_USER || "admin").trim(),
    database: (env.DSQL_DATABASE || "postgres").trim(),
    port: positiveIntOr(env.DSQL_PORT, 5432),
    sslmode: (env.DSQL_SSLMODE || "require").trim(),
    ttlSeconds: positiveIntOr(env.DSQL_TOKEN_TTL_SECONDS, 900),
    refreshMarginSeconds: positiveIntOr(env.DSQL_REFRESH_MARGIN_SECONDS, 120),
  };
}

/**
 * Build a Postgres connection URL for DSQL, injecting the IAM token as the password. The WHATWG
 * URL setter percent-encodes the token (DSQL tokens contain `&`, `=`, `/`, `+`, …), so the URL
 * is always well-formed. Pure + exported for unit testing.
 */
export function buildDsqlUrl(cfg: DsqlConfig, token: string): string {
  const url = new URL(`postgresql://${cfg.endpoint}:${cfg.port}/${cfg.database}`);
  url.username = cfg.user;
  url.password = token;
  url.searchParams.set("sslmode", cfg.sslmode);
  return url.toString();
}

// ── Error classification ─────────────────────────────────────────────────────────────────

function errorInfo(err: unknown): { code?: string; message: string } {
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; message?: unknown; meta?: { code?: unknown } };
    const code =
      typeof e.code === "string"
        ? e.code
        : e.meta && typeof e.meta.code === "string"
          ? e.meta.code
          : undefined;
    const message = typeof e.message === "string" ? e.message : String(err);
    return { code, message };
  }
  return { message: String(err) };
}

/**
 * Does this error look like the DSQL/Postgres connection was rejected because the IAM auth
 * token expired or was invalid? Matches Postgres SQLSTATEs 28000 / 28P01, Prisma's auth init
 * codes (P1000 auth failed, P1010 access denied), and the corresponding error messages. Pure +
 * exported for unit testing.
 */
export function isAuthExpiryError(err: unknown): boolean {
  if (err == null) return false;
  const { code, message } = errorInfo(err);
  if (code === "28000" || code === "28P01" || code === "P1000" || code === "P1010") {
    return true;
  }
  const m = message.toLowerCase();
  return (
    m.includes("password authentication failed") ||
    m.includes("authentication failed") ||
    m.includes("invalid authorization") ||
    m.includes("access denied") ||
    m.includes("expired token") ||
    (m.includes("token") && m.includes("expired"))
  );
}

/**
 * Does this error look like a DSQL/Postgres OPTIMISTIC-CONCURRENCY (serialization) conflict — the
 * retryable failure a distributed, lock-free store raises at COMMIT when two transactions touched
 * overlapping rows? Aurora DSQL uses OCC instead of row locks (docs/ARCHITECTURE.md §3), so any
 * real concurrency (two users scanning at once, a cron rescan batch) can make a commit lose and
 * MUST be retried — it's not a bug, it's how OCC signals "someone else won, try again". Matches the
 * Postgres "transaction rollback" SQLSTATE class — 40001 (serialization_failure) and 40P01
 * (deadlock_detected) — Prisma's P2034 write-conflict/deadlock code, DSQL's OC###-class concurrency
 * codes (e.g. OC000, OC001), and the corresponding messages. Pure + exported for unit testing.
 * Distinct from isAuthExpiryError: an expired token is recovered by reconnecting, not by retrying.
 */
export function isSerializationConflictError(err: unknown): boolean {
  if (err == null) return false;
  const { code, message } = errorInfo(err);
  if (code) {
    if (code === "40001" || code === "40P01" || code === "P2034") return true;
    if (/^OC\d{3}$/i.test(code)) return true; // DSQL surfaces OCC conflicts as an OC### code
  }
  const m = message.toLowerCase();
  return (
    m.includes("could not serialize") ||
    m.includes("serialization failure") ||
    m.includes("deadlock detected") ||
    m.includes("write conflict") ||
    m.includes("conflicts with another transaction") ||
    /\boc00\d\b/.test(m) ||
    (m.includes("please retry") && m.includes("transaction"))
  );
}

// ── Serialization-conflict retry (DSQL optimistic concurrency) ─────────────────────────────

/** Tunables for {@link withRetry}. All optional; `sleep`/`random` exist so tests stay deterministic. */
export interface RetryOptions {
  /** Total attempts including the first. Default 5 (the initial try + up to 4 retries). */
  maxAttempts?: number;
  /** Base backoff in ms; attempt n is capped at baseDelayMs · 2^(n-1). Default 50. */
  baseDelayMs?: number;
  /** Upper bound on any single backoff (ms). Default 2000. */
  maxDelayMs?: number;
  /** Which errors are retryable. Default {@link isSerializationConflictError}. */
  isRetryable?: (err: unknown) => boolean;
  /** Sleep implementation — injected so tests don't actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Jitter source in [0, 1) — injected for deterministic tests. */
  random?: () => number;
  /** Optional label included in the retry log line, to identify the operation. */
  label?: string;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying on a DSQL serialization/OCC conflict with exponential backoff + FULL JITTER.
 * On the production target (Aurora DSQL) any concurrency produces commit-time serialization
 * conflicts that must be retried (see {@link isSerializationConflictError}); local Postgres rarely
 * exhibits this, so the protection is invisible in dev and essential in prod. Backoff uses AWS's
 * recommended full-jitter schedule — delay ∈ [0, min(maxDelayMs, baseDelayMs·2^n)) — so a herd of
 * conflicting retriers spreads out instead of re-colliding in lockstep. Non-retryable errors, and
 * the final attempt's error, propagate unchanged.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 5);
  const baseDelayMs = opts.baseDelayMs ?? 50;
  const maxDelayMs = opts.maxDelayMs ?? 2_000;
  const isRetryable = opts.isRetryable ?? isSerializationConflictError;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= maxAttempts || !isRetryable(err)) throw err;
      const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delay = Math.floor(random() * ceiling); // full jitter: uniform in [0, ceiling)
      console.warn(
        `[db] serialization conflict${opts.label ? ` (${opts.label})` : ""}; ` +
          `retry ${attempt}/${maxAttempts - 1} in ${delay}ms: ${errorInfo(err).message}`,
      );
      await sleep(delay);
    }
  }
}

// ── IAM token minting (lazy @aws-sdk/dsql-signer) ──────────────────────────────────────────

type DsqlSignerModule = {
  DsqlSigner: new (config: { hostname: string; region: string; expiresIn?: number }) => {
    getDbConnectAdminAuthToken(): Promise<string>;
    getDbConnectAuthToken(): Promise<string>;
  };
};

async function mintDsqlToken(cfg: DsqlConfig): Promise<string> {
  let mod: DsqlSignerModule;
  try {
    // Indirect specifier so the static/local build doesn't try to resolve the (optional) SDK.
    const specifier = "@aws-sdk/dsql-signer";
    mod = (await import(specifier)) as DsqlSignerModule;
  } catch {
    throw new Error(
      "DSQL_ENDPOINT is set but @aws-sdk/dsql-signer is not installed. " +
        "Run `npm i @aws-sdk/dsql-signer` to enable IAM-token auth for Aurora DSQL.",
    );
  }
  const signer = new mod.DsqlSigner({
    hostname: cfg.endpoint,
    region: cfg.region,
    expiresIn: cfg.ttlSeconds,
  });
  return cfg.user === "admin"
    ? signer.getDbConnectAdminAuthToken()
    : signer.getDbConnectAuthToken();
}

// ── Token-aware singleton ──────────────────────────────────────────────────────────────────

type PrismaState = {
  client: PrismaClient;
  expiresAt: number; // epoch ms; Infinity in static mode
};

const g = globalThis as unknown as {
  __ascentPrisma?: PrismaState;
  __ascentPrismaRefresh?: Promise<PrismaClient>;
};

function newClient(url?: string): PrismaClient {
  return new PrismaClient({
    ...(url ? { datasourceUrl: url } : {}),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

/** Mint a fresh token, build a client with it, and atomically swap it in (disconnecting the old). */
async function doRefresh(cfg: DsqlConfig): Promise<PrismaClient> {
  const token = await mintDsqlToken(cfg);
  const next = newClient(buildDsqlUrl(cfg, token));
  const previous = g.__ascentPrisma?.client;
  g.__ascentPrisma = { client: next, expiresAt: Date.now() + cfg.ttlSeconds * 1000 };
  if (previous && previous !== next) {
    void previous.$disconnect().catch(() => {});
  }
  return next;
}

/** Single-flight token refresh: concurrent callers share one in-flight mint. */
function refresh(cfg: DsqlConfig): Promise<PrismaClient> {
  if (g.__ascentPrismaRefresh) return g.__ascentPrismaRefresh;
  const inflight = doRefresh(cfg);
  // Track a non-rejecting copy so a failed mint can't leave a permanently rejected promise around.
  g.__ascentPrismaRefresh = inflight;
  void inflight.catch(() => {}).finally(() => {
    g.__ascentPrismaRefresh = undefined;
  });
  return inflight;
}

function tokenIsStale(state: PrismaState | undefined, cfg: DsqlConfig): boolean {
  return !state || Date.now() >= state.expiresAt - cfg.refreshMarginSeconds * 1000;
}

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL || process.env.DSQL_ENDPOINT);
}

/**
 * The lazy Prisma singleton. Synchronous and backward-compatible: in static mode it returns the
 * one client built from DATABASE_URL. In DSQL mode it returns the cached client and, when the IAM
 * token is within its refresh margin, kicks a background refresh so the next call gets a client
 * built from a fresh token — long before the current token expires. For guaranteed freshness on a
 * single critical query, prefer withDb().
 */
export function getPrisma(): PrismaClient {
  const cfg = readDsqlConfig();
  if (!cfg && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — persistence is disabled.");
  }

  if (g.__ascentPrisma) {
    if (cfg && tokenIsStale(g.__ascentPrisma, cfg)) {
      void refresh(cfg).catch((err) =>
        console.error("[db] DSQL IAM token refresh failed:", errorInfo(err).message),
      );
    }
    return g.__ascentPrisma.client;
  }

  // Cold start. In DSQL mode we seed from DATABASE_URL if present (the deploy-time token) so the
  // synchronous accessor always has a client, then immediately refresh in the background to mint
  // our own short-lived token.
  const client = newClient(process.env.DATABASE_URL);
  // Mark the seed STALE-NOW (expiresAt 0), not a full fresh TTL. The deploy-time token may already be
  // aged or expired (a frozen instance thawing past the TTL), so crediting it a full TTL blinds
  // tokenIsStale and skips proactive refresh — and if the very next refresh then FAILS, that optimistic
  // far-future expiresAt would pin the stale client and suppress ALL further refreshes (findings #2+#3).
  // At 0, every getPrisma keeps kicking the single-flighted refresh until our own token actually lands.
  g.__ascentPrisma = { client, expiresAt: cfg ? 0 : Infinity };
  if (cfg) {
    void refresh(cfg).catch((err) =>
      console.error("[db] DSQL IAM token refresh failed:", errorInfo(err).message),
    );
  }
  return client;
}

/**
 * Force a reconnect with a freshly minted token (DSQL) or a rebuilt client (static). Awaits any
 * in-flight refresh so concurrent auth-expiry recoveries collapse into one mint. Propagates mint
 * errors (unlike the background refresh, which only logs).
 */
export async function reconnectDb(): Promise<PrismaClient> {
  const cfg = readDsqlConfig();
  if (!cfg) {
    const previous = g.__ascentPrisma?.client;
    const client = newClient(process.env.DATABASE_URL);
    g.__ascentPrisma = { client, expiresAt: Infinity };
    if (previous && previous !== client) void previous.$disconnect().catch(() => {});
    return client;
  }
  return refresh(cfg);
}

/**
 * The retry core: run an op against a client, and on an auth-expiry error reconnect (fresh token)
 * and retry exactly once. Dependency-injected so the retry/reconnect logic is unit-testable
 * without a real database. withDb() and dbHealthCheck() wire the real deps.
 */
export async function runWithReconnect<T>(
  op: (client: PrismaClient) => Promise<T>,
  deps: {
    getClient: () => PrismaClient | Promise<PrismaClient>;
    reconnect: () => Promise<PrismaClient>;
    isAuthExpiry?: (err: unknown) => boolean;
  },
): Promise<T> {
  const isAuth = deps.isAuthExpiry ?? isAuthExpiryError;
  try {
    return await op(await deps.getClient());
  } catch (err) {
    if (!isAuth(err)) throw err;
    return op(await deps.reconnect());
  }
}

/**
 * Run a database operation with token-expiry protection. In DSQL mode it proactively refreshes a
 * stale token before the op, and on an auth-expiry error it reconnects with a fresh token and
 * retries once. The recommended entry point for production DSQL queries.
 */
export function withDb<T>(op: (client: PrismaClient) => Promise<T>): Promise<T> {
  const cfg = readDsqlConfig();
  return runWithReconnect(op, {
    getClient: async () => {
      if (cfg && tokenIsStale(g.__ascentPrisma, cfg)) await refresh(cfg);
      return getPrisma();
    },
    reconnect: reconnectDb,
  });
}

/**
 * Liveness check that also self-heals: pings the database (SELECT 1) and, if the ping fails with
 * an auth-expiry error, reconnects with a fresh IAM token and pings again. Suitable for a
 * monitoring/keep-warm endpoint that should recover an expired-token client without a redeploy.
 */
export async function dbHealthCheck(): Promise<{
  ok: boolean;
  reconnected: boolean;
  error?: string;
}> {
  if (!isDbConfigured()) return { ok: false, reconnected: false, error: "persistence disabled" };
  const ping = (client: PrismaClient) => client.$queryRaw`SELECT 1`;
  try {
    await ping(getPrisma());
    return { ok: true, reconnected: false };
  } catch (err) {
    if (!isAuthExpiryError(err)) {
      return { ok: false, reconnected: false, error: errorInfo(err).message };
    }
    try {
      await ping(await reconnectDb());
      return { ok: true, reconnected: true };
    } catch (retryErr) {
      return { ok: false, reconnected: true, error: errorInfo(retryErr).message };
    }
  }
}
