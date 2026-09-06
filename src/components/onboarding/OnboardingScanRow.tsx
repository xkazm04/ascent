import Link from "next/link";
import { ScorePill } from "@/components/LevelBadge";
import { skipRowLabel } from "@/components/onboarding/skipReason";
import type { LevelId } from "@/lib/types";

export interface ScanRow {
  repo: string;
  level?: LevelId;
  overall?: number;
  error?: string;
  /** Set when the server deferred this repo instead of scanning it — a terminal state distinct from
   *  "scanning…" and from an error. The reason is the server's own ("insufficient_credits",
   *  "monthly_quota", "in_progress") or the neutral "not_scanned"; each renders its OWN copy, because
   *  each has a different recovery (see skipReason.ts). */
  skipped?: string;
  /** The repo finished server-side but THIS client never saw its score — the state a re-attached run
   *  reports (GET /api/org/scan/queue is the scheduler's view: job states, no reports). Terminal, and
   *  rendered as a link to the report rather than with a fabricated level. */
  completed?: boolean;
}

/**
 * Direction 9 — whether an UNSETTLED row is being scanned right now or is still waiting its turn.
 *
 * The import route emits `send("repo", …)` only for a TERMINAL outcome (scored / errored / skipped):
 * there is no "started" frame, so in-flight is inferred from the route's own pool discipline
 * (`mapPool(fullNames, SCAN_CONCURRENCY, …)` takes items in index order, so the unsettled rows with
 * the lowest indices are the ones in the lanes). Omit the prop and the row keeps its old, undivided
 * "scanning…" label — which is what the re-attached surface passes, since a queue poll gives no
 * ordering to infer from.
 */
export type ScanRowState = "queued" | "active";

export function ScanRowView({
  row,
  onRetry,
  state,
}: {
  row: ScanRow;
  onRetry?: (repo: string) => void;
  state?: ScanRowState;
}) {
  const done = (row.level && typeof row.overall === "number") || row.completed;

  // The score pill needs a score. A re-attached row (completed, no level) is `done` without one, so
  // the badge is gated on the score itself rather than on `done`.
  const badge = row.level && typeof row.overall === "number" && (
    <ScorePill level={row.level as LevelId} overall={row.overall as number} className="px-1.5 py-0.5 type-mono-sm" />
  );

  // ONB-3: a completed scan is the payoff — let the user drill straight into the report it produced.
  // `row.repo` is the `owner/name` fullName, which is exactly the /report/[owner]/[repo] path.
  if (done && !row.error) {
    return (
      <Link
        href={`/report/${row.repo}?ref=onboarding`}
        className="group flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-2.5 transition hover:border-accent/50 hover:bg-slate-900/70"
        title={`Open the maturity report for ${row.repo}`}
      >
        <span className="flex-1 truncate font-mono type-body text-white">{row.repo}</span>
        <span
          className={`type-mono-sm text-accent transition ${
            // A re-attached row has no score to show, so its only affordance is the link — keep that
            // visible instead of hover-only, which would read as a dead row.
            row.completed && !row.level ? "" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          view report →
        </span>
        {badge}
      </Link>
    );
  }

  // The row currently in a scan lane was indistinguishable from the ones still queued — every
  // unsettled row said "scanning…", so a ten-repo run looked like ten stalled scans.
  const pending = !row.error && !row.skipped;
  const active = pending && state === "active";

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-4 py-2.5 ${
        active ? "border-accent/40 bg-accent/5" : "border-slate-800 bg-slate-900/40"
      }`}
    >
      {active && (
        // Live indicator. `motion-safe:` keeps the pulse out of a reduced-motion session; the dot and
        // the "scanning now" label carry the state on their own, so nothing is lost without it.
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-accent motion-safe:animate-pulse" />
      )}
      <span className="flex-1 truncate font-mono type-body text-white">{row.repo}</span>
      {row.error ? (
        <>
          <span className="type-body-sm text-danger">{row.error}</span>
          {/* A terminal error used to be DEAD red text: one failed row out of ten cost the user the
              whole wizard, because the only recovery ("Scan another") resets the run to step one.
              Retry re-runs just this repo through the same import path. */}
          {onRetry && (
            <button
              type="button"
              onClick={() => onRetry(row.repo)}
              aria-label={`Retry ${row.repo}`}
              className="focus-ring rounded-md border border-divider px-2.5 py-1 type-body-sm text-slate-300 transition hover:border-accent/50 hover:text-white"
            >
              Retry
            </button>
          )}
        </>
      ) : row.skipped ? (
        // Reason-specific: this used to read "skipped (out of credits)" for every skip, so a public
        // funnel run that exhausted its FREE monthly allowance — and a repo another tab was already
        // scanning — were both reported as a prepaid-balance problem.
        <span className="type-body-sm text-amber-300">{skipRowLabel(row.skipped)}</span>
      ) : active ? (
        <span className="type-body-sm text-accent">scanning now</span>
      ) : state === "queued" ? (
        <span className="type-body-sm text-slate-600">queued</span>
      ) : (
        <span className="type-body-sm text-slate-500">scanning…</span>
      )}
    </div>
  );
}
