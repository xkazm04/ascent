"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { ProviderName, ScanProgress, ScanReport } from "@/lib/types";
import { ReportView } from "@/components/report/ReportView";
import { ReportErrorBoundary } from "@/components/report/ReportErrorBoundary";
import { parseScanReport } from "@/lib/report/validate";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; report: ScanReport };

interface Progress {
  stage?: ScanProgress["stage"];
  message: string;
  pct: number;
  provider?: ProviderName;
  region?: string;
  fallback?: boolean;
}

function parseSSE(block: string): { event: string | null; data: unknown } {
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const raw of block.split("\n")) {
    // Tolerate CRLF: strip a trailing \r that a proxy may have left on the line.
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    // Per the SSE spec, multiple `data:` lines are JOINED WITH "\n" (with a single leading
    // space after the colon stripped). The old per-line trim()+concat corrupted multi-line
    // JSON; join with newlines so a pretty-printed payload still parses.
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  let data: unknown = null;
  try {
    data = dataLines.length ? JSON.parse(dataLines.join("\n")) : null;
  } catch {
    /* ignore malformed */
  }
  return { event, data };
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
      try {
        const res = await fetch("/api/scan/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: repo, fresh }),
          signal: controller.signal,
        });
        if (cancelled) return;
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          if (!cancelled) setState({ status: "error", message: data?.error ?? `Scan failed (${res.status}).` });
          return;
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
    return <Empty title="Couldn't scan that repo" message={state.message} repo={repo} />;
  }
  return (
    <ReportErrorBoundary>
      <ReportView report={state.report} onRetest={() => setRetestNonce((n) => n + 1)} />
    </ReportErrorBoundary>
  );
}

// Ordered scan stages, shown as a determinate-feeling checklist. The score step's label is
// provider-aware (resolved at render) so a multi-second wait reads as "Asking Gemini…" rather
// than a generic spinner.
const SCAN_STEPS: { stage: ScanProgress["stage"]; label: string }[] = [
  { stage: "fetch", label: "Reading repository metadata" },
  { stage: "tree", label: "Reading file tree & history" },
  { stage: "files", label: "Reading key files" },
  { stage: "analyze", label: "Analyzing 7 dimensions" },
  { stage: "score", label: "Scoring against the rubric" },
  { stage: "compose", label: "Composing your report" },
];

/** Provider-specific copy for the score step — sets honest expectations for the slower paths. */
function scoreLabel(provider?: ProviderName, region?: string): string {
  switch (provider) {
    case "gemini":
      return "Asking Gemini";
    case "claude-cli":
      return "Asking Claude";
    case "bedrock":
      return `Querying Bedrock in ${region ?? "us-east-1"}`;
    case "mock":
      return "Running deterministic rubric";
    default:
      return "Scoring against the rubric";
  }
}

function StepIcon({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "done") {
    return (
      <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-accent" fill="none">
        <path
          d="M3.5 8.5l3 3 6-7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  // Active = a gently pulsing dot (conveys "working" without a spinner fighting the skeleton
  // shimmer); pending = a hollow ring. Both sit in a fixed box so labels stay aligned.
  return (
    <span aria-hidden className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      <span
        className={
          state === "active"
            ? "h-2 w-2 animate-pulse rounded-full bg-accent"
            : "h-1.5 w-1.5 rounded-full border border-slate-700"
        }
      />
    </span>
  );
}

function Loading({ repo, progress }: { repo: string; progress: Progress }) {
  const done = progress.stage === "done";
  // Index of the stage in flight. -1 before the first frame ("Starting…") or on an unknown
  // stage — treat the first step as active then, so the checklist never reads as fully idle.
  const cur = done ? SCAN_STEPS.length : SCAN_STEPS.findIndex((s) => s.stage === progress.stage);
  const activeIdx = cur === -1 ? 0 : cur;

  const labelFor = (step: (typeof SCAN_STEPS)[number]) =>
    step.stage === "score"
      ? progress.fallback
        ? "Running deterministic rubric" // model bailed; we're on the mock path now
        : scoreLabel(progress.provider, progress.region)
      : step.label;

  // Headline mirrors the active step (provider-aware) so the big status line and the checklist
  // never disagree; falls back to the server message before any step resolves.
  const headline = done
    ? "Done"
    : SCAN_STEPS[activeIdx]
      ? `${labelFor(SCAN_STEPS[activeIdx])}…`
      : progress.message;

  return (
    <div
      className="mx-auto flex w-full max-w-md flex-col items-center py-20 text-center"
      data-testid="scan-loading"
    >
      <p className="font-mono text-sm text-slate-400">{repo}</p>
      {/* Polite live region so screen readers hear each phase change ("Asking Gemini…", "Done"). */}
      <p className="mt-2 min-h-[1.75rem] text-lg font-medium text-white" role="status" aria-live="polite">
        {headline}
      </p>

      <div
        className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-800"
        role="progressbar"
        aria-valuenow={progress.pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Scan progress"
      >
        <div
          className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
          style={{ width: `${Math.max(4, progress.pct)}%` }}
        />
      </div>
      <p className="mt-1.5 font-mono text-[11px] tabular-nums text-slate-600">{progress.pct}%</p>

      {/* Determinate-feeling staged checklist. */}
      <ul className="mt-6 w-full space-y-2 text-left">
        {SCAN_STEPS.map((step, i) => {
          const state = done || i < activeIdx ? "done" : i === activeIdx ? "active" : "pending";
          return (
            <li key={step.stage} className="flex items-center gap-3 font-mono text-xs">
              <StepIcon state={state} />
              <span
                className={
                  state === "done"
                    ? "text-slate-400"
                    : state === "active"
                      ? "text-white"
                      : "text-slate-600"
                }
              >
                {labelFor(step)}
                {state === "active" && <span className="text-slate-500">…</span>}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Calm fallback note: the model took too long, deterministic scores are on the way. Fades
          in via the shared animate-fade-up instead of a hard error. */}
      {progress.fallback && (
        <p
          className="animate-fade-up mt-5 flex items-center gap-2 text-sm text-amber-300/90"
          role="status"
        >
          <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none">
            <path
              d="M8 4v4l2.5 1.5M14 8A6 6 0 11 2 8a6 6 0 0112 0z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Model took too long — showing deterministic scores.
        </p>
      )}

      {/* Subtle skeleton of the report loading in — animate-pulse shimmer on slate-800 blocks. */}
      <div className="mt-8 w-full space-y-3" aria-hidden>
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 animate-pulse rounded-full bg-slate-800" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-slate-800" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-slate-800/70" />
          </div>
        </div>
        <div className="space-y-2 pt-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-3 w-20 animate-pulse rounded bg-slate-800/70" />
              <div className="h-2 flex-1 animate-pulse rounded-full bg-slate-800" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Empty({ title, message, repo }: { title: string; message: string; repo?: string }) {
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <div className="text-5xl">🧭</div>
      <h1 className="mt-4 text-2xl font-bold text-white">{title}</h1>
      <p className="mt-2 max-w-md text-slate-400">{message}</p>
      <div className="mt-6 flex gap-3">
        {repo && (
          <a
            href={`/report?repo=${encodeURIComponent(repo)}`}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-on-accent transition hover:bg-accent-soft"
          >
            Try again
          </a>
        )}
        <Link
          href="/"
          className="rounded-xl border border-slate-700 px-5 py-2.5 text-sm text-slate-300 hover:border-accent hover:text-white"
        >
          ← Back home
        </Link>
      </div>
    </div>
  );
}
