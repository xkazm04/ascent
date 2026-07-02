/**
 * Pure SSE fold for the live war-room wall, extracted VERBATIM from `LiveWarRoom.tsx`'s `onRepo`
 * callback + its `stats`/`leaderboard` `useMemo`s so the state transition is testable without a
 * React renderer (ascent's Vitest has no jsdom).
 *
 * The component still owns the React state, the monotonic id counter, and the celebration timers;
 * this module owns the pure rules: how one streamed `repo` event mutates the repos map, what ticker
 * row it produces, when the skipped counter ticks, and exactly when a celebration fires (a repo
 * crossing into AI-Native). `foldRepoEvent` takes prev-state + an event + the next id and returns a
 * description of the change — it never touches React, refs, or timers.
 */
import {
  TICKER_MAX,
  classifyRepoEvent,
  shortName,
  type Celebration,
  type LiveRepo,
  type Mover,
} from "@/components/org/liveWarRoomShared";

/** The outcome of folding one `repo` SSE event into the live wall state. */
export interface RepoFoldResult {
  /** The repos map to commit. `null` ⇒ leave the map untouched (error / skip / invalid / no-name). */
  repos: Record<string, LiveRepo> | null;
  /** A ticker row to prepend (already capped to TICKER_MAX with existing rows), or `null` to skip. */
  ticker: Mover[] | null;
  /** How much to bump the credit-skipped counter (1 on a skip event, else 0). */
  skippedDelta: number;
  /** A celebration to fire, or `null`. Fires once on the crossing into AI-Native, not per event. */
  celebration: Celebration | null;
}

/**
 * Fold one streamed `repo` result into the live state: update the repo, push to the ticker, and
 * fire a celebration when it crosses the threshold into AI-Native. Skipped/error/malformed events
 * are ticker-only (or dropped) — they must never overwrite a repo's real seeded standing.
 *
 * @param prevRepos the current repos map (the caller's `reposRef.current`)
 * @param prevTicker the current ticker rows (newest first)
 * @param d         the raw SSE `repo` payload
 * @param id        the monotonic tick to stamp on this event (caller owns the counter)
 */
export function foldRepoEvent(
  prevRepos: Record<string, LiveRepo>,
  prevTicker: Mover[],
  d: Record<string, unknown>,
  id: number,
): RepoFoldResult {
  const noop: RepoFoldResult = { repos: null, ticker: null, skippedDelta: 0, celebration: null };

  const fullName = String(d.repo ?? "");
  if (!fullName) return noop;
  const ev = classifyRepoEvent(d);
  // Malformed payload (no error/skip marker, non-finite overall): drop it rather than fold
  // NaN into the wall — the seeded standing stays.
  if (ev.kind === "invalid") return noop;
  const prev = prevRepos[fullName];
  const name = prev?.name ?? shortName(fullName);

  if (ev.kind === "error") {
    return {
      repos: null,
      ticker: [{ id, fullName, name, overall: null, level: null, posture: null, delta: null, failed: true }, ...prevTicker].slice(0, TICKER_MAX),
      skippedDelta: 0,
      celebration: null,
    };
  }
  if (ev.kind === "skipped") {
    // Out of scan credits: count it and show a muted ticker entry; no score was produced.
    return {
      repos: null,
      ticker: [
        { id, fullName, name, overall: null, level: null, posture: null, delta: null, failed: false, skipped: true },
        ...prevTicker,
      ].slice(0, TICKER_MAX),
      skippedDelta: 1,
      celebration: null,
    };
  }

  const { overall, adoption, rigor, level, posture } = ev;
  const next: LiveRepo = { fullName, name, overall, adoption, rigor, level, posture, updatedAt: id };
  const updated = { ...prevRepos, [fullName]: next };

  const delta = prev?.overall != null ? overall - prev.overall : null;
  const ticker = [{ id, fullName, name, overall, level, posture, delta, failed: false }, ...prevTicker].slice(0, TICKER_MAX);

  const celebration: Celebration | null =
    posture === "ai-native" && prev?.posture !== "ai-native" ? { id, name, overall } : null;

  return { repos: updated, ticker, skippedDelta: 0, celebration };
}

/** Headline stats over the current repos map (scored averages + posture distribution). */
export function computeStats(repos: Record<string, LiveRepo>) {
  const all = Object.values(repos);
  const s = all.filter((r) => r.overall != null);
  const n = s.length;
  // Average each axis over ONLY the repos that actually carry it. A scored repo (overall present) can
  // still have a null adoption/rigor axis (both the seed and the live fold legitimately produce that),
  // and counting those nulls as 0 in the divisor understated the headline tiles — e.g. 5 repos at 80
  // + 5 with a null axis read (5·80)/10 = 40 instead of 80. avgOverall stays over `s` (the
  // overall-present set). (live-war-room #2)
  const axisAvg = (f: (r: LiveRepo) => number | null): number | null => {
    const present = s.filter((r) => f(r) != null);
    return present.length ? Math.round(present.reduce((a, r) => a + (f(r) as number), 0) / present.length) : null;
  };
  const postureCounts: Record<string, number> = {};
  for (const r of s) if (r.posture) postureCounts[r.posture] = (postureCounts[r.posture] ?? 0) + 1;
  return {
    scored: n,
    total: all.length,
    avgOverall: n ? Math.round(s.reduce((a, r) => a + (r.overall ?? 0), 0) / n) : null,
    avgAdoption: axisAvg((r) => r.adoption),
    avgRigor: axisAvg((r) => r.rigor),
    postureCounts,
    aiNative: postureCounts["ai-native"] ?? 0,
  };
}

/** The leaderboard: scored repos, highest overall first, name-tiebroken. */
export function computeLeaderboard(repos: Record<string, LiveRepo>): LiveRepo[] {
  return Object.values(repos)
    .filter((r) => r.overall != null)
    .sort((a, b) => b.overall! - a.overall! || a.name.localeCompare(b.name));
}
