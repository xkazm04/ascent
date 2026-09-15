"use client";

// The browser's own writes, as one hook beside useVault: rename (typed verdict), move / trash / retry
// (one guard door, per-item report, the trash reaper), restore, and rewrite-bytes. Every write commits
// PESSIMISTICALLY through `commit`: the store answers, then the view re-lists — a failure is evidence
// the view was stale, so it refreshes too. `volume` resets the report when the fiction is rebuilt.

import { useCallback, useState } from "react";
import type { SurfaceVolume } from "@/lib/org/surface-catalog";
import { ROOT, TRASH } from "./fixtures";
import { executeMove, isFailure, planMove, reapTrash, rename, restoreFromTrash, touch, type ConflictPolicy, type Report, type Verdict } from "./mutations";
import type { Store } from "./store";

export type LastRun = { report: Report; target: string; policy: ConflictPolicy } | null;

export function useVaultMutations(store: Store, commit: (next: Store) => void, resolveTargets: () => string[], volume: SurfaceVolume) {
  const [run, setRun] = useState<LastRun>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [prevVolume, setPrevVolume] = useState(volume);
  if (prevVolume !== volume) {
    setPrevVolume(volume);
    setRun(null);
    setVerdict(null);
  }

  const doRename = useCallback(
    (id: string, name: string) => {
      const out = rename(store, id, name);
      setVerdict(out.verdict);
      commit(out.store); // a failure is evidence the view is stale: refresh either way
    },
    [commit, store],
  );

  const runMove = useCallback(
    (ids: string[], target: string, policy: ConflictPolicy, verb: Report["verb"]) => {
      const plan = planMove(store, ids, target); // THE guard door — move-to and trash both pass here
      const exec = executeMove(store, plan.ops, target, policy);
      const reaped = target === TRASH ? reapTrash(exec.store) : { store: exec.store, reaped: 0 };
      const succeeded = exec.outcomes.filter((o) => !isFailure(o)).length;
      setRun({ report: { verb, attempted: plan.ops.length, succeeded, outcomes: exec.outcomes, refused: plan.refused, reaped: reaped.reaped }, target, policy });
      commit(reaped.store);
    },
    [commit, store],
  );

  /** Targets resolve against the LIVE store at fire time, not against the count the bar showed. */
  const doMove = useCallback((target: string, policy: ConflictPolicy) => runMove(resolveTargets(), target, policy, target === TRASH ? "trash" : "move"), [resolveTargets, runMove]);

  const retryFailed = useCallback(() => {
    if (!run) return;
    runMove(run.report.outcomes.filter(isFailure).map((o) => o.id), run.target, run.policy, "retry");
  }, [run, runMove]);

  const doRestore = useCallback(
    (id: string) => {
      const out = restoreFromTrash(store, id);
      setRun({ report: { verb: "restore", attempted: 1, succeeded: isFailure(out.outcome) ? 0 : 1, outcomes: [out.outcome], refused: [], reaped: 0 }, target: ROOT, policy: "skip" });
      commit(out.store);
    },
    [commit, store],
  );

  const touchFile = useCallback((id: string) => commit(touch(store, id)), [commit, store]);

  return { run, verdict, doRename, doMove, retryFailed, doRestore, touchFile };
}
