// The org dashboard's scope-filter bar: the segment selector (when the org has segments) followed by
// the tech-stack selector, the pair every scoped org tab renders identically. `resolveOrgScope`
// already deduped the DATA side of these filters; this is the matching RENDER side, which had been
// hand-rolled inline across ~10 tabs with drifting wrappers and guards. Server-safe (it only composes
// the two client selectors). Pass the wrapper classes via `className`; an optional trailing `children`
// slot carries per-tab affordances (e.g. delivery's Export CSV link).

import { SegmentSelector, type SegmentOption } from "@/components/org/SegmentSelector";
import { TechStackSelector, type TechStackOption } from "@/components/org/TechStackSelector";

export function ScopeFilterBar({
  segments,
  segmentId,
  techGroups,
  activeStack,
  className = "flex flex-wrap items-center gap-2",
  gate = true,
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
  /** Trailing affordances rendered after the selectors (e.g. an Export CSV link). */
  children?: React.ReactNode;
}) {
  if (gate && segments.length === 0 && techGroups.length === 0 && !children) return null;
  return (
    <div className={className}>
      {segments.length > 0 && <SegmentSelector segments={segments} active={segmentId} />}
      <TechStackSelector groups={techGroups} active={activeStack?.key ?? null} />
      {children}
    </div>
  );
}
