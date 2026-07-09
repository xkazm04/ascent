"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { readSSE } from "@/lib/sse";
import { scoreHex } from "@/lib/ui";
import { ConstellationField } from "./ConstellationField";
import { EmptyFleet, Stat } from "./FleetMapChrome";
import { type Installation } from "./FleetMap.constants";
import { TriageControls } from "./FleetMap.TriageControls";
import { useFleetData } from "./useFleetData";
import { applyScanEvent } from "./applyScanEvent";
import { type SortKey, fleetStats, makeMatcher, orderConstellations } from "./fleetMapDerive";
import { type Constellation, FALLER, RISER } from "./fleetMapStars";

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
  // Per-org manual-scan error (quota/permission/server/network), shown inline without destroying the
  // constellation's stars or its Scan button — so the user learns WHY a scan didn't run and can retry.
  const [scanError, setScanError] = useState<Record<string, string>>({});
  const scanCtrl = useRef<AbortController | null>(null);
  // Bumped each time a manual scan begins. The auto-refresh captures it at fetch start and discards
  // its result if it changed — covering the case where a scan starts AND finishes during the refresh's
  // network round-trip (then scanCtrl.current is null again, so the abort-handle check alone misses it).
  const scanGen = useRef(0);
  useEffect(() => () => scanCtrl.current?.abort(), []);
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
  function clearScanError(login: string) {
    setScanError((e) => {
      if (!e[login]) return e;
      const next = { ...e };
      delete next[login];
      return next;
    });
  }

  async function scanOrg(login: string) {
    if (scanning) return;
    setScanning(login);
    clearScanError(login); // a fresh attempt clears any prior error for this org
    scanGen.current += 1; // mark a new live scan so a concurrent auto-refresh discards its stale result
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
        // Surface the real reason (quota 402 / permission 403 / server 500) instead of silently
        // reverting "Scanning…" → "Scan", which looks identical to "nothing watched" and makes a
        // blocked paying user retry fruitlessly.
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setScanError((m) => ({ ...m, [login]: data?.error ?? `Scan failed (${res.status}).` }));
        return;
      }
      if (!res.body) {
        setScanError((m) => ({ ...m, [login]: "Scan failed to start." }));
        return;
      }
      await readSSE(res.body, (msg) => {
        setConstellations((cur) => applyScanEvent(cur, login, msg));
      });
      // Mark this org just-scanned so the live refresh defers it past the propagation window.
      // eslint-disable-next-line react-hooks/purity -- Date.now() runs in an async scan handler (post-await), not during render
      recentScan.current.set(login, Date.now());
    } catch (e) {
      // An aborted scan (Cancel / unmount / navigation) is expected — stay silent. Any other failure
      // (a genuine network error) is surfaced so the user knows the scan didn't run.
      if ((e as { name?: string } | null)?.name !== "AbortError") {
        setScanError((m) => ({ ...m, [login]: "Network error — scan didn't run. Try again." }));
      }
    } finally {
      if (scanCtrl.current === ctrl) scanCtrl.current = null;
      setScanning((s) => (s === login ? null : s));
    }
  }

  // Initial per-org fetch + the MAP-6 ~90s visible-tab live refresh (see useFleetData).
  useFleetData(installations, setConstellations, scanCtrl, scanGen, recentScan);

  // Fleet-wide tallies that visibly climb as each org's data streams in.
  const stats = useMemo(() => fleetStats(constellations), [constellations]);

  // Hydration is done when every org has SETTLED — reached a terminal state (done OR error), not merely
  // succeeded. Keying this off `stats.loaded` (done only) stuck the header on "charting…" forever whenever
  // any org errored, since an errored org never becomes `done` (launch-fleet-map #1). An errored org still
  // surfaces AS errored per-card (ConstellationField shows "unreachable" + its message) and in the header
  // pill below ("· N unreachable"), so the fleet completes honestly instead of lying about progress.
  const hydrating = stats.settled < stats.orgs;

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
              {/* Progress counts SETTLED orgs so the fraction climbs monotonically to N/N (an errored org
                  is progress, not a stall). On completion, surface any that never loaded as "· N unreachable"
                  rather than pretending the whole fleet charted cleanly. aria-live stays polite. */}
              {hydrating
                ? `charting ${stats.settled}/${stats.orgs}…`
                : stats.errored > 0
                  ? `fleet charted · ${stats.errored} unreachable`
                  : "fleet charted"}
            </span>
          </div>
        </header>

        {/* Triage controls — usable once more than one org is charted, where the grid gets busy. */}
        {constellations.length > 1 && (
          <TriageControls
            query={query}
            setQuery={setQuery}
            levels={levels}
            toggleLevel={toggleLevel}
            watchedOnly={watchedOnly}
            setWatchedOnly={setWatchedOnly}
            sortKey={sortKey}
            setSortKey={setSortKey}
            filterActive={filterActive}
            onClear={() => {
              setQuery("");
              setLevels(new Set());
              setWatchedOnly(false);
            }}
          />
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
