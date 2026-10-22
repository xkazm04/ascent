"use client";

// The Developer route's single render: DeveloperCompanion.v2 (masthead + ruled Frames), same hooks (useCareShare).

import { DeveloperCompanionV2 } from "./DeveloperCompanion.v2";
import type { DeveloperView } from "@/lib/org/developer-view";

export function DeveloperCompanion({ view, slug }: { view: DeveloperView; slug: string }) {
  return <DeveloperCompanionV2 view={view} slug={slug} />;
}
