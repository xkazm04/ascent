import { redirect } from "next/navigation";
import { orgTabHref } from "@/lib/org/orgTabs";

export const dynamic = "force-dynamic";

// The Developer home is the PERSONALIZED route `/org/developer?org=<slug>` — one page that always
// shows the signed-in developer their own slice, never an org-scoped panel someone else could open
// (docs/REGISTRY-AND-CARE-IMPL.md §5.1). This stub exists so /org/<slug>/developer behaves like every
// sibling tab segment — a redirect rather than a 404 for anyone who types or shares the path.
export default async function OrgDeveloperRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(orgTabHref(slug, "developer"));
}
