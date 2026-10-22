// The Care section of the Contributors tab (docs/REGISTRY-AND-CARE-IMPL.md section 5.2): the entry reads
// the org aggregate once and ContributorsCareSectionView renders it. Server component.
import { getCareOrgAggregate } from "@/lib/org/developer-view-load";
import { ContributorsCareSectionView } from "./ContributorsCareSectionView";

export async function ContributorsCareSection({ slug }: { slug: string }) {
  const org = await getCareOrgAggregate(slug).catch(() => null);
  if (!org) return null;
  return <ContributorsCareSectionView slug={slug} org={org} />;
}
