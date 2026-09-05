// Reports which persistence backend is actually live, so the UI can show an honest
// "served live from <backend>" indicator — Aurora DSQL in production, embedded PGlite or a
// local Postgres in dev. The mode mirrors the precedence src/lib/db/client.ts uses when it
// builds the Prisma client: the in-process PGlite adapter (local dev) overrides the datasource
// entirely and so wins; then Aurora DSQL (DSQL_ENDPOINT); then a static Postgres DATABASE_URL;
// else persistence is disabled.

export type DbMode = "dsql" | "postgres" | "pglite" | "disabled";

/**
 * The active database backend. Reads the same env/global signals as client.ts, in the same order:
 * DSQL_ENDPOINT is checked BEFORE DATABASE_URL because DSQL mode also sets a deploy-time DATABASE_URL
 * seed token (see client.ts), so a plain DATABASE_URL check would mis-report DSQL as "postgres". The
 * embedded PGlite adapter (set in src/instrumentation.ts) takes precedence over both because it
 * overrides the datasource URL. Server-only in practice (neither the env vars nor the PGlite global
 * exist client-side) — pair with {@link dbModeLabel} for a display string, resolved server-side and
 * passed to the client as data.
 */
export function getDbMode(): DbMode {
  const g = globalThis as unknown as { __ascentPgliteAdapter?: unknown };
  if (g.__ascentPgliteAdapter) return "pglite";
  if (process.env.DSQL_ENDPOINT?.trim()) return "dsql";
  if (process.env.DATABASE_URL?.trim()) return "postgres";
  return "disabled";
}

/** True when the live backend is an AWS-managed database (Aurora DSQL) — the hackathon-relevant case. */
export function dbModeIsAws(mode: DbMode = getDbMode()): boolean {
  return mode === "dsql";
}

/**
 * Human label for a backend — what the UI renders as "served live from …". Pure: it takes the mode
 * explicitly so a client component can call it with a server-resolved {@link DbMode} value (it must
 * not re-derive the mode client-side, where the env/global signals are absent).
 */
export function dbModeLabel(mode: DbMode): string {
  switch (mode) {
    case "dsql":
      return "Aurora DSQL";
    case "postgres":
      return "PostgreSQL";
    case "pglite":
      return "embedded PGlite";
    default:
      return "no database";
  }
}
