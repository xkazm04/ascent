"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { readSSE } from "@/lib/sse";
import { scoreHex } from "@/lib/ui";
import { ConstellationField } from "./ConstellationField";
import { EmptyFleet, Stat } from "./FleetMapChrome";
import { type Constellation, type RepoStar, mapRepos } from "./fleetMapStars";

/** Merge a fresh repo set into the prior one (MAP-6 live refresh): keep the OLD object identity for
 *  any star whose score/level/movement is unchanged, so React doesn't re-animate it; swap only changed
 *  stars; append newly-appeared repos. Preserves order. Pure. */
function mergeStars(prev: RepoStar[], fresh: RepoStar[]): RepoStar[] {
  const freshBy = new Map(fresh.map((s) => [s.fullName, s]));
  const merged = prev.map((p) => {
    const f = freshBy.get(p.fullName);
    if (!f) return p;
    freshBy.delete(p.fullName);
    return f.overall === p.overall && f.level === p.level && f.dOverall === p.dOverall && f.watched === p.watched ? p : f;
  });
  for (const f of freshBy.values()) merged.push(f); // repos that appeared since the last pull
  return merged;
}

const LEVEL_BANDS = ["L1", "L2", "L3", "L4", "L5", "unscanned"] as const;
type SortKey = "name" | "maturity" | "repos" | "movement";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "name", label: "name" },
  { key: "maturity", label: "maturity" },
  { key: "repos", label: "repos" },
  { key: "movement", label: "movement" },
];

// Kept structurally identical to the session's UserInstallation, but declared locally so
// this client component never imports the server-only auth module.
interface Installation {
  id: number;
  login: string;
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
  // Org login currently scanning from the map (MAP-2) + an abort handle for cleanup.
  const [scanning, setScanning] = useState<string | null>(null);
  const scanCtrl = useRef<AbortController | null>(null);
  useEffect(() => () => scanCtrl.current?.abort(), []);

  // Fleet triage controls (MAP-4): search, level-band filter, watched-only, and an org sort key.
  // Filters DIM non-matching stars (preserving each constellation's shape); sort reorders the org cards.
  const [query, setQuery] = useState("");
  const [levels, setLevels] = useState<Set<string>>(new Set());
  const [watchedOnly, setWatchedOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");

  // Scan an org's watched repos straight from the map — reuses the dashboard's SSE bulk scan and
  // brightens each star in place as results land, so a near-empty grey field can be lit up on the
  // spot (the page the OAuth callback deliberately lands on).
  async function scanOrg(login: string) {
    if (scanning) return;
    setScanning(login);
    const ctrl = new AbortController();
    scanCtrl.current = ctrl;
    try {
      const res = await fetch("/api/org/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: login }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) return;
      await readSSE(res.body, ({ event, data }) => {
        if (event !== "repo" || !data || data.error || data.skipped || !data.repo) return;
        const fullName = String(data.repo);
        const overall = Number(data.overall);
        if (!Number.isFinite(overall)) return;
        const level = data.level != null ? String(data.level) : null;
        setConstellations((cur) =>
          cur.map((c) =>
            c.login === login && c.status === "done"
              ? { ...c, repos: c.repos.map((r) => (r.fullName === fullName ? { ...r, overall, level } : r)) }
              : c,
          ),
        );
      });
    } catch {
      /* aborted or network — leave the seeded stars as-is */
    } finally {
      if (scanCtrl.current === ctrl) scanCtrl.current = null;
      setScanning((s) => (s === login ? null : s));
    }
  }

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

  // MAP-6: keep the constellation live — re-pull each org every ~90s while the tab is VISIBLE, patching
  // changed stars in place (unchanged stars keep their identity via mergeStars, so they don't re-animate).
  // Skips a hidden tab and never fights an in-flight manual scan (the SSE stream owns the stars then).
  useEffect(() => {
    if (installations.length === 0) return;
    let cancelled = false;
    async function refreshAll() {
      if (document.visibilityState !== "visible" || scanCtrl.current) return;
      await Promise.all(
        installations.map(async (inst) => {
          try {
            const qs = new URLSearchParams({ org: inst.login, installation_id: String(inst.id) });
            const r = await fetch(`/api/app/repos?${qs.toString()}`);
            if (!r.ok || cancelled) return;
            const data = (await r.json().catch(() => null)) as { repos?: unknown } | null;
            const fresh = mapRepos(data?.repos);
            if (cancelled) return;
            setConstellations((cur) =>
              cur.map((c) => (c.id === inst.id && c.status === "done" ? { ...c, repos: mergeStars(c.repos, fresh) } : c)),
            );
          } catch {
            /* leave the stars as-is on a transient blip */
          }
        }),
      );
    }
    const id = setInterval(refreshAll, 90_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [installations]);

  // Fleet-wide tallies that visibly climb as each org's data streams in.
  const stats = useMemo(() => {
    let repos = 0;
    let scanned = 0;
    let sum = 0;
    let loaded = 0;
    let risers = 0;
    let fallers = 0;
    for (const c of constellations) {
      if (c.status === "done") {
        loaded += 1;
        repos += c.repos.length;
        for (const r of c.repos) {
          if (r.overall != null) {
            scanned += 1;
            sum += r.overall;
          }
          if (r.dOverall != null && r.dOverall >= 1) risers += 1;
          else if (r.dOverall != null && r.dOverall <= -1) fallers += 1;
        }
      }
    }
    return {
      orgs: constellations.length,
      loaded,
      repos,
      scanned,
      avg: scanned ? Math.round(sum / scanned) : null,
      risers,
      fallers,
    };
  }, [constellations]);

  const hydrating = stats.loaded < stats.orgs;

  // A star matches when it passes every active filter. When no filter is active the matcher is
  // undefined, so ConstellationField renders at full brightness (no dimming).
  const q = query.trim().toLowerCase();
  const filterActive = q !== "" || levels.size > 0 || watchedOnly;
  const matcher = useMemo(() => {
    if (!filterActive) return undefined;
    return (r: RepoStar) => {
      if (q && !r.fullName.toLowerCase().includes(q)) return false;
      if (watchedOnly && !r.watched) return false;
      if (levels.size > 0 && !levels.has(r.level ?? "unscanned")) return false;
      return true;
    };
  }, [filterActive, q, watchedOnly, levels]);

  // Order the org cards by the chosen key; loaded constellations rank ahead of loading/error ones.
  const ordered = useMemo(() => {
    const metric = (c: Constellation): number => {
      if (c.status !== "done") return -1;
      const scored = c.repos.filter((r) => r.overall != null);
      if (sortKey === "repos") return c.repos.length;
      if (sortKey === "movement") return c.repos.reduce((s, r) => s + Math.abs(r.dOverall ?? 0), 0);
      if (sortKey === "maturity") return scored.length ? scored.reduce((s, r) => s + (r.overall ?? 0), 0) / scored.length : 0;
      return 0; // name handled below
    };
    return [...constellations].sort((a, b) => {
      const da = a.status === "done" ? 0 : 1;
      const db = b.status === "done" ? 0 : 1;
      if (da !== db) return da - db; // done first
      if (sortKey === "name") return a.login.localeCompare(b.login);
      return metric(b) - metric(a); // maturity / repos / movement: high to low
    });
  }, [constellations, sortKey]);

  function toggleLevel(band: string) {
    setLevels((s) => {
      const next = new Set(s);
      if (next.has(band)) next.delete(band);
      else next.add(band);
      return next;
    });
  }

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
            {(stats.risers > 0 || stats.fallers > 0) && (
              <Stat label="movers · 30d" value={`▲${stats.risers} ▼${stats.fallers}`} color={stats.risers >= stats.fallers ? "#34d399" : "#f97316"} />
            )}
            <span
              className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 font-mono uppercase tracking-widest text-slate-400"
              role="status"
              aria-live="polite"
            >
              {hydrating ? `charting ${stats.loaded}/${stats.orgs}…` : "fleet charted"}
            </span>
          </div>
        </header>

        {/* Triage controls — usable once more than one org is charted, where the grid gets busy. */}
        {constellations.length > 1 && (
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a repo…"
              aria-label="Filter repositories by name"
              className="w-40 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-sm text-slate-200 placeholder:text-slate-600"
            />
            <div className="flex items-center gap-1">
              {LEVEL_BANDS.map((b) => {
                const on = levels.has(b);
                return (
                  <button
                    key={b}
                    type="button"
                    onClick={() => toggleLevel(b)}
                    aria-pressed={on}
                    className={`rounded-md border px-2 py-0.5 font-mono text-sm transition ${
                      on ? "border-accent bg-accent/15 text-white" : "border-slate-700 text-slate-400 hover:text-white"
                    }`}
                  >
                    {b === "unscanned" ? "—" : b}
                  </button>
                );
              })}
            </div>
            <label className="flex items-center gap-1.5 font-mono text-sm text-slate-400">
              <input type="checkbox" checked={watchedOnly} onChange={(e) => setWatchedOnly(e.target.checked)} className="accent-accent" />
              watched only
            </label>
            <label className="ml-auto flex items-center gap-1.5 font-mono text-sm text-slate-500">
              sort
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-sm text-slate-200"
              >
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            {filterActive && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setLevels(new Set());
                  setWatchedOnly(false);
                }}
                className="font-mono text-sm text-slate-500 hover:text-white"
              >
                clear
              </button>
            )}
          </div>
        )}

        {constellations.length === 0 ? (
          <EmptyFleet />
        ) : (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {ordered.map((c) => (
              <ConstellationField
                key={c.id}
                c={c}
                matcher={matcher}
                onScan={() => scanOrg(c.login)}
                scanning={scanning === c.login}
                scanDisabled={scanning !== null && scanning !== c.login}
              />
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
