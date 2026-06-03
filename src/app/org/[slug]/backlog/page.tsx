// The "Backlog" tab — the org-wide recommendation backlog as a trackable roadmap. Where the Plan
// tab dedupes gaps into systemic moves, this lists the concrete per-repo recommendations with an
// OWNER and a DUE DATE, grouped by owner and by due-date bucket. The org layout already gates
// DB/auth/empty state, so this loads the backlog server-side and hands it to the client panel for
// grouping, inline edits (status / assignee / due date), and per-item activity history.

import { SectionEmpty, SectionHeader } from "@/components/org/ui";
import { BacklogPanel } from "@/components/org/BacklogPanel";
import { getOrgBacklog } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function OrgBacklog({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const backlog = await getOrgBacklog(slug);

  if (!backlog || backlog.tracked === 0) {
    return (
      <SectionEmpty>
        No recommendations to track yet. Scan some of this org&apos;s repositories and their
        recommendations will appear here as an assignable, due-dated backlog.
      </SectionEmpty>
    );
  }

  return (
    <div>
      <SectionHeader
        className="mb-4"
        descriptionClassName="max-w-3xl"
        title="Recommendation backlog"
        description="Every open gap across the fleet, as a roadmap you can run — assign an owner, set a due date, and track each one from open to done. Grouped by owner and by due date; every change is recorded in the item's history."
      />
      <BacklogPanel slug={slug} initial={backlog} />
    </div>
  );
}
