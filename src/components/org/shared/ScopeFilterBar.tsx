// The org dashboard's scope-filter bar: the segment selector (when the org has segments) followed by
// the tech-stack selector, the pair every scoped org tab renders identically. `resolveOrgScope`
// already deduped the DATA side of these filters; this is the matching RENDER side, which had been
// hand-rolled inline across ~10 tabs with drifting wrappers and guards. Server-safe (it only composes
// the two client selectors). Pass the wrapper classes via `className`; an optional trailing `children`
// slot carries per-tab affordances (e.g. delivery's Export CSV link).
//
// WINDOW DISCLOSURE — getOrgRollup's "current" is each repo's latest scan at-or-before the upper
// bound with no lower bound; getOrgMovers' "now" is the latest scan inside the window. A repo not
// scanned during the period still counts in the fleet average and does not appear in movers (see
// src/lib/db/org-rollup.ts). When a period window is active (`window.start` set), this bar names
// that split so the two counts are not mistaken for a bug. All-time (`start` null/omitted) has no
// split to disclose. Callers pass the same window they hand the queries; this component does not
// import from src/features.

import { SegmentSelector, type SegmentOption } from "@/components/org/shared/SegmentSelector";
import { TechStackSelector, type TechStackOption } from "@/components/org/shared/TechStackSelector";

/** Verbatim the org-rollup.ts header's visible consequence, as a caption. */
export const ROLLUP_MOVERS_CAPTION =
  "Repos not scanned in-period still count in the fleet average and do not appear in movers.";

function RollupMoversCaption() {
  return (
    <p className="w-full type-caption text-slate-500" role="note" data-testid="rollup-movers-caption">
      {ROLLUP_MOVERS_CAPTION}
    </p>
  );
}

export function ScopeFilterBar({
  segments,
  segmentId,
  techGroups,
  activeStack,
  className = "flex flex-wrap items-center gap-2",
  gate = true,
  window: orgWindow,
  children,
}: {
  segments: SegmentOption[];
  segmentId: string | null;
  techGroups: TechStackOption[];
  activeStack: { key: string } | null;
  /** Wrapper classes — preserved per call site so output stays pixel-identical. */
  className?: string;
  /** When true (default) the whole bar is omitted if neither selector would show anything. */
  gate?: boolean;
  /**
   * The period window the rollup/movers queries were scoped with. A non-null `start` means the
   * window is active (not all-time), so the rollup-vs-movers split applies and the caption renders.
   */
  window?: { start?: Date | null } | null;
  /** Trailing affordances rendered after the selectors (e.g. an Export CSV link). */
  children?: React.ReactNode;
}) {
  const windowActive = orgWindow?.start != null;
  const hasSelectors = segments.length > 0 || techGroups.length > 0 || Boolean(children);
  if (gate && !hasSelectors && !windowActive) return null;
  if (!hasSelectors) return windowActive ? <RollupMoversCaption /> : null;
  return (
    <div className={className}>
      {segments.length > 0 && <SegmentSelector segments={segments} active={segmentId} />}
      <TechStackSelector groups={techGroups} active={activeStack?.key ?? null} />
      {children}
      {windowActive && <RollupMoversCaption />}
    </div>
  );
}
