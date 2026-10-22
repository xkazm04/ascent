"use client";

// The UI surfaces gallery entry (the Knowledge base's second section). The server parent reads the theme and
// passes it down; Altimeter -> SurfacesTab.v1 (the library page), Prism -> SurfacesTab.v2 (masthead, ruled
// index). Both call useSurfacesView, so the filters, the open subject and the URLs cannot drift.
import { SurfacesTabV1 } from "./SurfacesTab.v1";
import { SurfacesTabV2 } from "./SurfacesTab.v2";
import type { ThemeId } from "@/lib/theme/theme";

export function SurfacesTab({ slug, theme = "altimeter" }: { slug: string; theme?: ThemeId }) {
  return theme === "prism" ? <SurfacesTabV2 slug={slug} /> : <SurfacesTabV1 slug={slug} />;
}
