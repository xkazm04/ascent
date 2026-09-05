// Legacy route for the Passports tab, now migrated to the `?tab=` shell (docs/ORG-TABS-REFACTOR.md).
// Kept as a permanent redirect for old links.

import { redirect } from "next/navigation";
import { orgTabHref } from "@/lib/org/orgTabs";

export default async function OrgPassportsRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(orgTabHref(slug, "passports"));
}
