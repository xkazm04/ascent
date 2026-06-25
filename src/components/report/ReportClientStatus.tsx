"use client";

// Status surfaces + SSE parsing for ReportClient: the loading checklist (provider-aware), the
// empty/error state, and the SSE frame parser. Split out of ReportClient so the client component
// stays focused on the scan lifecycle. The shared progress helpers (headline, elapsed clock,
// time-smoothed percentage) are exported so the in-place re-scan banner (ReportRescanBanner) reads
// identically to the full Loading view.

import { useEffect, useRef, useState } from "react";
import type { ProviderName, ScanProgress } from "@/lib/types";
import { EmptyState } from "@/components/EmptyState";
import { DIMENSIONS } from "@/lib/maturity/model";
import { expectationCopy, formatDuration, timeProgressPct } from "@/components/report/scanEstimate";

export interface Progress {
  stage?: ScanProgress["stage"];
  message: string;
  pct: number;
  provider?: ProviderName;
  region?: string;
  fallback?: boolean;
}

export function parseSSE(block: string): { event: string | null; data: unknown } {
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

// Ordered scan stages, shown as a determinate-feeling checklist. The score step's label is
// provider-aware (resolved at render) so a multi-second wait reads as "Asking Gemini…" rather
// than a generic spinner.
const SCAN_STEPS: { stage: ScanProgress["stage"]; label: string }[] = [
  { stage: "fetch", label: "Reading repository metadata" },
  { stage: "tree", label: "Reading file tree & history" },
  { stage: "files", label: "Reading key files" },
  { stage: "analyze", label: `Analyzing ${DIMENSIONS.length} dimensions` },
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

/** Label for a scan step — provider-aware (and fallback-aware) on the score step. */
function stepLabel(step: (typeof SCAN_STEPS)[number], progress: Progress): string {
  if (step.stage !== "score") return step.label;
  // model bailed → we're on the mock path now; else name the provider being queried.
  return progress.fallback ? "Running deterministic rubric" : scoreLabel(progress.provider, progress.region);
}

/** The stage in flight: `done`, plus the index of the active step. -1 (before the first frame or on
 *  an unknown stage) is treated as the first step, so the checklist never reads as fully idle. */
function activeStep(progress: Progress): { done: boolean; activeIdx: number } {
  const done = progress.stage === "done";
  const cur = done ? SCAN_STEPS.length : SCAN_STEPS.findIndex((s) => s.stage === progress.stage);
  return { done, activeIdx: cur === -1 ? 0 : cur };
}

/** Headline mirroring the active step (provider-aware) so the big status line and the checklist
 *  never disagree; falls back to the server message before any step resolves. */
export function progressHeadline(progress: Progress): string {
  const { done, activeIdx } = activeStep(progress);
  if (done) return "Done";
  const step = SCAN_STEPS[activeIdx];
  return step ? `${stepLabel(step, progress)}…` : progress.message;
}

/**
 * Mount-anchored elapsed-time clock in ms (ticks every 250ms). The clock starts at 0 (useState) and
 * is anchored on mount, so every host remounts per scan to reset it: Loading mounts/unmounts with the
 * loading phase, and the re-scan banner is keyed by attempt — no in-effect reset needed.
 */
export function useElapsed(): number {
  const startRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    startRef.current = Date.now();
    const id = setInterval(() => {
      if (startRef.current != null) setElapsedMs(Date.now() - startRef.current);
    }, 250);
    return () => clearInterval(id);
  }, []);
  return elapsedMs;
}

/**
 * Blend the server's stage percentage with a time-driven asymptotic curve via max(), so the bar
 * only ever moves forward: stage jumps win early, the time curve carries it through the long score
 * wait (where the server's stage percentage sits frozen). Snaps to 100 only when actually done.
 */
export function displayProgressPct(progress: Progress, elapsedMs: number, done = false): number {
  return done ? 100 : Math.max(Math.round(progress.pct), Math.round(timeProgressPct(elapsedMs)));
}

function StepIcon({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "done") {
    return (
      <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-accent" fill="none">
        <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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

export function Loading({ repo, progress }: { repo: string; progress: Progress }) {
  const { done, activeIdx } = activeStep(progress);
  // Elapsed clock + time-driven percentage keep the bar honestly moving through the multi-minute
  // score stage, where the server's stage percentage sits frozen (see scanEstimate.ts). Loading
  // mounts when the scan starts and unmounts when it resolves, so the mount-anchored clock measures
  // the whole scan (and a re-test remounts → resets).
  const elapsedMs = useElapsed();
  const displayPct = displayProgressPct(progress, elapsedMs, done);
  const headline = progressHeadline(progress);

  return (
    <div
      className="mx-auto flex w-full max-w-md flex-col items-center py-20 text-center"
      data-testid="scan-loading"
    >
      <p className="font-mono text-base text-slate-400">{repo}</p>
      {/* Polite live region so screen readers hear each phase change ("Asking Gemini…", "Done"). */}
      <p className="mt-2 min-h-[1.75rem] text-lg font-medium text-white" role="status" aria-live="polite">
        {headline}
      </p>

      <div
        className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-800"
        role="progressbar"
        aria-valuenow={displayPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Scan progress"
      >
        <div
          className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
          style={{ width: `${Math.max(4, displayPct)}%` }}
        />
      </div>
      {/* Elapsed clock · percentage. The clock is the honest signal during the multi-minute score
          stage; the percentage is time-smoothed so it advances rather than freezing. */}
      <p className="mt-1.5 flex items-center justify-center gap-2 font-mono text-sm tabular-nums text-slate-600">
        <span aria-label="Time elapsed">{formatDuration(elapsedMs)}</span>
        <span className="text-slate-700" aria-hidden>·</span>
        <span>{displayPct}%</span>
      </p>

      {/* Determinate-feeling staged checklist. */}
      <ul className="mt-6 w-full space-y-2 text-left">
        {SCAN_STEPS.map((step, i) => {
          const state = done || i < activeIdx ? "done" : i === activeIdx ? "active" : "pending";
          return (
            <li key={step.stage} className="flex items-center gap-3 font-mono text-sm">
              <StepIcon state={state} />
              <span
                className={
                  state === "done" ? "text-slate-400" : state === "active" ? "text-white" : "text-slate-600"
                }
              >
                {stepLabel(step, progress)}
                {state === "active" && <span className="text-slate-500">…</span>}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Honest time expectation — keyed off elapsed so it sets the "few minutes" expectation up
          front and owns it when a large repo runs long. Hidden once the model bailed (the fallback
          note below takes over). */}
      {!done && !progress.fallback && (
        <p className="mt-5 max-w-sm text-sm text-slate-500" role="status" aria-live="polite">
          {expectationCopy(elapsedMs)}
        </p>
      )}

      {/* Calm fallback note: the model took too long, deterministic scores are on the way. */}
      {progress.fallback && (
        <p className="animate-fade-up mt-5 flex items-center gap-2 text-base text-amber-300/90" role="status">
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
    </div>
  );
}

export function Empty({ title, message, repo }: { title: string; message: string; repo?: string }) {
  return (
    <EmptyState
      icon="🧭"
      title={title}
      body={message}
      actions={[
        ...(repo
          ? [{ label: "Try again", href: `/report?repo=${encodeURIComponent(repo)}`, primary: true }]
          : []),
        { label: "← Back home", href: "/" },
      ]}
    />
  );
}
