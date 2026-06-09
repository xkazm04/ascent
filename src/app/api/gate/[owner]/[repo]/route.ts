// GET /api/gate/:owner/:repo  ->  JSON gate result, with an HTTP status CI can branch on:
//   200 when the repo passes the maturity gate, 422 when it fails (so `curl --fail` exits non-zero).
// Honors the same policy query params as the gate badge:
//   ?min_level=L3&min_overall=60&min_dimension=40&no_ungoverned=1
// Runs a fast deterministic (mock) scan by default; pass ?mock=0 to score with the configured LLM.

import { NextResponse } from "next/server";
import { scanRepository } from "@/lib/scan";
import { resolveHeadWithHint } from "@/lib/scan-cache";
import { cacheGet, cacheSet, makeCacheKey, normalizeRepoName } from "@/lib/cache";
import { evaluateGate, policyFromParams } from "@/lib/scoring/gate";
import { rateLimitRequest, tooManyRequests, SCAN_RATE_LIMIT } from "@/lib/rate-limit";

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
  // Optional git ref (branch/tag/commit SHA) to gate a PR head in CI:
  //   /api/gate/owner/repo?ref=<pr-head-sha>. A ref-scoped scan reflects what the PR changes,
  //   not the default branch — so a PR that adds tests/CI/agent-guidance can clear the gate.
  const ref = searchParams.get("ref") || undefined;
  // Normalize so the gate shares one cache-key scheme with the scan flow and the badge —
  // casing/percent-encoding variants of the same repo must not fragment into separate entries.
  const ownerN = normalizeRepoName(owner);
  const repoN = normalizeRepoName(repo);
  // Rate-limit the EXPENSIVE real-LLM path only (?mock=0). Default mock gating is cheap/deterministic
  // and stays unthrottled for CI; only ?mock=0 (optionally with distinct ?ref= values that bypass the
  // cache) spends LLM budget, so cap it per-IP/global to prevent unauthenticated cost amplification.
  if (!mock) {
    const rl = rateLimitRequest(req, SCAN_RATE_LIMIT);
    if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  }
  try {
    let report;
    if (ref) {
      // Ref-scoped: bypass the default-branch cache (keyed by the default head sha) and score the
      // requested ref directly. Cheap enough — CI calls this once per PR event.
      report = await scanRepository(`${ownerN}/${repoN}`, { mock, ref });
    } else {
      // Resolve the current head commit so the gate keys the same per-commit entry as the scan
      // flow and badge — a push misses the cache and re-evaluates against fresh signals instead
      // of returning a stale pass/fail (CI would otherwise gate on the pre-push score). CONDITIONAL
      // via the shared head-hint store (free 304 on an unchanged repo). Null on failure → a
      // SHA-less key (best-effort).
      const sha = await resolveHeadWithHint({ owner: ownerN, repo: repoN }, process.env.GITHUB_TOKEN);
      const llmKey = makeCacheKey(ownerN, repoN, true, sha);
      const mockKey = makeCacheKey(ownerN, repoN, false, sha);
      report = cacheGet(llmKey) ?? cacheGet(mockKey);
      if (!report) {
        report = await scanRepository(`${ownerN}/${repoN}`, { mock });
        cacheSet(mock ? mockKey : llmKey, report);
      }
    }

    const gate = evaluateGate(report, policyFromParams(searchParams, report.archetype));
    return NextResponse.json(
      {
        repo: `${ownerN}/${repoN}`,
        ref: ref ?? null,
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
