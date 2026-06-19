"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readSSE } from "@/lib/sse";
import { scoreHex } from "@/lib/ui";
import {
  CELEBRATION_MAX,
  CELEBRATION_MS,
  POSTURE_HEX,
  type Celebration,
  type LiveRepo,
  type LiveRepoSeed,
  type Mover,
  type Phase,
} from "@/components/org/liveWarRoomShared";
import { computeLeaderboard, computeStats, foldRepoEvent } from "@/components/org/liveWarRoomFold";
import { AnimatedStat } from "@/components/org/LiveWarRoomStat";
import { WarRoomHeader } from "@/components/org/LiveWarRoomHeader";
import type { GoalProgressView } from "@/components/org/plan/goalView";
import { Leaderboard } from "@/components/org/LiveWarRoomLeaderboard";
import { MoversTicker, PostureMix } from "@/components/org/LiveWarRoomPanels";
import { Celebrations } from "@/components/org/LiveWarRoomCelebrations";

export type { LiveRepoSeed };

export function LiveWarRoom({
  slug,
  watchedCount,
  seed,
  goal = null,
  campaignDelta = null,
  readOnly = false,
  canShare = false,
}: {
  slug: string;
  watchedCount: number;
  seed: LiveRepoSeed[];
  /** The active goal the wall rallies around (target meter + pace + deadline countdown). */
  goal?: GoalProgressView | null;
  /** Overall-score movement since the campaign (goal) started, for the "since kickoff" line. */
  campaignDelta?: number | null;
  /** Shared-link / TV view: no scan trigger (scanning stays session-gated), just the current wall. */
  readOnly?: boolean;
  /** The viewer may mint a read-only TV share link (owner on the authenticated view). */
  canShare?: boolean;
}) {
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
  const [autoLoop, setAutoLoop] = useState(false);
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

  const launch = useCallback(async () => {
    if (abortRef.current) return; // already running
    setError(null);
    setSkipped(0);
    setTicker([]);
    setCelebrations([]);
    setPhase("running");
    setProgress({ done: 0, total: watchedCount, current: "starting…" });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let sawError = false;
    try {
      const res = await fetch("/api/org/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug }),
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
  }, [onRepo, slug, watchedCount]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
    setProgress((p) => ({ ...p, current: "" }));
  }, []);

  // WAR-3: optional auto-relaunch for an unattended wall display. Restore the persisted toggle once,
  // then — while enabled and NOT mid-run — schedule the next launch; the effect re-arms after each
  // run finishes (running flips false). launch() itself guards against overlapping runs.
  const LOOP_MS = 15 * 60 * 1000;
  useEffect(() => {
    let persisted = false;
    try {
      persisted = localStorage.getItem("ascent-warroom-loop") === "1";
    } catch {
      /* localStorage unavailable */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot restore of the persisted toggle
    if (persisted) setAutoLoop(true);
  }, []);
  useEffect(() => {
    if (!autoLoop || phase === "running" || readOnly) return; // readOnly can't scan, so never loop
    const t = setTimeout(() => void launch(), LOOP_MS);
    return () => clearTimeout(t);
  }, [autoLoop, phase, launch, LOOP_MS, readOnly]);
  const toggleLoop = useCallback(() => {
    setAutoLoop((v) => {
      const nv = !v;
      try {
        localStorage.setItem("ascent-warroom-loop", nv ? "1" : "0");
      } catch {
        /* localStorage unavailable */
      }
      return nv;
    });
  }, []);

  // WARROOM-5: restore + persist the Sound toggle, mirroring the auto-loop toggle.
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

  return (
    <div className="strata relative isolate -m-2 overflow-hidden rounded-3xl p-2">
      {/* spotlight wash, like Mission Control, so the wall feels lit from above */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: "radial-gradient(60rem 40rem at 50% -16%, rgba(59,158,255,0.08), transparent 60%)" }}
      />

      <WarRoomHeader
        slug={slug}
        running={running}
        watchedCount={watchedCount}
        progress={progress}
        pct={pct}
        error={error}
        skipped={skipped}
        launchLabel={launchLabel}
        onStop={stop}
        onLaunch={launch}
        goal={goal}
        campaignDelta={campaignDelta}
        autoLoop={autoLoop}
        onToggleLoop={toggleLoop}
        sound={sound}
        onToggleSound={toggleSound}
        readOnly={readOnly}
        canShare={canShare}
      />

      {/* ── Four headline tiles, counting up as results land ────────────── */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AnimatedStat
          label="Org maturity"
          value={stats.avgOverall}
          color={stats.avgOverall == null ? undefined : scoreHex(stats.avgOverall)}
        />
        <AnimatedStat
          label="AI Adoption"
          value={stats.avgAdoption}
          color={stats.avgAdoption == null ? undefined : scoreHex(stats.avgAdoption)}
        />
        <AnimatedStat
          label="Engineering Rigor"
          value={stats.avgRigor}
          color={stats.avgRigor == null ? undefined : scoreHex(stats.avgRigor)}
        />
        <AnimatedStat
          label="AI-Native repos"
          value={stats.aiNative}
          color={stats.aiNative > 0 ? POSTURE_HEX["ai-native"] : undefined}
          render={(n) => `${n}/${stats.scored || stats.total}`}
        />
      </div>

      {/* ── Wall: leaderboard (reshuffling) + posture mix + movers ticker ─ */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Leaderboard repos={leaderboard} className="lg:col-span-2" />
        <div className="flex flex-col gap-4">
          <PostureMix counts={stats.postureCounts} scored={stats.scored} />
          <MoversTicker ticker={ticker} running={running} />
        </div>
      </div>

      {/* ── Celebratory bursts: a repo just crossed into AI-Native ───────── */}
      <Celebrations celebrations={celebrations} />
    </div>
  );
}
