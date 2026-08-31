// GET /api/org/controls?org=<slug>[&repo=&controlId=&from=&to=&transitionsOnly=1&limit=&format=csv]
//
// The control-observation timeline (moonshot #1): what each control was, when it changed, and — for
// a webhook-observed change — who changed it. Org-scoped and read-gated exactly like the dashboard
// it feeds; there is nothing public here and no cross-org aggregation, so no population floor
// applies.
//
// The response ALWAYS carries `coverage` beside `timeline`, and that pairing is deliberate: a
// timeline read on its own invites "branch protection held all quarter" from two observations three
// months apart. The coverage rows state the observation count and the largest gap per (repo,
// control), so the claim can only be made with its own N in view.
//
// MC-B14 — `?format=csv` returns THE ROWS THE SEAL IS COMPUTED OVER, columns in `DIGEST_FIELD_ORDER`
// exactly. Before this the parameter was accepted and silently ignored (200 application/json), which
// is how an examiner ended up holding a published recomputation recipe and no rows to run it over.
// The column order is not a formatting choice: it is the digest's field order, so an examiner
// rebuilds each row's canonical JSON straight off the header line without reading our source.

import { NextResponse } from "next/server";
import { controlCoverage, listControlTimeline, TIMELINE_CAP } from "@/lib/db/control-observations";
import { timelineDisclosure } from "@/lib/controls/window";
import { DIGEST_FIELD_ORDER } from "@/lib/controls/seal";
import { csvTable } from "@/lib/export/csv";
import { isDbConfigured } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 200;

export async function GET(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "The control ledger requires a database." }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const org = searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing 'org' query parameter." }, { status: 400 });

  const denied = await requireOrgRead(org);
  if (denied) return denied;

  const q = {
    repoFullName: searchParams.get("repo"),
    controlId: searchParams.get("controlId"),
    from: searchParams.get("from"),
    to: searchParams.get("to"),
    transitionsOnly: searchParams.get("transitionsOnly") === "1",
  };
  const requested = Number(searchParams.get("limit")) || DEFAULT_LIMIT;
  const format = (searchParams.get("format") ?? "json").toLowerCase();
  if (format !== "json" && format !== "csv") {
    return NextResponse.json({ error: "format must be json | csv." }, { status: 400 });
  }

  try {
    const [timeline, coverage] = await Promise.all([
      listControlTimeline(org, { ...q, limit: requested }),
      // Coverage is computed over the SAME window but is never narrowed by `transitionsOnly`: the
      // heartbeats a transition filter hides are precisely the rows that prove a control held, so a
      // coverage figure computed from transitions alone would report a well-observed control as
      // barely observed.
      controlCoverage(org, { repoFullName: q.repoFullName, controlId: q.controlId, from: q.from, to: q.to }),
    ]);
    const rows = timeline ?? [];
    // TRUNCATION HONESTY, the same discipline the audit CSV export follows: a page that silently
    // stopped at the cap would read as "this is everything that happened". Computed in
    // `@/lib/controls/window` so the Governance card renders the SAME verdict it does — the card
    // used to render none at all.
    const disclosure = timelineDisclosure(rows.length, requested, TIMELINE_CAP);

    if (format === "csv") {
      // Columns are `DIGEST_FIELD_ORDER`, verbatim and in order. `occurredAt` is already an ISO
      // string on the wire type, which is the exact form the digest serializes.
      const body = csvTable(
        DIGEST_FIELD_ORDER as readonly string[],
        rows.map((r) => DIGEST_FIELD_ORDER.map((k) => r[k] ?? "")),
      );
      return new NextResponse(body, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="ascent-control-ledger-${org.replace(/[^a-z0-9-]/gi, "-")}.csv"`,
          // Org-scoped evidence: never a shared cache.
          "cache-control": "private, no-store",
          // The disclosure travels with the FILE, not only with the JSON — an export read in a
          // spreadsheet has no response body to consult.
          "x-ascent-truncated": String(disclosure.truncated),
          "x-ascent-limit": String(disclosure.limit),
        },
      });
    }

    return NextResponse.json({
      timeline: rows,
      coverage: coverage ?? [],
      truncated: disclosure.truncated,
      limit: disclosure.limit,
    });
  } catch (err) {
    console.error("[org/controls] query failed", err);
    return NextResponse.json({ error: "Failed to load the control timeline." }, { status: 500 });
  }
}
