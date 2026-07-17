"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import { PRACTICES } from "@/lib/practices";
import type { FleetProjection, InvestmentRank } from "@/lib/scoring/orgsim";
// type-only (erased at compile — no server/Prisma code reaches the client bundle); the single source
// for the /api/org/simulate response shape, so the client can't drift from the server (it had dropped `metric`).
import type { GoalImpact } from "@/lib/db/plan";
import type { DimOption, RepoOption, SavedScenario } from "@/components/org/plan/Simulator.types";
import { RankPanel } from "@/components/org/plan/Simulator.RankPanel";
import { ProjectionResult } from "@/components/org/plan/Simulator.ProjectionResult";
import { SavedScenarios } from "@/components/org/plan/Simulator.SavedScenarios";

/** Clamp a typed target into 0..100 (investment 07-16 #3): the inputs' HTML min/max only constrain
 *  the spinner arrows — typing "150" / "-5" went straight into state, then either 400'd on simulate
 *  or was silently swapped for 70 by the rank route while the button advertised the typed value.
 *  Empty/garbage input keeps the previous value instead of `Number("") = 0` silently jumping to 0.
 *  ONE sanitizer for all target inputs (primary + extras), so the bounds can't drift. */
function clampTarget(raw: string, prev: number): number {
  if (raw.trim() === "") return prev;
  const n = Number(raw);
  if (!Number.isFinite(n)) return prev;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** What-if: project the fleet impact of raising a dimension to a target across a repo set. */
export function Simulator({ slug, dims, repos }: { slug: string; dims: DimOption[]; repos: RepoOption[] }) {
  const router = useRouter();
  const [dimId, setDimId] = useState(dims[0]?.id ?? "D2");
  const [target, setTarget] = useState(70);
  // SIM-2: additional dimensions to raise in the same scenario (the primary dimId/target is leg 1).
  // Each row carries a stable `key`: keying the rendered rows by array index mis-associated row
  // state after a mid-list remove (investment 07-16 #5).
  const [extras, setExtras] = useState<{ key: number; dimId: string; target: number }[]>([]);
  const extraKeyRef = useRef(0);
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
  const [rankError, setRankError] = useState<string | null>(null);
  // The inputs the current ranking was computed FROM. The ranking derives from the live `target` and
  // `scope` exactly like the projection does, but it isn't cleared by invalidate() (clearing it on
  // loadMove would destroy the list the user is picking from) — so instead we remember what it was
  // computed with and visibly mark it stale when the live inputs diverge, preventing "Top moves"
  // computed for one fleet slice from reading as live advice for another (investment 07-16 #1).
  const [rankedWith, setRankedWith] = useState<{ target: number; scopeKey: string; scopeSize: number } | null>(null);
  // SIM-5: client-only saved scenarios + a 2-up compare. No backend — a scratchpad for "what if".
  const [saved, setSaved] = useState<SavedScenario[]>([]);
  const [compare, setCompare] = useState<number[]>([]);
  const idRef = useRef(0);

  function saveScenario() {
    if (!result) return;
    const label = result.fixes.map((f) => `${f.dimId}→${f.target}`).join(" + ");
    // Capture the repo scope at save time (investment 07-16 #4): the legs alone labelled two saves
    // of "D2→70" identically even when one covered 3 selected repos and the other the whole fleet,
    // so the 2-up compare silently compared different fleets. `result.repos` is the set the
    // projection actually covered — not the mutable live selection.
    const s: SavedScenario = {
      id: ++idRef.current,
      label,
      scope: scope.size > 0 ? `${scope.size} repo${scope.size === 1 ? "" : "s"}` : `all (${result.repos.length})`,
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
    setRankError(null);
    try {
      const res = await fetch("/api/org/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, rank: true, target, repos: [...scope] }),
      });
      const data = await res.json().catch(() => ({}));
      // Previously a non-ok response (404 "no scanned repos", 503 "requires a database", 401/403, or a
      // network throw with an empty catch) cleared the spinner and changed nothing, so a failed request
      // looked identical to "no suggestions" — the user re-clicked with no idea why. Surface the reason.
      // (investment-simulator-forecast #3)
      if (!res.ok) throw new Error(data.error ?? "Couldn't rank moves.");
      // Keep a move that promotes a repo across a band even when its fleet-AVERAGE lift rounds to 0:
      // gain is a diff of two rounded integers, so a real promotion (64→65, L3→L4) can read gain=0 yet
      // promotions>0. Dropping it hid the single most valuable recommendation (investment #2).
      setRanking((data.ranking as InvestmentRank[]).filter((r) => r.gain > 0 || r.promotions > 0).slice(0, 5));
      // Record the EFFECTIVE target the ranking was computed with — the route echoes it (it falls
      // back to 70 for an out-of-range value), so the stale badge / "computed for … at target T"
      // note can never advertise a target the engine didn't actually use (investment 07-16 #3).
      const effectiveTarget = typeof data.target === "number" ? data.target : target;
      setRankedWith({ target: effectiveTarget, scopeKey: [...scope].sort().join("\n"), scopeSize: scope.size });
    } catch (e) {
      setRankError(e instanceof Error ? e.message : "Couldn't rank moves.");
    } finally {
      setRankBusy(false);
    }
  }

  // Invalidate a computed projection once ANY input it was derived from (dimension, target, scope,
  // extra legs) changes: the on-screen numbers would otherwise be stale, and "Track as initiative"
  // sources its repo scope from the LIVE `scope` — so an edited-but-not-re-simulated scenario could
  // persist an initiative whose scope disagrees with what was projected/reviewed (investment #3).
  function invalidate() {
    setResult(null);
    setGoalImpacts([]);
    setTracked(false);
    setTrackError(null);
  }

  function loadMove(r: InvestmentRank) {
    setDimId(r.dimId);
    setTarget(r.target);
    setExtras([]);
    invalidate();
  }

  function toggle(fullName: string) {
    invalidate();
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
    if (next) {
      invalidate();
      setExtras((xs) => [...xs, { key: ++extraKeyRef.current, dimId: next.id, target: 70 }]);
    }
  }
  function updateExtra(idx: number, patch: Partial<{ dimId: string; target: number }>) {
    invalidate();
    setExtras((xs) => xs.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }
  function removeExtra(idx: number) {
    invalidate();
    setExtras((xs) => xs.filter((_, i) => i !== idx));
  }

  async function run() {
    setBusy(true);
    setError(null);
    setTracked(false);
    setTrackError(null);
    // One leg per dimension; a single leg uses the original {dimId,target} shape for clarity.
    // (extras' client-side `key` is stripped — the API contract is exactly {dimId, target}.)
    const fixes = [{ dimId, target }, ...extras.map((x) => ({ dimId: x.dimId, target: x.target }))];
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
  // POLICY: initiatives are single-dimension by design (/api/org/initiatives takes one
  // { dimId, targetScore, repos }); multi-leg scenarios are REJECTED at the button
  // (ProjectionResult disables Track when result.fixes.length > 1) rather than looped over here.
  // A per-leg loop was rejected because it is non-atomic: leg 1 POST succeeds, leg 2 fails →
  // the retry re-creates leg 1 as a duplicate initiative server-side. Sourcing the single fix from
  // result.fixes (the immutable snapshot that produced the on-screen projection) instead of the
  // mutable form state means editing the dropdown after simulating still can't track a target that
  // disagrees with what leadership reviewed. (investment 07-16 #2)
  async function trackAsInitiative() {
    if (!result || result.fixes.length !== 1) return; // multi-leg is blocked in the UI; guard it here too
    const fix = result.fixes[0]!;
    setTracking(true);
    setTrackError(null);
    // Use the explicit selection, or the concrete repos the projection covered when scope = "all".
    const initRepos = scope.size > 0 ? [...scope] : result.repos.map((r) => r.fullName);
    try {
      const dimLabel = dims.find((d) => d.id === fix.dimId)?.label ?? fix.dimId;
      const title = `Raise ${fix.dimId} · ${dimLabel} to ${fix.target} across ${initRepos.length} repo${initRepos.length === 1 ? "" : "s"}`;
      const practiceId = PRACTICES.find((p) => p.dimId === fix.dimId)?.id ?? null; // GOAL-3: carry the starter shape
      const res = await fetch("/api/org/initiatives", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, title, dimId: fix.dimId, practiceId, targetScore: fix.target, repos: initRepos }),
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

  // Stale when the live target/scope no longer match what the ranking was computed with (investment 07-16 #1).
  const scopeKey = useMemo(() => [...scope].sort().join("\n"), [scope]);
  const rankingStale =
    ranking !== null && rankedWith !== null && (rankedWith.target !== target || rankedWith.scopeKey !== scopeKey);
  const rankedScopeLabel =
    rankedWith === null ? null : rankedWith.scopeSize === 0 ? "all scanned repos" : `${rankedWith.scopeSize} selected repo${rankedWith.scopeSize === 1 ? "" : "s"}`;

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="What-if simulator"
        description="Project the fleet impact of landing a fix before you commit the work."
      />

      {/* SIM-3: let the engine rank where to invest, instead of guessing the dimension. */}
      <RankPanel
        ranking={ranking}
        rankBusy={rankBusy}
        rankError={rankError}
        target={target}
        stale={rankingStale}
        staleNote={rankingStale && rankedWith ? `computed for ${rankedScopeLabel} at target ${rankedWith.target}` : null}
        onSuggest={suggestMoves}
        onLoadMove={loadMove}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-slate-500">Raise</span>
        <select aria-label="Dimension to raise" value={dimId} onChange={(e) => { invalidate(); setDimId(e.target.value); }} className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200">
          {dims.map((d) => (
            <option key={d.id} value={d.id}>
              {d.id} · {d.label} (avg {d.avg})
            </option>
          ))}
        </select>
        <span className="font-mono text-sm text-slate-500">to</span>
        <input aria-label="Target score" type="number" min={0} max={100} value={target} onChange={(e) => { invalidate(); setTarget(clampTarget(e.target.value, target)); }} className="w-16 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200" />
        <span className="font-mono text-sm text-slate-500">across</span>
        <button
          onClick={() => setShowRepos((s) => !s)}
          aria-expanded={showRepos}
          aria-controls="sim-scope-repos"
          className="rounded-lg border border-slate-700 px-2.5 py-1.5 font-mono text-sm text-slate-300 hover:border-accent hover:text-white"
        >
          {scopeLabel} ▾
        </button>
        <button onClick={run} disabled={busy} className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50">
          {busy ? "Simulating…" : "Simulate"}
        </button>
      </div>

      {/* SIM-2: additional dimensions raised in the same scenario — model a combined push. */}
      {extras.map((e, idx) => (
        <div key={e.key} className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-slate-500">and</span>
          <select
            aria-label={`Additional dimension ${idx + 2} to raise`}
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
            aria-label={`Target score for dimension ${idx + 2}`}
            type="number"
            min={0}
            max={100}
            value={e.target}
            onChange={(ev) => updateExtra(idx, { target: clampTarget(ev.target.value, e.target) })}
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
        <div id="sim-scope-repos" className="mt-3 max-h-40 overflow-auto rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <div className="mb-2 flex gap-3 font-mono text-sm text-slate-500">
            <button onClick={() => { invalidate(); setScope(new Set()); }} className="hover:text-white">all</button>
            <button onClick={() => { invalidate(); setScope(new Set(repos.map((r) => r.fullName))); }} className="hover:text-white">select all</button>
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

      {/* role="status": a screen-reader user who clicked Simulate must HEAR the failure — a plain <p>
          inserted after the fact announces nothing (investment 07-16 #5). */}
      {error && <p role="status" className="mt-3 text-sm text-orange-300">{error}</p>}

      {result && (
        <ProjectionResult
          result={result}
          goalImpacts={goalImpacts}
          tracking={tracking}
          tracked={tracked}
          trackError={trackError}
          onTrack={trackAsInitiative}
          onSave={saveScenario}
        />
      )}

      {/* SIM-5: saved scenarios + a 2-up compare (client-only scratchpad). */}
      {saved.length > 0 && (
        <SavedScenarios
          saved={saved}
          compare={compare}
          comparing={comparing}
          onToggleCompare={toggleCompare}
          onRemove={(id) => setSaved((xs) => xs.filter((x) => x.id !== id))}
        />
      )}
    </Card>
  );
}
