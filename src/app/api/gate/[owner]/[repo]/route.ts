// GET /api/gate/:owner/:repo  ->  JSON gate result, with an HTTP status CI can branch on:
//   200 when the repo passes the maturity gate, 422 when it fails (so `curl --fail` exits non-zero).
// Honors the same policy query params as the gate badge:
//   ?min_level=L3&min_overall=60&min_dimension=40&no_ungoverned=1
// Runs a fast deterministic (mock) scan by default; pass ?mock=0 to score with the configured LLM.

import { NextResponse } from "next/server";
import type { ScanReport } from "@/lib/types";
import { scanRepository } from "@/lib/scan";
import { GitHubError } from "@/lib/github/source";
import { lookupPersistedScanByCommit, resolveHeadWithHint } from "@/lib/scan-cache";
import { cacheGet, cacheSet, makeCacheKey, normalizeRepoName } from "@/lib/cache";
import { evaluateGate, explicitPolicyFromParams, policyFromParams, tightenGatePolicy, type GatePolicy } from "@/lib/scoring/gate";
import { getOrgGatePolicy } from "@/lib/db/org-gate";
import { rateLimitRequest, rateLimitRequestShared, tooManyRequests, SCAN_RATE_LIMIT, GATE_RATE_LIMIT } from "@/lib/rate-limit";

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
  //  - A warm DB-TIER hit (see below) is classified with the warm MEMORY hit — also unthrottled. It
  //    spends no LLM budget and runs no GitHub ingest; it is one indexed, commit-pinned read. Throttling
  //    it would make the gate's throttle behavior depend on WHICH tier happened to answer, so the same
  //    PR could 429 on a cold instance and sail through on a warm one — exactly the nondeterminism the
  //    "a cache-hit gate is effectively free" contract exists to prevent. Only the branches that
  //    actually ingest from GitHub pay the limiter.
  if (!mock) {
    const rl = await rateLimitRequestShared(req, SCAN_RATE_LIMIT);
    if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  }
  // The degrade-to-mock predicate, hoisted so the CACHE-WRITE guard below and the honesty guard that
  // sets the 503 (further down) can never disagree about what "degraded" means. Same rule as
  // scan-finalize.ts's `classifyScanResult().degradedToMock`, inlined for the module-graph reason
  // documented there.
  const degradedToMock = (r: ScanReport) => r.engine.provider === "mock" && !mock;
  try {
    let report;
    if (ref) {
      // Ref-scoped: bypass the default-branch cache (keyed by the default head sha) and score the
      // requested ref directly.
      //
      // DB TIER FIRST (warm PR gates): when the ref IS an exact commit sha, the cross-instance
      // persistent cache is probed before any ingest. The GitHub App webhook has usually ALREADY
      // scanned and persisted this very sha by the time the Action's gate call lands, so a cold
      // serverless instance re-ingesting the whole repo is pure duplicated work. The correctness
      // contract ("a ?ref gate is always fresh FOR THIS REF") is preserved because the hit is pinned
      // to the SAME commit — same tree, same score — and is additionally gated on freshness +
      // persistedMatchesActiveIdentity, so a provider/model/rubric change still re-scans.
      // Only a 40-hex sha is probed: a branch/tag name is not a commit key, and resolving one would
      // cost the GitHub round-trip this fast path exists to avoid.
      const refSha = /^[0-9a-f]{40}$/i.test(ref) ? ref.toLowerCase() : null;
      const persisted = refSha
        ? await lookupPersistedScanByCommit({ owner: ownerN, repo: repoN, headSha: refSha, useLLM: !mock })
        : null;
      if (persisted) {
        // Warm hit — no ingest, no LLM spend, so no rate-limit charge (see the strategy note above).
        report = persisted;
      } else {
        // Miss → a full ingest from GitHub; throttle the default path here too (unchanged).
        if (mock) {
          const rl = rateLimitRequest(req, GATE_RATE_LIMIT);
          if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
        }
        report = await scanRepository(`${ownerN}/${repoN}`, { mock, ref, noAmbientToken: true });
      }
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
      // Tier 1: this instance's warm memory — always in front, it is the fastest possible answer.
      report = cacheGet(key);
      if (!report && sha) {
        // Tier 2: the cross-instance DB cache the scan flow already writes (lookupCachedScan's
        // persistent tier). A cold instance would otherwise re-ingest the entire repo for a commit
        // the webhook (or an earlier instance) already scored. Keyed on the EXACT resolved head sha
        // and the requested mode, behind the same freshness + scoring-identity guards, so this can
        // only ever return the report a fresh scan of this commit would reproduce. A DB hit warms
        // tier 1 for the next reader on this instance. Skipped when the head resolve failed (a
        // SHA-less key has no commit to pin a persisted row to).
        const persisted = await lookupPersistedScanByCommit({
          owner: ownerN,
          repo: repoN,
          headSha: sha,
          useLLM: !mock,
        });
        if (persisted) {
          cacheSet(key, persisted);
          report = persisted;
        }
      }
      if (!report) {
        // Both cache tiers missed → about to run a full GitHub ingest; throttle the default path
        // before spending it.
        if (mock) {
          const rl = rateLimitRequest(req, GATE_RATE_LIMIT);
          if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
        }
        report = await scanRepository(`${ownerN}/${repoN}`, { mock, noAmbientToken: true });
        // CACHE-POISONING GUARD: every OTHER cache writer in the codebase (scan-finalize.ts's
        // `authoritative` check) refuses to store a report that degraded to mock; this route was the
        // one writer without it. The key here is the ::llm key on the ?mock=0 path, so a single
        // transient provider outage cached the deterministic FLOOR as if it were the AI grade — and
        // because the degraded honesty guard below then 503s on exactly that report, the gate WEDGED:
        // every retry read the poisoned entry (never re-scanning) and got the same 503 telling it to
        // retry, for the full 15-minute TTL, long after the provider recovered. Skipping the write
        // costs one re-scan and makes "retry the gate" true again.
        if (!degradedToMock(report)) cacheSet(key, report);
      }
    }

    // Policy precedence (ci-gate-status-checks #2, hardened by ambiguity-ui 2026-07-16 ci-gate #1):
    // the org's PERSISTED gate policy — the SAME bar the App-mode Check Run + governance fleet view
    // enforce via getOrgGatePolicy — is the baseline whenever it exists; explicit query params then
    // merge ON TOP as a TIGHTEN-ONLY overlay (strictest field wins, see tightenGatePolicy). This
    // endpoint is unauthenticated, so a param must never WEAKEN or drop the configured org bar:
    // previously ANY single policy param (e.g. ?min_overall=60) replaced the whole persisted policy
    // with params + archetype defaults, silently shedding the org's D9 floor / protection rule and
    // letting an anonymous caller (or a PR author editing the workflow URL) pass ?min_dimension=1 for
    // a green verdict the org never configured. With no persisted policy (DB-less / unknown org)
    // params override the archetype default per-field, exactly as before.
    //
    // FAIL CLOSED on a READ ERROR (do not conflate it with "no policy configured"). The read used to
    // `.catch(() => null)`, so a transient DB blip silently dropped the org's whole configured bar back
    // to the archetype default — the ONE path in this module that failed OPEN, and on the exact control
    // every other guard here exists to protect (an incomplete scan fails, an unscored dimension fails, a
    // degraded grade 503s, a param can only tighten). A repo the real bar rejects could answer 200 for
    // the duration of the outage. `getOrgGatePolicy` returns null WITHOUT throwing when there is no DB
    // and when the org/column is unset, so a throw here means only one thing: we could not determine the
    // bar. Say that (503) rather than enforce a weaker one.
    let orgPolicy: GatePolicy | null;
    try {
      orgPolicy = await getOrgGatePolicy(ownerN);
    } catch (err) {
      console.error("[gate] org policy read failed — refusing to gate on the archetype default", err);
      return NextResponse.json(
        {
          repo: `${ownerN}/${repoN}`,
          ref: ref ?? null,
          error:
            "The organization's gate policy could not be read, so this gate would have fallen back to a weaker default bar. No verdict was produced — retry the gate.",
        },
        { status: 503 },
      );
    }
    const policy = orgPolicy
      ? tightenGatePolicy(orgPolicy, explicitPolicyFromParams(searchParams))
      : policyFromParams(searchParams, report.archetype);
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
    const degraded = degradedToMock(report);
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
