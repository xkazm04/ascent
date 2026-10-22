// FilterBar: the row of filter menus, search and view switches above a worklist, plus the "N of M" readout
// with its "Clear filters" action. The facets themselves are the caller's (FilterMenu / Input / Segmented);
// the bar owns only the wrapping row and the count, so every ledger reads the same. Server-safe.
import type { ReactNode } from "react";

export function FilterBar({ children, className = "", ...rest }: { children: ReactNode; className?: string; "aria-label"?: string }) {
  return (
    <div data-kit="filter-bar" data-role="filter-bar" className={`flex flex-wrap items-center gap-3 ${className}`} {...rest}>
      {children}
    </div>
  );
}

/** "12 of 40 · Clear filters", pushed to the row's far edge. `onClear` appears only while `active`. */
export function FilterCount({ shown, total, active, onClear }: { shown: number; total: number; active: boolean; onClear: () => void }) {
  return (
    <span data-role="filter-count" className="ml-auto type-caption text-slate-400">
      {shown} of {total}
      {active && (
        <>
          {" · "}
          <button type="button" onClick={onClear} className="focus-ring text-accent hover:text-white">
            Clear filters
          </button>
        </>
      )}
    </span>
  );
}
