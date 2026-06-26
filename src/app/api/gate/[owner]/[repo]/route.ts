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
import { getOrgGatePolicy } from "@/lib/db/org-gate";
import { rateLimitRequest, tooManyRequests, SCAN_RATE_LIMIT, GATE_RATE_LIMIT } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Query params that explicitly configure the gate policy on the URL (all consumed by policyFromParams).
// When ANY is present the caller is overriding the policy per-request; when NONE is, the endpoint falls
// back to the org's persisted gate policy (ci-gate-status-checks #2).
const GATE_POLICY_PARAMS = [
  "min_level",
  "min_overall",
  "min_dimension",
  "no_ungoverned",
  "require_protection",
  "security",
  "min_security",
] as const;

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
  // Rate-limiting strategy (denial-of-wallet defense that still lets real CI through):
  //  - The real-LLM path (?mock=0) is always throttled up-front with the strict SCAN_RATE_LIMIT — it
  //    spends both LLM budget and a full GitHub ingest.
  //  - The default (mock) path is not free either, but the cost is in the GitHub ingest, not the LLM:
  //    a CACHE MISS or a ?ref scan runs a full repo ingest against the operator PAT, so those
  //    GitHub-touching branches get a generous GATE_RATE_LIMIT (real CI calls once per PR event and
  //    never trips). A warm cache HIT only does a cheap conditional head-resolve (free 304) and stays
  //    unthrottled, preserving the deterministic-CI contract that a cache-hit gate is effectively free.
  if (!mock) {
    const rl = rateLimitRequest(req, SCAN_RATE_LIMIT);
    if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  }
  try {
    let report;
    if (ref) {
      // Ref-scoped: bypass the default-branch cache (keyed by the default head sha) and score the
      // requested ref directly. This always ingests from GitHub, so throttle the default path here too.
      if (mock) {
        const rl = rateLimitRequest(req, GATE_RATE_LIMIT);
        if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
      }
      report = await scanRepository(`${ownerN}/${repoN}`, { mock, ref });
    } else {
      // Resolve the current head commit so the gate keys the same per-commit entry as the scan
      // flow and badge — a push misses the cache and re-evaluates against fresh signals instead
      // of returning a stale pass/fail (CI would otherwise gate on the pre-push score). CONDITIONAL
      // via the shared head-hint store (free 304 on an unchanged repo). Null on failure → a
      // SHA-less key (best-effort).
      const sha = await resolveHeadWithHint({ owner: ownerN, repo: repoN }, process.env.GITHUB_TOKEN);
      // Probe ONLY the mode that was requested. The old `cacheGet(llmKey) ?? cacheGet(mockKey)` read the
      // LLM entry first regardless of mode, so a default (mock=true) CI gate could return a STOCHASTIC
      // LLM verdict — a PR flipping pass↔fail between runs with identical code, purely from which scan
      // populated the cache first. Read and write the same key (useLLM = !mock) so the default gate is
      // deterministic and reproducible, matching the verdict's stated provider.
      const key = makeCacheKey(ownerN, repoN, !mock, sha);
      report = cacheGet(key);
      if (!report) {
        // Cache miss → about to run a full GitHub ingest; throttle the default path before spending it.
        if (mock) {
          const rl = rateLimitRequest(req, GATE_RATE_LIMIT);
          if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
        }
        report = await scanRepository(`${ownerN}/${repoN}`, { mock });
        cacheSet(key, report);
      }
    }

    // Policy precedence (ci-gate-status-checks #2): explicit query params override; else the org's
    // PERSISTED gate policy — the SAME bar the App-mode Check Run + governance fleet view enforce via
    // getOrgGatePolicy; else the archetype default. Before this, the HTTP gate built its policy ONLY
    // from query params + archetype default and never consulted the configured org bar, so a team that
    // saved a strict policy in GatePolicyEditor and wired `curl --fail /api/gate/...` into CI had that
    // bar silently ignored here while the App check enforced it (the two surfaces disagreeing on the
    // same repo). DB-less / unknown org / a read error all resolve to null → archetype default.
    const hasPolicyParams = GATE_POLICY_PARAMS.some((k) => searchParams.has(k));
    const policy = hasPolicyParams
      ? policyFromParams(searchParams, report.archetype)
      : (await getOrgGatePolicy(ownerN).catch(() => null)) ?? policyFromParams(searchParams, report.archetype);
    const gate = evaluateGate(report, policy);
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
