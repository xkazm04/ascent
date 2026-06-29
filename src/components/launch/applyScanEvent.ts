import type { SSEMessage } from "@/lib/sse";
import type { Constellation } from "./fleetMapStars";

/** Apply one SSE frame from the map's manual org scan (`/api/org/scan`) to the constellations.
 *
 *  This is the SOLE path that writes a live maturity score onto the map. It is a hand-rolled
 *  coercion over an UNTRUSTED server stream, so the guard is load-bearing:
 *    - only a "repo" event with a payload, no `error`/`skipped` flag, and a `repo` name is applied;
 *    - the streamed `overall` must coerce to a finite number (so a `skipped`/garbage payload that
 *      yields `NaN` is never painted over a real score);
 *    - the score lands only on the matching `fullName` inside the matching `done` org.
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
  const overall = Number(data.overall);
  if (!Number.isFinite(overall)) return constellations;
  const level = data.level != null ? String(data.level) : null;
  // A live scan carries the new absolute score but no recomputed 30-day window delta, so the old
  // `dOverall` is now inconsistent with the fresh `overall`. Null it out here so the stale directional
  // "mover" ring/tooltip (ConstellationField: `Math.abs(r.dOverall) >= 1`) disappears until the next
  // authoritative `/api/app/repos` refresh supplies a delta that matches the new score.
  return constellations.map((c) =>
    c.login === login && c.status === "done"
      ? {
          ...c,
          repos: c.repos.map((r) =>
            r.fullName === fullName ? { ...r, overall, level, dOverall: null } : r,
          ),
        }
      : c,
  );
}
