// What the Adoption panel hands to a composition (v1 Altimeter, v2 Prism): the one overview it read, the
// scope filter bar, and the markdown brief, so both themes show the same numbers.
import type { ReactNode } from "react";
import type { AdoptionOverview } from "@/lib/org/adoption";

export interface AdoptionViewProps {
  a: AdoptionOverview;
  slug: string;
  filterBar: ReactNode;
  md: string;
}
