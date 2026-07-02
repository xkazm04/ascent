"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { readSSE } from "@/lib/sse";
import { scoreHex } from "@/lib/ui";
import { ConstellationField } from "./ConstellationField";
import { EmptyFleet, Stat } from "./FleetMapChrome";
import { applyScanEvent } from "./applyScanEvent";
import { type SortKey, fleetStats, makeMatcher, orderConstellations } from "./fleetMapDerive";
import { type Constellation, FALLER, mapRepos, RISER } from "./fleetMapStars";
import { mergeStars } from "./mergeStars";

// After a manual scan finishes, its fresh scores need a moment to land in /api/app/repos. Skip the
// ~90s live refresh for that org until this window elapses, so the poll can't pull a still-stale
// payload and dim a just-brightened star back down (MAP-6 race). Longer than the refresh interval so
// at least one poll is deferred past a scan's completion.
const SCAN_SETTLE_MS = 120_000;

const LEVEL_BANDS = ["L1", "L2", "L3", "L4", "L5", "unscanned"] as const;
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
  // Per-org message for a scan that failed (402/403/500/network) — surfaced on the card instead of
  // the button silently re-enabling with no feedback (MAP-2 silent failure).
  const [scanError, setScanError] = useState<Record<string, string>>({});
  // Completion time of the most recent successful scan per org, so the live refresh can defer that
  // org until its fresh scores have propagated (SCAN_SETTLE_MS) rather than dimming it back down.
  const recentScan = useRef<Map<string, number>>(new Map());

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
    // Clear any prior scan error for this org before retrying.
    setScanError((e) => {
      if (!e[login]) return e;
      const next = { ...e };
      delete next[login];
      return next;
    });
    const ctrl = new AbortController();
    scanCtrl.current = ctrl;
    try {
      const res = await fetch("/api/org/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: login }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        // Surface the failure (credits/permission/server) on the card instead of returning silently.
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setScanError((e) => ({ ...e, [login]: data?.error ?? `Scan failed (${res.status}).` }));
        return;
      }
      if (!res.body) {
        setScanError((e) => ({ ...e, [login]: "Scan failed — no response stream." }));
        return;
      }
      await readSSE(res.body, (msg) => {
        setConstellations((cur) => applyScanEvent(cur, login, msg));
      });
      // Mark this org just-scanned so the live refresh defers it past the propagation window.
      recentScan.current.set(login, Date.now());
    } catch {
      // Ignore user/unmount aborts; surface a real network error on the card.
      if (!ctrl.signal.aborted) {
        setScanError((e) => ({ ...e, [login]: "Network error — scan not started. Try again." }));
      }
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
            // Defer a just-scanned org until its fresh scores have propagated, so the poll can't pull
            // a stale payload and dim a star back down (MAP-6 race). Clear the marker once elapsed.
            const scannedAt = recentScan.current.get(inst.login);
            if (scannedAt != null) {
              if (Date.now() - scannedAt < SCAN_SETTLE_MS) return;
              recentScan.current.delete(inst.login);
            }
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
  const stats = useMemo(() => fleetStats(constellations), [constellations]);

  const hydrating = stats.loaded < stats.orgs;

  // A star matches when it passes every active filter. When no filter is active the matcher is
  // undefined, so ConstellationField renders at full brightness (no dimming).
  const q = query.trim().toLowerCase();
  const matcher = useMemo(() => makeMatcher({ q, levels, watchedOnly }), [q, levels, watchedOnly]);
  // Single source of truth for "is any filter active": `makeMatcher` returns undefined precisely when
  // no filter is active, so the "clear" affordance derives from the matcher rather than re-deriving
  // the three-term predicate here.
  const filterActive = matcher !== undefined;

  // Order the org cards by the chosen key; loaded constellations rank ahead of loading/error ones.
  const ordered = useMemo(() => orderConstellations(constellations, sortKey), [constellations, sortKey]);

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
              <Stat label="movers · 30d" value={`▲${stats.risers} ▼${stats.fallers}`} color={stats.risers >= stats.fallers ? RISER : FALLER} />
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
                scanError={scanError[c.login]}
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
