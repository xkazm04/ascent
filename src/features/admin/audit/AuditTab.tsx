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
import { getAuditLog } from "@/lib/db";

export async function AuditTab({ slug }: { slug: string }) {
  const page = await getAuditLog(slug, { limit: 25 });

  if (!page || page.entries.length === 0) {
    return (
      <SectionEmpty>
        No audit activity yet for this org. Scans, recommendation updates, and other
        recorded actions will appear here as they happen.
      </SectionEmpty>
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
      <AuditLogViewer org={slug} initial={page} />
    </div>
  );
}
