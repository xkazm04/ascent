// GET  /api/org/admission?org=slug                                  -> { rows, stanceVersion }  (member read)
// POST /api/org/admission { org, repo, grantedTier, mode, rationale } -> { ok, row }             (owner)
//
// AGENT ADMISSION (moonshot #8) — the recorded, overridable per-repo decision. Auth is a clone of
// the ai-stance route it sits beside: member read, owner-gated write (a repo's admission is an
// org-wide governance statement, not a per-repo preference), same-origin enforced by
// requireOrgOwnerPost, and every write audited as `org.admission`.
//
// NO `[id]` SEGMENT. Every route in this family is addressed by (org, repoFullName) and gates the
// org BEFORE constraining the query by it (gate-then-constrain), so a repo name belonging to another
// tenant simply matches nothing rather than being authorized against the wrong org. The repo name is
// additionally required to live UNDER the gated org's owner namespace, so a caller cannot name
// "othertenant/repo" while presenting their own org.
//
// WHY OWNER AND NOT ADMIN. This is the surface that can move a repo from `assisted-only` to
// `agents-allowed` — i.e. decide that autonomous agents may open work in a repository. The autonomy
// model's own gap line asked for an OVERRIDABLE RECORDED DECISION, and a decision with no named
// author is not one: `decidedBy` is always the acting owner's login, never a system value.

import { NextResponse } from "next/server";
import { isDbConfigured, recordOrgAudit } from "@/lib/db";
import { getActiveOrgStance } from "@/lib/db/org-stance";
import { listOrgAdmissions, upsertRepoAdmission, MAX_RATIONALE } from "@/lib/db/org-admission";
import { isAdmissionMode, isAutonomyTierId } from "@/lib/org/admission";
import { requireOrgRead } from "@/lib/authz";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";
import { resolveViewerLogin } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The repo name a caller supplied, constrained to the org that was just gated. Returns null when the
 * shape is wrong OR when the owner segment is not this org — the gate-then-constrain half that a
 * structural test cannot check for us.
 */
export function repoUnderOrg(org: string, raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const full = raw.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(full)) return null;
  const [owner] = full.split("/");
  return owner?.toLowerCase() === org.toLowerCase() ? full : null;
}

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Admission decisions require a database." }, { status: 503 });
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  const [rows, stance] = await Promise.all([listOrgAdmissions(org), getActiveOrgStance(org)]);
  // `stanceVersion` travels with the rows so the client can mark a decision as STALE without a second
  // request — and so "stale" is computed against one version both halves agree on, rather than
  // against whatever the client last happened to fetch.
  return NextResponse.json({ rows, stanceVersion: stance?.version ?? null });
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Admission decisions require a database." }, { status: 503 });
  const gate = await requireOrgOwnerPost<{ repo?: unknown; grantedTier?: unknown; mode?: unknown; rationale?: unknown }>(
    request,
    { missingOrgError: "Provide { org, repo, grantedTier, mode }." },
  );
  if (gate instanceof NextResponse) return gate;
  const { org, body } = gate;

  const repo = repoUnderOrg(org, body.repo);
  if (!repo) {
    return NextResponse.json({ error: 'Provide repo as "owner/name" under this organization.' }, { status: 400 });
  }
  if (!isAutonomyTierId(body.grantedTier)) {
    return NextResponse.json({ error: "grantedTier must be one of T0, T1, T2, T3." }, { status: 400 });
  }
  if (!isAdmissionMode(body.mode)) {
    return NextResponse.json({ error: "mode must be one of agents-allowed, assisted-only, blocked." }, { status: 400 });
  }
  const rationale = typeof body.rationale === "string" ? body.rationale.trim().slice(0, MAX_RATIONALE) : "";

  const actorLogin = await resolveViewerLogin();
  if (!actorLogin) {
    // An override with no named author is not a decision — it is a measurement with a different
    // value, which is exactly the confusion this table exists to end. Refuse rather than record a
    // decision nobody made.
    return NextResponse.json({ error: "An admission decision must be attributable to a signed-in owner." }, { status: 403 });
  }

  const row = await upsertRepoAdmission(org, repo, { grantedTier: body.grantedTier, mode: body.mode, rationale, decidedBy: actorLogin });
  if (!row) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });

  await recordOrgAudit(
    "org.admission",
    org,
    {
      org,
      repo,
      grantedTier: row.grantedTier,
      // The DERIVED tier is recorded beside the grant, because "granted T3 where the scan derived T1"
      // is the sentence an auditor needs and it is unreconstructible from the grant alone.
      derivedTier: row.derivedTier,
      mode: row.mode,
      stanceVersion: row.stanceVersion,
      status:
        `${repo}: ${row.mode}, tier ${row.grantedTier}` +
        (row.derivedTier && row.derivedTier !== row.grantedTier ? ` (overrides derived ${row.derivedTier})` : "") +
        (rationale ? ` — ${rationale}` : ""),
    },
    actorLogin,
  ).catch(() => {});

  return NextResponse.json({ ok: true, row });
}
