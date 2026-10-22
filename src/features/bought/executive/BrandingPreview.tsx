// Live PDF-header mock for BrandingSettings: the three form slots on a LIGHT surface matching
// the briefing PDF, so name, accent and logo are visible before a download. Reuses
// accentContrastWarning (same helper as the form) against this white card.
// branding-1: the logo shows only while the server has not said the PDF won't get it. The browser can
// load a URL (a redirect, a hotlink allowance) that the PDF's guarded, no-redirect fetch refuses, so a
// logo the browser draws here is not proof the PDF has one.

import { DEFAULT_BRAND_ACCENT, HEX_COLOR_RE } from "@/lib/branding/color";
import { accentContrastWarning } from "./brandingContrast";
import type { LogoVerdict } from "./brandingVerdictModel";

export function BrandingPreview({
  brandName,
  brandColor,
  logoUrl,
  logoVerdict,
}: {
  brandName: string;
  brandColor: string;
  logoUrl: string;
  logoVerdict?: LogoVerdict;
}) {
  const accent = HEX_COLOR_RE.test(brandColor) ? brandColor : DEFAULT_BRAND_ACCENT;
  const name = brandName.trim() || "Ascent";
  const logo = logoUrl.trim();
  const noLogoInPdf = Boolean(logo) && (logoVerdict === "unreachable" || logoVerdict === "rejected");
  const contrastWarning = accentContrastWarning(accent);

  return (
    <aside
      role="region"
      aria-label="PDF header preview"
      aria-describedby={contrastWarning ? "brand-accent-warning" : undefined}
      className="w-full max-w-xs rounded-lg border border-slate-200 bg-white p-3"
    >
      <p className="type-note uppercase tracking-widest text-slate-400">PDF header</p>
      {noLogoInPdf ? (
        <p className="mt-2 type-mono-sm text-amber-600">No logo in the PDF</p>
      ) : logo ? (
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
