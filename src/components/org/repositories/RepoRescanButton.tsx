"use client";

// Per-row "Rescan" for the org repositories leaderboard. The scoped backend has existed since
// ORGD-3 — POST /api/org/scan accepts repos:[fullName] — but no UI ever called it, so the only
// in-dashboard option was "Scan all watched" (one credit per watched repo) and the "⚠ scan failed"
// chip had no retry. This closes the fix→rescan→score-moves loop in place: one click, one credit,
// this repo only. Shares OrgScanButton's SSE transport (useScanStream) and its repo/error/skipped
// event vocabulary, but keeps ScheduleSelect's in-flight/disabled/inline-error presentation;
// refreshes the row on success.

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useScanStream } from "@/components/org/shared/useScanStream";

/** Terminal state of one rescan attempt — out-of-credits is a top-up nudge, not a failure. */
type Outcome = { kind: "credits" | "error"; message: string } | null;

export function RepoRescanButton({
  org,
  fullName,
  disabled,
  disabledHint,
}: {
  org: string;
  fullName: string;
  /** Disable the control (e.g. the GitHub App isn't configured, so the route would 503). */
  disabled?: boolean;
  disabledHint?: string;
}) {
  const router = useRouter();
  const startScan = useScanStream();
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const hintId = useId();
  // a11y (ambiguity-ui 2026-07-16 #5): a natively-disabled button leaves the tab order and `title`
  // is hover-only, so keyboard/SR users found a dead control with no reason. Keep it focusable with
  // aria-disabled + a click guard, and expose the reason via aria-describedby → sr-only hint.
  const inert = disabled || running;

  async function run() {
    if (inert) return;
    setRunning(true);
    setOutcome(null);
    // One repo in scope ⇒ at most one terminal `repo` event: scored (no error/skipped),
    // failed (`error`), or dropped mid-run when a concurrent batch won the last credit
    // (`skipped: "insufficient_credits"`). Stream-level `error` covers scope/setup refusals.
    let failed: string | null = null;
    let skipped = false;
    await startScan({
      body: { org, repos: [fullName] },
      // The credit gate refuses up front with a machine-readable 402 — surface it as the
      // top-up moment it is, distinct from a scan failure.
      onRefused: (d, status) =>
        setOutcome(
          d?.code === "INSUFFICIENT_CREDITS"
            ? { kind: "credits", message: "Out of scan credits — top up to rescan." }
            : { kind: "error", message: d?.error ?? `Failed (${status}).` },
        ),
      onMessage: ({ event, data }) => {
        if (!data) return;
        if (event === "repo") {
          if (data.error) failed = String(data.error);
          else if (data.skipped) skipped = true;
        } else if (event === "error") failed = String(data.error ?? "Scan failed.");
      },
      onStreamEnd: () => {
        if (skipped) setOutcome({ kind: "credits", message: "Skipped — out of scan credits." });
        else if (failed) setOutcome({ kind: "error", message: failed });
        else router.refresh(); // pull the fresh score/level/last-scan into the row
      },
      onNetworkError: () => setOutcome({ kind: "error", message: "Network error." }),
      onSettled: () => setRunning(false),
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <button
        type="button"
        onClick={run}
        aria-disabled={inert || undefined}
        title={disabled ? disabledHint : `Rescan ${fullName} now — draws 1 credit (free if unchanged)`}
        aria-label={`Rescan ${fullName}`}
        aria-describedby={disabled && disabledHint ? hintId : undefined}
        className={`rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 font-mono text-sm text-slate-300 transition focus:border-accent focus:outline-none ${
          inert ? "cursor-not-allowed opacity-50" : "hover:border-accent hover:text-white"
        }`}
      >
        {running ? "Scanning…" : "↻ Rescan"}
      </button>
      {disabled && disabledHint && (
        <span id={hintId} className="sr-only">
          {disabledHint}
        </span>
      )}
      {/* Announced outcome: an error interrupts (alert); the credits nudge is polite (status). */}
      {outcome && (
        <span
          role={outcome.kind === "error" ? "alert" : "status"}
          title={outcome.message}
          className={`max-w-40 truncate font-mono text-sm ${outcome.kind === "credits" ? "text-warn" : "text-danger"}`}
        >
          {outcome.message}
        </span>
      )}
    </span>
  );
}
