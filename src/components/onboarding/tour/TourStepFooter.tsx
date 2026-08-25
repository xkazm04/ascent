"use client";

// The drawer's footer in the SETUP channel — the running spotlight's copy, the honest note when its
// anchor never mounted, and the two decisions available here ("Skip setup", "Got it"). Extracted
// VERBATIM out of TourChecklist for the 300-LOC cap; behaviour is unchanged, including the rule that
// the footer renders at all only when a spotlight is running OR the companion needs its skip door.

import type { DrawerItem } from "./tasks";

export function TourStepFooter({
  active,
  companion,
  anchorMissing,
  onSkip,
  onGotIt,
}: {
  /** The step currently spotlit, or null when none is. */
  active: DrawerItem | null;
  companion: boolean;
  /** The engine could not find this step's `data-tour` anchor on the page it navigated to. */
  anchorMissing: boolean;
  onSkip: () => void;
  onGotIt: () => void;
}) {
  if (!active && !companion) return null;
  return (
    <div className="border-t border-divider px-4 py-3">
      {active && (
        <>
          <p className="text-sm leading-relaxed text-slate-300">{active.tour.body}</p>
          {/* An absent anchor degrades to plain navigation — the tab switch already happened,
              only the ring is missing. Never a stuck "seeking" state. */}
          {anchorMissing && (
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              That control isn&apos;t on screen for this organization yet. You&apos;re on the right tab; it
              appears once there&apos;s something for it to act on.
            </p>
          )}
        </>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        {companion ? (
          <button
            type="button"
            onClick={onSkip}
            className="focus-ring rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
          >
            Skip setup
          </button>
        ) : (
          <span />
        )}
        {active && (
          <button
            type="button"
            onClick={onGotIt}
            className="focus-ring rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-on-accent transition hover:bg-accent-soft"
          >
            Got it
          </button>
        )}
      </div>
    </div>
  );
}
