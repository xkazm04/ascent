// Client helper for the segment bulk-tag endpoint. RepoSegmentsPanel.autoAdd() (auto-add by language)
// and RepoLeaderboard.addToSegment() (the bulk-action bar) both POSTed to
// /api/org/segments/:id/repos/bulk with the same { org, fullNames, member } body and the same
// json-then-throw error contract. Single-sourced here so a change to the route shape (a new field, a
// different success envelope, a moved path) lands on both callers at once. Each component keeps its own
// optimistic-state bookkeeping; this owns only the network call + error semantics.

/**
 * Bulk tag (member=true, the default) or untag many repos into a segment in one round-trip.
 * Returns the number of membership rows the server changed; throws the server `error` on a non-OK
 * response (mirroring both call sites' prior `res.json().catch(() => ({}))` then throw).
 */
export async function bulkTagRepos(
  segmentId: string,
  { org, fullNames, member = true }: { org: string; fullNames: string[]; member?: boolean },
): Promise<number> {
  const res = await fetch(`/api/org/segments/${segmentId}/repos/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ org, fullNames, member }),
  });
  const data = (await res.json().catch(() => ({}))) as { changed?: number; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Bulk add failed.");
  return data.changed ?? 0;
}
