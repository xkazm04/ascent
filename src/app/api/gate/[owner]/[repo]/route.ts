// GET /api/gate/:owner/:repo  ->  JSON gate result, with an HTTP status CI can branch on:
//   200 when the repo passes the maturity gate, 422 when it fails (so `curl --fail` exits non-zero).
// Honors the same policy query params as the gate badge:
//   ?min_level=L3&min_overall=60&min_dimension=40&no_ungoverned=1
// Runs a fast deterministic (mock) scan by default; pass ?mock=0 to score with the configured LLM.

import { NextResponse } from "next/server";
import { scanRepository } from "@/lib/scan";
import { resolveHeadSha } from "@/lib/github/source";
import { cacheGet, cacheSet, makeCacheKey, normalizeRepoName } from "@/lib/cache";
import { evaluateGate, policyFromParams } from "@/lib/scoring/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ owner: string; repo: string }> },
) {
  const { owner, repo } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const mock = searchParams.get("mock") !== "0" && searchParams.get("mock") !== "false";
  // Normalize so the gate shares one cache-key scheme with the scan flow and the badge —
  // casing/percent-encoding variants of the same repo must not fragment into separate entries.
  const ownerN = normalizeRepoName(owner);
  const repoN = normalizeRepoName(repo);
  try {
    // Resolve the current head commit so the gate keys the same per-commit entry as the scan
    // flow and badge — a push misses the cache and re-evaluates against fresh signals instead
    // of returning a stale pass/fail (CI would otherwise gate on the pre-push score). Null on
    // failure → a SHA-less key (best-effort).
    const sha = await resolveHeadSha({ owner: ownerN, repo: repoN }, process.env.GITHUB_TOKEN);
    const llmKey = makeCacheKey(ownerN, repoN, true, sha);
    const mockKey = makeCacheKey(ownerN, repoN, false, sha);
    let report = cacheGet(llmKey) ?? cacheGet(mockKey);
    if (!report) {
      report = await scanRepository(`${ownerN}/${repoN}`, { mock });
      cacheSet(mock ? mockKey : llmKey, report);
    }

    const gate = evaluateGate(report, policyFromParams(searchParams, report.archetype));
    return NextResponse.json(
      {
        repo: `${ownerN}/${repoN}`,
        pass: gate.pass,
        level: report.level.id,
        overallScore: report.overallScore,
        posture: report.posture.id,
        archetype: report.archetype,
        policy: gate.policy,
        failures: gate.failures,
      },
      { status: gate.pass ? 200 : 422 },
    );
  } catch (err) {
    console.error("[gate] evaluation failed", err);
    return NextResponse.json({ error: "Failed to evaluate the maturity gate." }, { status: 500 });
  }
}
