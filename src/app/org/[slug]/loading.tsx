import { OrgTabGap } from "@/components/shared/dashboard/OrgTabGap";

// App Router loading UI for the org dashboard segment. The org layout (site header + maturity chip +
// section rail) stays mounted, so this fills only the content column while a route's server render
// streams in.
//
// It used to be an `animate-pulse` silhouette — a header bar, a four-stat row and two cards — that
// matched no tab in particular, so a cold navigation showed a fake page and then a real one, and
// each un-migrated tab then showed a THIRD shape. Skeletons are banned
// (docs/ORG-TABS-REFACTOR.md §2): a placeholder that draws a shape the real content does not have is
// a lie told during the one moment the user is paying attention. What replaces it is the quiet gap —
// invisible for 150ms, then a calm fade, with the height still reserved so nothing jumps.
//
// KEPT after the `?tab=` migration finished: the shell's per-panel <Suspense> covers a tab switch, but
// a hard navigation still awaits the page's header summary before the shell renders at all.
export default function OrgLoading() {
  return <OrgTabGap minH="min-h-[32rem]" />;
}
