"use client";

// THE LOOP COCKPIT — the Live tab's default view. One dominant object (the observatory) and one
// right rail that is only ever showing ONE thing: what you have selected, what is running, or what a
// run did. The rail's mode is derived from the run's own lifecycle rather than from a tab bar,
// because at any moment exactly one of those three is the interesting question.
//
// A DRIVE is a fourth: a sequence of runs re-measured against the fleet's own green predicate after
// every one of them (src/lib/local/drive.ts). It outranks the run mode while it is pulling, because
// during a drive the interesting question is "is debt falling and how much rope is left", not "what
// is this one run doing" — and it settles into the SAME outcome ledger a single run does, with a
// verdict banner above it saying which of the three honest stops ended it.
//
// THE STANDING RUNNER (2026-09-18) is a drive too — a `continuous` one — and rides the same state:
// started from the setup dialog (`CockpitSetupDialog`), watched in the rail (`CockpitRunnerPanel`),
// stopped from the masthead, with a per-repo Resume in the rail beside the Ledger's.
//
// THE RAIL NEVER ENTERS OUTCOME MODE (wave-2). The outcome is a full-width SHEET under the grid
// (`OutcomeSection`) — one row per gap, one column per run — which also absorbed the history strip's
// job. A settled run still drifts the field and is still `setOutcome`'d; the rail simply keeps showing
// the inspector, with the selection intact, because the outcome now has a better place to be.
//
// The state is `useLiveCockpitView`; this file is layout only and owns the props contract.
import { useHashFlag } from "@/components/kit";
import { liveViewHref } from "../LiveViewSwitch";
import { OutcomeSectionView } from "../outcome/OutcomeSectionView";
import { CockpitBatchLedgerView } from "./CockpitBatchLedgerView";
import { CockpitField } from "./CockpitField";
import { CockpitMasthead } from "./CockpitMasthead";
import { CockpitRail } from "./CockpitRail";
import { CockpitSetupDialog } from "./CockpitSetupDialog";
import { PriceListPanelView } from "./PriceListPanelView";
import { dialsSummary } from "./RunSetupModal";
import { driveHeaderCaption, runnerStopHint } from "./runnerModel";
import type { LoopRunDetail, LoopRunRecord, LoopRunSummary } from "./loopTypes";
import type { ObservatoryHistory, ObservatorySeed } from "../observatory";
import { useLiveCockpitView } from "./useLiveCockpitView";

export interface LiveCockpitProps {
  slug: string;
  /** The scoped fleet standing — the same seeds the wall gets, plus `scannedAt`. */
  seeds: ObservatorySeed[];
  histories: ObservatoryHistory[];
  /** Repos with a local pairing; empty on managed cloud. */
  pairedRepos: string[];
  /** The standing runner's default scope — every WATCHED repo with a paired checkout, the list the
   *  drive route resolves when no repos are sent. Absent = `pairedRepos` (which may include unwatched
   *  repos the server will skip). */
  runnerRepos?: string[];
  activeRun: LoopRunRecord | null;
  runs: LoopRunSummary[];
  /** The details of the listed runs (bounded), for the outcome matrix. Empty on managed cloud. */
  runDetails?: LoopRunDetail[];
  /** The server's render instant, so relative ages survive hydration unchanged. */
  nowMs?: number;
  /** `autopilotEnabled()` at render time — the ASCENT_AUTOPILOT gate. */
  loopEnabled: boolean;
  selfHosted: boolean;
  isOwner: boolean;
  /** `?view=wall`, with the tab's other params preserved. */
  wallHref: string;
  /** The Live view switch's targets, the tab's other params preserved (`liveViewHref`). */
  ledgerHref?: string;
  cockpitHref?: string;
}

const NO_DETAILS: LoopRunDetail[] = [];

export function LiveCockpit(props: LiveCockpitProps) {
  const { slug, seeds, isOwner, wallHref, runDetails = NO_DETAILS } = props;
  const { c, loop, drive, railMode, runner, listOpen, toggleList, setupOpen, setSetupOpen, openRepo } = useLiveCockpitView(props);
  const [outcomeOpen] = useHashFlag("outcome");
  const live = loop.live || drive.live;
  const stopLabel = runner ? "Stop runner" : undefined;
  const stopping = loop.busy || drive.busy;

  return (
    <section aria-label="Loop cockpit" data-role="cockpit-v2" className="space-y-12">
      {!outcomeOpen && (
        <>
          <CockpitMasthead
            slug={slug}
            fleetCount={seeds.length}
            active={loop.active}
            laneCount={c.laneCount}
            live={live}
            driveCaption={driveHeaderCaption(drive.drive, drive.live)}
            wallHref={wallHref}
            ledgerHref={props.ledgerHref ?? liveViewHref({}, "ledger")}
            cockpitHref={props.cockpitHref ?? liveViewHref({}, "cockpit")}
            onOpenSetup={c.canRun ? () => setSetupOpen(true) : undefined}
            setupSummary={dialsSummary(c.dials)}
            onStop={c.stop}
            stopLabel={stopLabel}
            stopCaption={runner ? runnerStopHint(runner) : null}
            stopping={stopping}
            stopRequested={loop.stopRequested || drive.drive?.stopRequested === true}
            stopHorizonMs={loop.stopHorizonMs}
          />
          <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,25rem)]" data-role="cockpit-stage">
            <CockpitField
              bare
              bodies={c.bodies}
              selected={c.selected}
              onSelect={c.setSelected}
              scanning={c.scanning}
              drift={c.drift}
              onOpen={openRepo}
              listOpen={listOpen}
              onToggleList={toggleList}
            />
            <aside aria-label="Selection and run" data-role="cockpit-rail" className="min-w-0 border-t border-divider pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
              <CockpitRail
                slug={slug}
                mode={railMode}
                setup={c.setup}
                setupMessage={c.setupMessage}
                liveDrive={drive.live ? drive.drive : null}
                interruptedDrive={c.interruptedDrive}
                runDetail={loop.detail}
                runLive={loop.live}
                batch={c.batch}
                dials={c.dials}
                canRun={c.canRun}
                busy={stopping}
                loopError={loop.error}
                driveError={drive.error}
                onRun={(input) => void c.startRun(input)}
                onDrive={(input) => void c.startDrive(input)}
                onOpenRunner={() => {
                  c.setDial("mode", "runner");
                  setSetupOpen(true);
                }}
                onStopRun={() => loop.activeId && void loop.stop(loop.activeId)}
                onStopDrive={() => void drive.stop()}
                onResumeDrive={() => void c.resumeDrive()}
                onDismissDrive={c.dismissDrive}
                onRetryLane={(laneId) => void loop.retry(laneId)}
                onResumeRepo={(repo) => void drive.resumeRepo(repo)}
                remoteArm={c.remoteArm}
              />
            </aside>
          </div>
          <CockpitBatchLedgerView
            proposals={c.batch.proposals}
            pruned={c.batch.pruned}
            onTogglePrune={c.batch.togglePrune}
            dimFocus={c.dials.dimFocus}
            unpaired={c.batch.unpaired}
            loading={c.batch.loading}
            empty={c.batch.repos.length === 0}
            repair={{ slug, canRepair: isOwner, onRepaired: c.batch.reload }}
          />
        </>
      )}
      <OutcomeSectionView
        slug={slug}
        canReview={isOwner}
        runDetails={runDetails}
        liveDetail={loop.detail}
        openedDetail={c.outcome}
        selectedId={c.outcome?.run.id ?? loop.activeId}
        driveOutcome={c.driveOutcome}
        onOpen={(id) => void c.openRun(id)}
        onDismissDrive={c.backToInspect}
        nowMs={props.nowMs}
        aside={
          live ? (
            <button
              type="button"
              onClick={c.stop}
              disabled={stopping}
              className="focus-ring rounded-[3px] border border-danger/60 px-3 py-2 type-body-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
            >
              {stopLabel ?? "Stop"}
            </button>
          ) : null
        }
      />
      {!outcomeOpen && <PriceListPanelView slug={slug} />}
      <CockpitSetupDialog c={c} open={setupOpen} onClose={() => setSetupOpen(false)} runnerRepos={props.runnerRepos ?? props.pairedRepos} />
    </section>
  );
}
