"use client";

// THE LOOP COCKPIT — the Live tab's default view. One dominant object (the observatory) and one
// right rail that is only ever showing ONE thing: what you have selected, what is running, or what a
// run did. The rail's mode is derived from the run's own lifecycle rather than from a tab bar,
// because at any moment exactly one of those three is the interesting question.
//
// The wall this replaces is still one link away (`?view=wall`) and is untouched — including the
// kiosk route that renders it read-only.

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Surface } from "@/components/ui";
import { reportPermalink } from "@/lib/ui";
import { ObservatoryField, ObservatoryList, layoutBodies, type ObservatoryHistory, type ObservatorySeed } from "../observatory";
import { CockpitHeader } from "./CockpitHeader";
import { CockpitHistory } from "./CockpitHistory";
import { CockpitInspector } from "./CockpitInspector";
import { CockpitOutcome } from "./CockpitOutcome";
import { CockpitRunPanel } from "./CockpitRunPanel";
import { CockpitSetup, type CockpitSetupState } from "./CockpitSetup";
import { driftFor, scanningRepos, type CockpitDrift } from "./cockpitDrift";
import { useLoopRun } from "./useLoopRun";
import type { StartLoopInput } from "./loopClient";
import type { CockpitMode, LoopRunDetail, LoopRunRecord, LoopRunSummary } from "./loopTypes";

export interface LiveCockpitProps {
  slug: string;
  /** The scoped fleet standing — the same seeds the wall gets, plus `scannedAt`. */
  seeds: ObservatorySeed[];
  histories: ObservatoryHistory[];
  /** Repos with a local pairing; empty on managed cloud. */
  pairedRepos: string[];
  activeRun: LoopRunRecord | null;
  runs: LoopRunSummary[];
  /** `autopilotEnabled()` at render time — the ASCENT_AUTOPILOT gate. */
  loopEnabled: boolean;
  selfHosted: boolean;
  isOwner: boolean;
  /** `?view=wall`, with the tab's other params preserved. */
  wallHref: string;
}

export function LiveCockpit(props: LiveCockpitProps) {
  const { slug, seeds, histories, pairedRepos, activeRun, runs, loopEnabled, selfHosted, isOwner, wallHref } = props;
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => initialSelection(runs, seeds));
  const [mode, setMode] = useState<CockpitMode>(activeRun ? "run" : "inspect");
  const [outcome, setOutcome] = useState<LoopRunDetail | null>(null);
  const [drift, setDrift] = useState<CockpitDrift | null>(null);
  const [replay, setReplay] = useState(0);
  const [listOpen, setListOpen] = useState(true);

  const bodies = useMemo(() => layoutBodies(seeds, histories), [seeds, histories]);
  const paired = useMemo(() => new Set(pairedRepos), [pairedRepos]);

  const settle = useCallback(
    (detail: LoopRunDetail) => {
      setOutcome(detail);
      setMode("outcome");
      setDrift(driftFor(seeds, histories, detail, 0));
      // The seeds this page was rendered from are now stale — the run wrote new scans.
      router.refresh();
    },
    [seeds, histories, router],
  );

  const loop = useLoopRun({ slug, initialActive: activeRun, initialRuns: runs, initialEnabled: loopEnabled, onSettled: settle });
  const scanning = useMemo(() => scanningRepos(loop.live ? loop.detail : null), [loop.live, loop.detail]);
  const laneCount = loop.live ? loop.detail?.lanes.length ?? 0 : 0;

  const start = async (input: StartLoopInput) => {
    setMode("run");
    setDrift(null);
    const run = await loop.start(input);
    if (!run) setMode("inspect");
  };

  const openRun = async (id: string) => {
    if (loop.live && id === loop.activeId) {
      setMode("run");
      return;
    }
    const detail = await loop.loadDetail(id);
    if (!detail) return;
    setOutcome(detail);
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

  const setup = setupState({ selfHosted, seeds, isOwner, enabled: loop.enabled, paired });

  return (
    <section aria-label="Loop cockpit" className="space-y-4">
      <CockpitHeader
        fleetCount={seeds.length}
        active={loop.active}
        laneCount={laneCount}
        live={loop.live}
        wallHref={wallHref}
        onStop={loop.activeId ? () => void loop.stop(loop.activeId!) : undefined}
        stopping={loop.busy}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(18rem,1.4fr)]">
        <Surface className="min-w-0 p-3">
          <ObservatoryField
            bodies={bodies}
            selected={selected}
            onSelect={setSelected}
            scanning={scanning}
            drift={drift}
            onBodyOpen={(fullName) => router.push(reportPermalink(fullName, null, slug))}
          />
          <div className="mt-2 border-t border-divider pt-2">
            <button
              type="button"
              onClick={() => setListOpen(!listOpen)}
              aria-expanded={listOpen}
              className="focus-ring rounded font-mono text-xs uppercase tracking-[0.18em] text-slate-500 hover:text-accent"
            >
              {listOpen ? "Hide fleet list" : "Show fleet list"}
            </button>
            {listOpen && (
              <ObservatoryList
                bodies={bodies}
                selected={selected}
                onSelect={setSelected}
                onOpen={(fullName) => router.push(reportPermalink(fullName, null, slug))}
                className="mt-2"
              />
            )}
          </div>
        </Surface>

        <Surface className="min-w-0 p-4">
          {mode === "run" ? (
            <CockpitRunPanel
              detail={loop.detail}
              live={loop.live}
              onStop={() => loop.activeId && void loop.stop(loop.activeId)}
              onRetry={(laneId) => void loop.retry(laneId)}
              busy={loop.busy}
              error={loop.error}
            />
          ) : mode === "outcome" && outcome ? (
            <CockpitOutcome detail={outcome} onReplay={replayRun} onBack={() => setMode("inspect")} canReplay={drift != null} />
          ) : setup ? (
            <CockpitSetup state={setup} slug={slug} message={loop.error} />
          ) : (
            <CockpitInspector
              selected={selected}
              paired={paired}
              propose={loop.propose}
              onRun={(input) => void start(input)}
              canRun={isOwner && loop.enabled}
              busy={loop.busy}
            />
          )}
        </Surface>
      </div>

      <CockpitHistory runs={loop.runs} selectedId={outcome?.run.id ?? loop.activeId} onOpen={(id) => void openRun(id)} />
    </section>
  );
}

/** Open on the last run's repos — the selection an operator is most likely to iterate on. */
function initialSelection(runs: readonly LoopRunSummary[], seeds: readonly ObservatorySeed[]): Set<string> {
  const known = new Set(seeds.map((s) => s.fullName));
  return new Set((runs[0]?.repos ?? []).filter((r) => known.has(r)));
}

function setupState(o: {
  selfHosted: boolean;
  seeds: readonly ObservatorySeed[];
  isOwner: boolean;
  enabled: boolean;
  paired: ReadonlySet<string>;
}): CockpitSetupState | null {
  if (!o.selfHosted) return "hosted";
  if (o.seeds.length === 0) return "no-repos";
  if (!o.isOwner) return "not-owner";
  if (!o.enabled) return "autopilot-off";
  if (o.paired.size === 0) return "unpaired";
  return null;
}
