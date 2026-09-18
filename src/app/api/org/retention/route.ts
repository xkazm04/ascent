// GET  /api/org/retention?org=slug
// POST /api/org/retention { org, retentionMaxScans, retentionAuditDays, retentionCompact, retentionDigestMonths, preview? }
//
// Owner Settings control for the four Organization retention/compaction columns. Reads and writes
// those columns; a configured-but-nonzero window below RETENTION_MIN_* is refused. `preview: true`
// dry-runs the proposed policy for this org (same counters as ?dryRun=1 on /api/cron/purge) and
// writes nothing. A save writes the columns only — it never purges. See docs/features/data/retention.md.
//
// Route shape: flat `/api/org/<verb>` with the tenant in the body / `?org=`, like erase/branding.
// Guards: GET is owner-gated; POST is same-origin then owner (requireOrgOwnerPost).

import { NextResponse } from "next/server";
import { isDbConfigured, recordOrgAudit } from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";
import { resolveViewerLogin } from "@/lib/access";
import { getOrgRetention, previewOrgRetention, setOrgRetention } from "@/lib/db/retention";
import {
  parseOrgRetentionBody,
  resolveRetention,
  envRetentionDefaults,
  RETENTION_MIN_SCANS_PER_REPO,
  RETENTION_MIN_AUDIT_DAYS,
  type OrgPurgeResult,
} from "@/lib/db/retention-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MISSING =
  "Provide { org, retentionMaxScans, retentionAuditDays, retentionCompact, retentionDigestMonths }.";

function emptyPreview(org: string): OrgPurgeResult {
  const policy = resolveRetention(envRetentionDefaults(), {
    retentionMaxScans: null,
    retentionAuditDays: null,
  });
  return {
    orgSlug: org,
    policy,
    scansDeleted: 0,
    dimensionsDeleted: 0,
    recommendationsDeleted: 0,
    recommendationEventsDeleted: 0,
    auditDeleted: 0,
    outcomesDeleted: 0,
    usageEventsDeleted: 0,
    conformanceReportsDeleted: 0,
    conformanceFindingsDeleted: 0,
    memoryCitationsDeleted: 0,
    controlObservationsDeleted: 0,
    digestsWritten: 0,
    scansCompacted: 0,
    digestsDeleted: 0,
    digestsWouldWrite: null,
  };
}

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Retention requires a database." }, { status: 503 });
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;
  const view = await getOrgRetention(org);
  if (!view) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
  return NextResponse.json(view);
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Retention requires a database." }, { status: 503 });
  const gate = await requireOrgOwnerPost<Record<string, unknown>>(request, { missingOrgError: MISSING });
  if (gate instanceof NextResponse) return gate;
  const { org, body } = gate;

  const parsed = parseOrgRetentionBody(body);
  if (!parsed.ok) {
    return NextResponse.json(
      {
        error: parsed.error,
        ...(parsed.belowFloor
          ? { floors: { maxScansPerRepo: RETENTION_MIN_SCANS_PER_REPO, auditDays: RETENTION_MIN_AUDIT_DAYS } }
          : {}),
      },
      { status: 400 },
    );
  }

  const existing = await getOrgRetention(org);
  if (!existing) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });

  if (body.preview === true) {
    const summary = await previewOrgRetention(org, parsed.stored);
    if (!summary) return NextResponse.json({ error: "Retention requires a database." }, { status: 503 });
    return NextResponse.json({
      dryRun: true,
      stored: parsed.stored,
      preview: summary.results[0] ?? emptyPreview(org),
      errors: summary.errors,
    });
  }

  const saved = await setOrgRetention(org, parsed.stored);
  if (!saved.ok) {
    if (saved.reason === "no-db") return NextResponse.json({ error: "Retention requires a database." }, { status: 503 });
    if (saved.reason === "below-floor") {
      return NextResponse.json(
        {
          error: "Refusing a policy below the safety floor.",
          floors: { maxScansPerRepo: RETENTION_MIN_SCANS_PER_REPO, auditDays: RETENTION_MIN_AUDIT_DAYS },
          violations: saved.violations,
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
  }

  const actorLogin = await resolveViewerLogin();
  await recordOrgAudit(
    "retention.updated",
    org,
    { org, ...parsed.stored, purged: false },
    actorLogin ?? undefined,
  ).catch(() => {});

  return NextResponse.json({ ok: true, ...saved.view, purged: false });
}
