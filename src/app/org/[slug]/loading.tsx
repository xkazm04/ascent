import { OrgTabGap } from "@/components/org/shell/OrgTabGap";

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
// KEPT, not deleted, for the duration of the migration: the shell's own <Suspense> boundaries make
// this redundant for `?tab=` navigations, but the 20 tabs that are still their own routes have no
// loading.tsx of their own and would otherwise block on a hard navigation with nothing on screen.
// Delete this file when MIGRATED_ORG_TAB_IDS covers every tab.
export default function OrgLoading() {
  return <OrgTabGap minH="min-h-[32rem]" />;
}
