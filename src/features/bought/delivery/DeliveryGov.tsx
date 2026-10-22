// Branch governance. The gap matrix is omitted: it paints status hues. The table
// carries the same rows, gaps first, and a measured "no" stays the word No.
import { Frame, SectionHead, StatStrip, StatTile } from "@/components/kit";
import { WhyChip } from "@/components/shared/viz";
import type { OrgGovernance } from "@/lib/db";
import { DeliveryGovTable } from "./DeliveryGovTable";
import { fullTone, pct } from "./deliveryMarks";

const SOURCE_HINT =
  "Read from each repo's branch protection and rulesets at its last scan. The gaps are listed first and the fully governed tail is folded below.";

export function DeliveryGov({ gov }: { gov: OrgGovernance }) {
  return (
    <Frame id="governance">
      <SectionHead
        eyebrow="Governance"
        title="Branch governance"
        named={`${gov.repos} repo${gov.repos === 1 ? "" : "s"} on the default branch.`}
        lede={<WhyChip hint={SOURCE_HINT} label="where these guardrails are read from" />}
      />
      <StatStrip cols={4} className="mt-6">
        <StatTile label="Protect main" value={pct(gov.protectedRate, fullTone(gov.protectedRate))} />
        <StatTile label="Require review" value={pct(gov.requireReviewRate, fullTone(gov.requireReviewRate))} sub="1 or more approving reviews" />
        <StatTile label="Required status checks" value={pct(gov.requireChecksRate, fullTone(gov.requireChecksRate))} sub="branch protection" />
        <StatTile label="Signed commits" value={pct(gov.signedRate)} />
      </StatStrip>
      <div className="mt-6">
        <DeliveryGovTable gov={gov} />
      </div>
    </Frame>
  );
}
