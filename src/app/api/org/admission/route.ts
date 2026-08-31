// GET    /api/org/admission?org=slug                                  -> { rows, stanceVersion }  (member read)
// POST   /api/org/admission { org, repo, grantedTier, mode, rationale } -> { ok, row }            (owner)
// DELETE /api/org/admission { org, repo, rationale }                  -> { ok, withdrawn }        (owner)
//
// AGENT ADMISSION (moonshot #8) — the recorded, overridable per-repo decision. Auth is a clone of
// the ai-stance route it sits beside: member read, owner-gated write (a repo's admission is an
// org-wide governance statement, not a per-repo preference), same-origin enforced by
// requireOrgOwnerPost, and every write audited as `org.admission`.
//
// NO `[id]` SEGMENT. Every route in this family is addressed by (org, repoFullName) and gates the
// org BEFORE constraining the query by it (gate-then-constrain), so a repo name belonging to another
// tenant simply matches nothing rather than being authorized against the wrong org. The repo name is
// additionally required to be one the gated org actually TRACKS (`repoUnderOrg`), so a caller cannot
// name "othertenant/repo" while presenting their own org.
//
// WHY OWNER AND NOT ADMIN. This is the surface that can move a repo from `assisted-only` to
// `agents-allowed` — i.e. decide that autonomous agents may open work in a repository. The autonomy
// model's own gap line asked for an OVERRIDABLE RECORDED DECISION, and a decision with no named
// author is not one: `decidedBy` is always the acting owner's login, never a system value.

import { NextResponse } from "next/server";
import { isDbConfigured, recordOrgAudit } from "@/lib/db";
import { getActiveOrgStance } from "@/lib/db/org-stance";
import { deleteRepoAdmission, listOrgAdmissions, upsertRepoAdmission, orgTracksRepo, MAX_RATIONALE } from "@/lib/db/org-admission";
import { isAdmissionMode, isAutonomyTierId } from "@/lib/org/admission";
import { requireOrgRead } from "@/lib/authz";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";
import { resolveViewerLogin } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `owner/name` or null. Shape only — this makes no claim about who the repo belongs to. */
export function parseRepoFullName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const full = raw.trim();
  return /^[\w.-]+\/[\w.-]+$/.test(full) ? full : null;
}

/**
 * The repo name a caller supplied, constrained to the org that was just gated. Returns null when the
 * shape is wrong OR when the repository does not belong to this org — the gate-then-constrain half
 * that a structural test cannot check for us.
 *
 * TENANCY IS THE ORG'S REPO SET, NOT A STRING PREFIX (UAT `PRIYA-L2-C5`). This used to require
 * `owner === org`, which is true only of an organization whose slug equals its GitHub owner
 * namespace. Every org named for its team rather than its account failed it: on this host, `kiro`
 * could never admit its own `xkazm04/*` repositories, so moonshot #3's remote work protocol was
 * permanently unreachable for the one org actually using it — not a test artifact, the real working
 * org. The prefix was never the authority anyway; `orgTracksRepo` reads the `(orgId, fullName)` key
 * that is, so a repo belonging to another tenant still matches nothing.
 *
 * The prefix survives as a FAST PATH ahead of the read, and only because it can never be wrong in
 * the direction that matters: an owner-namespace match is the case the old rule already admitted.
 */
export async function repoUnderOrg(org: string, raw: unknown): Promise<string | null> {
  const full = parseRepoFullName(raw);
  if (!full) return null;
  const [owner] = full.split("/");
  if (owner?.toLowerCase() === org.toLowerCase()) return full;
  return (await orgTracksRepo(org, full)) ? full : null;
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

  const repo = await repoUnderOrg(org, body.repo);
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

/**
 * WITHDRAW a decision (UAT `RC2-N4`). Same gate as POST, deliberately: unmaking a governance decision
 * is the same authority as making one, and it is the half that was missing.
 *
 * The asymmetry this closes is the route's own argument turned around. POST refuses to record a
 * decision nobody signed (`route.ts` above: *"an override with no named author is not a decision — it
 * is a measurement with a different value"*), and yet a decision signed in error could never be taken
 * back: `upsertRepoAdmission` can only move a decision, so the closest thing to a revoke was granting
 * the derived tier, which still says an owner decided. The ledger could not distinguish "decided, then
 * withdrawn" from "decided".
 *
 * TWO STORES, TWO SHAPES. The state row is deleted — an undecided repository has no record at all,
 * and the next read re-seeds the honest "nobody has decided" state — while the withdrawal is APPENDED
 * to `OrgAudit` carrying the actor, what the decision WAS, and the reason. A withdrawal that vanished
 * from both stores would be a worse trail than no revoke door, which is why this is never a silent
 * row removal.
 */
export async function DELETE(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Admission decisions require a database." }, { status: 503 });
  const gate = await requireOrgOwnerPost<{ repo?: unknown; rationale?: unknown }>(request, {
    missingOrgError: "Provide { org, repo }.",
  });
  if (gate instanceof NextResponse) return gate;
  const { org, body } = gate;

  const repo = await repoUnderOrg(org, body.repo);
  if (!repo) {
    return NextResponse.json({ error: 'Provide repo as "owner/name" under this organization.' }, { status: 400 });
  }
  const rationale = typeof body.rationale === "string" ? body.rationale.trim().slice(0, MAX_RATIONALE) : "";

  const actorLogin = await resolveViewerLogin();
  if (!actorLogin) {
    // A withdrawal with no named author is the same defect as an override with none — the act would
    // record that the decision is gone and nothing about who removed it.
    return NextResponse.json({ error: "Withdrawing an admission decision must be attributable to a signed-in owner." }, { status: 403 });
  }

  const withdrawn = await deleteRepoAdmission(org, repo);
  if (!withdrawn) {
    // Nothing was decided here, so nothing was withdrawn. Idempotent, and NO act is written: an
    // append-only ledger must carry things that happened, not requests that were made.
    return NextResponse.json({ ok: true, withdrawn: null });
  }

  await recordOrgAudit(
    "org.admission_withdrawn",
    org,
    {
      org,
      repo,
      // The act carries the decision it removed. Once the state row is gone this is the only place
      // the previous grant exists, and "what did she withdraw" is the question an auditor asks first.
      previousGrantedTier: withdrawn.grantedTier,
      previousMode: withdrawn.mode,
      previousDecidedBy: withdrawn.decidedBy,
      derivedTier: withdrawn.derivedTier,
      stanceVersion: withdrawn.stanceVersion,
      status:
        `${repo}: admission decision WITHDRAWN — was ${withdrawn.mode}, tier ${withdrawn.grantedTier}` +
        (withdrawn.decidedBy ? ` (decided by @${withdrawn.decidedBy})` : " (never decided — seeded)") +
        `; back to no decision, tier ${withdrawn.derivedTier ?? "not assessed"} as derived` +
        (rationale ? ` — ${rationale}` : ""),
    },
    actorLogin,
  ).catch(() => {});

  return NextResponse.json({ ok: true, withdrawn });
}
