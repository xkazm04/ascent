"use client";

// The UI surfaces gallery entry (the Knowledge base's second section): SurfacesTab.v2 (masthead, ruled index).
import { SurfacesTabV2 } from "./SurfacesTab.v2";

export function SurfacesTab({ slug }: { slug: string }) {
  return <SurfacesTabV2 slug={slug} />;
}
