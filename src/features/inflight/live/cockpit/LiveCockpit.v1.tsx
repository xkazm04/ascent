"use client";

// LIVE COCKPIT v1 — the shipped (Altimeter) composition, moved here unchanged from LiveCockpit.tsx when the entry
// began choosing by theme. Behaviour comes from `useLiveCockpitView`, shared with v2.

import { Surface } from "@/components/ui";
import { liveViewHref } from "../LiveViewSwitch";
import { OutcomeSection } from "../outcome/OutcomeSection";
import { CockpitBatchLedger } from "./CockpitBatchLedger";
import { CockpitField } from "./CockpitField";
import { CockpitHeader } from "./CockpitHeader";
import { CockpitRail } from "./CockpitRail";
import { CockpitSetupDialog } from "./CockpitSetupDialog";
import { PriceListPanel } from "./PriceListPanel";
import { dialsSummary } from "./RunSetupModal";
import { driveHeaderCaption, runnerStopHint } from "./runnerModel";
import type { LiveCockpitProps } from "./LiveCockpit";
import type { LoopRunDetail } from "./loopTypes";
import { useLiveCockpitView } from "./useLiveCockpitView";

const NO_DETAILS: LoopRunDetail[] = [];

export function LiveCockpitV1(props: LiveCockpitProps) {
  const { slug, seeds, isOwner, wallHref, runDetails = NO_DETAILS } = props;
  const { c, loop, drive, railMode, runner, listOpen, toggleList, setupOpen, setSetupOpen, openRepo } = useLiveCockpitView(props);
  return (
    <section aria-label="Loop cockpit" className="space-y-4">
      <CockpitHeader
        slug={slug}
        fleetCount={seeds.length}
        active={loop.active}
        laneCount={c.laneCount}
        live={loop.live || drive.live}
        driveCaption={driveHeaderCaption(drive.drive, drive.live)}
        wallHref={wallHref}
        ledgerHref={props.ledgerHref ?? liveViewHref({}, "ledger")}
        cockpitHref={props.cockpitHref ?? liveViewHref({}, "cockpit")}
        // The gear arms the NEXT run, so it is offered only where a run could actually be started —
        // the same gate the CTA answers to.
        onOpenSetup={c.canRun ? () => setSetupOpen(true) : undefined}
        setupSummary={dialsSummary(c.dials)}
        onStop={c.stop}
        stopLabel={runner ? "Stop runner" : undefined}
        stopCaption={runner ? runnerStopHint(runner) : null}
        stopping={loop.busy || drive.busy}
        // The DRIVE's own flag counts here too: the header's Stop is `c.stop`, which stops whichever
        // of the two is pulling, so the state it reports has to cover both.
        stopRequested={loop.stopRequested || drive.drive?.stopRequested === true}
        stopHorizonMs={loop.stopHorizonMs}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(18rem,1.4fr)]">
        <CockpitField
          bodies={c.bodies}
          selected={c.selected}
          onSelect={c.setSelected}
          scanning={c.scanning}
          drift={c.drift}
          onOpen={openRepo}
          listOpen={listOpen}
          onToggleList={toggleList}
        />

        <Surface className="min-w-0 p-4">
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
            busy={loop.busy || drive.busy}
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
        </Surface>
      </div>

      {/* THE PROPOSED BATCH, in the main column rather than the rail (2026-09-17): it is a table, and
          a table needs the width. It curates the very batch the rail's CTA dispatches — one piece of
          state (`c.batch`), read by both. */}
      <CockpitBatchLedger
        proposals={c.batch.proposals}
        pruned={c.batch.pruned}
        onTogglePrune={c.batch.togglePrune}
        dimFocus={c.dials.dimFocus}
        unpaired={c.batch.unpaired}
        loading={c.batch.loading}
        empty={c.batch.repos.length === 0}
        repair={{ slug, canRepair: isOwner, onRepaired: c.batch.reload }}
      />

      <OutcomeSection
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
      />
      {/* What a verified maturity point has cost, per model, per dimension — the standing summary
          the strip's individual runs add up to. */}
      <PriceListPanel slug={slug} />
      <CockpitSetupDialog c={c} open={setupOpen} onClose={() => setSetupOpen(false)} runnerRepos={props.runnerRepos ?? props.pairedRepos} />
      {/* Lesson candidates left the cockpit on 2026-09-15: they are a review queue, and review queues
          live in the In flight group's own ledgers (Lessons, Proposals). */}
    </section>
  );
}
