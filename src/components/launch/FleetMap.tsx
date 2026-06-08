"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { scoreHex } from "@/lib/ui";

// Kept structurally identical to the session's UserInstallation, but declared locally so
// this client component never imports the server-only auth module.
interface Installation {
  id: number;
  login: string;
}

interface RepoStar {
  fullName: string;
  name: string;
  private: boolean;
  /** Persisted overall maturity score (0..100), or null when not yet scanned. */
  overall: number | null;
  level: string | null;
}

type Constellation =
  | { id: number; login: string; status: "loading" }
  | { id: number; login: string; status: "error"; message: string }
  | { id: number; login: string; status: "done"; repos: RepoStar[] };

/** Shape of the `/api/app/repos` rows we read (a subset of the route's AppRepo). */
interface ApiRepo {
  fullName: string;
  name: string;
  private: boolean;
  state: { level: string | null; overall: number | null } | null;
}

const MAX_STARS = 80;
const SKELETON_STARS = 9;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const CENTER = 60;
const ACCENT = "#3b9eff";
const FAINT = "#64748b";

/** Stable 0..1 hash so star positions are deterministic (no SSR/CSR drift, no jitter on re-render). */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Phyllotaxis (sunflower) placement — organic, star-map-like spread inside the 120×120 field. */
function starPosition(i: number, total: number, seed: string): { cx: number; cy: number } {
  const jitter = hash01(seed);
  const angle = i * GOLDEN + jitter * 0.6;
  const radius = 13 + Math.sqrt((i + 0.6) / Math.max(total, 1)) * 42; // ~13..55
  return { cx: CENTER + Math.cos(angle) * radius, cy: CENTER + Math.sin(angle) * radius };
}

/** Maturity → brightness: brighter, larger, fully-saturated stars for higher-scoring repos. */
function starLook(overall: number | null): { color: string; r: number; opacity: number } {
  if (overall == null) return { color: FAINT, r: 1.1, opacity: 0.32 };
  const t = Math.max(0, Math.min(100, overall)) / 100;
  return { color: scoreHex(overall), r: 1.5 + t * 1.9, opacity: 0.55 + t * 0.45 };
}

function mapRepos(raw: unknown): RepoStar[] {
  if (!Array.isArray(raw)) return [];
  return (raw as ApiRepo[]).map((r) => ({
    fullName: String(r.fullName),
    name: String(r.name ?? r.fullName),
    private: Boolean(r.private),
    overall: r.state?.overall ?? null,
    level: r.state?.level ?? null,
  }));
}

export function FleetMap({
  installations,
  userName,
  next,
}: {
  installations: Installation[];
  userName: string;
  next: string;
}) {
  const [constellations, setConstellations] = useState<Constellation[]>(() =>
    installations.map((i) => ({ id: i.id, login: i.login, status: "loading" as const })),
  );

  useEffect(() => {
    const controller = new AbortController();
    for (const inst of installations) {
      const qs = new URLSearchParams({ org: inst.login, installation_id: String(inst.id) });
      fetch(`/api/app/repos?${qs.toString()}`, { signal: controller.signal })
        .then(async (r) => {
          const data = (await r.json().catch(() => null)) as { repos?: unknown; error?: string } | null;
          setConstellations((cur) =>
            cur.map((c) =>
              c.id !== inst.id
                ? c
                : r.ok
                  ? { id: inst.id, login: inst.login, status: "done", repos: mapRepos(data?.repos) }
                  : { id: inst.id, login: inst.login, status: "error", message: data?.error ?? `Failed (${r.status})` },
            ),
          );
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setConstellations((cur) =>
            cur.map((c) =>
              c.id === inst.id ? { id: inst.id, login: inst.login, status: "error", message: "Network error" } : c,
            ),
          );
        });
    }
    return () => controller.abort();
  }, [installations]);

  // Fleet-wide tallies that visibly climb as each org's data streams in.
  const stats = useMemo(() => {
    let repos = 0;
    let scanned = 0;
    let sum = 0;
    let loaded = 0;
    for (const c of constellations) {
      if (c.status === "done") {
        loaded += 1;
        repos += c.repos.length;
        for (const r of c.repos) {
          if (r.overall != null) {
            scanned += 1;
            sum += r.overall;
          }
        }
      }
    }
    return {
      orgs: constellations.length,
      loaded,
      repos,
      scanned,
      avg: scanned ? Math.round(sum / scanned) : null,
    };
  }, [constellations]);

  const hydrating = stats.loaded < stats.orgs;

  return (
    <main className="launch-sky relative flex-1">
      {/* spotlight wash so the constellations feel lit from the center */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(60rem 40rem at 50% -10%, rgba(59,158,255,0.08), transparent 60%)" }}
      />

      <div className="relative mx-auto w-full max-w-6xl px-5 py-10">
        <header className="animate-fade-up">
          <div className="font-mono text-sm uppercase tracking-[0.3em] text-accent">Mission Control</div>
          <h1 className="mt-1 text-3xl font-bold text-white">
            Welcome back, <span className="text-accent">{userName}</span>
          </h1>
          <p className="mt-2 max-w-2xl text-slate-400">
            Your engineering fleet, mapped as living constellations — each org a cluster, each repo a star that
            brightens with its maturity. Scores stream in below as Ascent reads your installations.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
            <Stat label="orgs" value={String(stats.orgs)} />
            <Stat label="repos" value={hydrating && stats.repos === 0 ? "…" : String(stats.repos)} />
            <Stat label="scanned" value={hydrating && stats.scanned === 0 ? "…" : String(stats.scanned)} />
            <Stat
              label="avg maturity"
              value={stats.avg == null ? "—" : String(stats.avg)}
              color={stats.avg == null ? undefined : scoreHex(stats.avg)}
            />
            <span
              className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 font-mono uppercase tracking-widest text-slate-400"
              role="status"
              aria-live="polite"
            >
              {hydrating ? `charting ${stats.loaded}/${stats.orgs}…` : "fleet charted"}
            </span>
          </div>
        </header>

        {constellations.length === 0 ? (
          <EmptyFleet />
        ) : (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {constellations.map((c) => (
              <ConstellationField key={c.id} c={c} />
            ))}
          </div>
        )}

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={next}
            className="focus-ring rounded-xl bg-accent px-6 py-2.5 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
          >
            Enter mission control →
          </Link>
          <Link
            href="/"
            className="focus-ring rounded-xl border border-slate-700 px-6 py-2.5 text-base text-slate-300 transition hover:border-accent hover:text-white"
          >
            Scan a public repo
          </Link>
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-slate-400">
      <span className="font-mono text-base font-bold tabular-nums" style={color ? { color } : { color: "#fff" }}>
        {value}
      </span>{" "}
      <span className="font-mono uppercase tracking-widest text-sm">{label}</span>
    </span>
  );
}

function EmptyFleet() {
  return (
    <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-center">
      <div className="text-4xl">🛰️</div>
      <h2 className="mt-3 text-lg font-semibold text-white">No constellations yet</h2>
      <p className="mx-auto mt-1 max-w-md text-base text-slate-400">
        Install the Ascent GitHub App on an organization or account and your repositories will appear here as a
        star-map of maturity.
      </p>
      <Link
        href="/connect"
        className="focus-ring mt-4 inline-block rounded-lg bg-accent px-5 py-2.5 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
      >
        Connect GitHub →
      </Link>
    </div>
  );
}

function ConstellationField({ c }: { c: Constellation }) {
  const repos = c.status === "done" ? c.repos.slice(0, MAX_STARS) : [];
  const scanned = c.status === "done" ? c.repos.filter((r) => r.overall != null).length : 0;
  const total = c.status === "done" ? c.repos.length : 0;
  const overflow = c.status === "done" ? Math.max(0, c.repos.length - MAX_STARS) : 0;
  const avg =
    scanned > 0
      ? Math.round(
          (c.status === "done" ? c.repos : []).reduce((s, r) => s + (r.overall ?? 0), 0) / scanned,
        )
      : null;

  return (
    <div className="launch-constellation rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/org/${encodeURIComponent(c.login)}`}
            className="block truncate font-mono text-base text-white hover:text-accent"
            title={c.login}
          >
            {c.login}
          </Link>
          <div className="font-mono text-sm uppercase tracking-widest text-slate-500">
            {c.status === "loading" && "charting…"}
            {c.status === "error" && "unreachable"}
            {c.status === "done" && `${scanned}/${total} scanned`}
          </div>
        </div>
        {avg != null && (
          <span
            className="shrink-0 rounded-full border border-slate-700 bg-slate-900/60 px-2 py-0.5 font-mono text-sm font-bold tabular-nums"
            style={{ color: scoreHex(avg) }}
            title="Average maturity of scanned repos"
          >
            {avg}
          </span>
        )}
      </div>

      <div className="relative mt-3 aspect-square">
        <svg viewBox="0 0 120 120" className="absolute inset-0 h-full w-full" role="img" aria-label={`${c.login} constellation`}>
          {/* constellation lines from the org core to each scanned repo star */}
          {c.status === "done" &&
            repos.map((r, i) => {
              if (r.overall == null) return null;
              const { cx, cy } = starPosition(i, repos.length, r.fullName);
              const look = starLook(r.overall);
              return (
                <line
                  key={`l-${r.fullName}`}
                  x1={CENTER}
                  y1={CENTER}
                  x2={cx}
                  y2={cy}
                  stroke={look.color}
                  strokeWidth={0.4}
                  opacity={0.12 + (r.overall / 100) * 0.28}
                />
              );
            })}

          {/* skeleton stars while the org's data loads */}
          {c.status !== "done" &&
            Array.from({ length: SKELETON_STARS }).map((_, i) => {
              const { cx, cy } = starPosition(i, SKELETON_STARS, `${c.login}-skeleton`);
              const style: CSSProperties = {
                ["--star-opacity" as string]: 0.3,
                animationDelay: `${(i % 5) * 0.3}s`,
              };
              return <circle key={`s-${i}`} className="launch-star" cx={cx} cy={cy} r={1.2} fill={FAINT} style={style} />;
            })}

          {/* hydrated repo stars — brightness scales with maturity */}
          {c.status === "done" &&
            repos.map((r, i) => {
              const { cx, cy } = starPosition(i, repos.length, r.fullName);
              const look = starLook(r.overall);
              const style: CSSProperties = {
                ["--star-opacity" as string]: look.opacity,
                animationDelay: `${(i % 7) * 0.28}s`,
              };
              return (
                <circle key={`d-${r.fullName}`} className="launch-star" cx={cx} cy={cy} r={look.r} fill={look.color} style={style}>
                  <title>
                    {r.fullName}
                    {r.overall != null ? ` · ${r.level ?? ""} ${r.overall}` : " · not scanned"}
                  </title>
                </circle>
              );
            })}

          {/* the org core: a pulsing beacon at the heart of the constellation */}
          <circle className="launch-glow" cx={CENTER} cy={CENTER} r={7} fill={ACCENT} opacity={0.4} />
          <circle cx={CENTER} cy={CENTER} r={2.6} fill="#e2e8f0" />
        </svg>

        {c.status === "done" && total === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-md border border-slate-800 bg-slate-900/70 px-2 py-1 font-mono text-sm text-slate-500">
              no repositories
            </span>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-sm">
        {c.status === "error" ? (
          <span className="text-amber-400/80">{c.message}</span>
        ) : (
          <span className="text-slate-500">{overflow > 0 ? `+${overflow} more stars` : " "}</span>
        )}
        <Link
          href={`/org/${encodeURIComponent(c.login)}`}
          className="font-mono uppercase tracking-widest text-accent hover:text-accent-soft"
        >
          open →
        </Link>
      </div>
    </div>
  );
}
