"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { ScanProgress, ScanReport } from "@/lib/types";
import { ReportView } from "@/components/report/ReportView";
import { ReportErrorBoundary } from "@/components/report/ReportErrorBoundary";
import { parseScanReport } from "@/lib/report/validate";
import { Empty, Loading, parseSSE, type Progress } from "@/components/report/ReportClientStatus";
import {
  QuotaBanner,
  QuotaBlocked,
  QuotaStaleNotice,
  formatResetAt,
  type QuotaScope,
} from "@/components/report/QuotaNotice";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string; blocked?: { scope: QuotaScope } }
  // `stale` marks a report salvaged from the last persisted scan because the weekly quota blocked
  // a fresh one — rendered with the warn-tinted stale notice instead of the regular quota banner.
  | { status: "done"; report: ScanReport; stale?: { resetAt: number | null; scope: QuotaScope } };

/** Free weekly public-scan allowance surfaced from the x-ascent-quota-* response headers. */
type Quota = { remaining: number; resetAt: number | null; scope: QuotaScope };

/** Canonical `owner/repo` key for comparing what we asked for against what a peek returned. */
function repoKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/^github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/^\/+|\/+$/g, "");
}

export function ReportClient({ repo: repoProp }: { repo?: string } = {}) {
  const params = useSearchParams();
  const repo = repoProp ?? params.get("repo") ?? "";
  // `fresh=1` (from a "Re-test" link, or a manual re-test below) forces a re-score that bypasses
  // the report cache. The ingestion layer still issues conditional requests, so an unchanged repo
  // stays cheap on the wire.
  const initialFresh = params.get("fresh") === "1" || params.get("fresh") === "true";
  const [state, setState] = useState<State>({ status: "idle" });
  const [progress, setProgress] = useState<Progress>({ message: "Starting…", pct: 0 });
  // Set from the scan response headers when the free weekly public-scan gate counted this scan.
  const [quota, setQuota] = useState<Quota | null>(null);
  // Bumped by the report's "Re-test" button to re-run the scan in place; > 0 also implies fresh.
  const [retestNonce, setRetestNonce] = useState(0);
  const fresh = initialFresh || retestNonce > 0;

  useEffect(() => {
    if (!repo) return;
    // Canonical effect pattern: a per-run `cancelled` flag (NOT a persistent ref guard,
    // which deadlocks under React StrictMode's dev double-mount and leaves the scan
    // stuck until a manual refresh). The cleanup cancels this run; the next mount re-runs.
    let cancelled = false;
    let timedOut = false;

    const controller = new AbortController();
    // Generous: live LLM scans (claude-cli/Bedrock) on big repos can take a couple minutes.
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 180_000);

    (async () => {
      setState({ status: "loading" });
      setProgress({ message: "Starting…", pct: 0 });
      setQuota(null);

      // Fast path: hydrate instantly from a persisted/in-memory snapshot of the repo's current head
      // before opening a live SSE scan. A non-fresh /report?repo= visit used to ALWAYS stream a full
      // re-score even when an identical report already existed for this commit. Peek the cache-only
      // endpoint; on a hit render immediately, on a miss (204) or any error fall through to the
      // streaming scan. A fresh=1 re-test (or the in-place "Re-test" button) skips the peek.
      // On a peek MISS the server hands back the head sha/etag it just resolved; forward them to
      // the stream so it skips a duplicate head lookup instead of re-resolving from scratch.
      let peekHead: { headSha: string; headEtag: string | null } | null = null;
      if (!fresh) {
        try {
          const peek = await fetch(`/api/scan?url=${encodeURIComponent(repo)}&peek=1`, {
            signal: controller.signal,
          });
          if (cancelled) return;
          if (peek.status === 200) {
            const parsed = parseScanReport(await peek.json().catch(() => null));
            if (cancelled) return;
            // Verify the peeked report is actually for the repo we asked about before rendering it:
            // a stale/colliding cache entry on the ?peek= path could otherwise show another repo's
            // report. On mismatch fall through to a fresh streaming scan (which re-resolves).
            const reqKey = repoKey(repo);
            const gotKey = parsed.ok
              ? `${parsed.report.repo.owner}/${parsed.report.repo.name}`.toLowerCase()
              : "";
            if (parsed.ok && gotKey === reqKey) {
              setState({ status: "done", report: parsed.report });
              clearTimeout(timeout);
              return;
            }
          }
          const hs = peek.headers.get("x-ascent-head-sha");
          if (hs) peekHead = { headSha: hs, headEtag: peek.headers.get("x-ascent-head-etag") };
        } catch {
          if (cancelled) return;
          // Peek failed (offline, abort, etc.) — fall through to the streaming scan below.
        }
      }

      try {
        const res = await fetch("/api/scan/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: repo, fresh, ...(peekHead ?? {}) }),
          signal: controller.signal,
        });
        if (cancelled) return;
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => null)) as
            | { error?: string; code?: string; resetAt?: number; scope?: QuotaScope }
            | null;
          if (cancelled) return;
          // Weekly public-scan gate tripped — an immediate retry can't succeed. Before showing a
          // dead-end wall, SALVAGE: the product may already hold a persisted report of this repo
          // from an earlier commit (`peek=1&latest=1` is cache-only — it never scans). Serving it
          // with a stale+quota notice keeps the answer the user came for at zero LLM/GitHub cost;
          // only when nothing is saved (204) does the full blocked state remain.
          if (res.status === 429 && data?.code === "weekly_quota") {
            const scope: QuotaScope = data.scope === "user" ? "user" : "anon";
            const resetAt = data.resetAt ?? null;
            try {
              const peek = await fetch(`/api/scan?url=${encodeURIComponent(repo)}&peek=1&latest=1`, {
                signal: controller.signal,
              });
              if (cancelled) return;
              if (peek.status === 200 && peek.headers.get("x-ascent-stale") === "true") {
                const parsed = parseScanReport(await peek.json().catch(() => null));
                if (cancelled) return;
                // Same identity check as the fast-path peek: never render another repo's report.
                const gotKey = parsed.ok
                  ? `${parsed.report.repo.owner}/${parsed.report.repo.name}`.toLowerCase()
                  : "";
                if (parsed.ok && gotKey === repoKey(repo)) {
                  setState({ status: "done", report: parsed.report, stale: { resetAt, scope } });
                  return;
                }
              }
            } catch {
              if (cancelled) return;
              // Salvage peek failed — fall through to the blocked wall below.
            }
            setState({
              status: "error",
              message: data.error ?? `You've used all your free public scans for this week. The limit resets ${formatResetAt(resetAt)}.`,
              blocked: { scope },
            });
          } else {
            setState({ status: "error", message: data?.error ?? `Scan failed (${res.status}).` });
          }
          return;
        }

        // Surface the free weekly allowance left (headers present only on public scans the gate
        // counted), shown as a quiet banner above the finished report.
        const remainingRaw = res.headers.get("x-ascent-quota-remaining");
        if (remainingRaw !== null) {
          const resetRaw = res.headers.get("x-ascent-quota-reset");
          const scope = res.headers.get("x-ascent-quota-scope") === "user" ? "user" : "anon";
          setQuota({ remaining: Number(remainingRaw), resetAt: resetRaw ? Number(resetRaw) : null, scope });
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let settled = false;

        // Dispatch one complete SSE frame. The `result` payload is validated at this trust
        // boundary (parseScanReport) so a malformed/truncated body becomes a clean error
        // instead of a render-time crash downstream.
        const handleFrame = (block: string) => {
          const { event, data } = parseSSE(block);
          if (cancelled || !event) return;
          if (event === "progress") {
            const p = (data ?? {}) as Partial<ScanProgress>;
            // provider/region/fallback are sticky: a later frame (compose/done) omits them,
            // but the UI should keep showing which model ran and the fallback note once seen.
            setProgress((prev) => ({
              stage: p.stage ?? prev.stage,
              message: p.message ?? "Working…",
              pct: p.pct ?? prev.pct,
              provider: p.provider ?? prev.provider,
              region: p.region ?? prev.region,
              fallback: p.fallback || prev.fallback,
            }));
          } else if (event === "result") {
            settled = true;
            const parsed = parseScanReport(data);
            if (parsed.ok) setState({ status: "done", report: parsed.report });
            else setState({ status: "error", message: parsed.error });
          } else if (event === "error") {
            settled = true;
            setState({ status: "error", message: (data as { error?: string })?.error ?? "Scan failed." });
          }
        };

        // Frame boundary is a blank line — tolerate both \n\n and CRLF \r\n\r\n.
        const FRAME = /\r?\n\r?\n/;
        const drainFrames = () => {
          let m: RegExpExecArray | null;
          while (!settled && (m = FRAME.exec(buffer))) {
            const block = buffer.slice(0, m.index);
            buffer = buffer.slice(m.index + m[0].length);
            if (block.length > 0) handleFrame(block);
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (cancelled) break;
          if (value) buffer += decoder.decode(value, { stream: true });
          if (done) {
            // Flush bytes still pending in the decoder, drain complete frames, then process
            // any trailing frame the server wrote WITHOUT a terminating blank line — that's
            // exactly the `result` event sent right before close, which the old loop dropped
            // (falling through to "ended unexpectedly" on perfectly good scans).
            buffer += decoder.decode();
            drainFrames();
            const tail = buffer.trim();
            if (!settled && tail.length > 0) handleFrame(tail);
            break;
          }
          drainFrames();
          if (settled) break;
        }
        if (!cancelled && !settled) setState({ status: "error", message: "The scan ended unexpectedly." });
      } catch (e) {
        if (cancelled) return;
        if ((e as Error).name === "AbortError") {
          if (timedOut) {
            setState({ status: "error", message: "The scan timed out. Try again, or try a smaller repository." });
          } else {
            // A non-timeout abort that isn't an intentional unmount (cancelled is false by here) —
            // e.g. a connection reset — would otherwise leave the checklist spinning forever.
            setState({ status: "error", message: "The scan was interrupted. Please try again." });
          }
        } else {
          setState({ status: "error", message: "Network error while scanning." });
        }
      } finally {
        clearTimeout(timeout);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [repo, fresh, retestNonce]);

  if (!repo) {
    return <Empty title="No repository specified" message="Head back and enter a GitHub repo to scan." />;
  }
  if (state.status === "loading" || state.status === "idle") {
    return <Loading repo={repo} progress={progress} />;
  }
  if (state.status === "error") {
    return state.blocked ? (
      <QuotaBlocked
        message={state.message}
        scope={state.blocked.scope}
        signInNext={`/report?repo=${encodeURIComponent(repo)}`}
      />
    ) : (
      <Empty title="Couldn't scan that repo" message={state.message} repo={repo} />
    );
  }
  return (
    <ReportErrorBoundary>
      {state.stale ? (
        <QuotaStaleNotice
          scannedAt={state.report.scannedAt}
          resetAt={state.stale.resetAt}
          scope={state.stale.scope}
          signInNext={`/report?repo=${encodeURIComponent(repo)}`}
        />
      ) : (
        quota && (
          <QuotaBanner
            remaining={quota.remaining}
            resetAt={quota.resetAt}
            scope={quota.scope}
            signInNext={`/report?repo=${encodeURIComponent(repo)}`}
          />
        )
      )}
      <ReportView report={state.report} onRetest={() => setRetestNonce((n) => n + 1)} />
    </ReportErrorBoundary>
  );
}
