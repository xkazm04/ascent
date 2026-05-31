// Org dashboard "Audit" tab — the searchable audit trail. The org layout already gates
// DB/auth/empty state, so this just loads the first page server-side and hands it to the
// client viewer for filtering + keyset pagination.

import { SectionEmpty, SectionHeader } from "@/components/org/ui";
import { AuditLogViewer } from "@/components/org/AuditLogViewer";
import { getAuditLog } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function OrgAudit({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
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
            Every recorded action for <span className="font-mono">{slug}</span> — who did
            what, and the scan it touched. Newest first.
          </>
        }
      />
      <AuditLogViewer org={slug} initial={page} />
    </div>
  );
}
