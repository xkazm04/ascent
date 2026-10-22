"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConstellationField } from "./ConstellationField";
import { EmptyFleet } from "./FleetMapChrome";
import { FleetHeader } from "./FleetMap.Header";
import { ScopeScan } from "./FleetMap.ScopeScan";
import { missionControlHref, type Installation } from "./FleetMap.constants";
import { TriageControls } from "./FleetMap.TriageControls";
import { useFleetData } from "./useFleetData";
import { useFleetScan } from "./useFleetScan";
import {
  type LaunchTriage, type SortKey, TRIAGE_QUERY_DEBOUNCE_MS, countMatches, fleetStats,
  launchTriageHref, makeMatcher, orderConstellations, resolveLaunchTriage, showTriageControls,
} from "./fleetMapDerive";
import { type Constellation, DENSE_FLEET_STARS } from "./fleetMapStars";
import { scopePlan } from "./fleetScopeModel";

export function FleetMap({
  installations,
  userName,
  next,
  triage: triageProp,
}: {
  installations: Installation[];
  userName: string;
  next: string;
  triage?: LaunchTriage;
}) {
  const [constellations, setConstellations] = useState<Constellation[]>(() =>
    installations.map((i) => ({ id: i.id, login: i.login, status: "loading" as const })),
  );
  // The map's Scan button (MAP-2): shared transport + roster model, and the scanCtrl/scanGen/recentScan
  // refs the live refresh below reads (useFleetScan).
  const fleetScan = useFleetScan(installations, setConstellations);
  const { scanning, scanError, outcomes, scanCtrl, scanGen, recentScan } = fleetScan;

  // URL is source of truth for q/levels/watched/sort; Find-a-repo is a debounced draft.
  const router = useRouter();
  const pathname = usePathname() ?? "/launch";
  const searchParams = useSearchParams();
  const urlKey = searchParams.toString();
  const urlTriage = useMemo(() => resolveLaunchTriage(searchParams, triageProp), [searchParams, triageProp]);
  const [query, setQuery] = useState(urlTriage.q);
  const [levels, setLevels] = useState(() => new Set(urlTriage.levels));
  const [watchedOnly, setWatched] = useState(urlTriage.watchedOnly);
  const [sortKey, setSort] = useState<SortKey>(urlTriage.sortKey);
  const lastWritten = useRef<string | null>(null);
  const draftRef = useRef({ query, levels, watchedOnly, sortKey });
  useEffect(() => {
    draftRef.current = { query, levels, watchedOnly, sortKey };
  });

  useEffect(() => {
    const href = `${pathname}${urlKey ? `?${urlKey}` : ""}`;
    if (lastWritten.current === href) return;
    const parsed = resolveLaunchTriage(searchParams, triageProp);
    setQuery(parsed.q);
    setLevels(new Set(parsed.levels));
    setWatched(parsed.watchedOnly);
    setSort(parsed.sortKey);
  }, [urlKey]); // eslint-disable-line react-hooks/exhaustive-deps -- urlKey is the address-bar identity

  function commit(patch?: Partial<{ q: string; levels: Set<string>; watchedOnly: boolean; sortKey: SortKey }>) {
    const d = draftRef.current;
    const href = launchTriageHref(pathname, searchParams, {
      q: patch?.q ?? d.query, levels: [...(patch?.levels ?? d.levels)],
      watchedOnly: patch?.watchedOnly ?? d.watchedOnly, sortKey: patch?.sortKey ?? d.sortKey,
    });
    const current = `${pathname}${urlKey ? `?${urlKey}` : ""}`;
    if (href === current) return;
    lastWritten.current = href;
    router.replace(href, { scroll: false });
  }

  useEffect(() => {
    if (query.trim() === urlTriage.q) return;
    const t = setTimeout(() => commit({ q: query }), TRIAGE_QUERY_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce the Find-a-repo draft only
  }, [query]);

  // Initial per-org fetch + the MAP-6 ~90s visible-tab live refresh (see useFleetData).
  const { onRetry } = useFleetData(installations, setConstellations, scanCtrl, scanGen, recentScan);

  // Fleet-wide tallies that visibly climb as each org's data streams in.
  const stats = useMemo(() => fleetStats(constellations), [constellations]);
  // Past the density cap, stop the per-star twinkle (launch-fleet-map #7): a large fleet is otherwise
  // a field of nodes repainting forever. Reduced-motion is honored in CSS independently of this.
  // Measured against total fleet REPOS, which is >= the number of stars drawn (each org's field is
  // sliced at MAX_STARS) — deliberately the conservative side; see DENSE_FLEET_STARS.
  const animateStars = stats.repos <= DENSE_FLEET_STARS;

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
  // How much of the fleet survives the filter. Because filtering DIMS rather than removes, a
  // zero-match query and "the whole fleet is faint" look identical — the count says which it is.
  const matchCount = useMemo(() => countMatches(constellations, matcher), [constellations, matcher]);
  // "Scan what you filtered": the match set's watched repos as scoped per-org runs (fleetScopeModel).
  const plan = useMemo(() => scopePlan(constellations, matcher), [constellations, matcher]);

  // Order the org cards by the chosen key; loaded constellations rank ahead of loading/error ones.
  const ordered = useMemo(() => orderConstellations(constellations, sortKey), [constellations, sortKey]);
  const missionHref = missionControlHref(next, installations);
  // `/` focuses Find a repo while these controls are mounted (TriageControls).
  const triageShown = showTriageControls(constellations.length, stats.repos);

  function toggleLevel(band: string) {
    const nextLevels = new Set(levels);
    if (nextLevels.has(band)) nextLevels.delete(band);
    else nextLevels.add(band);
    setLevels(nextLevels);
    commit({ levels: nextLevels });
  }

  return (
    // id="main": the global skip-to-content link in app/layout.tsx targets #main. Without it the
    // keyboard bypass silently no-ops on this page — the link focuses nothing and the user tabs through
    // the whole header anyway.
    <main id="main" className="launch-sky relative flex-1">
      {/* spotlight wash so the constellations feel lit from the center */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(60rem 40rem at 50% -10%, rgba(59,158,255,0.08), transparent 60%)" }}
      />

      <div className="relative mx-auto w-full max-w-6xl px-5 py-10">
        <FleetHeader userName={userName} stats={stats} hydrating={hydrating} />

        {/* Triage controls — for any multi-org fleet, and for a single org once it is dense enough to
            need triage. Gating on `length > 1` alone left the one-org / many-repos user (who needs
            search most) with no search box at all. */}
        {triageShown && (
          <TriageControls
            query={query}
            setQuery={setQuery}
            levels={levels}
            toggleLevel={toggleLevel}
            watchedOnly={watchedOnly}
            setWatchedOnly={(v) => { setWatched(v); commit({ watchedOnly: v }); }}
            sortKey={sortKey}
            setSortKey={(v) => { setSort(v); commit({ sortKey: v }); }}
            filterActive={filterActive}
            matchCount={matchCount}
            action={
              <ScopeScan
                plan={plan}
                active={fleetScan.planActive}
                cancelling={fleetScan.planCancelling}
                onRun={() => plan && void fleetScan.runPlan(plan)}
                onCancel={fleetScan.cancelPlan}
              />
            }
            onClear={() => {
              setQuery("");
              setLevels(new Set());
              setWatched(false);
              commit({ q: "", levels: new Set(), watchedOnly: false });
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
                animateStars={animateStars}
                onScan={() => void fleetScan.scan(c.login)}
                onRetry={onRetry}
                scanning={scanning === c.login}
                scanDisabled={fleetScan.scanDisabledFor(c.login)}
                scanError={scanError[c.login]}
                scanOutcome={outcomes[c.login]}
                onRetryFailed={() => void fleetScan.retryFailed(c.login)}
              />
            ))}
          </div>
        )}

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={missionHref}
            className="focus-ring rounded-xl bg-accent px-6 py-2.5 type-body font-semibold text-on-accent transition hover:bg-accent-soft"
          >
            Enter mission control →
          </Link>
          <Link
            href="/"
            className="focus-ring rounded-xl border border-slate-700 px-6 py-2.5 type-body text-slate-300 transition hover:border-accent hover:text-white"
          >
            Scan a public repo
          </Link>
        </div>
      </div>
    </main>
  );
}
