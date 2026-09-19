// The exemplar panel (moonshot #34) — server, presentational, route-colocated.
//
// It answers "what does a stronger repo have that this one doesn't", and it is built to be
// un-embarrassing when the answer is "nothing" or "we couldn't tell you": every failure state gets a
// sentence saying the comparison was NOT made, and none of them silently substitutes a different
// exemplar. `nothingToTransfer` renders a real answer, not an empty panel.

import { CopyForLlm } from "@/components/CopyForLlm";
import { Kicker, SectionHeading, Surface } from "@/components/ui";
import type { ExemplarDiff, TransferRow } from "@/lib/report/exemplar";
import { DimensionTransfer, ExemplarBasis, ExemplarNotice } from "./ExemplarPanelParts";

/** Every reason the comparison could not be made, each stated rather than papered over. */
export type ExemplarFailure =
  | { kind: "unparseable"; raw: string }
  | { kind: "not-found" }
  | { kind: "forbidden" }
  | { kind: "below-floor"; population: number; min: number }
  | { kind: "unavailable" };

export function ExemplarFailureNotice({ failure }: { failure: ExemplarFailure }) {
  switch (failure.kind) {
    case "unparseable":
      return (
        <ExemplarNotice>
          <code className="font-mono">{failure.raw}</code> isn&apos;t an exemplar we recognise, so no comparison
          was made. Use <code className="font-mono">owner/repo</code>, <code className="font-mono">org:best</code>{" "}
          (or <code className="font-mono">org:best:D2</code>), or <code className="font-mono">cohort:lang:Go</code>.
        </ExemplarNotice>
      );
    case "not-found":
      return (
        <ExemplarNotice>
          That exemplar isn&apos;t available to you — it doesn&apos;t exist in this organization, or it has no
          scan on the current rubric. Nothing was substituted; pick another exemplar below.
        </ExemplarNotice>
      );
    case "forbidden":
      return <ExemplarNotice>A repository can&apos;t be its own exemplar. Pick a different one below.</ExemplarNotice>;
    case "below-floor":
      return (
        <ExemplarNotice>
          That cohort is too small to report on:{" "}
          <span className="font-mono tabular-nums">{failure.population}</span> of the{" "}
          <span className="font-mono tabular-nums">{failure.min}</span> needed. Below the floor an
          &ldquo;aggregate&rdquo; would really be one or two teams&apos; repositories, so no comparison was made
          rather than a partial one.
        </ExemplarNotice>
      );
    default:
      return (
        <ExemplarNotice>
          The exemplar comparison is unavailable right now (the scan store didn&apos;t answer). The diff above
          is unaffected.
        </ExemplarNotice>
      );
  }
}

export function ExemplarPanel({
  diff,
  transfers,
  markdown,
}: {
  diff: ExemplarDiff;
  transfers: TransferRow[];
  /** The `## Against exemplar` briefing, handed to the copy chip so an agent gets the same content. */
  markdown: string;
}) {
  const byDim = new Map(transfers.map((t) => [t.dimId, t]));
  const moved = diff.dimensions.filter((d) => d.absentSignals.length > 0 || d.aheadSignals.length > 0);

  return (
    <Surface radius="2xl" className="p-5" id="against-exemplar">
      <SectionHeading
        as="h2"
        kicker="Against exemplar"
        title={diff.exemplar.label}
        right={
          <CopyForLlm
            text={markdown}
            label="Copy comparison"
            ariaLabel={`Copy the comparison against ${diff.exemplar.label} for an LLM`}
          />
        }
      />
      <ExemplarBasis diff={diff} />

      <p className="mt-3 text-base text-slate-400">
        Read this as <span className="text-slate-200">has / lacks</span>, not better / worse. A signal a library
        doesn&apos;t need and a service does is a difference, not a defect — the panel shows both directions.
      </p>

      {diff.nothingToTransfer ? (
        <p className="mt-4 text-base text-slate-300">
          Nothing this exemplar has is missing here.
          {diff.aheadSignalCount > 0 && (
            <span className="text-slate-400">
              {" "}
              This repo carries <span className="font-mono tabular-nums">{diff.aheadSignalCount}</span> signal
              {diff.aheadSignalCount === 1 ? "" : "s"} the exemplar doesn&apos;t.
            </span>
          )}
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {moved.map((row) => (
            <DimensionTransfer key={row.id} row={row} transfer={byDim.get(row.id) ?? null} />
          ))}
        </div>
      )}

      {diff.notComparable.length > 0 && (
        <p className="mt-4 text-sm text-slate-500">
          <Kicker tone="muted" as="span">
            not comparable
          </Kicker>{" "}
          {diff.notComparable.join(", ")} — scored on only one side, so no gap is claimed for{" "}
          {diff.notComparable.length === 1 ? "it" : "them"}.
        </p>
      )}
    </Surface>
  );
}
