// The Altimeter composition of the Audit tab (moved unchanged from AuditTab.tsx). Server-safe.
import { SectionHeader } from "@/components/shared/dashboard/ui";
import { NextMoveLink } from "@/components/shared/dashboard/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { AuditLogPage } from "@/lib/db";
import type { AuditHealth } from "@/lib/db/audit-health";
import { AuditLogViewer } from "./AuditLogViewer";
import { AuditHealthNotice } from "./AuditHealthNotice";

export function auditV1(slug: string, page: AuditLogPage, health: AuditHealth) {
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
      <NextMoveLink href={orgTabHref(slug, "executive")} to="executive" />
    </div>
  );
}
