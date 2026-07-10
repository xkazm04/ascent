"use client";

// Per-row "Rescan" for the org repositories leaderboard. The scoped backend has existed since
// ORGD-3 — POST /api/org/scan accepts repos:[fullName] — but no UI ever called it, so the only
// in-dashboard option was "Scan all watched" (one credit per watched repo) and the "⚠ scan failed"
// chip had no retry. This closes the fix→rescan→score-moves loop in place: one click, one credit,
// this repo only. Mirrors OrgScanButton's SSE consumption (repo/error/skipped vocabulary) and
// ScheduleSelect's in-flight/disabled/inline-error presentation; refreshes the row on success.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { readSSE } from "@/lib/sse";

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
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function run() {
    setRunning(true);
    setOutcome(null);
    try {
      const res = await fetch("/api/org/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, repos: [fullName] }),
      });
      if (!res.ok || !res.body) {
        // The credit gate refuses up front with a machine-readable 402 — surface it as the
        // top-up moment it is, distinct from a scan failure.
        const d = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
        setOutcome(
          d?.code === "INSUFFICIENT_CREDITS"
            ? { kind: "credits", message: "Out of scan credits — top up to rescan." }
            : { kind: "error", message: d?.error ?? `Failed (${res.status}).` },
        );
        return;
      }
      // One repo in scope ⇒ at most one terminal `repo` event: scored (no error/skipped),
      // failed (`error`), or dropped mid-run when a concurrent batch won the last credit
      // (`skipped: "insufficient_credits"`). Stream-level `error` covers scope/setup refusals.
      let failed: string | null = null;
      let skipped = false;
      await readSSE(res.body, ({ event, data }) => {
        if (!data) return;
        if (event === "repo") {
          if (data.error) failed = String(data.error);
          else if (data.skipped) skipped = true;
        } else if (event === "error") failed = String(data.error ?? "Scan failed.");
      });
      if (skipped) setOutcome({ kind: "credits", message: "Skipped — out of scan credits." });
      else if (failed) setOutcome({ kind: "error", message: failed });
      else router.refresh(); // pull the fresh score/level/last-scan into the row
    } catch {
      setOutcome({ kind: "error", message: "Network error." });
    } finally {
      setRunning(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <button
        type="button"
        onClick={run}
        disabled={disabled || running}
        title={disabled ? disabledHint : `Rescan ${fullName} now — draws 1 credit (free if unchanged)`}
        aria-label={`Rescan ${fullName}`}
        className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running ? "Scanning…" : "↻ Rescan"}
      </button>
      {outcome && (
        <span
          title={outcome.message}
          className={`max-w-40 truncate font-mono text-sm ${outcome.kind === "credits" ? "text-warn" : "text-danger"}`}
        >
          {outcome.message}
        </span>
      )}
    </span>
  );
}
