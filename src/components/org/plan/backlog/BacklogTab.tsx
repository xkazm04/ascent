// Org dashboard "Backlog" tab — the org-wide recommendation backlog as a trackable roadmap. Where
// the Plan tab dedupes gaps into systemic moves, this lists the concrete per-repo recommendations
// with an OWNER and a DUE DATE, grouped by owner and by due-date bucket.
//
// SERVER component, filename PINNED as BacklogTab.tsx (docs/ORG-TABS-REFACTOR.md). Takes `slug` +
// the resolved `sp` as props — it is no longer a route. Single data source (the scoped backlog read),
// so one <Suspense> boundary at the OrgTabChunks call site is enough (same shape as the AuditTab
// reference). The org layout already gates DB/auth/empty state; this loads the backlog server-side
// and hands it to the client panel for grouping, inline edits, search/filter/bulk actions, and
// per-item activity history.
//
// INVARIANT (preserved from the pre-migration page): the "show done & dismissed" toggle and any
// client-side filter must move NO headline number — SummaryStrip (BacklogSummary.tsx) reads only the
// ACTIVE org backlog (`b.tracked`/`b.overdue`/etc., never the filtered/shown count), so a dismissed
// past-due item is never counted as debt. See BacklogPanel.tsx / backlogFilter.ts.

import { SectionEmpty, SectionHeader } from "@/components/org/shared/ui";
import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { BacklogPanel } from "@/components/org/plan/backlog/BacklogPanel";
import { PersonalBacklog } from "@/components/org/PersonalBacklog";
import { getOrgBacklog, isPersonalOrg } from "@/lib/db";
import { resolveOrgScope } from "@/lib/org/scope";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function BacklogTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  // A PERSONAL workspace tracks the viewer's private overlay on shared public-corpus
  // recommendations — the org backlog's Recommendation rows live on scans this org doesn't have.
  if (await isPersonalOrg(slug)) return <PersonalBacklog slug={slug} />;

  // Segment + tech-stack scope (?segment=/?stack=), matching every sibling surface — getOrgBacklog was
  // already fully scope-aware but the page loaded it unscoped, so a user filtered to a segment
  // elsewhere landed on a backlog silently showing every repo (backlog-management 07-16 #2). The
  // resolved ids also thread into BacklogPanel so its post-edit refresh stays on the same view.
  const { barProps, segmentId, techGroupId } = await resolveOrgScope(slug, sp);

  const backlog = await getOrgBacklog(slug, segmentId, new Date(), techGroupId);
  const scoped = segmentId != null || techGroupId != null;
  const scopeBar = <ScopeFilterBar {...barProps} className="mb-4 flex flex-wrap items-center justify-end gap-2" />;

  if (!backlog || backlog.tracked === 0) {
    return (
      <div>
        {scopeBar}
        <SectionEmpty>
          {scoped
            ? "No recommendations to track for this filter — pick another segment/stack or clear the filter."
            : "No recommendations to track yet. Scan some of this org's repositories and their recommendations will appear here as an assignable, due-dated backlog."}
        </SectionEmpty>
      </div>
    );
  }

  return (
    <div>
      {scopeBar}
      <SectionHeader
        className="mb-4"
        descriptionClassName="max-w-3xl"
        title="Recommendation backlog"
        description="Every open gap across the fleet, as a roadmap you can run — assign an owner, set a due date, and track each one from open to done. Grouped by owner and by due date; every change is recorded in the item's history."
      />
      <BacklogPanel slug={slug} initial={backlog} segmentId={segmentId} techGroupId={techGroupId} />
    </div>
  );
}
