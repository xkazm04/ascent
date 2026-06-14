// GET /api/org/repositories?org=<slug>[&format=csv]
// The org's repo leaderboard as data: JSON by default, or a CSV file download (format=csv) — the
// "send my boss the fleet" export. Read-only; scoped to a readable org. Reuses getOrgRollup so the
// export reflects exactly what the Repositories tab shows.

import { NextResponse } from "next/server";
import { getOrgRollup, isDbConfigured } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Quote a CSV field iff it contains a comma, quote, or newline (RFC 4180); total — never throws. */
function csvField(v: unknown): string {
  let s: string;
  try {
    s = v == null ? "" : String(v);
  } catch {
    s = "";
  }
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Safe ASCII token for a Content-Disposition filename (no CRLF / quote injection from a slug). */
function safeFilenameSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "org";
}

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "The fleet view requires a database." }, { status: 503 });
  const { searchParams } = new URL(request.url);
  const org = searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;

  const rollup = await getOrgRollup(org);
  const repos = rollup?.repos ?? [];

  if (searchParams.get("format") === "csv") {
    const header = ["fullName", "name", "private", "watched", "language", "schedule", "lastScan", "level", "overall", "adoption", "rigor", "posture"];
    const rows = repos.map((r) =>
      [
        r.fullName,
        r.name,
        r.isPrivate,
        r.watched,
        r.primaryLanguage ?? "",
        r.scanSchedule,
        r.latest?.scannedAt?.slice(0, 10) ?? "",
        r.latest?.level ?? "",
        r.latest?.overall ?? "",
        r.latest?.adoption ?? "",
        r.latest?.rigor ?? "",
        r.latest?.posture ?? "",
      ].map(csvField).join(","),
    );
    const csv = [header.join(","), ...rows].join("\n") + "\n";
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="ascent-repositories-${safeFilenameSlug(org)}.csv"`,
      },
    });
  }

  return NextResponse.json({ org, repos });
}
