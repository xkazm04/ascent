"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { readSSE } from "@/lib/sse";
import { scoreHex } from "@/lib/ui";
import { ConstellationField } from "./ConstellationField";
import { EmptyFleet, Stat } from "./FleetMapChrome";
import { type Constellation, mapRepos } from "./fleetMapStars";

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

        {constellations.length === 0 ? (
          <EmptyFleet />
        ) : (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {constellations.map((c) => (
              <ConstellationField
                key={c.id}
                c={c}
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
