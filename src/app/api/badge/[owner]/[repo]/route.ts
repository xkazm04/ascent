// GET /api/badge/:owner/:repo  ->  SVG maturity badge for READMEs.
//
// Uses a cached report if available, otherwise runs a fast deterministic (mock) scan.
//
// Hardening (this endpoint is unauthenticated and publicly embeddable, so crawlers and
// READMEs hammer it):
//   - owner/repo are validated against GitHub's name grammar BEFORE anything touches the
//     scan/cache layers — a malformed path returns the neutral "unknown" badge immediately.
//   - per-IP rate limiting gates the expensive scanRepository() call (a cheap static badge
//     is still returned, so a README image never breaks).
//   - a short negative cache remembers "unknown" repos so repeated misses don't re-scan and
//     flood the shared report cache (cache thrash that would evict real reports).
//
// Customization (shields.io-style):
//   - style: flat (default) | flat-square | for-the-badge
//   - label, color (named or hex), logo (a `data:` URI only — no external fetch)
//   - the embedded SVG links through to the live report (works when loaded as an SVG; the
//     copy-paste markdown also wraps it in a link).

import { NextResponse } from "next/server";
import { scanRepository, GitHubError } from "@/lib/scan";
import { resolveHeadWithHint } from "@/lib/scan-cache";
import { cacheGet, cacheSet, makeCacheKey, normalizeRepoName } from "@/lib/cache";
import { evaluateGate, policyFromParams } from "@/lib/scoring/gate";
import { LEVEL_GLYPH, LEVEL_HEX } from "@/lib/ui";
import type { LevelId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---- validation -------------------------------------------------------------

// GitHub's name grammar: owners ≤39 chars, repos ≤100, [A-Za-z0-9._-], and never "."/"..".
const NAME_RE = /^[A-Za-z0-9_.-]+$/;
function validName(s: string, max: number): boolean {
  return Boolean(s) && s.length <= max && NAME_RE.test(s) && s !== "." && s !== "..";
}

// ---- per-IP rate limiting (in-memory sliding window) ------------------------

const RATE_LIMIT = 60; // scans per window…
const RATE_WINDOW_MS = 60_000; // …per minute, per IP
const hits = new Map<string, number[]>();

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** True when this IP is over its window budget. Also prunes the window in place. */
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const recent = (hits.get(ip) ?? []).filter((t) => t > cutoff);
  recent.push(now);
  hits.set(ip, recent);
  // Opportunistic cleanup so the map can't grow unbounded across many IPs.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => t <= cutoff)) hits.delete(k);
  }
  return recent.length > RATE_LIMIT;
}

// ---- short negative cache for unknown repos --------------------------------

const NEG_TTL_MS = 5 * 60_000;
const negCache = new Map<string, number>(); // key -> expiry
function negGet(key: string): boolean {
  const exp = negCache.get(key);
  if (exp == null) return false;
  if (Date.now() > exp) {
    negCache.delete(key);
    return false;
  }
  return true;
}
function negSet(key: string): void {
  negCache.set(key, Date.now() + NEG_TTL_MS);
}

// ---- SVG rendering ----------------------------------------------------------

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Pick the value-side text color for legibility on its fill. The lighter brand level fills
 * (L3 yellow / L4 lime / L5 green) fail behind white, so choose whichever of white / near-black
 * ink has the higher WCAG contrast against the fill. Accepts #rgb or #rrggbb; defaults to white.
 */
function readableOn(bg: string): string {
  const h = bg.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#fff";
  const lin = (i: number) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
  const contrastWhite = 1.05 / (L + 0.05);
  const contrastInk = (L + 0.05) / 0.05;
  return contrastInk > contrastWhite ? "#04070e" : "#fff";
}

type BadgeStyle = "flat" | "flat-square" | "for-the-badge";

/** Named colors map to brand hex; a #rrggbb / rrggbb value is accepted verbatim. */
function resolveColor(input: string | null, fallback: string): string {
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

function badgeSvg(opts: {
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
  const charW = big ? 7.2 : 6.7;
  const pad = 10;
  const h = big ? 28 : style === "flat-square" ? 20 : 28;
  const rx = style === "flat-square" || big ? 0 : 4;
  const logoW = opts.logo ? 18 : 0;

  const renderLabel = big ? label.toUpperCase() : label;
  const renderValue = big ? value.toUpperCase() : value;
  const ls = big ? `letter-spacing="1"` : "";

  const lw = Math.ceil(renderLabel.length * charW) + pad * 2 + logoW;
  const vw = Math.ceil(renderValue.length * charW) + pad * 2;
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
    <text x="${labelX}" y="${ty}" fill="#cbd5e1">${esc(renderLabel)}</text>
    <text x="${lw + pad}" y="${ty}" fill="${readableOn(color)}">${esc(renderValue)}</text>
  </g>
</svg>`;

  // When the SVG is loaded directly (not via <img>), wrap it so it clicks through to the
  // report — Codecov-style. README markdown additionally wraps the <img> in a link.
  if (opts.href) {
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" role="img" aria-label="${esc(label)}: ${esc(value)}"><a xlink:href="${esc(opts.href)}" target="_blank">${svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")}</a></svg>`;
  }
  return svg;
}

function respond(svg: string, init?: { status?: number; retryAfter?: number }) {
  const headers: Record<string, string> = {
    "content-type": "image/svg+xml; charset=utf-8",
    "cache-control": "public, max-age=600, s-maxage=600",
  };
  if (init?.retryAfter) headers["retry-after"] = String(init.retryAfter);
  return new NextResponse(svg, { status: init?.status ?? 200, headers });
}

function parseStyle(s: string | null): BadgeStyle {
  return s === "flat-square" || s === "for-the-badge" ? s : "flat";
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ owner: string; repo: string }> },
) {
  const { owner, repo } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const gateMode = searchParams.has("gate");
  const style = parseStyle(searchParams.get("style"));
  const customLabel = searchParams.get("label");
  const customColor = searchParams.get("color");
  // Only embed a self-contained data: URI logo — never fetch an external URL (SSRF).
  const logoParam = searchParams.get("logo");
  const logo = logoParam && logoParam.startsWith("data:image/") ? logoParam : null;
  const neutral = "#64748b";

  const defaultLabel = gateMode ? "Ascent gate" : "Ascent";
  const label = customLabel ?? defaultLabel;

  // 1. Normalize BEFORE validating or keying. GitHub names are case-insensitive and a route
  //    segment can arrive percent-encoded, so `Facebook/React`, `facebook/react`, and
  //    `facebook%2Dreact` must collapse to one identity — otherwise the badge keys a different
  //    cache entry than the scan flow and can show a stale mock level after a real LLM scan.
  const ownerN = normalizeRepoName(owner);
  const repoN = normalizeRepoName(repo);

  // 2. Validate the normalized path BEFORE touching scan/cache. Malformed → neutral badge.
  if (!validName(ownerN, 39) || !validName(repoN, 100)) {
    return respond(badgeSvg({ label, value: "unknown", color: resolveColor(customColor, neutral), style, logo }));
  }

  const key = `${ownerN}/${repoN}`;

  // 3. Negative cache: a recently-failed repo returns "unknown" without re-scanning.
  if (negGet(key)) {
    return respond(badgeSvg({ label, value: "unknown", color: resolveColor(customColor, neutral), style, logo }));
  }

  // Click-through to the live report (shareable permalink).
  const origin = new URL(req.url).origin;
  const href = `${origin}/report/${ownerN}/${repoN}`;

  try {
    // Resolve the current head commit so the badge reads (and writes) the SAME per-commit entry
    // the scan flow keys — otherwise a SHA-pinned real LLM scan would never be found here, and a
    // push wouldn't refresh the badge (it would advertise the pre-push level for up to the TTL).
    // CONDITIONAL (If-None-Match) via the shared head-hint store: an unchanged repo answers a free
    // 304, so a README badge hit by every viewer doesn't burn a rate-limit unit per request.
    // Null on failure falls back to a SHA-less key.
    const sha = await resolveHeadWithHint({ owner: ownerN, repo: repoN }, process.env.GITHUB_TOKEN);
    // One key scheme shared with the scan/cache layer (makeCacheKey), so the badge reflects a
    // real LLM scan when one exists instead of resolving to a duplicate mock entry.
    const mockKey = makeCacheKey(ownerN, repoN, false, sha);
    const llmKey = makeCacheKey(ownerN, repoN, true, sha);
    let report = cacheGet(llmKey) ?? cacheGet(mockKey);

    if (!report) {
      // 4. Rate-limit the EXPENSIVE path (a fresh scan). Over budget → cheap static badge +
      //    429, so we never run scanRepository for a flood of unique owner/repo combos.
      if (rateLimited(clientIp(req))) {
        return respond(
          badgeSvg({ label, value: "rate limited", color: resolveColor(customColor, neutral), style, logo }),
          { status: 429, retryAfter: 60 },
        );
      }
      report = await scanRepository(`${ownerN}/${repoN}`, { mock: true });
      cacheSet(mockKey, report);
    }

    // Gate badge: a green pass / red fail against the (configurable, archetype-aware) policy.
    if (gateMode) {
      const gate = evaluateGate(report, policyFromParams(searchParams, report.archetype));
      return respond(
        badgeSvg({
          label,
          // ✓/✗ so the pass/fail verdict survives without color (red/green collapses for CVD viewers).
          value: gate.pass ? "✓ pass" : "✗ fail",
          color: resolveColor(customColor, gate.pass ? LEVEL_HEX.L5 : LEVEL_HEX.L1),
          style,
          logo,
          href,
        }),
      );
    }

    const color = resolveColor(customColor, LEVEL_HEX[report.level.id as LevelId] ?? neutral);
    return respond(
      // Prepend the level glyph (○◔◑◕●) so the red→green level isn't signalled by hue alone — the
      // same non-color redundancy lib/ui.ts mandates everywhere a level color appears in the app.
      badgeSvg({
        label,
        value: `${LEVEL_GLYPH[report.level.id as LevelId]} ${report.level.id} ${report.level.name}`,
        color,
        style,
        logo,
        href,
      }),
    );
  } catch (err) {
    // Only negative-cache a GENUINE not-found/invalid/empty repo. A transient failure (GitHub rate
    // limit, upstream 5xx, network blip) thrown by resolveHeadWithHint/scanRepository must NOT pin a
    // perfectly valid public repo to "unknown" for the full NEG_TTL — every README viewer would then
    // see a broken badge long after the blip cleared. On a transient error we still serve the neutral
    // badge (so the image never breaks) but leave the cache clean, so the next hit re-resolves.
    const genuineMiss =
      err instanceof GitHubError &&
      (err.code === "NOT_FOUND" || err.code === "EMPTY" || err.code === "INVALID_URL");
    if (genuineMiss) negSet(key);
    return respond(badgeSvg({ label, value: "unknown", color: resolveColor(customColor, neutral), style, logo }));
  }
}
