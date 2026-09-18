// LOOP DIRECTIONS — the fenced, budgeted grants approving a major plan creates
// (spark theater-upgrade, 2026-09-18; WP3 implements).

import type { DirectionStatus, LoopDirectionRecord } from "@/lib/local/runner-types";

/** An org's directions, newest first, optionally by status. STUB (WP0): none. */
export async function listLoopDirections(
  _orgSlug: string,
  _opts: { status?: DirectionStatus[]; repo?: string } = {},
): Promise<LoopDirectionRecord[]> {
  return [];
}

/** The ACTIVE directions' fences for one repo — what a later plan's moves are checked against. STUB. */
export async function activeFences(_orgSlug: string, _repoFullName: string): Promise<string[][]> {
  return [];
}
