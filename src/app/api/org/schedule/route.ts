// POST /api/org/schedule  (off | daily | weekly | monthly) — set autoscan cadence (drives /api/cron/rescan):
//   { org, fullName, schedule }        → one repo.
//   { org, schedule, segmentId? }      → the whole watched set (optionally a segment) in one write.

import { NextResponse } from "next/server";
import { isDbConfigured, setRepoSchedule, setWatchedSchedule } from "@/lib/db";
import { isAppConfigured } from "@/lib/github/app";
import { requireOrgAccess } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID = new Set(["off", "daily", "weekly", "monthly"]);

export async function POST(request: Request) {
  if (!isAppConfigured() || !isDbConfigured()) {
    return NextResponse.json(
      { error: "Autoscan scheduling requires the GitHub App + a database." },
      { status: 503 },
    );
  }
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    fullName?: string;
    schedule?: string;
    segmentId?: string;
  };
  if (!body.org || !body.schedule || !VALID.has(body.schedule)) {
    return NextResponse.json(
      { error: `Missing org or invalid schedule (off|daily|weekly|monthly).` },
      { status: 400 },
    );
  }
  // Authorize: only an org member (or any caller on "public" / an auth-off deploy) may change
  // autoscan cadence — otherwise anyone could schedule token-spending scans for any org.
  const denied = await requireOrgAccess(body.org);
  if (denied) return denied;
  try {
    if (body.fullName) {
      await setRepoSchedule(body.org, body.fullName, body.schedule);
      return NextResponse.json({ ok: true, fullName: body.fullName, schedule: body.schedule });
    }
    // No fullName → fleet-level cadence over the whole watched set (optionally a segment).
    const updated = await setWatchedSchedule(body.org, body.schedule, body.segmentId ?? null);
    return NextResponse.json({ ok: true, schedule: body.schedule, updated });
  } catch (err) {
    console.error("[org/schedule] failed", err);
    return NextResponse.json({ error: "Failed to update schedule." }, { status: 500 });
  }
}
