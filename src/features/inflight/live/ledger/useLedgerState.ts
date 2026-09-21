"use client";

// The ledger's mutable state: the server load, then every change the SERVER confirmed. Each handler
// takes what a route RETURNED (the decided plan, the settled direction, the drive after a resume) and
// folds it in — nothing is removed or added on the strength of a click alone.

import { useState } from "react";
import { fetchPendingPlans } from "./ledgerClient";
import type {
  DriveStatus,
  LedgerData,
  LoopDirectionRecord,
  LoopPlanRecord,
  RunnerKeptLessonRow,
  RunnerMergeResponse,
} from "./ledgerTypes";

const upsert = <T extends { id: string }>(list: readonly T[], row: T): T[] =>
  list.some((x) => x.id === row.id) ? list.map((x) => (x.id === row.id ? row : x)) : [row, ...list];

export function useLedgerState(data: LedgerData) {
  const [pending, setPending] = useState<LoopPlanRecord[] | null>(() => (data.pending ? [...data.pending] : null));
  const [plans, setPlans] = useState<LoopPlanRecord[]>(() => [...(data.plans ?? [])]);
  const [directions, setDirections] = useState<LoopDirectionRecord[] | null>(() => (data.directions ? [...data.directions] : null));
  const [runner, setRunner] = useState<DriveStatus | null>(data.runner);
  const [lessons, setLessons] = useState<RunnerKeptLessonRow[] | null>(() => (data.lessons ? [...data.lessons] : null));
  const [ahead, setAhead] = useState<Record<string, number | null>>(data.ahead);

  /** A verdict landed: the plan leaves the inbox; an approval's direction joins the list. */
  const onDecided = (plan: LoopPlanRecord, direction: LoopDirectionRecord | null) => {
    setPending((list) => (list ? list.filter((p) => p.id !== plan.id) : list));
    setPlans((list) => upsert(list, plan));
    if (direction) setDirections((list) => upsert(list ?? [], direction));
  };

  /** A direction ended. A revoke returns its approved-but-unexecuted plans to pending on the server, so
   *  the inbox is re-read — the one place a change lands rows this view did not ask for. */
  const onDirectionSettled = (d: LoopDirectionRecord, action: "revoke" | "done") => {
    setDirections((list) => upsert(list ?? [], d));
    if (action === "revoke") {
      fetchPendingPlans(data.slug)
        .then((rows) => setPending(rows))
        .catch(() => undefined);
    }
  };

  /** The route answers a resume with the live drive — its repo states are the truth now. */
  const onRepoResumed = (drive: DriveStatus) => setRunner(drive);

  /** A fast-forward or a merge leaves the base containing the runner branch: nothing is ahead. A
   *  `commands` answer moved nothing, so the count stands. */
  const onMerged = (repo: string, result: RunnerMergeResponse) => {
    if (result.ok) setAhead((m) => ({ ...m, [repo]: 0 }));
  };

  const onLessonRevoked = (row: RunnerKeptLessonRow) => setLessons((list) => upsert(list ?? [], row));

  return { pending, plans, directions, runner, lessons, ahead, onDecided, onDirectionSettled, onRepoResumed, onMerged, onLessonRevoked };
}
