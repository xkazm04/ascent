"use client";

// The Developer route's single render, themed. Altimeter -> DeveloperCompanion.v1 (the notebook column),
// Prism -> DeveloperCompanion.v2 (masthead + ruled Frames). Same props, same hooks (useCareShare).
// `theme` defaults to Altimeter so a caller that never learned about themes renders as before.

import { DeveloperCompanionV1 } from "./DeveloperCompanion.v1";
import { DeveloperCompanionV2 } from "./DeveloperCompanion.v2";
import type { DeveloperView } from "@/lib/org/developer-view";
import type { ThemeId } from "@/lib/theme/theme";

export function DeveloperCompanion({ view, slug, theme = "altimeter" }: { view: DeveloperView; slug: string; theme?: ThemeId }) {
  return theme === "prism" ? <DeveloperCompanionV2 view={view} slug={slug} /> : <DeveloperCompanionV1 view={view} slug={slug} />;
}
