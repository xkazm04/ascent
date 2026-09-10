// Shared recommendation identity and tracking across scans. No rendering or data-access dependencies.


/** A recommendation's cross-scan identity inputs: its dimension + free-form title. */
export interface RecIdentity {
  dim: string;
  title: string;
}


/** Normalize a recommendation title for cross-scan identity: case, punctuation, and whitespace are
 *  presentation noise a live LLM rephrases freely between scans ("…to go on" vs "…to go on here."). */
export function normalizeRecTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}


/**
 * Match next-scan recommendations to previous-scan rows by STABLE identity — the single matcher
 * behind both scan-persist carry-forward (status/assignee/due-date survive a re-scan) and this
 * module's recsMovedToDone. Raw titles are NOT stable across live-LLM scans (temperature, evidence
 * drift, provider failover all rephrase them), so matching runs in three tiers:
 *  1. exact dimension + title (mock / low-temp identical output);
 *  2. dimension + normalized title (pure rephrasing of case/punctuation/whitespace);
 *  3. unambiguous dimension: exactly ONE unmatched prior row and ONE unmatched next item share a
 *     dimension — a dimension's gap statement is the same gap restated, so pair them. Genuine
 *     ambiguity (two unmatched on either side) stays unmatched rather than guessing.
 * Each prior row matches at most one next item. Returns, for each `next` index, the matched
 * `prev` index (or null when nothing matched).
 */
export function matchRecommendations(
  prev: readonly RecIdentity[],
  next: readonly RecIdentity[],
): (number | null)[] {
  const result: (number | null)[] = next.map(() => null);
  const usedPrev = new Set<number>();

  // Tiers 1+2: claim by a dim-scoped key — exact first, then normalized.
  const claim = (key: (r: RecIdentity) => string) => {
    const byKey = new Map<string, number[]>();
    prev.forEach((p, i) => {
      if (usedPrev.has(i)) return;
      const k = key(p);
      const list = byKey.get(k);
      if (list) list.push(i);
      else byKey.set(k, [i]);
    });
    next.forEach((n, j) => {
      if (result[j] !== null) return;
      const pick = byKey.get(key(n))?.find((i) => !usedPrev.has(i));
      if (pick !== undefined) {
        result[j] = pick;
        usedPrev.add(pick);
      }
    });
  };
  claim((r) => `${r.dim}::${r.title}`);
  claim((r) => `${r.dim}::${normalizeRecTitle(r.title)}`);

  // Tier 3: pair the lone unmatched prior row and lone unmatched next item of the same dimension.
  const leftoverPrev = new Map<string, number[]>();
  prev.forEach((p, i) => {
    if (usedPrev.has(i)) return;
    const list = leftoverPrev.get(p.dim);
    if (list) list.push(i);
    else leftoverPrev.set(p.dim, [i]);
  });
  const leftoverNext = new Map<string, number[]>();
  next.forEach((n, j) => {
    if (result[j] !== null) return;
    const list = leftoverNext.get(n.dim);
    if (list) list.push(j);
    else leftoverNext.set(n.dim, [j]);
  });
  for (const [dim, [j, ...restNext]] of leftoverNext) {
    const [i, ...restPrev] = leftoverPrev.get(dim) ?? [];
    if (j !== undefined && i !== undefined && restNext.length === 0 && restPrev.length === 0) {
      result[j] = i;
      usedPrev.add(i);
    }
  }
  return result;
}


// ── Orphaned tracking ───────────────────────────────────────────────────────────────────────────
//
// The matcher above is deliberately conservative: two reworded gaps in one dimension are genuinely
// ambiguous, so it refuses to guess. Scan-persist then wrote `status: carried?.status ?? "open"` and
// the user's own tracking data — status, assignee, target date — vanished with NO error. The engine's
// honest refusal to guess was indistinguishable from data loss.
//
// This does NOT weaken the matcher. It names what the matcher couldn't carry, so the loss is visible
// and re-linkable instead of silent.

/** A previous scan's recommendation, with the planning state a re-scan must not lose. */
export interface TrackedRecIdentity extends RecIdentity {
  status: string;
  assigneeLogin: string | null;
  /** ISO date (YYYY-MM-DD) or null. */
  targetDate: string | null;
}


/** Carries user tracking worth preserving — anything past the untouched open/unassigned default. */
export function isTrackedRec(r: Pick<TrackedRecIdentity, "status" | "assigneeLogin" | "targetDate">): boolean {
  return (r.status !== "" && r.status !== "open") || r.assigneeLogin != null || r.targetDate != null;
}


/** Same planning state — the signal that an orphan has already been re-applied to a new row. */
const sameTracking = (
  a: Pick<TrackedRecIdentity, "status" | "assigneeLogin" | "targetDate">,
  b: Pick<TrackedRecIdentity, "status" | "assigneeLogin" | "targetDate">,
) => a.status === b.status && a.assigneeLogin === b.assigneeLogin && a.targetDate === b.targetDate;


/**
 * Previously-tracked recommendations the tiered matcher could not carry into the new scan.
 *
 * Self-healing without a schema column: an orphan is dropped once an UNMATCHED row in the new scan
 * carries its exact (status, assignee, targetDate) triple — which is precisely what re-linking does.
 * A brand-new unmatched row defaults to open/null/null and `isTrackedRec` excludes that, so an
 * untouched roadmap item can never silently absorb an orphan. Each such row retires at most one
 * orphan, so two identical orphans need two re-links.
 */
export function findOrphanedTracked(
  prev: readonly TrackedRecIdentity[],
  next: readonly TrackedRecIdentity[],
): TrackedRecIdentity[] {
  const matches = matchRecommendations(prev, next);
  const matchedPrev = new Set<number>();
  matches.forEach((m) => {
    if (m != null) matchedPrev.add(m);
  });
  // The candidate absorbers: rows the matcher left unpaired that ALREADY carry tracking of their own
  // (i.e. somebody applied it). Consumed one-for-one below.
  const absorbers = next.filter((n, j) => matches[j] == null && isTrackedRec(n));
  const used = new Set<number>();
  return prev.filter((p, i) => {
    if (matchedPrev.has(i) || !isTrackedRec(p)) return false;
    const hit = absorbers.findIndex((n, k) => !used.has(k) && n.dim === p.dim && sameTracking(n, p));
    if (hit >= 0) {
      used.add(hit);
      return false; // already re-linked onto a new row
    }
    return true;
  });
}
