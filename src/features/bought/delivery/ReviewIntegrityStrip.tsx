// What the fleet's review coverage is made of, directly under the PR band: the self-approved share
// and the approved-within-5-minutes share, pooled across repos (reviewIntegrityModel), plus the repos
// where most approvals land within minutes, as questions linking to their rows.
//
// The band idiom (PrSignalsBand): hairline-divided cells, label then value then basis. Deliberately
// untoned: neither share is a target, so no scoreHex colour implies a verdict. The RATE_BASIS caveats
// sit one click away on a WhyChip beside each label. A fleet whose scans predate the counts renders a
// dashed void saying so, never a 0%. Server-safe (no hooks; WhyChip is its own client island).

import { WhyChip } from "@/components/org/viz";
import { FAST_APPROVAL_MAX_MINUTES, REVIEW_INTEGRITY_MIN_SAMPLE } from "@/lib/analyze/pr-thresholds";
import type { FleetIntegrityReading, IntegrityQuestion, ReviewIntegrityModel } from "./reviewIntegrityModel";

const MAX_QUESTIONS = 4;

function IntegrityCell({ label, sub, reading, chipLabel }: { label: string; sub: string; reading: FleetIntegrityReading; chipLabel: string }) {
  return (
    <div className="-ml-px -mt-px flex flex-col border-l border-t border-divider px-4 py-3">
      <div className="flex items-center gap-1.5">
        <span className="font-mono type-micro uppercase tracking-wider text-slate-400">{label}</span>
        <WhyChip hint={reading.caveat} label={chipLabel} />
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
        <span className="type-figure font-bold text-slate-200">{reading.percent == null ? "n/a" : `${reading.percent}%`}</span>
        <span className="type-note text-slate-500">{sub}</span>
      </div>
      <div className="mt-1 font-mono type-micro tabular-nums text-slate-500">{reading.basis}</div>
      {reading.legacyNote && <div className="font-mono type-micro text-slate-600">{reading.legacyNote}</div>}
    </div>
  );
}

function Questions({ questions }: { questions: IntegrityQuestion[] }) {
  const shown = questions.slice(0, MAX_QUESTIONS);
  const rest = questions.length - shown.length;
  return (
    <div className="-ml-px -mt-px flex flex-col border-l border-t border-divider px-4 py-3">
      <div className="font-mono type-micro uppercase tracking-wider text-slate-400">Worth asking about</div>
      {shown.length === 0 ? (
        <p className="mt-1 type-note text-slate-500">
          No repository with {REVIEW_INTEGRITY_MIN_SAMPLE} or more approved PRs has most approvals landing within{" "}
          {FAST_APPROVAL_MAX_MINUTES} minutes.
        </p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {shown.map((q) => (
            <li key={q.fullName}>
              <a href="#per-repo" className="focus-ring type-note text-slate-300 transition hover:text-white">
                {q.sentence}
              </a>
            </li>
          ))}
          {rest > 0 && <li className="type-note text-slate-500">plus {rest} more</li>}
        </ul>
      )}
    </div>
  );
}

export function ReviewIntegrityStrip({ model }: { model: ReviewIntegrityModel }) {
  if (!model.fleet) {
    return (
      <div className="rounded-xl border border-dashed border-divider px-4 py-3 type-note text-slate-500">
        <span className="font-mono type-micro uppercase tracking-wider text-slate-400">Review integrity</span>{" "}
        not measured in these scans. Self-approval and {FAST_APPROVAL_MAX_MINUTES}-minute approval counts arrived after
        these repositories were last scanned; a rescan measures them.
      </div>
    );
  }
  const { selfApproved, fastApproval } = model.fleet;
  return (
    <div className="overflow-hidden rounded-xl border border-divider bg-surface/40">
      <div className="grid grid-cols-1 sm:grid-cols-3">
        <IntegrityCell label="Self-approved" sub="of human-merged PRs" reading={selfApproved} chipLabel="self-approval" />
        <IntegrityCell
          label={`Approved within ${FAST_APPROVAL_MAX_MINUTES} minutes`}
          sub="of approved PRs, self-approvals excluded"
          reading={fastApproval}
          chipLabel="fast approval"
        />
        <Questions questions={model.questions} />
      </div>
    </div>
  );
}
