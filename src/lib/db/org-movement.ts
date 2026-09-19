// "What moved since you last looked" — the read side of the org Alerts chip's movement count.
//
// THE GAP THIS CLOSES: the fleet dashboard had no unread state anywhere. A lead who returns on Monday
// sees current numbers with no marker of what changed since their last visit — the exact question
// fleet intelligence exists to answer. Scan-pipeline regressions, band changes and closed gaps already
// land in Shared Org Memory (src/lib/memory/scan-feed.ts). Control-ledger flips do not: they are
// recorded as AlertEvent (`kind: "control"`) because a control can change between scans, and a memory
// row never appears. Counting only OrgMemory left the Alerts badge silent after a control-failed.
//
// TWO BOUNDED READS, not a per-repo fan-out (the chip renders on every org page): OrgMemory (scan
// pipeline, createdAt > since) UNION control-failed AlertEvents (kind control + severity critical,
// same window). Each `take: CAP + 1`; the extra row is the "9+" probe so the capped display costs no
// count query. Merged newest-first, then sliced to the cap.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { SCAN_PIPELINE_SOURCE } from "@/lib/org/memory-kinds";

/** How many movements the popover lists — and the display cap: more than this renders as "9+". */
export const MOVEMENT_CAP = 9;

/** Event tag written for a control-failed AlertEvent folded into the movement list. */
export const CONTROL_FAILED_EVENT = "control-failed";

export interface OrgMovementItem {
  /** Repo full name the movement is about (the memory's namespace), or null for an org-wide record. */
  repo: string | null;
  /** Event kind: regression | level-change | recommendation-closed | control-failed. */
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

function byNewest(a: OrgMovementItem, b: OrgMovementItem): number {
  return b.at.getTime() - a.at.getTime();
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
  const prisma = getPrisma();
  const take = cap + 1;
  // Independent tables, same window. control-failed is severity critical (controlAlertSeverity);
  // restorations/unmeasurable are history, not unread movement on the chip.
  const [memoryRows, controlRows] = await Promise.all([
    prisma.orgMemory.findMany({
      where: {
        orgId,
        source: SCAN_PIPELINE_SOURCE,
        archived: false,
        supersededBy: null,
        createdAt: { gt: since },
      },
      orderBy: { createdAt: "desc" },
      take,
      select: { namespace: true, tags: true, content: true, createdAt: true },
    }),
    prisma.alertEvent.findMany({
      where: {
        orgId,
        kind: "control",
        severity: "critical",
        createdAt: { gt: since },
      },
      orderBy: { createdAt: "desc" },
      take,
      select: { repoFullName: true, title: true, createdAt: true },
    }),
  ]);
  const merged: OrgMovementItem[] = [
    ...memoryRows.map((r) => ({
      repo: r.namespace ?? null,
      event: eventTag(r.tags),
      summary: r.content,
      at: r.createdAt,
    })),
    ...controlRows.map((r) => ({
      repo: r.repoFullName ?? null,
      event: CONTROL_FAILED_EVENT,
      summary: r.title,
      at: r.createdAt,
    })),
  ].sort(byNewest);
  const capped = merged.length > cap;
  const items = merged.slice(0, cap);
  return { since, items, count: items.length, capped };
}
