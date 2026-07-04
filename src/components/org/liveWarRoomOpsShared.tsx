// Shared atoms for the ship-loop variants (baseline / pipeline / focus). The switcher owns the
// poller + auto-verify toggle and hands each variant the same `OpsView` contract; these are the
// row/readout building blocks every variant composes, plus the pure impact derivation the symbolic
// overview layers read. Kept brand-correct: deltaHex/fmtDelta for signed impact, dimension deltas
// via DIMENSION_SHORT, freshness for timestamps.

import Link from "next/link";
import { DIMENSION_SHORT, EFFORT_CLASS, IMPACT_CLASS, freshness, reportPermalink } from "@/lib/ui";
import { deltaHex, fmtDelta } from "@/components/ui";
import type { OpsPrItem, OpsState, OpsTriageItem } from "@/lib/db";
import type { DimensionId } from "@/lib/types";

export const dimShort = (dimId: string) => DIMENSION_SHORT[dimId as DimensionId] ?? dimId;

/** The props every ship-loop variant receives from the switcher — the live state + the actions. */
export interface OpsView {
  state: OpsState;
  busy: Record<string, "accept" | "reject">;
  accept: (id: string) => void;
  reject: (id: string) => void;
  /** Launch the wall's scoped rescan for these repos (the manual "verify" affordance). */
  onVerify: (fullNames: string[]) => void;
}

/** Cumulative outcome of the landed column — the "what has the loop achieved?" takeaway. */
export function opsImpact(landed: OpsPrItem[]) {
  const verified = landed.filter((l) => l.verified);
  const netOverall = verified.reduce((s, l) => s + (l.impactOverall ?? 0), 0);
  const dimsLifted = verified.filter((l) => (l.impactDim ?? 0) > 0).length;
  const awaiting = landed.filter((l) => l.state === "merged" && !l.verified).length;
  const merged = landed.filter((l) => l.state === "merged").length;
  return { verified: verified.length, netOverall, dimsLifted, awaiting, merged };
}

/** Compact signed impact of a landed PR — its dimension delta + overall delta, or its pending state. */
export function ImpactReadout({ item }: { item: OpsPrItem }) {
  if (item.impactDim != null || item.impactOverall != null) {
    return (
      <span className="shrink-0 font-mono text-sm">
        {item.impactDim != null && (
          <span style={{ color: deltaHex(item.impactDim) }}>
            {dimShort(item.dimId)} {fmtDelta(item.impactDim)}
          </span>
        )}
        {item.impactOverall != null && <span className="text-slate-500"> · overall {fmtDelta(item.impactOverall)}</span>}
      </span>
    );
  }
  if (item.state === "merged") return <span className="shrink-0 font-mono text-sm text-slate-500">awaiting rescan</span>;
  return <span className="shrink-0 font-mono text-sm text-slate-500">closed unmerged</span>;
}

/** A repo → report link with its dimension tag — the shared identity line for a ship-loop row. */
export function RepoTag({ item }: { item: { repoFullName: string; repoName: string; dimId: string } }) {
  return (
    <span className="flex min-w-0 items-center gap-2 font-mono text-sm">
      <Link href={reportPermalink(item.repoFullName)} className="truncate text-slate-200 hover:text-accent" title={item.repoFullName}>
        {item.repoName}
      </Link>
      <span className="shrink-0 text-slate-500">
        {item.dimId} · {dimShort(item.dimId)}
      </span>
    </span>
  );
}

/** The full triage item — identity, title, rationale, impact/effort chips, accept/reject. The detail
 *  layer every variant opens; given full width here it can breathe (the readability fix). */
export function TriageDetail({
  item,
  busy,
  onAccept,
  onReject,
}: {
  item: OpsTriageItem;
  busy?: "accept" | "reject";
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div className="rounded-lg border border-divider/60 bg-surface-strong/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <RepoTag item={item} />
        <span className="shrink-0 font-mono text-xs text-slate-600">{item.practiceLabel}</span>
      </div>
      <p className="mt-1 text-base text-slate-200" title={item.title}>
        {item.title}
      </p>
      {item.rationale && <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{item.rationale}</p>}
      <div className="mt-2 flex items-center gap-1.5">
        <span className={`rounded border px-1.5 font-mono text-xs ${IMPACT_CLASS[item.impact] ?? IMPACT_CLASS.low}`}>{item.impact} impact</span>
        <span className={`rounded border px-1.5 font-mono text-xs ${EFFORT_CLASS[item.effort] ?? EFFORT_CLASS.low}`}>{item.effort} effort</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onAccept}
          disabled={Boolean(busy)}
          title={`Open a draft PR seeding "${item.practiceLabel}" into ${item.repoFullName}`}
          className="focus-ring rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-mono text-sm text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
        >
          {busy === "accept" ? "Opening…" : "✓ Open PR"}
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={Boolean(busy)}
          title="Dismiss this direction (recorded on the backlog timeline)"
          className="focus-ring rounded-md border border-slate-700 px-2.5 py-1 font-mono text-sm text-slate-400 transition hover:border-slate-500 hover:text-slate-200 disabled:opacity-50"
        >
          {busy === "reject" ? "…" : "✕ Dismiss"}
        </button>
      </div>
    </div>
  );
}

/** A draft PR being watched for merge — repo, age, PR link. */
export function FlightRowDetail({ item }: { item: OpsPrItem }) {
  return (
    <div className="flex items-center gap-2 px-1 text-base">
      <Link
        href={reportPermalink(item.repoFullName)}
        className="min-w-0 flex-1 truncate font-mono text-sm text-slate-200 hover:text-accent"
        title={`${item.repoFullName} — ${item.practiceLabel}`}
      >
        {item.repoName}
      </Link>
      <span className="shrink-0 font-mono text-sm text-slate-500" suppressHydrationWarning>
        {freshness(item.openedAt)}
      </span>
      <a
        href={item.prUrl}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 rounded border border-accent/40 bg-accent/10 px-1.5 font-mono text-sm text-accent transition hover:bg-accent/20"
        title={`Draft PR seeding ${item.practiceLabel} — review and merge it on GitHub`}
      >
        PR #{item.prNumber} ↗
      </a>
    </div>
  );
}

/** A landed PR — repo, merged/closed glyph, and its measured impact (or a verify affordance). */
export function LandedRowDetail({ item, onVerify }: { item: OpsPrItem; onVerify?: () => void }) {
  const needsVerify = item.state === "merged" && !item.verified && onVerify;
  return (
    <div className="flex items-center gap-2 px-1 text-base">
      <a
        href={item.prUrl}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 truncate font-mono text-sm text-slate-200 hover:text-accent"
        title={`${item.repoFullName} — PR #${item.prNumber} (${item.practiceLabel}), ${item.state}${item.mergedAt ? " " + freshness(item.mergedAt) : ""}`}
      >
        {item.repoName}
        <span aria-hidden className={`ml-1.5 ${item.state === "merged" ? "text-emerald-400" : "text-slate-600"}`}>
          {item.state === "merged" ? "⇂ merged" : "✕"}
        </span>
      </a>
      {needsVerify ? (
        <button
          type="button"
          onClick={onVerify}
          title="Run a scoped rescan of this repo now to measure the merged PR's impact"
          className="focus-ring shrink-0 rounded-md border border-slate-700 px-2 py-0.5 font-mono text-sm text-slate-400 transition hover:border-accent hover:text-accent"
        >
          awaiting rescan · verify →
        </button>
      ) : (
        <ImpactReadout item={item} />
      )}
    </div>
  );
}
