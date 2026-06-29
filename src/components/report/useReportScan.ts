import { useEffect, useRef, useState } from "react";
import type { ScanProgress, ScanReport } from "@/lib/types";
import { parseScanReport } from "@/lib/report/validate";
import { repoKey } from "@/components/report/repoKey";
import { SCAN_CLIENT_TIMEOUT_MS } from "@/components/report/scanEstimate";
import { classifyScanAbort } from "@/components/report/reportTaxonomy";
import { parseSSE } from "@/lib/sse";
import { type Progress } from "@/components/report/ReportClientStatus";
import { formatResetAt, type QuotaScope } from "@/components/report/QuotaNotice";

/** A report salvaged from the last persisted scan because the weekly quota blocked a fresh one. */
type Stale = { resetAt: number | null; scope: QuotaScope };

export type ScanState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string; blocked?: { scope: QuotaScope } }
  | { status: "done"; report: ScanReport; stale?: Stale };

/** Free weekly public-scan allowance surfaced from the x-ascent-quota-* response headers. */
export type Quota = { remaining: number; resetAt: number | null; scope: QuotaScope };

export interface ReportScan {
  state: ScanState;
  progress: Progress;
  quota: Quota | null;
  /** In-place re-scan status: `active` while a re-test runs with the report still mounted; `error`
   *  once it fails (the prior report stays — the banner offers retry/dismiss). */
  rescan: { active: boolean; error: string | null };
  /** Bumps once per re-test — used as the re-scan banner's `key` so its elapsed clock resets. */
  attempt: number;
  retest: () => void;
  dismissRescan: () => void;
}

/**
 * Drives a single repo's scan lifecycle for ReportClient: the idle→loading→done/error machine, live
 * SSE progress, the free-quota banner, and the IN-PLACE RE-SCAN.
 *
 * A "Re-test" on an already-rendered report (retestNonce > 0 with a report on screen) keeps that
 * report mounted and reports progress via `rescan` instead of blanking back to `loading` — so a
 * multi-minute re-scan never throws away the report the user is reading. On success the new report
 * swaps in; on failure the existing one is kept and the error surfaces in the banner. A first load of
 * a repo (no prior report) still uses the full Loading checklist.
 */
export function useReportScan(repo: string, initialFresh: boolean): ReportScan {
  const [state, setState] = useState<ScanState>({ status: "idle" });
  const [progress, setProgress] = useState<Progress>({ message: "Starting…", pct: 0 });
  // Set from the scan response headers when the free weekly public-scan gate counted this scan.
  const [quota, setQuota] = useState<Quota | null>(null);
  // Bumped by "Re-test" to re-run the scan in place; > 0 also implies fresh.
  const [retestNonce, setRetestNonce] = useState(0);
  const [rescan, setRescan] = useState<{ active: boolean; error: string | null }>({ active: false, error: null });
  // The report currently on screen, read at scan-start to decide whether a re-test can keep it mounted.
  const reportRef = useRef<ScanReport | null>(null);
  // `fresh` (a "Re-test" link, or a re-test below) forces a re-score that bypasses the report cache.
  const fresh = initialFresh || retestNonce > 0;

  useEffect(() => {
    if (state.status === "done") reportRef.current = state.report;
  }, [state]);

  useEffect(() => {
    if (!repo) return;
    // Canonical effect pattern: a per-run `cancelled` flag (NOT a persistent ref guard, which
    // deadlocks under React StrictMode's dev double-mount). The cleanup cancels this run; the next
    // mount re-runs.
    let cancelled = false;
    let timedOut = false;
    // A re-test (retestNonce bumped) while a report is already shown keeps that report visible and
    // surfaces progress through `rescan`; a first load blanks to the full Loading checklist.
    const rescanMode = retestNonce > 0 && reportRef.current != null;

    const controller = new AbortController();
    // Runaway backstop only — the scan normally resolves via its SSE `result` frame. Live AI scans
    // run for MINUTES, so SCAN_CLIENT_TIMEOUT_MS sits above the slowest scan; only a genuine hang trips it.
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, SCAN_CLIENT_TIMEOUT_MS);

    // Route a terminal outcome to the right surface: in rescan mode the existing report stays and the
    // banner updates; otherwise the page-level state machine drives Loading/error/done.
    const settleDone = (report: ScanReport, stale?: Stale) => {
      if (cancelled) return;
      setState({ status: "done", report, stale });
      setRescan({ active: false, error: null });
    };
    const settleError = (message: string, blocked?: { scope: QuotaScope }) => {
      if (cancelled) return;
      if (rescanMode) setRescan({ active: false, error: message });
      else setState({ status: "error", message, blocked });
    };

    (async () => {
      if (rescanMode) setRescan({ active: true, error: null });
      else setState({ status: "loading" });
      setProgress({ message: "Starting…", pct: 0 });
      setQuota(null);

      // Fast path: hydrate instantly from a persisted snapshot of the repo's current head before
      // opening a live SSE scan. A fresh re-test skips the peek. On a peek MISS the server hands back
      // the head sha/etag it resolved; forward them so the stream skips a duplicate head lookup.
      let peekHead: { headSha: string; headEtag: string | null } | null = null;
      if (!fresh) {
        try {
          const peek = await fetch(`/api/scan?url=${encodeURIComponent(repo)}&peek=1`, { signal: controller.signal });
          if (cancelled) return;
          if (peek.status === 200) {
            const parsed = parseScanReport(await peek.json().catch(() => null));
            if (cancelled) return;
            // Verify the peeked report is actually for the repo we asked about before rendering it.
            const reqKey = repoKey(repo);
            const gotKey = parsed.ok
              ? `${parsed.report.repo.owner}/${parsed.report.repo.name}`.toLowerCase()
              : "";
            if (parsed.ok && gotKey === reqKey) {
              settleDone(parsed.report);
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
          // dead-end, SALVAGE: serve a persisted report of this repo (peek=1&latest=1 never scans)
          // with a stale notice; only when nothing is saved does the full blocked state remain.
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
                const gotKey = parsed.ok
                  ? `${parsed.report.repo.owner}/${parsed.report.repo.name}`.toLowerCase()
                  : "";
                if (parsed.ok && gotKey === repoKey(repo)) {
                  settleDone(parsed.report, { resetAt, scope });
                  return;
                }
              }
            } catch {
              if (cancelled) return;
              // Salvage peek failed — fall through to the blocked wall below.
            }
            settleError(
              data.error ??
                `You've used all your free public scans for this week. The limit resets ${formatResetAt(resetAt)}.`,
              { scope },
            );
          } else {
            settleError(data?.error ?? `Scan failed (${res.status}).`);
          }
          return;
        }

        // Surface the free weekly allowance left (headers present only on counted public scans).
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

        // Dispatch one complete SSE frame. The `result` payload is validated at this trust boundary
        // (parseScanReport) so a malformed/truncated body becomes a clean error, not a render crash.
        const handleFrame = (block: string) => {
          // Single shared parser (@/lib/sse). Its `data` is typed Record|null for the org consumers;
          // widen to `unknown` here so this consumer's value-shaped frames (a number, the report
          // object, an error bag) keep their existing trust-boundary casts.
          const frame = parseSSE(block);
          const event = frame.event;
          const data: unknown = frame.data;
          if (cancelled || !event) return;
          if (event === "progress") {
            const p = (data ?? {}) as Partial<ScanProgress>;
            // provider/region/fallback are sticky: a later frame omits them, but the UI keeps showing
            // which model ran and the fallback note once seen.
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
            if (parsed.ok) settleDone(parsed.report);
            else settleError(parsed.error);
          } else if (event === "error") {
            settled = true;
            settleError((data as { error?: string })?.error ?? "Scan failed.");
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
            // Flush bytes still pending in the decoder, drain complete frames, then process any
            // trailing frame written WITHOUT a terminating blank line — the `result` event sent right
            // before close, which the old loop dropped (falling through to "ended unexpectedly").
            buffer += decoder.decode();
            drainFrames();
            const tail = buffer.trim();
            if (!settled && tail.length > 0) handleFrame(tail);
            break;
          }
          drainFrames();
          if (settled) break;
        }
        if (!cancelled && !settled) settleError("The scan ended unexpectedly.");
      } catch (e) {
        if (cancelled) return;
        // Map the thrown error into the message taxonomy: an AbortError from the timeout → "timed
        // out"; a non-timeout abort → "interrupted"; anything else → "network".
        const kind = classifyScanAbort({ name: (e as Error).name, timedOut, cancelled });
        if (kind === "timeout") settleError("The scan timed out. Try again, or try a smaller repository.");
        else if (kind === "interrupted") settleError("The scan was interrupted. Please try again.");
        else if (kind === "network") settleError("Network error while scanning.");
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

  return {
    state,
    progress,
    quota,
    rescan,
    attempt: retestNonce,
    retest: () => setRetestNonce((n) => n + 1),
    dismissRescan: () => setRescan({ active: false, error: null }),
  };
}
