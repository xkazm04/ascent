// Pure WCAG contrast math for the branding accent colour (BrandingSettings.tsx). Pulled out so the
// form's JSX file stays under the 200-LOC cap (docs/ORG-TABS-REFACTOR.md) — re-exported from
// BrandingSettings.tsx so BrandingSettings.test.tsx's import path is unchanged.

/** WCAG relative luminance (0 = black … 1 = white) of a `#rrggbb` colour; NaN for a malformed one. */
function luminance(hex: string): number {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!m) return NaN;
  const lin = (h: string) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(m[1]!) + 0.7152 * lin(m[2]!) + 0.0722 * lin(m[3]!);
}

/** WCAG contrast ratio (1…21) of two relative luminances. */
function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Dark canvas of `/share/briefing/[token]` (ShareHeader `bg-ink`) — `--color-ink` / `BRAND_INK`. */
export const SHARE_CHROME_INK = "#080d1a";
const SHARE_CHROME_LUMA = luminance(SHARE_CHROME_INK);

/** WCAG contrast ratio (1…21) of `hex` against the WHITE briefing-PDF surface; NaN for a bad colour. */
export function accentContrastOnWhite(hex: string): number {
  const l = luminance(hex);
  if (Number.isNaN(l)) return NaN;
  return contrastRatio(l, 1); // white luminance is 1.0
}

/** WCAG contrast ratio (1…21) of `hex` against the DARK share chrome; NaN for a bad colour. */
export function accentContrastOnDark(hex: string): number {
  const l = luminance(hex);
  if (Number.isNaN(l)) return NaN;
  return contrastRatio(l, SHARE_CHROME_LUMA);
}

/** Minimum readable ratio for the accent on either surface — WCAG 1.4.11 / large-text 1.4.3 (3:1). */
export const MIN_ACCENT_CONTRAST = 3;

/**
 * org-branding-white-label #1: a NON-BLOCKING warning when the chosen accent would be near-invisible
 * on the white briefing PDF or the dark share chrome (contrast below 3:1). Returns null for a
 * readable — or malformed — colour. The value is still saved; this only advises, so an owner can't
 * unknowingly ship an unreadable brand on either client-facing surface.
 */
export function accentContrastWarning(hex: string): string | null {
  const onWhite = accentContrastOnWhite(hex);
  if (Number.isNaN(onWhite)) return null;
  if (onWhite < MIN_ACCENT_CONTRAST) {
    return `Low contrast: this accent is only ${onWhite.toFixed(1)}:1 on the white briefing PDF (below 3:1), so it may be hard to read. It'll still be saved; a darker shade reads better.`;
  }
  const onDark = accentContrastOnDark(hex);
  if (Number.isNaN(onDark) || onDark >= MIN_ACCENT_CONTRAST) return null;
  return `Low contrast: this accent is only ${onDark.toFixed(1)}:1 on the dark share chrome (below 3:1), so it may be hard to read. It'll still be saved; a lighter shade reads better.`;
}
