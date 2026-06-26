import type { MetadataRoute } from "next";

// SHELL-3: Web App Manifest so Ascent is an installable PWA shell (Add to Home Screen / desktop
// install) with brand chrome on the splash + task switcher. No service worker — installability only
// needs name + start_url + display + icons. Colors match the app's themeColor (#080d1a). Icons reuse
// the existing brand marks: the transparent mark for normal display, the filled mark (has a backing
// plate) for the maskable slot so Android's safe-zone mask doesn't clip a bare glyph. Both marks are
// 512×512, so we declare an explicit `sizes:"512x512"` (not `"any"`): Chromium/Lighthouse only treat
// `"any"` as a valid installability icon for vector sources, so a `"any"` raster could be read as "no
// suitably-sized icon" and suppress the install prompt. The filled mark is encoded as JPEG, so its
// type is declared accordingly.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ascent — the maturity index for AI-native engineering",
    short_name: "Ascent",
    description:
      "Score how AI-native your engineering org is from a GitHub repo — a 5-level maturity ladder across 9 dimensions, with evidence and a roadmap.",
    start_url: "/",
    display: "standalone",
    background_color: "#080d1a",
    theme_color: "#080d1a",
    icons: [
      { src: "/brand/logo-mark-nobg.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/logo-mark.png", sizes: "512x512", type: "image/jpeg", purpose: "maskable" },
    ],
  };
}
