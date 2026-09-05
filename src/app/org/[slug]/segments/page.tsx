import { redirect } from "next/navigation";
import { orgTabHref } from "@/lib/org/orgTabs";

export const dynamic = "force-dynamic";

// The Segments view was consolidated into the Repositories tab as its "?tab=segments" mode (the two
// Fleet views became one — docs/ORG-TABS-REFACTOR.md). This route is kept only as a permanent
// redirect so existing links, bookmarks, and the removed left-rail item resolve to the merged
// location instead of 404-ing.
export default async function OrgSegmentsRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(orgTabHref(slug, "segments"));
}
