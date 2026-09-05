import { redirect } from "next/navigation";
import { orgTabHref } from "@/lib/org/orgTabs";

export const dynamic = "force-dynamic";

// The Plan view moved into the org dashboard's single `?tab=` shell (docs/ORG-TABS-REFACTOR.md).
// This route is kept FOREVER as a permanent redirect, not deleted: 58 link sites point at
// /org/{slug}/{segment}, including the weekly digest email and the alert pushes — links already
// sitting in inboxes that we cannot update. The target comes from orgTabHref so a future rename is
// one edit in orgTabs.ts.
export default async function OrgPlanRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // The Plan tab itself was retired 2026-08-17; its programme control moved to the Briefing, and its
  // gaps became the Follow-ups ledger. Old links land on the ledger.
  redirect(orgTabHref(slug, "followups"));
}
