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
//     elapses, and withDb()/dbReadSafe()/dbHealthCheck() reactively reconnect on an auth-expiry
//     error — so both the write path (withDb) and the read surface (dbReadSafe) self-heal.
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
 * Apply the OPTIONAL, env-gated serverless connection budget to a Postgres connection URL.
 *
 * BUG (database-client-schema #2): each serverless instance builds a PrismaClient with Prisma's
 * default internal pool (num_physical_cpus*2+1). Under fan-out (a fleet scan's mapPool, a cron
 * rescan batch, many concurrent viewers) N instances × that default can exceed DSQL's per-cluster
 * connection ceiling and start refusing connections. A correct cap depends on the pooler +
 * max_connections + SCAN_CONCURRENCY (a deployment decision), so this is a SAFE, env-gated knob that
 * is a NO-OP unless DB_CONNECTION_LIMIT is set — default behavior is byte-for-byte unchanged, and the
 * cron is never accidentally serialized by a hardcoded limit. Set DB_CONNECTION_LIMIT (and optionally
 * DB_POOL_TIMEOUT seconds) per the cluster ceiling / expected concurrency. Existing params are not
 * overwritten (a URL that already carries connection_limit wins).
 */
function applyConnectionBudget(url: URL): URL {
  const limit = process.env.DB_CONNECTION_LIMIT?.trim();
  if (limit && /^\d+$/.test(limit) && Number(limit) > 0 && !url.searchParams.has("connection_limit")) {
    url.searchParams.set("connection_limit", limit);
    const poolTimeout = process.env.DB_POOL_TIMEOUT?.trim();
    if (poolTimeout && /^\d+$/.test(poolTimeout) && !url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", poolTimeout);
    }
  }
  return url;
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
  return applyConnectionBudget(url).toString();
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

/**
 * Does this error mean the database is configured but UNREACHABLE — the server is down, the
 * host/port is wrong, or the network is broken — as opposed to a query error against a live DB?
 * This is the gap isDbConfigured() can't see: DATABASE_URL is set (so the read functions never
 * short-circuit to their no-DB fallback), yet the first getPrisma().<model>.<op>() throws a
 * PrismaClientInitializationError at connect time ("Can't reach database server at localhost:5432").
 * Left unhandled that crashes every DB-reading page/route the moment the local Postgres (or a prod
 * DB during an outage) isn't up. Matches that error class by name, the Prisma connection SQLSTATEs
 * (P1001 can't-reach, P1002 reach-timeout, P1008 op-timeout, P1011 TLS, P1017 server-closed), and the
 * connection-refused messages. Pure + exported for unit testing. Distinct from isAuthExpiryError (a
 * live server rejecting credentials) and isSerializationConflictError (a live server's OCC abort).
 */
export function isDbUnavailableError(err: unknown): boolean {
  if (err == null) return false;
  const name =
    typeof err === "object" && "name" in err ? (err as { name?: unknown }).name : undefined;
  if (name === "PrismaClientInitializationError") return true;
  const { code, message } = errorInfo(err);
  if (code && (code === "P1001" || code === "P1002" || code === "P1008" || code === "P1011" || code === "P1017")) {
    return true;
  }
  const m = message.toLowerCase();
  return (
    m.includes("can't reach database server") ||
    m.includes("cannot reach database server") ||
    m.includes("connection refused") ||
    m.includes("econnrefused") ||
    m.includes("the database server was reached but timed out")
  );
}

/**
 * Run a best-effort READ and degrade to `fallback` when the database is configured but UNREACHABLE
 * (see {@link isDbUnavailableError}) — the same graceful no-data path the read functions already take
 * when persistence is unconfigured (isDbConfigured() === false). Lets a DB-less *and* a DB-down
 * deployment render the keyless MVP instead of 500-ing. A query error against a LIVE database (bad
 * SQL, a constraint violation, a genuine bug) is NOT swallowed — it re-throws unchanged.
 *
 * Auth-expiry recovery (database-client-schema #1): the reactive reconnect used to be reachable only
 * through {@link withDb} (one production caller), while the entire read surface flows through this
 * wrapper on a raw getPrisma() client. On a DSQL short-lived-IAM-token lapse (cold thaw, or a
 * token-mint stall that outlasts the proactive refresh margin) that read would throw an auth-expiry
 * error and 500 instead of self-healing. So before degrading, an auth-expiry is recovered exactly
 * like {@link runWithReconnect}: reconnect with a fresh token and retry the read ONCE. The retry's
 * `fn` re-invokes getPrisma() internally, so it transparently picks up the reconnected client.
 */
export async function dbReadSafe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isAuthExpiryError(err)) {
      try {
        await reconnectDb();
        return await fn();
      } catch (retryErr) {
        // Reconnect or the retried read still failed: degrade only when the DB is genuinely
        // unreachable; a live-DB query error after a successful reconnect re-throws unchanged.
        if (isDbUnavailableError(retryErr)) {
          console.warn("[db] read degraded — database unreachable:", errorInfo(retryErr).message);
          return fallback;
        }
        throw retryErr;
      }
    }
    if (isDbUnavailableError(err)) {
      console.warn("[db] read degraded — database unreachable:", errorInfo(err).message);
      return fallback;
    }
    throw err;
  }
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
    // Indirect specifier + bundler-ignore comments so the static/local build never tries to RESOLVE
    // this optional SDK (it's only installed in the DSQL deployment, loaded lazily at runtime there).
    // Without the ignore hints, Turbopack/webpack statically analyze the dynamic import and emit a
    // "Module not found: @aws-sdk/dsql-signer" warning on every DB-importing route in a non-DSQL env.
    const specifier = "@aws-sdk/dsql-signer";
    mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ specifier)) as DsqlSignerModule;
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
  // Local-dev embedded PGlite driver adapter, constructed in src/instrumentation.ts when
  // PGLITE_DATA_DIR is set. Typed loosely here so this module never statically imports the
  // (dev-only, externalized) pglite packages.
  __ascentPgliteAdapter?: unknown;
};

/**
 * Apply the env-gated connection budget (database-client-schema #2) to a static DATABASE_URL string.
 * No-op unless DB_CONNECTION_LIMIT is set, and silently passes a non-URL through unchanged (Prisma
 * accepts forms WHATWG URL can't parse — don't let the budget knob break an otherwise-valid URL).
 */
function withConnectionBudget(url: string): string {
  if (!process.env.DB_CONNECTION_LIMIT?.trim()) return url; // common path: byte-for-byte unchanged
  try {
    return applyConnectionBudget(new URL(url)).toString();
  } catch {
    return url; // unparseable by WHATWG URL — leave it to Prisma untouched
  }
}

function newClient(url?: string): PrismaClient {
  const log = process.env.NODE_ENV === "development" ? (["warn", "error"] as const) : (["error"] as const);
  // Local dev: an embedded in-process PGlite (src/instrumentation.ts) provides the connection via a
  // Prisma driver adapter — the datasource URL is ignored. No socket, nothing to drop during a long scan.
  if (g.__ascentPgliteAdapter) {
    return new PrismaClient({ adapter: g.__ascentPgliteAdapter as never, log: [...log] });
  }
  return new PrismaClient({
    ...(url ? { datasourceUrl: withConnectionBudget(url) } : {}),
    log: [...log],
  });
}

/** Grace period before retiring a swapped-out client. Covers the longest plausible in-flight request
 *  (the cron's maxDuration is 300s) so a query holding the old reference can drain before disconnect. */
const RETIRE_CLIENT_GRACE_MS = 300_000;

/**
 * Lazily retire a swapped-out Prisma client (database-client-schema #2). getPrisma() returns the cached
 * client SYNCHRONOUSLY and hands the OLD reference to concurrent callers microseconds before a refresh
 * swaps it; Prisma's $disconnect() tears down the query engine/pool without a documented guarantee of
 * draining in-flight work — so disconnecting the outgoing client immediately can abort queries that are
 * mid-`await` on a token that was still VALID (the rotation recurs every ~TTL−margin under load). Defer
 * the disconnect past the longest plausible request instead. The timer is unref()'d so it never keeps
 * the process/event loop alive (clean serverless freeze).
 */
function retireClient(previous: PrismaClient): void {
  const timer = setTimeout(() => {
    void previous.$disconnect().catch(() => {});
  }, RETIRE_CLIENT_GRACE_MS);
  (timer as unknown as { unref?: () => void }).unref?.();
}

/** Mint a fresh token, build a client with it, and atomically swap it in (retiring the old lazily). */
async function doRefresh(cfg: DsqlConfig): Promise<PrismaClient> {
  const token = await mintDsqlToken(cfg);
  const next = newClient(buildDsqlUrl(cfg, token));
  const previous = g.__ascentPrisma?.client;
  g.__ascentPrisma = { client: next, expiresAt: Date.now() + cfg.ttlSeconds * 1000 };
  if (previous && previous !== next) {
    // Both the proactive background refresh (getPrisma/withDb) and the reactive reconnect funnel here.
    // The proactive path swaps a STILL-VALID client out from under in-flight callers, so retire it
    // lazily rather than disconnecting eagerly; harmless for the reactive path too (the old client is
    // already broken — it simply disconnects a little later).
    retireClient(previous);
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

  // Cold start. In DSQL mode a deploy-time DATABASE_URL seed token is REQUIRED: getPrisma() is
  // synchronous and can't mint an IAM token, so without a seed the cold client would be built with no
  // datasource URL and 500 every first query (with a cryptic "Environment variable not found:
  // DATABASE_URL") until the async mint lands. Direct getPrisma() callers hit this; withDb()
  // awaits a mint first and is safe. Fail fast here with an actionable message rather than serving a
  // dead client. (withDb's getClient seeds g.__ascentPrisma via a mint before reaching this path, so a
  // warm/refreshed instance never trips this — it's strictly the no-seed misconfiguration guard.)
  if (cfg && !process.env.DATABASE_URL) {
    throw new Error(
      "DSQL is configured (DSQL_ENDPOINT) but DATABASE_URL is unset. Set DATABASE_URL to a deploy-time " +
        "DSQL connection string so the synchronous client has a datasource URL on cold start; the module " +
        "then refreshes its own short-lived IAM token. (DATABASE_URL is required even in DSQL mode.)",
    );
  }

  // We seed from DATABASE_URL (the deploy-time token) so the synchronous accessor always has a client,
  // then immediately refresh in the background to mint our own short-lived token.
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
      if (cfg && tokenIsStale(g.__ascentPrisma, cfg)) {
        try {
          await refresh(cfg);
        } catch (err) {
          // A failed PROACTIVE mint is only fatal when there is no client to fall back on. Inside
          // the refresh margin the cached client's token is still VALID by definition, so a
          // transient STS/IAM blip (throttle, momentary credentials hiccup) must not fail the op —
          // that made the protected write path strictly MORE fragile than the raw getPrisma()
          // read path, which shrugs off the same background-refresh failure. Fall through to the
          // cached client: either the op succeeds on the still-valid token, or it throws a real
          // auth-expiry that runWithReconnect recovers via reconnectDb — where a second mint
          // failure is rightly fatal (the REACTIVE path is the authority on a genuinely dead token).
          if (!g.__ascentPrisma) throw err;
          console.warn(
            "[db] proactive DSQL token refresh failed; continuing on the cached client:",
            errorInfo(err).message,
          );
        }
      }
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
  } catch {
    // Self-heal on ANY first failure, not only auth-expiry. In DSQL-only mode a cold-start client can
    // be built before the IAM token mints, so its first query throws a Prisma INITIALIZATION error
    // (not an auth-expiry one) — the old auth-only branch never recovered it, and the keep-warm/monitor
    // endpoint flatlined as unhealthy until the process recycled. One reconnect (fresh token / rebuilt
    // client) + re-ping recovers the common transient + cold-start cases; a still-failing ping is a real
    // outage reported as ok:false.
    try {
      await ping(await reconnectDb());
      return { ok: true, reconnected: true };
    } catch (retryErr) {
      return { ok: false, reconnected: true, error: errorInfo(retryErr).message };
    }
  }
}
