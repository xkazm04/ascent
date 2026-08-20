// The shields.io-style badge RENDERER, extracted from `/api/badge/[owner]/[repo]/route.ts` so a
// SECOND badge endpoint (the org-level scorecard badge, `/api/scorecard/[owner]/badge`) draws the
// byte-identical artwork instead of forking a near-copy that drifts on the next tweak. Pure
// string-building + the cache-policy vocabulary; no DB, no scan, no React — a `route.ts` may import it
// and so may a test.
//
// NOT merged into `@/lib/badge.ts`: that module is the CLIENT-safe contract (the BadgeGenerator
// imports it), and this one reaches into `@/lib/ui` for the WCAG luminance primitives + brand level
// hexes. Keeping the split means the client bundle never pulls the renderer in.

import { LEVEL_HEX, relLuminance, rgbOf } from "@/lib/ui";
import { BADGE_STYLES, type BadgeStyle } from "@/lib/badge";

export function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function parseStyle(s: string | null): BadgeStyle {
  return BADGE_STYLES.includes(s as BadgeStyle) ? (s as BadgeStyle) : "flat";
}

/**
 * Pick the value-side text color for legibility on its fill. The lighter brand level fills
 * (L3 yellow / L4 lime / L5 green) fail behind white, so choose whichever of white / near-black
 * ink has the higher WCAG contrast against the fill. Accepts #rgb or #rrggbb; defaults to white.
 */
export function readableOn(bg: string): string {
  const h = bg.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#fff";
  // Route the WCAG luminance through the canonical ui.ts primitives (rgbOf + relLuminance) rather
  // than re-deriving the channel-linearization math here. The badge keeps its OWN contrast pick
  // (white vs near-black ink) so the chosen color is byte-identical to before.
  const L = relLuminance(rgbOf(full));
  const contrastWhite = 1.05 / (L + 0.05);
  const contrastInk = (L + 0.05) / 0.05;
  return contrastInk > contrastWhite ? "#04070e" : "#fff";
}

/** Named colors map to brand hex; a #rrggbb / rrggbb value is accepted verbatim.
 *
 *  SCOPE (usage-metering 07-16 #5): `?color=` is shields.io-parity for the NEUTRAL states only
 *  (unknown / private / rate limited — no verdict to misrepresent). It deliberately does NOT apply
 *  to a VERDICT fill (gate pass/fail, a resolved level/score): hue is the most-glanced channel on a
 *  README, and letting an embedder render "✗ fail" on bright green (or an L1 repo in L5 green)
 *  would undo every other honesty guard this route carries (demo suffix, glyph redundancy, private
 *  gating). Mirrors how the demo suffix refuses to let a mock pose as a verdict. */
export function resolveColor(input: string | null, fallback: string): string {
  if (!input) return fallback;
  const named: Record<string, string> = {
    brightgreen: LEVEL_HEX.L5,
    green: LEVEL_HEX.L4,
    yellow: LEVEL_HEX.L3,
    orange: LEVEL_HEX.L2,
    red: LEVEL_HEX.L1,
    blue: "#3b9eff",
    lightgrey: "#94a3b8",
    gray: "#64748b",
    grey: "#64748b",
  };
  const v = input.toLowerCase();
  if (named[v]) return named[v];
  const hex = v.startsWith("#") ? v.slice(1) : v;
  if (/^[0-9a-f]{3}$|^[0-9a-f]{6}$/.test(hex)) return `#${hex}`;
  return fallback;
}

/** The neutral (no-verdict) fill: unknown / private / rate-limited / not-yet-scored. */
export const BADGE_NEUTRAL = "#64748b";

export function badgeSvg(opts: {
  label: string;
  value: string;
  color: string;
  style: BadgeStyle;
  logo?: string | null;
  href?: string | null;
}): string {
  const { label, value, color, style } = opts;
  const big = style === "for-the-badge";
  const fontSize = big ? 11 : 12;
  // AVERAGE Latin glyph width for proportional Verdana at this font size (6.7px at 12px; 7.2 at the
  // 11px uppercase for-the-badge style) — an average-case estimate tuned against typical badge text,
  // NOT a per-character width table (shields.io ships one for exactly this reason). Verdana glyphs
  // actually range ~3px (i/l/.) to ~11px (W/M) at 12px, so the estimate over/under-shoots on skewed
  // strings; wide non-ASCII glyphs (CJK, emoji) are counted DOUBLE below, and the rendered <text>
  // pins textLength to the same estimate so any residual error is absorbed by the renderer
  // squeezing/stretching the run instead of overrunning the label/value boundary (fail-soft).
  const charW = big ? 7.2 : 6.7;
  // for-the-badge renders uppercase with letter-spacing="1"; fold that 1px-per-gap into the width
  // estimate so long values ("L5 Autonomous") aren't clipped against the value fill boundary.
  const letterSpace = big ? 1 : 0;
  const pad = 10;
  const h = big ? 28 : style === "flat-square" ? 20 : 28;
  const rx = style === "flat-square" || big ? 0 : 4;
  const logoW = opts.logo ? 18 : 0;

  const renderLabel = big ? label.toUpperCase() : label;
  const renderValue = big ? value.toUpperCase() : value;
  const ls = big ? `letter-spacing="1"` : "";

  // Codepoint-aware width units: CJK/emoji/symbol glyphs render roughly double an average Latin
  // glyph at these sizes, and `?label=` accepts arbitrary text — pricing every character at charW
  // made a CJK project name overrun the label rect into the value fill. Iterating the string
  // iterator (not .length) also stops surrogate pairs from double-counting as two glyphs.
  const widthUnits = (s: string) => {
    let units = 0;
    let glyphs = 0;
    for (const ch of s) {
      glyphs += 1;
      units += (ch.codePointAt(0) ?? 0) > 0x7f ? 2 : 1;
    }
    return { units, glyphs };
  };
  const textW = (s: string) => {
    const { units, glyphs } = widthUnits(s);
    return Math.ceil(units * charW + Math.max(0, glyphs - 1) * letterSpace);
  };
  const lw = textW(renderLabel) + pad * 2 + logoW;
  const vw = textW(renderValue) + pad * 2;
  const w = lw + vw;
  // Vertically center the text for ANY height/font — was a +4 constant tuned for the 28px/12px default.
  const ty = Math.round(h / 2 + fontSize / 3);

  const gradient =
    style === "flat" || big
      ? `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>`
      : "";
  const gradientRect = style === "flat" || big ? `<rect rx="${rx}" width="${w}" height="${h}" fill="url(#s)"/>` : "";
  const logoEl = opts.logo
    ? `<image x="${pad}" y="${Math.round((h - 14) / 2)}" width="14" height="14" href="${esc(opts.logo)}"/>`
    : "";
  const labelX = pad + logoW;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" role="img" aria-label="${esc(label)}: ${esc(value)}">
  ${gradient}
  <rect rx="${rx}" width="${w}" height="${h}" fill="#0f172a"/>
  <rect rx="${rx}" x="${lw}" width="${vw}" height="${h}" fill="${esc(color)}"/>
  ${gradientRect}
  <rect rx="${rx}" x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="none" stroke="rgba(148,163,184,0.4)" stroke-width="1"/>
  ${logoEl}
  <g font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="${fontSize}" font-weight="600" ${ls}>
    <text x="${labelX}" y="${ty}" fill="#cbd5e1" textLength="${textW(renderLabel)}" lengthAdjust="spacingAndGlyphs">${esc(renderLabel)}</text>
    <text x="${lw + pad}" y="${ty}" fill="${readableOn(color)}" textLength="${textW(renderValue)}" lengthAdjust="spacingAndGlyphs">${esc(renderValue)}</text>
  </g>
</svg>`;

  // When the SVG is loaded directly (not via <img>), wrap it so it clicks through to the
  // report — Codecov-style. README markdown additionally wraps the <img> in a link.
  if (opts.href) {
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" role="img" aria-label="${esc(label)}: ${esc(value)}"><a xlink:href="${esc(opts.href)}" target="_blank">${svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")}</a></svg>`;
  }
  return svg;
}

// Cache policy is branched by OUTCOME. A transient/throttled/neutral badge must not share the long
// public TTL of a real resolved level — otherwise a 10-min CDN entry pins "rate limited"/"unknown"
// for every README viewer past the blip. And a query-customized body must not be served
// cross-consumer by a path-only CDN — only the canonical, un-customized resolved badge is shared.
export const CACHE_RESOLVED = "public, max-age=600, s-maxage=600"; // a real, un-customized level / gate
export const CACHE_CUSTOM = "private, max-age=600"; //               body varies by caller params → not shared
export const CACHE_NEUTRAL = "public, max-age=30, s-maxage=30"; //   unknown / private — may change soon
export const CACHE_TRANSIENT = "no-store"; //                        429 / upstream blip — never cache
// The FIFTH outcome, previously an unnamed inline ternary in the repo badge route: a verdict we
// RESOLVED but could not PIN to a head commit (head resolution failed — a transient blip, no
// GITHUB_TOKEN, or a rate-limited head lookup), so it is keyed by the un-pinned owner/repo form and is
// best-effort/possibly stale. It deliberately carries the SAME string as CACHE_NEUTRAL (the short TTL,
// so the next hit re-resolves the head once the blip clears) — aliasing rather than re-typing the value
// is what guarantees a rename can never drift the emitted `Cache-Control` byte string that CDN
// behaviour depends on. It is named separately because the REASON differs from "unknown / private":
// here we DID produce a real verdict, we just could not tie it to a commit.
export const CACHE_UNPINNED = CACHE_NEUTRAL;

/** An `image/svg+xml` Response with the outcome-appropriate cache policy. */
export function badgeResponse(
  svg: string,
  init?: { status?: number; retryAfter?: number; cache?: string },
): Response {
  const headers: Record<string, string> = {
    "content-type": "image/svg+xml; charset=utf-8",
    "cache-control": init?.cache ?? CACHE_RESOLVED,
  };
  if (init?.retryAfter) headers["retry-after"] = String(init.retryAfter);
  return new Response(svg, { status: init?.status ?? 200, headers });
}
