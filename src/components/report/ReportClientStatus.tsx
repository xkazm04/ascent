"use client";

// Status surfaces + SSE parsing for ReportClient: the loading checklist (provider-aware), the
// empty/error state, and the SSE frame parser. Split out of ReportClient so the client component
// stays focused on the scan lifecycle.

import type { ProviderName, ScanProgress } from "@/lib/types";
import { ReportSkeleton } from "@/components/report/ReportSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { DIMENSIONS } from "@/lib/maturity/model";

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

export function Loading({ repo, progress }: { repo: string; progress: Progress }) {
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
      <p className="font-mono text-base text-slate-400">{repo}</p>
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
      <p className="mt-1.5 font-mono text-sm tabular-nums text-slate-600">{progress.pct}%</p>

      {/* Determinate-feeling staged checklist. */}
      <ul className="mt-6 w-full space-y-2 text-left">
        {SCAN_STEPS.map((step, i) => {
          const state = done || i < activeIdx ? "done" : i === activeIdx ? "active" : "pending";
          return (
            <li key={step.stage} className="flex items-center gap-3 font-mono text-sm">
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
          className="animate-fade-up mt-5 flex items-center gap-2 text-base text-amber-300/90"
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

      {/* Subtle skeleton of the report loading in — shared with the route's Suspense fallback. */}
      <div className="mt-8 w-full">
        <ReportSkeleton />
      </div>
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
