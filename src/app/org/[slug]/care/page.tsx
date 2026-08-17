import { redirect } from "next/navigation";
import { orgTabHref } from "@/lib/org/orgTabs";

export const dynamic = "force-dynamic";

// The Care view lives in the org dashboard's single `?tab=` shell (docs/ORG-TABS-REFACTOR.md §1); this
// path never was a real route, and the stub exists so /org/<slug>/care behaves like every sibling tab
// segment — a permanent redirect rather than a 404 for anyone who types or shares the path.
export default async function OrgCareRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(orgTabHref(slug, "care"));
}
