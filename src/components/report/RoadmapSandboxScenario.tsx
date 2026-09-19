"use client";

// The Roadmap Sandbox's DURABLE half (roadmap-recommendation-tracking phase 2).
//
// Phase 1 (`sandbox-to-tracker-bridge`) made "Try it" able to commit statuses. It did not save the
// MODEL: the per-dimension overrides were React state, and the projected delta survived only as a
// rounded number inside an English event-trail note. Reload the report and the plan a team had just
// talked itself into was gone; nothing could ever ask whether it came true.
//
// This module owns the IO for a saved scenario (GET/PUT/DELETE /api/report/sandbox-scenario) and the
// one-shot restore into the live sandbox; the bar that renders it lives in the co-located
// RoadmapSandboxScenarioBar.tsx. Selected items are addressed by `recommendationDecisionKey` — the
// SAME cross-scan identity the roadmap dismissal decisions use — so a scenario still knows which gaps
// it covered after a re-scan reworded them, and the fragile dimension+title join carries nothing new.

import { useCallback, useEffect, useRef, useState } from "react";
import type { DimensionId, LlmRoadmapItem } from "@/lib/types";
import type { SandboxScenarioRecord } from "@/lib/db/sandbox-scenario";
import { recommendationDecisionKey } from "@/lib/report/rec-identity";

export { ScenarioBar } from "@/components/report/RoadmapSandboxScenarioBar";

/** Mirrors canonicalRepoFullName (a server module) so client-minted keys match the stored convention. */
export function canonicalRepo(owner: string, name: string): string {
  return `${owner.trim().toLowerCase()}/${name.trim().toLowerCase()}`;
}

/** The cross-scan identity of one roadmap item, as stored in a scenario's itemKeys. */
export function roadmapItemKey(repo: string, item: LlmRoadmapItem): string {
  return recommendationDecisionKey(repo, item.dimension, item.title);
}

export type ScenarioSaveState = "idle" | "saving" | "saved" | "error" | "unavailable";

export interface ScenarioPayload {
  overrides: Partial<Record<DimensionId, number>>;
  itemKeys: string[];
  baselineScore: number;
  baselineLevel: string;
  baselineScanAt: string;
  projectedScore: number;
  projectedLevel: string;
}

/**
 * Load / save / discard this viewer's scenario for one repo.
 *
 * `enabled` is the sandbox panel's open state: the report page is the highest-traffic surface in the
 * app and the overwhelming majority of its views never open the sandbox at all, so the GET is deferred
 * until someone is actually planning rather than fired on every render of every report.
 *
 * A 403 (public-funnel report) or 503 (no DB) is TERMINAL, not an error to retry: the surface simply
 * has no persistence, which is exactly what the sandbox did before this existed. `unavailable` is what
 * the bar renders as nothing at all, never as a failure the user should act on.
 */
export function useSandboxScenario(repo: string, enabled: boolean) {
  const [scenario, setScenario] = useState<SandboxScenarioRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<ScenarioSaveState>("idle");

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/report/sandbox-scenario?repo=${encodeURIComponent(repo)}`);
        if (!alive) return;
        if (res.status === 403 || res.status === 503) {
          setState("unavailable");
        } else if (res.ok) {
          const body = (await res.json()) as { scenario: SandboxScenarioRecord | null };
          if (alive) setScenario(body.scenario ?? null);
        }
      } catch {
        // A network blip leaves the sandbox in its ephemeral mode — no error surface for a feature
        // the user hasn't asked for yet.
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [repo, enabled]);

  const save = useCallback(
    async (payload: ScenarioPayload) => {
      if (state === "unavailable") return;
      setState("saving");
      try {
        const res = await fetch(`/api/report/sandbox-scenario?repo=${encodeURIComponent(repo)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.status === 403 || res.status === 503) return setState("unavailable");
        if (!res.ok) return setState("error");
        const body = (await res.json()) as { scenario: SandboxScenarioRecord };
        setScenario(body.scenario);
        setState("saved");
      } catch {
        setState("error");
      }
    },
    [repo, state],
  );

  const discard = useCallback(async () => {
    if (state === "unavailable") return;
    try {
      await fetch(`/api/report/sandbox-scenario?repo=${encodeURIComponent(repo)}`, { method: "DELETE" });
    } catch {
      // Best effort: the local clear below is what the user actually sees.
    }
    setScenario(null);
    setState("idle");
  }, [repo, state]);

  return { scenario, loaded, state, save, discard };
}

/** Same dimensions at the same scores — the check behind the "saved plan is loaded" notice. */
export function sameOverrides(
  a: Partial<Record<DimensionId, number>>,
  b: Partial<Record<DimensionId, number>>,
): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k as DimensionId] === b[k as DimensionId]);
}

/**
 * Whether the one-shot restore may write the saved model into the live sandbox.
 *
 * Pure and exported because the failure it prevents is invisible until it bites: the fetch is in
 * flight while the panel is open, so a fast user CAN drag a slider or hit "Try it" before it settles,
 * and a restore landing on top of that would silently throw away the exploration they were mid-way
 * through. Restoring only into an untouched sandbox makes the late arrival harmless.
 */
export function shouldRestore(args: {
  loaded: boolean;
  alreadyAttempted: boolean;
  scenario: SandboxScenarioRecord | null;
  liveOverrides: Partial<Record<DimensionId, number>>;
  liveSelectionCount: number;
}): boolean {
  if (!args.loaded || args.alreadyAttempted || !args.scenario) return false;
  return Object.keys(args.liveOverrides).length === 0 && args.liveSelectionCount === 0;
}

/**
 * The whole durable layer as one hook: it loads the scenario, RESTORES it into the live sandbox once,
 * and hands back the props `<ScenarioBar>` needs. The orchestrator keeps only its own slider state —
 * which is what keeps RoadmapSandbox.tsx under the 300-LOC ceiling.
 *
 * Restore is one-shot by ref AND conditional on an untouched sandbox (see `shouldRestore`), so neither
 * a later re-render nor a save — which replaces `scenario` — can re-apply the saved model over live
 * exploration.
 */
export function useScenarioSync(args: {
  repo: string;
  enabled: boolean;
  roadmap: LlmRoadmapItem[];
  overrides: Partial<Record<DimensionId, number>>;
  appliedItems: Set<number>;
  baseline: { score: number; level: string; scannedAt: string };
  projected: { score: number; level: string };
  anyChanged: boolean;
  setOverrides: (o: Partial<Record<DimensionId, number>>) => void;
  setAppliedItems: (s: Set<number>) => void;
}) {
  const { repo, roadmap, setOverrides, setAppliedItems } = args;
  const { scenario, loaded, state, save, discard } = useSandboxScenario(repo, args.enabled);
  const attempted = useRef(false);

  // The live model, read by the restore effect WITHOUT being one of its dependencies: the effect must
  // fire on load, not on every slider tick, but still needs to see whether the user has touched
  // anything by the time it does. Mirrored in an effect (never during render) and declared BEFORE the
  // restore effect, so on the commit where `loaded` flips the ref is already current.
  const live = useRef({ overrides: args.overrides, selections: args.appliedItems.size });
  useEffect(() => {
    live.current = { overrides: args.overrides, selections: args.appliedItems.size };
  });

  // One-shot restore. `attempted` is a ref because it must never itself cause a render — the two
  // parent setters below already re-render the tree with the restored model in place.
  useEffect(() => {
    if (!loaded) return;
    const ok = shouldRestore({
      loaded,
      alreadyAttempted: attempted.current,
      scenario,
      liveOverrides: live.current.overrides,
      liveSelectionCount: live.current.selections,
    });
    attempted.current = true;
    if (!ok || !scenario) return;
    const keys = new Set(scenario.itemKeys);
    const picked = new Set<number>();
    roadmap.forEach((item, i) => {
      if (keys.has(roadmapItemKey(repo, item))) picked.add(i);
    });
    setOverrides(scenario.overrides);
    setAppliedItems(picked);
  }, [loaded, scenario, roadmap, repo, setOverrides, setAppliedItems]);

  // "Your saved plan is loaded" is DERIVED, not a flag: it is true exactly while the live sliders
  // still equal the saved ones. That is both cheaper (no third piece of state to keep honest, no
  // setState inside the effect) and more truthful than a latch — the notice retires by itself the
  // moment the user drags away from the saved model, and Reset/Discard need no special handling.
  const restored =
    scenario != null && scenario.itemKeys.length + Object.keys(scenario.overrides).length > 0 &&
    sameOverrides(scenario.overrides, args.overrides);

  const barProps = {
    scenario,
    state,
    restored,
    anyChanged: args.anyChanged || args.appliedItems.size > 0,
    onDiscard: () => void discard(),
    onSave: () =>
      void save({
        overrides: args.overrides,
        itemKeys: [...args.appliedItems]
          .map((i) => roadmap[i])
          .filter((item): item is LlmRoadmapItem => Boolean(item))
          .map((item) => roadmapItemKey(repo, item)),
        baselineScore: args.baseline.score,
        baselineLevel: args.baseline.level,
        baselineScanAt: args.baseline.scannedAt,
        projectedScore: args.projected.score,
        projectedLevel: args.projected.level,
      }),
  };

  return { barProps };
}
