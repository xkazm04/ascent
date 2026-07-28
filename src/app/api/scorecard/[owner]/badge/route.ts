// GET /api/scorecard/:owner/badge  ->  SVG org-level maturity badge (G7-06).
//
// The org sibling of `/api/badge/:owner/:repo`, drawn by the SAME renderer (`@/lib/badge-svg`) so the
// two can't drift. Differences are deliberate and all in the honesty direction:
//
//   - READ-ONLY. It never triggers a scan. The per-repo badge falls back to a fresh mock scan so a
//     README image is never broken; an ORG aggregate has no such contract, and inventing one from a
//     mock would publish a number no model produced. Nothing scored ⇒ neutral "not scored" badge.
//   - PUBLIC CORPUS ONLY. `getPublicOrgScorecard` pins every read to the shared public org and
//     `isPrivate:false`, and drops private rows per row. A private repo can therefore not move — or
//     even reach — this badge.
//   - PROVENANCE IS A REFUSAL, NOT A SUFFIX. The per-repo badge can honestly say "L3 · demo" because
//     it is one repo's own preview. An org AVERAGE over previews is not a preview of anything real,
//     so this badge renders the neutral "preview only" state instead of a qualified number.
//
// Unauthenticated + embeddable, so it carries the same hardening posture as its sibling: name-grammar
// validation before any DB touch, per-IP rate limiting, and outcome-branched cache policy.

import { validRepoNamePart } from "@/lib/badge";
import {
  BADGE_NEUTRAL,
  CACHE_CUSTOM,
  CACHE_NEUTRAL,
  CACHE_RESOLVED,
  CACHE_TRANSIENT,
  badgeResponse,
  badgeSvg,
  parseStyle,
  resolveColor,
} from "@/lib/badge-svg";
import { getPublicOrgScorecard } from "@/lib/register/data";
import { rateLimitRequest, BADGE_RATE_LIMIT } from "@/lib/rate-limit";
import { LEVEL_GLYPH, LEVEL_HEX } from "@/lib/ui";
import type { LevelId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LABEL_LEN = 80;

export async function GET(req: Request, ctx: { params: Promise<{ owner: string }> }) {
  const { owner } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const style = parseStyle(searchParams.get("style"));
  const rawLabel = searchParams.get("label");
  const label = rawLabel != null ? rawLabel.slice(0, MAX_LABEL_LEN) : "Ascent org";
  const customColor = searchParams.get("color");
  const scoreMode = searchParams.get("metric") === "score";
  // Any query param varies the body, so only the canonical (bare) badge is shared-CDN-cacheable.
  const customized = [...searchParams.keys()].length > 0;
  const neutralCache = customized ? CACHE_CUSTOM : CACHE_NEUTRAL;
  const neutralBadge = (value: string, cache = neutralCache) =>
    badgeResponse(badgeSvg({ label, value, color: resolveColor(customColor, BADGE_NEUTRAL), style }), { cache });

  // Validate the owner segment BEFORE any DB touch — a malformed path is a cheap neutral badge.
  const ownerN = owner.trim().toLowerCase();
  if (!ownerN || ownerN.length > 39 || !validRepoNamePart(ownerN)) return neutralBadge("unknown");

  // The lookup is a bounded DB read on an unauthenticated, crawler-reachable endpoint. Share the
  // per-repo badge's limiter budget rather than minting a second one.
  const rl = rateLimitRequest(req, BADGE_RATE_LIMIT);
  if (!rl.ok) {
    return badgeResponse(
      badgeSvg({ label, value: "rate limited", color: resolveColor(customColor, BADGE_NEUTRAL), style }),
      { status: 429, retryAfter: rl.retryAfterSec, cache: CACHE_TRANSIENT },
    );
  }

  const card = await getPublicOrgScorecard(ownerN).catch(() => null);
  // No public scans at all for this owner. Neutral, short TTL — it may become true shortly.
  if (!card) return neutralBadge("not scored");
  // Scans exist but every one of them was a deterministic preview. Refuse the number outright.
  if (card.verifiedCount === 0) return neutralBadge("preview only");

  const levelId = card.level as LevelId;
  // Semantic level colour ONLY — `?color=` must never dress a low-level org in L5 green (the scope
  // rule `resolveColor` documents). Only an unrecognized level id falls back to the caller's colour.
  const color = LEVEL_HEX[levelId] ?? resolveColor(customColor, BADGE_NEUTRAL);
  const origin = new URL(req.url).origin;
  // `?ref=badge` tags the click-through so a README embed is attributable, exactly as the repo badge does.
  const href = `${origin}/scorecard/${ownerN}?ref=badge`;
  // The glyph carries the level without relying on hue (CVD redundancy), matching the repo badge.
  const value = scoreMode
    ? `${LEVEL_GLYPH[levelId]} ${card.avgOverall}/100`
    : `${LEVEL_GLYPH[levelId]} ${card.level} ${card.levelName}`;

  return badgeResponse(badgeSvg({ label, value, color, style, href }), {
    cache: customized ? CACHE_CUSTOM : CACHE_RESOLVED,
  });
}
