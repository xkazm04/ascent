// GET /api/org/backlog?org=slug[&segment=segmentId][&techGroup=techGroupId][&includeClosed=1][&format=csv]
//   -> { backlog: OrgBacklog | null }   (or a CSV download when format=csv)
// The org-wide recommendation backlog (owners + due dates), grouped by owner and by due-date
// bucket. Read-only; lets the client panel refresh after a status/assignee/due-date change.
// `segment`/`techGroup` mirror the page's ?segment=/?stack= scope (backlog-management 07-16 #2) so a
// panel refresh stays on the same filtered view instead of snapping back to the whole org.

import { NextResponse } from "next/server";
import { getOrgBacklog, isDbConfigured, type OrgBacklog } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";
import { csvTable } from "@/lib/export/csv";
import { safeFilenameSlug } from "@/lib/export/filename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One row per backlog item, flattened out of the owner/due groupings (`byOwner` is the authoritative
 *  flat set — `byDue` re-buckets the same rows, so exporting both would double every item). */
const CSV_HEADER = [
  "repo",
  "title",
  "dimId",
  "dimension",
  "impact",
  "effort",
  "status",
  "owner",
  "dueDate",
  "dueBucket",
  "overdue",
  "projectedPoints",
  "unlocks",
  "lastActivityAt",
  "recommendationId",
] as const;

function backlogCsvRows(backlog: OrgBacklog): unknown[][] {
  return backlog.byOwner.flatMap((g) =>
    g.items.map((i) => [
      i.repo,
      i.title,
      i.dimId,
      i.dimLabel,
      i.impact,
      i.effort,
      i.status,
      // The group's login and the item's assignee are the same value; read it off the ITEM so a row is
      // self-describing once it leaves the grouping.
      i.assigneeLogin ?? "",
      // Already a `YYYY-MM-DD` date literal from the date-only column — never re-derived here, per the
      // canonical time-zone policy (src/lib/org/timezone.ts): truncating a date-only value in a
      // non-UTC zone yields the previous day.
      i.targetDate ?? "",
      i.dueBucket,
      i.overdue,
      i.projectedPoints ?? "",
      i.unlocks ?? "",
      i.lastActivityAt,
      i.id,
    ]),
  );
}

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "The backlog requires a database." }, { status: 503 });
  const { searchParams } = new URL(request.url);
  const org = searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  const segment = searchParams.get("segment");
  const techGroup = searchParams.get("techGroup");
  // `includeClosed=1` is the recovery view (G6-02): done/dismissed rows are grouped too, so an item
  // dismissed by a mis-click can be found and set back to Open. Read-only; the headline counts are
  // unchanged by it. It also widens the CSV export the same way — the download mirrors the read scope.
  const includeClosed = searchParams.get("includeClosed") === "1";
  const backlog = await getOrgBacklog(org, segment, new Date(), techGroup, { includeClosed });

  if (searchParams.get("format") === "csv") {
    // A null backlog means the org/lookup is unavailable — distinct from an org with an empty backlog.
    // Returning a header-only 200 for the former is success theater (the org/export contract).
    if (!backlog) return NextResponse.json({ error: "No backlog for this org yet." }, { status: 404 });
    // Encode the scope in the filename: a CSV carries no scope marker once it leaves the app, so a
    // segment/stack-scoped download must be distinguishable from a whole-fleet one.
    const scope =
      (segment ? `-${safeFilenameSlug(segment, "segment")}` : "") +
      (techGroup ? `-${safeFilenameSlug(techGroup, "stack")}` : "") +
      (includeClosed ? "-all" : "");
    return new NextResponse(csvTable(CSV_HEADER, backlogCsvRows(backlog)), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="ascent-backlog-${safeFilenameSlug(org, "org")}${scope}.csv"`,
        "cache-control": "private, no-store",
      },
    });
  }

  return NextResponse.json({ backlog });
}
