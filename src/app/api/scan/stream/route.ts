// POST /api/scan/stream  { url, mock?, installationId? }
// Server-Sent Events: emits `progress` events through the scan, then a `result` event
// with the final ScanReport (or an `error` event). Powers the live progress UI.

import { NextResponse } from "next/server";
import { GitHubError, parseRepoUrl } from "@/lib/github/source";
import { resolveScanAuth, scanRepository } from "@/lib/scan";
import { cacheSet } from "@/lib/cache";
import { lookupCachedScan, type ScanCacheLookup } from "@/lib/scan-cache";
import { isDbConfigured, persistScanReport } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    url?: string;
    mock?: boolean;
    installationId?: string;
    fresh?: boolean;
  };
  if (!body.url || typeof body.url !== "string") {
    return NextResponse.json({ error: "Missing 'url' in request body." }, { status: 400 });
  }

  const url = body.url;
  const mock = Boolean(body.mock);
  const fresh = Boolean(body.fresh);
  const parsed = parseRepoUrl(url);
  const { token, orgSlug } = await resolveScanAuth(parsed, body.installationId);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* controller closed */
        }
      };

      // Keepalive: the longest silent window is provider.assess() (between the score and
      // compose stages), which can run many seconds. Proxies/load balancers (and Vercel
      // buffering) drop idle SSE connections after ~30–60s, leaving the browser stuck mid-scan.
      // A periodic SSE comment line keeps the connection warm; it's ignored by EventSource.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: ping\n\n`));
        } catch {
          /* controller closed */
        }
      }, 15_000);

      try {
        // Conditional head lookup (free 304 when unchanged) pins the cache key to the current
        // commit, then probes the in-memory + persistent (cross-instance) caches — so an
        // unchanged repo streams instantly even on a cold instance. Only anonymous scans share
        // this public cache. A `fresh` re-test bypasses the cached report but still caches its
        // result. A failed head lookup degrades to a SHA-less best-effort key inside the helper.
        let lookup: ScanCacheLookup | null = null;
        if (parsed && !token) {
          lookup = await lookupCachedScan({ parsed, useLLM: !mock, orgSlug: "public", fresh });
          if (lookup.cached) {
            send("progress", {
              stage: "done",
              message: lookup.source === "db" ? "Loaded from a saved scan" : "Loaded from cache",
              pct: 100,
            });
            send("result", lookup.cached);
            return;
          }
        }

        const report = await scanRepository(url, {
          token,
          mock,
          onProgress: (p) => send("progress", p),
          // Pin the scored commit to the sha resolved for the cache key, so a push landing mid-scan
          // can't key the report under a different commit than it actually scored.
          headSha: lookup?.headSha ?? undefined,
          // Abort the scan (GitHub ingest + LLM) when the browser navigates away or aborts
          // the SSE stream, instead of running it to completion for a closed connection.
          signal: request.signal,
        });

        // A transient LLM failure degrades to MockProvider, but the lookup key is still the llm
        // key — caching it would pin the mock floor under `::llm` for the full TTL and serve it to
        // every later scanner of this commit. Skip caching a mock report when the LLM was requested.
        const degradedToMock = report.engine.provider === "mock" && !mock;
        if (lookup && !degradedToMock) cacheSet(lookup.cacheKey, report);
        if (isDbConfigured()) {
          try {
            // Persist the ETag so the next re-scan can issue a free conditional request.
            const persisted = await persistScanReport(report, { orgSlug, headEtag: lookup?.etag ?? undefined });
            if (persisted && (persisted.failures.audit || persisted.failures.contributors > 0)) {
              console.warn("[scan/stream] persisted with partial write failures", {
                repo: parsed ? `${parsed.owner}/${parsed.repo}` : url,
                scanId: persisted.scanId,
                auditFailed: persisted.failures.audit,
                contributorFailures: persisted.failures.contributors,
              });
            }
          } catch (err) {
            console.error("[scan/stream] persistence failed", err);
          }
        }
        send("result", report);
      } catch (err) {
        const payload =
          err instanceof GitHubError
            ? { error: err.message, code: err.code }
            : { error: "Unexpected error while scanning the repository." };
        send("error", payload);
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed — e.g. the client disconnected and the stream was torn down */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
