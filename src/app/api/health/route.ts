// GET /api/health — liveness + self-healing database check.
//
// Returns the persistence status and, in Aurora DSQL mode, recovers a client whose short-lived
// IAM token has expired: dbHealthCheck() pings the DB and, on an auth-expiry error, reconnects
// with a freshly minted token before pinging again. Point a monitor / keep-warm cron at this so
// an expired-token client self-heals without a redeploy. Always 200 when persistence is disabled
// (the MVP runs with no DB); 503 when the DB is configured but unreachable.

import { NextResponse } from "next/server";
import { dbHealthCheck, isDbConfigured } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isDbConfigured()) {
    return NextResponse.json({ status: "ok", db: "disabled" });
  }
  const result = await dbHealthCheck();
  return NextResponse.json(
    { status: result.ok ? "ok" : "error", db: result.ok ? "up" : "down", ...result },
    { status: result.ok ? 200 : 503 },
  );
}
