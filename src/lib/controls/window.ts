// The timeline READ WINDOW and its truncation disclosure — shared, verbatim, by `/api/org/controls`
// and by the Governance tab's control-ledger card (MC-B13).
//
// It lives in neither consumer on purpose. The route computed `truncated`/`limit` and the card never
// called the route (a grep for `api/org/controls` outside the route returned zero hits), so the
// surface a compliance reader actually screenshots was the one with no completeness disclosure on it
// at all. Re-deriving the arithmetic in the card would have produced two answers to "is this
// everything?"; one module produces one.

/** The truncation disclosure — the ONE place the "is this everything?" question is answered. The
 *  route's JSON and the card's sentence read the same two values, so they cannot disagree. */
export function timelineDisclosure(rowCount: number, requestedLimit: number, cap: number): { truncated: boolean; limit: number } {
  const limit = Math.min(cap, requestedLimit);
  return { truncated: rowCount >= limit, limit };
}

/** The sentence a truncated timeline must carry. Null when nothing was withheld — an unconditional
 *  "showing N of N" invites the reader to hunt for a missing number that does not exist. */
export function truncationSentence(d: { truncated: boolean; limit: number }): string | null {
  if (!d.truncated) return null;
  return (
    `This page stops at the newest ${d.limit} observations — it is NOT the org's complete ledger. ` +
    "Narrow by repository, control or date range, or export the rows, before reading any count here as a fleet total."
  );
}
