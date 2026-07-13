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
