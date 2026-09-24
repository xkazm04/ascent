// The kiosk wall's run summary strip (backlog develop-2026-09-17 row 43): three counts under the standing
// wall on /live/shared/[token]. Its only input is `KioskRunSummary`, a type that holds numbers and
// nothing else, so this component has no way to print a repo, a branch or a person. Read-only: no
// button, no link, no form. A server component (no hooks), so it adds nothing to the kiosk's bundle.

import { HairlineGrid, Kicker, Stat, signedDelta } from "@/components/ui";
import type { KioskRunSummary } from "@/lib/live-share-summary";

export function KioskRunStrip({ summary }: { summary: KioskRunSummary }) {
  const { runs, runWindow, verifiedCloses, pointsInReview } = summary;
  return (
    <section aria-label="Improvement loop summary" className="mt-6 space-y-2">
      <Kicker tone="accent">Improvement loop</Kicker>
      <HairlineGrid className="grid-cols-1 sm:grid-cols-3">
        <Stat
          className="bg-ink px-5 py-4"
          label="Runs"
          value={runs}
          sub={runs >= runWindow ? `the latest ${runWindow}` : "every run recorded"}
        />
        <Stat
          className="bg-ink px-5 py-4"
          label="Verified closes"
          value={verifiedCloses}
          sub="follow-ups the rescan confirmed closed"
        />
        <Stat
          className="bg-ink px-5 py-4"
          label="Points in review"
          value={pointsInReview == null ? "Unmeasured" : signedDelta(pointsInReview)}
          sub={pointsInReview == null ? "no lane measured yet" : "on branches, not merged"}
        />
      </HairlineGrid>
    </section>
  );
}
