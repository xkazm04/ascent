// The Care section of the Contributors tab (docs/REGISTRY-AND-CARE-IMPL.md section 5.2): the entry reads
// the org aggregate once and ContributorsCareSection.v2 (Prism) renders it. Server component.
import { getCareOrgAggregate } from "@/lib/org/developer-view-load";
import { ContributorsCareSectionV2 } from "./ContributorsCareSection.v2";

export async function ContributorsCareSection({ slug }: { slug: string }) {
  const org = await getCareOrgAggregate(slug).catch(() => null);
  if (!org) return null;
  return <ContributorsCareSectionV2 slug={slug} org={org} />;
}
