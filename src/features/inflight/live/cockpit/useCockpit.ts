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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { layoutBodies, type ObservatoryHistory, type ObservatorySeed } from "../observatory";
import { cockpitSetupState } from "./cockpitGate";
import { driftFor, scanningRepos, type CockpitDrift } from "./cockpitDrift";
import { lastDriveRunId } from "./driveModel";
import { useDrive } from "./useDrive";
import { useLoopRun } from "./useLoopRun";
import type { StartDriveInput } from "./driveClient";
import type { DriveStatus } from "./driveTypes";
import type { StartLoopInput } from "./loopClient";
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
  const setup = cockpitSetupState({ selfHosted, repoCount: seeds.length, isOwner, enabled: loop.enabled, pairedCount: paired.size });

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

  const drive = useDrive({ slug, enabled: setup == null, onSettled: driveSettled });
  useEffect(() => {
    driveLive.current = drive.live;
  }, [drive.live]);

  const startRun = async (i: StartLoopInput) => {
    setMode("run");
    setDrift(null);
    setDriveOutcome(null);
    if (!(await loop.start(i))) setMode("inspect");
  };

  const startDrive = async (i: StartDriveInput) => {
    setDrift(null);
    setDriveOutcome(null);
    await drive.start(i);
  };

  const openRun = async (id: string) => {
    if (loop.live && id === loop.activeId) return setMode("run");
    const detail = await loop.loadDetail(id);
    if (!detail) return;
    setOutcome(detail);
    setDriveOutcome(null);
    setMode("outcome");
    setReplay(0);
    setDrift(driftFor(seeds, histories, detail, 0));
  };

  const replayRun = () => {
    if (!outcome) return;
    const next = replay + 1;
    setReplay(next);
    setDrift(driftFor(seeds, histories, outcome, next));
  };

  const backToInspect = () => {
    setDriveOutcome(null);
    setMode("inspect");
  };

  return {
    loop,
    drive,
    mode,
    setup,
    bodies,
    paired,
    selected,
    setSelected,
    outcome,
    driveOutcome,
    drift,
    scanning: scanningRepos(loop.live ? loop.detail : null),
    laneCount: loop.live ? loop.detail?.lanes.length ?? 0 : 0,
    // A drive owns the stop while it is pulling: stopping only the in-flight run would let the drive
    // dispatch the next one, which is not what "Stop" can be allowed to mean.
    stop: drive.live ? () => void drive.stop() : loop.activeId ? () => void loop.stop(loop.activeId!) : undefined,
    startRun,
    startDrive,
    openRun,
    replayRun,
    backToInspect,
  };
}

/** Open on the last run's repos — the selection an operator is most likely to iterate on. */
function initialSelection(runs: readonly LoopRunSummary[], seeds: readonly ObservatorySeed[]): Set<string> {
  const known = new Set(seeds.map((s) => s.fullName));
  return new Set((runs[0]?.repos ?? []).filter((r) => known.has(r)));
}
