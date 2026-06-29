import type { MetadataRoute } from "next";
import { DIMENSION_COUNT, LEVEL_COUNT, SITE_TAGLINE } from "@/lib/site";

// SHELL-3: Web App Manifest so Ascent is an installable PWA shell (Add to Home Screen / desktop
// install) with brand chrome on the splash + task switcher. No service worker — installability only
// needs name + start_url + display + icons. Colors match the app's themeColor (#080d1a). Icons reuse
// the existing brand marks: the transparent mark for normal display, the filled mark (has a backing
// plate) for the maskable slot so Android's safe-zone mask doesn't clip a bare glyph. `sizes:"any"`
// is declared honestly — these are single source PNGs, not a pre-rendered 192/512 set.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `Ascent — ${SITE_TAGLINE}`,
    short_name: "Ascent",
    description: `Score how AI-native your engineering org is from a GitHub repo — a ${LEVEL_COUNT}-level maturity ladder across ${DIMENSION_COUNT} dimensions, with evidence and a roadmap.`,
    start_url: "/",
    display: "standalone",
    background_color: "#080d1a",
    theme_color: "#080d1a",
    icons: [
      { src: "/brand/logo-mark-nobg.png", sizes: "any", type: "image/png", purpose: "any" },
      { src: "/brand/logo-mark.png", sizes: "any", type: "image/png", purpose: "maskable" },
    ],
  };
}
