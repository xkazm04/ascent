"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { POSTURE_LABEL, POSTURE_ORDER } from "@/components/org/ui";
import { readSSE } from "@/lib/sse";
import { scoreGlyph, scoreHex } from "@/lib/ui";

/** A repo's latest standing, as seeded from the server rollup and updated live by the SSE stream. */
export interface LiveRepoSeed {
  fullName: string;
  name: string;
  overall: number | null;
  adoption: number | null;
  rigor: number | null;
  level: string | null;
  posture: string | null;
}

interface LiveRepo extends LiveRepoSeed {
  /** Monotonic tick of the last live update (0 = seeded), used to flash freshly-landed rows. */
  updatedAt: number;
}

interface Mover {
  id: number;
  fullName: string;
  name: string;
  overall: number | null;
  level: string | null;
  posture: string | null;
  /** Overall-score change vs this repo's previous scan, or null when first-ever scan. */
  delta: number | null;
  failed: boolean;
}

interface Celebration {
  id: number;
  name: string;
  level: string | null;
  overall: number | null;
}

type Phase = "idle" | "running" | "done" | "error";

const TICKER_MAX = 14;
const LEADER_MAX = 14;
const CELEBRATION_MAX = 4;
const CELEBRATION_MS = 5200;
const ROW_H = 44; // px per leaderboard row (40px row + 4px gap), drives the reshuffle transition

/** Cool→warm hex per posture quadrant for the morphing distribution + leaderboard chips. */
const POSTURE_HEX: Record<string, string> = {
  "ai-native": "#22c55e",
  ungoverned: "#f97316",
  manual: "#38bdf8",
  early: "#64748b",
};

const shortName = (fullName: string) => fullName.split("/").pop() || fullName;

/** Tween an integer toward `target` with an ease-out cubic, honoring prefers-reduced-motion. */
function useTween(target: number, ms = 650): number {
  const [val, setVal] = useState(target);
  // Holds the last displayed value so a new target animates from where the number actually is.
  // Only ever read/written inside the effect below (never during render).
  const valRef = useRef(target);
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const from = valRef.current;
    if (reduced || from === target) {
      valRef.current = target;
      setVal(target);
      return;
    }
    let raf = 0;
    let start = 0;
    const step = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(from + (target - from) * eased);
      valRef.current = v;
      setVal(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return val;
}

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

      {/* ── Header: LIVE state + launch control + run progress ──────────── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-accent">
            <span className={`inline-block h-2 w-2 rounded-full ${running ? "live-dot bg-red-500" : "bg-slate-600"}`} aria-hidden />
            {running ? "Live" : "Fleet Command"}
          </div>
          <h2 className="mt-1 text-2xl font-bold text-white sm:text-3xl">Transformation war-room</h2>
          <p className="mt-1 max-w-xl text-sm text-slate-400">
            The whole org&apos;s scan, live — tiles climb, the leaderboard reshuffles, and every repo that crosses into
            AI-Native lights up the wall.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {running && (
              <button
                type="button"
                onClick={stop}
                className="focus-ring rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
              >
                Stop
              </button>
            )}
            <button
              type="button"
              onClick={launch}
              disabled={running || watchedCount === 0}
              className="focus-ring rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              {launchLabel}
            </button>
          </div>
          {watchedCount === 0 ? (
            <p className="font-mono text-[11px] text-slate-500">Watch some repos on /connect to scan.</p>
          ) : (
            <p className="font-mono text-[11px] text-slate-500" aria-live="polite">
              {running ? `${progress.done}/${progress.total} repos` : `${watchedCount} watched`}
            </p>
          )}
        </div>
      </header>

      {/* run progress bar + currently-scanning caption */}
      {running && (
        <div className="mt-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-accent transition-all motion-reduce:transition-none" style={{ width: `${Math.max(3, pct)}%` }} />
          </div>
          {progress.current && (
            <p className="mt-1 truncate font-mono text-[11px] text-slate-500" aria-live="polite">
              scanning {shortName(progress.current)}…
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger-soft">{error}</p>
      )}

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

function AnimatedStat({
  label,
  value,
  color,
  render,
}: {
  label: string;
  value: number | null;
  color?: string;
  render?: (n: number) => string;
}) {
  const tweened = useTween(value ?? 0);
  const shown = value == null ? "—" : render ? render(tweened) : String(tweened);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div
        className="mt-1 font-mono text-3xl font-bold tabular-nums sm:text-4xl"
        style={{ color: value == null ? "#fff" : color ?? "#fff" }}
      >
        {shown}
      </div>
    </div>
  );
}

function Leaderboard({ repos, className = "" }: { repos: LiveRepo[]; className?: string }) {
  const shown = repos.slice(0, LEADER_MAX);
  const overflow = Math.max(0, repos.length - LEADER_MAX);
  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-900/40 p-6 ${className}`}>
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[11px] uppercase tracking-widest text-accent">Fleet leaderboard</h3>
        <span className="font-mono text-[11px] text-slate-500">{repos.length} ranked</span>
      </div>
      {shown.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No scans yet — launch the live scan to populate the board.</p>
      ) : (
        <div className="relative mt-3" style={{ height: shown.length * ROW_H }}>
          {shown.map((r, i) => {
            const color = scoreHex(r.overall!);
            return (
              <div
                key={r.fullName}
                className="absolute inset-x-0 flex h-10 items-center gap-3 rounded-lg px-2 transition-all duration-500 ease-out motion-reduce:transition-none"
                style={{ top: i * ROW_H }}
              >
                <span className="w-5 shrink-0 text-right font-mono text-xs tabular-nums text-slate-500">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-slate-200" title={r.fullName}>
                  {r.name}
                </span>
                <div className="hidden h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-slate-800 sm:block">
                  <div
                    className="h-full rounded-full transition-all duration-500 motion-reduce:transition-none"
                    style={{ width: `${r.overall}%`, backgroundColor: color }}
                  />
                </div>
                <span className="shrink-0 font-mono text-[11px]" style={{ color }} aria-hidden>
                  {scoreGlyph(r.overall!)}
                </span>
                <span className="w-8 shrink-0 text-right font-mono text-sm font-bold tabular-nums" style={{ color }}>
                  {r.overall}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {overflow > 0 && <p className="mt-3 font-mono text-[11px] text-slate-500">+{overflow} more repos</p>}
    </div>
  );
}

function PostureMix({ counts, scored }: { counts: Record<string, number>; scored: number }) {
  const max = Math.max(1, ...POSTURE_ORDER.map((p) => counts[p] ?? 0));
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <h3 className="font-mono text-[11px] uppercase tracking-widest text-accent">Posture distribution</h3>
      <div className="mt-3 space-y-2.5">
        {POSTURE_ORDER.map((p) => {
          const n = counts[p] ?? 0;
          const color = POSTURE_HEX[p] ?? "#64748b";
          const isNative = p === "ai-native";
          return (
            <div key={p} className="flex items-center gap-3 text-sm">
              <span className={`w-32 shrink-0 truncate ${isNative ? "font-medium text-white" : "text-slate-300"}`}>
                {POSTURE_LABEL[p]}
              </span>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out motion-reduce:transition-none"
                  style={{ width: `${(n / max) * 100}%`, backgroundColor: color }}
                />
              </div>
              <span className="w-6 text-right font-mono tabular-nums" style={{ color: n > 0 ? color : "#64748b" }}>
                {n}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 font-mono text-[11px] text-slate-500">{scored} repo{scored === 1 ? "" : "s"} scored</p>
    </div>
  );
}

function MoversTicker({ ticker, running }: { ticker: Mover[]; running: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[11px] uppercase tracking-widest text-accent">Live movers</h3>
        {running && <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden />}
      </div>
      {ticker.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">
          {running ? "Waiting for the first result…" : "Results stream in here as each repo lands."}
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5" aria-live="polite">
          {ticker.map((m) => (
            <li key={m.id} className="animate-pop-in flex items-center justify-between gap-3 rounded-md px-1 text-sm">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-200" title={m.fullName}>
                {m.name}
              </span>
              {m.failed ? (
                <span className="shrink-0 font-mono text-[11px] text-orange-400">scan failed</span>
              ) : (
                <span className="flex shrink-0 items-center gap-2 font-mono text-[11px]">
                  {m.posture === "ai-native" && <span aria-hidden>🎉</span>}
                  {m.delta != null && m.delta !== 0 && (
                    <span style={{ color: m.delta > 0 ? "#84cc16" : "#f97316" }}>
                      {m.delta > 0 ? "▲" : "▼"}
                      {Math.abs(m.delta)}
                    </span>
                  )}
                  {m.level && <span className="text-slate-500">{m.level}</span>}
                  <span className="font-bold" style={{ color: m.overall != null ? scoreHex(m.overall) : "#fff" }}>
                    {m.overall}
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Celebrations({ celebrations }: { celebrations: Celebration[] }) {
  if (celebrations.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col gap-2" aria-live="polite">
      {celebrations.map((c) => (
        <div
          key={c.id}
          className="animate-burst relative overflow-hidden rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 shadow-lg shadow-emerald-500/10 backdrop-blur"
        >
          <span aria-hidden className="burst-ring absolute -left-2 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full bg-emerald-400/40" />
          <div className="relative flex items-center gap-3">
            <span className="text-xl" aria-hidden>
              🎉
            </span>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-300">Crossed into AI-Native</div>
              <div className="text-sm font-semibold text-white">
                {c.name} {c.overall != null && <span className="font-mono text-emerald-300">· {c.overall}</span>}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
