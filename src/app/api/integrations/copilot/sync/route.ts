// POST /api/integrations/copilot/sync { org } -> { synced }
//
// Pull the org's Copilot seats + daily engagement and fold them into `AiUsageRecord` (W3b).
// Owner-gated: it reads billing-adjacent data through the org's GitHub App installation token.
//
// This connector reports SEATS AND ENGAGEMENT, NOT COST — see src/lib/integrations/copilot.ts for
// why 0 cost means "not reported" and never "spent nothing". The response says so explicitly so an
// operator who connects it is not left wondering why the ROI panel still asks for a cost source.
//
// `mode: "replace"` (the default, stated explicitly): the metrics API returns each day's TOTALS, so
// re-syncing an overlapping window must OVERWRITE those day buckets. "add" — correct for the OTel
// path, where each export carries a delta — would accumulate the same day into a fictional multiple.

import { NextResponse } from "next/server";
import { getInstallationIdForOwner, isDbConfigured, recordAudit, recordUsage, getOrgId } from "@/lib/db";
import { getInstallationToken, isAppConfigured } from "@/lib/github/app";
import { buildCopilotUsage, fetchCopilot, summarizeCopilotSync } from "@/lib/integrations/copilot";
import { requireOrgAccess, hasOrgRole } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "The Copilot connector requires a database." }, { status: 503 });
  }
  const body = (await request.json().catch(() => ({}))) as { org?: string };
  const org = body.org;
  if (!org) return NextResponse.json({ error: "Provide { org }." }, { status: 400 });

  const denied = await requireOrgAccess(org);
  if (denied) return denied;
  if (!(await hasOrgRole(org, "owner"))) {
    return NextResponse.json({ error: "Connecting a provider is owner-only." }, { status: 403 });
  }
  if (!isAppConfigured()) {
    return NextResponse.json(
      { error: "The GitHub App is not configured on this deployment, so there is no credential to read Copilot data with." },
      { status: 503 },
    );
  }

  const installationId = await getInstallationIdForOwner(org).catch(() => null);
  if (!installationId) {
    return NextResponse.json(
      { error: `No GitHub App installation found for ${org}. Install it on the organization first.` },
      { status: 404 },
    );
  }

  let token: string;
  try {
    token = await getInstallationToken(installationId);
  } catch {
    return NextResponse.json({ error: "Could not mint an installation token." }, { status: 502 });
  }

  const pulled = await fetchCopilot(org, token);
  const records = buildCopilotUsage(org, pulled);

  // Both halves empty is the diagnosable case, and the cause is nearly always scope: the Ascent App
  // installation does not carry Copilot admin permission by default. Say that, rather than 200-ing
  // with zero rows and letting the operator conclude the org has no Copilot.
  if (records.length === 0 && !pulled.seats) {
    return NextResponse.json(
      {
        error:
          "GitHub returned no Copilot seats or metrics for this organization. The credential needs Copilot admin " +
          "access (manage_billing:copilot / read:enterprise), and the Metrics API only returns data for orgs with " +
          "at least 5 active Copilot users.",
      },
      { status: 422 },
    );
  }

  const res = await recordUsage(org, records, { mode: "replace" });
  const summary = summarizeCopilotSync(records);

  const orgId = await getOrgId(org).catch(() => null);
  await recordAudit("integrations.copilot.sync", { ...summary, stored: res.stored }, { orgId: orgId ?? undefined });

  return NextResponse.json({
    synced: true,
    ...summary,
    stored: res.stored,
    // Stated on every successful sync, not buried in docs — an operator who connects a provider and
    // then sees no money on the ROI panel deserves to be told why by the thing they just connected.
    note:
      "Copilot reports seats and engagement, not spend — GitHub does not expose per-seat price through the API. " +
      "Cost-based ROI needs a provider that reports it (Claude Code, via OTel).",
  });
}
