// One walk over an org's FILTERED audit trail, newest first, in getAuditLog pages of 100, under one row
// cap. Two readers share it: the CSV export (/api/audit?format=csv) and the integrity sweep
// (/api/audit/integrity). Sharing the loop is what makes "the sweep checked the rows the CSV files" true
// by construction rather than by two loops that happen to agree today.
//
// READ-ONLY. Nothing here writes an audit row: src/lib/db/audit-append.ts is the only write door, and a
// read that wrote would trip audit-writes.contract.test.ts.

import { getAuditLog, type AuditLogEntry } from "@/lib/db";

/** Rows per getAuditLog page while walking. */
export const AUDIT_WALK_PAGE_SIZE = 100;
/** Safety cap so one walk can't loop the whole table unbounded (the CSV's long-standing cap). */
export const AUDIT_WALK_MAX_ROWS = 10000;
/** How many tampered entries the sweep returns in full; `tampered` itself stays the true count. */
export const SWEEP_TAMPERED_ENTRIES_CAP = 50;

export interface AuditWalkFilters {
  action?: string;
  actorId?: string;
  since?: string;
  until?: string;
}

/** The ONE place a request's filter params become the walk's filter object (CSV, JSON and sweep). */
export function auditFiltersFromParams(searchParams: URLSearchParams): AuditWalkFilters {
  return {
    action: searchParams.get("action") ?? undefined,
    actorId: searchParams.get("actorId") ?? undefined,
    since: searchParams.get("since") ?? undefined,
    until: searchParams.get("until") ?? undefined,
  };
}

export interface AuditWalkResult {
  scanned: number;
  /** More rows remained when the walk stopped at the cap: the OLDEST rows were not visited. */
  truncated: boolean;
}

/**
 * Visit every row matching `filters`, newest first, until the trail ends or `cap` is reached. The cap is
 * checked between pages (a page is never split), exactly as the CSV loop always did. `truncated` is
 * true when a cursor is still set at the end, i.e. more rows existed than were visited.
 */
export async function walkAuditLog(
  org: string,
  filters: AuditWalkFilters,
  { cap = AUDIT_WALK_MAX_ROWS, visit }: { cap?: number; visit: (e: AuditLogEntry) => void },
): Promise<AuditWalkResult> {
  let cursor: string | null = null;
  let scanned = 0;
  do {
    const page = await getAuditLog(org, { ...filters, cursor, limit: AUDIT_WALK_PAGE_SIZE });
    if (!page) break;
    for (const e of page.entries) {
      visit(e);
      scanned += 1;
    }
    cursor = page.nextCursor;
  } while (cursor && scanned < cap);
  return { scanned, truncated: cursor != null };
}

export interface AuditIntegritySweep {
  scanned: number;
  ok: number;
  unsigned: number;
  tampered: number;
  noSecret: number;
  truncated: boolean;
  /** The tampered rows themselves, newest first, at most SWEEP_TAMPERED_ENTRIES_CAP of them. */
  tamperedEntries: AuditLogEntry[];
}

/**
 * Count the read-time HMAC verdict of every row the walk visits. No new crypto: getAuditLog already
 * recomputes `integrity` per row, so the sweep only tallies what the viewer and the CSV already state.
 */
export async function sweepAuditIntegrity(
  org: string,
  filters: AuditWalkFilters,
  { cap = AUDIT_WALK_MAX_ROWS }: { cap?: number } = {},
): Promise<AuditIntegritySweep> {
  const counts = { ok: 0, unsigned: 0, tampered: 0, noSecret: 0 };
  const tamperedEntries: AuditLogEntry[] = [];
  const { scanned, truncated } = await walkAuditLog(org, filters, {
    cap,
    visit: (e) => {
      if (e.integrity === "ok") counts.ok += 1;
      else if (e.integrity === "unsigned") counts.unsigned += 1;
      else if (e.integrity === "no-secret") counts.noSecret += 1;
      else {
        counts.tampered += 1;
        if (tamperedEntries.length < SWEEP_TAMPERED_ENTRIES_CAP) tamperedEntries.push(e);
      }
    },
  });
  return { scanned, ...counts, truncated, tamperedEntries };
}
