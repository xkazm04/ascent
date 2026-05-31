// POST /api/org/schedule  { org, fullName, schedule }  (off | daily | weekly | monthly)
// Set a repo's autoscan period (drives /api/cron/rescan).

import { NextResponse } from "next/server";
import { isDbConfigured, setRepoSchedule } from "@/lib/db";
import { isAppConfigured } from "@/lib/github/app";

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
  };
  if (!body.org || !body.fullName || !body.schedule || !VALID.has(body.schedule)) {
    return NextResponse.json(
      { error: `Missing org/fullName or invalid schedule (off|daily|weekly|monthly).` },
      { status: 400 },
    );
  }
  try {
    await setRepoSchedule(body.org, body.fullName, body.schedule);
    return NextResponse.json({ ok: true, fullName: body.fullName, schedule: body.schedule });
  } catch (err) {
    console.error("[org/schedule] failed", err);
    return NextResponse.json({ error: "Failed to update schedule." }, { status: 500 });
  }
}
