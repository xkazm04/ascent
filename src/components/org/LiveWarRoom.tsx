"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readSSE } from "@/lib/sse";
import { scoreHex } from "@/lib/ui";
import {
  CELEBRATION_MAX,
  CELEBRATION_MS,
  POSTURE_HEX,
  TICKER_MAX,
  shortName,
  type Celebration,
  type LiveRepo,
  type LiveRepoSeed,
  type Mover,
  type Phase,
} from "@/components/org/liveWarRoomShared";
import { AnimatedStat } from "@/components/org/LiveWarRoomStat";
import { WarRoomHeader } from "@/components/org/LiveWarRoomHeader";
import { Leaderboard } from "@/components/org/LiveWarRoomLeaderboard";
import { MoversTicker, PostureMix } from "@/components/org/LiveWarRoomPanels";
import { Celebrations } from "@/components/org/LiveWarRoomCelebrations";

export type { LiveRepoSeed };

export function LiveWarRoom({
  slug,
  watchedCount,
  seed,
}: {
  slug: string;
  watchedCount: number;
  seed: LiveRepoSeed[];
}) {
  const [repos, setRepos] = useState<Record<string, LiveRepo>>(() =>
    Object.fromEntries(seed.map((r) => [r.fullName, { ...r, updatedAt: 0 }])),
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: watchedCount, current: "" });
  const [error, setError] = useState<string | null>(null);
  const [ticker, setTicker] = useState<Mover[]>([]);
  const [celebrations, setCelebrations] = useState<Celebration[]>([]);

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

  const pushCelebration = useCallback((c: Celebration) => {
    setCelebrations((cs) => [...cs, c].slice(-CELEBRATION_MAX));
    const timer = setTimeout(() => {
      setCelebrations((cs) => cs.filter((x) => x.id !== c.id));
      timersRef.current.delete(timer);
    }, CELEBRATION_MS);
    timersRef.current.add(timer);
  }, []);

  // Fold one streamed `repo` result into the live state: update the repo, push to the ticker,
  // and fire a celebration when it crosses the threshold into AI-Native.
  const onRepo = useCallback(
    (d: Record<string, unknown>) => {
      const fullName = String(d.repo ?? "");
      if (!fullName) return;
      const id = ++idRef.current;
      const prev = reposRef.current[fullName];
      const name = prev?.name ?? shortName(fullName);

      if (d.error) {
        setTicker((t) =>
          [{ id, fullName, name, overall: null, level: null, posture: null, delta: null, failed: true }, ...t].slice(0, TICKER_MAX),
        );
        return;
      }

      const overall = Number(d.overall);
      const adoption = Number(d.adoption);
      const rigor = Number(d.rigor);
      const level = d.level != null ? String(d.level) : null;
      const posture = d.posture != null ? String(d.posture) : null;
      const next: LiveRepo = { fullName, name, overall, adoption, rigor, level, posture, updatedAt: id };
      const updated = { ...reposRef.current, [fullName]: next };
      reposRef.current = updated;
      setRepos(updated);

      const delta = prev?.overall != null ? overall - prev.overall : null;
      setTicker((t) => [{ id, fullName, name, overall, level, posture, delta, failed: false }, ...t].slice(0, TICKER_MAX));

      if (posture === "ai-native" && prev?.posture !== "ai-native") {
        pushCelebration({ id, name, level, overall });
      }
    },
    [pushCelebration],
  );

  const launch = useCallback(async () => {
    if (abortRef.current) return; // already running
    setError(null);
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
        else if (event === "error") {
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

  const stats = useMemo(() => {
    const all = Object.values(repos);
    const s = all.filter((r) => r.overall != null);
    const n = s.length;
    const sum = (f: (r: LiveRepo) => number | null) => s.reduce((a, r) => a + (f(r) ?? 0), 0);
    const postureCounts: Record<string, number> = {};
    for (const r of s) if (r.posture) postureCounts[r.posture] = (postureCounts[r.posture] ?? 0) + 1;
    return {
      scored: n,
      total: all.length,
      avgOverall: n ? Math.round(sum((r) => r.overall) / n) : null,
      avgAdoption: n ? Math.round(sum((r) => r.adoption) / n) : null,
      avgRigor: n ? Math.round(sum((r) => r.rigor) / n) : null,
      postureCounts,
      aiNative: postureCounts["ai-native"] ?? 0,
    };
  }, [repos]);

  const leaderboard = useMemo(
    () =>
      Object.values(repos)
        .filter((r) => r.overall != null)
        .sort((a, b) => b.overall! - a.overall! || a.name.localeCompare(b.name)),
    [repos],
  );

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
        running={running}
        watchedCount={watchedCount}
        progress={progress}
        pct={pct}
        error={error}
        launchLabel={launchLabel}
        onStop={stop}
        onLaunch={launch}
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
