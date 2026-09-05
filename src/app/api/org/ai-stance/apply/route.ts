// POST /api/org/ai-stance/apply { org, repo, base? }  ->  { url, number, reused, path }
//
// Open a DRAFT PR committing the org's PUBLISHED stance into a repo as AI_POLICY.md — the same
// apply machinery Practices uses (openArtifactDraftPr: openDraftPr + uniform audit envelope), with
// the same auth shape as /api/practices/apply: App installed, signed-in actor when auth is live,
// admin role in the org (it writes to a customer repo with the org's installation token). The
// filename deliberately matches the D1 detector's `ai[-_]policy` reward, so adopting the stance
// lifts the dimension that scores AI guidance.

import { NextResponse } from "next/server";
import { parseRepoUrl, fetchRepoContext } from "@/lib/github/source";
import { openArtifactDraftPr } from "@/lib/practices/apply";
import { buildStanceArtifact } from "@/lib/org/stance-artifact";
import { isAppConfigured } from "@/lib/github/app";
import { getActiveOrgStance, getOrgId, isDbConfigured } from "@/lib/db";
import { isAuthConfigured } from "@/lib/auth";
import { authGateEnabled, resolveViewerLogin } from "@/lib/access";
import { requireOrgRole } from "@/lib/authz";
import { mapPrWriteError, requirePrWriteContext } from "@/lib/github/pr-route";

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

  const body = (await request.json().catch(() => ({}))) as { org?: string; repo?: string; base?: string };
  const parsed = parseRepoUrl(body.repo ?? "");
  if (!body.org || !parsed) {
    return NextResponse.json({ error: "Provide { org, repo: 'owner/name' }." }, { status: 400 });
  }
  const org = body.org.toLowerCase();
  parsed.owner = parsed.owner.toLowerCase();

  const denied = await requireOrgRole(org, "admin");
  if (denied) return denied;

  const active = await getActiveOrgStance(org);
  if (!active) {
    return NextResponse.json({ error: "No published stance. Publish one before opening policy PRs." }, { status: 409 });
  }

  try {
    const ctx = await requirePrWriteContext(parsed.owner);
    if (ctx instanceof Response) return ctx;
    const orgId = (await getOrgId(org).catch(() => null)) ?? undefined;
    const repoCtx = await fetchRepoContext(parsed, ctx.token);
    const artifact = buildStanceArtifact(
      active.stance,
      { org, version: active.version, publishedAt: active.publishedAt?.toISOString().slice(0, 10) ?? null },
      repoCtx,
    );
    const pr = await openArtifactDraftPr(ctx.token, parsed, artifact, body.base, {
      action: "ai_stance.pr_opened",
      orgId,
      actorId: actorLogin ?? undefined,
      meta: { repo: repoCtx.fullName, stanceVersion: active.version },
    });
    return NextResponse.json({ ...pr, path: artifact.path });
  } catch (err) {
    return mapPrWriteError(err, { tag: "ai-stance/apply", genericError: "Failed to open the policy PR." });
  }
}
