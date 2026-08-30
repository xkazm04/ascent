// MOONSHOT #33 — census × ledger → transitions. PURE: no db, no clock, no I/O.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE BASELINE IS THE FILE AS IT LANDED, NEVER THE BODY ASCENT PROPOSED.
//
// A reviewer editing the PR before merging it is the NORMAL case — it is, in fact, the outcome the
// product wants. Measuring drift against `proposedHash` would flag every well-reviewed adoption as
// divergent on the very first post-merge scan, and the feature would be read as noise within a week.
// So `adoptedHash` is stamped from what the first post-merge scan actually SAW, and every later
// comparison is against that.
//
// A COSMETIC EDIT IS NOT DRIFT. Prose under an unchanged heading outline is someone maintaining the
// document, which is adoption working. Only a body change that ALSO moves the outline reads as drift —
// the artifact's structure is what the practice actually asserts.
//
// UNKNOWN IS NOT A VERDICT. Three states produce no state change at all: a truncated tree (absence
// proves nothing), an unfetched body (`bodyHash === null`), and a `proposed` row whose PR has not
// merged. Each of those is a thing the scan could not see, and inventing `removed`/`drifted` from a
// blind spot is the failure this module is shaped to make impossible.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** One census row as the reconciler needs it (a subset of `CensusArtifact`). */
export interface CensusEntry {
  path: string;
  bodyHash: string | null;
  outlineHash: string | null;
}

/** One adoption-ledger row as the reconciler needs it. */
export interface LedgerRow {
  id: string;
  artifactPath: string;
  state: string;
  adoptedHash: string | null;
  adoptedOutline: string | null;
  /** The `ImprovementPr` for this (repo, practice) is `merged`. Resolved by the caller, read-only. */
  merged: boolean;
}

export type Transition =
  | { id: string; to: "adopted"; adoptedHash: string; adoptedOutline: string | null }
  | { id: string; to: "drifted" | "removed" }
  /** No state change — the row was seen and matched; only `lastCheckedAt`/`lastScanId` move. */
  | { id: string; to: "checked" };

/** Path comparison is case-insensitive: GitHub paths are case-sensitive but a rename that only
 *  changes case is not a removal, and reporting one would be a false alarm nobody can act on. */
const key = (p: string) => p.toLowerCase();

/**
 * Decide what this scan says about each ledger row. Returns one transition per row that has
 * something to say; a row the scan cannot speak to is simply absent from the result.
 *
 * `truncated` is the tree's own truncation flag — when true, a path missing from the census means
 * "not observed", not "deleted", so no `removed` can be emitted for the whole call.
 */
export function reconcileAdoption(
  rows: LedgerRow[],
  census: CensusEntry[],
  truncated: boolean,
): Transition[] {
  const byPath = new Map(census.map((c) => [key(c.path), c]));
  const out: Transition[] = [];

  for (const row of rows) {
    // A superseded row has been replaced by a newer adoption of the same artifact; it is history, and
    // history does not drift.
    if (row.state === "superseded") continue;

    const seen = byPath.get(key(row.artifactPath));

    if (!seen) {
      // Absent. Only a COMPLETE tree can prove a deletion.
      if (truncated) continue;
      if (row.state === "removed") continue; // already recorded; nothing new to say
      out.push({ id: row.id, to: "removed" });
      continue;
    }

    if (seen.bodyHash === null) continue; // in the tree, body unread — unknown, not changed

    // First landing. A `proposed` row becomes `adopted` only once the PR that carried it MERGED —
    // the file could otherwise be a coincidence (the repo already had one), and the ledger would
    // claim credit for an adoption ascent did not cause.
    if (row.adoptedHash === null) {
      if (!row.merged) continue;
      out.push({
        id: row.id,
        to: "adopted",
        adoptedHash: seen.bodyHash,
        adoptedOutline: seen.outlineHash,
      });
      continue;
    }

    // Byte-identical to what landed — including a `drifted`/`removed` row that matches again, which
    // returns to `adopted`. Self-healing is deliberate: a reverted edit should clear the finding.
    if (seen.bodyHash === row.adoptedHash) {
      out.push(row.state === "adopted" ? { id: row.id, to: "checked" } : { id: row.id, to: "adopted", adoptedHash: seen.bodyHash, adoptedOutline: seen.outlineHash });
      continue;
    }

    // Body differs. A matching heading outline means the STRUCTURE the practice asserts is intact —
    // a cosmetic edit. Both hashes must be non-null for that allowance: two nulls are two unknowns,
    // and treating unknown === unknown as "same outline" would silence drift on every workflow file.
    const cosmetic =
      seen.outlineHash !== null && row.adoptedOutline !== null && seen.outlineHash === row.adoptedOutline;
    if (cosmetic) {
      out.push(row.state === "adopted" ? { id: row.id, to: "checked" } : { id: row.id, to: "adopted", adoptedHash: row.adoptedHash, adoptedOutline: row.adoptedOutline });
      continue;
    }

    if (row.state === "drifted") continue; // already recorded; don't re-stamp driftedAt every scan
    out.push({ id: row.id, to: "drifted" });
  }

  return out;
}

/** Count a transition list by outcome — what `reconcilePracticeAdoption` reports to its caller. */
export function tallyTransitions(ts: Transition[]): { adopted: number; drifted: number; removed: number } {
  return {
    adopted: ts.filter((t) => t.to === "adopted").length,
    drifted: ts.filter((t) => t.to === "drifted").length,
    removed: ts.filter((t) => t.to === "removed").length,
  };
}
