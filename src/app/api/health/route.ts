// GET /api/health — liveness + self-healing database check + autoscan readiness.
//
// Returns the persistence status and, in Aurora DSQL mode, recovers a client whose short-lived
// IAM token has expired: dbHealthCheck() pings the DB and, on an auth-expiry error, reconnects
// with a freshly minted token before pinging again. Point a monitor / keep-warm cron at this so
// an expired-token client self-heals without a redeploy. Always 200 when persistence is disabled
// (the MVP runs with no DB); 503 when the DB is configured but unreachable.
//
// Also reports per-job cron readiness (`crons`): every scheduled job in the one table
// (src/lib/cron-jobs.ts) as ready / degraded (an optional prerequisite missing, a partial run) /
// blocked (a required one missing), each with the instruction that fixes it - so one GET names every
// dead schedule instead of only the rescan. `autoscan` stays as the rescan projection (the
// docs/DEPLOY.md contract): the rescan fail-closes without CRON_SECRET and needs the GitHub App + a DB.

import { NextResponse } from "next/server";
import { dbHealthCheck, getDbMode, isDbConfigured, pgliteBootError } from "@/lib/db";
import { cronSecretMatches } from "@/lib/cron-auth";
import { cronReadiness, liveCronProbe } from "@/lib/cron-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cronDetail() {
  const probe = liveCronProbe();
  const crons = cronReadiness(probe);
  const { cronSecret, githubApp, db } = probe;
  return { autoscan: { ready: crons.rescan.state === "ready", cronSecret, githubApp, db }, crons };
}

// The detailed fields (dbMode, autoscan readiness) describe deployment TOPOLOGY — the specific backend
// in use and which operational secrets/config are present — which shouldn't be handed to an anonymous
// caller. Expose them only to an internal caller presenting the CRON_SECRET bearer (the same credential
// the monitor / Vercel cron already carries).
//
// When no CRON_SECRET is configured, details stay open ONLY outside production (local/dev/demo — there
// is nothing to protect, matching the prior always-on behavior). A PRODUCTION deploy missing the secret
// is exactly the misconfigured deploy this route's autoscan tripwire exists to flag — it must not also
// hand its topology and secret-presence map to anonymous probes, so prod-without-secret is treated as
// anonymous-only. The bearer comparison is cron-auth.ts's constant-time cronSecretMatches (the one
// compare every cron route uses) so the unauthenticated endpoint doesn't expose a variable-time compare.
function isInternalCaller(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return cronSecretMatches(request.headers.get("authorization") ?? "", `Bearer ${secret}`);
}

export async function GET(request: Request) {
  // Only an internal caller sees the topology fields; an anonymous probe gets the minimal liveness
  // shape (status + db [+ reconnected]) — still enough to monitor uptime and self-healing.
  // `pgliteBoot` is the local-dev diagnosis that used to be invisible: when the embedded PGlite fails
  // to boot, no driver adapter is installed and Prisma falls back to the dummy local DATABASE_URL, so
  // every symptom reads `P1001 Can't reach database server at 127.0.0.1:5432` — pointing at a server
  // that was never meant to exist. The boot already recorded WHY on globalThis and the module comment
  // promised "a health endpoint can read it"; nothing did until now. Topology-gated like the rest of
  // `detail`, and omitted entirely when the boot succeeded, so the common shape is unchanged.
  const bootError = pgliteBootError();
  const detail = isInternalCaller(request)
    ? {
        dbMode: getDbMode(),
        ...cronDetail(),
        ...(bootError ? { pgliteBoot: { ok: false, error: bootError } } : {}),
      }
    : {};
  if (!isDbConfigured()) {
    return NextResponse.json({ status: "ok", db: "disabled", ...detail });
  }
  try {
    const result = await dbHealthCheck();
    // Do NOT spread `result` into the public body — it carries the raw DB error string (Prisma/Postgres
    // internals, connection details) and /api/health is unauthenticated. Report only the safe liveness
    // shape; the underlying error is logged server-side for operators.
    if (!result.ok && result.error) {
      console.error("[health] database check failed", result.error);
    }
    return NextResponse.json(
      {
        status: result.ok ? "ok" : "error",
        db: result.ok ? "up" : "down",
        reconnected: result.reconnected,
        ...detail,
      },
      { status: result.ok ? 200 : 503 },
    );
  } catch (err) {
    // Defense in depth: dbHealthCheck() is contracted to resolve (never throw), but a future refactor
    // or an unexpected throw must NOT propagate to the framework's error serializer — that could leak
    // the raw error string on this unauthenticated endpoint. Log server-side; emit the generic
    // degraded shape only, identical to the resolved-failure body (no `err` in the response).
    console.error("[health] database check threw", err);
    return NextResponse.json(
      { status: "error", db: "down", reconnected: false, ...detail },
      { status: 503 },
    );
  }
}
