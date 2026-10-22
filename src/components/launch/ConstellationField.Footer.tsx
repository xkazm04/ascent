"use client";

import Link from "next/link";
import type { FleetScanOutcome } from "./fleetScanOutcomeModel";
import type { Constellation } from "./fleetMapStars";

const ACTION_CLASS =
  "shrink-0 rounded-md border border-accent/50 bg-accent/10 px-2 py-0.5 type-mono-sm font-medium text-white transition hover:bg-accent/20";

/** The outcome's ONE remedy: retry exactly the failures, add credits, or reconnect the GitHub App. */
function OutcomeAction({ outcome, login, onRetryFailed }: { outcome: FleetScanOutcome; login: string; onRetryFailed?: () => void }) {
  const a = outcome.action;
  if (!a) return null;
  if (a.kind === "retry") {
    if (!onRetryFailed || outcome.retryScope.repos.length === 0) return null;
    return (
      <button type="button" onClick={onRetryFailed} title={a.label} aria-label={`${a.label} in ${login}`} className={ACTION_CLASS}>
        {a.label}
      </button>
    );
  }
  return (
    <Link href={a.href} className={ACTION_CLASS}>
      {a.kind === "credits" ? "Add credits" : "Reconnect"}
    </Link>
  );
}

/** The card's bottom line: the load error (with Retry), else the scan's answer, else the overflow count. */
export function ConstellationFooter({
  c,
  overflow,
  onRetry,
  scanError,
  scanOutcome,
  onRetryFailed,
}: {
  c: Constellation;
  overflow: number;
  onRetry?: (installationId: number) => void;
  scanError?: string;
  scanOutcome?: FleetScanOutcome;
  onRetryFailed?: () => void;
}) {
  const said = scanOutcome && scanOutcome.message ? scanOutcome : undefined;
  return (
    <div className="mt-3 flex items-center justify-between gap-2 type-body-sm">
      {c.status === "error" ? (
        <span className="flex min-w-0 items-center gap-2 text-amber-400/80">
          <span className="min-w-0 truncate">{c.message}</span>
          {onRetry && (
            <button
              type="button"
              onClick={() => onRetry(c.id)}
              title={`Retry loading ${c.login}'s repositories`}
              aria-label={`Retry ${c.login}`}
              className={ACTION_CLASS}
            >
              Retry
            </button>
          )}
        </span>
      ) : scanError ? (
        <span role="alert" className="text-amber-400/80">{scanError}</span>
      ) : said ? (
        // A queued tail is owed work, not a failure: polite status, slate tone. Everything else that
        // carries a sentence (refusal, failure, partial, empty) is an alert in amber, as before.
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            role={said.kind === "queued" ? "status" : "alert"}
            className={said.kind === "queued" ? "text-slate-400" : "text-amber-400/80"}
          >
            {said.message}
          </span>
          <OutcomeAction outcome={said} login={c.login} onRetryFailed={onRetryFailed} />
        </span>
      ) : (
        <span className="text-slate-500">{overflow > 0 ? `+${overflow} more stars` : " "}</span>
      )}
      <Link
        href={`/org/${encodeURIComponent(c.login)}`}
        className="shrink-0 font-mono uppercase tracking-widest text-accent hover:text-accent-soft"
      >
        open →
      </Link>
    </div>
  );
}
