// Org dashboard "Audit" tab — the searchable audit trail.
//
// REFERENCE IMPLEMENTATION (docs/ORG-TABS-REFACTOR.md). This is the simplest shape a migrated tab
// takes, and the one to copy first:
//   - it is a SERVER component (`OrgTabChunks` renders it inside a <Suspense>, so its `await` streams
//     — it must never become "use client" to fit the shell);
//   - the filename is PINNED as `<Feature>Tab.tsx` — the shell imports it by path;
//   - it takes `slug` as a prop instead of reading route params, because it is no longer a route;
//   - it does NO auth work: the org layout's `canReadOrg` gate already ran, and duplicating it here
//     would be a second tenant check that can drift from the real one;
//   - its old route (src/app/org/[slug]/audit/page.tsx) is now nothing but a redirect() — links in
//     already-sent digest emails still resolve.
// Its leaf parts (AuditLogViewer, AuditLogCells) sit beside it in the same group folder.

import { SectionEmpty, SectionHeader } from "@/components/org/shared/ui";
import { AuditLogViewer } from "./AuditLogViewer";
import { AuditHealthNotice } from "./AuditHealthNotice";
import { getAuditLog } from "@/lib/db";
import { getAuditHealth } from "@/lib/db/audit-health";

export async function AuditTab({ slug }: { slug: string }) {
  const page = await getAuditLog(slug, { limit: 25 });
  // Read per render (it's a process-local counter, not a query) so the notice reflects the failures this
  // instance has accumulated up to the moment the tab was drawn.
  const health = getAuditHealth();

  if (!page || page.entries.length === 0) {
    // The notice matters MOST here: an empty trail with dropped writes behind it is the one state a
    // reader would otherwise misread as "nothing has happened".
    return (
      <>
        <AuditHealthNotice health={health} />
        <SectionEmpty>
          No audit activity yet for this org. Scans, recommendation updates, and other
          recorded actions will appear here as they happen.
        </SectionEmpty>
      </>
    );
  }

  return (
    <div>
      <SectionHeader
        className="mb-4"
        title="Audit trail"
        description={
          <>
            Every recorded action for <span className="font-mono">{slug}</span>: who did
            what, and the scan it touched. Newest first.
          </>
        }
      />
      <AuditHealthNotice health={health} />
      <AuditLogViewer org={slug} initial={page} />
    </div>
  );
}
