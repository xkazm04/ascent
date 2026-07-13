import type { SSEMessage } from "@/lib/sse";
import type { Constellation } from "./fleetMapStars";

/** Apply one SSE frame from the map's manual org scan (`/api/org/scan`) to the constellations.
 *
 *  This is the SOLE path that writes a live maturity score onto the map. It is a hand-rolled
 *  coercion over an UNTRUSTED server stream, so the guard is load-bearing:
 *    - only a "repo" event with a payload, no `error`/`skipped` flag, and a `repo` name is applied;
 *    - the streamed `overall` must coerce to a finite number (so a `skipped`/garbage payload that
 *      yields `NaN` is never painted over a real score);
 *    - the score lands on the matching `fullName` inside the matching `done` org — or, when that org
 *      carries no such star yet, the scanned repo is APPENDED as a new star instead of being silently
 *      dropped (launch-fleet-map #6: a scan can name a repo the map's /api/app/repos pull predated;
 *      dropping it lost the result. The next authoritative refresh reconciles it via mergeStars — which
 *      removes any star not in the fresh list — so a genuinely-absent repo self-heals).
 *
 *  Any malformed / unrelated / out-of-order frame is a NO-OP: the same `constellations` reference is
 *  returned unchanged (so React doesn't re-render and no event double-applies). Pure. */
export function applyScanEvent(
  constellations: Constellation[],
  login: string,
  msg: SSEMessage,
): Constellation[] {
  const { event, data } = msg;
  if (event !== "repo" || !data || data.error || data.skipped || !data.repo) return constellations;
  const fullName = String(data.repo);
  // Strictly parse the streamed score: a real finite number, or a non-empty numeric string. An empty
  // numeric field (null / "" / a boolean) must stay "unknown" — a no-op here — never be painted onto
  // the map as a fake 0. (`Number(null)`, `Number("")` and `Number(false)` are each a finite 0 that
  // would overwrite a repo's real seeded score with a bogus zero.)
  const rawOverall = data.overall;
  const overall =
    typeof rawOverall === "number"
      ? rawOverall
      : typeof rawOverall === "string" && rawOverall.trim() !== ""
        ? Number(rawOverall)
        : NaN;
  if (!Number.isFinite(overall)) return constellations;
  const level = data.level != null ? String(data.level) : null;
  // A live scan carries the new absolute score but no recomputed 30-day window delta, so the old
  // `dOverall` is now inconsistent with the fresh `overall`. Null it out here so the stale directional
  // "mover" ring/tooltip (ConstellationField: `Math.abs(r.dOverall) >= 1`) disappears until the next
  // authoritative `/api/app/repos` refresh supplies a delta that matches the new score.
  return constellations.map((c) => {
    if (c.login !== login || c.status !== "done") return c;
    const found = c.repos.some((r) => r.fullName === fullName);
    const repos = found
      ? c.repos.map((r) => (r.fullName === fullName ? { ...r, overall, level, dOverall: null } : r))
      : // A scanned repo the map didn't know about yet: add it rather than drop the result. It's not on
        // the org's watchlist as far as this client knows, and has no measured 30-day delta, so
        // watched:false / dOverall:null until the next /api/app/repos refresh supplies the truth.
        [...c.repos, { fullName, overall, level, dOverall: null, watched: false }];
    return { ...c, repos };
  });
}
