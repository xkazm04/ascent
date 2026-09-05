// GET /api/org/repositories?org=<slug>[&format=csv][&posture=<id>][&stack=<key>]
// The org's repo leaderboard as data: JSON by default, or a CSV file download (format=csv) — the
// "send my boss the fleet" export. Read-only; scoped to a readable org. Understands the SAME
// posture/stack query params as the Repositories tab, so the export reflects exactly what the
// filtered tab shows (repositories-segments #3: it previously always exported the full fleet while
// the header said "12 of 80 repos in At risk"). A bogus posture/stack falls back to the whole fleet,
// matching the page's contract. The CSV also carries each repo's segment memberships.

import { NextResponse } from "next/server";
import { getOrgRollup, getRepoSegmentMap, isDbConfigured } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";
import { resolveStackScope } from "@/lib/org/scope";
import { POSTURE_META } from "@/lib/maturity/model";
import { csvTable } from "@/lib/export/csv";
import { safeFilenameSlug } from "@/lib/export/filename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "The fleet view requires a database." }, { status: 503 });
  const { searchParams } = new URL(request.url);
  const org = searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;

  // Same scoping the page applies: an optional tech-stack group (scopes the rollup itself) and an
  // optional posture filter over each repo's latest scan. Unknown values → unscoped, like the page.
  const { techGroupId } = await resolveStackScope(org, { stack: searchParams.get("stack") ?? undefined });
  const postureParam = searchParams.get("posture");
  const posture = postureParam && POSTURE_META.some((p) => p.id === postureParam) ? postureParam : null;

  const rollup = await getOrgRollup(org, undefined, null, techGroupId);
  const all = rollup?.repos ?? [];
  const repos = posture ? all.filter((r) => r.latest?.posture === posture) : all;

  if (searchParams.get("format") === "csv") {
    // Segment membership per repo (`;`-joined names) — segments are the Repositories page's
    // organizing concept, yet the export previously omitted them entirely.
    const segMap = await getRepoSegmentMap(org);
    const header = ["fullName", "name", "private", "watched", "language", "roles", "backendLanguage", "frameworks", "schedule", "lastScan", "level", "overall", "adoption", "rigor", "posture", "segments"];
    const rows = repos.map((r) => [
      r.fullName,
      r.name,
      r.isPrivate,
      r.watched,
      r.primaryLanguage ?? "",
      // Tech stack (Feature 3a): multi-valued fields are `;`-joined so they stay one CSV cell.
      (r.techStack?.roles ?? []).join(";"),
      r.techStack?.backendLanguage ?? "",
      (r.techStack?.frameworks ?? []).join(";"),
      r.scanSchedule,
      r.latest?.scannedAt?.slice(0, 10) ?? "",
      r.latest?.level ?? "",
      r.latest?.overall ?? "",
      r.latest?.adoption ?? "",
      r.latest?.rigor ?? "",
      r.latest?.posture ?? "",
      (segMap[r.fullName] ?? []).map((s) => s.name).join(";"),
    ]);
    const csv = csvTable(header, rows);
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="ascent-repositories-${safeFilenameSlug(org, "org")}.csv"`,
      },
    });
  }

  return NextResponse.json({ org, repos });
}
