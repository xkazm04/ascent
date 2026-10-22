// The Prism composition of the Audit tab: a masthead that answers the one question an examiner opens this
// tab with (is the trail complete?), then the trail itself in a ruled Frame. Same page, same viewer and the
// same health notice as v1. Server-safe (the viewer is the client part).
import { NextMoveLink } from "@/components/org/shared/NextMoveLink";
import { Frame, Masthead, SectionHead, type MastheadFigure } from "@/components/kit";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { AuditLogPage } from "@/lib/db";
import type { AuditHealth } from "@/lib/db/audit-health";
import { AuditLogViewer } from "./AuditLogViewer";
import { AuditHealthNotice } from "./AuditHealthNotice";

export function auditV2(slug: string, page: AuditLogPage, health: AuditHealth) {
  const gaps = health.failed;
  const figures: MastheadFigure[] = [
    { label: "Entries loaded", value: page.entries.length, detail: page.entries.length >= 25 ? "Newest first; load more below" : "The whole trail" },
    {
      label: "Dropped writes",
      value: gaps,
      tone: gaps > 0 ? "risk" : "good",
      detail: gaps > 0 ? "Counted on this instance since it started" : "None on this instance",
    },
  ];
  return (
    <div data-role="audit-v2" className="stagger-children space-y-10">
      <Masthead
        eyebrow="Admin · audit"
        statement={gaps > 0 ? "The trail has known gaps for" : "Every recorded action for"}
        named={slug}
        lede="Who did what, and the scan it touched. Newest first."
        figures={figures}
        pattern="dots"
      />
      <AuditHealthNotice health={health} />
      <Frame edge="both" aria-label="Audit trail">
        <SectionHead eyebrow="Trail" title="Search, verify," named="and export." />
        <div className="mt-5">
          <AuditLogViewer org={slug} initial={page} />
        </div>
      </Frame>
      <NextMoveLink href={orgTabHref(slug, "executive")} to="executive" />
    </div>
  );
}
