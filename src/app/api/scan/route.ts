// POST /api/scan  { url, token?, mock?, installationId? }  ->  ScanReport
// GET  /api/scan?url=...&mock=1                              ->  ScanReport
//
// Private repos: pass an `installationId` (from the GitHub App), or — if the repo owner
// already has an installation stored — it's resolved automatically. Installation scans
// are persisted under that owner's org (private => billable in usage metering).

import { NextResponse } from "next/server";
import { GitHubError, parseRepoUrl } from "@/lib/github/source";
import { resolveScanAuth, scanRepository } from "@/lib/scan";
import { cacheSet } from "@/lib/cache";
import { lookupCachedScan, type ScanCacheLookup } from "@/lib/scan-cache";
import { isDbConfigured, persistScanReport } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const STATUS: Record<GitHubError["code"], number> = {
  INVALID_URL: 400,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  EMPTY: 422,
  UPSTREAM: 502,
};

async function runScan(
  url: string,
  opts: { token?: string; mock: boolean; installationId?: string; fresh?: boolean; signal?: AbortSignal },
) {
  const parsed = parseRepoUrl(url);

  // GitHub App installation token takes precedence over any explicit body token.
  let token = opts.token;
  let orgSlug = "public";
  if (!token) {
    const resolved = await resolveScanAuth(parsed, opts.installationId);
    token = resolved.token;
    orgSlug = resolved.orgSlug;
  }

  // Only cache anonymous (tokenless) scans — installation scans are per-tenant. The shared
  // lookup issues a CONDITIONAL head request (free 304 when unchanged), pins the cache key to
  // the resolved commit, then probes the in-memory + persistent (cross-instance) caches. A
  // `fresh` re-test skips the cached report but still resolves the key/ETag for the re-run.
  let lookup: ScanCacheLookup | null = null;
  if (parsed && !token) {
    lookup = await lookupCachedScan({ parsed, useLLM: !opts.mock, orgSlug: "public", fresh: opts.fresh });
    if (lookup.cached) {
      return NextResponse.json(lookup.cached, {
        headers: { "x-ascent-cache": lookup.source === "db" ? "hit-db" : "hit" },
      });
    }
  }

  // Pass the head sha resolved for the cache key so the scored commit matches the key (no SHA
  // drift if a push lands mid-scan). Null/SHA-less lookups pass undefined → default behavior.
  const report = await scanRepository(url, {
    token,
    mock: opts.mock,
    signal: opts.signal,
    headSha: lookup?.headSha ?? undefined,
  });
  // Don't poison the shared `::llm` cache entry with a deterministic mock report produced by a
  // transient LLM failure: a single Gemini timeout/429 degrades to MockProvider, but the lookup
  // key is still the llm key, so caching it would pin the mock floor under `owner/repo@sha::llm`
  // for the full TTL and serve it to every later scanner of this commit. Cache only when the
  // report came from the requested engine (an intentional mock scan legitimately keys `::mock`).
  const degradedToMock = report.engine.provider === "mock" && !opts.mock;
  if (lookup && !degradedToMock) cacheSet(lookup.cacheKey, report);

  let deduped = false;
  if (isDbConfigured()) {
    try {
      // Persist the conditional-request ETag alongside the scan so the next re-scan stays cheap.
      const persisted = await persistScanReport(report, { orgSlug, headEtag: lookup?.etag ?? undefined });
      deduped = persisted?.deduped ?? false;
      if (persisted && (persisted.failures.audit || persisted.failures.contributors > 0)) {
        console.warn("[scan] persisted with partial write failures", {
          repo: parsed ? `${parsed.owner}/${parsed.repo}` : url,
          scanId: persisted.scanId,
          auditFailed: persisted.failures.audit,
          contributorFailures: persisted.failures.contributors,
        });
      }
    } catch (err) {
      console.error("[scan] persistence failed", err);
    }
  }

  // x-ascent-dedup: "hit" means this commit was already scored, so no new row was
  // written and no extra usage was billed (the report reflects the existing snapshot).
  return NextResponse.json(report, {
    headers: { "x-ascent-cache": "miss", "x-ascent-dedup": deduped ? "hit" : "miss" },
  });
}

function handleError(err: unknown) {
  if (err instanceof GitHubError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: STATUS[err.code] ?? 500 },
    );
  }
  // Client disconnected mid-scan — the scan aborted as intended (no work wasted), and no one is
  // waiting on this response. Don't log it as an unexpected failure. (499 = client closed request.)
  if (err instanceof Error && err.name === "AbortError") {
    return new NextResponse(null, { status: 499 });
  }
  console.error("[scan] unexpected error", err);
  return NextResponse.json(
    { error: "Unexpected error while scanning the repository." },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      url?: string;
      token?: string;
      mock?: boolean;
      installationId?: string;
      fresh?: boolean;
    };
    if (!body.url || typeof body.url !== "string") {
      return NextResponse.json({ error: "Missing 'url' in request body." }, { status: 400 });
    }
    return await runScan(body.url, {
      token: body.token,
      mock: Boolean(body.mock),
      installationId: body.installationId,
      fresh: Boolean(body.fresh),
      signal: request.signal,
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url");
    if (!url) {
      return NextResponse.json({ error: "Missing 'url' query parameter." }, { status: 400 });
    }
    const mock = searchParams.get("mock") === "1" || searchParams.get("mock") === "true";
    const installationId = searchParams.get("installation_id") ?? undefined;
    const fresh = searchParams.get("fresh") === "1" || searchParams.get("fresh") === "true";
    return await runScan(url, { mock, installationId, fresh, signal: request.signal });
  } catch (err) {
    return handleError(err);
  }
}
