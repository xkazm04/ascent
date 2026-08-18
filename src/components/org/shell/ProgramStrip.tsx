// The transition-programme strip (W1c) — one line, on every org tab, saying where the org is IN
// something rather than only where its fleet stands.
//
// Mounted in the shell layout under OrgHeader, so it survives tab navigation. Renders NOTHING when
// the org has no programme: the invitation to start one belongs in the onboarding companion (the
// getting-started `program` step), not in a banner every member has to dismiss on every page.
//
// WHAT IT REFUSES TO SAY. Each segment is independently conditional, and absence is the honest
// rendering of every unknown:
//   - movement vs the frozen baseline appears only when BOTH ends exist (a programme started before
//     the org's first scan has no origin, and "+58 since nothing" is not a measurement);
//   - "N pts bought" appears only when the Impact Ledger has VERIFIED points behind it — this is the
//     W1d gate applied to the strip, and the reason 1c was sequenced after 1d;
//   - "next review" disappears once the programme is paused or achieved;
//   - the target countdown is omitted entirely for an open-ended programme.
// A strip that padded these with zeroes would be a gimmick, which is precisely the risk the plan
// flagged for this wave.
//
// Server component — no hooks, no handlers.

import { orgTabHref } from "@/lib/org/orgTabs";
import type { ProgramStatusView } from "@/lib/db/org-program";

const GOOD = "#22c55e";
const BAD = "#f97316";

function Sep() {
  return (
    <span aria-hidden className="text-slate-700">
      ·
    </span>
  );
}

/** "in 5 days" / "tomorrow" / "today" — a countdown a person reads, not a raw integer. */
function inDays(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export function ProgramStrip({ slug, status }: { slug: string; status: ProgramStatusView | null }) {
  if (!status) return null;
  const { program } = status;

  // A paused programme still shows — hiding it would look like it was deleted — but says so, and
  // loses its pace read (see daysToReview above).
  const paused = program.status === "paused";
  const achieved = program.status === "achieved";

  return (
    <div className="border-b border-divider bg-surface/40">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-2.5 gap-y-1 px-5 py-2 text-sm text-slate-400">
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-slate-500">
          {achieved ? "Achieved" : paused ? "Paused" : `Week ${status.week}`}
        </span>
        <span className="text-slate-200">{program.name}</span>

        <Sep />
        {/* The rung pair is the programme's whole shape: where we are, where we said we'd get to. */}
        <span className="font-mono text-xs">
          {status.levelNow ?? "—"} <span className="text-slate-600">→</span>{" "}
          <span className="text-slate-200">{status.levelTarget}</span>
        </span>

        {status.scannedCount > 0 && (
          <>
            <Sep />
            <span>
              <span className="font-mono tabular-nums text-slate-200">
                {status.atTarget} of {status.scannedCount}
              </span>{" "}
              repos at target
            </span>
          </>
        )}

        {/* Movement against the FROZEN baseline. Absent, not zeroed, when there is no origin. */}
        {status.movedOverall != null && (
          <>
            <Sep />
            <span
              className="font-mono tabular-nums"
              style={{ color: status.movedOverall > 0 ? GOOD : status.movedOverall < 0 ? BAD : undefined }}
              title="Fleet overall against the snapshot frozen when this programme started"
            >
              {status.movedOverall > 0 ? "+" : ""}
              {status.movedOverall} <span className="text-slate-500">since baseline</span>
            </span>
          </>
        )}

        {status.inFlightPrs > 0 && (
          <>
            <Sep />
            <a href={orgTabHref(slug, "live")} className="focus-ring text-slate-300 transition hover:text-accent">
              <span className="font-mono tabular-nums">{status.inFlightPrs}</span>{" "}
              {status.inFlightPrs === 1 ? "PR" : "PRs"} in flight
            </a>
          </>
        )}

        {/* THE W1d GATE. Only a verified Impact Ledger total may make a "bought" claim here. */}
        {status.pointsBought != null && (
          <>
            <Sep />
            <a
              href={orgTabHref(slug, "executive")}
              className="focus-ring transition hover:text-accent"
              title="Verified dimension points from merged improvement PRs since this programme started"
            >
              <span
                className="font-mono tabular-nums"
                style={{ color: status.pointsBought > 0 ? GOOD : status.pointsBought < 0 ? BAD : undefined }}
              >
                {status.pointsBought > 0 ? "+" : ""}
                {status.pointsBought}
              </span>{" "}
              <span className="text-slate-500">pts bought</span>
            </a>
          </>
        )}

        {status.daysToTarget != null && (
          <>
            <Sep />
            <span style={{ color: status.daysToTarget < 0 ? BAD : undefined }}>
              {status.daysToTarget < 0 ? `${Math.abs(status.daysToTarget)} days overdue` : `${status.daysToTarget} days to target`}
            </span>
          </>
        )}

        {status.daysToReview != null && (
          <>
            <Sep />
            <span className="text-slate-500">next review {inDays(status.daysToReview)}</span>
          </>
        )}

        <a
          href={orgTabHref(slug, "executive")}
          className="focus-ring ml-auto font-mono text-xs text-slate-500 transition hover:text-accent"
        >
          Programme →
        </a>
      </div>
    </div>
  );
}
