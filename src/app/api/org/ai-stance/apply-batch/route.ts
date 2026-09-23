// POST /api/org/ai-stance/apply-batch  { org, repos: ["owner/name", ...], base? }
//   -> { results: [{ repo, ok, url?, reused?, error? }], attempted, skipped }
// Fleet rollout of the published AI stance: open a draft PR committing AI_POLICY.md into every
// selected repo in one action, instead of stepping the single-repo dropdown N times. Same floors as
// /api/practices/apply-batch (G2-01 / G7-24): App installed, signed-in actor, **admin** (not member),
// every repo of ONE org, MAX_BATCH 25, mapPool at SCAN_CONCURRENCY, per-repo error isolation.
// Writes go through applyStanceToRepo → openArtifactDraftPr (the single apply's writer).

import { NextResponse } from "next/server";
import { parseRepoUrl } from "@/lib/github/source";
import { AppApiError, isAppConfigured } from "@/lib/github/app";
import { getActiveOrgStance, getOrgId, isDbConfigured } from "@/lib/db";
import { isAuthConfigured } from "@/lib/auth";
import { authGateEnabled, resolveViewerLogin } from "@/lib/access";
import { requireOrgRole } from "@/lib/authz";
import { classifyPrWriteError, requirePrWriteTarget, type PrWriteCoordinate } from "@/lib/github/pr-route";
import { mapPool, SCAN_CONCURRENCY } from "@/lib/pool";
import { applyStanceToRepo } from "@/lib/org/stance-apply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Cap a single batch so one click can't open hundreds of PRs / run past the function ceiling.
 *  Deliberately the SAME number as the practices batch. */
const MAX_BATCH = 25;

type BatchResult = { repo: string; ok: boolean; url?: string; reused?: boolean; error?: string };

export async function POST(request: Request) {
  if (!isAppConfigured()) {
    return NextResponse.json(
      { error: "Opening PRs needs the GitHub App installed with contents + pull-request write access." },
      { status: 503 },
    );
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "The AI stance requires a database." }, { status: 503 });
  }
  const actorLogin = await resolveViewerLogin();
  if ((authGateEnabled() || isAuthConfigured()) && !actorLogin) {
    return NextResponse.json({ error: "Sign in to open a policy PR." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    repos?: string[];
    base?: string;
  };
  const org = (body.org ?? "").trim().toLowerCase();
  if (!org || !Array.isArray(body.repos) || body.repos.length === 0) {
    return NextResponse.json({ error: "Provide { org, repos: ['owner/name', ...] }." }, { status: 400 });
  }

  // Tenancy first: parse, then every remaining coordinate must belong to the gated org. A
  // mixed-owner or foreign batch is refused outright rather than partially applied.
  const parsed = body.repos
    .map((raw) => ({ raw, ref: parseRepoUrl(raw) }))
    .filter((x): x is { raw: string; ref: NonNullable<ReturnType<typeof parseRepoUrl>> } => !!x.ref);
  if (parsed.length === 0) {
    return NextResponse.json({ error: "No valid 'owner/name' repos in the batch." }, { status: 400 });
  }
  for (const { ref } of parsed) {
    ref.owner = ref.owner.toLowerCase();
    if (ref.owner !== org) {
      return NextResponse.json({ error: `All repos in a batch must belong to ${org}.` }, { status: 400 });
    }
  }

  const denied = await requireOrgRole(org, "admin");
  if (denied) return denied;

  const active = await getActiveOrgStance(org);
  if (!active) {
    return NextResponse.json({ error: "No published stance. Publish one before opening policy PRs." }, { status: 409 });
  }

  const seen = new Set<string>();
  const unique = parsed.filter(({ ref }) => {
    const key = `${ref.owner}/${ref.repo}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const batch = unique.slice(0, MAX_BATCH);
  const skipped = unique.length - batch.length;

  const meta = {
    org,
    version: active.version,
    publishedAt: active.publishedAt?.toISOString().slice(0, 10) ?? null,
  };

  try {
    // One door: the composer re-checks every coordinate against the gated org (the loop above has
    // already refused a foreign one with this route's own 400), mints ONE token for that org, and
    // hands back the coordinates the writer uses.
    const target = await requirePrWriteTarget(org, batch.map((b) => b.raw), "owner-namespace");
    if (target instanceof Response) return target;
    const { token } = target;
    const orgId = (await getOrgId(org).catch(() => null)) ?? undefined;

    const results = await mapPool<PrWriteCoordinate, BatchResult>(target.targets, SCAN_CONCURRENCY, async ({ raw, parsed: ref }) => {
      try {
        const { pr, fullName } = await applyStanceToRepo({
          token,
          ref,
          stance: active.stance,
          meta,
          base: body.base,
          orgId,
          actorId: actorLogin ?? undefined,
          batch: true,
        });
        return { repo: fullName, ok: true, url: pr.url, reused: pr.reused };
      } catch (err) {
        const classified = classifyPrWriteError(err);
        return { repo: raw, ok: false, error: classified?.message ?? "Failed to open the policy PR." };
      }
    });

    return NextResponse.json({ results, attempted: batch.length, skipped });
  } catch (err) {
    if (err instanceof AppApiError) {
      return NextResponse.json({ error: "Failed to mint an installation token for this org." }, { status: 502 });
    }
    console.error("[ai-stance/apply-batch] failed", err);
    return NextResponse.json({ error: "Failed to open the policy PRs." }, { status: 500 });
  }
}
