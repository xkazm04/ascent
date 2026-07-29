import { redirect } from "next/navigation";
import { orgTabHref } from "@/lib/org/orgTabs";

export const dynamic = "force-dynamic";

// Migrated into the ?tab= shell (docs/ORG-TABS-REFACTOR.md) — see
// src/components/org/fleet/contributors/ContributorsTab.tsx. Kept as a permanent redirect: links
// already sitting in digest emails and alert pushes point at this path.
export default async function OrgContributorsRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(orgTabHref(slug, "contributors"));
}
