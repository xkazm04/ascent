// Confidence of the rows on screen, plus citation votes when any row has one. No votes is not a
// zero: the citation tile stays unmeasured. Quartiles are the same nearest-rank read as Altimeter.
import { Caption, KeyValue, Ladder, StatStrip, StatTile, VoidMark } from "@/components/kit";
import type { MemoryRow } from "@/lib/db";
import { citationEvidence } from "./MemoryTrust";
import { bandCounts, confidenceSpread } from "./memoryView";

export function MemoryTrustV2({ memories, loading = false }: { memories: MemoryRow[]; loading?: boolean }) {
  if (loading || memories.length === 0) return null;
  const spread = confidenceSpread(memories);
  if (!spread) return null;
  const evidence = citationEvidence(memories);

  return (
    <div className="mt-6 space-y-4">
      <StatStrip cols={evidence ? 4 : 3}>
        <StatTile label="Listed" value={spread.n} />
        <StatTile label="Median trust" value={spread.median.toFixed(2)} raw />
        {evidence ? (
          <StatTile label="Cited" value={evidence.cited} sub="self-reports, not proof it helped" />
        ) : (
          <StatTile
            label="Citation votes"
            value={
              <span className="inline-flex items-center gap-2 type-body font-normal text-slate-200">
                <VoidMark label="Citation evidence, not measured" />
                not measured
              </span>
            }
            sub="no votes on the listed rows"
          />
        )}
        {evidence && <StatTile label="Not useful" value={evidence.notUseful} sub="never netted against cited" />}
      </StatStrip>
      <Ladder label="Trust bands of the listed memories" steps={bandCounts(memories)} />
      <KeyValue
        items={[
          { key: "Low", value: spread.min.toFixed(2) },
          { key: "Lower quartile", value: spread.q1.toFixed(2) },
          { key: "Median", value: spread.median.toFixed(2) },
          { key: "Upper quartile", value: spread.q3.toFixed(2) },
          { key: "High", value: spread.max.toFixed(2) },
        ]}
      />
      <Caption>Trust is 0 to 1. A citation is an agent reporting that it used a memory, not proof the memory helped.</Caption>
    </div>
  );
}
