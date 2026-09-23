// POST /api/org/ai-stance/apply { org, repo, base?, preview?, dryRun? }
//   -> write   { url, number, reused, path }
//   -> preview { preview: true, path, body, bytes, version }  (zero GitHub writes)
//
// Open a DRAFT PR committing the org's PUBLISHED stance into a repo as AI_POLICY.md — the same
// apply machinery Practices uses (openArtifactDraftPr: openDraftPr + uniform audit envelope), with
// the same auth shape as /api/practices/apply: App installed, signed-in actor when auth is live,
// admin role in the org (it writes to a customer repo with the org's installation token). The
// filename deliberately matches the D1 detector's `ai[-_]policy` reward, so adopting the stance
// lifts the dimension that scores AI guidance.
//
// HITL: `preview: true` or `dryRun: true` returns the exact AI_POLICY.md bytes BEFORE
// requirePrWriteTarget / token mint / openArtifactDraftPr. The admin gate and the tenancy check
// (the repo's owner must be `org`) still run: policy bytes are org-authored, not public. Absent /
// false keeps the write path.
//
// The write sequence lives in applyStanceToRepo, shared with the fleet sibling
// /api/org/ai-stance/apply-batch (admin, one org, MAX_BATCH 25, mapPool). This route owns gating,
// HITL preview, and one-status error mapping.

import { NextResponse } from "next/server";
import { parseRepoUrl } from "@/lib/github/source";
import { buildStanceArtifact } from "@/lib/org/stance-artifact";
import { applyStanceToRepo } from "@/lib/org/stance-apply";
import { isAppConfigured } from "@/lib/github/app";
import { getActiveOrgStance, getOrgId, isDbConfigured } from "@/lib/db";
import { isAuthConfigured } from "@/lib/auth";
import { authGateEnabled, resolveViewerLogin } from "@/lib/access";
import { requireOrgRole } from "@/lib/authz";
import { mapPrWriteError, requirePrWriteTarget, resolvePrWriteCoordinate } from "@/lib/github/pr-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isAppConfigured()) {
    return NextResponse.json(
      { error: "Opening a PR needs the GitHub App installed with contents + pull-request write access." },
      { status: 503 },
    );
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "The AI stance requires a database." }, { status: 503 });
  }
  // Same gate as practices/apply: writing to a customer repo requires a signed-in actor whenever
  // EITHER auth stack is live (Supabase wall or the legacy OAuth env).
  const actorLogin = await resolveViewerLogin();
  if ((authGateEnabled() || isAuthConfigured()) && !actorLogin) {
    return NextResponse.json({ error: "Sign in to open a policy PR." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    repo?: string;
    base?: string;
    preview?: unknown;
    dryRun?: unknown;
  };
  const rawRepo = body.repo ?? "";
  if (!body.org || !parseRepoUrl(rawRepo)) {
    return NextResponse.json({ error: "Provide { org, repo: 'owner/name' }." }, { status: 400 });
  }
  const org = body.org.toLowerCase();

  const denied = await requireOrgRole(org, "admin");
  if (denied) return denied;

  // TENANCY, before the preview and before any installation lookup: the repo must sit in the gated
  // org's own namespace. This route used to gate `org` and then mint for the repo's parsed owner, so an admin
  // of any org could open a draft AI_POLICY.md PR in another tenant's repository with THAT tenant's
  // installation token (audited under the caller's own org). The preview is refused too: it would
  // render one org's policy against another org's repository.
  const coordinate = await resolvePrWriteCoordinate(org, rawRepo, "owner-namespace");
  if (coordinate instanceof Response) return coordinate;

  const active = await getActiveOrgStance(org);
  if (!active) {
    return NextResponse.json({ error: "No published stance. Publish one before opening policy PRs." }, { status: 409 });
  }

  const meta = {
    org,
    version: active.version,
    publishedAt: active.publishedAt?.toISOString().slice(0, 10) ?? null,
  };
  // HITL preview: same admin / tenancy / published-stance gates as the write, zero GitHub writes.
  // Must run before requirePrWriteTarget so a dry-run cannot mint an installation token.
  if (body.preview === true || body.dryRun === true) {
    const artifact = buildStanceArtifact(active.stance, meta, {
      fullName: coordinate.fullName,
      name: coordinate.repo,
    });
    return NextResponse.json({
      preview: true,
      path: artifact.path,
      body: artifact.body,
      bytes: new TextEncoder().encode(artifact.body).length,
      version: active.version,
    });
  }

  try {
    // The token is minted for the gated org and the coordinate is the one tenancy just admitted.
    const target = await requirePrWriteTarget(org, rawRepo, "owner-namespace");
    if (target instanceof Response) return target;
    const orgId = (await getOrgId(org).catch(() => null)) ?? undefined;
    const { pr, path } = await applyStanceToRepo({
      token: target.token,
      ref: target.parsed,
      stance: active.stance,
      meta,
      base: body.base,
      orgId,
      actorId: actorLogin ?? undefined,
    });
    return NextResponse.json({ ...pr, path });
  } catch (err) {
    return mapPrWriteError(err, { tag: "ai-stance/apply", genericError: "Failed to open the policy PR." });
  }
}
