// GET /api/recommendations?repo=owner/repo[&sort=measured]
// -> { scanId, items: PersistedRecommendation[], sort } for the repo's most recent scan.
// Requires DATABASE_URL (Phase 2); returns 503 when persistence is disabled.
//
// Each item carries `expectedLift: string | null` (moonshot #9) — the org's measured basis for closing
// this gap, or null. NULL, never "+0": no measured peers is an absence, not a zero, and a client that
// received 0 would render "we measured this and it does nothing".

import { NextResponse } from "next/server";
import { parseRepoUrl } from "@/lib/github/source";
import { getLatestRecommendations } from "@/lib/db";
import { PUBLIC_ORG } from "@/lib/auth";
import { canReadOrg } from "@/lib/authz";
import { dbGuard } from "@/lib/api/orgPlan";
import { getOrgExpectedLifts } from "@/lib/outcomes/expected-lift-load";
import { expectedLiftClause } from "@/lib/outcomes/expected-lift";
import { measuredPriorityScore, roadmapLiftKey } from "@/components/report/roadmapPriority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const repo = searchParams.get("repo");
  if (!repo) {
    return NextResponse.json({ error: "Missing 'repo' query parameter." }, { status: 400 });
  }
  const parsed = parseRepoUrl(repo);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid repository reference." }, { status: 400 });
  }
  const guard = dbGuard("Recommendation tracking", "Recommendation tracking requires a database (Phase 2 feature).");
  if (guard) return guard;

  try {
    // Scope to the org the caller may read, using the SAME Supabase-aware membership resolver the
    // sibling per-row routes use (requireOrgAccess/requireOrgRead → canReadOrg). The legacy
    // readableOrgForOwner consulted only the custom GitHub-OAuth session, which is dormant under the
    // Supabase login wall — so it always returned "public" and a private-org member silently lost the
    // whole recommendation tracker (the list came back empty → read-only roadmap). A private repo is
    // stored under owner-as-org-slug; serve it when the viewer may read that org, otherwise fall back
    // to the shared public org so the anonymous public-scan path still works. (Under-permissioning fix,
    // not a leak — getLatestRecommendations stays org-scoped either way.)
    const ownerOrg = parsed.owner.toLowerCase();
    const orgSlug = (await canReadOrg(ownerOrg)) ? ownerOrg : PUBLIC_ORG;
    const result = await getLatestRecommendations(parsed.owner, parsed.repo, { orgSlug });
    if (!result) return NextResponse.json({ scanId: null, items: [], sort: "priority" });

    const lifts = await getOrgExpectedLifts(orgSlug);
    const withLift = result.items.map((it) => ({
      ...it,
      expectedLift: expectedLiftClause(lifts.get(roadmapLiftKey(it))),
    }));
    // `sort=measured` is honored only when something was actually measured. With an empty ledger the
    // response keeps the order the read layer produced (the LLM's own emission order) rather than
    // silently re-sorting into a different one — a "measured" ordering over zero measurements would be
    // a re-order with no evidence behind it, which is the sort of quiet lie this whole item is against.
    const wantMeasured = searchParams.get("sort") === "measured";
    const anyMeasured = withLift.some((it) => it.expectedLift !== null);
    const sort = wantMeasured && anyMeasured ? "measured" : "priority";
    const items =
      sort === "measured"
        ? [...withLift].sort((a, b) => measuredPriorityScore(b, lifts) - measuredPriorityScore(a, lifts))
        : withLift;
    return NextResponse.json({ ...result, items, sort });
  } catch (err) {
    console.error("[recommendations] query failed", err);
    return NextResponse.json({ error: "Failed to load recommendations." }, { status: 500 });
  }
}
