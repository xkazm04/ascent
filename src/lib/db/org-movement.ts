// "What moved since you last looked" — the read side of the org Alerts chip's movement count.
//
// THE GAP THIS CLOSES: the fleet dashboard had no unread state anywhere. A lead who returns on Monday
// sees current numbers with no marker of what changed since their last visit — the exact question
// fleet intelligence exists to answer. The movement data was ALREADY persisted: the scan pipeline
// feeds every regression, maturity band change and closed recommendation into Shared Org Memory
// (src/lib/memory/scan-feed.ts). So this is a READ over records that already exist — deliberately NOT
// a new event system, a new table, or a write path that could fail a scan.
//
// ONE BOUNDED QUERY: a single OrgMemory findMany with `take: CAP + 1`, filtered to the scan-pipeline
// source and `createdAt > since`. No per-repo fan-out (the chip renders on every org page), and the
// +1 row is what tells the UI to render the capped "9+" instead of needing a second count query.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { SCAN_PIPELINE_SOURCE } from "@/lib/org/memory-kinds";

/** How many movements the popover lists — and the display cap: more than this renders as "9+". */
export const MOVEMENT_CAP = 9;

export interface OrgMovementItem {
  /** Repo full name the movement is about (the memory's namespace), or null for an org-wide record. */
  repo: string | null;
  /** Event kind from the memory's tags: regression | level-change | recommendation-closed. */
  event: string;
  /** The persisted one-line description (machine-written, already human-readable). */
  summary: string;
  at: Date;
}

export interface OrgMovement {
  /** The watermark this count is measured from. */
  since: Date;
  items: OrgMovementItem[];
  /** Movements since the watermark, saturating at MOVEMENT_CAP (see `capped`). */
  count: number;
  /** True when there were MORE than MOVEMENT_CAP — the count is a floor, render it as "9+". */
  capped: boolean;
}

/** The event tag a scan-fed memory carries as tags[1] (`[repo, event]`); "" when unparsable. */
function eventTag(raw: string | null | undefined): string {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) && typeof parsed[1] === "string" ? parsed[1] : "";
  } catch {
    return "";
  }
}

/**
 * Movements recorded for `orgSlug` strictly AFTER `since`. Returns an empty (count 0) movement rather
 * than null when nothing moved, and null only when there's nothing to read from (persistence off or
 * unknown org) — so the caller can tell "you're up to date" from "no data here", and the chip can
 * degrade to its old static self in the latter case.
 *
 * Never throws is NOT promised here (the API route wraps it); the callers all sit behind a route that
 * treats a failure as "no movement", keeping this function honest about a genuine DB error.
 */
export async function getOrgMovementSince(
  orgSlug: string,
  since: Date,
  cap: number = MOVEMENT_CAP,
): Promise<OrgMovement | null> {
  if (!isDbConfigured()) return null;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  const rows = await getPrisma().orgMemory.findMany({
    where: {
      orgId,
      source: SCAN_PIPELINE_SOURCE,
      archived: false,
      supersededBy: null,
      createdAt: { gt: since },
    },
    orderBy: { createdAt: "desc" },
    // cap + 1: the extra row is the "there are more than we show" probe, so the capped display costs
    // no second query.
    take: cap + 1,
    select: { namespace: true, tags: true, content: true, createdAt: true },
  });
  const capped = rows.length > cap;
  const items = rows.slice(0, cap).map((r) => ({
    repo: r.namespace ?? null,
    event: eventTag(r.tags),
    summary: r.content,
    at: r.createdAt,
  }));
  return { since, items, count: items.length, capped };
}
