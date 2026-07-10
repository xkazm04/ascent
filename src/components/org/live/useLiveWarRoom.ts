"use client";

// The live war-room's state machine, extracted verbatim from LiveWarRoom.tsx so the component
// stays a pure layout shell (300-LOC rule). Owns the SSE scan stream fold, the launch/stop
// lifecycle, the read-only kiosk refresh, and the celebration timers. Scanning is now explicit
// (manual launch of the selected repos) — the old unattended 15-min auto-relaunch was removed so a
// forgotten wall can't silently burn prepaid credits. The pure fold rules live in liveWarRoomFold.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readSSE } from "@/lib/sse";
import {
  CELEBRATION_MAX,
  CELEBRATION_MS,
  type Celebration,
  type LiveRepo,
  type LiveRepoSeed,
  type Mover,
  type Phase,
} from "@/components/org/shared/liveWarRoomShared";
import { computeLeaderboard, computeStats, foldRepoEvent } from "@/components/org/live/liveWarRoomFold";

export function useLiveWarRoom({
  slug,
  watchedCount,
  seed,
  scanRepos,
  readOnly = false,
}: {
  slug: string;
  watchedCount: number;
  seed: LiveRepoSeed[];
  scanRepos?: string[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [repos, setRepos] = useState<Record<string, LiveRepo>>(() =>
    Object.fromEntries(seed.map((r) => [r.fullName, { ...r, updatedAt: 0 }])),
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: watchedCount, current: "" });
  const [error, setError] = useState<string | null>(null);
  // Repos the server skipped for lack of prepaid scan credits (`notice` up front, per-repo
  // `skipped` events mid-run, authoritative total on `result`). Surfaced as a warn line so a
  // credit-truncated run can never read as a clean full-fleet success.
  const [skipped, setSkipped] = useState(0);
  const [ticker, setTicker] = useState<Mover[]>([]);
  const [celebrations, setCelebrations] = useState<Celebration[]>([]);
  // Page Visibility: true while the tab is foregrounded. Gates the read-only kiosk poll so a
  // backgrounded/idle wall doesn't hammer the refresh route. Default true for SSR; corrected on
  // mount + every visibilitychange.
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => setVisible(document.visibilityState !== "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  // WARROOM-5: opt-in (default-off) celebration sound. Read via a ref in pushCelebration so the
  // (stable) callback always sees the latest value without re-creating.
  const [sound, setSound] = useState(false);
  const soundRef = useRef(sound);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

  // Mirror of `repos` so the SSE handler can read the latest standing synchronously (it also
  // writes this ref itself for back-to-back events within a tick). Synced via effect, never
  // touched during render.
  const reposRef = useRef(repos);
  useEffect(() => {
    reposRef.current = repos;
  }, [repos]);
  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Tear down any in-flight scan + pending celebration timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      abortRef.current?.abort();
      for (const t of timers) clearTimeout(t);
      timers.clear();
    };
  }, []);

  // A short synthesized "ta-da" (no bundled asset). Gated on the opt-in Sound toggle + reduced-motion;
  // the Launch click satisfies the browser's autoplay gesture requirement. Best-effort — never throws.
  const playChime = useCallback(() => {
    if (!soundRef.current || typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const Ctx = window.AudioContext;
    if (!Ctx) return;
    try {
      const ctx = new Ctx();
      const start = ctx.currentTime;
      for (const [freq, at] of [[880, 0], [1175, 0.12]] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, start + at);
        gain.gain.exponentialRampToValueAtTime(0.15, start + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start + at);
        osc.stop(start + at + 0.3);
      }
      const closer = setTimeout(() => void ctx.close().catch(() => {}), 600);
      timersRef.current.add(closer);
    } catch {
      /* audio unavailable / blocked — celebrations stay visual-only */
    }
  }, []);

  const pushCelebration = useCallback(
    (c: Celebration) => {
      setCelebrations((cs) => [...cs, c].slice(-CELEBRATION_MAX));
      playChime();
      const timer = setTimeout(() => {
        setCelebrations((cs) => cs.filter((x) => x.id !== c.id));
        timersRef.current.delete(timer);
      }, CELEBRATION_MS);
      timersRef.current.add(timer);
    },
    [playChime],
  );

  // Fold one streamed `repo` result into the live state: update the repo, push to the ticker,
  // and fire a celebration when it crosses the threshold into AI-Native. Skipped/error/malformed
  // events are ticker-only (or dropped) — they must never overwrite a repo's real seeded standing.
  const onRepo = useCallback(
    (d: Record<string, unknown>) => {
      if (!String(d.repo ?? "")) return;
      // Snapshot the pre-update repos so the fold's `prev`/`delta`/celebration are computed against
      // the standing as it was when this event arrived (matches the prior single-`id` fold). The
      // ticker is folded against the latest `t` inside setTicker below; the repos/celebration/skip
      // pieces don't depend on the ticker, so an empty placeholder is fine for this first fold.
      const prevRepos = reposRef.current;
      // Stamp the id this event WOULD take, then fold. Drop malformed/invalid events before
      // committing the id (`++idRef.current`), preserving the prior placement where the monotonic id
      // only advances on events that actually land.
      const id = idRef.current + 1;
      const result = foldRepoEvent(prevRepos, [], d, id);
      const lands = result.repos !== null || result.ticker !== null || result.skippedDelta !== 0 || result.celebration !== null;
      if (!lands) return;
      idRef.current = id;

      if (result.repos !== null) {
        reposRef.current = result.repos;
        setRepos(result.repos);
      }
      if (result.skippedDelta) setSkipped((n) => n + result.skippedDelta);
      // Re-fold against the latest ticker inside the functional update so back-to-back events within
      // a tick still see each other's rows (matches the prior `setTicker((t) => [row, ...t])`).
      setTicker((t) => foldRepoEvent(prevRepos, t, d, id).ticker ?? t);
      if (result.celebration) pushCelebration(result.celebration);
    },
    [pushCelebration],
  );

  const launch = useCallback(async (reposOverride?: string[]) => {
    if (abortRef.current) return; // already running
    // The ship loop's verify rescan passes an explicit repo list; otherwise the active stack's
    // scope (or the whole watched fleet) applies as before.
    const targetRepos = reposOverride ?? scanRepos;
    setError(null);
    setSkipped(0);
    setTicker([]);
    setCelebrations([]);
    setPhase("running");
    setProgress({ done: 0, total: targetRepos?.length || watchedCount, current: "starting…" });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let sawError = false;
    try {
      const res = await fetch("/api/org/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(targetRepos && targetRepos.length > 0 ? { org: slug, repos: targetRepos } : { org: slug }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(d?.error ?? `Failed (${res.status}).`);
        setPhase("error");
        return;
      }
      await readSSE(res.body, ({ event, data }) => {
        if (!data) return;
        if (event === "progress")
          setProgress({ done: Number(data.index) || 0, total: Number(data.total) || watchedCount, current: String(data.repo ?? "") });
        else if (event === "repo") onRepo(data);
        else if (event === "notice") {
          // Up-front partial coverage: the prepaid balance can't cover every watched repo, so the
          // server is scanning a slice and skipping the rest. Count the skips and shrink the
          // denominator to what will actually run.
          const skippedN = Number(data.skipped);
          if (Number.isFinite(skippedN) && skippedN > 0) setSkipped((n) => n + skippedN);
          const scanning = Number(data.scanning);
          if (Number.isFinite(scanning) && scanning > 0) setProgress((p) => ({ ...p, total: scanning }));
        } else if (event === "result") {
          // Final summary — its skippedForCredits is authoritative (up-front slice + mid-run
          // reservation losses), so prefer it over our incremental count.
          const skippedN = Number(data.skippedForCredits);
          if (Number.isFinite(skippedN)) setSkipped(skippedN);
        } else if (event === "error") {
          sawError = true;
          setError(String(data.error));
        }
      });
      if (!ctrl.signal.aborted) {
        setProgress((p) => ({ ...p, current: "" }));
        setPhase(sawError ? "error" : "done");
      }
    } catch {
      if (ctrl.signal.aborted) {
        setPhase("idle");
        return;
      }
      setError("Network error.");
      setPhase("error");
    } finally {
      abortRef.current = null;
    }
  }, [onRepo, slug, watchedCount, scanRepos]);

  // A manual launch counts as interaction: reset the unattended auto-relaunch budget + clear the cap
  // notice so the loop (if enabled) gets a fresh N cycles.
  const manualLaunch = useCallback(() => {
    void launch();
  }, [launch]);

  // Ship-loop verify rescan: scan ONLY the given repos (a merged PR's repo) so the wall measures
  // the merge's impact without burning a full-fleet run. Skipped silently while a scan is already
  // in flight — the verify pass picks the impact up from whatever scan lands next anyway.
  const launchRepos = useCallback(
    (fullNames: string[]) => {
      if (fullNames.length === 0) return;
      void launch(fullNames);
    },
    [launch],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
    setProgress((p) => ({ ...p, current: "" }));
  }, []);

  // war-room #1: the read-only TV/shared wall has no SSE stream (readOnly suppresses launch()), so
  // without this it's a frozen page-load snapshot. Poll the server component (force-dynamic → re-reads
  // the org rollup) via router.refresh() so the kiosk view actually updates over time. Authenticated
  // walls keep their live SSE path and don't poll. Skip while the tab is hidden so a backgrounded TV
  // doesn't hammer the route, and resume on focus (the effect re-runs when `visible` flips).
  const REFRESH_MS = 60 * 1000;
  useEffect(() => {
    if (!readOnly || !visible) return;
    const t = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [readOnly, visible, router, REFRESH_MS]);

  // In readOnly mode, router.refresh() re-renders the server component with a fresh `seed`, but `repos`
  // was seeded once at mount — reconcile new server seed into state so the refreshed rollup shows.
  // Only in readOnly: on an authenticated wall the SSE fold owns `repos` and must not be clobbered.
  useEffect(() => {
    if (!readOnly) return;
    const next = Object.fromEntries(seed.map((r) => [r.fullName, { ...r, updatedAt: 0 }]));
    reposRef.current = next;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconciling the server-refreshed seed prop into kiosk state (no external system to subscribe to)
    setRepos(next);
  }, [readOnly, seed]);
  // WARROOM-5: restore + persist the Sound toggle.
  useEffect(() => {
    let persisted = false;
    try {
      persisted = localStorage.getItem("ascent-warroom-sound") === "1";
    } catch {
      /* localStorage unavailable */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot restore of the persisted toggle
    if (persisted) setSound(true);
  }, []);
  const toggleSound = useCallback(() => {
    setSound((v) => {
      const nv = !v;
      try {
        localStorage.setItem("ascent-warroom-sound", nv ? "1" : "0");
      } catch {
        /* localStorage unavailable */
      }
      return nv;
    });
  }, []);

  const stats = useMemo(() => computeStats(repos), [repos]);
  const leaderboard = useMemo(() => computeLeaderboard(repos), [repos]);

  const running = phase === "running";
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const launchLabel =
    phase === "idle" ? "▶ Launch live scan" : phase === "done" ? "↻ Re-run live scan" : phase === "error" ? "↻ Retry scan" : "Scanning…";

  return {
    stats,
    leaderboard,
    ticker,
    celebrations,
    phase,
    running,
    pct,
    progress,
    error,
    skipped,
    sound,
    launchLabel,
    manualLaunch,
    launchRepos,
    stop,
    toggleSound,
  };
}
