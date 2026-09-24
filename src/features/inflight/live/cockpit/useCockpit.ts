"use client";

// The cockpit's own state machine — everything LiveCockpit knows that is not layout. It composes the
// two engines (useLoopRun, useDrive) and owns the ONE thing neither of them can: which of the five
// panels the rail is showing, and what the field is drifting toward.
//
// THE ORDERING THAT MATTERS. `useDrive` is created after `useLoopRun` on purpose: a drive settles by
// handing up its terminal status, and the first thing that has to happen then is fetching the LAST
// run's detail, which only the loop hook can do. The reverse dependency — the loop settling while a
// drive is still pulling — is handled with a ref rather than state: a drive's intermediate runs each
// settle in turn, and every one of them would otherwise yank the rail out of drive mode and show an
// outcome for a run the operator never asked about.
//
// A DRIVE'S RUNS ARE THE LOOP HOOK'S TO SHOW. The drive dispatches each run server-side, so nothing
// here started it: the loop poll finds it by idle discovery, and — sooner — when the drive's own poll
// reports a new in-flight run id, the loop hook is told to look now. Until 2026-09-18 neither
// happened, and the drive panel read "Re-scoring the fleet…" for the whole drive.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { layoutBodies, type ObservatoryHistory, type ObservatorySeed } from "../observatory";
import { canArmRemote, canDriveLocally, cockpitDispatchMode, cockpitSetupMessage, cockpitSetupState, type CockpitGateInput } from "./cockpitGate";
import { cockpitNav } from "./cockpitNav";
import { cockpitStarts } from "./cockpitStarts";
import { driftFor, scanningRepos, type CockpitDrift } from "./cockpitDrift";
import { driveProgress, lastDriveRunId } from "./driveModel";
import { useDrive } from "./useDrive";
import { useLoopRun } from "./useLoopRun";
import { useProposalBatch } from "./useProposalBatch";
import { useRunDials } from "./useRunDials";
import type { DriveStatus } from "./driveTypes";
import type { CockpitMode, LoopRunDetail, LoopRunRecord, LoopRunSummary } from "./loopTypes";

export interface UseCockpitInput {
  slug: string;
  seeds: ObservatorySeed[];
  histories: ObservatoryHistory[];
  pairedRepos: string[];
  activeRun: LoopRunRecord | null;
  runs: LoopRunSummary[];
  loopEnabled: boolean;
  selfHosted: boolean;
  isOwner: boolean;
}

export function useCockpit(input: UseCockpitInput) {
  const { slug, seeds, histories, pairedRepos, activeRun, runs, loopEnabled, selfHosted, isOwner } = input;
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => initialSelection(runs, seeds));
  const [mode, setMode] = useState<CockpitMode>(activeRun ? "run" : "inspect");
  const [outcome, setOutcome] = useState<LoopRunDetail | null>(null);
  const [driveOutcome, setDriveOutcome] = useState<DriveStatus | null>(null);
  const [drift, setDrift] = useState<CockpitDrift | null>(null);
  const [replay, setReplay] = useState(0);
  /** An interrupted drive the operator waved off — a standing offer, not a modal, so it can be closed. */
  const [dismissedDriveId, setDismissedDriveId] = useState<string | null>(null);

  const bodies = useMemo(() => layoutBodies(seeds, histories), [seeds, histories]);
  const paired = useMemo(() => new Set(pairedRepos), [pairedRepos]);
  const driveLive = useRef(false);

  const settle = useCallback(
    (detail: LoopRunDetail) => {
      setOutcome(detail);
      setDrift(driftFor(seeds, histories, detail, 0));
      if (!driveLive.current) setMode("outcome");
      // The seeds this page was rendered from are now stale — the run wrote new scans.
      router.refresh();
    },
    [seeds, histories, router],
  );

  const loop = useLoopRun({ slug, initialActive: activeRun, initialRuns: runs, initialEnabled: loopEnabled, onSettled: settle });
  // ONE gate input, read by three questions that must never disagree: which card blocks the rail,
  // what this cockpit may START, and whether the DRIVE is available. Before ADR-0001 those were the
  // same boolean because there was only one kind of run; now `hosted` clears the rail without
  // clearing the drive, and building the input once is what keeps that distinction from being
  // re-derived (differently) in three places.
  const gate: CockpitGateInput = {
    selfHosted,
    repoCount: seeds.length,
    isOwner,
    enabled: loop.enabled,
    pairedCount: paired.size,
    hosted: loop.hosted,
  };
  const setup = cockpitSetupState(gate);
  const dispatchMode = cockpitDispatchMode(gate);
  const setupMessage = cockpitSetupMessage(setup, loop.hosted, loop.error);

  const driveSettled = useCallback(
    async (status: DriveStatus) => {
      setDriveOutcome(status);
      setMode("outcome");
      const id = lastDriveRunId(status);
      const detail = id ? await loop.loadDetail(id) : null;
      if (detail) {
        setOutcome(detail);
        setDrift(driftFor(seeds, histories, detail, 0));
      }
      router.refresh();
    },
    [loop, seeds, histories, router],
  );

  // `canDriveLocally`, NOT `setup == null`. A drive is a sequence of LOCAL runs, each spawning
  // `claude -p` inside a paired working copy on this server — a hosted org has no such copy, and
  // before ADR-0001 the two questions had the same answer so the looser predicate was harmless. It
  // is not harmless now: clearing the rail for a hosted org would otherwise have offered it a drive
  // that could never start.
  const drive = useDrive({ slug, enabled: canDriveLocally(gate), onSettled: driveSettled });
  // THE DIALS AND THE BATCH LIVE HERE, not in the inspector, because they are each read by two
  // surfaces that are no longer in the same column: the setup dialog (opened from the masthead) writes
  // the dials, the CTA in the rail composes a request from them, and the batch ledger under the sky
  // draws and curates what the CTA will dispatch.
  const { dials, set: setDial } = useRunDials();
  // The batch is re-proposed when a run starts and when it settles (the epoch), sized by the dial.
  const epoch = loop.live ? `live:${loop.activeId}` : "idle";
  const batch = useProposalBatch({ selected, paired, propose: loop.propose, dimFocus: dials.dimFocus, batchSize: dials.batchSize, epoch });
  useEffect(() => {
    driveLive.current = drive.live;
  }, [drive.live]);
  // The run the drive is waiting on. A new id the loop hook is not already showing → read it now.
  const driveRunId = drive.live && drive.drive ? driveProgress(drive.drive).currentRunId : null;
  const { refresh: refreshLoop, activeId: loopRunId } = loop;
  useEffect(() => {
    if (!driveRunId || driveRunId === loopRunId) return;
    const t = setTimeout(() => void refreshLoop(), 0);
    return () => clearTimeout(t);
  }, [driveRunId, loopRunId, refreshLoop]);

  // Run, remote arm, drive and resume: the four departures, with what each clears (`cockpitStarts.ts`).
  const starts = cockpitStarts({ loop, drive, dispatchMode, setMode, setDrift, setDriveOutcome });

  // The drive a restart orphaned, offered back to the operator. Only ever surfaced from `inspect`:
  // while something is running, or while an outcome is on screen, the rail is answering a different
  // question and this offer can wait.
  const interruptedDrive =
    mode === "inspect" && drive.drive?.phase === "interrupted" && drive.drive.id !== dismissedDriveId ? drive.drive : null;

  // Open a past run, replay its drift, back to the inspector (`cockpitNav.ts`).
  const nav = cockpitNav({ loop, seeds, histories, outcome, replay, setMode, setOutcome, setDriveOutcome, setReplay, setDrift });

  return {
    loop,
    drive,
    // A run this tab did not start (another tab's, the campaign script's) shows as the run it is,
    // exactly as one the page was rendered with does — derived, so there is no effect to keep in step.
    mode: mode === "inspect" && loop.live && !drive.live ? ("run" as const) : mode,
    setup,
    setupMessage,
    dispatchMode,
    // MAY THIS VIEWER ARM A RUN? It used to read `isOwner && loop.enabled`, and `loop.enabled` is
    // `autopilotEnabled()` — a fact about THIS SERVER's env, which governs the `local` mode alone. A
    // hosted org's authority comes from the server's own `hosted` answer, already folded into
    // `dispatchMode`, so asking ASCENT_AUTOPILOT about it would disable the very button ADR-0001
    // exists to enable. Ownership stays, unchanged and for both modes: the route enforces it anyway.
    canRun: isOwner && dispatchMode != null,
    // THE CLOUD CARDS' REMOTE-AGENT ARM (row 29): its own predicate, never folded into `canRun`, so the
    // gear, the local Run and the drive stay exactly as closed on a hosted deployment.
    remoteArm: canArmRemote(gate)
      ? { repos: batch.repos.length, onArm: () => void starts.armRemote(batch.repos), busy: loop.busy, error: loop.error }
      : null,
    dials,
    setDial,
    batch,
    bodies,
    paired,
    selected,
    setSelected,
    outcome,
    driveOutcome,
    interruptedDrive,
    dismissDrive: () => setDismissedDriveId(drive.drive?.id ?? null),
    drift,
    scanning: scanningRepos(loop.live ? loop.detail : null),
    laneCount: loop.live ? loop.detail?.lanes.length ?? 0 : 0,
    // A drive owns the stop while it is pulling: stopping only the in-flight run would let the drive
    // dispatch the next one, which is not what "Stop" can be allowed to mean.
    stop: drive.live ? () => void drive.stop() : loop.activeId ? () => void loop.stop(loop.activeId!) : undefined,
    startRun: starts.startRun,
    startDrive: starts.startDrive,
    resumeDrive: () => starts.resumeDrive(interruptedDrive),
    ...nav,
  };
}

/** Open on the last run's repos — the selection an operator is most likely to iterate on. */
function initialSelection(runs: readonly LoopRunSummary[], seeds: readonly ObservatorySeed[]): Set<string> {
  const known = new Set(seeds.map((s) => s.fullName));
  return new Set((runs[0]?.repos ?? []).filter((r) => known.has(r)));
}
