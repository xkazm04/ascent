// GET /api/gate/:owner/:repo  ->  JSON gate result, with an HTTP status CI can branch on:
//   200 when the repo passes the maturity gate, 422 when it fails (so `curl --fail` exits non-zero).
// Honors the same policy query params as the gate badge:
//   ?min_level=L3&min_overall=60&min_dimension=40&no_ungoverned=1
// Runs a fast deterministic (mock) scan by default; pass ?mock=0 to score with the configured LLM.

import { NextResponse } from "next/server";
import { scanRepository } from "@/lib/scan";
import { GitHubError } from "@/lib/github/source";
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
  // SECURITY (ci-gate-status-checks #1): this endpoint is unauthenticated by design — CI calls it with
  // plain curl. Every ingest below therefore passes noAmbientToken, so a scan can never run against the
  // ambient GITHUB_TOKEN (an operator PAT that commonly has broad read access). Without it, any
  // anonymous caller could enumerate PRIVATE repos' full gate verdicts through the operator's
  // credentials. Token-less ingestion of a private repo 404s, which we surface honestly below.
  // Private repos are gated through the authenticated GitHub App check-run path (/api/app/webhook),
  // not this endpoint. Same construction as the public badge route.
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
      report = await scanRepository(`${ownerN}/${repoN}`, { mock, ref, noAmbientToken: true });
    } else {
      // Resolve the current head commit so the gate keys the same per-commit entry as the scan
      // flow and badge — a push misses the cache and re-evaluates against fresh signals instead
      // of returning a stale pass/fail (CI would otherwise gate on the pre-push score). CONDITIONAL
      // via the shared head-hint store (free 304 on an unchanged repo). Null on failure → a
      // SHA-less key (best-effort).
      // Token-less by construction (see the noAmbientToken note above): resolving a head sha with the
      // operator PAT would confirm a private repo's existence and current commit to an anonymous caller.
      const sha = await resolveHeadWithHint({ owner: ownerN, repo: repoN }, undefined);
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
        report = await scanRepository(`${ownerN}/${repoN}`, { mock, noAmbientToken: true });
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

    // HONESTY GUARD (ci-gate-status-checks #2): the machine-readable verdict must never present a
    // DEGRADED scan as a confident pass. When the caller asks for the real AI grade (?mock=0) but the
    // LLM times out / is unconfigured, scanRepository falls back to the deterministic MockProvider and
    // stamps engine.provider = "mock" (plus a warnings caveat). evaluateGate reads ONLY scores — never
    // the engine or warnings — so a fabricated-floor scan can still say pass:true. Because the old body
    // omitted warnings/engine and always returned 200 on a pass, `curl --fail` saw a clean green gate
    // indistinguishable from a genuine AI-graded pass, and CI would merge on the floor score.
    //
    // Detect degradation with the SAME predicate the persistence layer uses as its cache-poisoning
    // guard (scan-finalize.ts `classifyScanResult().degradedToMock`): the engine is "mock" while the
    // request did NOT ask for mock. Inlined rather than imported because scan-finalize pulls in @/lib/db
    // and @/lib/access — keep this unauthenticated route's module graph lean. The DEFAULT gate path
    // (?mock omitted → mock=true) is the DOCUMENTED deterministic rubric, not a degradation: !mock is
    // false there, so it keeps the exact 200-pass / 422-fail contract CI keys on.
    const degraded = report.engine.provider === "mock" && !mock;
    // Fail closed on degradation: force a non-2xx status (503 — the requested authoritative grade could
    // not be produced) so `curl --fail` trips and CI cannot merge on a floor score, even when the gate
    // math would "pass". Healthy scans (a real provider, or an explicit ?mock request) are untouched.
    // We still return the FULL verdict + an explicit `degraded: true` so a consumer that reads the body
    // knows why (and can retry), and always surface engine/confidence/warnings so any score — healthy or
    // degraded — is read in context (mirrors the web report's ReportNotices, which the machine path lacked).
    const status = degraded ? 503 : gate.pass ? 200 : 422;
    return NextResponse.json(
      {
        repo: `${ownerN}/${repoN}`,
        ref: ref ?? null,
        pass: gate.pass,
        degraded,
        level: report.level.id,
        overallScore: report.overallScore,
        posture: report.posture.id,
        archetype: report.archetype,
        policy: gate.policy,
        failures: gate.failures,
        // Degradation signals a CI consumer needs to trust — or distrust — the verdict:
        //   engine      — which grader actually produced it ("mock" = deterministic floor, not the AI grade);
        //   confidence  — 0..1 repo coverage (how much of the tree we could inspect);
        //   warnings    — non-fatal reliability caveats (LLM fallback, low coverage, skipped PR signals).
        // All three were omitted before, so no consumer could tell a degraded pass from a real one.
        engine: report.engine,
        confidence: report.confidence,
        warnings: report.warnings ?? [],
        // `error` is what a generic CI wrapper prints on a non-2xx (scripts/maturity-gate.mjs falls back
        // to "unknown" without it). A 503 with no explanation is as unactionable as the silent pass we
        // just removed, so say plainly what happened and that retrying is the right move.
        ...(degraded
          ? {
              error:
                "The AI grade could not be produced (the LLM provider was unavailable, so the scan fell back to the deterministic floor). This verdict is NOT authoritative — retry the gate.",
            }
          : {}),
      },
      { status },
    );
  } catch (err) {
    // Token-less ingest of a private (or missing) repo 404s. Say so plainly rather than reporting a
    // generic 500 the CI operator cannot act on — and point at the surface that CAN gate a private repo.
    // `status` is optional on GitHubError, so match the semantic code too.
    if (err instanceof GitHubError && (err.code === "NOT_FOUND" || err.status === 404)) {
      return NextResponse.json(
        {
          error:
            "Repository not found or not publicly readable. Private repositories are gated through the GitHub App check run, not this endpoint.",
        },
        { status: 404 },
      );
    }
    console.error("[gate] evaluation failed", err);
    return NextResponse.json({ error: "Failed to evaluate the maturity gate." }, { status: 500 });
  }
}
