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
import { rateLimitRequest, tooManyRequests, SCAN_RATE_LIMIT } from "@/lib/rate-limit";

// Query params that select/override the gate policy. When ANY is present the caller is explicitly
// driving the policy, so params win; when NONE is present we honor the owner's saved org policy (the
// documented README-badge / `curl --fail` CI path, which passes no params) instead of silently
// falling back to the archetype default.
const GATE_POLICY_PARAMS = [
  "min_level",
  "min_overall",
  "min_dimension",
  "no_ungoverned",
  "require_protection",
  "security",
  "min_security",
] as const;

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
  // Rate-limit the paths that spend real budget OR bypass the cache:
  //   • the real-LLM path (?mock=0) — every uncached scan is an LLM completion ($); and
  //   • any ref-scoped scan (?ref=…) — a ref bypasses the per-commit cache (see below), so an
  //     attacker spamming ?ref=<unique> forces a fresh GitHub ingest on the shared GITHUB_TOKEN every
  //     call, an unbounded unauthenticated cost/quota-amplification DoS.
  // The default no-ref mock gate stays unthrottled for CI: it shares the per-commit cache, so repeated
  // calls for the same repo are free after the first (cache-bounded, not amplifiable).
  if (!mock || ref) {
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
      // Probe ONLY the mode that was requested. The old `cacheGet(llmKey) ?? cacheGet(mockKey)` read the
      // LLM entry first regardless of mode, so a default (mock=true) CI gate could return a STOCHASTIC
      // LLM verdict — a PR flipping pass↔fail between runs with identical code, purely from which scan
      // populated the cache first. Read and write the same key (useLLM = !mock) so the default gate is
      // deterministic and reproducible, matching the verdict's stated provider.
      const key = makeCacheKey(ownerN, repoN, !mock, sha);
      report = cacheGet(key);
      if (!report) {
        report = await scanRepository(`${ownerN}/${repoN}`, { mock });
        cacheSet(key, report);
      }
    }

    // Resolve the policy to enforce. Explicit query params always take precedence (the caller is
    // driving the gate). With NO policy params — the documented badge/`curl --fail` CI invocation —
    // honor the owner's SAVED org gate policy so a configured security floor (e.g. D9≥70) is actually
    // enforced here, not just on the App-mode Check Run. The org slug is the repo owner (parity with
    // the webhook's getOrgGatePolicy(owner)); best-effort + no-op-safe (null without a DB / unknown
    // org), falling back to the archetype default exactly as before.
    let policy;
    if (GATE_POLICY_PARAMS.some((k) => searchParams.has(k))) {
      policy = policyFromParams(searchParams, report.archetype);
    } else {
      const savedPolicy = await getOrgGatePolicy(ownerN).catch(() => null);
      policy = savedPolicy ?? policyFromParams(searchParams, report.archetype);
    }
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
