import { OrgShell } from "@/components/org/shell/OrgShell";

export const dynamic = "force-dynamic";

/**
 * Org shell layout — a thin call to {@link OrgShell}, which holds the whole body (DB/auth/tenant
 * guards, the header + rail + program strip, every empty-state degradation) so a page OUTSIDE this
 * segment can wear identical chrome. `/org/developer` is the first such page
 * (docs/REGISTRY-AND-CARE-IMPL.md §5.1). Nothing about this route's behaviour changed in the move.
 */
export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <OrgShell slug={slug}>{children}</OrgShell>;
}
