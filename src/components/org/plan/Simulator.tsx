"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Meter, SectionHeader } from "@/components/org/ui";
import { scoreHex } from "@/lib/ui";
import { PRACTICES } from "@/lib/practices";
import type { FleetProjection, InvestmentRank } from "@/lib/scoring/orgsim";

interface DimOption {
  id: string;
  label: string;
  avg: number;
}
interface RepoOption {
  fullName: string;
  name: string;
}

/** How the scenario pulls forward one active goal (mirrors GoalImpact in src/lib/db/plan.ts). */
interface GoalImpact {
  id: string;
  label: string;
  metricLabel: string;
  target: number;
  currentValue: number;
  simulatedValue: number;
  currentEtaDate: string | null;
  simulatedEtaDate: string | null;
  reachedNow: boolean;
  daysSooner: number | null;
}

/** A saved what-if snapshot for the client-side compare scratchpad (SIM-5). */
interface SavedScenario {
  id: number;
  label: string;
  before: FleetProjection["before"];
  after: FleetProjection["after"];
  promotions: number;
  affected: number;
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** Coarse, friendly duration ("~3 days", "~8 weeks", "~5 months") — matches forecast.humanizeDays. */
function humanizeDays(days: number): string {
  if (days <= 1) return "~1 day";
  if (days < 14) return `~${days} days`;
  if (days < 60) return `~${Math.round(days / 7)} weeks`;
  return `~${Math.round(days / 30)} months`;
}

/** What-if: project the fleet impact of raising a dimension to a target across a repo set. */
export function Simulator({ slug, dims, repos }: { slug: string; dims: DimOption[]; repos: RepoOption[] }) {
  const router = useRouter();
  const [dimId, setDimId] = useState(dims[0]?.id ?? "D2");
  const [target, setTarget] = useState(70);
  // SIM-2: additional dimensions to raise in the same scenario (the primary dimId/target is leg 1).
  const [extras, setExtras] = useState<{ dimId: string; target: number }[]>([]);
  const [scope, setScope] = useState<Set<string>>(new Set());
  const [showRepos, setShowRepos] = useState(false);
  const [result, setResult] = useState<FleetProjection | null>(null);
  const [goalImpacts, setGoalImpacts] = useState<GoalImpact[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);
  const [tracked, setTracked] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [ranking, setRanking] = useState<InvestmentRank[] | null>(null);
  const [rankBusy, setRankBusy] = useState(false);
  // SIM-5: client-only saved scenarios + a 2-up compare. No backend — a scratchpad for "what if".
  const [saved, setSaved] = useState<SavedScenario[]>([]);
  const [compare, setCompare] = useState<number[]>([]);
  const idRef = useRef(0);

  function saveScenario() {
    if (!result) return;
    const label = result.fixes.map((f) => `${f.dimId}→${f.target}`).join(" + ");
    const s: SavedScenario = {
      id: ++idRef.current,
      label,
      before: result.before,
      after: result.after,
      promotions: result.promotions,
      affected: result.affected,
    };
    setSaved((xs) => [s, ...xs].slice(0, 6));
  }
  function toggleCompare(id: number) {
    setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id].slice(-2)));
  }
  const comparing = saved.filter((s) => compare.includes(s.id));

  // SIM-3: ask the engine which dimension yields the biggest fleet lift, instead of guessing.
  async function suggestMoves() {
    setRankBusy(true);
    try {
      const res = await fetch("/api/org/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, rank: true, target, repos: [...scope] }),
      });
      const data = await res.json();
      if (res.ok) setRanking((data.ranking as InvestmentRank[]).filter((r) => r.gain > 0).slice(0, 5));
    } catch {
      /* leave the manual simulator usable */
    } finally {
      setRankBusy(false);
    }
  }

  function toggle(fullName: string) {
    setScope((s) => {
      const next = new Set(s);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
  }

  // Dimensions not already in the scenario (primary + extras) — the choices for "+ add dimension".
  const used = new Set([dimId, ...extras.map((e) => e.dimId)]);
  function addDimension() {
    const next = dims.find((d) => !used.has(d.id));
    if (next) setExtras((xs) => [...xs, { dimId: next.id, target: 70 }]);
  }
  function updateExtra(idx: number, patch: Partial<{ dimId: string; target: number }>) {
    setExtras((xs) => xs.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }
  function removeExtra(idx: number) {
    setExtras((xs) => xs.filter((_, i) => i !== idx));
  }

  async function run() {
    setBusy(true);
    setError(null);
    setTracked(false);
    setTrackError(null);
    // One leg per dimension; a single leg uses the original {dimId,target} shape for clarity.
    const fixes = [{ dimId, target }, ...extras];
    try {
      const res = await fetch("/api/org/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fixes.length > 1 ? { org: slug, fixes, repos: [...scope] } : { org: slug, dimId, target, repos: [...scope] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to simulate.");
      setResult(data.projection);
      setGoalImpacts(data.goalImpacts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to simulate.");
    } finally {
      setBusy(false);
    }
  }

  // Commit the simulated scenario as a tracked Initiative — closes the "insight → plan" loop.
  // /api/org/initiatives takes the exact { dimId, targetScore, repos } shape the sim already holds.
  async function trackAsInitiative() {
    if (!result) return;
    setTracking(true);
    setTrackError(null);
    // Use the explicit selection, or the concrete repos the projection covered when scope = "all".
    const initRepos = scope.size > 0 ? [...scope] : result.repos.map((r) => r.fullName);
    const dimLabel = dims.find((d) => d.id === dimId)?.label ?? dimId;
    const title = `Raise ${dimId} · ${dimLabel} to ${target} across ${initRepos.length} repo${initRepos.length === 1 ? "" : "s"}`;
    const practiceId = PRACTICES.find((p) => p.dimId === dimId)?.id ?? null; // GOAL-3: carry the starter shape
    try {
      const res = await fetch("/api/org/initiatives", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, title, dimId, practiceId, targetScore: target, repos: initRepos }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create initiative.");
      setTracked(true);
      router.refresh(); // surface the new initiative in the Initiatives panel on this page
    } catch (e) {
      setTrackError(e instanceof Error ? e.message : "Failed to create initiative.");
    } finally {
      setTracking(false);
    }
  }

  const scopeLabel = scope.size === 0 ? "all scanned repos" : `${scope.size} selected`;

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="What-if simulator"
        description="Project the fleet impact of landing a fix before you commit the work."
      />

      {/* SIM-3: let the engine rank where to invest, instead of guessing the dimension. */}
      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-sm uppercase tracking-widest text-accent">Top moves by projected gain</span>
          <button
            onClick={suggestMoves}
            disabled={rankBusy}
            className="rounded-lg border border-slate-700 px-2.5 py-1 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50"
          >
            {rankBusy ? "Ranking…" : ranking ? "Refresh" : `Suggest (→ ${target})`}
          </button>
        </div>
        {ranking &&
          (ranking.length === 0 ? (
            <p className="mt-2 font-mono text-sm text-slate-500">No dimension moves the fleet average at this target/scope.</p>
          ) : (
            <ul className="mt-2 space-y-0.5">
              {ranking.map((r) => (
                <li key={r.dimId}>
                  <button
                    onClick={() => {
                      setDimId(r.dimId);
                      setTarget(r.target);
                      setExtras([]);
                      setResult(null);
                      setGoalImpacts([]);
                    }}
                    title={`Load ${r.dimId} → ${r.target} into the simulator`}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left font-mono text-sm text-slate-300 transition hover:bg-slate-900"
                  >
                    <span className="truncate">
                      {r.dimId} · {r.name}
                    </span>
                    <span className="shrink-0 text-emerald-300">
                      +{r.gain} avg{r.promotions ? ` · ${r.promotions}↑` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-slate-500">Raise</span>
        <select value={dimId} onChange={(e) => setDimId(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200">
          {dims.map((d) => (
            <option key={d.id} value={d.id}>
              {d.id} · {d.label} (avg {d.avg})
            </option>
          ))}
        </select>
        <span className="font-mono text-sm text-slate-500">to</span>
        <input type="number" min={0} max={100} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="w-16 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200" />
        <span className="font-mono text-sm text-slate-500">across</span>
        <button onClick={() => setShowRepos((s) => !s)} className="rounded-lg border border-slate-700 px-2.5 py-1.5 font-mono text-sm text-slate-300 hover:border-accent hover:text-white">
          {scopeLabel} ▾
        </button>
        <button onClick={run} disabled={busy} className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50">
          {busy ? "Simulating…" : "Simulate"}
        </button>
      </div>

      {/* SIM-2: additional dimensions raised in the same scenario — model a combined push. */}
      {extras.map((e, idx) => (
        <div key={idx} className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-slate-500">and</span>
          <select
            value={e.dimId}
            onChange={(ev) => updateExtra(idx, { dimId: ev.target.value })}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200"
          >
            {dims
              .filter((d) => d.id === e.dimId || !used.has(d.id))
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.id} · {d.label} (avg {d.avg})
                </option>
              ))}
          </select>
          <span className="font-mono text-sm text-slate-500">to</span>
          <input
            type="number"
            min={0}
            max={100}
            value={e.target}
            onChange={(ev) => updateExtra(idx, { target: Number(ev.target.value) })}
            className="w-16 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
          />
          <button onClick={() => removeExtra(idx)} className="font-mono text-sm text-slate-600 hover:text-orange-300" title="Remove this dimension">
            remove
          </button>
        </div>
      ))}
      {dims.length > used.size && (
        <button onClick={addDimension} className="mt-2 font-mono text-sm text-accent hover:text-white">
          + add a dimension
        </button>
      )}

      {showRepos && (
        <div className="mt-3 max-h-40 overflow-auto rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <div className="mb-2 flex gap-3 font-mono text-sm text-slate-500">
            <button onClick={() => setScope(new Set())} className="hover:text-white">all</button>
            <button onClick={() => setScope(new Set(repos.map((r) => r.fullName)))} className="hover:text-white">select all</button>
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            {repos.map((r) => (
              <label key={r.fullName} className="flex items-center gap-2 font-mono text-sm text-slate-300">
                <input type="checkbox" checked={scope.has(r.fullName)} onChange={() => toggle(r.fullName)} className="accent-accent" />
                {r.name}
              </label>
            ))}
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-orange-300">{error}</p>}

      {result && (
        <div className="mt-4 space-y-3 border-t border-slate-800 pt-4">
          {result.fixes.length > 1 && (
            <div className="font-mono text-sm text-slate-500">
              Scenario:{" "}
              {result.fixes.map((f, i) => (
                <span key={f.dimId}>
                  {i > 0 && " + "}
                  <span className="text-slate-300">
                    {f.dimId}→{f.target}
                  </span>
                </span>
              ))}
            </div>
          )}
          <div className="text-base text-slate-300">
            Applies to <span className="font-mono text-white">{result.affected}</span> repo(s) currently below target
            {result.promotions > 0 && (
              <>
                {" "}· <span className="font-mono text-emerald-300">{result.promotions}</span> would cross up a level
              </>
            )}
            .
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={trackAsInitiative}
              disabled={tracking || tracked}
              className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50"
            >
              {tracked ? "✓ Tracked as initiative" : tracking ? "Tracking…" : "Track as initiative"}
            </button>
            <button
              onClick={saveScenario}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-accent hover:text-white"
              title="Save this projection to compare against another (SIM-5)"
            >
              Save scenario
            </button>
            {tracked && <span className="font-mono text-sm text-emerald-300">Added to the Initiatives panel below.</span>}
            {trackError && <span className="font-mono text-sm text-orange-300">{trackError}</span>}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {([
              ["Overall", result.before.avgOverall, result.after.avgOverall, `${result.before.level} → ${result.after.level}`],
              ["Adoption", result.before.avgAdoption, result.after.avgAdoption, ""],
              ["Rigor", result.before.avgRigor, result.after.avgRigor, ""],
            ] as const).map(([label, before, after, note]) => (
              <div key={label} className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
                <div className="font-mono text-sm uppercase tracking-widest text-slate-500">{label}</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold tabular-nums" style={{ color: scoreHex(after) }}>{after}</span>
                  <span className="font-mono text-sm text-slate-500">from {before}</span>
                  <span className={`font-mono text-sm ${after - before > 0 ? "text-emerald-300" : after - before < 0 ? "text-orange-300" : "text-slate-600"}`}>
                    {signed(after - before)}
                  </span>
                </div>
                <Meter className="mt-2" size="sm" value={after} color={scoreHex(after)} threshold={before} />
                {note && <div className="mt-1 font-mono text-sm text-slate-400">{note}</div>}
              </div>
            ))}
          </div>

          {/* SIM-4: how landing this scenario pulls forward the org's active goals. */}
          {goalImpacts.length > 0 && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <div className="font-mono text-sm uppercase tracking-widest text-emerald-300">Goal impact</div>
              <ul className="mt-2 space-y-1.5">
                {goalImpacts.map((g) => (
                  <li key={g.id} className="text-sm text-slate-300">
                    <span className="font-medium text-white">{g.label}</span>{" "}
                    <span className="font-mono text-slate-500">
                      ({g.metricLabel} {g.currentValue}→{g.simulatedValue})
                    </span>{" "}
                    {g.reachedNow ? (
                      <span className="font-mono text-emerald-300">reaches its target of {g.target}.</span>
                    ) : g.currentEtaDate && g.simulatedEtaDate ? (
                      <span className="font-mono">
                        ETA <span className="text-slate-400">{g.currentEtaDate}</span> →{" "}
                        <span className="text-emerald-300">{g.simulatedEtaDate}</span>
                        {g.daysSooner != null && g.daysSooner > 0 && (
                          <span className="text-emerald-300"> ({humanizeDays(g.daysSooner)} sooner)</span>
                        )}
                      </span>
                    ) : g.simulatedEtaDate ? (
                      <span className="font-mono text-emerald-300">projects a target ETA of {g.simulatedEtaDate}.</span>
                    ) : (
                      <span className="font-mono text-slate-400">moves the metric toward its target.</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.repos.filter((r) => r.delta > 0).length > 0 && (
            <div>
              <div className="font-mono text-sm uppercase tracking-widest text-slate-500">Biggest movers</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {result.repos
                  .filter((r) => r.delta > 0)
                  .slice(0, 12)
                  .map((r) => (
                    <span key={r.fullName} className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-sm text-slate-300">
                      {r.name} <span className="text-emerald-300">{signed(r.delta)}</span>
                      {r.levelUp && <span className="ml-1 text-accent">↑{r.levelAfter}</span>}
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SIM-5: saved scenarios + a 2-up compare (client-only scratchpad). */}
      {saved.length > 0 && (
        <div className="mt-4 border-t border-slate-800 pt-4">
          <div className="font-mono text-sm uppercase tracking-widest text-slate-500">
            Saved scenarios <span className="text-slate-600">· tick two to compare</span>
          </div>
          <div className="mt-2 space-y-1.5">
            {saved.map((s) => (
              <label key={s.id} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-1.5 font-mono text-sm">
                <input type="checkbox" checked={compare.includes(s.id)} onChange={() => toggleCompare(s.id)} className="accent-accent" />
                <span className="min-w-0 flex-1 truncate text-slate-200">{s.label}</span>
                <span className="shrink-0 text-slate-500">
                  overall <span style={{ color: scoreHex(s.after.avgOverall) }}>{s.after.avgOverall}</span>{" "}
                  <span className="text-emerald-300">{signed(s.after.avgOverall - s.before.avgOverall)}</span>
                  {s.promotions > 0 && <span className="text-accent"> · {s.promotions}↑</span>}
                </span>
                <button onClick={() => setSaved((xs) => xs.filter((x) => x.id !== s.id))} className="text-slate-600 hover:text-orange-300" title="Remove">
                  ×
                </button>
              </label>
            ))}
          </div>

          {comparing.length === 2 && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {comparing.map((s) => (
                <div key={s.id} className="rounded-xl border border-slate-800 bg-slate-950/30 p-3">
                  <div className="truncate font-mono text-sm text-white">{s.label}</div>
                  <div className="mt-1 font-mono text-sm text-slate-400">{s.affected} repo(s) moved · {s.promotions} promoted</div>
                  <div className="mt-2 space-y-1">
                    {([
                      ["Overall", s.before.avgOverall, s.after.avgOverall],
                      ["Adoption", s.before.avgAdoption, s.after.avgAdoption],
                      ["Rigor", s.before.avgRigor, s.after.avgRigor],
                    ] as const).map(([label, b, a]) => (
                      <div key={label} className="flex items-baseline justify-between gap-2 font-mono text-sm">
                        <span className="text-slate-500">{label}</span>
                        <span>
                          <span style={{ color: scoreHex(a) }}>{a}</span>{" "}
                          <span className="text-slate-600">from {b}</span>{" "}
                          <span className={a - b > 0 ? "text-emerald-300" : "text-slate-600"}>{signed(a - b)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
