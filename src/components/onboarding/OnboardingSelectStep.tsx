"use client";

import { importWatchMonthlyCredits } from "@/components/onboarding/importCost";
import { IMPORT_WATCH_SCHEDULE } from "@/components/onboarding/importScan";
import type { OrgRepo } from "@/components/onboarding/types";
import { CREDIT_ESTIMATE_NOTE } from "@/lib/credit-estimate";
import { WatchCostTail } from "@/components/credit/WatchCostTail";

/** The "choose up to maxSelect repos" phase: sticky action bar, repo list (or skeleton), scan/back. */
export function SelectStep({
  repos,
  selected,
  loading,
  sourceLabel,
  sourceInstallId,
  credit,
  maxSelect,
  onToggle,
  onSelectTop,
  onClear,
  onScan,
  onBack,
}: {
  repos: OrgRepo[];
  selected: Set<string>;
  loading: boolean;
  sourceLabel: string;
  sourceInstallId: string | null;
  /** Prepaid balance for the source org (App path only) — null hides the balance half. */
  credit: { balance: number; unlimited: boolean } | null;
  maxSelect: number;
  onToggle: (fullName: string) => void;
  onSelectTop: () => void;
  onClear: () => void;
  onScan: () => void;
  onBack: () => void;
}) {
  const listing = loading && repos.length === 0;
  const atCap = selected.size >= maxSelect;
  // The scan button also COMMITS these repos to a weekly autoscan (watch:true in the import) —
  // a recurring prepaid-credit draw that was previously invisible at this exact decision moment.
  const monthlyCredits = importWatchMonthlyCredits(selected.size);
  return (
    <div key="select" className="animate-phase-in">
      {/* ONB a11y #1: focus target for the step transition (focus moves here on phase change). */}
      <h1 data-step-heading tabIndex={-1} className="text-2xl font-bold text-white focus:outline-none">
        Choose repositories
      </h1>
      <p className="mt-1 text-slate-400">
        Up to {maxSelect}. We preselected the {sourceInstallId ? "most recently active" : "most-starred"}.
        {sourceLabel && <> Source: {sourceLabel}</>}
      </p>

      {/* Sticky action bar: bulk select/clear + a filled progress pill for the cap. */}
      <div className="sticky top-16 z-10 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 backdrop-blur">
        <CapPill count={selected.size} max={maxSelect} />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSelectTop}
            disabled={listing}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition hover:border-accent hover:text-white disabled:opacity-50"
          >
            Select top {maxSelect}
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={listing || selected.size === 0}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-600 disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        {listing ? (
          <SelectSkeleton />
        ) : (
          repos.map((r) => {
            const checked = selected.has(r.fullName);
            const capped = !checked && atCap;
            return (
              <button
                key={r.fullName}
                type="button"
                disabled={capped}
                aria-disabled={capped}
                title={capped ? `Limit reached — deselect one to swap (max ${maxSelect})` : undefined}
                onClick={() => onToggle(r.fullName)}
                className={`focus-ring flex w-full items-center gap-3 rounded-lg border px-4 py-2.5 text-left transition ${
                  checked
                    ? "border-accent bg-accent/10"
                    : capped
                      ? "cursor-not-allowed border-slate-800 opacity-40"
                      : "border-slate-800 hover:border-slate-700"
                }`}
              >
                <span className={`flex h-5 w-5 items-center justify-center rounded border ${checked ? "border-accent bg-accent text-on-accent" : "border-slate-600"}`}>
                  {checked && "✓"}
                </span>
                <span className="flex-1 truncate font-mono text-base text-white">{r.fullName}</span>
                {r.private && (
                  <span className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-sm uppercase tracking-widest text-accent">
                    private
                  </span>
                )}
                {capped && (
                  <span className="font-mono text-sm uppercase tracking-widest text-slate-500">limit reached</span>
                )}
                {r.language && <span className="text-sm text-slate-500">{r.language}</span>}
                <span className="text-sm text-slate-500">★ {r.stars.toLocaleString()}</span>
              </button>
            );
          })
        )}
      </div>

      {!listing && (
        <>
          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={onScan}
              disabled={selected.size === 0}
              className="focus-ring rounded-lg bg-accent px-5 py-2.5 text-base font-semibold text-on-accent transition hover:bg-accent-soft disabled:opacity-50"
            >
              Scan {selected.size} {selected.size === 1 ? "repo" : "repos"}
            </button>
            <button
              onClick={onBack}
              className="focus-ring rounded-lg border border-slate-700 px-4 py-2.5 text-base text-slate-300 hover:border-slate-600"
            >
              Back
            </button>
          </div>
          {/* Cost disclosure AT the commitment button: scanning also schedules a recurring,
              credit-metered autoscan — say so (with the balance when readable) instead of letting
              the cron's insufficient-credit skips reveal it weeks later. */}
          {selected.size > 0 && (
            <p className="mt-3 max-w-xl text-sm text-slate-500" title={CREDIT_ESTIMATE_NOTE}>
              Scanning also watches {selected.size === 1 ? "this repo" : `these ${selected.size} repos`} with a{" "}
              {IMPORT_WATCH_SCHEDULE} autoscan ≈{" "}
              <span className="font-mono text-slate-300">{monthlyCredits}</span> prepaid credit
              {monthlyCredits === 1 ? "" : "s"}/month
              <WatchCostTail credit={credit} monthlyCredits={monthlyCredits} />. Adjust or turn off anytime on Connect.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Filled progress pill that doubles as the X / MAX counter. */
export function CapPill({ count, max }: { count: number; max: number }) {
  const pct = Math.round((count / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-sm tabular-nums text-slate-300">
        {count}/{max} selected
      </span>
    </div>
  );
}

/** Skeleton rows mirroring the select-list layout, shown while repos are being listed. */
export function SelectSkeleton() {
  return (
    <div className="space-y-1.5" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-slate-800 px-4 py-2.5">
          <div className="h-5 w-5 animate-pulse rounded bg-slate-800" />
          <div className="h-4 flex-1 animate-pulse rounded bg-slate-800" style={{ maxWidth: `${60 - i * 5}%` }} />
          <div className="h-3 w-10 animate-pulse rounded bg-slate-800/70" />
        </div>
      ))}
    </div>
  );
}
