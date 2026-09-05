// Legacy route for the Security tab, now migrated to the `?tab=` shell (docs/ORG-TABS-REFACTOR.md).
// Kept as a permanent redirect — links already sitting in digest emails and /report/... permalinks
// point here and cannot be updated.

import { redirect } from "next/navigation";
import { orgTabHref } from "@/lib/org/orgTabs";

export default async function OrgSecurityRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(orgTabHref(slug, "security"));
}
