"use client";

import { type Dispatch, type MutableRefObject, type SetStateAction, useEffect, useRef } from "react";
import {
  type Installation,
  POLL_BACKOFF_MAX_MS,
  POLL_INTERVAL_MS,
  POLL_ORG_CAP,
  SCAN_SETTLE_MS,
} from "./FleetMap.constants";
import { type Constellation, mapRepos } from "./fleetMapStars";
import { mergeStars } from "./mergeStars";

/** Settle one org's INITIAL `/api/app/repos` fetch into a terminal constellation state. Pure.
 *
 *  A 200 whose body failed to parse (`data === null` — truncated body, an HTML error page behind a
 *  proxy) or whose shape drifted (`repos` missing / not an array) is committed as an ERROR, not as
 *  `done` with zero repos: mapping it to `done` rendered the confident "no repositories" badge for a
 *  transient gateway blip — the same "empty means failure" rule mergeStars already applies on refresh
 *  (an empty `fresh` is treated as a failed pull, never as the org losing every repo). A genuinely
 *  empty org still arrives as `repos: []` and settles `done`. (ambiguity-ui launch-fleet-map #2) */
export function settleInitialFetch(
  inst: Installation,
  ok: boolean,
  status: number,
  data: { repos?: unknown; error?: string } | null,
): Constellation {
  if (!ok) return { id: inst.id, login: inst.login, status: "error", message: data?.error ?? `Failed (${status})` };
  if (data === null || !Array.isArray(data.repos)) {
    return { id: inst.id, login: inst.login, status: "error", message: "Couldn't read repositories — retrying shortly." };
  }
  return { id: inst.id, login: inst.login, status: "done", repos: mapRepos(data.repos) };
}

/** Shape of the `/api/app/repos` response body both effects below read. */
type ReposBody = { repos?: unknown; error?: string } | null;

/** Build the `/api/app/repos` URL for one org and fetch it. Shared by the initial-fetch effect (which
 *  passes an AbortSignal so unmount cancels in-flight requests) and the 90s refresh effect (which
 *  doesn't — it discards stale results via its own `cancelled` flag instead; see useFleetData's
 *  refresh effect for why an AbortController there wasn't the right cancellation shape). Extracting
 *  ONLY the URL-building + fetch call (not a full parse-and-branch routine) keeps each caller's own
 *  ok/status handling order intact — the refresh effect deliberately skips parsing the body at all
 *  when `!r.ok` (see below), which an eagerly-parsing shared routine would have broken. */
function fetchOrgRepos(inst: Installation, signal?: AbortSignal): Promise<Response> {
  const qs = new URLSearchParams({ org: inst.login, installation_id: String(inst.id) });
  return fetch(`/api/app/repos?${qs.toString()}`, signal ? { signal } : undefined);
}

/** Parse a `/api/app/repos` response body, tolerating a truncated/non-JSON body (never throws). Shared
 *  by both effects; each decides WHEN to call it (the refresh effect calls it only after its own
 *  `!r.ok` short-circuit, to avoid reading an error body it doesn't use). */
async function parseReposBody(r: Response): Promise<ReposBody> {
  return (await r.json().catch(() => null)) as ReposBody;
}

/** Run `fn` over `items` with at most `limit` in flight. Identical to `Promise.all(items.map(fn))`
 *  when `items.length <= limit` — the whole point: capped fleets keep the exact prior behavior (same
 *  parallel burst, same cadence), and only a fleet BIGGER than the cap is metered out. `fn` must not
 *  reject (each caller catches its own failures); a rejection would abandon that worker's queue. */
async function runBounded<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length <= limit) {
    await Promise.all(items.map(fn));
    return;
  }
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      // `as T` only sheds noUncheckedIndexedAccess' `| undefined`; the while-guard is the real bound.
      await fn(items[cursor++] as T);
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
}

/** Per-org poll backoff: how long to wait after `fails` CONSECUTIVE refresh failures before pulling
 *  that org again. Doubles from one poll interval and parks at POLL_BACKOFF_MAX_MS. `fails === 1`
 *  yields exactly one interval, so a single transient blip retries on the normal next tick. Pure. */
export function backoffDelayMs(fails: number): number {
  if (fails <= 0) return 0;
  return Math.min(POLL_INTERVAL_MS * 2 ** (fails - 1), POLL_BACKOFF_MAX_MS);
}

/** One org's consecutive-failure state for the poll backoff. */
interface BackoffEntry {
  fails: number;
  /** Epoch ms before which this org's refresh is skipped. */
  nextAt: number;
}

// Loads and keeps the constellation grid live: an initial per-org fetch, then a ~90s visible-tab
// refresh that patches changed stars in place. Extracted verbatim from FleetMap so the orchestrator
// stays under the 300-LOC cap; behavior (guards, races, cleanup) is unchanged.
//
// COST SHAPE (launch-fleet-map 07-27): both loops fan out one `/api/app/repos` call per org, and that
// route is a live GitHub App repo listing + two DB queries. Two bounds keep the fan-out honest without
// touching the healthy-path cadence: at most POLL_ORG_CAP calls in flight at once, and a per-org
// exponential backoff so an org that is failing stops being re-asked every 90s while every healthy org
// keeps polling normally. The server side of the same problem (parallel TABS multiplying the calls) is
// a short-TTL cache on the route itself.
export function useFleetData(
  installations: Installation[],
  setConstellations: Dispatch<SetStateAction<Constellation[]>>,
  scanCtrl: MutableRefObject<AbortController | null>,
  scanGen: MutableRefObject<number>,
  recentScan: MutableRefObject<Map<string, number>>,
) {
  // Consecutive-failure state per org login, driving the poll backoff. A ref (not state) so recording a
  // failure never re-renders the map, and so the schedule survives the effect re-running.
  const backoff = useRef<Map<string, BackoffEntry>>(new Map());

  useEffect(() => {
    const controller = new AbortController();
    // Bounded fan-out (see POLL_ORG_CAP): a 20-org fleet no longer opens 20 sockets the instant the map
    // mounts. At or below the cap this is the previous unbounded parallel burst, unchanged.
    void runBounded(installations, POLL_ORG_CAP, async (inst) => {
      if (controller.signal.aborted) return;
      try {
        const r = await fetchOrgRepos(inst, controller.signal);
        const data = await parseReposBody(r);
        setConstellations((cur) =>
          cur.map((c) => (c.id !== inst.id ? c : settleInitialFetch(inst, r.ok, r.status, data))),
        );
      } catch {
        if (controller.signal.aborted) return;
        setConstellations((cur) =>
          cur.map((c) =>
            c.id === inst.id ? { id: inst.id, login: inst.login, status: "error", message: "Network error" } : c,
          ),
        );
      }
    });
    return () => controller.abort();
  }, [installations, setConstellations]);

  // MAP-6: keep the constellation live — re-pull each org every ~90s while the tab is VISIBLE, patching
  // changed stars in place (unchanged stars keep their identity via mergeStars, so they don't re-animate).
  // Skips a hidden tab and never fights an in-flight manual scan (the SSE stream owns the stars then).
  useEffect(() => {
    if (installations.length === 0) return;
    let cancelled = false;
    async function refreshAll() {
      if (document.visibilityState !== "visible" || scanCtrl.current) return;
      // Snapshot the scan generation BEFORE the network round-trip. The guard above only catches a scan
      // already in flight; a scan that starts (and the fetch resolves) after this point would otherwise
      // commit pre-scan rows (often overall:null) over the live scores the SSE stream just painted.
      const genAtStart = scanGen.current;
      // A pull that failed schedules this org's next attempt; a pull that succeeded clears the penalty.
      // Only REFRESH failures count — the initial mount fetch never seeds the schedule, so a cold-start
      // blip still gets its first retry on the very next tick (fails=1 is one plain interval anyway).
      const noteFailure = (login: string) => {
        const fails = (backoff.current.get(login)?.fails ?? 0) + 1;
        backoff.current.set(login, { fails, nextAt: Date.now() + backoffDelayMs(fails) });
      };
      await runBounded(installations, POLL_ORG_CAP, async (inst) => {
        try {
          // Defer a just-scanned org until its fresh scores have propagated, so the poll can't pull
          // a stale payload and dim a star back down (MAP-6 race). Clear the marker once elapsed.
          const scannedAt = recentScan.current.get(inst.login);
          if (scannedAt != null) {
            if (Date.now() - scannedAt < SCAN_SETTLE_MS) return;
            recentScan.current.delete(inst.login);
          }
          // Backoff gate: this org failed its last pull(s), so skip it until its penalty elapses. Every
          // OTHER org in the fleet is unaffected — a single broken installation can't slow the map down,
          // and can't keep costing a GitHub round-trip every 90s either. Time-based (not tick-counted)
          // so the visibility re-pull below honors the same schedule.
          const penalty = backoff.current.get(inst.login);
          if (penalty && Date.now() < penalty.nextAt) return;
          const r = await fetchOrgRepos(inst);
          if (cancelled) return;
          if (!r.ok) return noteFailure(inst.login);
          const data = await parseReposBody(r);
          // A malformed/absent body is a FAILED pull, not an empty org (settleInitialFetch's rule). It
          // previously fell through as `fresh: []`, which mergeStars no-ops on — same stars either way,
          // but it must count against the backoff rather than read as a healthy poll.
          if (data === null || !Array.isArray(data.repos)) return noteFailure(inst.login);
          const fresh = mapRepos(data.repos);
          backoff.current.delete(inst.login); // healthy again — back to the normal cadence
          // Re-check the live-scan guard at COMMIT time, not just at fetch start: a manual scan that
          // began during this round-trip now owns the stars, so don't clobber its fresh scores.
          if (cancelled || scanCtrl.current || scanGen.current !== genAtStart) return;
          setConstellations((cur) =>
            cur.map((c) => {
              if (c.id !== inst.id) return c;
              if (c.status === "done") return { ...c, repos: mergeStars(c.repos, fresh) };
              // Heal an org whose INITIAL fetch failed (including the malformed-200 case above) once a
              // refresh pull succeeds with real rows — otherwise the "retrying shortly" message lies and
              // the error card is permanent until a reload. An empty `fresh` proves nothing (see
              // mergeStars' rationale), so it never flips an errored org to a confident empty state.
              if (c.status === "error" && fresh.length > 0) {
                return { id: inst.id, login: inst.login, status: "done" as const, repos: fresh };
              }
              return c;
            }),
          );
        } catch {
          /* leave the stars as-is on a transient blip — but slow this org's next attempt */
          if (!cancelled) noteFailure(inst.login);
        }
      });
    }
    const id = setInterval(refreshAll, POLL_INTERVAL_MS);
    // Re-pull immediately when the tab regains focus so a user returning to a backgrounded Mission
    // Control doesn't stare at scores up to ~90s stale before the next tick (the interval no-ops while
    // hidden). refreshAll's own visibility/scan guards keep this safe.
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshAll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable; matches FleetMap's original [installations] dep
  }, [installations]);
}
