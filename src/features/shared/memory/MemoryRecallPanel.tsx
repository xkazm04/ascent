"use client";

// THE RECALL SURFACE — what makes *recall* different from *browse*.
//
// The list above this panel is sorted by date: it answers "what was written recently". Recall answers
// the question people actually have — "what does this org already know about our CI story, in the
// 6000 characters I can afford to paste into an agent?" — by scoring every eligible memory on trust ×
// exponential per-kind decay × a capped DELIVERY bonus, then packing whole items greedily into the
// budget. Not "usefulness": see the recall.ts header for why that word is not available to us.
//
// TWO THINGS IT REFUSES TO DO:
//  1. Show only the winners. Every omission is DRAWN, grouped by reason, in `BudgetPack` — solid for
//     the ones a bigger budget admits, struck/hatched for the ones no budget ever will. That used to
//     be a 330-character paragraph describing a packing bar; it is now the packing bar.
//  2. Recompute score/ageDays in the browser. They are rendered verbatim from the response, so the
//     number shown is the number that ranked the row. `RecallContribution` draws the three FACTORS
//     and never multiplies them back into a score.
//
// Reads are UNGATED (any org member), matching the route.

import { useEffect, useRef, useState } from "react";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import { BudgetPack, Legend, WhyChip } from "@/components/org/viz";
import { IneligibleRow, OmissionGroup, ScoredRow } from "@/features/shared/memory/MemoryRecallRows";
import { DEFAULT_BUDGET, MemoryRecallControls } from "@/features/shared/memory/MemoryRecallControls";
import { runRecall, type RecallResponse } from "@/features/shared/memory/memoryRecall";
import {
  BUDGET_GROUP_HINT,
  BUDGET_STATE,
  INELIGIBLE_GROUP_HINT,
  OMISSION_HINT,
  PACKED_HINT,
  omissionStates,
  recallOmissions,
} from "@/features/shared/memory/recallOmissions";

/** (O) The argument, where a reader has nothing to look at and a reason to press the button. */
function RecallIntro() {
  return (
    <p className="mt-3 type-body-sm text-slate-500">
      Ask for the org&apos;s most valuable knowledge inside a character budget: items are packed
      whole, never truncated mid-memory, and everything that did not fit is drawn beside what did.
      A ranking you cannot see the losers of is not auditable.
    </p>
  );
}

export function MemoryRecallPanel({
  slug,
  namespaces,
  kinds,
}: {
  slug: string;
  namespaces: string[];
  kinds: readonly string[];
}) {
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
      setResult(
        await runRecall(
          {
            org: slug,
            namespace: namespace || undefined,
            kinds: kind ? [kind] : undefined,
            charBudget,
          },
          ac.signal,
        ),
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError(e instanceof Error ? e.message : "Recall failed.");
      }
    } finally {
      // BOTH inside the guard: a superseded run's `finally` lands AFTER the new run's setRunning(true),
      // so clearing the flag unconditionally re-enabled the button and stopped the spinner while the
      // live request was still in flight. Only the run that is still current may say it has stopped.
      if (abort.current === ac) {
        abort.current = null;
        setRunning(false);
      }
    }
  }

  const omissions = result ? recallOmissions(result) : [];

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Recall: what an agent would be handed"
        description="chars per pack · scored at the server clock"
      />

      {/* FIRST SIGHT: the packing bar and its losers. Before a run there is no measurement, so the
          argument (O) stands in its place rather than a bar drawn at zero. */}
      {result ? (
        <>
          <BudgetPack
            className="mt-3"
            label="Recall budget"
            used={result.usedChars}
            budget={result.charBudget}
            unit=" chars"
            omissions={omissions}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Legend states={omissionStates(omissions)} />
            <WhyChip hint={OMISSION_HINT} label="omission groups" />
            <WhyChip hint={PACKED_HINT} label="what packing costs" />
          </div>
          <p className="mt-2 type-caption tabular-nums text-slate-500">
            packed {result.memories.length} of {result.consideredCount} eligible
          </p>
        </>
      ) : (
        <RecallIntro />
      )}

      <MemoryRecallControls
        charBudget={charBudget}
        setCharBudget={setCharBudget}
        namespace={namespace}
        setNamespace={setNamespace}
        kind={kind}
        setKind={setKind}
        namespaces={namespaces}
        kinds={kinds}
        running={running}
        onRecall={recall}
      />

      {result && (
        <div className="mt-4">
          {result.memories.length === 0 ? (
            <p className="type-body-sm text-slate-500">
              Nothing was packed.{" "}
              {result.omittedCount > 0
                ? "Everything eligible was larger than the budget. Raise it above."
                : "There is no recallable memory in this scope yet."}
            </p>
          ) : (
            <ul className="divide-y divide-divider">
              {result.memories.map((m) => (
                <ScoredRow key={m.id} item={m} />
              ))}
            </ul>
          )}

          <OmissionGroup
            title="ranked but left out: budget"
            hint={BUDGET_GROUP_HINT}
            state={BUDGET_STATE}
            count={result.omitted.length}
          >
            {result.omitted.map((m) => (
              <ScoredRow key={m.id} item={m} muted />
            ))}
          </OmissionGroup>

          <OmissionGroup
            title="not recallable"
            hint={INELIGIBLE_GROUP_HINT}
            state="superseded"
            count={result.ineligible.length}
          >
            {result.ineligible.map((m) => (
              <IneligibleRow key={m.id} item={m} />
            ))}
          </OmissionGroup>
        </div>
      )}

      {error && <p className="mt-2 type-body-sm text-orange-300">{error}</p>}
    </Card>
  );
}
