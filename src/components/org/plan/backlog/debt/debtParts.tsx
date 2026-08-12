// Shared presentational pieces for the Debt Ledger. Server-safe — no hooks, no handlers.

import { scoreHex } from "@/lib/ui";
import { OVERDUE_ACCENT } from "@/components/org/shared/backlogShared";
import { fmtRate, type DebtFleet, type RepoDebt } from "./debtModel";

/**
 * The ledger's field notes — the honesty label the mock notice grew into. Names what each column
 * measures, that the rework rates are LOWER BOUNDS (window-scoped matcher; renamed reverts escape),
 * how much of the ledger is measured at all, and that AI-churn share is deferred with its signal.
 */
export function FieldNotes({ fleet }: { fleet: DebtFleet }) {
  const unmeasured = fleet.repos - fleet.measuredRows;
  return (
    <p className="rounded-lg border border-dashed border-divider bg-surface/40 px-3 py-2 text-sm text-slate-400">
      <span className="font-mono text-xs uppercase tracking-[0.22em] text-slate-500">Field notes</span>{" "}
      Interest = share of merged PRs later reverted (revert linkage within the scanned PR window — a{" "}
      <strong className="font-medium text-slate-200">lower bound</strong>; renamed or later reverts escape). Write-offs =
      PRs titled &ldquo;Revert&rdquo;. Exposure = {fleet.exposureGrounded ? "AI-trailer-attributed merged PRs" : "AI-involved PRs (marker-based)"}.
      {unmeasured > 0 && (
        <>
          {" "}
          <strong className="font-medium text-amber-200">
            {unmeasured} of {fleet.repos} accounts
          </strong>{" "}
          show &ldquo;—&rdquo; because their latest scan predates rework tracking — re-scan to measure; a dash is never a zero.
        </>
      )}{" "}
      AI-churn share (rework landing on AI-authored lines) is deferred until per-file churn ingest exists — it is omitted, not
      simulated.
    </p>
  );
}

/**
 * Pressure is 0–100 with HIGH = BAD, so it is rendered through the brand ramp INVERTED
 * (`scoreHex(100 - pressure)`): green still reads as healthy, and the ramp keeps its one meaning.
 */
export const pressureHex = (pressure: number): string => scoreHex(100 - pressure);

/** A nullable 0–100 rate cell: the rate, or an honest dash with the reason in the tooltip. */
export function RateCell({ value, unmeasuredReason }: { value: number | null; unmeasuredReason: string }) {
  if (value == null) {
    return (
      <span className="font-mono tabular-nums text-slate-500" title={unmeasuredReason}>
        —
      </span>
    );
  }
  return <span className="font-mono tabular-nums text-white">{fmtRate(value)}</span>;
}

/** Dimension chips (D1…D9) carrying a repo's overdue debt — the "where" of the gap. */
export function DimChips({ dims }: { dims: string[] }) {
  if (dims.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {dims.map((d) => (
        <span key={d} className="rounded border border-divider bg-surface/60 px-1.5 py-0.5 font-mono text-xs text-slate-400">
          {d}
        </span>
      ))}
    </span>
  );
}

/** Why a quality cell is a dash — the per-row tooltip copy (one place, so the wording can't drift). */
export function unmeasuredReasonFor(row: RepoDebt): string {
  if (!row.q.hasScan) return "No scanned PR data for this repo yet";
  if (!row.q.measured) return "Latest scan predates rework tracking — re-scan to measure";
  return "Fewer than 5 merged PRs in the window — not measurable";
}

/** One-line plain-language verdict for a repo — the "what's the takeaway" requirement. Null-aware:
 *  an unmeasured repo gets an honest "not measured" verdict, never a fabricated healthy/hot one. */
export function verdictFor(row: RepoDebt, medianRework: number | null): { text: string; tone: string } {
  if (row.q.reworkRate == null) {
    if (row.overdue > 0) {
      return {
        text: `${row.overdue} overdue fixes; quality unmeasured — ${unmeasuredReasonFor(row).toLowerCase()}`,
        tone: OVERDUE_ACCENT,
      };
    }
    return { text: `Quality unmeasured — ${unmeasuredReasonFor(row).toLowerCase()}`, tone: "#94a3b8" };
  }
  const hot = medianRework != null && row.q.reworkRate > medianRework;
  if (row.overdue > 0 && hot) {
    return {
      text: `Compounding — ${fmtRate(row.q.reworkRate)} of merged PRs reverted while ${row.overdue} fixes sit past due`,
      tone: pressureHex(row.pressure),
    };
  }
  if (hot) {
    return {
      text:
        row.q.aiReworkRate != null
          ? `Rework above ledger median — ${fmtRate(row.q.aiReworkRate)} of AI-involved merges reverted`
          : `Rework above ledger median (${fmtRate(row.q.reworkRate)} of merged PRs reverted)`,
      tone: OVERDUE_ACCENT,
    };
  }
  if (row.overdue > 0) {
    return { text: `${row.overdue} overdue fixes, but quality is holding`, tone: "#eab308" };
  }
  return {
    text:
      row.q.exposure != null
        ? `Holding — ${fmtRate(row.q.exposure)} AI exposure, rework at or under the ledger median`
        : "Holding — rework at or under the ledger median",
    tone: "#22c55e",
  };
}
