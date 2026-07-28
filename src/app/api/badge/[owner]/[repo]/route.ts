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

import { scanRepository, GitHubError } from "@/lib/scan";
import { resolveHeadWithHint } from "@/lib/scan-cache";
import { cacheGet, cacheSet, makeCacheKey, normalizeRepoName } from "@/lib/cache";
import { evaluateGate, explicitPolicyFromParams, policyFromParams, tightenGatePolicy } from "@/lib/scoring/gate";
import { getOrgGatePolicy } from "@/lib/db/org-gate";
import { rateLimitRequest, BADGE_RATE_LIMIT } from "@/lib/rate-limit";
import { recordBadgeImpression, recordQuotaEvent } from "@/lib/db";
import { LEVEL_GLYPH, LEVEL_HEX } from "@/lib/ui";
import { badgeReportHref, validRepoNamePart } from "@/lib/badge";
import {
  BADGE_NEUTRAL,
  CACHE_CUSTOM,
  CACHE_NEUTRAL,
  CACHE_TRANSIENT,
  CACHE_RESOLVED,
  badgeResponse,
  badgeSvg,
  parseStyle,
  resolveColor,
} from "@/lib/badge-svg";
import type { LevelId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---- validation -------------------------------------------------------------

// GitHub's name grammar: owners ≤39 chars, repos ≤100, [A-Za-z0-9._-], and never "."/"..". The
// character-class + dot-position rule is single-sourced in `validRepoNamePart` (@/lib/badge, G5-28) so
// the client `BadgeGenerator`'s `parseRepo` can't drift from what this route actually accepts; only the
// per-segment length cap is local to the server (the client never needs it before the round-trip).
function validName(s: string, max: number): boolean {
  return s.length <= max && validRepoNamePart(s);
}

// Caps on caller-supplied badge customization. The SVG width and response size scale with these, and
// both are unauthenticated query params on a publicly-embeddable endpoint — an uncapped ?label= or a
// multi-MB ?logo=data:image/... is a response-amplification lever (and renders a broken giant badge).
const MAX_LABEL_LEN = 80; // a badge label is a few words
const MAX_LOGO_LEN = 4096; // a small inline data:image icon (~4 KB)
// Raster image types only — explicitly NOT svg+xml (scriptable nested SVG → XSS on a directly-loaded
// image/svg+xml badge). Matches `data:image/png;base64,…` and `data:image/png,…`.
const RASTER_LOGO_RE = /^data:image\/(png|jpe?g|gif|webp)[;,]/i;

// ---- short negative cache for unknown repos --------------------------------

const NEG_TTL_MS = 5 * 60_000;
// Hard cap on the negative cache. It's a lazy delete-on-read TTL map on a PUBLIC, crawler-hammered
// endpoint: a crawler hitting endless unique non-existent owner/repo paths (all passing validName) each
// add a key that's never re-queried, so delete-on-read never fires and the map grows without bound (slow
// memory leak → OOM on a long-lived instance). Bounding it makes that impossible. Env-overridable.
const NEG_MAX = (() => {
  const n = Number(process.env.BADGE_NEG_CACHE_MAX);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5000;
})();
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
  // Sweep expired entries (and, if still at the cap, evict oldest-inserted ≈ LRU) BEFORE inserting, so
  // the map can never exceed NEG_MAX regardless of how many unique misses a crawler throws at it.
  if (negCache.size >= NEG_MAX) {
    const now = Date.now();
    for (const [k, exp] of negCache) if (now > exp) negCache.delete(k);
    while (negCache.size >= NEG_MAX) {
      const oldest = negCache.keys().next().value; // Map preserves insertion order
      if (oldest === undefined) break;
      negCache.delete(oldest);
    }
  }
  negCache.set(key, Date.now() + NEG_TTL_MS);
}

// ---- SVG rendering ----------------------------------------------------------
// The renderer + its cache-policy vocabulary now live in `@/lib/badge-svg` so the org-level scorecard
// badge (`/api/scorecard/[owner]/badge`) draws the SAME artwork with the SAME honesty rules instead of
// forking a near-copy. Pure relocation — the emitted bytes are unchanged.

const respond = badgeResponse;

/** The embedding page's host (lowercased) for badge-reach attribution, or "direct" when absent/unparseable. */
function refererHost(req: Request): string {
  const ref = req.headers.get("referer");
  if (!ref) return "direct";
  try {
    return new URL(ref).host.toLowerCase() || "direct";
  } catch {
    return "direct";
  }
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ owner: string; repo: string }> },
) {
  const { owner, repo } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const gateMode = searchParams.has("gate");
  // Badge metric (USE-2): "score" renders the numeric 0..100 (with the level colour) instead of the
  // level label. Default = level. The report already carries overallScore — it was just discarded here.
  const scoreMode = searchParams.get("metric") === "score";
  const style = parseStyle(searchParams.get("style"));
  // Length-cap the caller-supplied label (truncate, don't reject — a slightly long label still renders).
  const customLabelRaw = searchParams.get("label");
  const customLabel = customLabelRaw != null ? customLabelRaw.slice(0, MAX_LABEL_LEN) : null;
  const customColor = searchParams.get("color");
  // Only embed a self-contained RASTER data: URI logo — never fetch an external URL (SSRF), never a
  // data:image/svg+xml (a nested, SCRIPTABLE SVG that executes when this badge is loaded DIRECTLY as
  // image/svg+xml — active-content XSS), and only within the size cap so a multi-MB data URI can't
  // bloat the response. The intent was always "a small inline icon", i.e. a raster image.
  const logoParam = searchParams.get("logo");
  const logo =
    logoParam && RASTER_LOGO_RE.test(logoParam) && logoParam.length <= MAX_LOGO_LEN ? logoParam : null;
  const neutral = BADGE_NEUTRAL;

  const defaultLabel = gateMode ? "Ascent gate" : "Ascent";
  const label = customLabel ?? defaultLabel;

  // Any query param customizes the body (style/label/color/logo/gate/policy), so a shared CDN
  // keying on path alone could serve one consumer's variant to another. Only the bare canonical
  // badge (no query) is shared-cacheable; customized variants are marked private.
  const customized = [...searchParams.keys()].length > 0;

  // 1. Normalize BEFORE validating or keying. GitHub names are case-insensitive and a route
  //    segment can arrive percent-encoded, so `Facebook/React`, `facebook/react`, and
  //    `facebook%2Dreact` must collapse to one identity — otherwise the badge keys a different
  //    cache entry than the scan flow and can show a stale mock level after a real LLM scan.
  const ownerN = normalizeRepoName(owner);
  const repoN = normalizeRepoName(repo);

  // 2. Validate the normalized path BEFORE touching scan/cache. Malformed → neutral badge.
  if (!validName(ownerN, 39) || !validName(repoN, 100)) {
    return respond(badgeSvg({ label, value: "unknown", color: resolveColor(customColor, neutral), style, logo }), { cache: customized ? CACHE_CUSTOM : CACHE_NEUTRAL });
  }

  const key = `${ownerN}/${repoN}`;

  // 3. Negative cache: a recently-failed repo returns "unknown" without re-scanning.
  if (negGet(key)) {
    return respond(badgeSvg({ label, value: "unknown", color: resolveColor(customColor, neutral), style, logo }), { cache: customized ? CACHE_CUSTOM : CACHE_NEUTRAL });
  }

  // Click-through to the live report (shareable permalink). `?ref=badge` tags the visit so a report
  // hit from a README badge is attributable in analytics / server logs (USE-1, the acquisition loop).
  const origin = new URL(req.url).origin;
  const href = badgeReportHref(origin, ownerN, repoN);

  try {
    // Resolve the current head commit so the badge reads (and writes) the SAME per-commit entry
    // the scan flow keys — otherwise a SHA-pinned real LLM scan would never be found here, and a
    // push wouldn't refresh the badge (it would advertise the pre-push level for up to the TTL).
    // CONDITIONAL (If-None-Match) via the shared head-hint store: an unchanged repo answers a free
    // 304, so a README badge hit by every viewer doesn't burn a rate-limit unit per request.
    // Null on failure falls back to a SHA-less key.
    const sha = await resolveHeadWithHint({ owner: ownerN, repo: repoN }, process.env.GITHUB_TOKEN);
    // A SHA-less badge (head resolution failed: a transient blip, no GITHUB_TOKEN, or a rate-limited
    // head lookup) is keyed by the un-pinned owner/repo::mode form and is best-effort/possibly stale —
    // don't let a CDN pin it for the full 10-min resolved TTL for every README viewer. Downgrade to the
    // short neutral TTL so the next hit re-resolves the head once the blip clears.
    const resolvedCache = sha ? CACHE_RESOLVED : CACHE_NEUTRAL;
    // One key scheme shared with the scan/cache layer (makeCacheKey), so the badge reflects a
    // real LLM scan when one exists instead of resolving to a duplicate mock entry.
    const mockKey = makeCacheKey(ownerN, repoN, false, sha);
    const llmKey = makeCacheKey(ownerN, repoN, true, sha);
    let report = cacheGet(llmKey) ?? cacheGet(mockKey);

    if (!report) {
      // 4. Rate-limit the EXPENSIVE path (a fresh scan) via the SHARED limiter — over budget → cheap
      //    static badge + 429, so we never run scanRepository for a flood of unique owner/repo combos.
      const rl = rateLimitRequest(req, BADGE_RATE_LIMIT);
      if (!rl.ok) {
        void recordQuotaEvent("rate_limit", "badge").catch(() => {}); // QUOTA-6: observability only
        return respond(
          badgeSvg({ label, value: "rate limited", color: resolveColor(customColor, neutral), style, logo }),
          { status: 429, retryAfter: rl.retryAfterSec, cache: CACHE_TRANSIENT },
        );
      }
      // Token-less by construction (noAmbientToken): never ingest a repo with the operator's
      // server PAT on this public endpoint, so a private repo simply 404s → neutral badge below.
      report = await scanRepository(`${ownerN}/${repoN}`, { mock: true, noAmbientToken: true });
      cacheSet(mockKey, report);
    }

    // Never disclose a PRIVATE repo's maturity on this public, unauthenticated endpoint. The fresh
    // scan above is token-less, so a private repo can't be ingested here — but the shared report
    // cache can hold a private repo's report left by an AUTHENTICATED scan, so gate on the resolved
    // report too. Serve a neutral "private" badge, never the level / gate verdict.
    if (report.repo.isPrivate) {
      return respond(badgeSvg({ label, value: "private", color: resolveColor(customColor, neutral), style, logo }), { cache: customized ? CACHE_CUSTOM : CACHE_NEUTRAL });
    }

    // USE-1: best-effort reach tally for the "Badge reach" panel on /usage. Fire-and-forget — never
    // awaited, never throws into this hot, CDN-fronted path. Counts only ORIGIN hits for a real public
    // badge (reached here past the validation / negative-cache / rate-limit / private gates), so it's a
    // lower bound on true views (most are served from the camo/CDN cache and never reach the origin).
    //
    // ONLY tally on the CANONICAL, CDN-cacheable path (no query params). A customized request is served
    // `private` (CACHE_CUSTOM) and never absorbed by the shared CDN, so EVERY hit reaches the origin — an
    // attacker could hit `?x=<rand>` with a unique forged `Referer` each time and mint an unbounded
    // (repo,host) row on this unauthenticated endpoint. The canonical badge is the one real READMEs embed
    // and the one the s-maxage CDN actually collapses, so restricting to it both bounds the write and
    // keeps the panel an honest lower-bound from cacheable traffic. (recordBadgeImpression additionally
    // normalizes junk hosts and caps distinct hosts/repo as defense-in-depth against direct-origin floods.)
    if (!customized) {
      void recordBadgeImpression(`${ownerN}/${repoN}`, refererHost(req)).catch(() => {});
    }

    // Be honest when the level/score/gate verdict came from the deterministic mock rubric (no LLM)
    // rather than a real AI scan: mark the badge "· demo" so a README badge can't present the
    // deterministic floor as the credible verdict (or silently diverge from the LLM report once one
    // exists). Mirrors the report header's `isMock` treatment. engine may be absent on a legacy /
    // partial cached report → treat as not-mock (don't mislabel a real report).
    const isMock = report.engine?.provider === "mock";
    const verdictLabel = isMock ? `${label} · demo` : label;

    // Gate badge: a green pass / red fail against the SAME policy /api/gate enforces.
    if (gateMode) {
      // Policy precedence, byte-identical to the gate endpoint (route.ts) — the org's PERSISTED policy
      // is the baseline whenever it exists, with explicit query params merged on top as a TIGHTEN-ONLY
      // overlay; no persisted policy → params over the archetype default, exactly as before.
      //
      // WHY (ci-gate Direction 2): this was the ONE of four gate surfaces that never read the org
      // policy. The endpoint, the App check run, and the fleet governance view all resolve it, so a
      // README badge could render a confident "✓ pass" while `/api/gate` FAILED the same repo against
      // the org's tightened bar — the badge quietly advertising a bar the org had raised. Same
      // unauthenticated-surface reasoning as the endpoint: a query param must never WEAKEN the
      // configured org bar, or any embedder could mint a green badge with ?min_dimension=1.
      const orgPolicy = await getOrgGatePolicy(ownerN).catch(() => null);
      const policy = orgPolicy
        ? tightenGatePolicy(orgPolicy, explicitPolicyFromParams(searchParams))
        : policyFromParams(searchParams, report.archetype);
      const gate = evaluateGate(report, policy);
      return respond(
        badgeSvg({
          label: verdictLabel,
          // ✓/✗ so the pass/fail verdict survives without color (red/green collapses for CVD viewers).
          value: gate.pass ? "✓ pass" : "✗ fail",
          // Semantic verdict color ONLY — `?color=` must not let "✗ fail" wear green (see resolveColor).
          color: gate.pass ? LEVEL_HEX.L5 : LEVEL_HEX.L1,
          style,
          logo,
          href,
        }),
        { cache: customized ? CACHE_CUSTOM : resolvedCache },
      );
    }

    // Semantic level color for a RESOLVED level — `?color=` must not dress an L1 repo in L5 green
    // (see resolveColor's scope note). Only an unrecognized level id (no verdict hue to protect)
    // falls back to the caller's custom color / neutral, matching the other neutral states.
    const levelHex = LEVEL_HEX[report.level.id as LevelId];
    const color = levelHex ?? resolveColor(customColor, neutral);
    // G5-29: the "· demo" qualifier previously only reached the LABEL (verdictLabel). A README author
    // can crop/restyle a badge so only the value half survives (or a screenshot shows just the value
    // chip), and a bare "63/100" / "L3 Established" is exactly as credible-looking as a real LLM-scored
    // verdict — so the value string itself must carry the qualifier too, not just the label next to it.
    const valueSuffix = isMock ? " · demo" : "";
    // Score variant (USE-2): the numeric headline (with the level glyph + colour) instead of the level name.
    if (scoreMode) {
      return respond(
        badgeSvg({ label: verdictLabel, value: `${LEVEL_GLYPH[report.level.id as LevelId]} ${report.overallScore}/100${valueSuffix}`, color, style, logo, href }),
        { cache: customized ? CACHE_CUSTOM : resolvedCache },
      );
    }
    return respond(
      // Prepend the level glyph (○◔◑◕●) so the red→green level isn't signalled by hue alone — the
      // same non-color redundancy lib/ui.ts mandates everywhere a level color appears in the app.
      badgeSvg({
        label: verdictLabel,
        value: `${LEVEL_GLYPH[report.level.id as LevelId]} ${report.level.id} ${report.level.name}${valueSuffix}`,
        color,
        style,
        logo,
        href,
      }),
      { cache: customized ? CACHE_CUSTOM : resolvedCache },
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
    return respond(badgeSvg({ label, value: "unknown", color: resolveColor(customColor, neutral), style, logo }), { cache: CACHE_TRANSIENT });
  }
}
