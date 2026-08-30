// GET /api/org/controls?org=<slug>[&repo=&controlId=&from=&to=&transitionsOnly=1&limit=]
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

import { NextResponse } from "next/server";
import { controlCoverage, listControlTimeline, TIMELINE_CAP } from "@/lib/db/control-observations";
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
    return NextResponse.json({
      timeline: rows,
      coverage: coverage ?? [],
      // TRUNCATION HONESTY, the same discipline the audit CSV export follows: a page that silently
      // stopped at the cap would read as "this is everything that happened".
      truncated: rows.length >= Math.min(TIMELINE_CAP, requested),
      limit: Math.min(TIMELINE_CAP, requested),
    });
  } catch (err) {
    console.error("[org/controls] query failed", err);
    return NextResponse.json({ error: "Failed to load the control timeline." }, { status: 500 });
  }
}
