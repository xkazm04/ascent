// The gap a tab panel leaves while its server render streams in (docs/ORG-TABS-REFACTOR.md §2).
//
// Deliberately EMPTY. What it replaces — the segment's `animate-pulse` silhouette — drew a header +
// stat-row + two-card shape that matched no tab in particular, so a cold navigation showed two
// unrelated loading layouts in a row (that one, then the tab's own) before content: the exact flicker
// the choreography forbids. What replaces it is nothing visible, on a 150ms delayed fade
// (`.reveal-quiet`), so a fast panel paints no placeholder at all and a genuinely slow one gets a
// calm held frame instead of a fake page.
//
// The reserved height is the ONLY thing it asserts: without it the page below jumps up into the gap
// and back down when content lands. Pass a taller/shorter `minH` where a panel's geometry is
// distinctive — but never draw content into it.
//
// Server component on purpose: it is pure markup, so it costs the client bundle nothing.
export function OrgTabGap({ minH = "min-h-[24rem]" }: { minH?: string }) {
  return <div className={`reveal-quiet ${minH}`} aria-hidden />;
}
