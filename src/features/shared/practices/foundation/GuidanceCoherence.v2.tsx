// Prism guidance coherence. The spread is a ladder: each quantile is paper, unassessed is hatched.
import { Caption, Display, Frame, Ladder, Lede, SectionHead, VoidMark } from "@/components/kit";
import { coherenceLadderSteps } from "./coherenceLadder";
import { coherenceSpread } from "./coherenceSpread";
import { coherenceFleetSummary, orderByIncoherence, type RepoCoherenceRow } from "./guidanceCoherenceModel";
import { CoherenceRepoV2 } from "./CoherenceRepo.v2";

// Model sentences keep their em dashes for the Altimeter card. Prism prints a comma.
const plain = (s: string) => s.replaceAll(" — ", ", ").replaceAll("—", ", ");

export function GuidanceCoherenceV2({ rows }: { rows: RepoCoherenceRow[] }) {
  const s = coherenceFleetSummary(rows);
  const spread = coherenceSpread(rows);
  const ordered = orderByIncoherence(rows).filter((r) => r.assessed);
  return (
    <Frame>
      <SectionHead
        eyebrow="Guidance coherence"
        title="Do the documents"
        named="agree?"
        lede="Coherence is 0 to 100 for whether a repo's guidance documents agree: which one is the authority, which are projections, and where they tell an agent different things. A contradiction withholds points. It is not a failing grade."
      />
      <div className="mt-5 flex flex-wrap gap-x-10 gap-y-4">
        <div>
          <Caption>Mean coherence</Caption>
          {s.meanCoherence == null ? (
            <span className="mt-1 flex items-center gap-2 text-slate-400">
              <VoidMark label="Mean coherence: not measured" />
              not measured
            </span>
          ) : (
            <Display as="div" level="figure">{s.meanCoherence}</Display>
          )}
          <Caption>{s.measured ? `over ${s.measured} assessed` : "nothing assessed yet"}</Caption>
        </div>
        <div>
          <Caption>Contradicting</Caption>
          <Display as="div" level="figure">{s.contradicting}</Display>
          <Caption>agent gets two answers</Caption>
        </div>
        <div>
          <Caption>Not assessed</Caption>
          <Display as="div" level="figure">{s.unmeasured}</Display>
          <Caption>excluded from every share</Caption>
        </div>
      </div>
      {spread.five ? (
        <div className="mt-4">
          <Ladder label="Coherence spread" steps={coherenceLadderSteps(spread)} />
          <Caption>{spread.five.n} assessed repositories in the spread.</Caption>
        </div>
      ) : (
        <Lede className="mt-4">
          {spread.measured === 1
            ? "One assessed repository. A spread needs at least two."
            : "Nothing assessed yet, so there is no spread to draw."}
        </Lede>
      )}
      <p className="mt-4 text-slate-400">{plain(s.headline)}</p>
      {ordered.length ? (
        <div className="mt-4">
          {ordered.map((r) => (
            <CoherenceRepoV2 key={r.fullName} r={r} />
          ))}
        </div>
      ) : (
        s.emptyMessage && <Lede className="mt-4">{plain(s.emptyMessage)}</Lede>
      )}
    </Frame>
  );
}
