"use client";

// Recall, Prism. Same request, same abort rule: only the run that is still current may clear the
// spinner. Scores render as the server sent them. Before a run there is no bar at zero.
import { useEffect, useRef, useState } from "react";
import { Caption, CellMark, Frame, SectionHead, StatStrip, StatTile } from "@/components/kit";
import { MemoryRecallFormV2 } from "./MemoryRecallForm.v2";
import { IneligibleRowsV2, OmissionBlock, ScoredRowsV2 } from "./MemoryRecallRows.v2";
import { DEFAULT_BUDGET } from "./MemoryRecallControls";
import { runRecall, type RecallResponse } from "./memoryRecall";
import { BUDGET_GROUP_HINT, BUDGET_STATE, INELIGIBLE_GROUP_HINT, PACKED_HINT, recallOmissions } from "./recallOmissions";
import { MemoryNote } from "./MemoryNote";

export function MemoryRecallV2({ slug, namespaces, kinds }: { slug: string; namespaces: string[]; kinds: readonly string[] }) {
  const [charBudget, setCharBudget] = useState(DEFAULT_BUDGET);
  const [namespace, setNamespace] = useState("");
  const [kind, setKind] = useState("");
  const [result, setResult] = useState<RecallResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function recall() {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setRunning(true);
    setError(null);
    try {
      setResult(await runRecall({ org: slug, namespace: namespace || undefined, kinds: kind ? [kind] : undefined, charBudget }, ac.signal));
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : "Recall failed.");
    } finally {
      if (abort.current === ac) {
        abort.current = null;
        setRunning(false);
      }
    }
  }

  const omissions = result ? recallOmissions(result) : [];

  return (
    <Frame aria-label="Recall">
      <SectionHead
        eyebrow="Recall"
        title="What an agent"
        named="would be handed"
        lede="Items are packed whole, never cut mid-memory. Everything that did not fit stays listed, with the reason it lost."
      />
      {result && (
        <div className="mt-5 space-y-3">
          <StatStrip cols={3}>
            <StatTile label="Used" value={result.usedChars} sub={`of ${result.charBudget} chars`} />
            <StatTile label="Packed" value={result.memories.length} sub={`of ${result.consideredCount} eligible`} />
            <StatTile label="Left out" value={result.omittedCount} sub="scored, over budget" />
          </StatStrip>
          <div className="flex flex-wrap gap-3">
            {omissions.map((o) => (
              <CellMark key={o.id} state={o.state === "not-judged" ? "unmeasured" : o.state === "measured" ? "partial" : "missing"}>
                {o.count} {o.label}
              </CellMark>
            ))}
          </div>
          <Caption>{PACKED_HINT}</Caption>
        </div>
      )}
      <MemoryRecallFormV2
        charBudget={charBudget}
        setCharBudget={setCharBudget}
        namespace={namespace}
        setNamespace={setNamespace}
        kind={kind}
        setKind={setKind}
        namespaces={namespaces}
        kinds={kinds}
        running={running}
        onRecall={() => void recall()}
      />
      {result && (
        <div className="mt-5">
          {result.memories.length === 0 ? (
            <p className="type-body-sm text-slate-400">
              Nothing was packed.{" "}
              {result.omittedCount > 0 ? "Everything eligible was larger than the budget. Raise it above." : "There is no recallable memory in this scope yet."}
            </p>
          ) : (
            <ScoredRowsV2 items={result.memories} mark="met" word="packed" />
          )}
          <OmissionBlock title="ranked but left out: budget" hint={BUDGET_GROUP_HINT} state={BUDGET_STATE} count={result.omitted.length}>
            <ScoredRowsV2 items={result.omitted} mark="partial" word="over budget" />
          </OmissionBlock>
          <OmissionBlock title="not recallable" hint={INELIGIBLE_GROUP_HINT} state="superseded" count={result.ineligible.length}>
            <IneligibleRowsV2 items={result.ineligible} />
          </OmissionBlock>
        </div>
      )}
      {error && <MemoryNote kind="risk">{error}</MemoryNote>}
    </Frame>
  );
}
