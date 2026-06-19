"use client";

import { useRef, type KeyboardEvent } from "react";

export type ReportTab = "scoring" | "roadmap" | "sandbox" | "contributors";

/**
 * Segmented tab switcher for the report body. Implements the WAI-ARIA tabs pattern: roving
 * tabindex (only the active tab is in the tab order) with Arrow/Home/End key navigation, and each
 * tab wired to its panel via id + aria-controls. Only the active panel mounts, so aria-controls
 * references whichever panel is currently rendered. The active tab carries the accent fill.
 */
export function ReportTabBar({
  tabs,
  active,
  onSelect,
}: {
  tabs: { id: ReportTab; label: string }[];
  active: ReportTab;
  onSelect: (id: ReportTab) => void;
}) {
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, idx: number) {
    const last = tabs.length - 1;
    let next = idx;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = idx === last ? 0 : idx + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = idx === 0 ? last : idx - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else return;
    e.preventDefault();
    onSelect(tabs[next]!.id); // safe: `next` is clamped to [0, tabs.length - 1] above
    btnRefs.current[next]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="Report sections"
      className="flex flex-wrap gap-1.5 rounded-2xl border border-divider bg-surface/40 p-1.5"
    >
      {tabs.map((t, i) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`report-tab-${t.id}`}
            aria-selected={isActive}
            // Only the ACTIVE panel is mounted, so only the active tab's aria-controls resolves to a
            // real element — pointing an inactive tab at an unrendered panel id is a dangling reference.
            aria-controls={isActive ? `report-panel-${t.id}` : undefined}
            tabIndex={isActive ? 0 : -1}
            data-testid={`report-tab-btn-${t.id}`}
            onClick={() => onSelect(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`rounded-xl px-4 py-2 text-base font-medium transition ${
              isActive
                ? "bg-accent text-on-accent"
                : "text-slate-400 hover:bg-slate-800/60 hover:text-white"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
