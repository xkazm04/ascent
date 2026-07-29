"use client";

// All state, derived values and handlers for the what-if Simulator (Simulator.tsx) — extracted so
// the component file stays JSX-only and under the 200-LOC cap. Owns no JSX (AGENTS.md extraction
// order: state/effects/handlers first). `src/lib/scoring/orgsim.ts` is the engine this hook talks to
// via /api/org/simulate; it is NOT owned by this migration.

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PRACTICES } from "@/lib/practices";
import type { FleetProjection, InvestmentRank } from "@/lib/scoring/orgsim";
// type-only (erased at compile — no server/Prisma code reaches the client bundle); the single source
// for the /api/org/simulate response shape, so the client can't drift from the server (it had dropped `metric`).
import type { GoalImpact } from "@/lib/db/plan";
import type { DimOption, RepoOption, SavedScenario } from "@/components/org/plan/SimulatorTypes";

export function useSimulator({ slug, dims }: { slug: string; dims: DimOption[] }) {
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

  return {
    dimId, setDimId, target, setTarget, extras, scope, setScope, showRepos, setShowRepos,
    result, goalImpacts, busy, error, tracking, tracked, trackError,
    ranking, rankBusy, rankError, rankingStale, rankedWith, rankedScopeLabel,
    saved, setSaved, compare, comparing,
    used, scopeLabel,
    saveScenario, toggleCompare, suggestMoves, invalidate, loadMove, toggle,
    addDimension, updateExtra, removeExtra, run, trackAsInitiative,
  };
}

export type UseSimulator = ReturnType<typeof useSimulator>;
