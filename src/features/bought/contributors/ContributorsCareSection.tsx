// The Care section of the Contributors tab (docs/REGISTRY-AND-CARE-IMPL.md section 5.2): the entry reads
// the org aggregate once and the theme picks the composition (v1 Altimeter, v2 Prism). Server component.
import { getCareOrgAggregate } from "@/lib/org/developer-view-load";
import { getTheme } from "@/lib/theme/server";
import { ContributorsCareSectionV1 } from "./ContributorsCareSection.v1";
import { ContributorsCareSectionV2 } from "./ContributorsCareSection.v2";

export async function ContributorsCareSection({ slug }: { slug: string }) {
  const org = await getCareOrgAggregate(slug).catch(() => null);
  if (!org) return null;
  const theme = await getTheme();
  return theme === "prism" ? <ContributorsCareSectionV2 slug={slug} org={org} /> : <ContributorsCareSectionV1 slug={slug} org={org} />;
}
