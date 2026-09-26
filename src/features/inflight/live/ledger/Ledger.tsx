"use client";

// THE LEDGER — the returning operator's view of the standing runner (spark theater-upgrade,
// 2026-09-18). Top to bottom: what the runner is doing; what happened since you last looked; what waits
// for you; the runner branch; the directions you granted; every run; the lessons the runner kept.
//
// Everything renders from ONE server load (`loadLedger`). The briefing is a pure derivation over it, and
// the anchor it is measured from was snapshotted at that load — so the presence stamp this view fires
// after five visible seconds (`useSeenStamp`) moves the NEXT visit's anchor, never this one's card.

import { useCallback } from "react";
import { deriveBriefing } from "./briefingModel";
import { Chronicle } from "./Chronicle";
import { Directions } from "./Directions";
import { LedgerBriefing } from "./LedgerBriefing";
import { LedgerHeader } from "./LedgerHeader";
import { NeedsYou } from "./NeedsYou";
import { RunnerCard } from "./RunnerCard";
import { RunnerLessons } from "./RunnerLessons";
import { stampLiveSeen } from "./ledgerClient";
import { useLedgerState } from "./useLedgerState";
import { useSeenStamp } from "./useSeenStamp";
import type { LedgerData } from "./ledgerTypes";

export interface LedgerProps {
  data: LedgerData;
  ledgerHref: string;
  cockpitHref: string;
}

export function Ledger({ data, ledgerHref, cockpitHref }: LedgerProps) {
  const s = useLedgerState(data);
  const briefing = deriveBriefing({
    now: data.now,
    seenAt: data.seenAt,
    runs: data.runs,
    runsHasMore: data.runsHasMore,
    pending: s.pending,
    directions: s.directions,
    runner: s.runner,
    lastRunner: data.lastRunner,
    failed: data.failed,
  });
  // A briefing that could not be derived must not advance the anchor past deltas nobody saw. And the
  // stamp is THROUGH this load, not "now": a ledger loaded in a background tab stamps when it is finally
  // seen, and whatever finished in between was never on this screen.
  const stampThroughLoad = useCallback((slug: string) => stampLiveSeen(slug, data.now), [data.now]);
  useSeenStamp(data.slug, briefing?.kind !== "error", stampThroughLoad);
  const cardRunner = s.runner ?? data.lastRunner;

  return (
    <section aria-label="Live ledger" data-testid="live-ledger" className="space-y-8">
      <LedgerHeader
        slug={data.slug}
        runner={s.runner}
        activeRun={data.activeRun}
        now={data.now}
        ledgerHref={ledgerHref}
        cockpitHref={cockpitHref}
      />
      <LedgerBriefing briefing={briefing} />
      <NeedsYou
        slug={data.slug}
        pending={s.pending}
        runner={s.runner}
        now={data.now}
        isOwner={data.isOwner}
        onDecided={s.onDecided}
        onResumed={s.onRepoResumed}
      />
      <RunnerCard
        slug={data.slug}
        runner={cardRunner}
        live={s.runner != null}
        ahead={s.ahead}
        now={data.now}
        isOwner={data.isOwner}
        selfHosted={data.selfHosted}
        cockpitHref={cockpitHref}
        onMerged={s.onMerged}
      />
      <Directions directions={s.directions} plans={s.plans} now={data.now} isOwner={data.isOwner} onSettled={s.onDirectionSettled} />
      <Chronicle slug={data.slug} initial={data.runs} initialHasMore={data.runsHasMore} modes={data.driveModes} plans={s.plans} now={data.now} />
      <RunnerLessons slug={data.slug} lessons={s.lessons} now={data.now} isOwner={data.isOwner} onRevoked={s.onLessonRevoked} />
    </section>
  );
}
