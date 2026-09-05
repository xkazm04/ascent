import { redirect } from "next/navigation";
import { orgTabHref } from "@/lib/org/orgTabs";

export const dynamic = "force-dynamic";

// The Registry view lives in the org dashboard's single `?tab=` shell (docs/ORG-TABS-REFACTOR.md).
// This route exists from day one — mirroring the skills/memory stubs — so that /org/{slug}/registry is
// a valid, permanent address: the registry's own README, the scaffold PR body and the `npx ascent`
// output all want a link a human can type, and those land in places we cannot update later. The target
// comes from orgTabHref so a future rename is one edit in orgTabs.ts.
export default async function OrgRegistryRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(orgTabHref(slug, "registry"));
}
