// Live PDF-header mock for BrandingSettings: the three form slots on a LIGHT surface matching
// the briefing PDF, so name, accent and logo are visible before a download. Reuses
// accentContrastWarning (same helper as the form) against this white card.

import { DEFAULT_BRAND_ACCENT, HEX_COLOR_RE } from "@/lib/branding/color";
import { accentContrastWarning } from "./brandingContrast";

export function BrandingPreview({
  brandName,
  brandColor,
  logoUrl,
}: {
  brandName: string;
  brandColor: string;
  logoUrl: string;
}) {
  const accent = HEX_COLOR_RE.test(brandColor) ? brandColor : DEFAULT_BRAND_ACCENT;
  const name = brandName.trim() || "Ascent";
  const logo = logoUrl.trim();
  const contrastWarning = accentContrastWarning(accent);

  return (
    <aside
      role="region"
      aria-label="PDF header preview"
      aria-describedby={contrastWarning ? "brand-accent-warning" : undefined}
      className="w-full max-w-xs rounded-lg border border-slate-200 bg-white p-3"
    >
      <p className="type-note uppercase tracking-widest text-slate-400">PDF header</p>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary external host; next/image would require remotePatterns config per customer CDN
        <img src={logo} alt="PDF header logo" className="mt-2 h-7 max-w-[8rem] object-contain" />
      ) : null}
      <p
        className="mt-2 font-mono type-body-sm font-semibold uppercase tracking-[0.22em]"
        style={{ color: accent }}
      >
        {name} · Executive briefing
      </p>
      <p className="mt-1 type-mono-sm text-slate-500">{accent}</p>
    </aside>
  );
}
