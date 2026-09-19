// POST /api/org/issue  { repo: "owner/name", title, body, labels?, findingId? }  ->  { url, number, reused }
// File a GitHub issue in a fleet repo — the action behind "make this blocker actionable". The write
// runs on the org's GitHub App installation token (the same trust model as /api/practices/apply: the
// codebase deliberately never persists user OAuth tokens), gated at ADMIN in the org; the requesting
// user is stamped into the issue body and the audit trail, so authorship is attributable even though
// the App bot is the technical author.
//
// The write is IDEMPOTENT on an optional `findingId`: the route mints a hidden marker from it and
// createRepoIssue reuses the repo's existing OPEN issue carrying that marker instead of filing a
// second one ({ reused: true }). Re-opening the blocker docket after a refresh therefore relinks the
// issue it already filed rather than duplicating it.

import { NextResponse } from "next/server";
import { parseRepoUrl } from "@/lib/github/source";
import { createRepoIssue, passportBlockerMarker } from "@/lib/github/issues";
import { AppApiError, getInstallationToken, isAppConfigured } from "@/lib/github/app";
import { getInstallationIdForOwner, getOrgId, isDbConfigured, recordAudit } from "@/lib/db";
import { isAuthConfigured } from "@/lib/auth";
import { authGateEnabled, resolveViewerLogin } from "@/lib/access";
import { requireOrgRole } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_TITLE = 256;
const MAX_BODY = 20_000;
// A findingId is a minted passport id (`auto.self-verify-gaps`). It becomes a hidden HTML comment in
// the issue body, so it is validated to an inert alphabet here rather than trusted from the client —
// nothing a caller sends can close the comment or inject markup.
const FINDING_ID = /^[A-Za-z0-9._:-]{1,120}$/;

export async function POST(request: Request) {
  if (!isAppConfigured()) {
    return NextResponse.json(
      { error: "Filing issues needs the GitHub App installed with issues write access." },
      { status: 503 },
    );
  }
  // Writing to a customer repo is sensitive — require a signed-in user when auth is configured.
  // The sign-in check used to key on isAuthConfigured() alone -- the DORMANT custom-OAuth env, false
  // in production -- so it never fired there and the actor below was always null. Gate whenever
  // EITHER stack is live (Supabase wall or a dev box with the legacy OAuth configured); a fully
  // auth-off local/demo deployment stays open, exactly as before.
  const actorLogin = await resolveViewerLogin();
  if ((authGateEnabled() || isAuthConfigured()) && !actorLogin) {
    return NextResponse.json({ error: "Sign in to file issues." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    repo?: string;
    title?: string;
    body?: string;
    labels?: string[];
    findingId?: string;
  };
  const parsed = parseRepoUrl(body.repo ?? "");
  const title = (body.title ?? "").trim();
  if (!parsed || !title) {
    return NextResponse.json({ error: "Provide { repo: 'owner/name', title, body }." }, { status: 400 });
  }
  if (title.length > MAX_TITLE || (body.body ?? "").length > MAX_BODY) {
    return NextResponse.json({ error: "Title or body too long." }, { status: 400 });
  }
  // Lower-case the owner ONCE so the tenant gate, installation lookup, and audit orgId key off the
  // same value (same normalization as practices/apply).
  parsed.owner = parsed.owner.toLowerCase();

  // Tenant gate: this writes into a CUSTOMER repo using the org's installation token, so it requires
  // ADMIN in that org — not merely membership (cross-tenant write IDOR guard, and the same bar the
  // other customer-repo writers hold: /api/report/passport/pr and the foundation PR writer). Resolve
  // the org first, gate it, and pass the SAME normalized owner into the installation lookup and the
  // write below, so a mismatched repo coordinate cannot be written through another org's token.
  const denied = await requireOrgRole(parsed.owner, "admin");
  if (denied) return denied;

  const installId = isDbConfigured() ? await getInstallationIdForOwner(parsed.owner).catch(() => null) : null;
  if (!installId) {
    return NextResponse.json(
      { error: `Ascent isn't installed on ${parsed.owner}. Install the GitHub App (with issues write) to file issues.` },
      { status: 403 },
    );
  }

  // Idempotency key. Absent or malformed ⇒ no marker ⇒ the create-every-time behaviour, which is
  // still correct for a caller that has no stable id to dedupe on.
  const rawFindingId = (body.findingId ?? "").trim();
  const marker = rawFindingId && FINDING_ID.test(rawFindingId) ? passportBlockerMarker(rawFindingId) : undefined;

  // Attribution: the App bot is the technical author, so stamp the requesting user into the body.
  const attribution = actorLogin ? `\n\n---\n_Filed via Ascent by @${actorLogin}._` : "";

  try {
    const token = await getInstallationToken(installId);
    const issue = await createRepoIssue(token, parsed.owner, parsed.repo, {
      title,
      body: `${body.body ?? ""}${attribution}`,
      labels: body.labels,
      marker,
    });
    // A reuse wrote NOTHING to the customer repo, so it is not an `issue.create` in the audit trail —
    // recording one would make the log claim a write that never happened.
    if (!issue.reused) {
      const orgId = (await getOrgId(parsed.owner).catch(() => null)) ?? undefined;
      await recordAudit(
        "issue.create",
        { repo: `${parsed.owner}/${parsed.repo}`, number: issue.number, title },
        { orgId, actorId: actorLogin ?? undefined },
      );
    }
    return NextResponse.json(issue);
  } catch (err) {
    if (err instanceof AppApiError) {
      // 403 → installation lacks issues write; 404 → repo gone / not visible to the installation;
      // 410 → issues are disabled on the repo. Everything else is GitHub misbehaving (502).
      const status = err.status === 403 || err.status === 404 || err.status === 410 ? err.status : 502;
      const hint =
        err.status === 403
          ? "The installation lacks issues write access. Update the GitHub App's permissions."
          : err.status === 410
            ? "Issues are disabled on this repository."
            : err.status === 404
              ? "The repository isn't visible to the installation."
              : "GitHub rejected the write. Try again.";
      return NextResponse.json({ error: hint }, { status });
    }
    console.error("[org/issue] failed", err);
    return NextResponse.json({ error: "Failed to file the issue." }, { status: 500 });
  }
}
