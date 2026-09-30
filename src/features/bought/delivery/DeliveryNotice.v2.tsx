// Prism disclosure for Delivery's mixed window. Same claim as SnapshotScopeNotice scope="partial":
// the trend, unit economics, outcomes and AI spend honour the period; the rest is a scan-time snapshot.
import { WhyChip } from "@/components/org/viz";
import { Caption } from "@/components/kit";
import { RANGE_OPTIONS, type ResolvedWindow } from "@/lib/window";

const HINT =
  "Pull request signals, branch governance and commit activity are read off each repo's most recent scan. Scan.prStats is a pre-computed aggregate with no dated PR population to re-cut, so no range can re-scope it. Read these as the fleet as of its most recent scans.";

function windowLabel(period: ResolvedWindow): string {
  if (period.key === "custom") {
    const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "open");
    return `${day(period.start)} to ${day(period.end)}`;
  }
  return RANGE_OPTIONS.find((o) => o.key === period.key)?.label ?? period.key;
}

export function DeliveryNoticeV2({ period }: { period: ResolvedWindow }) {
  return (
    <Caption>
      {windowLabel(period)}. The trend, unit economics, outcomes and AI spend are period-scoped. Pull request
      signals, branch governance and commit activity below this line are a scan-time snapshot.{" "}
      <WhyChip hint={HINT} label="why this half is not period-scoped" />
    </Caption>
  );
}
