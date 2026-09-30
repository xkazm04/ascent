// What review coverage is made of. A missing pool is "not measured", never 0% or n/a.
import { Caption, Frame, HairlineGrid, Lede, SectionHead, StatTile } from "@/components/kit";
import { WhyChip } from "@/components/org/viz";
import { FAST_APPROVAL_MAX_MINUTES, REVIEW_INTEGRITY_MIN_SAMPLE } from "@/lib/analyze/pr-thresholds";
import type { OrgPrSignals } from "@/lib/db";
import type { FleetIntegrityReading, IntegrityQuestion } from "./reviewIntegrityModel";
import { reviewIntegrityModel } from "./reviewIntegrityModel";
import { Unknown } from "./deliveryV2Marks";

const MAX_QUESTIONS = 4;

function Cell({ label, sub, reading, chip }: { label: string; sub: string; reading: FleetIntegrityReading; chip: string }) {
  const note = [reading.basis, reading.legacyNote].filter(Boolean).join(" · ");
  return (
    <StatTile
      label={<span className="inline-flex items-center gap-1.5">{label}<WhyChip hint={reading.caveat} label={chip} /></span>}
      value={reading.percent == null ? <Unknown /> : `${reading.percent}%`}
      sub={`${sub}${note ? ` · ${note}` : ""}`}
    />
  );
}

function Questions({ questions }: { questions: IntegrityQuestion[] }) {
  const shown = questions.slice(0, MAX_QUESTIONS);
  const rest = questions.length - shown.length;
  return (
    <div className="bg-ink px-5 py-3.5">
      <Caption>Worth asking about</Caption>
      {shown.length === 0 ? (
        <p className="mt-2 text-slate-400">
          No repository with {REVIEW_INTEGRITY_MIN_SAMPLE} or more approved PRs has most approvals landing within{" "}
          {FAST_APPROVAL_MAX_MINUTES} minutes.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {shown.map((q) => (
            <li key={q.fullName}>
              <a href="#per-repo" className="focus-ring text-slate-300 hover:text-white">{q.sentence}</a>
            </li>
          ))}
          {rest > 0 && <li className="text-slate-400">plus {rest} more</li>}
        </ul>
      )}
    </div>
  );
}

export function DeliveryIntegrityV2({ pr }: { pr: OrgPrSignals }) {
  const model = reviewIntegrityModel(pr.perRepo);
  if (!model.fleet) {
    return (
      <Frame id="review-integrity">
        <SectionHead eyebrow="Review integrity" title="Not measured" named="in these scans." />
        <Lede className="mt-3">
          Self-approval and {FAST_APPROVAL_MAX_MINUTES}-minute approval counts arrived after these repositories were
          last scanned; a rescan measures them.
        </Lede>
      </Frame>
    );
  }
  const { selfApproved, fastApproval } = model.fleet;
  return (
    <Frame id="review-integrity">
      <SectionHead eyebrow="Review integrity" title="What coverage is made of" named="self-approval and fast approval." />
      <HairlineGrid className="mt-6 grid-cols-1 sm:grid-cols-3">
        <Cell label="Self-approved" sub="of human-merged PRs" reading={selfApproved} chip="self-approval" />
        <Cell
          label={`Approved within ${FAST_APPROVAL_MAX_MINUTES} minutes`}
          sub="of approved PRs, self-approvals excluded"
          reading={fastApproval}
          chip="fast approval"
        />
        <Questions questions={model.questions} />
      </HairlineGrid>
    </Frame>
  );
}
