// GET /api/report/conformance/matrix?org=<slug>[&repos=a/b,c/d] -> { org, rows }
//
// #16 — the fleet control matrix: for every repository in one org, the per-check state of its latest
// doctor report, with `since` for each level and an honest `summaryOnly` stamp for a reporter that
// sent no findings. This is the read behind Standing › Passports › Controls, and the read a
// governance evidence pack's control appendix calls.
//
// AUTH: `org` is a SLUG the caller supplies, gated with `requireOrgRead` before any query runs — the
// gate-then-constrain shape. This is not an `[id]` route (no row id is accepted), so the
// resolve-then-gate case does not arise: there is no row whose owning org could differ from the one
// gated. The data is org-scoped throughout — nothing here reaches a public or cross-tenant surface,
// so no minimum-population rule applies and no corpus row is written.

import { NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/db";
import { loadControlMatrix } from "@/lib/db/org-conformance";
import { requireOrgRead } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "The control matrix requires a database." }, { status: 503 });
  }
  const { searchParams } = new URL(request.url);
  const org = (searchParams.get("org") ?? "").trim().toLowerCase();
  if (!org) return NextResponse.json({ error: "Provide ?org=<slug>." }, { status: 400 });

  const denied = await requireOrgRead(org);
  if (denied) return denied;

  // Optional narrowing to a segment's repos. Bounded so a caller cannot turn one request into an
  // arbitrarily large `IN (…)`; the unfiltered read is already org-scoped.
  const repos = (searchParams.get("repos") ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r))
    .slice(0, 200);

  try {
    const rows = await loadControlMatrix(org, repos.length ? { repos } : {});
    // null = no database / unknown org. Distinct from `[]`, which is a real answer: this org has
    // reported no conformance yet.
    if (rows === null) return NextResponse.json({ error: "The control matrix requires a database." }, { status: 503 });
    return NextResponse.json({ org, rows });
  } catch (err) {
    console.error("[conformance] control matrix query failed", err);
    return NextResponse.json({ error: "Failed to load the control matrix." }, { status: 500 });
  }
}
