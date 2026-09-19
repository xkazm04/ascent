// Legacy route for the Live tab, now migrated to the `?tab=` shell (docs/ORG-TABS-REFACTOR.md).
// Kept as a permanent redirect for old links. NOTE: this is NOT the read-only TV/share view — that
// lives at the separate, unauthenticated /live/shared/[token] route and is untouched by this migration.

import { redirect } from "next/navigation";
import { orgTabHref } from "@/lib/org/orgTabs";

export default async function OrgLiveRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(orgTabHref(slug, "live"));
}
