"use client";

// LIVE COCKPIT v2 — the Prism composition. Same props, same hooks (`useLiveCockpitView`), same panels behind them as v1;
// what changes is the STRUCTURE (docs/design/KIT-V2-LANGUAGE.md):
//   • ONE dominant element: a masthead statement, then the sky on the page with no box, the rail a ruled column beside it
//     rather than a second card.
//   • Sections are Frames with a statement head (proposed batch, price list), not stacked cards under hairline captions.
//   • The outcome is two LEVELS: a run strip on the page, the full matrix one level down (`#outcome`, Back, Esc).
//     While that level is open it is the only thing on the page, so nothing competes with the matrix.
// Honesty rules are unchanged: nothing here derives a number; every figure is a v1 figure in a different frame.
import { useHashFlag } from "@/components/kit";
import { liveViewHref } from "../LiveViewSwitch";
import { OutcomeSectionV2 } from "../outcome/OutcomeSection.v2";
import { CockpitBatchLedgerV2 } from "./CockpitBatchLedger.v2";
import { CockpitField } from "./CockpitField";
import { CockpitMastheadV2 } from "./CockpitMasthead.v2";
import { CockpitRail } from "./CockpitRail";
import { CockpitSetupDialog } from "./CockpitSetupDialog";
import { PriceListPanelV2 } from "./PriceListPanel.v2";
import { dialsSummary } from "./RunSetupModal";
import { driveHeaderCaption, runnerStopHint } from "./runnerModel";
import type { LiveCockpitProps } from "./LiveCockpit";
import type { LoopRunDetail } from "./loopTypes";
import { useLiveCockpitView } from "./useLiveCockpitView";

const NO_DETAILS: LoopRunDetail[] = [];

export function LiveCockpitV2(props: LiveCockpitProps) {
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
          <CockpitMastheadV2
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
          <CockpitBatchLedgerV2
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
      <OutcomeSectionV2
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
      {!outcomeOpen && <PriceListPanelV2 slug={slug} />}
      <CockpitSetupDialog c={c} open={setupOpen} onClose={() => setSetupOpen(false)} runnerRepos={props.runnerRepos ?? props.pairedRepos} />
    </section>
  );
}
